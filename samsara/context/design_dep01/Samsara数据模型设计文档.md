# Samsara 数据模型设计文档

> 版本：v1.0（草案）
> 配套文档：《Samsara 自进化智能体 · 项目开发文档》v0.9，本文档是其 §8 的独立扩写与落地化。
> 读者：内核开发者（M0）、存储/后端工程师。
> 范围：L0–L3 全部持久化数据的模型、存储、查询与生命周期；不含传输协议（见主文档 §9）。

---

## 目录

1. 设计目标与原则
2. 存储拓扑
3. 账本（Ledger）格式
4. 实体详细规格
5. DDL 草案（SQLite）
6. 版本树与分支操作语义
7. 投影与物化视图
8. 常用查询模式
9. 生命周期：保留、归档、备份
10. 演进与迁移
11. 数据量级估算

---

# 1. 设计目标与原则

## 1.1 目标

| 目标 | 对应主文档不变量 |
|---|---|
| 任意时刻可回滚到任意历史快照 | INV-2 |
| 崩溃后状态可完整重建 | INV-1（汇流性的持久化前提） |
| 每条数据可回答"谁、凭什么权限、在哪条轨迹" | 审计（§10.3） |
| 千级并行分支开销趋近于零 | V2 高效 |
| 分析与事实负载互不干扰 | 性能隔离 |

## 1.2 五条设计决策（主文档 §8.2 的持久化层展开）

1. **事件溯源**：账本是唯一事实来源，一切状态是重放投影。
2. **内容寻址（CAS）**：可变资产只增不改，修改 = 新节点。
3. **分支即差异**：COW 分支仅存 overlay 操作集。
4. **provenance 一等公民**：资产与记忆携带出处链。
5. **信任元数据内嵌**：授权字段随实体存储，杜绝 TOCTOU 拼装。

---

# 2. 存储拓扑

```
~/.samsara/
├── ledger/
│   ├── head.log              # 当前追加段（append-only）
│   ├── segments/             # 封存段（按 seq 范围切分，只读）
│   ├── snapshots/            # 周期快照（投影状态的全量导出）
│   └── index.sqlite          # 账本索引与全部关系型实体（见 §5）
├── assets/                   # CAS 对象库
│   ├── blobs/ab/cd/abcd…     # 按内容哈希前两级分目录
│   └── refs/                 # 分支指针（main、branch_*）
├── memory/
│   ├── episodic/<session_key>/   # 情景记忆分片
│   └── semantic/                 # 语义记忆（CAS 引用）
├── traces/                   # 分析投影（Parquet 列式，按月分区）
├── shadow/                   # 影子分支工作区（隔离、可随时清空）
├── credentials/              # 加密凭据（独立权限 0600，密钥不出此目录）
└── constitution.hash         # 宪法层校验值
```

**引擎选型**：关系型实体与账本索引共用一份 SQLite（WAL 模式）；轨迹用 Parquet；资产用文件系统 CAS。单进程场景下零外部依赖，备份边界清晰（见 §9）。

---

# 3. 账本（Ledger）格式

## 3.1 条目结构

```json
{
  "seq": 10492,
  "ts": "2026-10-04T08:31:22.104Z",
  "actor": {"kind": "agent", "id": "ag_01J…", "trust": "owner", "device": "dev_mbpro"},
  "kind": "effect.apply",
  "ref": {"plugin": "skill-store", "token": "fx_884"},
  "payload_hash": "sha256:9c1f…",
  "payload_cas": "sha256:9c1f…",
  "prev_hash": "sha256:77ab…",
  "entry_hash": "sha256:e2d0…"
}
```

- `kind` 枚举：`plugin.install|activate|suspend|dispose`、`effect.apply|revert`、`session.open|close`、`agent.spawn|terminate`、`skill.commit|promote|quarantine`、`memory.write|forget`、`job.fire`、`trust.link|unlink`、`workspace.bind`、`rollback.marker`、`review.event`；
- `payload` 本体超过 1KB 一律入 CAS，账本只存 `payload_hash`；小 payload 可内联；
- **哈希链**：`entry_hash = sha256(prev_hash ‖ canonical(entry))`，启动时校验最近 N 条 + 抽查历史段。

## 3.2 快照与重放

