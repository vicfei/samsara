# 开发进度追踪

**当前分支**: feature/tag-system（跟踪 kbpaamc；保护标签 pre-frontend-integration @f3e74298）
**最后更新时间**: 2026-08-24
**开发阶段**: 阶段一 ✅ + 任务3.4 ✅ + 阶段二 ✅ + 三任务书 ✅ + **前端集成 ✅（阶段 B，决策 022）**

## 已完成
- [x] 开发环境搭建（Go 1.26 + 容器依赖）
- [x] 设计文档撰写（权限/标签/Agent 方案）
- [x] 核心表结构导出（core_schema.sql）
- [x] **阶段一：层级标签树 CRUD**（2026-08-19，决策 010-016）
  - 迁移 000084 + Model/Repository/Service/Handler/路由/DI + 20 用例单测
  - 8 条 KB 作用域路由 `/knowledge-bases/:id/tag-tree/*`（硬删级联/叶子降级/移动环检测）
- [x] **任务 3.4：hybrid-search 标签预过滤集成**（2026-08-20，决策 017）
  - 源码验证五项推测（全部成立）→ `resolveDocumentTagScope` 文档型 KB 分流解析 + 5 用例 + 聊天链路契约文档
- [x] **阶段二：UUM 身份桥接 + 门户 KB 列表**（2026-08-21，决策 018/019/020）
  - [x] 15 条推测源码验证（9 属实/6 差异）+ 补验放权语义 → `.context/research/phase2_verification.md`
  - [x] 架构定稿：**部门=租户**（四层角色↔TenantRole，owner 唯选部门管理员）；2.3/2.4 确认原生零开发
  - [x] 迁移 000085（external_identities + uum_departments 双向 1:1 UNIQUE）
  - [x] IdentityBridge：6 端点（bridge 声明式/自愈补登/禁用两步组合/调岗清除映射/departments）+ `system_identity_bridge` capability（platform key）
  - [x] `?scope=portal` 门户列表（默认行为不变；超管跨租户全量/普通=本部门∪共享、kb_id 去重）
  - [x] 单测 13 个新用例（identity 7 + portal 5 + list-all 1）

- [x] **三任务书**（2026-08-24）
  - [x] 任务一：SwitchTenant 复用补验——**结论零吊销无副作用**（补验二存档 phase2_verification.md §五）+ 真实 UserService 级测试（`db02555b`；附带发现：同秒重推签发字节级相同 JWT，非缺陷）
  - [x] 任务二：标签树演示页 `misc/tag-tree-demo.html`（单文件零依赖，`dfd2379d`；CORS 免配置已验证，接口级全链路通过，浏览器人眼验收待用户）
  - [x] 任务三A：原生自动打标调研 → `research/native_autotag_analysis.md`（核心结论：**闭集选择不生成**；近义对"固收/固定收益"实验实锤同时命中；token 记账 ~626/文档）
  - [x] 任务三B：原生 Agent 调研 → `research/native_agent_analysis.md`（核心结论：审计缺口 token❌/引用⚠️/快照⚠️，结构化输出与敏感词❌；实测 quick-answer 5.6k tok/问、smart-reasoning 26k tok/问但 80% 缓存命中；最小补齐方案三件套已列）
  - [x] Swagger 修复重生成（`d91a95d0`：8 处非法多码 @Failure 注解拆分）

- [x] **前端集成（阶段 B，2026-08-24，决策 022）**
  - [x] 任务 0：Git 基线体检（差异上报：交接后用户已推双库+4 个 demo 提交，基线 `f3e74298`）+ set-upstream→kbpaamc + 保护标签 `pre-frontend-integration` 推 kbpaamc
  - [x] 标签树前端全链：api/纯函数/管理面板（KB 编辑器新分节）/选择器三挂点（聊天工具栏、文档筛选弹层"按层级浏览"、上传对话框）
  - [x] 门户列表：`?scope=portal` 单次调用 + 侧栏「门户」入口 + 跨租户徽标（管理员）
  - [x] bridge 登录：`#bridge_result=` hash 回调（守卫放行→App.vue 消费→清 hash）+ 登录页「门户统一登录」（VITE_PORTAL_LOGIN_URL 未配置隐藏）
  - [x] feature flag 三枚默认关闭（决策 022）；验收构建已开三 flag 并重启 :5173 preview
  - [x] 验证：前端 test 157/157 + check-i18n 11/11 + type-check ✅ + build ✅（NODE_OPTIONS=3072）+ 后端三连 69 包 ✅ + 端到端冒烟（登录/portal 经 5173 代理）

