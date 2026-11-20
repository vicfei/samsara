# WeKnora 二开 - 关键决策记录

本文档记录开发过程中的所有重要技术决策及其理由，便于追溯和一致性。

---

## 决策 001：扩展表放在同一数据库

- **日期**：2026-08-18
- **决策**：将 4 张扩展表（`tag_tree`、`auto_tag_suggestions`、`agent_execution_audit`、`external_identities`）放在 WeKnora 原生数据库（`WeKnora`）中，而非新建独立数据库。
- **理由**：
  - 可使用外键约束（如 `tag_tree.kb_id` → `knowledge_bases.id`）保证数据一致性
  - 便于事务管理（如创建标签树节点时同时创建原生 `knowledge_tags` 记录）
  - 减少应用层的跨库查询复杂度
- **注意事项**：查询时必须显式处理软删除（`deleted_at IS NULL`）

---

## 决策 002：`tag_tree` 的 `tag_id` 只在叶子节点非空

- **日期**：2026-08-18
- **决策**：`tag_tree` 表只有叶子节点关联原生 `knowledge_tags.id`，内部节点仅存储树形结构。
- **理由**：
  - 原生 `knowledge_tags` 是扁平结构，打标只能打到叶子
  - 检索预过滤时，只查询叶子节点的 `tag_id` 列表用于 `hybrid-search`
  - 保持原生表 `knowledge_tag_relations` 不受影响
- **实现**：叶子节点创建时自动在 `knowledge_tags` 创建对应记录，`tag_id` 回填到 `tag_tree`

---

## 决策 003：权限采用“最小权限原则”

- **日期**：2026-08-18
- **决策**：当用户通过组织访问共享知识库时，有效权限 = min(用户在组织内的角色权限, 共享记录中的 permission)。
- **理由**：
  - 符合安全设计的最佳实践
  - 避免权限意外提升（如 viewer 通过 editor 共享获得编辑权）
- **实现**：在 Service 层进行权限计算，Handler 层调用前验证

---

## 决策 004：采用“外部壳系统”设计

- **日期**：2026-08-18
- **决策**：层级标签、审计日志、UUM 桥接等新功能尽量不侵入 WeKnora 原生代码，通过新建表和服务实现。
- **理由**：
  - 便于未来合并官方 `upstream` 更新，减少代码冲突
  - 降低对原生逻辑的破坏风险
  - 新功能可独立测试和回滚
- **例外**：改造 `/knowledge-bases` 列表接口需要修改原生 Handler/Service（权限隔离是刚需）

---

## 决策 005：开发分支策略

- **日期**：2026-08-18
- **决策**：所有二开功能集中在 `feature/tag-system` 分支开发，不拆分为多个特性分支。
- **理由**：
  - 各功能之间相互依赖（标签树是自动打标和检索过滤的基础）
  - 简化 Git 操作，避免 Cherry-pick 和合并冲突
  - 所有功能完成后统一合并回 `main`（通过 PR + Revert 保证可回滚）
- **合并方式**：使用 `--no-ff` 保留合并节点，便于 `git revert -m 1` 整体回滚

---

## 决策 006：前端开发延后

- **日期**：2026-08-18
- **决策**：前端页面暂不开发，等待后端 API 全部调通后再集中开发。
- **理由**：
  - 避免前后端联调时反复修改接口
  - 后端接口可通过 `curl` / Swagger 独立测试
  - 集中开发效率更高

---

## 决策 007：模型配置延后

- **日期**：2026-08-18
- **决策**：LLM/Embedding 模型配置暂不配置，等用到自动打标或 Agent 时再配置。
- **理由**：
  - 当前阶段（标签树 CRUD）不涉及 LLM 调用
  - 模型配置存在数据库中（`models` 表 + `tenants.agent_config`），持久化无问题
  - 可延后到阶段三/四再通过前端界面配置

---

## 决策 008：测试集准备时机

- **日期**：2026-08-18
- **决策**：测试集（PDF/Word/TXT）在阶段三（自动打标）之前准备，当前阶段不需要。
- **理由**：
  - 当前阶段仅测试 CRUD 接口，不涉及文档解析
  - 自动打标需要真实文档验证 LLM 提取效果

---

## 决策 009：代码提交粒度

- **日期**：2026-08-18
- **决策**：每个微小的功能点独立提交一次（如 Model 单独提交、Repository 单独提交）。
- **理由**：
  - 便于回滚（`git reset --hard HEAD~1` 精确到子功能）
  - 方便 Code Review 时按模块审查
  - 减少冲突范围