- 每 10⁵ 条或每日（先到者为准）生成快照：`snapshot_<seq>.tar.zst`，含 SQLite 全量 + refs；
- 启动恢复 = 加载最近快照 + 重放其后账本段；
- **回滚实现**：`rollback.marker` 记录目标 seq；投影层反向应用区间内 effect 的逆操作（资产因 CAS 不可变，天然免回滚——回滚只是移动 refs）。

## 3.3 封存与校验

- 封存段只读，附 `segment.seal`（段内 Merkle 根），供快速抽检；
- `samsara audit` 可验证任意区间的链完整性。

---

# 4. 实体详细规格

> 命名规范：表名蛇形复数；主键 `id`（ULID，时间可排序）；时间一律 UTC ISO8601；金额/配额用整数最小单位。
> `provenance` 统一结构：`{trace_id, session_key, actor_trust, source: agent|human|hub|import}`。

## A 类：账本与运行时实体

### A.1 plugins

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | ULID |
| name | TEXT | 与 version 联合唯一 |
| version | TEXT | semver |
| kind | TEXT | channel / node / tool / skill-store / scheduler / … |
| state | TEXT | installed→resolved→active⇄suspended→disposed |
| r_level | TEXT | R0–R4（修改本插件所需等级） |
| manifest_cas | TEXT | 插件清单（CAS） |
| installed_seq | INTEGER | 安装时的账本 seq（溯源锚点） |

索引：`(name, version)` 唯一；`(state)`。

### A.2 effects

| 字段 | 类型 | 说明 |
|---|---|---|
| token | TEXT PK | fx_* |
| plugin_id | TEXT FK | |
| desc | TEXT | 人类可读描述 |
| apply_seq | INTEGER | 生效账本位置 |
| revert_seq | INTEGER NULL | 已回滚则记录位置 |
| status | TEXT | applied / reverted / failed |

约束：`status='applied'` 且所属插件 dispose 时必须存在对应 revert（由内核保证，DB 层用触发器抽检）。

### A.3 sessions

| 字段 | 类型 | 说明 |
|---|---|---|
| session_key | TEXT PK | `<channel>:<scope>:<peer>` |
| lane_id | TEXT | 车道队列归属 |
| trust_level | TEXT | owner / known / guest / untrusted |
| branch_id | TEXT FK → branches | 绑定的 COW 分支 |
| workspace_id | TEXT FK NULL → workspaces | 附录 G |
| mode | TEXT | 权限模式（附录 B.1），含 `mode_expires_at` |
| state | TEXT | open / closed |

### A.4 agents

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | ag_* |
| parent_id | TEXT NULL FK | NULL = 主 Agent |
| session_key | TEXT FK | |
| depth | INTEGER | CHECK(depth ≤ 3)，超出需 owner 批准记录 |
| budget_json | TEXT | `{tokens, wall_ms, gpu_ms}` |
| r_ceiling | TEXT | |
| state | TEXT | running / done / killed |
| trace_id | TEXT | 关联轨迹 |

约束（INV-3 的 DB 层投影）：插入时校验 `budget < parent.remaining`、`r_ceiling ≤ parent.r_level`——应用层强校验 + DB CHECK 兜底。

### A.5 nodes（设备/执行节点）

| 字段 | 类型 | 说明 |
|---|---|---|
| device_id | TEXT PK | |
| role | TEXT | node / client |
| caps | TEXT | JSON 能力清单 |
| trust_evidence_cas | TEXT | 签名证据（CAS） |
| paired_at / paired_by | | 配对审批溯源 |
| state | TEXT | pending / approved / revoked |

### A.6 trust_edges（节点信任边，附录 G.5）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| src_node / dst_node | TEXT FK → nodes | |
| created_seq / revoked_seq | INTEGER | 建立/撤销的账本锚点 |
| state | TEXT | active / revoked |

## B 类：资产实体

### B.1 skill_nodes（版本树节点）

| 字段 | 类型 | 说明 |
|---|---|---|
| cas_id | TEXT PK | 内容哈希 |
| name | TEXT | |
| version | INTEGER | |
| parent_cas | TEXT NULL FK | 上一版本（版本树边） |
| branch | TEXT | main 或 branch_* |
| status | TEXT | active / stale / archived / quarantined |
| provenance | TEXT | JSON，见规范 |
| metrics_json | TEXT | `{uses, success_rate, last_used}` |
| size_bytes | INTEGER | CHECK ≤ 15360（15KB 上限） |

