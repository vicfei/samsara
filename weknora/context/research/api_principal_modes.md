# WeKnora API 集成面板·三种用户身份模式深入研究

> 日期：2026-08-27 | 全部结论有 file:line 证据；前端文案来自官方 i18n（zh-CN.ts:473-545）
> 结论先行：三种模式只决定"**会话归属标签**"（谁的 Session/MCP OAuth），**任何模式都不做用户级权限判定**——
> 操作权限永远 = API Key 的 capability 门禁 + KB 白名单 + 租户范围。

## 一、配置层：模式存在哪、怎么改

| 项 | 事实 | 证据 |
|---|---|---|
| 存储 | `tenants.api_principal_config`（JSONB；HMAC 密钥 AES-GCM 加密落库） | `types/tenant.go:119-120, 206-250` |
| 端点 | `GET/PUT /api/v1/tenants/:id/api-principal-config`，**Owner 门禁** | `routes_auth_tenant.go:101-102`，handler `tenant.go:898/933` |
| 三种合法值 | `tenant` / `direct_header` / `signed_token` | `tenant.go:940-945` |
| signed 模式硬约束 | 必须已配置 `hmac_secret`，否则 400 | `tenant.go:975-978` |
| 密钥回显语义 | GET 永不回明文（只有 `has_hmac_secret`）；PUT 传 `"***"` = 保留旧值，传新值 = **立即轮换**（旧密钥签的全部 token 即刻失效） | `tenant.go:956-970, 179-183`；前端轮换警告 zh-CN.ts |
| 请求头名 | 默认 `X-External-User-ID` / `X-External-User-Token`；**handler 目前固定写死默认值**（前端面板虽有输入框，后端 PUT 一律覆盖为默认） | `tenant.go:174-175, 967-968` |
| RequireDirectHeader | 仅 direct 模式有意义：true=缺头即 401；false=缺头**静默回落**仅空间身份 | `auth.go:578-585`；测试 `auth_api_principal_test.go:127` |

## 二、解析层：每种模式发生什么（middleware/auth.go resolveAPIPrincipal:561-609）

### 模式 1：仅空间（tenant）
- 无需任何身份头；Principal = `{api_tenant, "7"}`
- **会话归属**：`SessionOwnerIDFromContext` → `api_tenant_key:{tenantID}:{keyID}`（`principal.go:27, 183-188`）——
  注意粒度是"**每把 Key 一个桶**"：同一把 key 下所有调用方**共享全部会话**；换一把 key 会话分开。

### 模式 2：直接传用户 ID（direct_header）
- 请求带 `X-External-User-ID: external-u1` → 校验（≤128 字符、无控制字符，`auth.go:659-673`）→
  Principal = `{api_external_user, "7:external-u1"}`
- 会话归属 `api_external_user:7:external-u1`——按人分桶
- **安全本质：纯声明**。任何持有该 key 的人改个头就能冒充任意外部用户（**含劫持其 MCP OAuth 授权**——
  前端明确红字警告，zh-CN.ts directWarningDetail）；适用面=完全可信的服务器到服务器
- 缺头且未开 RequireDirectHeader → 回落仅空间身份（混合桶，排查容易懵）

### 模式 3：签名 Token（signed_token）——官方推荐的面向用户模式
- 请求带 `X-External-User-Token: <JWT>`，`verifyExternalUserJWT`（`auth.go:611-657`）逐条强制：
  ① HS256（其他算法拒）；② `aud=weknora`；③ **exp 必填且距今 ≤24h（声明更长的直接拒）**；
  ④ `tenant_id` claim 必须==该 key 所属租户；⑤ `sub` 必填且同字符集校验
- 会话归属同 direct 模式（按人分桶），但身份有**密码学背书**：只有持有 HMAC 密钥的可信后端能签
- 密钥只存在于两端（WeKnora 配置 + 业务后端），永不随请求传输

### 共同点（三种模式完全一致）
- **不查 users 表、不建号**——身份是"标签"不是账号
- RBAC 短路：`RequireRole/RequireOwnershipOrRole` 对 API-key principal 一律放行（`rbac.go:74-77, 216-224`），
  真实权限 = capability 门禁（默认拒绝）+ key 的 `knowledge_base_ids` 白名单 + 租户范围
- platform key **完全无视**这三种模式（忽略一切用户身份头，`auth.go:505-510`）——三模式只对 **tenant key** 生效

## 三、身份效果对照表

| | 仅空间 | 直接传用户ID | 签名Token |
|---|---|---|---|
| 需要的请求头 | 无 | X-External-User-ID（明文） | X-External-User-Token（JWT） |
| 身份可信度 | 无用户概念 | 声明式（可冒充） | HMAC 密码学证明 |
| 会话分桶粒度 | **每把 Key**（`api_tenant_key:{tid}:{keyID}`） | 每人（`api_external_user:{tid}:{sub}`） | 每人（同左） |
| 有效期约束 | — | — | exp 必填 ≤24h（拒绝更长） |
| MCP OAuth | 共用（key 级） | 按人（但可被冒充） | 按人 |
| 适用场景 | 纯后台批处理/无人交互 | 完全可信内网 S2S | 面向终端用户的应用（官方推荐） |
| 官方安全提示 | — | "请勿用于浏览器或不可信客户端" | "HMAC 密钥仅存两端，勿下发" |

## 四、配套工具（集成联调用）

1. **测试令牌端点**：`POST /api/v1/tenants/:id/api-principal-test-token`（Owner 门禁，`tenant.go:1021-1080`）
   ——仅 signed_token 模式可用；用**存储中的密钥**代签一张 ≤3600s 的 JWT（body: external_user_id + expires_in_seconds），
   返回 token + 过期时间。给 Java/联调方验证签名逻辑零成本。
2. **API Playground**（前端集成面板内）：选 key + 身份模式 + 外部用户 ID + 测试问题，
   真实跑"建 Session → Agent Chat SSE"两步并展示流式结果；signed 模式下自动用测试令牌端点代签
   （zh-CN.ts playground* 文案组）。

## 五、实操要点与坑（含我们 B1 的实践校验）

1. **exp 的 24h 是上限不是建议值**——声明 25h 会被直接拒（`auth.go:642-644`，有专门测试 RejectsLongLifetime）；
   B1 实践取 30 分钟每请求现签，兼顾密钥轮换即时生效
2. **轮换语义**：换 HMAC 密钥 = 所有在途 token 立即全体失效（无灰度），轮换窗口需后端同步换签发密钥
3. **direct 模式的静默回落**是最容易踩的坑：忘带头不报错，而是混进"仅空间"大桶——建议开 RequireDirectHeader
4. **模式切换即时生效**于该租户所有 key 的后续请求（每次请求都读租户配置）
5. **tenant_id claim 校验**：签 token 时 tenant_id 必须等于 key 所属租户，多租户网关常踩（RejectsWrongTenant 测试）
6. 与决策 020 的关系：三模式=API 通道的"用户级标签"机制，**不是用户级权限**——放权语义（Java 全责）
   正是建立在这个设计上；B1 评审时对 platform key 的否决也源于它无视这套机制
