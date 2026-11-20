# 关键决策记录

## D001：路线定位 = B1（独立代理服务），2026-08-26 用户拍板

- 独立仓库/进程，WeKnora fork **零代码改动**是路线存在前提；
- 与 v2（grants 空间模型）并行 POC，共用同一验收剧本，时间盒后按记分卡裁决；
- 已知并接受：与 WeKnora 决策 020"API 通道不代理终端流量"的冲突（评审记录在案），仅限 POC 验证范围。

## D002：凭证通道 = tenant key + signed_token，明确不用 platform key

- platform key 忽略用户身份头（WeKnora `middleware/auth.go:505-510`）→ 会话/审计坍缩为单一机器身份；
- tenant key + 按人签发的 X-External-User-Token 产生 `api_external_user:{tid}:{sub}` 虚拟 principal，
  WeKnora 会话列表天然按人隔离（`repository/session.go:24-25`）——这是 B1 唯一可用的会话隔离自救方案。

## D003：权限表独立数据库 portal_proxy

- 与 WeKnora 库物理隔离；POC 清场 = `DROP DATABASE portal_proxy` 一条命令；
- 不复制 KB 元数据（名称/统计实时拉 WeKnora），杜绝双写漂移。

## D004：SSO 模拟按 OAuth 授权码流程建模

- /sso/authorize（登录页）→ code（一次性、60s、绑 redirect_uri）→ callback 换身份；
- **callback 只返回 uum_user_id**（模拟"SSO 只返回 user_id"口径）——保证将来接真 KIP 时只换 adapter 不动骨架。

## D005：POC 技术栈从简——标准库 + html/template，不建前端工程

- net/http + html/template + database/sql(pgx) + golang-jwt/v5；不引入 gin、不建 Vue 工程；
- 理由：三个页面的 POC，单二进制零构建链最省；SSE 用 fetch 消费即可；
- 代价：页面观感朴素；若路线胜出转正式开发，前端部分推倒换 Vue（届时另立决策）。

## D006：.context 目录 gitignore（沿用 WeKnora 惯例）

- 本地元数据不入库；团队共享文档如需要另建 docs/ 提交，不取消忽略。

## D007：外部 JWT 每请求现签，exp=30 分钟

- 远低于 WeKnora 24h 红线；无 token 缓存状态，密钥轮换即时生效；
- sub=uum_user_id（过 validateExternalUserID：≤128、无控制字符）。

## D008：实名审计只在代理侧（audit_log）

- WeKnora 侧只见机器+虚拟 principal（决策 020 已知限制）；授权变更、登录登出、**越权拦截（denied）**全记本地 audit_log；
- 越权返回 404（不泄露 KB 存在性）而非 403——与"未命中权限表"不可区分。

## D009：权限有效期采用读取时惰性判定，不做后台清扫器

- POC 简化：`status='active' AND (valid_until IS NULL OR valid_until>now())` 即生效；
- 胜出转正式时升级为定时清扫 + status 落库（对齐 v2 方案 ExpirySweeper 设计）。

## D010：推送约定

- 单远程 origin（私有库 vicfei/WeKnora-portal-proxy）；凭据用一次性 `-c credential.helper=store`（新仓库已配则免）；
- 敏感值零落盘（决策 021 同款纪律）：tenant key / HMAC / cookie 密钥只进 env。
