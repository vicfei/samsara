# 开发工作日志（Worklog）

> 记录每次 AI 会话的工作元数据：做了什么调研、得到什么结论、做了哪些决策。
> 正式决策移入 `decisions.md`；待拍板决策放 `pending_decisions.md`。

---

## 2026-08-24 会话二：前端集成（阶段 B，任务 0 体检 + 三项集成）

### 任务 0：Git 基线体检（只读 + 报告 + 确认后整理）

- **与交接不一致（触发上报，用户确认为其本人操作）**：交接说 3 提交未推送，实际 origin/kbpaamc 均已同步到 `f3e74298`，且多 4 个 demo 提交（misc/demo-index.html）；跟踪远程原为 origin。
- 体检结论：三远程齐全（origin 公开 fork / kbpaamc 私有 / upstream 官方未 fetch）；工作区干净无未完成操作；迁移下一号 000086；**dev.env 被 fork 基线提交跟踪**（上游自带开发弱口令，低风险上报不动）；demo-index.html 含 demo01 测试账号口令（低风险）。
- 后端基线 69 包全绿；前端 build 需 **NODE_OPTIONS=--max-old-space-size=3072**（2048 OOM）；包管理器判定 **npm**（package-lock 权威 + node_modules npm 结构）。
- 确认后执行：upstream→kbpaamc、保护标签 `pre-frontend-integration` 推 kbpaamc。

### 前端集成（6+1 提交，四决策见 decisions 022）

- 探索：3 个并行代理摸清前端（112KB KB 列表/142KB KB 详情/3771 行输入框；树 UI 全自研无 TDesign Tree 先例；OIDC hash 回调先例；.test.mjs 发现机制）。
- **提交链**：api+纯函数 → 编辑器管理面板 → 选择器+聊天挂点 → 文档筛选+上传挂点 → portal 列表 → bridge 登录 → type-check 修复。
- **踩坑三则**：① `tsx --test` 只发现 .test.mjs（.test.ts 全不进全量套件，改用 .mjs 后 157/157）；② 手滑改坏 @ 按钮 SVG 一个控制点数值（git diff 及时发现修复）；③ vue-tsc 抓到 watch 元组解构与隐式 any（3072 内存下可跑，未降级）。
- **红线落实**：父节点名不进 query_text；空叶子分组禁选（选择器/浏览块双重拦截）；portal 单次调用不做前端合并；mentioned_items 逐叶子发送（chat/index.vue 零改动）。
- 验证：前端 157 测试 + check-i18n 11 + type-check + 开三 flag 构建 ✅；后端三连 ✅；:5173 preview 重启后端到端冒烟（登录 + scope=portal）✅。

---

## 2026-08-24 会话：三任务书（补验 + 演示页 + 双调研）

### 任务一：SwitchTenant 复用补验（先验证后动工）

- 源码结论：**零吊销无副作用**——`SwitchTenant` 仅在出示 refresh 非空时吊销该单条（`user.go:1040-1047`），bridge 恒传空串；`RevokeToken` 按 token 值吊销单条（`:1240-1250`）。结论+证据存档 `phase2_verification.md` §五。
- 真实 UserService 级测试（sqlite：真实 JWT 签发+auth_tokens 账本+refresh 轮换）：bridge→重推→refreshA 存活 ✅（`db02555b`）。
- **附带发现**：同秒内两次 bridge 签发字节级相同 refresh JWT（HS256 确定性+iat 秒级），同一凭证非缺陷，已记录。

### 任务二：标签树演示页

- `misc/tag-tree-demo.html`（`dfd2379d`）：单文件零依赖，横幅+API 路径标注，树渲染/新建（含叶子降级 confirm）/删除（级联统计展示）。
- CORS 前置验证：后端 `AllowOrigins:["*"]`+Authorization 头 → file:// 直连合法，**免任何配置改动**。
- 验证：JS 语法检查 + curl 模拟页面三调用全链路（含降级路径）通过；浏览器人眼验收留给用户（本环境无浏览器后端）。

### 任务三：双调研（只读+实验）