---

## 决策 010：标签树路由采用 KB 作用域（PD-001 拍板）

- **日期**：2026-08-19
- **决策**：全部层级标签路由挂 `/api/v1/knowledge-bases/:id/tag-tree` 下，共 8 个端点；原生扁平标签路由 `/knowledge-bases/:id/tags` 保持不变。
- **理由**：原设计（功能文档 §4.4 顶级 `/api/tag-tree/*`）与原生路由存在 gin 硬冲突——同路径重复注册启动 panic，且 gin 要求同位置通配符参数名一致（原生 `:id` vs 规格 `:kb_id`）；现有 `KBAccess` 守卫只从路径参数取 KB ID，顶级路由无法复用。KB 作用域路由零侵入原生文件，直接复用权限守卫与租户改写。
- **实现**：`internal/router/routes_tag_tree.go` `RegisterTagTreeRoutes`；读 `g.Viewer()+g.KBAccessRead("id")`，写 `g.OwnedKBOrAdmin()+g.KBAccessWrite("id")`。

---

## 决策 011：删除语义为物理硬删 + 事务级联清理（PD-002 拍板）

- **日期**：2026-08-19
- **决策**：`DELETE` 物理硬删除，单事务五步级联：①收集子树叶子 `tag_ids` → ②清 `chunks.tag_id`（FAQ 条目打标，ZCode 补充的数据完整性步骤）→ ③删 `knowledge_tag_relations` → ④删 `knowledge_tags` → ⑤删 `tag_tree` 子树。无 force 参数，接口默认完整级联。
- **理由**：用户明确选择硬删哲学；文档与 FAQ 条目本身保留（仅解除分类），研报等内容绝不因删分类而被删。向量索引中残留的旧 tag_id 良性（UUID 永不复用）。
- **实现**：`repository/tag_tree.go` `DeleteSubtreeCascade`，返回计数；Service 输出 WARN 日志（操作人/path/各级计数）。

---

## 决策 012：父节点管查询、叶子节点管打标；无 is_leaf 字段

- **日期**：2026-08-19
- **决策**：`tag_id IS NOT NULL` ⟺ 叶子节点（可打标）；父节点仅做目录组织与查询展开。所有新节点创建即叶子，自动创建（或复用同名）原生 `knowledge_tags` 记录。
- **理由**：叶子性可由 `tag_id` 派生，独立布尔列引入同步负担（沿用决策 002）。

---

## 决策 013：叶子降级 = 自动降级 + 硬删原生标签（Q3 拍板）

- **日期**：2026-08-19
- **决策**：叶子获得首个子节点（创建子节点或移入节点）时自动降级：清空 `tag_id` + 同事务硬删其原生标签、`knowledge_tag_relations` 关联及 `chunks.tag_id` 引用；被解绑文档保留。WARN 日志记录解绑数量。
- **理由**：与决策 011/012 的硬删哲学一致。
- **演进预留**：未来「标签迁移」（降级时把文档迁到子节点标签）可复用原生已有的 `knowledgeRepository.ListKnowledgeIDsByTagIDs` + `AddKnowledgeTagRelations`，改造成本极低。

---

## 决策 014：Model 规范（Q1/Q2 拍板）

- **日期**：2026-08-19
- **决策**：
  1. GORM 实体放 `internal/types/tag_tree.go`（`internal/models/` 是 AI 模型 provider 包，全仓库 GORM 实体均在 `internal/types/`）；
  2. 必补字段：`TenantID uint64`（多租户隔离硬要求）、`KnowledgeBaseID`（命名与原生一致）、`SortOrder`（PUT 语义含排序）；
  3. 结构体不含 `gorm.DeletedAt`（DDL 留列备用）→ `Delete()` 天然硬删，同 `KnowledgeTag` 先例；未来切软删只需加回字段。
- **备注**：用户原始注释「查询时始终用 Unscoped()」方向有误已在会话中纠正——`Unscoped` 用于查询会带出软删行，用于 `Delete` 才是硬删。

---

## 决策 015：不建数据库外键（TD-003 正式化）

- **日期**：2026-08-19
- **决策**：`tag_tree` 的 `knowledge_base_id`/`tag_id`/`created_by` 均不建数据库外键，引用存在性由 Service 层校验（404/400）。
- **理由**：与决策 001「外键保证一致性」的字面表述冲突，但实质目标不变——原生代码惯例 "No FK by design"；FK 数据库级联硬删会绕过应用层 WARN 审计日志与事务编排。已在 `数据模型.md` §7.2 修订标注。