索引：`(name, branch, status)`；`(parent_cas)`。

### B.2 branches（COW 覆盖层）

| 字段 | 类型 | 说明 |
|---|---|---|
| branch_id | TEXT PK | |
| base_cas | TEXT | 分叉点的全局快照引用 |
| owner_session | TEXT FK | |
| state | TEXT | open / merged / abandoned |
| created_seq / closed_seq | INTEGER | |

`overlay_ops` 存于 `branch_ops` 表：`(branch_id, op_seq, op_kind, target_cas, patch_cas)` —— 只存差异。

### B.3 memory_items

| 字段 | 类型 | 说明 |
|---|---|---|
| cas_id | TEXT PK | |
| layer | TEXT | working / episodic / semantic |
| session_key | TEXT FK | 隔离边界 |
| status | TEXT | active / stale / archived / forgotten |
| provenance | TEXT | JSON |
| forgotten_seq | INTEGER NULL | "被遗忘"的账本锚点（可回滚） |

## C 类：流程实体

### C.1 promotion_requests

`(id PK, asset_cas FK, source_branch, gate_stage ∈ {lint, shadow, gate, merged, rejected}, verdict_json, reviewer, created_seq, decided_seq)`

### C.2 shadow_runs

`(id PK, variant_cas, baseline_cas, traceset_ref, metrics_json, verdict, cost_usd)` —— verdict 由裁判签名（可追溯是哪个 JudgeProvider 实现判的）。

### C.3 jobs（定时任务）

`(id PK, schedule_cron, timezone, goal_cas, trust_snapshot, budget_json, r_ceiling, notification, misfire, expires_at NULL, state)` —— `expires_at` 仅当 r_ceiling ≥ R3 时强制非空。

### C.4 workspaces（附录 G）

`(id PK, node_id FK, root, env_profile, trust_ceiling, created_seq)` —— `root` 仅默认目录，权限语义由沙箱级别与 trustCeiling 承担。

## D 类：信号实体（分析投影，Parquet）

### D.1 traces / trace_steps

`traces`: `(trace_id, session_key, agent_id, outcome, failure_class, cost_usd, tokens, duration_ms, started_at, task_cluster)` —— `task_cluster` 供附录 E 记分卡。
`trace_steps`: `(trace_id, step_no, kind, name, ok, ms, tokens)`，按 `started_at` 月分区。

### D.2 review_events

`(id, ts, actor_trust, kind ∈ {approve, reject, edit, intervene_queued, intervene_immediate, kill}, target_ref, latency_ms, context_json)` —— 注意力路由器与回路健康分的唯一输入源。

### D.3 scorecards（E.2 物化）

`(task_cluster, model_id, attempts, successes, overrides, kills, avg_cost, updated_at)`，PK = `(task_cluster, model_id)`。

---

# 5. DDL 草案（SQLite）

