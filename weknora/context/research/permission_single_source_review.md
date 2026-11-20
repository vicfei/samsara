# 权限唯一事实源方案 · 代码级评审报告（零建表可行性 + 空间模型裁决）

> **日期**：2026-08-26 | **分支**：feature/tag-system @ `73816248`
> **性质**：只读评审（未改任何功能代码）；含一次受控实测复现（临时租户/用户/key，已全部清理，演示数据 10003/DEMO9001 未触碰，预存 key id=4 未动）
> **证据基准**：全部结论给 file:line；无证据的判断标注【推测】

---

## 一、第一任务书 13 条论断核实表

| # | 论断 | 代码证据 | 结论 |
|---|------|----------|------|
| 1 | UUM↔用户映射存 WeKnora 侧，Java 无需自存 | `internal/types/external_identity.go:8-19`（`external_identities`，UNIQUE(uum_user_id,tenant_id)） | **属实** |
| 2 | 部门↔租户 1:1 双向唯一存 WeKnora 侧 | `internal/types/external_identity.go:24-33`（`uum_departments`，两列各 uniqueIndex）；冲突 409 `service/identity_bridge.go:352-354` | **属实** |
| 3 | "某用户能看哪些库"有现成读接口 scope=portal | `internal/handler/knowledgebase.go:580-583, 745-836` | **有偏差**：语义是"**当前 active 租户** ∪ 共享"，不是"该用户的全部空间"（详见 D1） |
| 4 | 权限写入链路闭环（bridge/transfer/disable，幂等，platform key 保护） | 路由 `internal/router/routes_identity_bridge.go:25-36`（6 端点全 `apiKeyPlatform(system_identity_bridge)`）；bridge 幂等实测 200 无重复建号；transfer 幂等 `service/identity_bridge.go:239-243` | **有偏差**：闭环只覆盖"整租户进/移/换"，**没有"从单个空间移除"端点**（见 C3） |
| 5 | 对账能力存在（mapping 查询接口） | `routes_identity_bridge.go:31-34`（GET mapping/:uum、GET mapping/by-user/:uid） | **有偏差**：只有**单点查询**，无"按部门查全员/全量 diff"批量对账接口 |
| 6 | 权限裁决是运行时本地查表，毫秒级 | 每请求 `memberService.GetMembership`：`internal/middleware/auth.go:750-765`（resolveTenantRole）；KB 链 `internal/middleware/kb_access.go:320-387`；无外部调用 | **属实** |
| 7 | scope=portal 查询复杂度 | 共享列表 5 表 join：`internal/application/repository/kbshare.go:150-166`（kb_shares⟕knowledge_bases⟕otm⟕organizations，索引齐备 `migrations/000012:69-73`、`000045:44-50`）；**N+1**：`service/kbshare.go:283`（逐 share `GetTenantMember`）；另批量 share counts + creator names；**无分页无缓存**（响应全量数组） | **部分属实**：索引撑得住中规模；全公司并发首页需去 N+1 + 分页/缓存加固 |
| 8 | "预授权"（人未建号先配权限）无法表达 | `external_identities.user_id NOT NULL`（`external_identity.go:11`）且只在建号后写入（`service/identity_bridge.go:153-161`）；`tenant_members.user_id NOT NULL`（`types/tenant_member.go:91`） | **属实**：WeKnora 侧无处存放"未生效授权" |
| 9 | tenant_members 无有效期字段 | `types/tenant_member.go:86-107`（仅 JoinedAt，无 expires）；`kb_shares` 同样无有效期（`types/organization.go:196-219`） | **属实**：临时授权 30 天自动回收不可表达 |
| 10 | 无"审批中"等流程状态字段 | `tenant_members.Status` **有** `invited/suspended`（`tenant_member.go:63-78`）；组织加入申请有 pending/approved/rejected 工作流（`types/organization.go:134-141`） | **有偏差**：存在成员状态位与组织审批流，但**权限授予本身**（share/membership 的 role 变更）确无审批态 |
| 11 | kb_shares 以组织为桥梁；库级可见性有部分原生承载 | 共享前提：KB 属本租户 + 本租户在 org 且 editor+（`service/kbshare.go:78-130`）；共享对象=组织；被共享方=org 内全部租户（`repository/kbshare.go:150-166` otm join） | **属实**：粒度=组织(租户集合)×三档权限；不能 per-user、无有效期 |
| 12 | bridge 换票模型 + is_new_user:null 疑点 | 见 §二实测复现 | **疑点已查明**：`omitempty` 剔除 false 值，非报错，是契约缺陷 |
| 13 | 部门管理员原生界面手工改成员可绕过 Java | Add/改角色/Remove = **Owner 专属**（`routes_auth_tenant.go:112-115`，头注释 :20-23）；invitations 同 Owner（:129-131）；**POST /:id/leave = Viewer+**（:116，用户可自离） | **属实**：双写漂移风险真实，且比预想多一条 `/leave` 自离旁路 |

