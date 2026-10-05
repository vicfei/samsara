# Samsara 接口设计文档

> 版本：v1.2（评审修订批次四）
> 配套文档：《Samsara 项目开发文档》v0.16（§3 内核抽象、§4.5 协议、§9 API 草案、附录 B/C/E/G）、《Samsara 数据模型设计文档》v1.2。
> 定位：所有接口的**契约级事实来源**——帧格式、方法签名、事件目录、错误码、SDK 接口，细化到可直接编码。
> 约定：JSON 字段蛇形；时间 UTC ISO8601；ID 用 ULID（带前缀，如 `ag_`、`tr_`、`fx_`）；金额用整数美分。

---

## 目录

1. 设计原则
2. 控制面 WebSocket 协议
3. 核心方法（Methods）
4. 事件目录（Events）
5. 插件 SDK 接口
6. 领域契约 Schema
7. CLI 接口
8. 错误码
9. 版本与兼容性
10. 鉴权与信任矩阵速查

---

# 1. 设计原则

1. **单通道**：客户端、节点、内部消费端共用一套 WS 协议（角色区分）；
2. **幂等优先**：一切有副作用的方法强制幂等键；
3. **信任随行**：每个请求解析出信任级，响应与能力按信任级裁剪；
4. **契约化**：跨层数据一律带 schema 版本号；错误是类型化的，不是自由文本；
5. **可审计**：所有方法调用与响应摘要自动入账本，接口层不另设审计开关。

---

# 2. 控制面 WebSocket 协议

## 2.1 连接与握手

```
端点：ws://127.0.0.1:18789/gw（默认仅回环；远程经 Tailscale/SSH 隧道）
首帧必须是 hello，否则硬关闭。

→ {type:"hello", proto:"samsara/1", auth:{token:"…"},
   device:{id:"dev_mbpro", platform:"macos", sig:"<挑战签名>"},
   role:"client|node|lane", caps:[…]}
← {type:"hello-ok", session_ticket:"st_…", trust_level:"owner",
   ledger_seq:10492, server_time:"…", mode_defaults:{…}}
← {type:"hello-err", error:{code:"AUTH_FAILED", message:"…"}}  （随后关闭）
```

- 配对审批：未知 device_id 进入 `pending`，owner 经 `device.approve` 批准后下发设备令牌；本地回环可自动批准；
- 心跳：30s ping/pong，90s 无心跳断开；
- 角色说明：`lane`（内部会话消费端）是**进程内逻辑角色**，不是独立部署单元；多机分布属附录 G 阶段二议题（MIN5）。

**lane 分配规则（GAP9）**：
- lane 数量 = `min(CPU 核数, 8)`，守护进程启动时确定，运行期不增减（增减会打破同 lane 串行证明）；
- 映射 = `lane_i = hash(session_key) mod N`（一致性哈希无必要——lane 不迁移）；
- **同一 session_key 永远落在同一 lane**，lane 内严格串行消费 → INV-4（单一写者）在会话粒度天然成立，无需分布式锁；
- lane 只保证"同会话串行"，跨会话并行度由 lane 数决定；lane 积压深度入 `health.loop_score` 信号。

## 2.2 帧格式

```
请求  {type:"req", id:"r_…", method:"skill.promote", params:{…}, idempotency_key:"ik_…"}
响应  {type:"res", id:"r_…", ok:true, result:{…}}
      {type:"res", id:"r_…", ok:false, error:{code, message, retryable, details?}}
事件  {type:"event", event_seq:1234, event:"skill.promoted", payload:{…}}
推送  {type:"push", …}——即服务端主动 event，语义同上
```

- `idempotency_key`：副作用方法必需；**去重缓存落盘于 SQLite `idempotency_keys` 表（唯一索引，GAP8）**——崩溃重启后重试仍返回首个结果，副作用不重复执行；保留 24h；
- **序号命名空间（INC8）**：`event_seq` 为每连接事件序号（重连 `resume_from_seq` 补漏）；全局账本位置一律用 `ledger_seq`（如 `applied_at_ledger_seq`）；历史字段 `*_seq` 视作 ledger_seq 别名，新版本用全称；
- 单帧上限 1MB；大产物走 CAS 引用而非内联。

