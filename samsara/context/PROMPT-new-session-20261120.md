# 新会话交接 Prompt（2026-11-20 · singapore 主开发窗口）

你是 vicfei 舰队 singapore 节点的主开发 zcode 会话。开工前先读 `~/protocol/COORDINATION.md`；长期记忆已在本项目 memory 目录（会自动加载索引），本 prompt 只补**会话态**。

## 你是谁、在干什么

- 主产品 **dsh-super-agent**（npm `@vicfei/dsh-super-agent`，**v1.8.0 已上线**）+ 周边：dsh-agentdiary-plugin 0.2.1 / dsh-evidence-plugin 0.2.1 / @vicfei/agentdiary CLI 0.1.0（全部 npm live）+ **awesome-agent-stack**（公开地图仓，44 条目，心跳已闭环）
- 今天刚打完的仗：v1.8「the witnessed grant」当日全链（PR #143-#151 全合并）——fleet 面板、review 纪元化 negatives、judge 健康行、微信重登复活（GET/POST bug 修复）、atlas 心跳（Actions→PR→人审→账本）+ 引擎看门狗、竞品尸检（LofiSu 134★ vs 我们 26★ = 分发差距）、主页化妆（PR #150，备份在分支 homepage-backup-20261119 + brainvault，owner 满意当前状态可回滚）

## 立即要查的三件事（隔夜自证）

1. **微信出站回流证明**：`sqlite3 ~/.config/dsh/dogfood/engine.db "SELECT created_at,status FROM effect WHERE kind='reply' ORDER BY id DESC LIMIT 3"` —— 应有 11-20 之后的新行（晨报投递）；`tail ~/.config/dsh/wechat-health.log` 应恢复逐日追加
2. **atlas 看门狗首值守**（每日 10:20 UTC）：fleet-reports 引擎 watch.log 里 atlas-heartbeat-watchdog 应有 "heartbeat fresh" 行；若 STALL 则按 reports 仓的升级报告处理
3. **growth.log** star 日线是否恢复（修过 PATH）

## 已批准的队列（按序执行）

1. **P1 v1.9 追赶阶段**（ROADMAP.md 已有全量四阶段计划，PR #151）：人格文件系统（persona/ 九文件组合进 worker prompt）→ CLI 交互通道（第六通道走准入表）→ token 门禁 panel；~1 周，完成即 v1.9.0
2. **发射**：`~/brainvault/dsh-super-agent/LAUNCH-KIT.md` 全备——中文主帖（微信实录图开场）、Show HN、X 13 节线、awesome-PR 批次（含 e2b 腐烂正主继承线）、D0-D7 时序、三条红线。**只差 owner 定日期**；P3（A2A 委托边治理）设计文档随 v1.9 同批出，当发射帖 roadmap 预告
3. **A4 GRANT 仪式**：dogfood 面板（127.0.0.1:8799）现行纪元 im_dm 影子攒够时提示 owner 亲手按 🔧 GRANT——`policy.rung` 落账行是发射二波素材

## 环境态

- 四引擎全跑 1.8.0（仓库检出）：dogfood:8799（observe/policy v9/微信源已武装）、deepseek-bot:8798、harness-native:8797、fleet-reports:8796（policy v4 含四例程）；**舰队面板 8795**（`dsh fleet` 进程，若挂了重启命令在 dsh-super-agent 里）
- 引擎停启纪律：SIGTERM 优雅退出（1.8 代码正常），port 检查后再 start.sh；credential 永不入仓（但零脱敏最终裁定：舰队仓不脱敏，永不重议）
- npm 发布：**每次先 `npm login`（网页授权，token 寿命约一天），多包攒同一窗口**；各仓已有 registry 覆盖 .npmrc
- 本节点 3.6GB 内存：DSH web 构建类重活派 win11；无头截图用 playwright-core + 预装 headless shell（memory 有路径）
- 今日日志写 `~/worklog/log/2026-11/2026-11-20-singapore.md` + `~/sessionlog/sessions/2026-11/2026-11-20-singapore.md` 双写，收尾推送

## 勿动/勿议

- 主页不再大改（owner 满意，已备份）；不刷星、不贬对手（LAUNCH-KIT 红线）
- WeKnora/neo4j 清理仍待 owner 裁决；wechat ret=-2 已结案（实为凭据 11-10 过期，已重登）

第一步：先跑上面"隔夜自证"三查并汇报结果，然后默认开工 P1-1（人格文件系统）。
