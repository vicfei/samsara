# #5305 复现证据档（v0.9.0 · 新加坡节点）

日期：2026-11-15（CST）｜栈：weknora-official v0.9.0 官方 compose（app/docreader/frontend/postgres/redis + 本次补启 neo4j:2025.10.1）
环境改动：`.env` 启用 NEO4J_ENABLE=true（备份 .env.bak-20261115-r5305），`docker compose --profile neo4j up -d neo4j` + 重建 app。
登录主体：opencode-manual@test.local（tenant 10000，owner）。

## 结论

issue 报告所述缺陷在 v0.9.0 官方栈上**完全复现**，且额外发现 UI 编辑器"重新处理存量文档"路径（v0.9.0 `/knowledge-bases/:id/rebuild-index`）同样受影响。根因三重锁定：上传时快照冻结 graph_enabled=false → batch-reparse/rebuild-index 不传 overrides 时沿用快照（nil keeps stored）→ ResolveProcessConfig 中显式 false 覆盖 KB 级 true → 图谱扇出为零。

## 证据矩阵（同一节点、同一栈连续实测）

| 场景 | 请求 overrides | 实际生效 GraphEnabled | graph 任务入队 | neo4j 节点 | 文档终态 |
|---|---|---|---|---|---|
| A1 文档列表批量重建（issue 原路径） | 无 | false（陈旧快照） | **0** | 0 | completed |
| A2 编辑器 rebuild-index（UI 承诺路径） | 无（handler 固定传 nil） | false（陈旧快照） | **0** | 30→30 | completed |
| B1 批量重建 + 显式 overrides | graph_enabled=true | true | **2**（1 篇 1 个） | **23** | completed |
| B2 启图谱后新上传（无 overrides） | 快照 nil→取 KB | true | **1** | 30（+7） | completed |

B1 与 A1 的唯一变量 = 请求体是否携带 process_config，直接钉死"快照陈旧"而非"环境/模型不可用"：同一 qwen3.8-max 在 B1 抽取成功（neo4j 23 节点），A1 只是从未入队。

## 关键观测（原始输出摘要）

- A1 postprocess：`Knowledge <id> entered finalizing (pending_subtasks=1)` —— 槽位只有 summary 一个，graph 槽从未播种；`Spawning Graph RAG` 0 次、`queue=graph` 0 次、`NEO4J is not enabled` 0 次（排除环境因素）、asynq `asynq:*graph*` 键 0 个、neo4j `MATCH (n) RETURN count(n)` = 0。
- B1：`Spawning Graph RAG extract tasks for 1 text/OCR chunks` ×2；`enqueued task: id=020b6ba1… queue=graph` / `id=c3732099… queue=graph`；asynq `asynq:{graph}:processed` 键出现；neo4j 0→23。
- B2：新上传 metadata.process_overrides=NULL，`Spawning Graph RAG` ×1，neo4j 23→30。
- A2：rebuild-index 返回 `{"document_count":1,"task_ids":["49c88fbc…"]}`，文档 completed，快照仍 false，`Spawning Graph RAG` 0 次，neo4j 30→30。
- DB 直查（A1 完成后）：两文档 `metadata->'process_overrides'->>'graph_enabled'` = **false**；各 2 chunks；parse_status=completed。

## 代码锚点（v0.9.0 tag）

- `internal/handler/knowledge.go:3507` — RebuildKnowledgeBaseIndex 调 `enqueueKnowledgeListReparse(..., ids[start:end], nil)`（固定 nil → 沿用快照）。
- `internal/application/service/knowledge_process.go:2941` — 注释明言 "nil keeps whatever was stored at upload time"；:2956 `processOverrides, _ = existing.ProcessOverrides()` 后 ResolveProcessConfig。
- `internal/application/service/knowledge_process_config.go:93-94` — `if overrides.GraphEnabled != nil { eff.GraphEnabled = *overrides.GraphEnabled }`（显式 false 覆盖 KB true）。
- `internal/application/service/knowledge_post_process.go:210`（main:209）— `if eff.GraphEnabled { graphChunkCount = len(textChunks) }`；:424（main:423）Spawning 日志。
- `internal/application/service/extract.go:103` — NEO4J_ENABLE 门控（本环境已开，非本次变量）。

## 复现脚本要素（可重放）