---

## 二、第 12 条疑点：实测复现结论（已清理现场）

**现象复现**（临时租户 10005「评审测试部-临时」+ 测试工号 REVIEW-T0001 + 临时 platform key id=5，均已删除，空场已验证）：

1. 第 1 次 bridge → HTTP 200，`data.is_new_user: true`，memberships=[{tenant_id, tenant_name, role:"viewer"}]。
2. 第 2 次 bridge（幂等重推，间隔 >1s）→ **HTTP 200，success:true，完整登录响应（新 token/refresh_token，无重复建号）**。但响应 `data` 的键列表为：`active_tenant, memberships, message, refresh_token, success, token, user` —— **没有 `is_new_user` 字段**。
3. `jq '.data.is_new_user'` → `null`（jq 对缺失键输出 null）。

**根因**：`internal/handler/identity_bridge.go:36`

```go
type bridgeLoginResponse struct {
	dto.AuthLoginResponse
	IsNewUser bool `json:"is_new_user,omitempty"`   // ← omitempty 把 false 整个从 JSON 剔除
}
```

Go 的 `omitempty` 对 bool=false 省略字段 → 首推（true）可见、重推（false）消失 → jq 显示 null，观感像报错响应。

**结论**：不是 bug 级故障（响应语义仍可判读：字段缺席=false），但是**契约缺陷**，一行修复（去掉 `omitempty`）。建议列入最小改动清单。

**附带核实**：access JWT 24h / refresh 7d（`service/user.go:936-964`）；disable 即时吊销（`identity_bridge.go:208` RevokeTokensByUserID，`repository/user.go:333`）——与文档一致。

---

## 三、第二任务书 A1–G2 核验表

### A. tenant 与成员

| # | 结论 | 证据 |
|---|------|------|
| A1 | **属实**：tenant 适合承载"空间"。KB 归属 tenant（`types/knowledgebase.go:71`）；tenant_members=user×tenant 角色，一人一行/租户（`types/tenant_member.go:80-107`）；一人多租户=多行（部分唯一索引 `migrations/000043:40`）。且**原生注册默认一人一租户**（"个人空间=tenant"是原生行为：`service/user.go:154-177` create_personal + EnsureOwner :209-217；bridge 用的才是 tenantless :132-137） | — |
| A2 | **属实**：active tenant 判定优先级 = X-Tenant-ID（校验 `IsTenantAccessible`：home/跨租户超管/active membership，`middleware/access.go:77-101`）＞ JWT tenant_id claim（缺失回落 user.TenantID）＞ 首个 active membership（`middleware/auth.go:284-338`）。`/auth/switch-tenant` = 校验 membership 后**重签 token**（`service/user.go:1002-1060`，handler `handler/auth.go:801-830`）。前端每请求带 X-Tenant-ID（`frontend/src/utils/request.ts:47-58`） | — |
| A3 | **移除成员后 token 立即失效（实测）**：同一 JWT，移除前 200，移除后 403 "not a member of the target workspace"。机理：ValidateToken 只查签名+吊销表，不查 membership 也不查 is_active（`service/user.go:1067-1113`），但**每个请求**的 resolveTenantRole 实时查 tenant_members，无 active 行即 403（`middleware/auth.go:750-765`，EnableRBAC 默认 fail-closed `config.go:241-246`）。refresh 路径：不直接查 membership，但 GenerateTokens→resolveLoginTenantID 会验证 preferred/home 的 membership 并回落（`user.go:766-845`），拿到的 token 指向剩余 membership 或 tenantless（后续请求 TENANT_REQUIRED，`auth.go:212-224`）。switch-tenant 校验 membership（`user.go:1017-1028`）。**例外**：CanAccessAllTenants+开关无视 membership（`auth.go:786-791`） | — |