---

# 3. 核心方法（Methods）

> 信任要求列含义：执行该方法所需的最低信任级；R 级列含义：操作落账时的风险分级。

## 3.1 任务与会话

### agent.run
```json
请求: {"goal":"调研5家竞品定价","session_key":"telegram:dm:owner",
       "workspace_id":"ws_sh_01","budget":{"tokens":300000,"wall_ms":3600000},
       "allow_spawn":true,"r_ceiling":"R2","notification":"smart"}
响应: {"trace_id":"tr_01J…","status":"accepted","lane":"ln_7"}
异步: 进度经事件 agent.progress / agent.completed / agent.failed 推送
```
信任：guest+；R 级：按实际动作逐个判定。

### session.intervene（介入通道，附录 B.2）
```json
请求: {"session_key":"…","level":"queued|immediate|kill","message":"改用柱状图"}
响应: {"ok":true,"applied_at_seq":10501}
```
- `immediate`：回滚当前未完成工具调用至最近安全点后注入（INV-7）；
- 信任规则：owner 可介入任意会话；其余仅能介入自己的会话。

### session.history
```json
请求: {"session_key":"…","before_seq":10500,"limit":50}
响应: {"entries":[…], "has_more":true}
```
信任：owner 或同 key 持有者。**客户端不读本地会话文件，统一经此查询。**

### agent.kill
```json
请求: {"agent_id":"ag_01J…","reason":"…"}
响应: {"ok":true,"reverted_effects":12,"quota_returned":{"tokens":183000}}
```
信任：owner（或父 Agent 在自身配额内）；语义 = 按 owner 归属 LIFO 回滚（数据模型 A.2），资产留分支。

### channel.fallback_chain（K.8）
```json
请求: {"chain":["telegram","webchat","email"]}
响应: {"ok":true}
```
owner 级配置；渠道断开时在途消息先持久化再按链续投，无备选则恢复后续投。

## 3.2 技能与资产

| 方法 | 说明 | 信任 | R 级 |
|---|---|---|---|
| `skill.list` | 按 branch/status 过滤检索 | guest+ | — |
| `skill.get` | 取技能内容（含版本） | guest+ | — |
| `skill.promote` | 发起晋升管道。三类 actor 路径（INC5）：内部管道（Agent 自动发起）/ 本方法（owner 直接发起）/ known 的提案（仅入 review 队列） | owner | 按内容判定 |
| `skill.quarantine` | 手动隔离问题技能 | owner | R1 |
| `memory.list` | 按 sessionKey+layer 查询记忆条目（元数据） | owner / 本 key | — |
| `memory.forget` | 按 sessionKey+时段精确遗忘。INC4 裁决：owner 任意；**guest 可申请遗忘自己 sessionKey 的记忆**（数据主体权利，R2 留审计）；known 对他人仅提案权 | owner / 本 key(guest) | R2，托管期内可回滚 |
| `asset.get` | 按 cas_id 取任意资产 | guest+ | — |
| `asset.put` | 上传附件进 CAS（WebChat 文件上传路径），响应含 cas_id；>64MB 自动走旁路（K.7） | guest+ | — |
| `device.approve` | 配对审批：批准/拒绝 pending 设备 | owner（+设备签名） | R2 |

```json
skill.promote 响应: {"promotion_id":"pr_01J…","gate_stage":"lint"}
异步: skill.promoted / skill.quarantined / promotion.verdict
```

## 3.3 审批与介入（HITL）

| 方法 | 说明 |
|---|---|
| `review.pending` | 拉取待审队列（注意力路由器已排序） |
| `review.decide` | `{id, verdict:"approve|reject|edit", comment}` —— 生成 ReviewEvent |
| `review.summary` | 每日摘要（批量呈现用） |