---

## 决策 016：保护性约束与检索红线

- **日期**：2026-08-19
- **决策**：
  1. 节点名禁用 `/`（路径分隔符）与保留名「未分类」（`types.UntaggedTagName`，防止级联删除系统默认标签）；
  2. `path` ≤1000 字符、层级 ≤10（`MaxTagTreeDepth`）；
  3. path 前缀查询一律 `escapeLikeKeyword` + `ESCAPE '\'` 转义（名称可含 `%`/`_`）；
  4. 检索预过滤红线：父节点名绝不拼入 `query_text`；`GET leaves` 空列表表示该节点无叶子标签，检索应返回空结果而非取消过滤（防止 `tag_ids=[]` 被当作"不过滤"）。

---

## 决策 017：hybrid-search 补齐文档型 KB 的 tag_ids 解析（任务 3.4）

- **日期**：2026-08-20
- **背景与假设修正**：此前认为"检索链路已原生支持 tag_ids"。源码验证（五项推测全部成立）后发现：`SearchParams.TagIDs` 在 hybrid-search 链路纯透传到索引层按 `chunks.tag_id IN` 过滤，而该列只有 FAQ 条目写入——**文档型 KB 传 tag_ids 恒返回 0 结果**。真正的 tag→knowledge 转换只在聊天管线 `buildSearchTargets`（`session_knowledge_qa.go:552-601`）。
- **决策（用户拍板方案 A）**：在 `HybridSearch` 入口（`pickPrimary` 之后）新增 `resolveDocumentTagScope` 分流：
  1. `tag_ids` 非空且范围内全为文档型 KB → 逐 KB 调 `kgRepo.ListIDsByTagIDs` 解析为 knowledge 白名单（tag 间 OR、跨 KB 并集去重、与显式 `knowledge_ids` 取交集）；解析为空 → **返回空结果**（不降级整库）；`scope_tag_ids` 记录原标签，`tag_ids` 清空。
  2. FAQ 型或混合型 → 保持透传（索引级过滤），避免 FAQ chunk 被文档白名单误杀。
  3. Info 日志带 `tenant_id`/`kb_ids`/`tag_count`/`knowledge_count`/是否交集（用户排障要求）。
- **对原决策的一处修正**：原方案要求"设置 `DisableRecallThresholds=true`"，验证发现该字段只存在于聊天管线的 `SearchTarget`，`SearchParams` 上没有；且 hybrid-search 入口的阈值只来自请求体（无租户默认值注入），不存在"阈值抹掉窄范围"风险。故**不动阈值**——强行清零反而会覆盖调用方显式传参。
- **聊天链路（决策 B）**：`knowledge-chat`/`agent-chat` 原生已支持同样的 tag 预过滤（`mentioned_items:[{type:"tag",kb_id,id}]` 或「单 kb + tag_ids」），零后端改动，仅补调用契约文档（`外部接口.md`）。
- **实现**：提交 `8634fb51`（转换逻辑）、`23daea1d`（注释/Swagger）、`fb819ff2`（5 用例单测：解析/交集/空/FAQ 透传/混合透传）。

---

## 决策 018：部门建模为租户（阶段二架构定稿）

- **日期**：2026-08-21
- **决策**：废弃"部门=Organization"字面映射，**部门=WeKnora 租户**。依据：原生组织成员粒度是租户级（OTM.tenant_id→tenants.id），全员主租户+组织区分部门会使部门隔离失效；而原生 TenantRole 恰为四层。
- **角色映射定稿**：

| 业务角色 | 原生映射 |
|---|---|
| 科技管理员 | `is_system_admin`（平台管理端点 + scope=portal 全量判定）；跨租户数据浏览叠加 `can_access_all_tenants`（需 `enable_cross_tenant_access` 开关，部署文档写明打开步骤） |
| 部门管理员 | 部门租户 **owner**（唯一选择：成员管理 Add/改角色/Remove 是 Owner 专属门禁，admin 档动不了人；admin 档保留给未来"只管业务不管人"的副管角色） |
| 可编辑成员 | contributor |
| 只读成员 | viewer |