### B. organization 与 kb_shares

| # | 结论 | 证据 |
|---|------|------|
| B1 | **属实**：OTM 是 (org, tenant, role) 租户级成员；`representative_user_id` 注释明示"informational only…Permission checks are driven exclusively by (org, tenant, role)" | `types/organization.go:109-127` |
| B2 | **属实**：permission 三档合法（`IsValid` admin/editor/viewer，`organization.go:22-29`；DDL 无 CHECK 默认 viewer，migration 000012:57-67）；有效权限=MinOrgRole(share.permission, org role)（`kbshare.go:478`）→ 租户角色 viewer 封顶（`kbshare.go:64-73`）→ 多 share 取最高（`kbshare.go:481`） | — |
| B3 | **属实**：本租户 KB 在 kb_access 第 1 步直接 OrgRoleAdmin，不经 CheckTenantKBPermission（`kb_access.go:346-353`）；链=own(:346)→org-shared(:358-372)→shared-agent 只读(:374-383) | — |

### C. identity bridge 现状

| # | 结论 | 证据 / 改动点 |
|---|------|------|
| C1 | **bridge 必带 tenant_id**（==0 即 400；binding required）。只有 user_id 无法 bootstrap 个人空间。改造点：① `service/identity_bridge.go:65-67` 放行 TenantID==0 → 走 `Register(create_personal)`（原生个人租户路径已存在 `user.go:163-177`）+ 建映射；② `external_identities.tenant_id` NOT NULL（`external_identity.go:12`）需允许 0 或改语义 | — |
| C2 | **memberships 内容够显示不够分组**：[{tenant_id, tenant_name, role}]（`types/tenant_member.go:117-121`；构建 `user.go:324-392` 只含 active、过滤已删租户；实测响应吻合）。**缺 space_type** → 前端无法区分个人/团队/全员空间 | — |
| C3 | **disable=全局**（is_active=false+全 token 吊销，`identity_bridge.go:187-218`）；**transfer 只适合 A→B**（移出源+吊销全部 token，兼任不可用，:225-305）；**无"移出单空间"端点**（`routes_identity_bridge.go` 仅 6 条）。最小改动：①新增 POST /identity/memberships/remove（platform key，调 memberService.RemoveMember——**无需吊销 token**，A3 已证即时生效）；或②**零后端改动**：Java 用 tenant key + `manage_members` capability 调原生 DELETE /tenants/:id/members/:user_id（路由已对 API key 声明，`routes_auth_tenant.go:115`；RequireRole 对 API-key principal 短路 `middleware/rbac.go:71-77`） | — |
| C4 | **RevokeTokensByUserID=全用户吊销**（`repository/user.go:333`；auth_tokens 无 tenant 维度），不支持按租户吊销。**但不需要**：移除 membership 即等于按空间即时吊销（A3 实测）。即时失效方案=RemoveMember；全局失效=disable | — |

### D. portal 列表现状