渠道内审批等价物：按钮回调 `Callback(actionId, signedPayload, evidence)` → 内部转为 `review.decide`，**签名验证失败即拒绝并告警**。

## 3.4 系统与内核

| 方法 | 说明 | 信任 | 备注 |
|---|---|---|---|
| `system.rollback` | 回滚至指定账本 seq | owner | R4；回滚本身入账 |
| `system.snapshot` | 生成投影快照 | owner | — |
| `system.audit` | 账本区间校验与导出 | owner | 输出含哈希链证明 |
| `mode.set` | 切换权限模式 | owner | 时效见下表（**本节为唯一权威**，INC1） |
| `spawn` | 派生子 Agent | owner 默认 | 授权代数三条不等式服务端强制；**深度软限 3 / 硬顶 5**——超软限返回 `QUOTA.DEPTH_EXCEEDED`、需 owner 批准（批准记录落 review_events），硬顶不可逾越（INC3） |

**各模式时效权威表**（其余文档中数字均为示意）：

| 模式 | 默认时效 | 硬上限 | 备注 |
|---|---|---|---|
| plan / confirm / auto_edit | 会话存续期 | — | |
| full_access | **30 分钟** | **4 小时** | 姿态预设"效率优先"将其设为 4h（≤上限）；到期自动落回 auto_edit |

## 3.5 调度（附录 C）

| 方法 | 说明 |
|---|---|
| `job.create` | 自然语言或 cron；响应含编译后的 cron 与预估成本 |
| `job.list / job.pause / job.resume / job.delete` | |
| `job.renew` | 高危任务续期（R3+ 必须） |

> misfire 语义（GAP12）：`skip`=错过即弃；`runOnce`=恢复后补跑一次；`catchUp`=**仅补最近一次**（不逐次补齐，避免积压风暴）。

## 3.6 节点、工作区与信任边（附录 G）

| 方法 | 说明 | R 级 |
|---|---|---|
| `node.list / node.invoke` | 调用节点 caps；危险 cap 升档审批 | 按 cap |
| `workspace.create / bind` | 会话绑定工作区 | R1 |
| `trust.link / trust.unlink` | 节点信任边建立/撤销 | R2 / R4 |
| `mesh.transfer` | 跨节点数据传输登记（数据直连，事实入账） | R1 |

```json
trust.link 响应: {"edge_id":"te_01J…","state":"active","created_seq":10510}
```

## 3.7 影子验证与模型路由（附录 E、7.4）

| 方法 | 说明 |
|---|---|
| `shadow.compare` | 对打两个变体（variant vs baseline） |
| `router.explain` | 解释某任务为何路由到某模型（记分卡快照）——可解释性是信任前提 |
| `registry.refresh` | 重新拉取厂商模型清单与价格表 |

---

# 4. 事件目录（Events）

> 全部事件带 `event_seq` 与 `ts`；`priority: critical` 的事件绕过注意力路由器立即推送，其余走 smart 路由。

| 事件 | 载荷要点 | 优先级 |
|---|---|---|
| `session.message` | session_key, role, content_ref | normal |
| `agent.spawned / agent.progress / agent.completed / agent.failed / agent.terminated` | agent_id, parent_id, trace_id, outcome, cost | normal |
| `skill.created / skill.promoted / skill.quarantined / skill.stale / skill.archived` | cas_id, name, branch, provenance | normal |
| `promotion.verdict` | promotion_id, gate_stage, verdict | owner 可见 |
| `memory.forgotten` | 范围、条目数（不含内容本体） | normal |
| `job.fired / job.completed / job.missed` | job_id, misfire_action | normal |
| `shadow.verdict` | variant_cas, baseline_cas, metrics | normal |
| `rollback.performed` | from_seq → to_seq, effects_reverted | **critical** |
| `mode.changed` | session_key, mode, expires_at（升档必含操作者证据） | normal |
| `trust.linked / trust.unlinked / trust.fused` | edge_id, src, dst | **critical**（fused=熔断） |
| `trust.anchor_missing` | 锚点缺席时长、期望间隔（K.3 心跳语义：沉默=篡改） | **critical + 熔断通道** |
| `constitution.violation` | 试图触碰的 R5 对象、来源 | **critical + 硬熔断** |
| `health.loop_score` | 回路健康分（每日） | low |

