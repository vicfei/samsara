# 进度追踪

**仓库**：vicfei/WeKnora-portal-proxy（main）| **最后更新**：2026-08-26 | **阶段**：设计定稿，未开工编码

## 已完成

- [x] 路线拍板：B1 独立代理（decisions D001）
- [x] 仓库骨架：cmd/proxy 健康检查入口，build/vet 通过（db2d5d1）
- [x] 设计文档四件套：架构/功能/数据模型/外部接口（.context/design/）
- [x] DDL：.context/schema/portal_proxy.sql（四表+索引+种子模板）
- [x] 决策记录 D001-D010

## 待办（POC 开发，建议顺序）

**M0 环境准备 ✅（2026-08-26）**
- [x] WeKnora 侧三件套：租户 **10006「B1测试公司库」**（demo01 挂 Owner，embedding 模型已复制 text-embedding-v4）/ tenant key id=7（name=portal-proxy-poc，caps=retrieve+ingest+chat）/ signed_token 已配（header=X-External-User-Token）
- [x] **通道冒烟通过**：tenant key + 自签外部 JWT（sub=REVIEW-U0001）调 GET /knowledge-bases → 200，返回 3 KB
- [x] 建库灌种子：portal_proxy 库 + schema + 员工 4 名（REVIEW-A0001 管理员 / U0001-U0003，密码统一 `review123456`，bcrypt）
- [x] 测试 KB ×3 + 文档：中国移动年报研究/金融Agent行业研究/泡泡玛特研究（10006 租户内，/home/ubuntu/docs/ 三份 PDF 已上传且 parse_status=completed）
- [x] 种子授权 5 条：U0001×中国移动(editor,团队)+泡泡玛特(viewer,**已过期行演示**)；U0002×中国移动(viewer,团队)+金融Agent(viewer,公共)；U0003×金融Agent(editor,团队)；**泡泡玛特对 U0002/U0003 无授权=越权验证点**
- [x] 密钥落点：`.env`（600 权限，gitignored，含 TENANT_ID=10006/KEY/HMAC/COOKIE_SECRET/DB_DSN）

**M1 骨架与登录 ✅（2026-08-26）**
- [x] config（env 加载，env 变量优先）+ store（pgx，四表 CRUD）
- [x] SSO 模拟（authorize/一次性 code 60s/callback 只回 uum_user_id）+ 会话中间件（每请求查 is_active）+ /logout
- [x] /healthz + /healthz/weknora（探测 key 有效性）

**M2 权限引擎与 KB 浏览 ✅**
- [x] weknora 客户端：三件套头 + 外部 JWT 签发（30min TTL）+ ListKBs/GetKB/ListDocs/HybridSearch/Upload
- [x] perm 引擎：FilterKBs/Authorize/CanEdit + 单测 9 用例（越权/过期/revoked/editor 优先）
- [x] 首页分组列表（个人/团队/公共）+ KB 详情页 + 检索转发

**M3 问答 ✅**
- [x] 会话创建/列表（按人 sub 隔离实测：U0002 看不到 U0001 会话）
- [x] SSE 流式转发（逐 chunk Flush；kb_ids 逐个裁决后转发；字段映射 query_text→query）
- [x] 完整事件流实测：agent_query/tool_call/session_title/references/thinking/answer/complete，回答带 KB 引用

**M4 管理后台 ✅**
- [x] 管理页三视图 + /api/admin/* 全套（管理员 403 门禁实测）
- [x] 上传转发：editor 200 / viewer 403 / 无授权 404（三分支实测）

**M5 验收与清场（2026-08-26 冒烟通过）**
- [x] 剧本 1-6 全部通过（登录/分组过滤/检索/SSE 问答/上传分权/越权 404+审计）；剧本 7 过期行经种子数据验证（短时到期实时场景留演示）
- [ ] POC 演示给决策方 → 与 v2 对比记分 → 路线裁决
- 补充发现：WeKnora 租户 10006 需配齐 Embedding+KnowledgeQA+Rerank 三类模型（已 SQL 复制）；knowledge-chat 请求字段为 query（非 query_text）

> 运行方式：`/tmp/portal-proxy -env /home/ubuntu/WeKnora-portal-proxy/.env`（日志 /tmp/portal-proxy.log）

## 验收剧本（与 v2 路线共用同一考题）

1. 登录（SSO 模拟）：REVIEW-U0001 登录成功；错误密码拒绝；is_active=false 拒绝；
2. 分组 KB 列表：U0001 只见被授权的 KB，按 个人/团队/公共 分组；
3. 检索：进 KB 发一次 hybrid-search，有结果；
4. 问答：创建会话→SSE 提问→流式回答带引用；会话列表只见自己的；
5. 上传：U0001(editor) 上传成功；U0002(viewer) 上传入口 403；
6. 越权验证：U0002 访问未授权 KB → 404 + audit_log 出现 denied 记录；
7. 有效期：给 U0002 建一条 valid_until=1 分钟的授权，到期后访问该 KB 变 404。

## 纪律（POC 期间持续生效）

1. WeKnora 仓库零接触——需要改它才能继续时，停下重新评估路线；
2. tenant key 不给 full access；密钥只进 env；
3. 测试数据 `REVIEW-` 前缀；不碰演示租户 10003/DEMO9001；
4. 并行时间盒：与 v2 POC 同步推进，到期按记分卡拍板，输方归档不删不再投入。

## B1 清场命令（若路线落选，按序执行）

```bash
# portal 侧
sudo docker exec WeKnora-postgres-dev psql -U postgres -c "DROP DATABASE portal_proxy;"
rm ~/WeKnora-portal-proxy/.env
# WeKnora 侧（10006 全部测试数据；demo01 的 owner 行与租户级联删除）
sudo docker exec WeKnora-postgres-dev psql -U postgres -d WeKnora -c "
 DELETE FROM tenant_api_keys WHERE tenant_id=10006;
 DELETE FROM kb_shares WHERE source_tenant_id=10006;
 DELETE FROM tenants WHERE id=10006;"   # tenants 级联清 knowledge_bases/knowledges/chunks/embeddings/tenant_members（应用层删除语义）
sudo docker exec WeKnora-postgres-dev psql -U postgres -d WeKnora -c "DELETE FROM models WHERE tenant_id=10006;"
```