### 提交记录（决策 009 细粒度）
| 提交 | 内容 |
|------|------|
| `3f88b023`~`67368654` | 阶段一 tag-tree（5 提交） |
| `8634fb51`/`23daea1d`/`fb819ff2` | 任务 3.4 检索集成（3 提交） |
| `39d2b795` | feat(identity): add 000085 migration and identity bridge models |
| `653feb3b` | feat(identity): add identity bridge repository |
| `a4c3b570` | feat(identity): add identity bridge service |
| `7656c6d2` | feat(identity): add handler, routes and DI wiring |
| `2ef9d500` | test(identity): add identity bridge unit tests |
| `d32aaaa6` | feat(portal): add scope=portal merged KB list |
| `10349d6c`→`ef714cda` | test(portal): cover scope=portal list handler（amend 并入 agent/tools mock 修复） |
| `d91a95d0` | chore(docs): fix malformed swag failure annotation and regenerate docs |
| `db02555b` | test(identity): cover refresh survivability across re-bridge |
| `dfd2379d` | feat(misc): add tag tree demo page |
| `e405f540`~`f3e74298` | 用户 demo 导航页（4 提交，双库已推） |
| `6a319857` | feat(frontend): tag tree api module, feature flags and pure tree helpers |
| `84393ee5` | feat(frontend): tag tree settings panel with KB editor mount |
| `1618e23d` | feat(frontend): tag tree picker and chat filter integration |
| `552c182c` | feat(frontend): mount tag tree picker in doc filter and upload dialog |
| `71f831e3` | feat(frontend): add portal scope knowledge base list |
| `7b1bfe6d` | feat(frontend): add UUM bridge login callback and portal entry |
| `73816248` | fix(frontend): resolve type-check errors in tag tree integration |

> 推送约定（决策 021）：完工交付标准动作 = `git push origin` + `git push kbpaamc` 双库推送，回报附结果。

## 进行中
- （无）

## v2 路线开发（2026-08-27，与 B1 并行 POC）

**WeKnora 侧（feature/tag-system，9 提交 `5eb7a0db`..`02b194d1`，68 包测试全绿）**
- [x] P0：bridge `is_new_user` 去 omitempty（契约修复，真机验证重推正常渲染 false）
- [x] P1a：迁移 000086（`user_space_grants` 表 + `tenants.space_type`，sqlite init 同步）+ Model（含预授权语义/空间类型常量）
- [x] P1b：Repository + GrantService 状态机（pending→active→expired/revoked；owner 角色拒绝；收敛式清扫器）+ 单测 7 用例
- [x] P1c：Admin API 9 端点（`/api/v1/admin/spaces*` + `/admin/grants*`，RequireSystemAdmin 门禁，JWT 实名审计）
- [x] P1d：bridge 无 tenant_id=个人空间 bootstrap（Register 标 personal）+ 登录时应用活跃 grants + 后台清扫器（5min+启动即扫）
- [x] P2：scope=portal 聚合升级（全部 active memberships ∪ 各租户共享；注入 tenant_name/space_type/my_role；共享来源租户元数据批量补齐；降级模式保持旧行为）
- [x] misc/v2-admin-console.html 测试脚手架（空间/授权/审批/回收单页）
- [x] Swagger 重生成；验收临时 key 已清

**真机验收记录（tenant 10008 团队/10009 公共/10010 个人）**
- 预授权→首登落地：grant 先于建号创建（active）→ 无 tenant_id bridge → 个人空间(owner)+团队(contributor) 双 membership ✓
- 聚合：个人 KB(personal/owner) + 团队 KB(team/contributor) 同时返回，字段齐全 ✓
- 回收即时性：DELETE grant 后同一 token 访问团队 KB 403、个人 KB 200、聚合同步收敛 ✓
- 系统管理员：WEKNORA_BOOTSTRAP_SYSTEM_ADMIN_EMAIL 真机提升 review-v2-admin ✓（注意：服务器重启会使旧 JWT 失效需重新 bridge）
- 待办：全员空间经组织共享的端到端（org+share 运维步骤已列 division_plan §四-5，单测已覆盖语义）；Java 控制台对接 Swagger 契约

**门户体验补齐（2026-08-27 下午，回应"进入后和原生一模一样"）**
- [x] 前端门户分组视图（`a8d43567`）：portal 范围按 个人空间/团队空间/公司公共/共享给我 分组渲染（分组标题内插卡片流、i18n 四语言、159 测试全绿）；跨租户徽标升级显示 tenant_name（关闭 progress 已知限制项）
- [x] 全员空间组织共享链路真机搭建：org「全员共享组」+ 成员（10007 owner/10008/10009/10010）+ 公共库「公司公告与制度库」share viewer——公共内容经 org-share 到达所有成员租户（显示与访问同源，零侵入 kb_access）
- [x] 修复：个人空间 space_type 曾因旧进程未含补丁而落 team（进程 10:43 启动早于二进制 10:44 写入）——重建重启+存量修正后，U0001/U0002 聚合验证三组/双视角全对
- [x] 演示矩阵：U0001=个人(owner)+团队(contributor)+公共(admin)；U0002=团队(viewer)+公共(via share, viewer)；review-v2-admin=系统管理员
- 门户替身：vicfei/WeKnora-portal-sim（:8082，SSO 模拟→无 tenant_id bridge→302 前端 #bridge_result；/api/* 透明反代零权限逻辑；admin 页经反代调 /admin API）