| # | 结论 | 证据 |
|---|------|------|
| D1 | **"当前 active tenant ∪ 共享"，非"全部 memberships ∪ 共享"**。超管=is_system_admin → ListAllKnowledgeBases 全系统非临时 KB（`knowledgebase.go:753-765`，service `service/knowledgebase.go:408-427`）；普通用户=ctx 租户作用域 ListKnowledgeBases（:769）∪ ListSharedKnowledgeBases（:795），kb_id 去重本租户优先（:802-811） | — |
| D2 | 所有条目含 tenant_id（KB 模型 json 序列化，`types/knowledgebase.go:71`）；共享项额外带 shared/share_id/organization_id/org_name/permission/source_tenant_id/shared_at（`knowledgebase.go:821-829`）。**缺**：tenant_name（决策 022 已知限制）、space_type（不存在）、own 条目的当前用户角色。分组所需增量=tenant_name + space_type（+可选 role） | — |
| D3 | 改动点集中 `listKnowledgeBasesPortal`（`knowledgebase.go:745-836`）：ListByUser 取全部 active memberships → 逐租户 KB 列表 → 并入公共空间 → 注入 tenant_name/space_type。性能风险：① N memberships×(KB 列表+计数)；② 共享链 per-share GetTenantMember N+1（`kbshare.go:283`）；③ 无分页无缓存，全公司并发需加固 | — |

### E. 全员空间实现

| # | 结论 | 证据 |
|---|------|------|
| E1 | **tenants 没有 config 通用列**——只有 typed JSONB 字段（RetrieverEngines/ContextConfig/ParserEngineConfig…，`types/tenant.go:86-127`）。space_type 需**新列**（迁移先例充足）或 hack 进 Description/Business（不建议） | — |
| E2 | org 共享方案的爆炸点：org 成员=租户行，个人空间若也是 tenant 且全员入 org → 行数=员工数；**MemberLimit 默认 200/模型默认 50**（`service/organization.go:21-22`；`types/organization.go:90`）必须调大；且"全员可见"会被做成"共享"语义（viewer 封顶/三档权限），与"空间"概念并列混淆 | — |
| E3 | **推荐方案一**（公共 tenant+portal 聚合并入），理由见 §五 | — |

### F. user↔KB 直连 ACL

| # | 结论 | 证据 |
|---|------|------|
| F1 | **原生无 user 级 KB ACL**（枚举）：裁决链只有 own/org-shared/shared-agent 三步且全部租户级（`kb_access.go:320-387`）；kb_shares 无 user 维度（`organization.go:196-219`）；migrations 无 user×kb ACL 表（仅 user_kb_pins UI 置顶，000050）。自建 user_kb 表的冲突：WeKnora 中间件不认识该表 → 列表可见性（租户级）与详情 404/403 永远对不上，除非侵入改 kb_access 链 | — |
| F2 | **与决策 020 直接冲突成立**：坚持 user↔KB 表只能把终端流量逼到 API 通道（tenant key+signed_token 虚拟 principal，WeKnora 无用户级 enforcement，phase2 §二）——违反"API 通道不代理终端用户检索问答流量"（`外部接口.md §17.4` 第 3 条、决策 020）。且 WeKnora 前端已完成的集成（标签树/portal/bridge 登录）将整体作废 | — |

### G. 安全与治理

| # | 结论 | 证据 |
|---|------|------|
| G1 | **部分有挂点**：`/auth/config`（no-auth）返回 registration_mode 供前端藏注册入口（`handler/auth.go:771-783`），支持 invite_only（注册可关）；bridge 登录按钮=VITE_ENABLE_BRIDGE_LOGIN+VITE_PORTAL_LOGIN_URL（`Login.vue:426-428`、`features/common/flags.ts:28-36`）；OIDC 原生支持。**没有"关闭密码登录"的后端开关**：/auth/login 在白名单（`middleware/auth.go:39`），Login.vue 密码表单无条件渲染。前端藏表单=零后端；真禁用需小改造 | — |
| G2 | **现有守卫可支撑大半**：成员 Add/改/Remove=Owner 专属（`routes_auth_tenant.go:112-115`）→ **团队租户不设真人 Owner 即冻结原生成员管理**（platform key 建租户不 bootstrap owner：`handler/tenant.go:368` `!platformCaller` 分支）。两条旁路：① `POST /:id/leave` Viewer+ 用户自离（:116）；② 孤儿自愈：租户被清空成员后，home=该租户的用户 re-bridge 会被晋升 Owner（`auth.go:796-813`，bridged tenantless 用户 home 会被 `user.go:877-909` 指向首个 membership）。另：tenant key 带 manage_members/full access 也能动成员（`routes_auth_tenant.go:112-115` apiKeyRoute 声明）→ 凭证发放纪律 | — |