## 4.1 事件可见性矩阵（GAP7）

> live 事件流不得成为绕过 `session.history` 访问控制的旁路。订阅时按角色 × 信任级裁剪：

| 事件类 | untrusted | guest | known | owner | node |
|---|---|---|---|---|---|
| 自己 sessionKey 的 session.message/agent.* | ❌ | ✅ 本会话 | ✅ 本会话 | ✅ 全部 | ❌ |
| 他人会话的任何事件 | ❌ | ❌ | ❌ | ✅ | ❌ |
| skill./promotion./memory.*（全局资产） | ❌ | 仅状态变更摘要 | ✅ | ✅ | ❌ |
| job./shadow./health.* | ❌ | ❌ | ✅ | ✅ | ❌ |
| rollback./trust./constitution.*（critical） | ❌ | ❌ | ✅（内容裁剪） | ✅ | 仅自身相关 |
| node.* | ❌ | ❌ | ❌ | ✅ | 仅自身 |

lane 角色只见自己消费车道的会话事件。矩阵由授权中间件表驱动实现，测试逐格覆盖。

---

# 5. 插件 SDK 接口

> 语言：TypeScript（M0 首选）；其余语言经 sidecar + gRPC 适配（二期）。

## 5.1 Context（一切插件的唯一入口）

```ts
interface Context {
  inject<T>(key: ServiceKey<T>): ServiceHandle<T>;          // 反应式依赖
  effect<T>(desc: string, apply: () => T | Promise<T>,
            revert: (t: T) => void | Promise<void>): EffectToken;
  provide<T>(key: ServiceKey<T>, impl: T): void;
  emit(evt: TypedEvent): void;
  on<T>(key: EventKey<T>, handler: (e: T) => void): Disposable;
  readonly trust: TrustLevel;      // 当前调用方信任级（只读）
  readonly budget: Budget;         // 剩余配额（只读）
}
```

**契约**：`apply` 后环境变更必须可被 `revert` 精确撤销——**destructive 类副作用除外**（K.1：不可逆操作走前置审批与补偿协议，不作 revert 语义承诺）；契约测试（3.4）强制。

## 5.2 渠道适配器

```ts
interface ChannelAdapter {
  readonly id: string;                       // "telegram"
  readonly caps: ChannelCaps;                // {richText, attachments, buttons, edit, streaming, voice}
  start(ctx: Context): Promise<void>;
  normalize(raw: unknown): InboundMessage;   // 入站：平台原生 → 内部富类型
  render(intent: OutboundIntent): PlatformPayload;  // 出站：富类型 → 平台载荷（含降级）
  deliver(p: PlatformPayload): Promise<Receipt>;
}

type InboundMessage =
  | {kind:"text", text:string}
  | {kind:"attachment", media:"image|audio|file|video", cas:string}
  | {kind:"callback", actionId:string, signedPayload:string, evidence:string}
  | {kind:"reaction", emoji:string, target:string};
```

## 5.3 判断提供者（JudgeProvider，附录 E.7）

```ts
interface JudgeProvider {
  choice(state: string, options: string[]): Promise<{pick: string; confidence: number}>;
  score(state: string, rubric: string): Promise<{value: number; confidence: number}>;
  noul(state: string, claim: string): Promise<number>;   // 概率 0–1
}
```
实现分期：一期 LLM+结构化输出 → 二期蒸馏小分类器 → 三期 Jev 类服务；切换经影子验证对打。