**初始化提示与跨空间聊天修复（2026-08-27 下午续）**
- [x] "部分知识库尚未初始化"横幅：v2 空间租户（10008/09/10/11）此前无模型、演示 KB 裸建——已 SQL 复制三类模型（Embedding/KnowledgeQA/Rerank）+ 回填 4 个 KB 的 embedding/summary 字段，banner 条件（isInitialized）清空
- [x] 跨空间聊天链路（个人空间会话 ↔ 公共库）实测打通：需注意两点原生语义——①聊天 KB 解析按**当前活跃空间**的 org 可达性（所有演示个人空间已补入全员共享组）；②summary 模型按**调用方租户**解析，跨租户共享库聊天需带 summary_model_id（API 实测带参回答正确引用 公告.md；浏览器端若模型选择器默认空，首次发送前需在输入框选择模型——待浏览器验证）
- [x] 公共库内容：公告.md（经营目标/保密制度/平台指引）已上传解析完成
- 遗留备注：未来新用户的个人空间不会自动有模型/自动入组（原生期望用户走设置页自助配置；生产方案需拍板：bridge bootstrap 时复制默认模型+自动入全员组，或走原生初始化向导）

**B1 对照物（WeKnora-portal-proxy 仓库）**：POC 全部完成（见其 .context/sessions/progress.md）

## 汇报日 Check 清单（演示当天早上逐条执行，全部通过再开演）

```bash
# ── ① 服务四连查（全应 OK/200）─────────────────────────
curl -s http://localhost:8080/health
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/swagger/index.html   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/                     # 200
sudo docker ps --format '{{.Names}}={{.Status}}' | grep -E 'postgres|redis|docreader'

# ── ② 演示 token 刷新（demo01；正式账号同理换密码）─────
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -d '{"email":"demo01@test.local","password":"demo123456"}' | jq -r .token)
echo "token: ${TOKEN:0:16}..."

# ── ③ 四个演示环节验证 ─────────────────────────────────
# 环节1 原生前端+@标签：浏览器登录 http://<IP>:5173 （标签池检查↓，应 7 个：AI/计算机视觉/生成式/理解式/智能体/固收/权益）
sudo docker exec WeKnora-postgres-dev psql -U postgres -d WeKnora -tc \
 "SELECT string_agg(name,',') FROM knowledge_tags WHERE knowledge_base_id='a4b23c87-fa92-4376-a1f6-ff68c5c97dd6';"
# 环节2 标签树：test 库投研树应返回（投研→固收/权益）
curl -s http://localhost:8080/api/v1/knowledge-bases/a4b23c87-fa92-4376-a1f6-ff68c5c97dd6/tag-tree -H "Authorization: Bearer $TOKEN" | jq '.data[] | {name, children: [.children[].name]}'
# 环节3 自动打标实验数据：应 3 文档/6 关联（含 固收+固定收益 同文档）
sudo docker exec WeKnora-postgres-dev psql -U postgres -d WeKnora -c \
 "SELECT k.title, t.name FROM knowledge_tag_relations r JOIN knowledges k ON r.knowledge_id=k.id JOIN knowledge_tags t ON r.tag_id=t.id WHERE k.knowledge_base_id='269d53b0-090c-4c97-998d-5f23cc5bb908';"
# 环节4 门户列表（scope=portal，普通账号 demo01）：返回数量 > 0
curl -s "http://localhost:8080/api/v1/knowledge-bases?scope=portal" -H "Authorization: Bearer $TOKEN" | jq '.data | length'

# ── ④ 故障降级 ─────────────────────────────────────────
# 后端挂：pkill -x weknora-server; (source ~/WeKnora/dev.env && cd ~/WeKnora && setsid nohup /tmp/weknora-server >> /tmp/weknora-server.log 2>&1 &)
# 前端挂：cd ~/WeKnora/frontend && setsid nohup npx vite preview --port 5173 --host >> /tmp/weknora-frontend.log 2>&1 &
# 页面打不开（公网问题）：ssh -L 5173:localhost:5173 -L 8080:localhost:8080 ubuntu@<IP> 后访问 localhost
```