- **复用原生零自建**：部门内 KB 互见=原生列表行为；跨部门共享=原生组织+kb_shares（min 判定三层：min(共享权限,组织角色)+租户角色封顶）；成员管理=原生 `/tenants/:id/members`。
- **语义修正（验证条目7）**：contributor 对非 creator 资源的写操作是**硬 403**（非"按 viewer 软降级"）；**老数据 creator_id 为空的 KB 视为 tenant-owned 仅 Admin+ 可写——批量导入/初始化脚本必须显式写 creator_id**（运维红线）。
- **治理规则**：kb_shares.permission 三档合法（admin/editor/viewer），门户共享 UI 只开放 viewer/editor 两档（沿用原生前端惯例）；一人多部门=一人多 membership（X-Tenant-ID 切换），**调岗走 Transfer 端点（资源留原部门），兼任走原生成员管理**。
- **验证依据**：`.context/research/phase2_verification.md`。

---

## 决策 019：门户 KB 列表语义与交付机制

- **日期**：2026-08-21
- **决策**：`GET /knowledge-bases` **原生默认行为不变**，新增 `?scope=portal` 参数启用门户语义：
  - 普通用户：本部门（租户）全部 KB（含统计/共享计数）∪ 其他部门经组织共享进来的 KB（共享项附 share_id/organization_id/org_name/permission/source_tenant_id/shared_at），**按 kb_id 去重、本租户条目优先**；
  - `is_system_admin`：跨租户全量（排除临时 KB，响应项带 tenant_id；不填充分类统计——跨租户逐 KB 计数代价 O(N×queries)，详情按需查）；
  - `agent_id` 参数优先于 scope（互斥）。
- **作废**：任务规格 `knowledge_base_filter.md` 的"普通用户仅见组织共享 KB、隐藏自建未共享 KB"条款——旧建模方案下的补丁，与权限矩阵（可编辑成员可创建知识库且需可见）矛盾。
- **实现**：提交 `d32aaaa6`（`ListAllKnowledgeBases` service 方法 + handler portal 分支）、`10349d6c`（5+1 用例）。

---

## 决策 020：UUM 身份桥接契约（含三处验证修正）

- **日期**：2026-08-21
- **两通道分工（修正后）**：
  1. **Web 门户通道 = bridge 换真实账号 JWT**（真实 CreatorID、完整 RBAC、会话归属、审计）——门户用户运行时主路径；
  2. **signed_token 虚拟 principal = Java 后端服务间调用专用**（管理/批量任务），不代理终端用户检索问答流量。**两通道不相交**；修正：虚拟 principal 不查 users 表不建号（验证补验），"provisioning 时序约束"对 API 通道不成立、建号只服务 Web 通道。
- **安全责任划分（放权语义）**：WeKnora 对 API 通道执行"机器级 capability 门禁 + 租户级 KB 全权 + 会话按人隔离"，**不做用户级 enforcement——由 Java 后端全权负责**（决定为哪个 sub 签 token、是否放行）。Java 五条义务/凭证分工表/新部门开通 SOP 见 `外部接口.md` bridge 契约节。
- **端点语义**（platform key + `system_identity_bridge` capability；X-Tenant-ID 必带仅满足门禁，逻辑以 body 为准）：
  - `POST /identity/bridge`：**声明式**——"确保 UUM 用户拥有目标租户访问权"。已映射→登录（校验 active+membership，防旧映射换票）；未映射→自愈补登（按派生 username `uum-{id}` 查得用户则 AddMember+补映射+签发）或建号（tenantless Register + AddMember **默认 viewer** 最小权限 + 映射 + 签发）。**事件顺序约束：同一用户 transfer/disable 必须先于新 bridge 调用被处理**（声明式语义下旧部门重推会重新加回旧部门，是特性非 bug）。
  - `POST /identity/disable`：两步组合（is_active=false + RevokeTokensByUserID）——仅阻止登录会让已签发 JWT 继续有效至多 24h。
  - `POST /identity/transfer`：成员迁移（默认保留原角色）+ **删除旧映射行**（历史靠日志，不堆行）+ 吊销全部 token + 资源留原部门；幂等（源映射缺失且目标映射存在→返回现状）。
  - `GET /identity/mapping/:uum_user_id`、`GET /identity/mapping/by-user/:user_id`、`PUT /identity/departments/:department_id`（部门↔租户 1:1 双向唯一）。
- **数据**：迁移 000085 两表（`external_identities`：UNIQUE(uum_user_id,tenant_id)+部门快照列；`uum_departments`：uum_department_id 与 tenant_id 双 UNIQUE）。
- **已知限制（不写代码）**：跨通道 creator_id 不一致——platform key 建的资源记 `api_platform:{keyID}`、signed_token 通道记租户 owner；叠加 contributor 硬 403，API 通道创建的资源 Web 通道 contributor 无法编辑、仅部门 owner/admin 可管。**使用规约：面向部门协作的资源创建走 Web 通道；Java 侧仅创建部门公共资产**。
- **实现**：提交 `39d2b795`/`653feb3b`/`a4c3b570`/`7656c6d2`/`2ef9d500`。