```sql
PRAGMA journal_mode = WAL;

CREATE TABLE plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('installed','resolved','active','suspended','failed','disposed')),
  r_level TEXT NOT NULL CHECK (r_level IN ('R0','R1','R2','R3','R4')),
  manifest_cas TEXT NOT NULL,
  installed_seq INTEGER NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE effects (
  token TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL REFERENCES plugins(id),
  desc TEXT NOT NULL,
  apply_seq INTEGER NOT NULL,
  revert_seq INTEGER,
  status TEXT NOT NULL CHECK (status IN ('applied','reverted','failed'))
);

CREATE TABLE branches (
  branch_id TEXT PRIMARY KEY,
  base_cas TEXT NOT NULL,
  owner_session TEXT,
  state TEXT NOT NULL CHECK (state IN ('open','merged','abandoned')),
  created_seq INTEGER NOT NULL,
  closed_seq INTEGER
);

CREATE TABLE sessions (
  session_key TEXT PRIMARY KEY,
  lane_id TEXT NOT NULL,
  trust_level TEXT NOT NULL CHECK (trust_level IN ('owner','known','guest','untrusted')),
  branch_id TEXT REFERENCES branches(branch_id),
  workspace_id TEXT REFERENCES workspaces(id),
  mode TEXT NOT NULL DEFAULT 'auto_edit'
    CHECK (mode IN ('plan','confirm','auto_edit','full_access')),
  mode_expires_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('open','closed'))
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES agents(id),
  session_key TEXT NOT NULL REFERENCES sessions(session_key),
  depth INTEGER NOT NULL CHECK (depth <= 3),
  budget_json TEXT NOT NULL,
  r_ceiling TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','done','killed')),
  trace_id TEXT
);

CREATE TABLE nodes (
  device_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('node','client')),
  caps TEXT NOT NULL,
  trust_evidence_cas TEXT,
  paired_at TEXT,
  paired_by TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','approved','revoked'))
);

CREATE TABLE trust_edges (
  id TEXT PRIMARY KEY,
  src_node TEXT NOT NULL REFERENCES nodes(device_id),
  dst_node TEXT NOT NULL REFERENCES nodes(device_id),
  created_seq INTEGER NOT NULL,
  revoked_seq INTEGER,
  state TEXT NOT NULL CHECK (state IN ('active','revoked')),
  UNIQUE (src_node, dst_node, created_seq)
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(device_id),
  root TEXT NOT NULL,
  env_profile TEXT,
  trust_ceiling TEXT NOT NULL,
  created_seq INTEGER NOT NULL
);

CREATE TABLE skill_nodes (
  cas_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  parent_cas TEXT REFERENCES skill_nodes(cas_id),
  branch TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL CHECK (status IN ('active','stale','archived','quarantined')),
  provenance TEXT NOT NULL,
  metrics_json TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes <= 15360)
);
CREATE INDEX idx_skill_lookup ON skill_nodes(name, branch, status);

CREATE TABLE memory_items (
  cas_id TEXT PRIMARY KEY,
  layer TEXT NOT NULL CHECK (layer IN ('working','episodic','semantic')),
  session_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','stale','archived','forgotten')),
  provenance TEXT NOT NULL,
  forgotten_seq INTEGER
);
CREATE INDEX idx_memory_scope ON memory_items(session_key, layer, status);

CREATE TABLE promotion_requests (
  id TEXT PRIMARY KEY,
  asset_cas TEXT NOT NULL,
  source_branch TEXT NOT NULL,
  gate_stage TEXT NOT NULL CHECK (gate_stage IN ('lint','shadow','gate','merged','rejected')),
  verdict_json TEXT,
  reviewer TEXT,
  created_seq INTEGER NOT NULL,
  decided_seq INTEGER
);

CREATE TABLE shadow_runs (
  id TEXT PRIMARY KEY,
  variant_cas TEXT NOT NULL,
  baseline_cas TEXT,
  traceset_ref TEXT,
  metrics_json TEXT,
  verdict TEXT,
  cost_usd REAL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  schedule_cron TEXT NOT NULL,
  timezone TEXT NOT NULL,
  goal_cas TEXT NOT NULL,
  trust_snapshot TEXT NOT NULL,
  budget_json TEXT NOT NULL,
  r_ceiling TEXT NOT NULL,
  notification TEXT NOT NULL DEFAULT 'smart',
  misfire TEXT NOT NULL DEFAULT 'skip',
  expires_at TEXT,
  state TEXT NOT NULL DEFAULT 'active',
  CHECK (r_ceiling IN ('R0','R1','R2') OR expires_at IS NOT NULL)  -- 高危任务强制有效期
);

-- 分析投影（SQLite 内的轻量镜像；主存储为 Parquet）
CREATE TABLE scorecards (
  task_cluster TEXT NOT NULL,
  model_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  overrides INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  avg_cost REAL,
  updated_at TEXT,
  PRIMARY KEY (task_cluster, model_id)
);
```

---

# 6. 版本树与分支操作语义

