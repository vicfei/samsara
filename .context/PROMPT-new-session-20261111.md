# 新会话交接 Prompt(2026-11-11 生成)

> 粘贴给新窗口的第一条消息。配套存档:本文件 + `~/launch-assets/LAUNCH-KIT.md` + `~/dsh-promo-upload/video-mechanism-notes.md` + 记忆库(自动加载)。

---

我是 vicfei(陈飞),vicfei/dsh-super-agent 的 owner。你是本节点(/home/ubuntu)的主开发会话,从上一窗口无缝接手。以下是全部上下文与铁律。

## 一、项目一句话与当前位置

**dsh-super-agent**:准入控制 + 观察模式 + 工单编排,给任意 CLI 编码智能体——DeepSeek Super-agent 设计的独立实现。北极星:**占据"信任轴线"——agent 用可验证的证据赢得自主**。

- **npm latest = 1.5.0**(the evidence ledger release,tag v1.5.0,OIDC 发布已验证),测试 **349/349**
- v1.5 三件套已上线:哈希链证据账本(`dsh events tail|verify`)+ 订阅流(`/api/events` + kv 头锚)+ 零依赖拓扑 SVG(#122/#123/#124)
- 近期已合:scope 伦理进 prompt(#120)、双语回复 DSH_LOCALE=zh(#121)、NaN 位点修复(#113)、按 assignment 重画审批(#116)、PR 标题卫生(#115)、COOKBOOK(#117)
- 开放 issue:**无**(110/112/114/119 全闭)

## 二、铁律(违者返工)

1. **永远不直接提交 main**:分支 → 英文 PR → **CI 轮询到终态(pass)后** → squash 合并(纯文档也一样)。两次抢跑教训:pending 时 merge 侥幸双绿,不许再犯。
2. issue/PR 全英文;README.md 与 README.zh-CN.md **双语同步**。
3. commit author 一律 `git -c user.name="VicFei" -c user.email="cnfeichen@163.com"`(仓库史实)。
4. token/密钥**永不打印、永不提交**;PAT 只经变量传递。
5. `pkill -f "[b]racket]"` 模式且**单独成条命令**(复合命令含原文会自杀)。
6. npm 一律 `--registry=https://registry.npmjs.org`。
7. **~/.git-credentials 保留,永不建议删除**(owner 明示)。
8. 对外内容无 AI 署名字样;发版预检:pack 审文件清单 + 干净目录装 tgz 跑 bin。
9. help/usage 文案在 **src/usage.ts**(不在 cli.ts)。
10. 狗粮策略文件是 **version 门控**装载:改 policy.json 必递增 version,否则守护进程静默沿用旧策略。

## 三、三引擎运行中(重启过即跑 1.5.0 代码)

| 引擎 | 目录 | 面板 | 模式 | 备注 |
|---|---|---|---|---|
| dsh 主仓狗粮 | ~/.config/dsh/dogfood/ | 8799 | observe,spec on,memory on,DSH_LOCALE=zh | cron 已回 `0 8 * * 1-5`(Asia/Shanghai);微信 ClawBot 已说中文 |
| deepseek-bot | ~/.config/dsh/deepseek-bot/ | 8798 | auto,memory on | 位点已预置(旧仓库必须 seed,见 COOKBOOK §7) |
| harness-native(Rust) | ~/.config/dsh/harness-native/ | 8797 | auto | worker 支持 cargo 三件套 |

- **共享 BYOM worker**:`~/.config/dsh/worker-llm.py`——整文件 ```file 块交付(diff 一律拒收)、READ 探索循环、测试门禁红=exit 3 不交付、node_modules 软链 / PYTHONPATH=src、FAILTEST 钩子。flash 级 worker **必然跳过写测试**,由运营侧补(固定分工)。
- 守护进程重启口诀:kill → **轮询端口全释放**(SIGTERM 是优雅退出,会等当前周期/worker 跑完,EADDRINUSE 竞态高发)→ 再拉起。
- GitHub App `vicfei-dsh-agent`(id 5592553)已装三仓;bot 贡献记分牌:**2 仓真实合并**(deepseek-bot PR #109 生产验证;harness-native PR #4 SSE 字节上限)。

## 四、下一步队列(优先级从上到下)

1. **默认先做:评估质量回顾**——用狗粮 DB 复盘 would-accept 假阳/假阴 + memory 的 would-inject 候选质量 → 决定 dsh 主仓狗粮何时逐档开 auto(**Road-to-Auto 战役**,产出"自动运行零事故"证据,无人能跟的帖素材)。
2. **v1.6(M16,未立项)**:可编辑 prompt 覆盖系统(三个 team 段 + 升级感知 diff,原型最大遗漏)、订阅生命周期补全(merged-PR 线程按原 mandate 恢复、显式 unsubscribe)、few-settings 回扫(旋钮瘦身为默认值)。
3. 运营:发帖值守(用户已发三件套;最后核对 18★/3fork,盯 issue 草英文回复);**LAUNCH-KIT 数字已过期(还是 1.4.0/337),下次发帖前刷到 1.5.0/349**;awesome-super-agent 维护 PR(免费入口流量);三仓题库随时接单(harness-native P4 题库就绪)。
4. Telegram:owner 无法注册,**留给未来用户实测反馈**(代码 v0.8.1 就绪,只差 TELEGRAM_BOT_TOKEN)。
5. WORKER_MODEL 升档(flash→deepseek-v4):触发条件=下一单需要啃 #106 类内核任务。
6. 中文物料归 WSL2 节点(banner 保持用户喜欢的原图;视频走裸 URL 协议,见 video-mechanism-notes.md)。

## 五、跨节点协作协议(经用户带话)

- **deepseek-bot 主窗口 / harness-native 主窗口**:最了解各自代码库,按协议出"包络内"工单(单/少文件、机械、测试可自证、每行核过现行代码);watch 接单 → worker 交付 → 运营补测试 → 主窗口人审合并 → 反馈回流根治(格式:验证 SOP 进 worker 层、标题规范进引擎层)。
- 竞品快照(2026-11-10):官方原型 **21.7k★ 但冻结**(单提交);对头 **thefullgc/opensuperagent**(51★,事件溯源+Web 拓扑,轴线错位);dsh-im 3.4k★(渠道侧吸流量);**awesome-super-agent 实时逐提交跟踪我们**(连"这次没有重跑"都记——发布要带测试证据)。

## 六、地雷清单(全部踩过)

- GitHub README 视频:只认**裸 user-attachments URL**(管线才改写成可播 src);cancel 编辑=上传作废必须 commit;blob 页对 mp4 一律无播放器;mp4 提交须 644。
- 视觉审计:prompt 必须无引导(会把预期内容转写进结果);数字结论先做墨迹宽度/md5 级核验;存疑要渲染源举证。
- worktree 陷阱:无 node_modules(软链主仓);Python editable 安装会让 worktree 测错代码(PYTHONPATH 前置)。
- 引擎 DB 手工写入前停守护进程;requeue 时间戳必须 ISO 格式(`strftime('%Y-%m-%dT%H:%M:%fZ','now')`)。
- 微信:iLink 心跳保活;ret=-2 自愈;明早 08:00 工作日 cron 是发送验证点。
- 拉起前先 `ss -ltn` 确认端口空闲;三个 start.sh 都 export 了 ASSESS_*/WORKER_*/DSH_LOCALE(密钥在文件里,700 权限,不外泄)。

## 七、文件地图

仓库 /home/ubuntu/dsh-super-agent(main);三引擎配置 ~/.config/dsh/{dogfood,deepseek-bot,harness-native}/;worker ~/.config/dsh/worker-llm.py;App 私钥 ~/.config/dsh/vicfei-dsh-agent.private-key.pem(+ ~/.config/dsh/env);LAUNCH-KIT ~/launch-assets/;视频/物料笔记 ~/dsh-promo-upload/;本交接 /home/ubuntu/Samsara/.context/PROMPT-new-session-20261111.md。

**第一句话请回:"交接收到"并复述:当前 npm 版本、三引擎端口、下一步默认任务。**
