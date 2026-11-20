# Java × WeKnora 分工方案 v2（管理侧 / WeKnora 自身）

> **日期**：2026-08-26（v2，任务划分重定义后重写；v1 的"Java 总控表+同步"架构**整体作废**，见 §七差异对照）
> **输入变化**：① WeKnora 是总控方对接的**唯一**子系统；② 任务划分定为 **Java=管理侧开发，Go=WeKnora 自身**；③ KIP 认证形态待调研（§六分岔）。
> **核心结论**：单一系统、两支团队——**数据 100% 落 WeKnora（Go）**，Java 交付管理控制台（前端+BFF），只通过 WeKnora 管理 API 操作，**不拥有数据库、不在运行时链路上、不持有终端用户会话**。跨系统同步/发件箱/对账全部不存在。

---

## 一、职责分工边界

| 职责 | Java（管理侧） | Go（WeKnora 自身） |
|---|---|---|
| 终端用户登录 | ❌ | ✅ OIDC 原生（`service/user.go:1491`）或 KIP callback（视调研，§六） |
| 授权数据（意图态+生效态） | ❌ 无库 | ✅ `user_space_grants` 扩展表（§二） |
| 授权管理界面（预授权/审批/有效期/回收） | ✅ 控制台前端+BFF | 提供 admin API（§三） |
| 空间管理（建团队/全员空间、改名、停用） | ✅ 界面 | API + `tenants.space_type` |
| 授权生效/到期回收 | ❌ 不参与 | ✅ 单库事务 + Go 内置到期清扫器 |
| 运行时 enforcement / 门户聚合 / KB 业务 | ❌ | ✅ 全部（复用现状） |
| 控制台自身的登录 | ✅ 走公司 SSO（Java 自理） | — |
| 审计 | 页面展示 | ✅ 原生 audit_log（管理员实名留痕） |

**治理冻结不变**（评审 G2）：团队/全员空间无真人 Owner（`handler/tenant.go:368` platform 建租户现状），原生成员管理 Owner 门禁（`routes_auth_tenant.go:112-115`）无人可过；管理侧经 system-admin 路由操作，不依赖 Owner。旁路监控：`/leave` 自离、孤儿自愈（`auth.go:796-813`）。

---

## 二、表规划（全部在 WeKnora，Java 零建表）

### 2.1 新增扩展表：`user_space_grants`（唯一新表，决策 004 外部壳模式）

| 列 | 说明 |
|---|---|
| id VARCHAR(36) PK | |
| uum_user_id VARCHAR(128) NOT NULL | **预授权的关键**：不要求 WeKnora 用户已存在（评审论断 8 的解法） |
| tenant_id BIGINT NOT NULL | 目标空间 |
| role VARCHAR(20) | admin / contributor / viewer（§五映射） |
| status VARCHAR(20) | `pending`（审批中）/ `active` / `expired` / `revoked` |
| valid_until TIMESTAMPTZ NULL | 到期清扫器置 expired 并移除 membership |
| requested_by / approved_by / reason | 审计字段（管理员实名） |
| created_at / updated_at | |
| UNIQUE(uum_user_id, tenant_id)；KEY(status)、KEY(tenant_id)、KEY(valid_until) | |

**生效机制（单库事务，无同步）**：
- grant→active（审批通过或直接生效）⇒ 同事务 `EnsureMembership(user, tenant, role)`（用户未建号则挂起，首次登录时补登，§四流程 1）；
- revoke/expire ⇒ 同事务 `RemoveMember`——**下一请求即 403**（评审 A3 实测），token 不吊销、其他空间不受影响。

### 2.2 schema 改动：`tenants.space_type`

迁移加列 varchar(16) default 'team'（personal/team/all）。tenant 无通用 config 列（评审 E1），这是唯一的原生表改动。空间登记=tenants 本身，**不需要 portal_space 表**。

### 2.3 复用/废弃

| 表 | 处置 |
|---|---|
| `tenant_members` | 复用不改——运行时生效态（grants 驱动） |
| `external_identities` | 复用——uum↔user 映射 + 首登补登依据 |
| `organizations` + `kb_shares` | 复用不改——跨空间共享通道 |
| `uum_departments` | **待拍板**：新模型不再依赖（空间登记在 tenants）；若 KIP 认证能返回部门则另有用途（§六） |
| Java v1 方案的三张表 | **作废**：portal_space/portal_user_space/portal_sync_outbox 均不需要 |