---

## 决策 021：双库推送约定（2026-08-24）

- **决策**：每次完工交付的标准动作增加 `git push origin feature/tag-system && git push kbpaamc feature/tag-system`（双库：origin=WeKnora 公开 fork、kbpaamc=WeKnora-paamc），交付回报中附 push 结果。
- **背景**：GitHub 凭据已配置（credential.helper store），4 个积压提交已由用户推送双库。
- **安全约束（同日追加）**：敏感值（platform key 等）**零落盘**——任何文件/提交中只允许占位符（如 `$PKEY`），明文仅出现在对话交付回报中；提交前 `git diff` 自查（origin 是公开 fork）。

---

## 决策 022：前端集成架构（阶段 B，2026-08-24 用户拍板）

- **日期**：2026-08-24
- **背景**：决策 006 的启动条件已满足（后端 API 全部调通），本轮完成标签树管理+三处选择器、门户列表、bridge 登录三项前端集成。
- **四项拍板**：
  1. **范围**：三项全做，按功能点分批独立提交（6 个功能提交 + 1 个类型修复提交）；
  2. **树管理挂载**：KB 编辑器左侧导航新增「层级标签」分节（data 组，照 KBShareSettings 自包含面板模式），**不改**原生平铺标签抽屉；
  3. **父节点语义**：选父节点 = 过滤其子树全部叶子。前端 chip 聚合显示父节点名（`名称 (N)`），发送前在 mentionedItems 构造处展开为去重叶子逐项发送（后端零改动，chat/index.vue 不动）；**叶子为空的分组在选择器侧禁选**（空 tag_ids 语义是"无结果"非"不过滤"），父节点名绝不拼入 query_text；
  4. **bridge 形态**：`#bridge_result=base64url(JSON{token,refresh_token})` hash 回调（照抄 OIDC 先例：守卫放行 → App.vue 消费 → 清 hash → /auth/me 同步 → 跳转），token 不打印不落日志埋点；登录页「门户统一登录」按钮**本轮只接 `VITE_PORTAL_LOGIN_URL` 构建期配置**，未配置隐藏（不动 docker-entrypoint.sh/runtime config）。
- **工程隔离约束（用户任务 2）**：新功能代码集中 `frontend/src/features/{tag-tree,portal-list,portal-auth,common}/`，不复制工程不建影子工程；对现有页面只做挂点式改动（编辑器 navItems/聊天工具栏/筛选弹层/上传对话框/侧栏/路由守卫）；三枚 feature flag（`VITE_ENABLE_TAG_TREE`/`VITE_ENABLE_PORTAL_LIST`/`VITE_ENABLE_BRIDGE_LOGIN`）**默认关闭**，现有页面行为零变化，验收构建显式开启；开工前置：任务 0 Git 体检通过 + 保护标签 `pre-frontend-integration`（f3e74298）已推 kbpaamc；门户列表**单次调用 `?scope=portal`**，前端不做"本部门+共享"合并语义（防权限语义漂移，`mapPortalItems` 仅做卡片形态适配）；前端包管理器以锁文件为准 = **npm**（package-lock.json 权威、node_modules 为 npm 结构；pnpm-workspace.yaml 仅 allowBuilds 配置），不安装不改依赖。
- **重要实现发现（踩坑记录）**：
  1. `tsx --test`（Node 20）**只自动发现 `.test.mjs`**，37 个 `.test.ts` 从不进全量套件——新测试一律用 `.test.mjs`（import `.ts` 源没问题，先例 grepResultsGroup.test.mjs）；
  2. 前端构建内存参数：`NODE_OPTIONS=--max-old-space-size=3072`（2048 必 OOM）；type-check（vue-tsc）同参数可跑通；
  3. portal 响应为**平铺结构**：共享项带内联 `shared/share_id/organization_id/org_name/permission/source_tenant_id/shared_at`，管理员跨租户项带 `tenant_id`（无 tenant_name，徽标暂显示 ID——已知限制）；
  4. 聊天链路复用：分组 chip 存 `tagTreeNode.leafTags`，发送/追问参数两处（Input-field 构造、settings.getSuggestedQuestionsParams）各自展开，会话恢复后父信息退化为叶子平铺（可接受）。
- **实现**：提交 `6a319857`/`84393ee5`/`1618e23d`/`552c182c`/`71f831e3`/`7b1bfe6d`/`73816248`。
