# 新会话交接卡（瘦身版）

> 全局纪律不写在卡里——开工先读 https://github.com/vicfei/protocol 的 `COORDINATION.md` 并遵守。
> 本卡只承载任务上下文。

## 任务上下文

- 本窗口职责：dsh 主线工程（Road-to-Auto 阻塞修复 + 报告引擎）+ 舰队协议维护（singapore 节点主开发窗口，node=singapore，window=sg-main-dev）。
- 当前状态：npm `@vicfei/dsh-super-agent` latest = **1.5.0**（349/349）；main 干净；三引擎在线 8799 狗粮（observe/v8）/ 8798 deepseek-bot（auto）/ 8797 harness-native（auto）；**四仓舰队系统已上线**（protocol/sessionlog/reports/brainvault + worklog，三节点接入，零脱敏终裁已五仓对齐）；Road-to-Auto 评估回顾已完成——评估层健康，狗粮开 auto 剩 4 个可修阻塞（微信 ret=-2 / report promote 语义 / node_modules 软链泄漏 / engine.boot 账本事件）；微信观察线每日统计已挂 cron（输出 `~/.config/dsh/wechat-health.log`）。
- 下一步队列：主线 #1 两卫生 PR（若 main 上已见 `engine.boot` 与软链剥离则跳过）→ #2 **报告引擎 v1**（auto 模式 + PR-only 交付，绕开微信与 promote 两个阻塞；验收 = 第一份自动周报 PR 进 vicfei/reports；四仓契约见 protocol 的 report-templates.yaml）→ #3 report promote 语义。运营线（LAUNCH-KIT 刷 1.5.0/349、发帖三件套拿 Paseo 当参照系、awesome 补 Paseo 条目）由 owner 指挥各窗口推进，不归本窗口。
- 本项目边界令摘引：永不直推 main（分支→英文 PR→CI 轮询到绿→squash 合并）；issue/PR 全英文；commit author 一律 `git -c user.name="VicFei" -c user.email="cnfeichen@163.com"`；token 永不打印/提交；`pkill -f "[b]racket]"` 模式且单独成条；npm 一律 `--registry=https://registry.npmjs.org`；~/.git-credentials 保留永不建议删；help 文案在 src/usage.ts；policy.json 改动必递增 version；引擎 DB 手工写入先停守护、requeue 时间戳必须 ISO；重启口诀 kill→轮询端口全释放→拉起（`ss -ltn` 确认）；舰队日志零脱敏（owner 终裁 2026-11-10，勿复议）；接管/停单走 `dsh tickets stop`（接管留言不生效）。
- **第一句话请回**："交接收到"并复述：当前 npm 版本、三引擎端口、下一步默认任务。
