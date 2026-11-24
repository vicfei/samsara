# 新会话交接 Prompt（2026-11-24 · singapore 主开发窗口 · Phase 3 slice 4+5 续作）

【启动块·勿改】开工第一步，按序读完再动手：
1. https://github.com/vicfei/protocol 的 COORDINATION.md（协同拓扑）与 DISCIPLINES.md（行为纪律，含钟源纪律）——本节点有 protocol 克隆则读本地
2. 本项目仓库根 AGENTS.md 的"项目纪律"节（如有）
3. 钟源规则即刻生效：相对时间词出口前先跑 date 核对，交付物一律绝对日期
4. 任务收官按 COORDINATION 准则双写 sessionlog / worklog 并 push
5. 第一句回"交接收到"并复述：<dsh v2.0.0 / 端口 8795-8799 + A2A 计划 8791 / 默认任务 Phase 3 slice 4>

## 你是谁、在干什么

你是 vicfei 舰队 singapore 节点的主开发 zcode 会话。主产品 **dsh-super-agent 刚发 v2.0.0**（2026-11-23，"the delegation-edge release"），本窗口任务 = **Phase 3 slice 4（节点间执行器）+ slice 5（面板树视图）**，设计真相源 `docs/designs/delegation-governance.md`（Part 1 出站"Delegation as a ticket" + Implementation slices 清单）。

## 刚发生的事（本窗口闭环，均已入 main/npm）

- **Phase 3 slices 1-3 已合并发布**：A2A 通道 #177（`0a31d4e`：Agent Card+message/send→a2a scope 过准入+push-buffer Source+relay+状态端点）、子工单 #178（`37f620c`：parent_ticket_id 幂等迁移、createChildTickets 继承父准入、waiting-children 排除声明、末子结算父单自动完成、子失败/停止→父 needs-person）、v2.0.0 #179（`446b88f`，npm live）。测试 450/450。
- **关键设计已锁定**：A2A_TOKEN=传输层响亮必填；agent 身份在 `policy.a2a.allowedAgents`（与人类 allowedList 分列，gate.ts 有 scoped lookup）；未列名 caller 照收照闸（证据而非传输层执法）；子工单深度帽=1（子不能再生子）。
- **agentdiary 插件线**：P0-P3 全落地——EventSource 接缝+OAR 适配器（0.3.0）、JSONL 轨迹+七族敏感扫描（0.4.0）、CLI week 命令；**owner 已手动发布 0.3.0/0.4.0**（npm live）。dsh-evidence-plugin 同构改造已合并（0.3.0），**发布待 owner**：`cd ~/dsh-evidence-plugin && npm publish`。
- **reports 线**：11-16~22 七日报+W47 周报已合并（PR #9）。
- **飞书备台**：`~/.config/dsh/feishu-test/`（8794，observe，secret.env 空）——owner 令跳过，留存。

## 立即要做的两件事（按序）

### Slice 4 — A2A 执行器子工单（节点间）

现状：slices 1-3 的子工单只用本地 executor。slice 4 = 子工单的执行器是 **A2A 客户端**——父引擎向远端节点的 A2A 端点发 `message/send`，子工单追踪远端任务直至终态。

1. **前置检查**：`tailscale status`（SG 上看四节点是否已组网）——Tailscale 未部署则先停下与 owner 协调（wsl2/win11 在 NAT 后正是它的主场）；上海节点注意时钟漂移史（protocol COORDINATION 已记）。
2. **实现建议（设计文档 Part 2 的落地形态）**：
   - `dsh a2a send` CLI 子命令 = 瘦 A2A 客户端（--url 端点 --token --prompt-file --wait：POST message/send → 轮询 tasks/<id> 至终态 → 打印报告）。保持"任意 CLI 即 worker"的抽象，引擎零手术。
   - `delegate.md` 加可选 `node:` 字段；`policy.teams.endpoints`（node→URL 映射）+ executor 侧把 DSH_TARGET_NODE 传给命令模板——子工单按节点路由。
   - 测试：本地起假 A2A 服务端扮演远端，e2e 验父委托→远端任务→报告回传→父完成。
3. **fleet dogfood**：singapore ↔ wsl2 首对（设计文档既定）；wsl2 的 A2A 端点就是它自己的 watch 引擎。

### Slice 5 — 面板树视图（纯 UI，引擎数据已备）

- `ticket.parent_ticket_id` 已在库、`waiting-children` 阶段已存在；`TicketView` 加 `parent?: number`（engine.tickets() 映射带出）。
- panel.html：子工单缩进挂在父单下（树形分组）+ waiting-children 徽章；`dsh tickets` CLI 输出加 `parent=#N` 后缀。
- 账本侧零改动（`ticket.delegated`/`ticket.child-failed` 已在流里）。

## 已批准队列（后续）

1. slice 4+5 完成 → 发 v2.0.1 或按 owner 意见并窗
2. 四引擎升级 1.8.0 → 2.0.0（owner 决定时机；停/启两条命令纪律）
3. PR 监控 dogfood 一期（评估已过，`~/dsh-pr-monitor-evaluation.md`，待 owner 批）
4. evidence-plugin 0.3.0 发布（owner 手动，见上）
5. 发射：LAUNCH-KIT 就绪，v2.0.0 的委托边治理 = 发射帖最强论题兑现

## 环境态

- dsh-super-agent main = 2.0.0（`446b88f`）；四引擎跑 1.8.0 检出（dogfood 8799 / bot 8798 / harness-native 8797 / fleet-reports 8796 / 舰队面板 8795；A2A 计划 8791；飞书台 8794）
- npm 三课已入档：**duplicate-version 错误=发布真相**（CDN 假 404 连续两案）；用户级 ~/.npmrc registry=腾讯镜像，per-repo .npmrc 只在仓目录生效；npm 新政发布需点 "Authenticate your account" 链接
- SG 3.6G 内存：禁重型 ML（11-16 OOM 教训）；重活派 win11；pkill 用字符类防自匹配（'npm[ ]login' 式）
- 今日日志：`~/worklog/log/2026-11/2026-11-24-singapore.md` + sessionlog 双写

## 勿动/勿议

- protocol PR #5（DISCIPLINES.md）待 owner 合——不催不改；本地 disciplines 分支已有内容可读
- agentdiary CLI PR #1（week 命令）待 owner 审
- 主页不折腾；不刷星不贬对手（LAUNCH-KIT 红线）；WeKnora/neo4j 清理待 owner

第一步：跑启动块 → 复述 → `tailscale status` 检查 + 重读设计文档 slices 清单 → 开工 slice 4。