> 演示导航页：`misc/demo-index.html`（双击打开，卡片含 curl 备份命令与演示要点）。汇报统计数据快照（2026-08-24）：18 提交 / 38 文件 +10,994−2,030 行 / 功能代码 ~4,300 行 / 40 新测试用例 / Swagger 261 路径含二开 14 端点 + 2 改造。

### bridge 现场实跑资产（2026-08-24 v2 重建，操作卡见 demo-index.html 第 5 卡）

- 预建演示租户：「汇报演示部」**id=10003**；演示部门 ID：`DEPT-DEMO`；虚构员工：`DEMO9001`（用户名"演示员工"）
- 临时 platform key **v2**（id=4，仅 `system_identity_bridge`，name="汇报演示临时用v2"）——完整 key 在会话交付回报中，**不入任何文件**；交付附 sha256+长度供接收方自查（v1 因交付转写错 2 字符导致 401，非系统问题）
- 实跑验证已通过且**干净空场已确认**（清理后 GET mapping 回到 404；第 0 步 PUT departments 当天也是全新执行）
- **可靠性结论**：key 为 DB 哈希存储（`tenant_api_key.go:217` 裸 SHA-256 查库、无缓存无进程态）——**重启/过夜不失效**；汇报日清单的"①开场 404 检查"同时校验 key 有效性，一步两得，无需额外加"当天重建 key"步骤

### 演示后清理（汇报结束执行，一条命令回收 key/员工/部门）

```bash
sudo docker exec WeKnora-postgres-dev psql -U postgres -d WeKnora -c \
 "DELETE FROM tenant_api_keys WHERE name='汇报演示临时用v2';
  DELETE FROM external_identities WHERE uum_user_id='DEMO9001';
  DELETE FROM tenant_members WHERE tenant_id=10003;
  DELETE FROM users WHERE username='演示员工';
  DELETE FROM uum_departments WHERE uum_department_id='DEPT-DEMO';
  DELETE FROM tenants WHERE id=10003 AND name='汇报演示部';"
```

## 待办
- [ ] 【非主线·引用】四方案（A/B/C/D-Java）对比、记分扩展与 Java 对接谈判记录见
      `.context/research/route_comparison_4way.md`（独立文档，不并入主线；若拍板 D 需回主线补正式决策）
- [ ] 阶段三剩余：自动打标服务（`auto_tag_suggestions` 表 + LLM 提取 + 审核 API；需先配模型）
- [ ] 阶段四：Agent 合规审计（`agent_execution_audit` 表 + 合规检查 + 强制溯源）
- [x] 前端集成（决策 006 延后 → 2026-08-24 完成，决策 022）：树选择器、门户列表 scope=portal、bridge 登录对接 ✅（浏览器人眼验收待用户）
- [ ] 部署项：`enable_cross_tenant_access: true`（科技管理员跨租户浏览，见功能文档 §3.1）
- [ ] 前端集成后续（用户拍板后）：Java 门户上线时配 `VITE_PORTAL_LOGIN_URL`；portal 跨租户徽标显示 tenant_name（现为 ID，后端无此字段）；正式启用三 flag 的常规构建策略

## 备注
- `.context` 目录被 `.gitignore` 忽略（本地元数据，不入库）。
- 服务启动时 `AUTO_MIGRATE`（默认开）自动应用 000084/000085 迁移。
- 阶段二文档同步清单：功能文档（§3.1 定稿/§6 契约/§7 模块/§9 修正）、数据模型（OTM/两表/§7.1）、外部接口（§10 角色修正/§17 bridge 契约/§18 portal）、knowledge_base_filter.md 作废、decisions 018-020、research/phase2_verification.md。

## 2026-09-07 上游回馈进度（新加坡节点）
- 2026-09-07 / #3022→PR #3069 / https://github.com/Tencent/WeKnora/pull/3069 —— 已合并（2.4h），官方授权回退修复落地
- 2026-09-07 / #3035→PR #3036（bocha）/ https://github.com/Tencent/WeKnora/pull/3036 —— 已合并，bocha 成为官方 provider
- 2026-09-07 / 登记簿合并 / .context/upstream-issues-register-merged-20260907.md —— 沪 12 项+新 15 项合并，执行顺序定稿（U-03 起）
- 2026-09-08 / U-03 排序核心双路径重复 / https://github.com/Tencent/WeKnora/issues/3093 —— 英文 issue 已开（upstream/main@647848f3 亲验两份实现+漂移证据，查重无冲突），待维护者认可后切分支提 PR
- 2026-09-08 / #2991→PR #3096 / https://github.com/Tencent/WeKnora/pull/3096 —— 已合并（约20h），编辑角色智能体编辑器 403 断依赖链修复落地