- **实验基础设施**（全部走二开自身链路）：demo01 临时提升系统管理员 → platform key（`system_identity_bridge`）→ **bridge 签入 EXP001 到租户 10000**（默认 viewer→SQL 提 contributor，实证最小权限默认）→ 专用库「实验-自动打标」（wiki/graph/问题生成全关，auto_tag 开）→ **标签池经我们的 tag-tree API 创建**（9 叶含近义对）。实验毕：platform key×2 已删、demo01 已降权；实验库+EXP001 保留待检视。
- 踩坑两处：platform key 响应里 `api_key` 是脱敏展示值、完整密钥在 `token` 字段；`PUT /knowledge-bases/:id` body 必须带 `name`。
- **调研 A（自动打标）**：原生=闭集选择题（prompt 原文/0.75 阈值/追加式落表/1 调用每文档/16k 字符采样上限全部有据）；实验三文档全命中且**近义对"固收+固定收益"同时挂上**——归一化缺失实锤；树↔扁平标签↔自动打标全链打通。报告含 R2 三栏评估（核心建议：复用原生幂等写入做"审核后应用"，二开聚焦生成+审核+归一化）。
- **调研 B（Agent）**：ReAct 链路/事件流/工具编排摸清；**审计盘点表**（token❌、agent 引用仅内联标签⚠️、配置无快照⚠️、结构化输出❌、敏感词❌）；实验实测两种模式（quick-answer references✅、smart-reasoning refs=[]实证+内联标签+3轮工具调用+18.7s）；**token 精确记账**来自 `[LLM Usage]` debug 日志（quick-answer 5.6k/问；smart-reasoning 26k/问、80% 缓存命中实付≈5.2k）。报告含 R4 三栏评估+最小补齐三件套（互不依赖可分提交）。
- 报告：`research/native_autotag_analysis.md` + `native_agent_analysis.md`（均含实验消耗节与资产处置）。

---

## 2026-08-21 会话：阶段二（UUM 桥接 + 门户列表）验证与实施

### 验证（先验证后编码，两轮）

- **15 条推测**（组织与共享 5 / 租户 RBAC 5 / 认证与身份 5）：9 属实、6 差异——组织角色无 owner 档（三档非四档）、kb_shares 三档合法（前端 UI 仅两档）、contributor 非自己资源=硬 403+老数据 tenant-owned 坑、超管两列并存（is_system_admin + can_access_all_tenants×enable_cross_tenant_access）、成员管理 Owner 专属门禁、DeleteUser/is_active 不吊销 token。
- **补验（放权语义）**：API 通道（signed_token 虚拟 principal）四层模型——capability 门禁（只看 key）+ 租户级 KB 全权 + 会话按人隔离 + **人类 RBAC 全短路**；WeKnora 不做用户级 enforcement。两个额外发现：虚拟 principal 只经 tenant key 产生（platform key 忽略 X-External-User-Token）；api_platform:{keyID} 不被 IsSyntheticUserID 识别（跨通道 creator 不一致=已知限制）。
- 报告存档：`.context/research/phase2_verification.md`。

### 决策（用户拍板，decisions 018/019/020）

- 018 部门=租户（四层角色↔TenantRole，部门管理员=owner 唯选，admin 闲置）；2.3/2.4 原生零开发。
- 019 门户列表=A 语义+C 机制（?scope=portal 参数开关；本部门∪共享、kb_id 去重）；knowledge_base_filter.md 旧语义作废。
- 020 UUM 契约：两通道分工（Web=真实 JWT 主路径 / API=虚拟 principal 服务间专用）、声明式 bridge+事件顺序约束、自愈补登、禁用两步组合、调岗删旧映射行、默认角色 viewer、安全责任三块（Java 五条义务/凭证分工表/开通 SOP）、补充5 全部落文档。

### 实施（7 提交，每功能点一提交）

| 提交 | 内容 | 备注 |
|------|------|------|
| `39d2b795` | 迁移 000085 + Model/接口 | 两表双向 1:1 UNIQUE |
| `653feb3b` | Repository | UpsertDepartment 冲突哨兵 ErrUUMDepartmentConflict |
| `a4c3b570` | Service | Bridge 复用 SwitchTenant(空refresh)=指定租户签发（未改原生 UserService 接口）；随机密码复用 generateRandomString |
| `7656c6d2` | Handler/路由/capability/DI | capability 三步（常量+Normalize case+apiKeyPlatform） |
| `2ef9d500` | 单测 7 用例 | 真实 TenantMemberService（nil 依赖安全已验证）+ stub User/Tenant/Token |
| `d32aaaa6` | scope=portal | 新增 service 方法 ListAllKnowledgeBases（接口加一，mock 补齐 datasource_service_test） |
| `10349d6c` | 单测 5+1 用例 | 临时 KB 过滤在 service 层（契约测试补 knowledgebase_list_all_test） |

