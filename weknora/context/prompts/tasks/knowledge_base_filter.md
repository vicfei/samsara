# 任务：改造知识库列表接口，增加组织级过滤

> ⚠️ **本文档核心条款已作废（2026-08-21，决策 019）**
>
> 「普通用户仅见其组织共享的知识库 / 不属于任何组织=空列表」的过滤语义已被废弃，原因：
> 1. 它是旧建模方案（部门=Organization）下的补丁；阶段二已定稿**部门=租户**（决策 018），部门内 KB 互见是原生列表行为；
> 2. 该语义会隐藏用户自建未共享的 KB，与权限矩阵「可编辑成员可创建知识库✅」自相矛盾（建了看不见，无法编辑）；
> 3. 交付机制改为 **`?scope=portal` 参数开关**（默认行为不变）：普通用户=本部门全部 KB ∪ 组织共享进来的 KB（按 kb_id 去重）；系统管理员=跨租户全量。详见 `外部接口.md` 的 scope=portal 契约与决策 019。
>
> 本文档其余部分（核心表、编码约束）仅作历史参考，**不要按此文档实施**。

## 使用时机
在 tag_tree CRUD 完成后，开始实施权限管理功能时使用。

---

## 提示词正文

**【开发任务：改造知识库列表接口，增加组织级过滤】**

### 1. 目标
修改 `GET /api/v1/knowledge-bases` 接口，使其只返回当前用户所属 `organization` 下的知识库。

### 2. 业务规则
| 用户类型 | 可见范围 |
|---------|---------|
| 系统管理员（`is_system_admin = true`） | 全部知识库 |
| 普通用户（属于某个组织） | 仅该组织下被共享的知识库 |
| 普通用户（不属于任何组织） | 空列表 |

### 3. 改动范围

#### Handler 层（`internal/handler/knowledge_base.go`）
- 在 `ListKnowledgeBases` 方法中，从 `auth` 中间件获取当前用户 ID
- 调用 Service 层的新方法

#### Service 层（`internal/application/service/knowledgebase.go`）
- 注入 `OrganizationService` 和 `KbShareService`
- 新增方法 `ListByUser(userID, page, pageSize)`
- 逻辑：
  1. 如果是系统管理员，返回全部
  2. 否则查询用户所属的 `organization_id` 列表
  3. 通过 `kb_shares` 表查询该组织可访问的 `knowledge_base_id` 列表
  4. 分页返回

#### Repository 层（`internal/application/repository/knowledgebase.go`）
- 修改 `List` 方法，支持传入 `kbIDs` 过滤条件
- 增加 `ListByIDs(ctx, ids []string) ([]*KnowledgeBase, error)`

### 4. 涉及的核心表
| 表名 | 字段 | 用途 |
|------|------|------|
| `users` | `id`, `is_system_admin` | 判断是否系统管理员 |
| `organization_tenant_members` | `user_id`, `organization_id` | 查询用户所属组织 |
| `kb_shares` | `knowledge_base_id`, `organization_id`, `permission` | 查询组织可访问的知识库 |

### 5. 编码约束
- 系统管理员判断使用 `user.IsSystemAdmin` 字段
- 查询组织时需要考虑软删除（`deleted_at IS NULL`）
- `kb_shares.permission` 取值：`editor` / `viewer`
- 返回的知识库列表需要包含共享权限信息（方便前端展示）

### 6. 验证方式
- 系统管理员登录：`GET /api/v1/knowledge-bases` 返回全部
- 普通用户登录：只返回其组织共享的知识库