---

## 三、接口规划

### 3.1 WeKnora 侧（Go）——管理 API（给 Java 控制台）

**认证模式（推荐 A）**：
- **A. 管理员 JWT 透传**（推荐）：控制台管理员经 SSO 登录 WeKnora（拿到真实 JWT）→ SPA/BFF 带 JWT 调管理 API → 挂 `RequireSystemAdmin`（`middleware/rbac.go:147` 已有）→ **每个操作在 audit_log 里实名留痕**。CORS 中间件已存在（`router/router.go:107`），控制台 SPA 可直连，BFF 可选。
- B. platform key + 新 capability（`system_space_admin`）：BFF 实现最简，但操作留痕是 `api_platform:{keyID}`（决策 020 已知限制），管理动作失去实名审计。仅当管理员 SSO 走不通时降级使用。

**端点**（前缀 `/api/v1/admin`，均为 system-admin 门禁）：

| # | 端点 | 语义 |
|---|---|---|
| 1 | `GET /admin/spaces?space_type=&q=` | 空间清单（tenants + space_type + 成员/KB 计数） |
| 2 | `POST /admin/spaces` | 建团队/全员空间（tenants + space_type；不 bootstrap Owner） |
| 3 | `PUT /admin/spaces/:tenant_id` | 改名/停用（archived→portal 聚合排除） |
| 4 | `GET /admin/spaces/:tenant_id/grants?status=` | 该空间授权清单（join users 展示名；预授权行无用户也显示） |
| 5 | `POST /admin/grants` | 授权：直接 active 或 pending（预授权=uum_user_id 即可，无需建号） |
| 6 | `PUT /admin/grants/:id` | 审批通过（pending→active）/ 改角色 / 延长有效期 |
| 7 | `DELETE /admin/grants/:id` | 回收（revoke + 移除 membership，即时生效） |
| 8 | `GET /admin/grants?uum_user_id=&status=` | 按人查授权（控制台搜索） |
| 9 | `GET /admin/audit?type=grant` | 授权变更历史（audit_log 过滤） |

**内部组件**：GrantService（状态机 + 与 tenant_members 的同事务联动）、ExpirySweeper（定时扫 valid_until，过期→expired→移除 membership，WARN 审计日志）。

### 3.2 WeKnora 侧（Go）——终端用户侧

| # | 项 | 说明 |
|---|---|---|
| 10 | 首登授权应用 | OIDC/callback 建号后，按 uum_user_id 查 active grants → 补 memberships + external_identities 映射（复用 bridge 的 ensureMembership 思路，`service/identity_bridge.go:400-419`） |
| 11 | `GET /knowledge-bases?scope=portal` 升级 | 全部 active memberships ∪ space_type=all ∪ 共享；注入 tenant_name/space_type/role（现状证据：`handler/knowledgebase.go:745-836`） |
| 12 | 性能加固 | 去 `kbshare.go:283` N+1；membership 批量查询；分页 |
| 13 | P0 修复 | `handler/identity_bridge.go:36` is_new_user 去 omitempty（bridge 端点保留兼容，一行修） |
| 14 | 个人空间策略 | 无任何 active grant 的用户首登：lazy 建个人空间（create_personal，`user.go:163-177`）或进入引导页——待拍板② |

### 3.3 Java 侧（管理控制台）

| 模块 | 内容 |
|---|---|
| 前端 | 空间管理页、授权管理页（含预授权/审批队列/有效期编辑/批量导入？待定）、审计查询页 |
| BFF（可选） | 页面聚合、字段裁剪；直连模式（SPA+JWT+CORS）可省 |
| 不做的事 | 不建业务库（至多缓存）、不持有 platform key（模式 A 下）、不代理终端用户流量、不做到期调度 |

---

## 四、关键流程时序

