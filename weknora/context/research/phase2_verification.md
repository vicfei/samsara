# 阶段二源码验证报告（15 条推测 + 补验）

> **日期**：2026-08-21 | **验证方式**：三个并行探索代理 + 关键文件人工复核，全部结论有 file:line 证据
> **用途**：阶段二设计（部门=租户建模、UUM 契约）的代码事实依据；决策 018-020 的支撑材料

## 一、15 条推测验证结论（9 属实 / 6 差异）

| # | 推测 | 结论 | 关键证据 |
|---|------|------|----------|
| 1 | 组织成员粒度是租户级 | ✅ 属实 | `internal/types/organization.go:118`（`organization_tenant_members.tenant_id` 直指 `tenants.id`）；migration 000045；`representative_user_id` 仅审计/UI，不参与权限 |
| 2 | 组织角色四档 owner/admin/editor/viewer | ⚠️ **不符：仅三档** | `internal/types/organization.go:9-29`：admin(3)/editor(2)/viewer(1)，**无 OrgRoleOwner**——所有者由 `organizations.owner_id`/`owner_tenant_id` 两列承载；创建组织时创建者租户写入的角色是 **admin**（`service/organization.go:130`） |
| 3 | kb_shares.permission 两档 or 三档 | ⚠️ **三档属实** | Service 校验 `IsValid()` 接受 admin/editor/viewer（`kbshare.go:109-111`）；DDL 无 CHECK、默认 viewer（migration 000012:57-67）；"只见两档"是前端 UI 只提供 viewer/editor 单选（`ShareKnowledgeBaseDialog.vue:63-68`），**API 传 admin 合法** |
| 4 | min 权限判定链 | ⚠️ 属实但为三层 | `CheckTenantKBPermission`（`kbshare.go:455-500`）：本租户 KB 不走此函数（`kb_access.go:347-353` 直接给 OrgRoleAdmin）；共享 KB = `MinOrgRole(共享权限, 组织角色)` → `applyTenantRoleCap`（租户角色为 Viewer 时压顶，`kbshare.go:68-73`）→ 多 share 取最高 |
| 5 | 共享三入口 + 主列表不合并 | ✅ 属实 | `routes_agent.go:169-179/158/198`；主列表仅查本租户，ShareCount 是 owner 视角计数（`handler/knowledgebase.go:705-714`） |
| 6 | 租户四档角色高继承低 | ✅ 属实 | `tenant_member.go:38-61`（owner40/admin30/contributor20/viewer10，`>=` 判断）；守卫 `middleware/rbac.go:67-111`；EnableRBAC 默认 true（fail-closed，`config.go:241-246`） |
| 7 | contributor"自己资源像 Owner、他人按 viewer" | ⚠️ **语义修正** | 官方注释确为该句（`router/rbac.go:36-38`），但实现：**写操作对非 creator 的 contributor 直接 403**（`middleware/rbac.go:212-293`，RequireOwnershipOrRole），"按 viewer"是读路由矩阵的涌现效果（读只挂 Viewer+KBAccessRead，本租户一律 OrgRoleAdmin）。归属键=`kb.CreatorID==user_id`（写入点 `knowledgebase.go:131-133`）；**老数据 creator_id 为空 → tenant-owned → 仅 Admin+ 可写（实际创建者也 403）** |
| 8 | 超管列名 | ⚠️ **两列并存语义不同** | `can_access_all_tenants`（000001，跨租户超管，**需 `enable_cross_tenant_access` 开关=true 才生效**，`access.go:55-64`，默认 false，`config.yaml:113`）+ `is_system_admin`（000053，平台管理员，守卫 `/system/admin/*`）。X-Tenant-ID **普通用户有 active membership 即可用**（`access.go:90-101` 分支3），非超管专属 |
| 9 | 一人多租户 | ⚠️ **属实（关键利好）** | 部分唯一索引 `(user_id,tenant_id) WHERE deleted_at IS NULL`（000043:40-42）；`POST /auth/switch-tenant`（`routes_auth_tenant.go:193`，校验 membership + generateTokensForTenant 重签 + best-effort 吊销旧 refresh）；前端实际用每请求 `X-Tenant-ID`（`request.ts:55-60`）。**一人多部门可行** |
| 10 | /tenants/:id/members 存在 | ✅ 属实（**门禁 Owner 专属**） | `routes_auth_tenant.go:112-115`：List=Viewer，**Add/改角色/Remove=g.Owner()**（非 Admin）→ 纯 admin 档的"部门管理员"加不了成员；invitations 系列同 Owner 门禁；EnableRBAC 关闭时角色守卫放行但 RequireCrossTenantAccess/RequireSystemAdmin/RequirePathTenantMatch 三处不受开关影响 |
| 11 | OIDC 建号先例 + GenerateTokens | ✅ 属实 | `provisionOIDCUser`（`user.go:1491-1519`，随机32字节密码）；`GenerateTokens` 公开（`user.go:743-748`）；resolveLoginTenantID 顺序=LastActiveTenantID > home tenant > 首个 active membership（`user.go:766-846`） |
| 12 | signed_token 模式 | ⚠️ **重大差异（见补验）** | 三模式确认（`types/tenant.go:195-215`，存 `tenants.api_principal_config`，HMAC 密钥 AES-GCM 加密，Owner 门禁管理端点 `routes_auth_tenant.go:101-103`）；`verifyExternalUserJWT`（`auth.go:611-657`）：header=`X-External-User-Token`、HS256、aud=weknora 强制、exp 必填且 ≤24h 强制、claims=sub+tenant_id（无 role）。**断言用户本地不存在时不建号也不拒绝——纯虚拟 principal** |
| 13 | JWT 吊销/强制下线 | ⚠️ **缺口确认** | auth_tokens 存**完整 JWT 明文**（`types/user.go:114-135`）；`RevokeTokensByUserID` 原语存在（`repository/user.go:332-335`，Logout/改密/AdminResetPassword 调用）但**无独立管理端点**；**DeleteUser 不吊销 token**、**is_active=false 不影响已持有 token**（ValidateToken `user.go:1067-1113` 不检查 IsActive）——禁用必须两步组合 |
| 14 | API Key 虚拟用户角色固定 Admin | ⚠️ **不符** | 默认 `TenantRoleViewer`，tenant FullAccess key 才 `TenantRoleOwner`（`auth.go:534-548`）；`RequireRole` 对 API-key principal **短路放行**（`rbac.go:71-77`），真实权限由 capability gate 决定（`api_key_gate.go:111-153`，未声明路由默认拒绝）；platform key 必带 X-Tenant-ID |
| 15 | kb_access 链与新模型兼容 | ✅ 属实（零冲突） | 三步链 own→org-shared→shared-agent + 只改写 request context 不改 c.Keys（`kb_access.go:226-458`）；tag_tree `resolveKBWrite` 用 `kb.TenantID` 做数据访问键、hybrid-search `resolveDocumentTagScope` 显式传 `kb.TenantID`——与"部门=租户"零冲突；混合 KB IDs 时保守 404 不越权 |