1. 建 KB（graph_enabled=false, extract_config.enabled=false）。
2. `POST /api/v1/knowledge-bases/{id}/knowledge/file` multipart，`process_config` = UI 同款完整 overrides（graph_enabled=false；buildProcessOverrides 形态见 UploadConfirmDialog.vue:1141-1185）。
3. 待 completed，DB 确认快照 graph_enabled=false。
4. 两步启图谱：`PUT /knowledge-bases/{id}`（config.indexing_strategy.graph_enabled=true）+ `PUT /initialization/config/{id}`（nodeExtract 全量：text/tags/nodes/relations 必填，关系端点须已在 nodes 声明）。
5. `POST /knowledge/batch-reparse` `{kb_id, ids}`（不带 process_config）→ 观测三路零信号。
6. 对照：同请求带 `process_config.graph_enabled=true` → graph 任务入队、neo4j 有节点。

## 现场残留（复现用，勿删）

- KB `7753a2a8-3b54-4a1e-822e-599cfd2914c3`（repro-5305-graphsnapshot，3 文档）+ KB `aa8135a4-c9da-4797-9ed5-47cb89f5882e`（repro-5305-ui-rebuild，1 文档）
- 关键任务 id：batch-reparse f14d70c8（A1）/ 6afb11f4（B1）/ rebuild-index 49c88fbc（A2）
- 日志留存：/tmp/r5305-logs-phaseA.txt、/tmp/r5305-logs-controlA.txt、/tmp/r5305-logs-ui-rebuild.txt
- 栈仍保留 NEO4J_ENABLE=true（后续验证修复需要；neo4j 30 节点为对照产物）

## 追加实验（2026-11-15 晚）：`process_config:{}` 语义实证（修复选型决定性证据）

KB2 文档 b562efe4（快照 graph_enabled=false，KB 图谱已启用）批量重建改传 `"process_config":{}`（任务 5b6512b1）：
- 快照被**替换**为 `{}`（processing/{} → completed/{}）
- `Spawning Graph RAG extract tasks for 1 text/OCR chunks` ×1、`queue=graph` ×1
- neo4j 30→39（抽取成功）
- 与 A2（同文档 rebuild-index 传 nil → 0 入队）构成最后一组对照：**nil 与 {} 的行为差异就是本 bug 的全部**

前端调用面（main 源码核实）：
- 列表批量重建 `KnowledgeBase.vue:514` → `batchReparseKnowledge(kbId, ids)` **不传 config**（nil，主修复面）
- timeline 重试 `knowledge-processing-timeline.vue:461` → `reparseKnowledge(id)` **不传 config**（nil）
- 单文档重建 `KnowledgeBase.vue:1932` → 走确认弹窗**显式回传存储快照**（per-doc 意图天然保留）
- `ValidateProcessOverrides(&{})` 对非图/音文件直接通过；图/音门槛与新上传一致（等价性再证）

---

# 修复验证（分支 fix-reparse-nil-refresh @ a5b96f069，基 main 9b4f792a0）

实现：`ReparseKnowledge` 入口 nil→`&KnowledgeProcessOverrides{}` 归一（knowledge_process.go，+21/-16），复用后续 validate+persist 路径。单测四件新增（knowledge_reparse_refresh_test.go，163 行）：nil 刷新陈旧快照且 resolve 图谱开 / 显式 false 钉住在双向成立 / 空刷新对图文档的 VLM 门可见失败（400）/ 空快照≡无快照。service 包全量绿（2.7s）、handler 包绿、全仓 build 干净、gofmt/新行宽/vet 干净。

E2E（bookworm 容器构建二进制换装 v0.9.0 栈，NEO4J 开，模型 qwen3.8-max + text-embedding-v4）：

| 场景 | 快照（前→后） | graph 入队 | neo4j |
|---|---|---|---|
| **A1'' nil 批量重建（修复面）** | graph_enabled=false → **{}** | **2**（修复前 0） | 45→**70**（+25，抽取完整成功） |
| B1'-inverse 显式 graph_enabled=false | false→false（钉住） | **0** | 0 |
| B2 启图谱后新上传（无 overrides） | nil | 1 | +6 |

注记：首轮矩阵 A1' 的图谱任务被 5 秒后的 B1'-inverse 重建删块打断（"graph ignore chunk: chunk not found"）——场景互踩的测试节奏问题，非产品缺陷；A1'' 单独留 settle 时间后完整通过（+25 节点）。日志锚：`NewChunkExtractTask ... queue=graph`（extract.go:123，main 行号）。

现场：KB3 c31e7722-f145-4538-b1e5-713d4b69597c（3 文档，快照 {},{},null）；任务 id 935172d3（A1'）/d0e6bda6（B1'）/2411a6ac（A1''）；构建缓存 /tmp/gomod-bookworm + /tmp/gobuild-bookworm；原版二进制备份 /tmp/WeKnora.stock-app（已复原栈）。
