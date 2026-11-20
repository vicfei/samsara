# 任务：实现层级标签树（Tag Tree）CRUD

> **状态**：✅ 已完成（2026-08-19，见 `.context/sessions/progress.md` 与 `decisions.md` 010-015）
> 本文档已按最终实现修订，与代码保持一致。

---

## 1. 目标
为知识库增加树形标签结构，支持多级嵌套（如"行业研究/半导体/设计"）。

## 2. 实现（已完成）

### 数据库与 Model
- 迁移：`migrations/versioned/000084_tag_tree.{up,down}.sql`（PG）+ `migrations/sqlite/000000_init.up.sql`（追加，项目惯例）
- Model：`internal/types/tag_tree.go`（**注意**：`internal/models/` 是 AI provider 包，GORM 实体一律放 `internal/types/`，见决策 014）

| 字段 | 类型 | 说明 |
|------|------|------|
| `ID` | VARCHAR(36) PK | 节点唯一标识 |
| `TenantID` | uint64 | 租户隔离 |
| `KnowledgeBaseID` | VARCHAR(36) NOT NULL | 所属知识库 |
| `ParentID` | *string NULL | 父节点 ID（NULL=根） |
| `Name` | VARCHAR(255) NOT NULL | 节点名称（禁 `/` 与「未分类」） |
| `Path` | VARCHAR(1000) NOT NULL | 物化路径 `/行业/新能源/锂电` |
| `Level` | INT（根=0） | 层级深度（≤10） |
| `TagID` | *string NULL | 关联原生标签（非空 ⟺ 叶子） |
| `IsAutoExtract` | BOOL | 是否自动提取 |
| `SortOrder` | INT | 同级排序 |
| `CreatedBy` | VARCHAR(36) | 创建者 |
| CreatedAt/UpdatedAt | TIMESTAMP | - |

结构体**不含** `gorm.DeletedAt`（DDL 留列备用）→ `Delete()` 天然物理硬删，与 `KnowledgeTag` 先例一致（决策 014）。

### 分层实现
- Repository：`internal/application/repository/tag_tree.go`（接口在 `internal/types/interfaces/tag_tree.go`）——Create（含父叶子降级+原生标签同事务插入）/GetByID/GetChildByName/ListByKB/ListByParent/GetSubtree（path 前缀+ESCAPE 转义）/GetLeafTagIDsByPath/UpdateSubtree/DeleteSubtreeCascade，全部显式 tenantID，事务封装
- Service：`internal/application/service/tag_tree.go`——名称校验、保留名、层级与路径上限、同级查重、环检测、子树 path/level 重算、降级触发、WARN 审计日志；权限镜像 `service/tag.go`（KB 解析 + 组织共享纵深防御）
- Handler：`internal/handler/tag_tree.go`（8 端点 + Swagger 注释）
- 路由：`internal/router/routes_tag_tree.go` `RegisterTagTreeRoutes`；DI：`container.go` 三行注册 + `router.go` RouterParams

### API（最终实现，KB 作用域）
原规格的 `POST /knowledge-bases/:kb_id/tags` 与原生路由 gin 硬冲突（同路径 + 参数名不一致启动 panic），已按 PD-001 决策调整为：

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/knowledge-bases/:id/tag-tree/nodes` | 创建节点（新节点即叶子，自动建原生标签） |
| GET | `/api/v1/knowledge-bases/:id/tag-tree` | 获取整棵树（嵌套） |
| GET | `/api/v1/knowledge-bases/:id/tag-tree/nodes` | 平铺列表（`?parent_id=`，`root`=根级） |
| GET | `/api/v1/knowledge-bases/:id/tag-tree/nodes/:node_id` | 节点详情 |
| PUT | `/api/v1/knowledge-bases/:id/tag-tree/nodes/:node_id` | 更新（重命名/排序） |
| DELETE | `/api/v1/knowledge-bases/:id/tag-tree/nodes/:node_id` | 删除（物理级联，无 force） |
| POST | `/api/v1/knowledge-bases/:id/tag-tree/nodes/:node_id/move` | 移动（空 parent_id=根级） |
| GET | `/api/v1/knowledge-bases/:id/tag-tree/nodes/:node_id/leaves` | 叶子 tag_ids（检索预过滤） |

守卫：读 `g.Viewer()+g.KBAccessRead("id")`；写 `g.OwnedKBOrAdmin()+g.KBAccessWrite("id")`（与原生 tag 路由一致）。

### 关键语义（决策 011/012/013）
1. **删除级联**（单事务五步）：收集叶子 tag_ids → 清 `chunks.tag_id`（FAQ）→ 删 `knowledge_tag_relations` → 删 `knowledge_tags` → 删 `tag_tree` 子树。文档保留仅解除分类。WARN 日志含操作人/path/各计数。
2. **节点分工**：`tag_id IS NOT NULL` ⟺ 叶子；所有新节点创建即叶子；父节点仅做目录与查询展开。
3. **叶子降级**：叶子获得首个子节点（创建或移入）时，硬删其原生标签及全部打标关系，置 `tag_id=NULL`。未来「标签迁移」演进复用现有 `ListKnowledgeIDsByTagIDs` + `AddKnowledgeTagRelations`。
4. **检索红线**：父节点名绝不拼入 `query_text`；`GET leaves` 空列表 = 该节点无叶子标签 = 检索应返回空结果而非取消过滤。

### 测试
`internal/application/repository/tag_tree_test.go` + `internal/application/service/tag_tree_test.go`（内存 SQLite + testify，覆盖降级/级联/环检测/通配符转义/权限）。

## 3. 验证方式（curl）
```bash
# 创建根节点
curl -X POST /api/v1/knowledge-bases/{kb_id}/tag-tree/nodes \
  -H "Authorization: Bearer $TOKEN" -d '{"name":"行业研究","parent_id":"","sort_order":0}'
# 创建子节点（触发父叶子降级）
curl -X POST /api/v1/knowledge-bases/{kb_id}/tag-tree/nodes -d '{"name":"半导体","parent_id":"<父节点ID>"}'
# 获取整棵树
curl /api/v1/knowledge-bases/{kb_id}/tag-tree
# 叶子 tag_ids（检索预过滤）
curl /api/v1/knowledge-bases/{kb_id}/tag-tree/nodes/<node_id>/leaves
# 删除（物理级联）
curl -X DELETE /api/v1/knowledge-bases/{kb_id}/tag-tree/nodes/<node_id>
```