| 操作 | 数据层动作 |
|---|---|
| 修改技能 | 计算新内容哈希 → 插入新 skill_nodes 行（parent_cas 指旧节点）→ 移动分支 refs |
| 创建分支 | 插入 branches（base_cas = 当前 main ref）——零拷贝 |
| 分支写入 | 写入 branch_ops（差异补丁），不触碰 main |
| 合并（晋升通过） | 重放 branch_ops 到 main → 生成新 CAS 节点 → branch 置 merged |
| 冲突 | 两分支 parent_cas 相同而内容不同 → 自动分叉保留，进入影子验证仲裁（主文档 7.4） |
| 回滚 | 移动 refs 至目标 cas_id + 账本记 `rollback.marker`；**不删除任何节点** |
| 被遗忘 | memory_items.status→forgotten + forgotten_seq 记账；blob 保留至保留期届满（见 §9），以便回滚"遗忘"本身 |

**不变量**：任何 cas_id 一旦被引用（parent、refs、provenance），其 blob 在保留期内不可删除。

---

# 7. 投影与物化视图

| 投影 | 来源 | 更新方式 | 可丢失性 |
|---|---|---|---|
| SQLite 全部关系表 | 账本重放 | 启动时增量重放 | 可重建 |
| 插件依赖图（内存） | plugins + effects | 实时 | 易失 |
| scorecards | traces + review_events | 每小时物化 | 可重建 |
| 回路健康分 | review_events（被动信号，附录 B.3） | 每日 | 可重建 |
| traces（Parquet） | 账本 trace 类事件 | 实时双写 | **建议额外备份**（重建需重放全量账本，昂贵） |

---

# 8. 常用查询模式

| 场景 | 查询 |
|---|---|
| 会话装配上下文 | `skill_nodes` 按 (name, branch='main', status='active') + `memory_items` 按 (session_key, layer, status='active') |
| 派生树监控 | `agents` 按 parent_id 递归 CTE |
| 晋升队列 | `promotion_requests WHERE gate_stage='gate' ORDER BY created_seq`（注意力路由器在此之上排序） |
| 模型路由 | `scorecards WHERE task_cluster=? ORDER BY 满足阈值下的 avg_cost` |
| 审计回放 | 账本按 seq 区间 + `entry_hash` 链校验 |
| 投毒溯源 | `skill_nodes/memory_items WHERE provenance->>'trace_id' = ?` 批量定位同源污染 |
| 定时任务预算 | `jobs` 汇总月预算 vs traces 实际消耗（H.5 仪表盘） |

---

# 9. 生命周期：保留、归档、备份

| 数据 | 保留策略 | 备份 |
|---|---|---|
| 账本 head + segments | **永久**（封存段可转冷存储） | 每日增量 + 每周全量，异地 |
| snapshots | 保留最近 7 个 + 每月 1 个 | 随账本 |
| CAS blobs | 被引用即保留；无引用且超 90 天可清除 | 随账本 |
| traces（Parquet） | 热 90 天，冷 13 个月，后聚合归档 | 每周 |
| review_events | 13 个月（回路健康分与合规需要） | 每周 |
| shadow/ | 随时可清空 | 不备份 |
| credentials/ | 永久 | **独立加密备份，与账本分离存放** |

---

# 10. 演进与迁移

- 账本头部含 `schema_version`；迁移 = 新版本重放器读取旧版本事件（**事件格式只允许 additive 变更**——新增字段可，改语义不可；语义变更开新 kind）；
- SQLite 表结构走常规 migration（Alembic 风格），但因可重建，允许"改表 → 清空 → 重放"的暴力迁移路径；
- CAS 内容格式带自描述头（`samsara-blob/v1`），格式升级不破坏旧引用。

---

# 11. 数据量级估算（个人重度用户，一年）

| 数据 | 估算 | 依据 |
|---|---|---|
| 账本 | ~2 GB | 200 任务/周 × 平均 60 事件/任务 × ~2KB（含 payload 外置） |
| CAS 资产 | ~1 GB | 技能/记忆/工作流均为文本，版本全保留 |
| traces | ~5 GB | 步骤级事件，列式压缩后 |
| SQLite 索引 | ~300 MB | |
| 合计 | **< 10 GB/年** | 单盘轻松承载；备份成本可忽略 |

结论：数据规模完全在单机范围内，**不需要任何分布式存储**——这与"单进程内核"的整体定位一致。

---

*文档结束。与主文档的关系：本文档定义持久化真相；如与主文档冲突，以较新版本为准并回写另一方（主文档自身即 R3 级资产，修改走 RFC）。*