## 二、补验：API 通道（signed_token 虚拟 principal）权限模型——**放权语义确认**

WeKnora 对 API 通道**不做任何用户级 enforcement**，四层模型对同一把 key 下所有外部用户完全相同：

| 层 | 机制 | 效果 | 证据 |
|---|------|------|------|
| 机器级路由门禁 | default-deny + capability any-of | 只看 key 不看用户；未声明路由一律 403 | `api_key_gate.go:130-153`（PlatformOnly 先于 FullAccess 拒绝 tenant key；PlatformOnly 需 ≥1 capability） |
| KB 白名单 | key 的 knowledge_base_ids | 只看 key；platform key 无白名单=对所声称租户全放行 | `tenant_api_key.go:376-385`、`kb_access.go:244-248` |
| 租户级 kb_access | 本租户 KB → OrgRoleAdmin | **对所声称租户的本租户 KB 读+写+管理全权**，无 principal 类型区分 | `kb_access.go:346-353` |
| 人类 RBAC | RequireRole / RequireOwnershipOrRole 全部短路 | **短路在角色判定之前**，creator lookup 不执行（有专门测试固化） | `rbac.go:74-77, 216-224, 322-332`、`rbac_api_key_shortcircuit_test.go:74-114` |

外部用户身份唯一作用=**数据隔离标签非权限**：会话归属（`api_external_user:{tid}:{sub}`，`principal.go:178-193`，`session.go:42-49`）与 MCP OAuth per-principal 状态。

