# 研究借鉴:微信个人号 Bot 通道(来自 Weknora 项目分析)

> 来源:上海节点 Weknora 项目"扫码绑定微信"全链路研究(2026-10-05)
> Samsara 映射:M2 切片 4 渠道体系的第一个真实施加对象

## Weknora 的做法(事实)

| 层 | 实现 |
|---|---|
| 协议底座 | 腾讯 iLink Bot API(`ilinkai.weixin.qq.com`),个人号 Bot,非公众号/企微 |
| 绑定流程 | 服务端代理申请二维码 → 用户微信扫码 → 服务端长轮询取回凭证 → 前端表单保存 |
| 运行态 | LongPollClient 循环 `POST /ilink/bot/getupdates`(35s 长轮询,游标翻页,指数退避) |
| 发消息 | `POST /ilink/bot/sendmessage` |
| Token 生命周期 | `errcode -14` = 失效 → 需重新扫码绑定 |
| 媒体文件 | AES-128-ECB 解密 |
| 多实例 | Redis 领导者选举(TTL 15s/续期 5s,保单实例轮询) |

## 三个观察(Samsara 的回应)

1. **qrserver.com 公网依赖** → Samsara 本地生成二维码(纯 JS qrcode 库,零外部依赖,凭据不经第三方)
2. **凭证经浏览器中转** → Samsara 的 token 不走浏览器回传:服务端直接从 iLink 取回后入 `credentials/`(0600),前端只收"绑定成功/失败"通知,token 永不出服务端
3. **DETACHED context / 超时折算 wait** → 好工程实践,直接借鉴

## Samsara 架构映射(适配器设计输入)

| iLink 概念 | Samsara 映射 | 位置 |
|---|---|---|
| `get_bot_qrcode` | `device.pair_request` 入账 → 生成二维码给前端 | 接口 §3.2 device.approve |
| `get_qrcode_status`(长轮询取回凭证) | 信任栈 T3 配对审批(附录 B.1/K.4) | §4.4 |
| `getupdates`(长轮询收消息) | ChannelAdapter.start(ctx) 内长轮询 → normalize → 消息总线 | §4.1/§4.2 |
| `sendmessage` | ChannelAdapter.deliver(platformPayload) | §4.1 |
| `getconfig`+`sendtyping`(typing"正在输入") | 表达力 L5 状态指示;best-effort 静默降级 | §4.6 落地注 |
| context_token(串线) | per-peer 持久化(state/wechat-ilink-state.json,0600),跨重启回复/主动推送串线 | §4.6 落地注 |
| bot_token | credentials/(0600)——与 LLM key 同级管理 | §8.1/E.1 |
| errcode -14 → 重绑 | 契约:token 失效事件 → 自动暂停渠道 + 通知 owner 重扫 | 渠道生命周期 §4.1 |
| 领导者选举 | Samsara 单进程部署天然单写者(INV-4),不需要 | — |
| AES-128-ECB 媒体解密 | 媒体入 CAS 后再处理(附件经 CAS 引用,接口 §5.2) | §4.6 |

## 优势(Samsara 选它的理由)

1. **国内零梯子**:微信个人号 ubiquitous,用户无需装任何额外 app
2. **纯出站长轮询**:与 Telegram getUpdates 同构——Samsara 不开入站端口,宪法层条款不破
3. **个人号语义**:私聊场景与 Samsara 的 sessionKey=wechat:dm:<peer> 完美匹配
4. **已有生态**:Weknora 已踩过坑(DETACHED context、-14 生命周期、媒体解密)

## 风险与限制

- iLink API 无官方文档(逆向,可能随微信版本变更)
- 仅支持 iOS 微信 8.0.70+,单聊
- 媒体加密格式可能变化
- Samsara 应对:渠道插件化(§4.1 热插拔),API 变更只改适配器不影响内核

## M2-S4 收尾补充契约(2026-10-06,批次十三)

来源:Weknora adapter.go SendTyping(此仓 weknora-2906)+ wechatbot.dev 整合文档 + GitHub issue 实测:

- **getconfig**:`POST /ilink/bot/getconfig`,body `{ilink_user_id, context_token?, base_info}` → `{typing_ticket}`;缺 `ilink_user_id` 报 `{"ret":-2,"errmsg":"ilink_user_id required"}`(无官方文档记载,issue 实测)
- **sendtyping**:`POST /ilink/bot/sendtyping`,body `{ilink_user_id, typing_ticket, status, base_info}`;**status=1 开始 / 2 结束(不是 0)**;约 60s 自动过期,持续显示须周期重发;ticket 按用户缓存约 10min 可复用
- 两端点与 sendmessage 同头(`AuthorizationType: ilink_bot_token` + `X-WECHAT-UIN` + Bearer)
- typing 与 getconfig/sendtyping 均**不是发消息的前置**——纯状态指示,best-effort 使用
- Weknora 的 SendTyping 未带 typing_ticket(旧版协议宽容);Samsara 按 wechatbot.dev 新契约携带