### 过程问题（后续会话参考）

1. 网络多次中断导致 Write/AskUserQuestion 权限失败——重试即恢复；测试文件曾丢一次重写。
2. 两次测试返工：mock 未跟接口新增方法（ListAllKnowledgeBases）；stub 未遵守 service 过滤契约（临时 KB）——**接口加方法必须同步 grep 手写 mock**。
3. 单测首跑 7/7 与 5/5 通过后各有一次返工，均当天闭环。

---

## 2026-08-20 会话：任务 3.4 hybrid-search 标签预过滤集成

### 验证工作（先验证后编码）

用户提出五项推测，经两个探索代理 + 亲自读源码双重验证，**全部成立**：

| 推测 | 证据 |
|------|------|
| FAQ 标签在 chunk 级、文档标签在 knowledge 级 | `types/chunk.go:124-125`（"used for FAQ"）；文档标签走 `knowledge_tag_relations` |
| hybrid-search 对 tag_ids 纯透传 | `knowledgebase_search.go:370-371/399-400` → 检索器 `tag_id IN`；文档型恒 0 结果 |
| 转换在上层（聊天管线） | `session_knowledge_qa.go:552-601` buildSearchTargets 文档/FAQ 分流 |
| `ListKnowledgeIDsByTagIDs` 实现正确 | 接口 `interfaces/knowledge.go:72-74`（Service 接口）；仓储实现 `repository/knowledge.go:987-1005`（接口方法名 `ListIDsByTagIDs`，注意区分） |
| KnowledgeBaseService 已持有 kgRepo | `knowledgebase.go:54-55` 构造函数，DI 零改动 |

**验证中的两个额外发现**：
1. `DisableRecallThresholds` 只在 `SearchTarget`（聊天管线）上，`SearchParams` 没有该字段；hybrid-search 入口阈值只来自请求体 → 最终方案不动阈值（决策 017 修正项）。
2. 聊天链路（`mentioned_items` type=tag / 单kb+tag_ids）原生已支持 tag 预过滤，R3 问答半边零后端改动。

### 实施记录（每步一提交）

| 步骤 | 提交 | 内容 |
|------|------|------|
| 1 转换逻辑 | `8634fb51` | `resolveDocumentTagScope` + HybridSearch 接入（含 tenant_id/kb_ids Info 日志）；首版误用 Service 接口方法名，修正为仓储接口的 `ListIDsByTagIDs` |
| 2 注释 | `23daea1d` | `SearchParams.TagIDs` 注释重写 + Swagger @Description |
| 3 单测 | `fb819ff2` | `knowledgebase_tag_scope_test.go` 5 用例（解析/交集/空/FAQ/混合）；首版误用不存在的 `KnowledgeTypeText` 常量，修正为 `KnowledgeTypeManual` |
| 4 文档 | （无提交，gitignored） | 外部接口.md 语义表+curl 契约、功能文档 §4.3 修正、decisions 017、progress |
| 5 验证 | - | go build/vet/test ./... 全绿（见 progress.md） |

---

## 2026-08-19 会话：tag_tree CRUD 计划制定与拍板

### 已完成的工作

1. **通读 `.context` 全部资料**：设计文档×3（功能/数据模型/外部接口）、`schema/core_schema.sql`、任务规格 `prompts/tasks/tag_tree_crud.md`、`standards.md`、`sessions/decisions.md`、`sessions/progress.md`
2. **三个并行探索代理完成代码库调研**，关键结论：