**结论**：用户级权限判断由 Java 后端全权负责（决策 020 安全责任段的依据）。

## 三、两个额外发现（已写入契约）

1. **虚拟 principal 只经 tenant key 产生**：`auth.go:505-532`——platform key **忽略** `X-External-User-Token`（身份恒为 `api_platform:{keyID}`）。Java runtime 通道 = 目标部门租户的 tenant key + 该租户 api-principal-config signed_token 模式。
2. **platform key 机器身份不被 IsSyntheticUserID 识别**（`context_helpers.go:115-129` 只匹配 `system-` 前缀）：经 platform key 创建的资源 `creator_id` 记为 `api_platform:{keyID}`——跨通道 creator 不一致为**已知限制**（功能文档"已知限制"节）。

## 四、其他锚点（实施依据）

- capability 新增三步：常量（`tenant_api_key.go:158-165` 区）→ `NormalizeAPIKeyCapability` switch case（**必须**，否则创建端点拒绝且 gate 永不匹配）→ 路由 `apiKeyPlatform(...)` 声明（`rbac.go:234-240`）
- platform key 无 X-Tenant-ID 访问非白名单路由 → 409 TENANT_REQUIRED（`auth.go:442-453`）
- tenant key 带 X-Tenant-ID 指向其他租户 → 403（`auth.go:416-430`）
- `SwitchTenant(ctx, user, tenantID, "")`（空 refresh token）= "向成员校验过的指定租户签发登录响应"，bridge 直接复用（`user.go:1002-1060`）
- 服务列表方法为租户作用域（`interfaces/knowledgebase.go:59`），全系统列表仅在 Repository 接口（:182-188）→ 阶段二新增 `ListAllKnowledgeBases` service 方法（超管 portal 专用）

## 五、补验二：SwitchTenant 复用的副作用（2026-08-24，任务书一）

**问题**：幂等重推 bridge（用户在线期间 Java 侧重推）是否会吊销已签发、仍在使用中的 refresh token？

**结论：不会，零副作用。** 证据链：

1. `SwitchTenant` 的吊销块（`user.go:1040-1047`）只在 `currentRefreshToken` **非空**时执行 `RevokeToken(currentRefreshToken)`；bridge 恒传空串 → 吊销分支永不触发（注释原文："Best-effort revoke of the previous refresh token"，吊销对象是"请求中出示的旧 token"）。
2. `RevokeToken`（`user.go:1240-1250`）按 **token 全文值**吊销单条 auth_tokens 记录（`GetTokenByValue` → `IsRevoked=true`），**不是** `RevokeTokensByUserID`（全用户）——后者仅在 Logout/改密/bridge 的 Disable/Transfer 路径使用。
3. 真实 UserService 级测试固化（`identity_bridge_refresh_test.go`，提交 `db02555b`）：bridge → refreshA → 幂等重推 → **refreshA 仍可轮换、accessA 仍可校验、账本零吊销**（4 行 token 记录、revoked=0）。

**附带观察（非缺陷）**：HS256 签名确定性 + JWT `iat` 秒级精度 → **同一秒内的两次 bridge 会签发字节级相同的 refresh JWT**（相同凭证；测试中 sleep 1.1s 规避）。无安全影响，但意味着同秒重推的 auth_tokens 会出现两条同值记录；按值吊销（如 Logout）会同时命中——语义等效，无碍。