## 5.4 工具与 MCP

```ts
interface ToolPlugin {
  name: string; description: string;        // description ≤ 500 字符（防投毒）
  sideEffect: "none"|"read"|"write"|"destructive";  // 决定默认 R 级与沙箱级；K.1 可逆性绑定：none/read=可逆，write=可补偿（须携带补偿协议），destructive=不可逆（须前置审批，不适用 revert 承诺）
  sandbox: "S0"|"S1"|"S2"|"S3";
  schema: JsonSchema;                       // 参数契约
  run(args: unknown, ctx: Context): Promise<ToolResult>;
}
```
MCP server 经适配器包装为 ToolPlugin 集合；新工具默认 `quarantined`。

## 5.5 观测导出器（D.4）

```ts
interface ExporterPlugin {
  onTrace(t: TraceEvent): void;             // 单向只读；无回写方法
}
```

## 5.6 节点能力（Node caps）

```ts
interface NodeProvider {
  caps: Cap[];                               // 如 screen.capture / shell.exec / fs.read
  invoke(cap: string, args: unknown): Promise<unknown>;
}
```
危险 cap（shell.exec、fs.write 全局路径）触发审批升档；`mesh.transfer` 走信任边登记。

**cap → R 级默认映射表（GAP10，声明式配置，可被工作区 trust_ceiling 收紧、不可放宽）**：

| cap 类别 | 示例 | 默认 R 级 | 审批要求 |
|---|---|---|---|
| 只读感知 | fs.read、screen.capture（本地）、web.fetch | R0 | 无 |
| 工作区内写 | fs.write（workspace 内）、shell.exec（白名单命令） | R1 | 按当前权限模式 |
| 工作区外写 / 任意 shell | fs.write 全局路径、shell.exec 任意命令 | R2 | confirm 模式以上逐次确认 |
| 外发通信 | net.send、channel.broadcast、email.send | R3 | 审批队列 + 入账 |
| 跨节点登记 | mesh.transfer（数据直连，事实入账，G.4"登记是轻操作"） | R1 | 信任边存在 + 登记入账 |
| 跨节点执行 | node.invoke（远程） | R2 | 信任边存在 + 按目标 cap 升档审批 |
| 不可逆破坏 | fs.delete 非回收站、db.drop | R4 | 双人复核 + 前置审批（K.1 第三类） |

新 cap 注册未声明类别时**默认落入最高档 R4**（宁严勿宽），owner 可显式降级并留审计。

---

# 6. 领域契约 Schema

## 6.1 轨迹（Trace）

```json
{"trace_id":"tr_…","session_key":"…","agent_id":"ag_…","parent_trace":null,
 "skills_loaded":["skill://web-research@v3"],
 "steps":[{"no":1,"kind":"tool","name":"web_search","ok":true,"ms":1240,"tokens":830}],
 "outcome":"success|failure|aborted","failure_analysis":null,
 "cost":{"tokens":48210,"usd_cents":31},"duration_ms":184000,
 "replay_bundle_cas":"sha256:…",
 "task_cluster":"research.multi_source","schema":"samsara-trace/1"}
```

- `replay_bundle_cas`（K.5，M1 起采集）：指向 CAS 中的重放包（提示词快照、工具返回、随机种子、环境摘要）；单步 >10MB 截断为 partial 并标记；写入前过脱敏闸。影子验证与技能晋升的评审重放均依赖此字段，缺失即视为不可晋升证据。

## 6.2 审批请求（ReviewItem）

```json
{"id":"pr_…","kind":"skill.promote|workflow.change|job.create|mode.raise",
 "r_level":"R3","diff_cas":"sha256:…","blast_radius":{"dependents":4},
 "provenance":{"trace_id":"tr_…","actor_trust":"owner"},
 "router_hint":{"rank":1,"reason":"爆炸半径大，排摘要首位"}}
```

## 6.3 类型化错误（节点间/层间契约，附录 F.8）

