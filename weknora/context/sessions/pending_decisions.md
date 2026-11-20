# 待拍板设计决策（Pending Decisions）

> 本文件记录**等待用户拍板**的设计决策。决策确定后，条目移入 `decisions.md` 并在此标记已解决。

**创建时间**：2026-08-19
**关联任务**：阶段一 —— 层级标签树（tag_tree）CRUD

---

## PD-001：路由布局方案 ✅ 已拍板（2026-08-19）

### 背景与冲突原因

任务规格（`.context/prompts/tasks/tag_tree_crud.md`）定义的路由与 WeKnora 原生代码存在**硬冲突**：

1. `POST /api/v1/knowledge-bases/:kb_id/tags` 与原生标签路由 `POST /knowledge-bases/:id/tags`（`internal/router/routes_knowledge.go` 的 `RegisterKnowledgeTagRoutes`）**完全同路径**，重复注册会导致 gin 启动时 panic；
2. gin 要求同一路径位置的通配符**参数名一致**：原生全部使用 `:id`，规格使用 `:kb_id`，即使路径不同也会冲突；
3. 现有 `KBAccess` 权限守卫（`internal/middleware/kb_access.go`）**只从路径参数 `c.Param()` 取知识库 ID**，节点级顶级路由（如 `/api/v1/tags/:id`）无法复用该守卫。

### 拍板结果：方案 A —— KB 作用域路由

```
POST   /api/v1/knowledge-bases/:id/tag-tree/nodes              创建标签树节点
GET    /api/v1/knowledge-bases/:id/tag-tree                    获取整棵树（嵌套）
GET    /api/v1/knowledge-bases/:id/tag-tree/nodes              节点平铺列表（?parent_id= 过滤）
GET    /api/v1/knowledge-bases/:id/tag-tree/nodes/:node_id     节点详情
PUT    /api/v1/knowledge-bases/:id/tag-tree/nodes/:node_id     更新（名称/排序）
DELETE /api/v1/knowledge-bases/:id/tag-tree/nodes/:node_id     删除（物理级联）
POST   /api/v1/knowledge-bases/:id/tag-tree/nodes/:node_id/move      移动
GET    /api/v1/knowledge-bases/:id/tag-tree/nodes/:node_id/leaves    叶子 tag_ids（检索预过滤）
```

注册方式：新建 `RegisterTagTreeRoutes`（仿 `RegisterKnowledgeTagRoutes` 先例），读端点 `g.Viewer() + g.KBAccessRead("id")`，写端点 `g.OwnedKBOrAdmin() + g.KBAccessWrite("id")`。

---

## PD-002：删除节点的语义 ✅ 已拍板（2026-08-19，用户方案：硬删除级联清理）

### 背景

- 功能文档 §4.4：「级联删除子节点」
- 任务提示词：「校验是否存在子节点」

### 拍板结果：物理硬删除 + 事务级联清理（无 force 参数）

单事务五步（顺序固定）：

1. 查询该节点下所有叶子节点的 `tag_id` 列表；
2. 清理 `chunks.tag_id`：`UPDATE chunks SET tag_id='' WHERE tag_id IN (?) AND tenant_id=?`（FAQ 条目打标清理，ZCode 补充的数据完整性步骤）；
3. 删除 `knowledge_tag_relations` 中对应关联记录；
4. 删除 `knowledge_tags` 中对应原生标签记录；
5. 删除 `tag_tree` 中该节点及所有子孙节点记录。

WARN 日志记录：操作人、删除的 `path`、受影响 `tag_id` 数量、解绑的文档/chunk 数量。前端仅标准确认弹窗，无需影响范围统计。

---

## 后续追问的三项细化决策 ✅ 均已拍板（2026-08-19）

| 编号 | 问题 | 拍板结果 |
|------|------|----------|
| Q1 | GORM 实体位置 | **A**：`internal/types/tag_tree.go`（`internal/models/` 是 AI provider 包，不放 GORM 实体）；同时落实 TenantID/KnowledgeBaseID/SortOrder 三个必补修正 |
| Q2 | 硬删的 GORM 实现 | **A**：结构体**去掉** `gorm.DeletedAt` 字段（同 `KnowledgeTag` 先例，DDL 留列备用，`Delete()` 天然硬删）；用户原注释「查询时始终用 Unscoped()」方向有误已在会话中纠正 |
| Q3 | 叶子降级语义 | **A**：叶子获得首个子节点（创建或移入）时**自动降级**——清 `tag_id` + 事务内硬删其原生标签及全部打标关系（文档保留、仅解除分类），WARN 日志记录解绑数量 |

## 其他会话内确认事项

- **决策 4 预留改造**：未来「标签迁移」（降级时把文档迁到子节点标签）复用原生已有原语 `knowledgeRepository.ListKnowledgeIDsByTagIDs` + `AddKnowledgeTagRelations`，本次零成本预留（仅文档记录）。
- **补充语义**（由用户决策哲学推定，已在实施计划中）：所有新节点创建即叶子；移动节点到叶子下同样触发降级；重命名叶子需同步改名原生 `knowledge_tags.name`（受唯一索引约束需查重）。
- **保护性约束**：节点名禁用 `/` 与保留名「未分类」（`types.UntaggedTagName`）；path ≤1000 字符；层级 ≤10；LIKE 前缀转义。
- **无数据库外键**（TD-003）：原生 "No FK by design" 惯例，存在性由 Service 校验。

## 状态汇总

**本文件当前无待拍板事项。** 所有决策已正式化到 `decisions.md`（决策 010-015）。