| 主题 | 结论 |
|------|------|
| 分层架构实际位置 | Model=`internal/types/`（**非**任务规格写的 `internal/models/`，该目录是 AI 模型 provider 包）；接口定义=`internal/types/interfaces/`；Repository=`internal/application/repository/`；Service=`internal/application/service/`；Handler=`internal/handler/`；DI 容器=`internal/container/container.go`（uber-go/dig，非手写）；路由=`internal/router/routes_*.go` + `router.go` 的 `RouterParams`（dig.In 结构体注入） |
| 数据库迁移机制 | golang-migrate SQL 文件（**无 GORM AutoMigrate**）。PostgreSQL 放 `migrations/versioned/NNNNNN_xxx.{up,down}.sql`，本次用 **000084**；SQLite 惯例是追加进 `migrations/sqlite/000000_init.up.sql`。服务启动自动执行（`AUTO_MIGRATE` 默认开），也可 `make migrate-up` |
| 树形结构参考实现 | **WikiFolder**（`internal/types/wiki_page.go`、`repository/wiki_page.go:616-712`、`service/wiki_page.go:1474 CreateFolder / 1592 RenameOrMoveFolder`）：邻接表（parent_id）+ 物化路径（path）+ 同级重名检测 + 移动环检测（`parent.Path == folder.Path \|\| HasPrefix(parent.Path, folder.Path+"/")`）+ 子树重算。tag_tree 照此模式 |
| 原生标签复用点 | `KnowledgeTagRepository`（`interfaces/tag.go`）：Create/GetByName/Delete/CountReferences 等；自动打标原语 `ListKnowledgeIDsByTagIDs` + `AddKnowledgeTagRelations` 已存在（未来「标签迁移」直接复用） |
| hybrid-search 接入点 | `types.SearchParams.TagIDs` 已存在，检索链路已支持 tag 过滤；后续阶段注入即可，本阶段不动检索代码 |
| FAQ 打标特性 | FAQ 条目是 **chunk 级单标签**（`chunks.tag_id` 列 + 向量索引物化）——这是级联删除必须清理 chunks.tag_id 的原因 |
| 错误处理 | `internal/errors` AppError + handler `c.Error(err)` + `middleware.ErrorHandler()` 统一渲染；Service 用 `werrors.NewXxxError(...)` |
| 日志 | `internal/logger`（logrus），所有函数首参 `context.Context` |
| 测试惯例 | testify + **内存 SQLite + db.AutoMigrate**（不用 sqlmock） |
| 响应格式 | `c.JSON(200, gin.H{"success": true, "data": ...})`；无 `types.APIResponse` 类型 |
| 事务模式 | Repository 内 `r.db.WithContext(ctx).Transaction(...)`；Service 不碰 `*gorm.DB`（standards.md 硬规定，用户伪代码中的 `s.db.Transaction` 已适配为 Repository 事务方法） |
| UUID | `github.com/google/uuid`，Service 层 `uuid.New().String()` |

### 本会话拍板的决策（详见 pending_decisions.md / decisions.md）

- PD-001 路由：KB 作用域 8 端点（`/knowledge-bases/:id/tag-tree` 下）
- PD-002 删除：物理硬删 + 事务五步级联（含 chunks.tag_id 清理），无 force
- Q1 Model 位置：`internal/types/tag_tree.go` + TenantID/KnowledgeBaseID/SortOrder 必补修正
- Q2 硬删实现：结构体去掉 `gorm.DeletedAt`（DDL 留列）
- Q3 叶子降级：自动降级 + 硬删原生标签及关联（文档保留仅解除分类）
- 节点分工：`tag_id IS NOT NULL` ⟺ 叶子，无 is_leaf 列；所有新节点创建即叶子
- 检索红线：父节点名绝不拼入 query_text
- 无数据库外键（TD-003 正式化）

### 实施进度

计划已获用户批准并**全部执行完毕**（2026-08-19）：

| 步骤 | 结果 |
|------|------|
| 元数据落盘 | ✅ pending_decisions.md / worklog.md（.context 在 .gitignore，不产生提交） |
| 迁移 + Model | ✅ `3f88b023`（000084 PG + sqlite init + types/tag_tree.go） |
| Repository | ✅ `b650cdf7`（接口 + 实现：Create含降级/子树/级联删除） |
| Service | ✅ `097c91c9`（校验/环检测/子树重算/WARN 审计/权限纵深防御） |
| Handler+路由+DI | ✅ `c0ca312a`（8 端点 + RegisterTagTreeRoutes + container/router 接线） |
| 单元测试 | ✅ `67368654`（repository 8 个 + service 12 个用例） |
| 全量验证 | ✅ go build ./... + go vet + 5 包测试全绿 |
| 文档同步 | ✅ 功能文档/数据模型/任务规格/decisions 010-016/progress |

**开发中修复的两个问题**（供后续会话参考）：
1. Service `UpdateNode` 初版先改 `node.Path` 再按其查子树（会查空）——已改为先 `GetSubtree` 后变更；
2. 单测中 fixture 未设 `sort_order` 导致排序断言失败——排序规则为 `sort_order ASC, path ASC`，新节点默认 0 会排在最前。