```json
{"error":{"code":"NODE_ENV_DRIFT","retryable":true,
          "fallback":"skill-mode","details":{"node":"export","expected":"…"}}}
```
规则：错误必须带 `code`（枚举）与 `retryable`；禁止返回自由文本让上层猜（防死循环，主文档 F.8）。

---

# 7. CLI 接口

> CLI 是 WS 协议的一个 client 角色实现；所有命令幂等、可脚本化（`--json` 输出）。

```bash
# 守护与状态
samsara daemon start|stop|status          # 运行时管理
samsara doctor                             # 自检（账本校验、宪法层哈希、渠道连通）

# 渠道与节点
samsara channels add telegram|webchat|…    # 热插渠道（R4）
samsara nodes ls                           # 节点与 caps
samsara trust link <a> <b>                 # 建立信任边（R2）
samsara trust unlink <a> <b>               # 撤销（R4）

# 会话与任务
samsara run "调研5家竞品定价" --workspace ws_sh_01
samsara intervene <session> "改用柱状图" --immediate
samsara kill <agent_id>

# 资产与审批
samsara skills ls [--stale|--quarantined]
samsara promote <skill>                    # 发起晋升
samsara review ls | approve <id> | reject <id>

# 调度
samsara job add "每周五9点出周报" --r R2
samsara job ls --cost                      # 含月度预算消耗

# 系统
samsara rollback --to <seq>                # R4，双人复核
samsara audit ledger --since 7d --out report.html
samsara mode set auto_edit --session telegram:dm:owner
samsara router explain <trace_id>
```

---

# 8. 错误码

> 三段式：`域.类别.具体`；`retryable` 字段独立标示。全表入 SDK 常量，禁止自由文本。

| 域 | 示例 | 含义 |
|---|---|---|
| `AUTH.*` | `AUTH.TOKEN_INVALID`、`AUTH.PAIRING_REQUIRED`、`AUTH.TRUST_INSUFFICIENT` | 信任栈三层各自失败 |
| `GATE.*` | `GATE.R_LEVEL_DENIED`、`GATE.QUORUM_REQUIRED`（需双人）、`GATE.MODE_LOCKED` | 审批闸拒绝 |
| `LEDGER.*` | `LEDGER.SEQ_GAP`、`LEDGER.HASH_MISMATCH`（critical） | 账本完整性 |
| `QUOTA.*` | `QUOTA.BUDGET_EXHAUSTED`、`QUOTA.DEPTH_EXCEEDED`（>3 需批准） | 授权代数 |
| `NODE.*` | `NODE.UNREACHABLE`、`NODE.ENV_DRIFT`（retryable，触发 F.4 降级） | 节点与工作区 |
| `ASSET.*` | `ASSET.QUARANTINED`、`ASSET.SIZE_EXCEEDED`、`ASSET.CONFLICT_FORK` | 资产层 |
| `SHADOW.*` | `SHADOW.VERDICT_LOST`（对打失败，变体已自动卸载） | 影子验证 |
| `CONSTITUTION.VIOLATION` | 唯一无 retryable 的错误；触发硬熔断事件 | R5 |

---

# 9. 版本与兼容性

1. **协议版本**：`proto:"samsara/1"` 握手协商；breaking 变更升大版本，新旧并存至少一个里程碑；
2. **Schema 版本**：领域契约带 `schema:"samsara-trace/1"` 自描述头；只允许 additive 变更（加字段可，改语义开新版本）；
3. **插件 ABI**：SDK 以 semver 发布；插件清单声明 `abi: ">=1.0 <2.0"`，不兼容即拒绝加载（而非崩溃）；
4. **事件兼容**：新事件类型对旧订阅者透明（未知事件可安全忽略）；
5. **回滚与接口**：账本回滚不改变协议版本——协议演进与状态回滚正交。

---

# 10. 鉴权与信任矩阵速查