1. **预授权→首登生效**：管理员在控制台给工号 E0001 建 pending grant→审批 active（此时 WeKnora 无此用户，membership 挂起）→ E0001 首次 SSO 登录→Go 建号（tenantless）→ 按活跃 grants 补 memberships+映射→签发 JWT。
2. **授权普通用户**：grant active→同事务 EnsureMembership→用户下次请求即可访问（无需重新登录，membership 每请求实时校验，`auth.go:750-765`）。
3. **回收/到期**：revoke 或清扫器→RemoveMember→**下一请求 403**（实测）→其余空间不受影响，token 不吊销。
4. **建团队空间**：控制台→POST /admin/spaces→tenants+space_type（无 Owner）→给成员建 grants。
5. **全员空间**：space_type=all 的单个租户，portal 聚合无条件并入；内容由科技管理员维护（is_system_admin + can_access_all_tenants，部署项开关）。

---

## 五、角色映射（提案，待拍板①）

| 控制台业务角色 | WeKnora 角色 | 说明 |
|---|---|---|
| 空间管理员 | **admin**（不发 owner） | 治理冻结：无真人 Owner；成员变更只走 grants |
| 编辑成员 | contributor | 原生语义：他人资源写操作硬 403（决策 018 修正） |
| 只读成员 | viewer | 共享场景叠加封顶 |
| 控制台管理员 | is_system_admin | 平台级，走 §3.1 认证模式 A |
| 个人空间本人 | owner | 原生 create_personal 语义 |

---

## 六、登录通道分岔（待 KIP 调研回填）

| KIP 认证形态 | Go 侧做法 | Java 侧做法 |
|---|---|---|
| **OIDC 兼容**（授权码） | 零开发：原生 OIDC（`/auth/oidc/*` 已有）+ 流程 1 的首登授权应用 | 无登录相关开发；`VITE_ENABLE_BRIDGE_LOGIN`/bridge 回跳链路**不启用** |
| **非标 ticket** | 新增 `/auth/kip/callback`：验 ticket→按 uum_user_id 找/建号（复用 bridge 内部逻辑）→应用 grants→签发→302 前端 | 同样无登录开发（回跳由 Go callback 直接做） |
| （若能返回部门/组） | 可选自动映射：部门→默认团队空间 grant、组→角色 | 控制台仅处理例外调整 |

> bridge 六端点处置：登录职责被上表取代后，`identity/*` 保留为运维/兼容通道（platform key），不在终端路径——待 KIP 结论后定去留。

---

## 七、与 v1 方案的差异对照（作废清单）

| v1（Java 总控表） | v2（本方案） |
|---|---|
| Java 建 portal_space / portal_user_space / outbox 三表 | ❌ 全作废 → WeKnora 一张 `user_space_grants` |
| 同步客户端/幂等重推/每日对账/事件顺序约束 | ❌ 不存在（单库事务） |
| Java 调 bridge 换票 + `#bridge_result` 回跳 | ❌ 登录回归 WeKnora（§六） |
| `identity/memberships` add/remove HTTP 端点 | 收敛为 GrantService 内部逻辑 + admin API |
| 到期调度器在 Java | 移入 Go（ExpirySweeper） |
| 保留不变 | P0 修复、tenants.space_type、portal 聚合升级、治理冻结、角色映射提案 |

> **会议决议变更提示**：旧会议"由总控方维护映射表、以总控表为准"的表述在本方案下正式失效（WeKnora 表即唯一事实）。建议下次架构会明确记录此变更，避免后续按旧决议对齐。

---

## 八、阶段与工作量（WeKnora/Go 侧）

| 阶段 | 内容 | 工作量【推测】 |
|---|---|---|
| P0 | is_new_user 修复 | 0.5 天 |
| P1 | grants 模块：迁移+表+GrantService+admin API 1-9+ExpirySweeper+单测 | 3-4 天 |
| P2 | portal 聚合升级+性能加固 | 2-3 天 |
| P3（视 KIP） | kip/callback 或 OIDC 配置+首登授权应用 | 1-2 天 / 0.5 天 |

Java 控制台可与 P1 并行（先按 §3.1 契约 mock）。

## 九、待拍板问题（收敛后开工）

1. 角色映射是否按 §五（空间管理员→admin）？
2. 无授权用户首登：lazy 建个人空间（提案）还是引导页报错？
3. 管理 API 认证：模式 A 管理员 JWT 透传（提案）还是 platform key？
4. KIP 认证形态（§六回填后定 P3 路线与 bridge 端点去留）？
5. `uum_departments`：废弃还是保留双轨？
6. `/leave` 自离与孤儿自愈：监控告警（提案）还是开关禁用？
7. 控制台形态：SPA 直连（CORS）还是带 BFF？
