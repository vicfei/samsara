# Samsara 项目交接 Prompt(2026-10-06)

> 你是 Samsara 项目的开发 agent,工作目录 `/home/ubuntu/Samsara`(新加坡节点 43.134.172.70)。前一会话完成了 M0→M1→M2 三个里程碑的核心工作。请先执行 `ls` 和 `git log --oneline -20` 了解当前状态，然后阅读 `.context/design/` 下的设计文档(尤其 `closure-ledger.yaml`——收敛账本，全部治理状态的机读事实来源)。

## 当前状态一句话

微信个人号 Bot 通道全链路已打通(用户在手机微信发消息 → DeepSeek 处理 → 回复送达微信)，系统在生产服务器上运行，79/79 测试全绿，GitHub 仓库 `vicfei/samsara`(public)。

## 里程碑完成情况

| 里程碑 | 状态 | 核心产出 |
|---|---|---|
| M0 内核 | ✅ 关闭 | Context/三分类效应/余效应/哈希链账本/快照+增量重放/效应重绑定/广义时间旅行(rollbackTo+redo) |
| M1 能跑 | ✅ 关闭 | ReAct 多轮回路(§5.1 五步)/WebChat 回环 HTTP/技能三件套(save/promote/read)/ReplayBundle 采集/Parquet 轨迹投影 |
| M2-S1 调度器 | ✅ | 自然语言→cron/HTTP 管理面/misfire 三态/实机自动触发 |
| M2-S2 工具 | ✅ | web_search(博查)/clock(soaks 发现的缺口) |
| M2-S4 微信渠道 | ✅ 全链路通 | iLink Bot API/QR 本地生成/长轮询收发/首次微信对话成功 |

## 技术栈与运行环境

- **语言**: TypeScript(Node 20),零外部运行时依赖(内核)+ better-sqlite3 + duckdb + cron-parser + qrcode
- **测试**: vitest + fast-check,`npm test` 运行，当前 79/79 全绿
- **LLM**: DeepSeek `deepseek-v4-flash`(`OPENAI_BASE_URL`/`OPENAI_MODEL` 环境变量)
- **搜索**: 博查(`BOCHA_API_KEY`)
- **凭据库**: `~/.samsara/credentials/providers.env`(0600)——`source` 后启动守护
- **守护进程**: `npm run cli -- webchat`(常驻，Ctrl-C 优雅关停+投影对账)
- **CLI**: `samsara run "任务"` / `samsara webchat` / `samsara job add|ls|...` / `samsara wechat bind|status` / `samsara doctor`
- **GitHub**: `https://github.com/vicfei/samsara`(public),PAT 在 `~/.git-credentials`(HTTPS,git credential-store)

## 微信 iLink 渠道(刚打通，调试日志还开着)

关键契约(Weknora 源码 + wechatbot.dev 文档确认):
- 必需 Headers: `AuthorizationType: ilink_bot_token` + `X-WECHAT-UIN`(base64 随机)
- getupdates 请求体: `{get_updates_buf, base_info:{channel_version}}`(不是 `{timeout}`)
- 消息文本在 `item_list[0].text_item.text`(不是 `content`)
- sendmessage 必须回传 `context_token`(消息串线)
- 首次 getupdates 的 `get_updates_buf` 为空字符串
- Token 失效(errcode -14)→ 需重新扫码绑定

`src/channel/wechat-ilink.ts` 中的调试日志(`[wechat-poll]`/`[wechat-dispatch]`/`[wechat-send]`)验证通过后可移除或降为 DEBUG 级。

## 治理体系(每次变更必须走)

1. **四份设计文档** `.context/design/`:主文档(v0.20)+ 接口(v1.3)+ 数据模型(v1.3)+ 功能(v1.1)
2. **收敛账本** `closure-ledger.yaml`:75 条 = 58 written-back / 14 verified / 3 designed(P2-P4 待做)
3. **常量注册表** `spec-constants.yaml`:39 个常量，`freeze_check.py` 验证 authority 可达+字面量匹配(单位规范化)
4. **冻结检查器** `tools/freeze_check.py` + `tools/ledger_assert.py`:每次文档变更后必须双绿
5. **代码变更流程**: 实现 → 测试全绿 → 文档回写(账本批次) → 治理工具双绿 → commit → push

## 下一步工作(按优先级)

1. **M2-S3 记忆层**(§6.5 三层记忆):embedding 召回(DashScope text-embedding-v4,1024 维)+ rerank 重排(qwen3-rerank)→ 会话收尾情景提炼 → 语义记忆闸门写入 → 上下文注入。凭据已在 providers.env。
2. **微信渠道收尾**: 移除调试日志/补 typing 指示(getconfig+sendtyping)/媒体消息(CDN+AES-128-ECB)/context_token 持久化(跨重启)
3. **M2-S5 信任栈**: K.4 渠道对端信任派生(allowlist)——微信渠道的 owner allowlist 一行配置
4. **M2-S6 Worker 隔离**(K.3): 外部插件进场前必须(ModelScope MCP 是首个检疫对象)
5. **M2-S7 模型注册表**(E.1): 多厂商密钥管理/价格表/M4 路由打基础

## 凭据(已在服务器上，不要打印/commit)

```bash
# 使用时 source,不要 cat/echo
source ~/.samsara/credentials/providers.env
# 包含: OPENAI_API_KEY(DeepSeek), DASHSCOPE_API_KEY(embedding+rerank),
#        BOCHA_API_KEY(搜索), PRIVORA_TOKEN(知识摄取), MODELSCOPE_MCP_TOKEN
# 微信 bot_token 在 ~/.samsara/credentials/wechat-ilink.json(0600)
```

## 快速命令

```bash
npm test                                    # 79/79 全绿
npm run demo                                # 7 段内核能力演示
npm run cli -- run "任务"                    # 单轮任务(mock 或 DeepSeek)
npm run cli -- webchat                       # 守护进程(WebChat+调度器+微信)
npm run cli -- doctor                        # 账本/CAS/投影/Parquet 对账
npm run cli -- wechat status                 # 微信绑定状态
npm run soak                                 # 34 任务真实负载压测
cd .context/design && python3 tools/freeze_check.py && python3 tools/ledger_assert.py  # 治理双门槛
```

## 注意事项

1. **不要打印/commit 任何凭据**(PAT、API key、bot_token)
2. **文档变更必须走账本批次**(参考 closure-ledger.yaml 的批次格式)
3. **测试必须全绿才 commit**(时序抖动的 scheduler 用例偶尔超窗，重跑一次即可)
4. **守护进程操作**: 杀进程和启动分开两个命令(避免 pkill 自杀问题)；用 `pkill -f "[w]ebchat"` (方括号正则防自匹配)
5. **微信调试**: 守护日志在 `/tmp/samsara-webchat.log`,微信相关行 `grep wechat /tmp/samsara-webchat.log`