| 方法域 | untrusted | guest | known | owner |
|---|---|---|---|---|
| 只读检索（skill.list 等） | ✅（限公开） | ✅ | ✅ | ✅ |
| agent.run | ❌ | ✅（R0 封顶） | ✅（R1） | ✅ |
| 介入自己会话 | — | ✅ | ✅ | ✅ |
| 介入他人会话 | ❌ | ❌ | ❌ | ✅ |
| job.create（含外发） | ❌ | ❌ | ✅ | ✅ |
| skill.promote | ❌ | ❌ | 提案权（入 review 队列） | ✅ |
| memory.forget | ❌ | ✅（**仅自己 sessionKey**，INC4 裁决：数据主体权利，R2 留审计） | 提案权 | ✅ |
| trust.link / mode.set（升档） | ❌ | ❌ | ❌ | ✅（+设备签名） |
| system.rollback | ❌ | ❌ | ❌ | ✅（R4 双人复核） |
| R5 任何对象 | ❌ | ❌ | ❌ | ❌（含 owner——宪法层对所有人封闭） |

**矩阵即代码**：上表由授权中间件以声明式表驱动实现，测试用例逐格覆盖（主文档 §11）。

## 10.1 guest 默认预算与限流（GAP11）

> guest 是"能跑起来试一试"的最低门槛，不是免费午餐。默认值入 spec-constants 注册表：

| 项 | guest 默认 | known | owner |
|---|---|---|---|
| 单任务 token 预算 | 50,000 | 500,000 | 自设 |
| 并发会话 | 1 | 4 | 自设 |
| 速率 | 10 req/min，突发 3 | 60 req/min | 不限（仍入账） |
| R 级封顶 | R0（只读类副作用） | R1 | 无封顶 |
| spawn | ❌ | ✅（depth≤1） | ✅ |
| 存储配额（CAS+记忆） | 100MB，7 天保留 | 10GB | 自设 |

超限响应 `QUOTA.BUDGET_EXHAUSTED`（retryable=false）+ 提示升级路径；owner 可对特定 guest key 单独放宽（入账）。

---

# 附录：接口变更 RFC 模板（RM5）

接口契约变更一律走 RFC；RFC 与本文档同为 R3 级资产，进 review 队列（owner 批准）。

```
RFC 编号: RFC-YYYY-NNN
标题:
状态: draft → review → accepted|rejected → merged
作者 / 日期:
动机: （为什么非改不可；不改的代价）
变更范围: [ ] 方法  [ ] 事件  [ ] Schema  [ ] 错误码  [ ] 信任矩阵
兼容性: additive | breaking（breaking 必须给出迁移期 ≥1 个里程碑与废弃时间表）
受影响文档: [ ] 接口  [ ] 数据模型  [ ] 功能  [ ] 主文档
spec-constants 影响: （新增/修改常量及其 authority 归属）
验证计划: （契约测试用例清单）
回滚方案:
```

**变更日志**（倒序，合并时追加）：

| 版本 | 日期 | 变更 | RFC |
|---|---|---|---|
| 1.2 | 评审修订批次三/四 | spawn 行归位 §3.4 方法表 + 深度软限/硬顶完整表述；§5.6 跨节点拆档（mesh.transfer=R1 登记 / node.invoke=R2 远程执行）；§5.1 契约句 destructive 限定、§5.4 K.1 可逆性绑定；事件前言 seq→event_seq；版本头与 changelog 对齐纪律 | — |
| 1.1 | 评审修订批次二 | +agent.kill / channel.fallback_chain / asset.put / memory.list / device.approve；事件目录 +trust.anchor_missing；§4.1 事件可见性矩阵；§10.1 guest 限流；§5.6 cap→R 映射；trace +replay_bundle_cas；misfire 语义；幂等键落盘；序号命名空间 | — |
| 1.0 | 初稿 | 全量方法/事件/SDK/CLI/错误码/信任矩阵 | — |

---

*文档结束。*