---

## 四、A3 实测记录（临时数据，已清理）

- 临时租户 10005「评审测试部-临时」+ REVIEW-T0001 + platform key id=5（capabilities=[system_identity_bridge]）。
- bridge①：200，is_new_user=true；bridge②（>1s 后）：200，success=true，**无 is_new_user 字段**（§二根因）。
- 用 bridge② token 调 GET /knowledge-bases：**200**；SQL 删除该 tenant_members 行后同 token 重放：**403 "not a member of the target workspace"**。
- 清理：auth_tokens 4 行、external_identities、users、uum_departments、tenants(10005)、key id=5 全删，空场核验 0/0/0；预存 key id=1/2（已吊销）与 id=4（演示用，未演出）保持原样。

---

## 五、架构裁决与献策

### 5.1 对初步倾向的裁决

| 倾向 | 裁决 | 依据 |
|------|------|------|
| space=tenant | **成立** | A1：原生个人空间本就是 tenant（create_personal）；多人空间=tenant+memberships |
| Java 维护 user_space 作 SoT，tenant_members 作运行时投影 | **成立（带前提）** | WeKnora 表达力缺口（预授权 8/有效期 9/审批 10）客观存在，Java 主表正好承载"意图态"，WeKnora 承载"生效态"。前提=①写入只经扩展 bridge 端点（单向 Java→WeKnora，Java 永远赢）；②WeKnora 侧冻结原生写入口（G2 手段）；③bridge 声明式幂等天然是同步补偿机制（Java 重推即自愈） |
| portal=全空间聚合 | **成立但需改造** | D1/D3：现为 active tenant ∪ 共享；需改"全部 active memberships ∪ 公共空间 ∪ 共享"+注入 tenant_name/space_type+性能加固 |
| 不做 user↔KB 直连 ACL | **强烈成立** | F1/F2：与决策 020 冲突，WeKnora enforcement 认不认 Java 表无解 |

**必须修正的三个认知**：
1. **token 治理比预想简单**：移除 membership 即时生效（A3 实测），不需要按租户吊销 token；RevokeTokensByUserID 只留给全局 disable。
2. **团队空间关系"由 Java 编辑"目前缺端点**：现有 bridge 只有整租户进/移/换（C3）；移出单空间要么新增端点、要么用 tenant key manage_members 调原生路由（零后端改动，推荐起步用后者）。
3. **全员空间选方案一**：org 共享方案有 MemberLimit 默认 200、权限语义混淆、个人租户入 org 膨胀三重问题（E2）；公共 tenant+聚合并入最干净（E1 需加 space_type 列）。

### 5.2 三方案比较

| 维度 | A：Java 主表+投影（推荐） | B：关系表落 WeKnora（零建表） | C：user↔KB 直连 ACL |
|------|------|------|------|
| 数据一致性 | 单向同步，Java 赢；bridge 幂等=自愈补偿；冻结写入口后无双写 | 单事实源最优；但预授权/有效期要么放弃要么改 WeKnora 原生表（加列=侵入） | 最差：WeKnora 不认识 Java 表，两边永不一致 |
| 运行时性能 | 等价（都本地查表，断言 6） | 等价 | Java 网关每请求裁决，加一跳 |
| 可用性 | WeKnora 挂→门户挂（KB 本体在此，任何方案同）；Java 挂→存量用户仍可用已投影空间 | 同 A | 最差：Java 挂→全挂 |
| 改造成本 | WeKnora：bridge 扩展+space_type+portal 聚合；Java：建表+推送 | WeKnora：改更多（表结构+portal）；Java：薄 | WeKnora 前端集成全作废+中间件改造 |
| 与决策 020 | 无冲突 | 无冲突 | **正面冲突**（API 通道不代理终端流量） |
| 会议"总控表"定位 | **满足**（user_space 即总控表的 WeKnora 投射） | **不满足**（权限数据锁死 WeKnora 库，KIP 其他系统拿不到） | 满足但代价不可接受 |

### 5.3 推荐最终设计（方案 A 改良版）

- **空间模型**：space=tenant。个人空间=每用户一 tenant（bridge 无 tenant_id 时 bootstrap，需改造 C1）；团队空间=tenant+memberships；全员空间=1 个公共 tenant（space_type=all，tenants 新列）。
- **表归属**：Java `user_space(user_id, space_id, space_type, role, status[pending/active/expired], valid_until)`=意图态/总控；WeKnora tenant_members=生效态投影。预授权、30 天到期、审批流全部活在 Java，只把终态推给 WeKnora。
- **同步契约**：生效事件→WeKnora bridge 扩展端点（`POST /identity/memberships` 幂等 add/role；`DELETE` 移除，即时生效）+现有 transfer/disable；对账=定时批量 diff（建议 WeKnora 补"按部门查全员映射"批量端点）；Java 侧重推队列+每日全量对账兜底。
- **portal 聚合语义**：全部 active memberships 的 KB ∪ space_type=all 公共 KB ∪ 共享 KB；响应注入 tenant_name/space_type/role；membership 数通常 <5，逐租户查询可批量化（IN），共享链去 N+1，加分页/上限。
- **全员空间**：方案一。不用 org 共享（E2 三重问题）。
- **token 失效**：空间级=RemoveMember（即时，A3 实证）；全局=disable 两步组合（保留）；**不建按 tenant 吊销**。
- **治理冻结**：团队/公共租户不设真人 Owner（platform key 建租户现状即如此，tenant.go:368）；成员变更只经 Java 凭 platform key；治理两条旁路（/leave 自离、孤儿自愈晋升）需监控或后续加开关；tenant key 发放纪律：不给 manage_members/full access（除非明确要 Java 直调原生成员端点的过渡方案）。

### 5.4 最小改动清单（WeKnora 侧，按优先级）

1. `internal/handler/identity_bridge.go:36` 去掉 `is_new_user` 的 `omitempty`（一行，修契约缺陷，§二）。
2. 新增 memberships add/remove 端点（platform key；remove 即时生效；起步可先用 tenant key manage_members 过渡）。
3. bridge 支持 tenant_id 缺省=bootstrap 个人空间（C1 两处改动）。
4. tenants 加 `space_type` 列（迁移）+ portal 聚合改造 + 响应注入 tenant_name/space_type。
5. portal 性能加固：共享链去 N+1（`kbshare.go:283`）+ 分页/上限。
6. 【待拍板】按部门批量对账端点；【待拍板】/auth/login 密码登录开关（G1）。

### 5.5 待用户拍板

1. Java user_space 的角色档位：直接用 WeKnora 四档，还是业务三档（管理员/编辑/只读）映射到四档？
2. 全员空间 KB 的维护者与写权限（is_system_admin 全量可见已够读；写归谁）？
3. `/leave` 自离与孤儿自愈两条旁路：接受+监控，还是加开关禁用？
4. 同步失败补偿：Java 重推队列为主，还是每日全量对账为主？
5. 过渡期是否用 tenant key manage_members 直调原生成员端点（零后端改动）先行？

---

## 附：本报告未做/不适用项

- 未评估阶段三/四（自动打标/Agent 审计）任何内容。
- 断言 7 的"全公司并发"量化压测未做（无真实规模数据），复杂度结论基于查询结构与索引静态分析。
- 【推测】标注项：无（本报告全部结论有 file:line 或实测支撑）。
