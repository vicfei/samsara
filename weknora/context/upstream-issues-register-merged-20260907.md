# 上游问题登记簿 · 沪新合并版（2026-09-07）

> **合并来源**：
> - 沪（U-01~U-12）：`.context/upstream-issues-register-20260907.md`（git 权威版 kbpaamc/feature/weighted-ranking docs/ @ 5837b0d6，md5 已核对一致）
> - 新（S-13~S-27）：新加坡节点第 4~5 棒实测/源码定位（#3022 修复、bocha PR、权限评审、时效分析）
> **维护规则**：沿用原登记簿（证据必须 file:line/日志/复现步骤；回馈前先在 upstream/main 复现；分支从 upstream/main 切；密钥自查）。
> **基线**：upstream/main = 647848f3（2026-09-07）；原登记簿证据的 5 个核心文件在 3d3bb7f6→647848f3 偏移段（34 提交）零改动，行号漂移风险低。
> **本文件为追加合并产物，未改动原登记簿。**

## 状态速报（2026-09-07 晚）

- **PR #3069（#3022 消息级图片代理 403 修复）已合并**（05:21 创建 → 07:43 合并，2.4h）——S-01 主项闭环
- **PR #3036（bocha 搜索引擎）已合并**（09-05 创建 → 09-07 12:06 合并）
- PR #3062（opencode 插件）仍 open 无 review
- 时效参考（1200 PR 样本）：长尾外部合并中位 0.33 天，拒绝中位 4.2 天，未决晾置中位 38.8 天

## 合并总览（U-xx 保留沪编号，S-xx 为新增；★=PR 可行性）

| # | 优先级 | 问题 | 类型 | ★ | 状态 |
|---|---|---|---|---|---|
| U-01 | P0 | chat 链路不接 rerank，精排死代码 | 设计缺陷 | ★★★ | 待回馈（旗舰，issue 先行） |
| U-02 | P0 | 单路降级分数不归一，复合分饱和 | bug | ★★★ | 待修 |
| U-03 | P1 | compositeScore/applyMMR 双路径重复 | 代码重复 | ★★★ | 热身首选 |
| U-04 | P1 | SSE 偶发不收尾（DB 有答案无 complete） | bug | ★★ | 待定位根因 |
| U-05 | P1 | embedding 批量调用无退避节流（429 连环） | 韧性缺失 | ★★ | 待修 |
| U-06 | P2 | 向量失败静默降级无观测标记 | 设计缺陷 | ★★ | 待修 |
| U-07 | P2 | 会话标题并行抢答+零校验 | 设计不合理 | ★★ | 待修 |
| U-08 | P2 | 前端 streame.ts 白名单重建请求体 | 脆弱设计 | ★★ | fork 已防 |
| U-09 | P2 | 快速问答默认全租户库且不可见 | 产品设计 | ★ | 先 issue 讨论 |
| U-10 | P3 | 引导遮罩拦截/模式切换无引导/图标无 aria | UX/a11y | ★（aria ★★★） | aria 项=理想首 PR |
| U-11 | P3 | status/parse_status/enable_status 语义混乱 | API 一致性 | ★ | 需讨论 |
| U-12 | P3 | ~~KB 质心缓存不持久~~（fork kb_router 特性缺口） | fork 资产 | — | 不回馈上游 |
| S-13 | P1 | 通用 /files 端点 KB 共享授权缺口（#2017，与已合并 #3069 同族） | bug | ★★★ | 待回馈（修法已验证） |
| S-14 | P2 | hydrateProtectedFileImages 把 403 JSON 当 blob（空白图） | 前端 bug | ★★ | 先 issue 确认（聊天 UX 敏感区） |
| S-15 | P2 | 提取图片不建 resource_bindings（生命周期模型断裂） | 数据模型 | ★★ | 先讨论（改摄取管线） |
| S-16 | P3 | TestSkillPythonVerifier 依赖宿主 Python 环境 | 测试脆弱 | ★★★ | 小修可提 |
| S-17 | P3 | swagger 全量重生成混入无关漂移 | 工具链 | ★ | 记录在案 |
| S-18 | P2 | 新 provider 需 4 处独立接线（枚举+元信息/适配器/container/服务层双 switch） | 注册点散射 | ★★★ | 单一事实源改造可提（bocha PR 实证此坑） |
| S-19 | P3 | web_search AND 语义（agent&&请求级）静默不搜 | 语义陷阱 | ★★ | 至少日志/文档 |
| S-20 | P3 | agent 模型绑定隐式约束（KnowledgeQA 同租户+rerank 必配）报错不指向原因 | 错误提示 | ★★ | 小修可提 |
| S-21 | P3 | web_fetch 对 wN 缓存 ID 报 invalid_url | 工具层怪癖 | ★ | 记录在案需定位 |
| S-22 | P2 | scope=portal 语义="当前租户∪共享"≠用户全空间 | API 语义 | ★ | 需讨论 |
| S-23 | P2 | identity bridge 无单空间移除/批量对账 | 能力缺口 | ★ | 需讨论 |
| S-24 | P2 | 共享列表 N+1（逐 share GetTenantMember）+无分页缓存 | 性能 | ★★★ | 可修可测 |
| S-25 | P3 | 授权无有效期/审批态/per-user 粒度 | 模型表达力 | ★ | 需讨论 |
| S-26 | P2 | bridgeLoginResponse omitempty 剔除 is_new_user:false | API 契约 | ★★★ | 小修好提（我们实测复现过） |
| S-27 | P3 | /leave 自离旁路 + Owner 专属管理 → 双写漂移 | 权限旁路 | ★ | 记录在案 |
| S-F1 | fork | golang-migrate 编号静默跳过陷阱 | 结构性 | — | fork 运维债（FORK-MIGRATIONS.md），不回馈 |
| S-F2 | fork | U-12 同项（质心缓存） | — | — | 同 U-12 |

## 新增项证据要点（详细过程见 sessions/handoff-20260905-realitycheck.md 09-07 两节）

- **S-13**：issue #2017 报告通用 `/files` 端点 wiki 场景同类 403；#3069 修复的 KBAccessRead 回退模式可直接复用；#3069 已合并=该修复方向获官方认可，PR 可行性上调。
- **S-15**：实测 KB 文档提取图片（kind=image）无 resource_bindings 行，仅 source_file 绑定；knowledge_delete.go 靠扫 chunk 文本反查 URL 删图；#3069 修复被迫绕行消息引用链。
- **S-18**：bocha PR 实测 `/types`+`/test` 全过但 POST 创建被拒 `invalid provider type: bocha`——`web_search_provider.go` 的 isValidProviderType 白名单与 validateProviderParameters switch 是第 4 接线点（大小写敏感 grep 还会漏常量名）。
- **S-24/S-26**：见 research/permission_single_source_review.md（2026-08-26，全 file:line）：kbshare.go:283 N+1；identity_bridge.go:36 omitempty。
- **S-16**：2026-09-07 实测 `go test ./internal/...` 唯一失败项，stash 后基线同样失败（Python 3.12 venv 行为差异）。

## 执行顺序（合并版，沿用沪建议+新项插入）

1. **U-03**（零风险热身）→ 2. **U-10 aria**（首 PR）→ 3. **U-02**（小修+单测）→ 4. **S-13**（修法已被 #3069 验证，快赢）→ 5. **U-01**（旗舰，issue 先行带评测数字）→ 6. **U-05/U-07/S-26/S-24** → 其余按"先定位/先讨论/记录在案"处置。

## 新加坡侧未完全理解项（动手前需补课）

1. **U-04 根因**：仅掌握症状（DB 有答案、complete 未发），流式 writer 异常路径未读——沪也标注"待定位"，需先加日志复现。
2. **U-01 细节**：search-only 入口的 RerankModelID 自动解析（session_knowledge_qa.go ~:905-918）未读原文；fork 的评测报告数字无法在本节点独立复算（无 100 题池环境），issue 引用时注明来源为 fork 实验。
3. **U-02 细节**：retriever.EngineAwareNormalizer（knowledgebase_search.go:249）具体行为未读。
4. **U-12/fork kb_router**：质心缓存实现零接触——fork 资产，不回馈，无需补课，仅登记。
5. 沪证据行号基于 fork feature/weighted-ranking，upstream/main 已验证零漂移（34 提交不涉 5 文件），但逐项动手时仍以 upstream/main 行号为准。

---

## 【2026-09-08 归属勘误】（用户质询 bridge 归属后对 upstream/main 逐一核验）

- **勘误起因**：S-26 原证据锚在 fork 的 identity_bridge.go:36，未按纪律先锚定 upstream/main。
- **核验结论**：
  - identity bridge 全家（6 端点 / external_identities 表 / UUM 映射）**upstream/main 零存在**（文件、符号、表迁移全无；FORK-MIGRATIONS.md 明列 20260821154919 external_identities 为 fork 自有迁移）→ 属二开资产。**S-23（bridge 能力缺口）、S-22（scope=portal）随之移出上游回馈清单，归 fork 侧。**
  - **S-26 缺陷本身上游独立存在**：`internal/handler/dto/auth.go:25` `IsNewUser bool json:"is_new_user,omitempty"`——fork 的 bridge 响应即抄自此模板。上游受影响端点：`/auth/login`（auth.go:289/296）、auto-setup（:881/:946）、register-by-invite（register_by_invite.go:228）；IsNewUser=true 出现于 OIDC 首登（user.go:559）。**S-26 保留为上游候选项，但证据需重新锚定：原"两次 bridge 实测"是 fork 侧证据，不随迁；须在 upstream/main 实测 /auth/login 或 OIDC 首登复现后方可提 issue。**
  - 复核其余权限项归属：S-24（kbshare.go N+1）/S-25（无有效期字段）/S-27（/leave 旁路）均为 upstream 代码（#3022 工作期间亲读亲验），不受影响。
- **对排序结论的修订**：S-26 从"可即刻开工（75-85%）"降为"需先 30-60 分钟上游复现再开工"；复现后其影响面从窄端点升级为**核心登录端点**，合并概率评估反而上修。S-18 不受影响，成为当前唯一"即刻可开工"的新增项。
- **教训入册**：跨节点接力的证据必须逐条重锚 upstream/main（本登记簿"维护规则"第 3 条的本意），"评审档案 file:line"不豁免。

## 【2026-09-08 S-26 复现结论：成立，范围第二次收窄】
- **第二次锚点修正**：`AuthLoginResponse`（/auth/login、switch-tenant、auto-setup、register-by-invite）**没有** IsNewUser 字段——昨日勘误把它们列入受影响端点是错的。`is_new_user` 仅存在于 `AuthOIDCCallbackResponse`（dto/auth.go:25）。
- **最终范围**：仅 OIDC 回调。完整链路（全部 upstream/main @647848f3 亲验）：
  ① user.go LoginWithOIDC：仅当回调开户（首登）isNewUser=true，存量用户恒 false；
  ② dto/auth.go:25 omitempty → false 时字段整个消失；③ auth.go:449-460：payload 经
  encodeOIDCCallbackPayload（json.Marshal→base64→redirect #oidc_result=）投递；
  ④ frontend/src 零消费 is_new_user——受众=程序化 OIDC 集成方。
- **复现记录**：pristine upstream/main detached worktree，经上游自己的投递边界函数
  encodeOIDCCallbackPayload 构造两态 payload（测试留档
  .context/research/s26_oidc_isnewuser_repro_test.go）：
  - 首登：{"success":true,...,"is_new_user":true}
  - 后续：{"success":true,...}（字段消失）
  同一端点 payload 形状随登录次数变化，消费方被迫以"缺字段=非新用户"兜底。
- **评级修订**：技术成立但影响面收窄（OIDC 集成者专用，前端不受影响），
  合并概率从 75-85% 下修至约 60-75%；修复仍是一行 tag + 序列化断言测试。
  提 issue 时以"同端点响应形状不对称"为核心论点，附上述两份 payload 对比。

## 【2026-09-08 U-03 已开 issue #3093】
- 验读结论（upstream/main@647848f3 亲读）：重复属实且漂移具体化——agent 版 compositeScore 多
  positionPrior(±0.05 位置先验) chat 版没有（同一 chunk 在 chat/agent 两面排名不同）；applyMMR 两份
  结构不同（chat 朴素扫描+ParallelMap vs agent 增量 maxRedundancy 缓存，agent 注释自证输出等价）。
  两份已共用 searchutil 原语，agent 的 searchResultWithMeta 内嵌 *types.SearchResult → 共享化无障碍。
- issue #3093 已提交（英文，含对照表/合并理由/唯一语义决策点=positionPrior 是否统一）；
  查重干净（#2194 统一检索特性、#1485 去重行为，均非本项）。
- 下一步：维护者认可或 48h 无异议后，从 upstream/main 切分支提取共享包提 PR。

## 【2026-09-08 晚 S-13 撤销：#2017 已被上游修复】
- 复现核验结论（代码级，upstream/main@647848f3）：**#2017 场景已在上游解决，无需回馈**。
  证据链：①前端已有完整 ProtectedFileAccessContext 体系（frontend/src/utils/protectedFileAccess.ts，
  四代理单一真相源，含 knowledgeBase 模式，注释明说解决"共享 KB 内容属主租户对象"）；②三个渲染
  调用点全部传入该模式——WikiBrowser.vue:866（注释原文即 #2017 根因"tenant-scoped /files rejects
  cross-tenant"）、doc-content.vue:809、manual-knowledge-editor.vue:428；③引入提交族=18739bb1
  （消息级代理同一批，v0.8.0 前后）。issue #2017 报告于 UI 0.6.3 时代，属于"已修未关"。
- 启示：S-13 曾被评为"修法已被 #3069 背书的快赢"——但"同族问题存在"不等于"仍未修复"，30 分钟
  现状核验再一次救了提交（否则又要交一记乌龙）。
- 会话/聊天方向候选池刷新（2026-09-08）：#3014 官方已修（closed/completed）；#2706 已被外部
  认领（ktz03 "I'd like to take this"）；存活候选=#320（回溯重复文档，无人认领，评论均为用户
  报告）、#950（agent 循环，深水区）。

## 【2026-09-08 深夜 #320 复现核验：已修未关，撤销回馈候选】
- 复现（官方实例，运行镜像与 upstream/main 相关文件零漂移）：单句 txt + KB 配 summary 模型 →
  解析/摘要完成（1 text 块 + 1 summary 块，ChunkTypeSummary 独立可检索块，knowledge_process.go:1317
  为刻意设计）→ 提问后 knowledge_references 仅 1 条（只命中摘要块），第二轮 0 条——当前管线在
  该场景连"原文+摘要双引用"的数据形态都不再稳定出现。
- UI 层：现行回溯抽屉 ChatReferencesDrawer 经 mergeDocumentReferences 按 knowledge_id 合并同文档
  多块（referenceSources.ts:196/206），上游单测"aggregates chunks from the same document"明确钉住
  该行为；合并逻辑 2026-07 落地（3209ed77/53a66a64），晚于 issue（2025-09-17）10 个月——典型已修未关。
- 评论侧信息：PAPA-L"一个是原文一个是摘要"确认旧症状机理；另两位评论（总参考固定 5 个文档）是
  另一个问题（检索多样性），不在本项范围。
- 结论：#320 无 PR 可提。会话/聊天方向外部池终局：#3022 已由我方完成，#3014/#2017/#320 均已修未关，
  #2706 被外部认领，仅剩 #950（深水）。**该方向的可持续供给=我方第一手登记簿（U-04/U-07 等）**。

## 【2026-09-10 候选池维护：U-05 撤出 + S-16 挂起重验】
- **U-05（embedding 429 退避）撤出候选**：外部 PR #3005「fix(embedding): recover from transient
  failures and resume」（dzc-bit，09-09 开、在审）覆盖同域，避免撞车。
- **S-16（TestSkillPythonVerifier 宿主 Python 依赖）挂起重验**：上游 09-09 连合 #3140/#3143 两个
  skills 运行时修复（runtime prerequisites / installer guidance），其前提可能已被顺带改变，
  动手前必须重锚现状。
- U-03 收官记录：PR **#3150** 已开（09-10 10:00 CST，分支 refactor/unify-ranking-core@6d492ba2，
  #3093 引用评论同发；夜间定时任务卡死未触发，已删任务改为手动执行——cron 机制不可靠，此后窗口
  类动作一律手动）。

## 【2026-09-10 #3142 复现核验：非 bug，按设计工作（第 6 次现状核验拦截）】
- issue 内容：邀请链接注册的用户侧栏无「共享空间」入口，报告者以为邀请用户缺共享能力（v8.0）。
- 核验（upstream/main@b60351f1 代码级）：①菜单门控 `hasRole('admin')` 为显式设计
  （menu.ts:66-78 注释自证「仅 admin/owner 暴露」）；②后端组织操作全量 `g.Admin()` 且服务层
  要求调用者空间=组织所有者（routes_agent.go:97-130），前后端镜像；③邀请注册用户
  TenantProvisioningTenantless 不建自有空间、角色由邀请单必填指定（auth_register_by_invite.go:183、
  tenant_invitation.go:65）；④**报告者真实场景（部门成员建库分享给同事）由 KB 级共享覆盖且
  Contributor 即可**：POST /knowledge-bases/:id/shares 守卫=OwnedKBOrAdmin（routes_agent.go:180），
  agent 同理（:201）；⑤#2627（09-09 才合）与此无关——它只改 invite_only 下"登录后加入"流，
  且报告版本 v8.0 不含该变更。
- 处置：已发中文解释评论（issuecomment-5611638919），含 file:line 证据 + KB 设置分享的正确通路
  +「成员级共享空间」若需要应另开 feature request。
- 入册：外部池新鲜件第 6 例"验后翻空"（#2017/#320/#3098/#3014/#2706/#3142）——先核验后动手的
  纪律持续兑现；下一枪回归登记簿（S-18 仍为即刻可开工首选）。

## 【2026-09-10 U-14 已开 issue #3158】
- 查重干净（#2981=开放窗口配置诉求，根因不同，正文已作 related 引用）；**S-18 评估降级**：模型
  provider 半边被既有 #904（refactor model provider registry）覆盖，若提只剩 web-search 接线切片。
- 证据自包含化：upstream/main 合成测量（每库 ~2KB 严格线性：10 库 20.7KB / 100 库 206KB / 541 库
  1.12MB≈58 万字符），临时测量测试跑完即删；真实部署观测值（541 库→首条用户消息 219,319 token、
  单题 ~260 万 token）以"large multi-KB deployment"口径脱敏引用，无账户/跑批细节。
- 锚点：prompts.go:130-200（无总量上限+description 不截断+FAQ 10 条全文）、observe.go:510-562
  （每轮注入当前用户消息）、engine.go:642（无超窗拒发守卫）；叙事框架="v0.8.0 头版特性 compaction
  的结构性盲区（出生缺陷 vs 累积增长）"。
- 修复双提案：①fail-fast 超窗守卫（止血，~5 行）②目录预算化（N 个全量+其余仅名称、描述截断、
  FAQ 同治）。48h 窗口至 09-12 上午（CST）或维护者回应即出 PR。
- 本日连带发现：#3147（跨会话持久记忆）与 v0.8.0 已发布特性重复（search_memory/画像记忆链路
  代码已验证），可作 15 分钟级答疑；v0.8.0 changelog 中译已存会话（dsh-weknora 官方发布=#3062
  方向背书、context compaction=U-14 叙事支点）。

## 【2026-09-11 深夜 U-14 修复实现完成，PR 待明日窗口】
- 重要插曲：动手 1 小时前上游合入 #3193 附带的 prompts 瘦身（描述 240 截断/FAQ 全文分支删除/文档
  条目仅名）——单项成本 ~2,062→~1,232 B/库（-40%），但**总量无上限依旧**（541 库仍 666KB）。修复
  叙事改为"完成 #3193 开始的工作"
- 实现（worktree /home/ubuntu/weknora-u14，分支 fix/agent-runtime-context-budget，提交 7e9dda5c
  已推 origin）：①formatKnowledgeBaseList 两层预算（全量段 20k 字符→单行降级保 id→硬顶 128k 省略
  +说明；541 库 666KB→110KB 且 id 全保）②engine.ensureTurnFitsContextWindow 发模型前 fail-fast
  （消息+无基线时工具 schema 估算 > MaxContextTokens-安全边际 即终止回合，错误信息给出两个运营
  手柄；未知窗口保持原行为）
- 测试：目录三态（小目录不变/541 降级保 id/3000 触顶省略）+ 守卫四态（超限拒/合式过/未知窗过/
  工具 schema 计入）；整 agent 包全绿，gofmt/build/vet 干净
- PR 正文预存 dualhost-lab/pr-3158-body.md；**明天（09-12）14:01 CST 窗口到期后出 PR**
- U-10 aria 撤出（第 7 例验后翻空候选）：main 前端已有 228 处 aria-label，粗扫纯图标按钮残留 ~1

## 【2026-09-12 深夜续：#3161 认领并修复 → PR #3249】
- 机会扫描终局：#2874 已被认领（根因=Plan3 成员重键，S-24 联动假设不成立）；#2985 认领+产品辩论；
  #3216 认领——**#3161 为唯一无主黄金形状**（外部 issue+file:line 级分析+我方权限域）
- 实现（worktree /home/ubuntu/weknora-u16，分支 fix/shared-agent-self-source@061e3e3b）：
  types.NormalizeAgentSourceTenantID（自引用→absent）+ resolveAgent 入口归一化；外国来源被拒
  不降级守卫原样保留；回归测试四态齐（新增自引用态）+ types 三态单测
- 流程：先发认领评论（不带 PR 号）→ 实现 → PR #3249 拿号 → 回 issue 评论引用；
  PR 正文注明两个同款陷阱兄弟面（shared_agent_access.go / access/knowledgebase.go，属语义加
  而非归一化）留作跟进
- 踩坑：heredoc `cat >> 先建空文件致 || 分支跳过`，测试文件空提交后被抓回（amend 061e3e3b）
- 在途全表：3 合并 + 6 在审（#3249/#3222/#3176/#3150/#3104/#3062）+ #3060/#3061 issue 位

## 【2026-09-14 晚：#3104 合并（第 4 个进主线）+ #3222 静默关闭】
- **#3104 已合并**（09-14 21:02 CST，merge_commit 780f2beb，#2906 随闭 completed）——零 review 直接合，
  累计 **4 合并**（#3069/#3036/#3096/#3104）；我方 ping 发于合并后 1 小时（巧合，无害）
- **#3222（U-14 修复）被静默关闭未合**（12:51 UTC，零评论零 review）；main 无替代实现；#3158 issue
  仍 open——已发礼貌询问（issuecomment-5665442061，提供三种重做方向：守卫位置/配置化限值/拆两 PR）。
  这是外部 PR 第二例静默关闭（#3184 同款），若获回复可校准我方对 agent 核心域改动门槛的认知
- #3249（#3161）/#3222 重跑前 CI 均四绿；#3150 空提交 499bcc5c 已推、CI 重跑中
  （#3199 关闭未合，rebase 救援路线失效）
- 观察补充：同期外部 bug 修复流动良好（#3156 ES 负余弦→f8daa8d7、#3115 qdrant→86f09034）

## 【2026-09-14 深夜：豆包搜索 provider 已开 issue #3250】
- 新增项（编号 S-28）：火山豆包搜索 Custom 版接入（feedcoopapi web_search，Bearer JSON）——实测
  三优势：服务端日期区间过滤 / markdown 全文 / 每结果 ISO 发布时间，单价 ~0.02 元为带正文国内最低；
  WebSearchResult 模型零改动直映；TimeRange 走 bocha freshness 同款 ExtraConfig 模式
- issue #3250 已开（英文，字段映射表+请求样例，key 全脱敏）；48h 窗口至 09-16 深夜，届时出 PR
  （4 接线点+doubao.go 适配器，bocha.go 同构模板，半天工作量）
- 定位：黄金泳道——provider 增加已被验证两次（#3036 两日合并；官方 v0.8.0 持续加 exa/metaso）

## 【2026-09-14 深夜：S-28 豆包 provider 全流程闭环 → PR #3251（未等 48h）】
- 决策记录：经用户质询确认 48h 纪律系我方自制（官方零要求，CONTRIBUTING 无此规定；bocha 先例
  issue→PR 间隔 24 秒、2 天合并）——provider 增加泳道不等窗口，直接出 PR
- 实现（worktree /home/ubuntu/weknora-doubao，分支 feat/doubao-web-search@b3c3ac7f）：适配器
  doubao.go（253 行：Bearer/硬编码端点防 SSRF/time_range 校验/need_content 默认开/Summary 优先
  Snippet/8MB 响应帽）+ 六文件接线（types 常量+元信息表/service 双 switch/container 注册/前端
  联合类型）+ 测试 6 项（请求形态/映射/校验矩阵/HTTP 错误/空 time_range）
- **真 API 冒烟通过**：3 结果、时间窗过滤生效（结果全在 09-12..14 窗内）、全文 7.6k-17.3k 字符、
  +08:00 时区发布时间正确解析（key 从附件读入 env，不打印不落盘，临时测试已删）
- 两次自我纠错：①测试直构结构体绕过构造器致 needContent 零值（按 bocha 模式显式传参修复）
  ②python 静默补丁失误（container.go 缩进 3-tab 不匹配实际 1-tab，replace 无声跳过但打印 ok）
  ——**教训：批量补丁后必须 grep 验证每个目标行**
- PR #3251 已开（Closes #3250）+ issue 引用评论；TestSkillPythonVerifier 失败已证 pristine 同挂

## 【2026-09-15 凌晨：#3251 补课完成——对齐 bocha 验证水位】
- 补三项：①swagger 三文件手术增量（断言护栏拦截一次缩进不匹配后修正；grep 逐点验证）
  ②服务层 TestValidateProviderParametersDoubao（镜像 bocha 形态）③集成 E2E 7/7：
  /types 下发（config_fields=[time_range,need_content]）/原始凭据真搜（时间窗生效）/持久化创建/
  **凭据不回显**/存储凭据真搜/删除/测试租户清理——分支二进制换壳官方镜像，复用 milvus 测试栈
- 编译配方沉淀：golang:1.26-bookworm 容器内需 apt 装 build-essential+libsqlite3-dev+curl 后先跑
  cmd/download/duckdb 再 go build ./cmd/server（宿主直编因 glibc/CGO 头文件双重不可行）
- 临时资产全清（二进制经容器 rm、换壳镜像 rmi、e2e 脚本/override 删除）；key 经 0600 临时文件
  中转一次性使用（附件原文已在会话明文出现过，未落仓库未回显）
- bf40aed2 已推 PR；验证记录已贴（E2E 7/7 + swagger + dispatch test）

## 【2026-09-15：S-28 手工 UI 实测通过，#3251 验证链闭环】
- 用户全链路手工测试通过（下拉/表单/连接测试/持久化/真实问答带引用，5 截图为证）；
  手工验证评论已补发 PR #3251。CI 6/6 绿、mergeable clean、待 review。
- 测试栈已拆（卷保留）、临时镜像已清、官方栈已恢复。S-28 状态：**实现+验证完毕，在审**。

## 【2026-09-15 续：S-28 追加修复——config_fields 前端缺 text 分支（6ed112a5）】
- 用户 UI 实测发现 time_range 无输入框→定位：前端渲染器只有 select 分支（上游框架缺口，
  main@1ef38fdb 同缺）；doubao time_range 是首个 text 字段
- 修复（方案 A）：v-else 文本输入 +5 行并入 #3251；type-check 零错+322 前端测试过+
  CI 6/6 绿。衍生候选：S-18 同族（注册点散射）之外的"前端 config_fields 类型系统
  不完整"已随本 PR 补全，无需单独立项

## 【2026-09-15 issue 普查：新增候选 S-29（#3269 OBS path-style）】
- **S-29 = #3269**（09-15 新开，bug，0 评论未认领，查重干净）：OBS 驱动硬编码
  UsePathStyle:true（obs.go:55/:94）+ resolver HostnameImmutable:true，华为云 2023-12-30
  起禁 path-style → PutObject 404。报告者自带根因+真实日志+OBS 访问日志实证+4 点修复
  建议（含 checksum 对齐 s3.go:71、GetFileURL 虚拟主机化、补零覆盖 obs_test.go）。
  上游核验 ✓（两处 flag 实锤，s3.go 有对齐范式）。评级 ★★★★★ 黄金泳道（#3069 同款）。
  实现注意：HostnameImmutable 必须同步放开，否则 SDK 无法做 bucket 前缀注入；
  私有 IP endpoint 场景需防御性判断（参照 s3.go 启发式）
- #3216（IMA 子文件夹）：报告质量高但今日已被外部 Kaustubh1235 认领，让道；两周无进展再评估
- #3223（PDF 数字丢失/表格错位）：报告极规范（内嵌复现脚本+SHA256+容器已复现），
  但 docreader 布局重建属深水区，列为 TIER-2 备选
- 其余新开（#3258/#3259/#3262/#3266/#3271/#3255/#3236/#3263/#3260）均 feature 讨论类或
  信息不足，无直接 PR 机会
- 在途刷新：5 PR 零 review 不变；#3222 询问仍无回应；#3216 被认领

## 【2026-09-15：S-29 已认领并出 PR #3273】
- 认领评论 issuecomment-5677378910；实现 worktree /home/ubuntu/weknora-u29（分支
  fix/obs-virtual-hosted-style@deb2107c，基线 upstream/main@90e39777）
- 实现：删弃用 obsEndpointResolver（HostnameImmutable:true 本身就钉死 path-style）→
  BaseEndpoint+虚拟主机；IP 字面量/不可解析 endpoint 防御性回退 path-style；checksum
  对齐 s3.go（WhenRequired）；GetFileURL 无代理分支镜像客户端寻址；两处构造合一
  obsS3Options；新增 obs_test.go 6 测（原零覆盖）
- 验证：6/6 新测过 + file 包全绿 + go build ./internal/... 零错；无华为云凭据未做真传，
  已在 PR 与 issue 邀请报告者复验（其环境即 404 复现机）
- PR #3273（Closes #3269）+ issue 回链评论已发

## 【2026-09-15：#3223（PDF 数字丢失/表格错位）修复方案评论已发，S-30】
- 新增项 S-30 = #3223：分层修复方案已贴 issue（issuecomment-5679013969）——
  PR-1 后处理门控（has_charts 传递+页码首末行位置化，低风险先行）/
  PR-2 布局行对齐否决（同时治数量列误删与词内切割）/
  PR-3 可选数字完整性护栏（行级选择性恢复，非整页回退）
- 我方增量机制发现（超出报告者分析）：词裂=_split_columns 递归在行对齐表格的
  字距全高带二次切割；vector_clips 先于 postprocess 计算使门控零成本；
  postprocess 按页调用=免费首末行位置代理
- 报告者基线 462999ec 的 pdf_parser.py 与当前 main 哈希一致（6e95dc00…），零漂移
- 状态：方案对齐中，无异议即开 PR-1（~1 天量级）

## 【2026-09-15：S-30 PR-1 已出 → PR #3283（CI 全绿 clean）】
- worktree /home/ubuntu/weknora-s30c1（分支 fix/pdf-postprocess-gating@adeadf31，
  基线 upstream/main@90e39777）：has_charts 门控（vector_clips 先于 postprocess 计算，
  零管线重排）+ 页码首末行位置化 + 页序值匹配（值不符宁可保留）+ 旧 axis_run 测试契约
  更新 + 5 新门控测试（含报告者的隔离复现原句）
- 验证：官方 docreader 镜像一次性容器内 test_pdf_router 43 过 3 跳；全套 183 过 12 跳
  1 失败（mhtml fixture 缺失，pristine 镜像对照实锤存量）；CI "Python tests and Go
  client tests" + scan 双绿，mergeable clean
- 测试环境坑入册：docreader 镜像 venv 是 uv 管的（无 pip），装包用
  `uv pip install --python /app/.venv/bin/python`；包根=仓库 docreader 父目录
- issue 回链已发（issuecomment-5679610896）；PR-2（布局行对齐否决）待做

## 【2026-09-15 深夜：S-30 布局层完成——#3283 扩为双层 PR，CI 全绿 clean】
- 布局三修（提交 3da205f3 并入 #3283，单 PR 双层：跨 fork 无法 stacked PR + e2e 依赖门控层）：
  ①表格切分否决（窄侧 span<0.25×宽 + median 行长 2-10 + ≥60% 行与对侧对齐→不切分；
  水印排除用每行字形数而非高度——数量列纵向全长是常态，height 守卫会误杀，实现中实测纠正）
  ②断行改垂直区间重叠（降部字形中心偏移 1/3 字高是 "y p" 断裂真因；零高空格字形按带内判入）
  ③空格阈值加字高下限 max(w×0.4, h×0.35)（窄字形拖低宽度中位→字距成词距是 "1 24" 真因）
- 插桩校准数据：标题 y/p 中心偏 2.8pt、数字字距 3.79 vs 旧阈 3.09、真词距 8.12——参数实证锚定
- fixture：报告者 PDF（SHA 钉死）+ 生成器 + e2e 断言（数字/词/标记/行对应四组）；
  **报告者 reproduce_pdf.py 端到端 exit 0**；50/3 过 + 全套 190 过（1 存量 mhtml 失败已对照）
- 既有契约更新：双栏测试改现实几何（各 40% 宽，旧几何 17% 宽会被新否决误并——原几何失真）
- 产出：#3283 标题/描述已改为双层全量（Closes #3223）；issue 终评评论已发（5680238033）
- 教训：理论先行会在"高窄=水印"上翻车（数量列同样高窄），几何启发式必须用真实 fixture 插桩定参

## 【2026-09-15：#3273（OBS）当天合并——第 5 个合并件】
- 生命周期 ~2.3h（08:00 提 → 10:18 lyingbug 合并），追平 #3069 的最快纪录
- 合并方动态：wizardchen 直接在我方分支追加两个测试提交（PutObject 虚拟主机 URL 断言 +
  lint 限额调整，+156→+239）；竞争 PR #3272（同翻 UsePathStyle）被弃——lyingbug 留言
  "Taking this PR over #3272"，我方胜出原因=修得深（resolver 删除/checksum/GetFileURL/IP 回退）
- issue #3269 随合并自动关闭
- 累计：**5 合并（#3069/#3036/#3096/#3104/#3273）+ 6 在审（#3283/#3251/#3249/#3176/#3150/#3062）**

## 【2026-09-16：U-02 代码级核验——假设半证伪半证实，评论已发 #3280】
- 昨日假设"BM25 原始分 16× 污染混合融合"**被证伪**：fuseWithRRF 是纯排名融合
  （info.Score 被 RRF 覆盖，原始分进不了混合排序）；#3280 反而修复了均一分导致的
  关键词 rank 任意性（fuseWithRRF 假设按序到达）
- **真问题（#3280 将引入的新退化）**：关键词-only 路径（keyword-only KB/禁向量/
  向量库降级）走 deduplicateByScore 保留原始分 → rerank base=16.12 →
  compositeScore 0.3×16=4.8 钳位 → 全体饱和 1.0，模型分区分度清零、MMR 退化为
  纯多样性排序（rerank.go:199/:447-453）
- 评论已发 #3280（issuecomment-5691052527）：指出退化 + 建议源端归一（min-max 或
  score/max），混合路径无影响——合并前修正窗口
- U-02 登记项收窄为"关键词分数进入 compositeScore 前需归一"；教训：issue 开立前
  代码核验再次救命（昨日若直接开 issue 就是乌龙）

## 【2026-09-16：#3249 被关（合并到 #3162）——流程教训入册】
- lyingbug 03:20 关闭我方 #3249，合并治理到 lsasw 的 #3162（09-10 创建，比我方认领早 4 天，
  修在 GetSharedAgentForTenant 层覆盖非 chat 入口，更治本）；#3161 仍 open
- **教训（S-31 流程项）**：认领查重=issue 评论+关联 open PR 双查（GitHub issue 侧栏
  Developers 段）；本次只查了前者，4 天存续的 #3162 被漏看，代价=2h 实现+1 个被关 PR
- 已发体面告别评论+移交四态 resolveAgent 测试资产给 lsasw
- 另：#3313（Notion TPM 限流）已被 Myra718 认领（含 TPM pacing+局部重试计划）——
  **登记簿 U-05 转外部处置**，从候选池划掉
- 战况：5 合并 + 5 在审（#3249 出列）

## 【2026-09-16：#3296（禁注册后登录失败）调查——默认栈不可复现，转报告者问询】
- 官方栈实测矩阵（DISABLE_REGISTRATION=true 生效）：登录 200（直连+nginx 双路）、
  auto-setup 优雅 403 JSON、/auth/config 正确 invite_only——后端/nginx 层无罪
- v0.8.0 与 main 的 compose 完全一致：searxng 默认 127.0.0.1:8888 回环、无 8080 冲突
  ——"SearXNG 404 HTML"只能来自报告者侧端口/代理定制（SEARXNG_BIND/PORT 覆盖或前置反代）
- 已发问询评论（要 devtools 精确 URL/.env 四变量/反代拓扑/docker ps）；附 searxng
  公网暴露的安全提醒。认领保持，等报告者回应再定 fix 还是 works-as-env
- 栈已还原（self_serve 基线）+ 测试账户/tenant 已硬删 + 密码文件已清
- 教训：不可复现时把矩阵证据发出去比硬猜修法诚实——5 项全绿的表比任何理论有说服力

## 【2026-09-17 凌晨：#3324（消息搜索 ILIKE 方言 bug）当日闭环 → PR #3328 CI 全绿】
- 01:00 晚扫发现（14:40 开、10h 零评论捡漏）→ 认领 → worktree weknora-s3324
  （fix/message-search-dialect@036dc5e8）→ 修 → 测 → PR #3328 → CI 4/4 绿 clean，全程 ~1h
- 修法：照 session QueryPaged 范式——Postgres 保 ILIKE，其余方言 LOWER/LIKE；
  过时注释两处更新（repo 签名处 + service message.go:556）
- 测试：SQLite 内存库 3 用例（大小写不敏感命中+标题 join/owner+tenant 双重作用域/
  无命中不报错）——旧代码首用例即 `near "ILIKE"` 语法错，钉死回归
- PR 里登记同族观察项：chunk.go（伴生 PG JSON 操作符）/user.go/organization.go 的
  其余 ILIKE——各自单独核验可达性后再修，不做一刀切大扫除
- 战况：5 合并 + 6 在审（#3328/#3283/#3251/#3176/#3150/#3062）

## 【2026-09-17：#3333（初始化模型 tenant_id=0）当日闭环 → PR #3336 CI 全绿】
- 09:50 晨扫定位 → 认领 → worktree weknora-s3333（fix/initialization-model-tenant@89ae8959，
  基线 upstream/main@f2606629）→ 修复+测试 → PR #3336 → CI 4/4 绿 clean，含一次会话中断恢复
- 机制（全链路亲验）：toModel() 不带 TenantID → CreateModel/repo.Create 原样落库
  tenant_id=0 → GetByID (tenant_id=? OR is_builtin) 谁都读不到 → KB 绑死不可读模型、
  上传永久 processing。修复=CreateModel 前 model.TenantID = kb.TenantID（kb 本就在参数里）
- 测试：stub modelService 双路径钉死——创建路径盖 KB 租户（修复前必见 0）、
  复用路径只更新不重写租户且仅缺位者创建
- PR 附存量修复 SQL（join knowledge_bases 三列 + vlm_config->>'model_id'），
  刻意不做迁移（防误伤运营管理的 builtin 行）；重跑初始化不会自愈存量行——此点在
  issue 回链里明示
- 战况：5 合并 + 7 在审（#3336/#3328/#3283/#3251/#3176/#3150/#3062）

## 【2026-09-17：用户群反馈"幽灵文档"分析（S-32）——裁定：成立】
- 症状：解析失败→UI 删除→KB 计数 4/列表 3→重传"文档已存在"→只能手删 DB 行（v0.8.0）
- 机制链（三处代码实锤，upstream/main@f2606629 亲验）：
  ①删除是异步任务：行先标 parse_status='deleting'（knowledge_delete.go:442），UI 只收
  "删除已提交"+轮询（KnowledgeBase.vue:2176 deleteSubmitted），失败 toast 易错过
  ②任务若死掉（redis 丢队列/worker 崩/重试卡住）或耗尽重试但死信标记被
  "no longer active deleting" 守卫跳过（task.go:497-499）→ 行永久卡 deleting/processing
  ③卡住的行：计数全收（CountKnowledgeByKnowledgeBaseID 无状态过滤，knowledge.go:694）
  且拦截重传（CheckKnowledgeExists 只排除 failed，knowledge.go:366）——deleting/processing
  都命中 → 全部症状闭环
- 弱环：4 vs 3 的列表口径未取到用户实际视图（文件夹/状态筛选可能藏卡），但"计数含幽灵
  +重传被拦"两环实锤
- 关联：#3333（模型不可读→processing 卡死）正是幽灵行的生产者之一；0.8.0 无这些修复
- 修复方向（若开 issue/PR）：a) deleting 超时兜底清扫（找不到活跃任务→标 failed 或幂等
  续删）；b) 重传撞幽灵行时返回行 ID 让 UI 引导"先清理"；c) 单文档删除改同步小事务
- 状态：分析完成，候选 issue-first 项

## 【2026-09-17：S-32 幽灵文档已开 issue #3338（查重后定位残余缺口）】
- 查重发现同族两件历史修复均在 v0.8.0 内：#1699（重试耗尽死信标记，2026-06）、
  #2195（#2192 僵尸可见行修复，2026-07）——用户报告发生在含双修复的 0.8.0 上
- issue 定位为**残余缺口**而非重复：三环机制均在当前 main 亲验——去重只排 failed
  （processing/deleting 均拦重传）、计数无状态过滤（4 vs 3）、死信标记有
  "still actively deleting" 守卫（重解析竞态/状态移走即跳过→行永卡非 failed）
- 附加核验：随包 redis 已开 AOF（队列丢失场景弱化，issue 未据此立论）；worker 崩溃
  中途与守卫跳过是主卡行路径；#3333（模型不可读卡 processing）是幽灵行生产者之一
- issue 内容：机制三环+定案 SQL（请求复现者提供行状态）+ 三修复方向（孤儿清扫/
  撞重传返回行 ID+状态引导清理/超阈值 deleting 免拦的权宜）
- 后续：这是 issue-first 项，若官方认可方向 1/2 可接 PR 实现

## 【2026-09-17：S-32 首片修复 → PR #3339 CI 全绿（用户批准当日自修）】
- 实现（worktree weknora-s3338@1844501a）：CheckKnowledgeExists 基础过滤
  failed → NOT IN (failed, deleting)；比 issue 原案（陈旧阈值）更简——
  语义论证：deleting=行将消失，重传与活删除竞态在任务任何结局下都恰好剩一条活行
  （任务按行 ID 计划删除，不会吞新行；耗尽→标 failed 本就不拦）
- 测试：TestCheckKnowledgeExists_ParseStatusMatrix 五态矩阵（failed/deleting 放行，
  pending/processing/completed 仍拦）× 双路径（hash + 文件名/大小回退）；
  踩坑：fixture 漏 file_size 落 0 导致回退路径假失败，补列后全绿
- PR #3339（Refs #3338，首片）+ issue 回链；越界项明示：孤儿清扫（计数膨胀/自愈）
  与前端"清理残留"引导为后续（后者后端已具备——重复错误 data 已带现有文档对象）
- 战况：5 合并 + 8 在审（#3339/#3336/#3328/#3283/#3251/#3176/#3150/#3062）

## 【2026-09-17 下午：战果大丰收——双合并+影响分+接力棒】
- **#3339（04:18）与 #3336（05:09）相继合并**：累计 **7 合并**（#3069/#3036/#3096/#3104/#3273/#3336/#3339）
- **影响分**：我方 #3280 的 composite 饱和评论 → lyingbug 开 #3343（@vicfei 署名）→
  lyingbug 自修（d8be87d94）关闭——U-02 目标由官方实现达成，我方记影响贡献
- **#3328 体面自关**：第三方 coderdailyone 的直提版本 0ad08d41 先落地（含 ESCAPE ?
  子句的更优变体——我方版本预转义了关键字但 SQL 未声明转义符，此差距已学习）；
  #3324 由 lyingbug 关闭
- **#3342 判定版本陈旧**：v0.8.0 tag=09-03，#3069 修复=09-07 不在包内；已回复升级
  指引（docker compose pull），若最新镜像仍 403 才是真残余
- **接力棒 #3345（孤儿清扫）**：lyingbug 亲自开的 #3338 第二片路线图（计数膨胀/
  deleting 无任务自愈/前端 bare toast），0 评论未认领——切片1 两小时合并的线程
  活跃度，是最热车道
- 战况：**7 合并 + 6 在审**（#3283/#3251/#3176/#3150/#3062 + 新开机会）

## 【2026-09-17 晚：#3345 切片 1+2 闭环 → PR #3367 CI 全绿】
- 实现（worktree weknora-s3345@bc17b359，净 +281/-2，9 文件）：
  ①计数对齐：CountKnowledgeByKnowledgeBaseID 排除 deleting（镜像列表既有过滤；
  failed 保持计数=可见可操作卡片）——"4 vs 3"根治
  ②Sweep C：housekeeping 第三扫——搁浅 deleting 行（无存活任务）翻 failed 带
  错误信息（与解析扫同一恢复契约；删除执行器按行 ID 幂等，迟到任务不受影响）
  ③新 inspector 探针 HasQueuedDeleteTasksForKnowledge：匹配 knowledge:list_delete
  批量载荷（解析侧匹配器结构性看不见——任务类型集不同+复数字段）；接口/noop/
  asynq 三实现+三个测试 fake 全补；Lite noop 返 false 属设计（内联删除不入队）
- 失败安全矩阵：活任务→保留；探测错→该行推迟；nil inspector→整个 Sweep C 推迟
- 测试：Sweep 五态 + 计数 + 匹配器六例全绿；TestSkillPythonVerifier 存量失败
  pristine 对照实锤（S-16 在案）
- 切片 3（前端重复命中引导）刻意留给前端 pass，PR 明示
- 战况：7 合并 + 7 在审（#3367/#3283/#3251/#3176/#3150/#3062 + #3328 已自关）

## 【2026-09-18：#3367 合并（第 8 个进主线）——幽灵文档切片 2 落地】
- merged 2026-09-17T16:55:44Z by lyingbug，squash c8ebb9ed，单提交 +281/-2（我方 bc17b359 原样，
  无维护者追加提交）；#3345（lyingbug 开的路线图 issue）随之自动关闭
- 父 issue **#3338 仍 open**——它是切片 3（前端重复命中"清理残留"引导）的载体；后端 data 已带
  现有文档对象（切片 1 时备好）
- 战况：**8 合并**（#3069/#3036/#3096/#3104/#3273/#3336/#3339/#3367）+ **5 在审**
  （#3283/#3251/#3176/#3150/#3062，全 CI 绿、零 review）

## 【2026-09-18：#3342 报告者复测——升级 main 镜像后 403 仍在，疑似 #3069 残余变体】
- 报告者 zhangmy163 09-18 00:58 UTC 回复：切 main 分支 compose、WEKNORA_VERSION=main、
  pull/down/up 全新镜像后，userA 新建会话命中共享 KB 图片**仍 403**
- 回复前的分流岔路（必须问清，逐条对应 #3069 的放行条件与已知边界）：
  ①403 请求的完整路径——消息级 `/sessions/:id/messages/:mid/files`（#3069 修的）还是其他端点
  ②403 响应体 JSON 原文（错误文案区分拦截层）
  ③是回答内嵌的提取图片还是文档源文件——#3069 证据门（chunk 含 resource://handle）只覆盖
  前者，源文件当时验证即仍 403（刻意留的边界）
  ④共享拓扑：KB 组织共享（HasTenantKBPermission 覆盖）还是共享智能体间接访问（未覆盖边界）
- 处置：诊断问询稿已备（本会话），待用户批准后发；也可本机 main 镜像先行自测 ③④ 两条岔路
- **09-19 已发**：issuecomment-5740907759（用户批准）——四岔路问询（403 完整 URL/响应体原文/
  内嵌图 vs 源文件/组织共享 vs 共享智能体）+ #3069 三重校验背景 + 两条已知未覆盖边界说明；
  等报告者回应定分流：命中共享智能体路径或源文件边界=我方域内新 PR 机会（报告者=内置验证人）

## 【2026-09-18：全量 open issue 普查（375 件）——外部池定量结论与幸存候选】
- 快照 /tmp/weknora-scan-20260918/issues.json；分桶 0-7d 40 / 7-30d 67 / 30-90d 116 / >90d 152；
  Bug 110 / Feature 160 / Question 65 / Other 40
- **外部池对"认领即修"已近枯竭**：机制型 bug 短名单 16 件经双查（评论+timeline cross-ref）后 12 件有主——
  #3362→PR#3366（po-et，**issue 开出后 90 分钟出 PR**：10:47→12:15）/#3151→#3166（dzc-bit）/
  #2957→#2963（LuckVd）/#1998→#2116（014-code）/#2473→#2474+#3254（双 PR 竞争）/#2519→#2582（hjxccc）/
  #2855→#2868（Jonesxq）/#2619→#2940（Jonesxq）/#3021→#3088（helloxjade）/#2966→#2990（baka-world）/
  #1892→#2763（Jonesxq）；#3132→LuckVd 修复中（#3102+新提交）；#2884→Roovelrz 认领
- 关闭定性两件：#2703 已被 #2831（移除 LLM rerank 兜底，lyingbug 关闭理由在案）根治、#3189 归 #3239
  处理——两件 issue 虽仍 open 但无可为
- **幸存候选（按价值序）**：①**#2289**（res:// 别名泄漏进 SSE 聊天图挂，55d c0 零关联 PR——资源/流式
  我方域，与 #3069/#3342 同族；动手前须 main 现状核验）②**#3129**（智谱 webSearchPrime 搜索 provider，
  黄金泳道第三次出击——provider 增加合并率 88%、bocha/doubao 模板在案；MCP 端点适配是新增量，
  需 GLM Coding Plan key 做真实验证）③**#3337**（qdrant collection 自动创建失败→手建后正常，1d 新，
  离线环境迁移触发、repro 不详；我方有 qdrant 测试栈可快速定性）④**#3185**（KB 删除重建后 wiki 图谱
  加载失败——疑为"删除不清 wiki/图谱"已知缺口（#2623/#2337 同族）的 UI 症状，可先诊断评论占位）
- 不抢：#3134/#3306（COS 双件，po-et 已在 COS 路上分析且我方无 COS 凭据）；#2121（wolfkill 已宣告
  fork 修复）；#3260（sandbox/skills 官方自研热区）
- 战略校准：新鲜窗口实测收缩到 ~1.5 小时；扫描价值从"抢认领"转向"诊断定性+我方第一手线程"

## 【2026-09-18：#3129 认领前查重拦截——已有 open PR #3214，候选撤出】
- 用户选定 #3129（智谱 webSearchPrime provider）并提供了 GLM Coding Plan key（存 ~/.glm-coding-key，
  0600，仓库外）；**认领前双查发现 open PR #3214**（tianhaotian，09-12 开，1 commit 15 文件 +533/-5）
- #3214 成色：复用 internal/mcp.NewMCPClient（streamable HTTP+Bearer）、固定官方端点防 SSRF、
  每次搜索独立 MCP 会话、zhipu_prime.go+测试+六接线点+swagger+双文档全齐，扫描流水线绿——
  完整对等实现，非可挤掉的弱竞争者；挂 6 天零 review
- 处置：不发认领评论（#3249 教训的正确执行序：查重在先）；key 保留备用于"验证助攻 #3214"
  或 fork 预采纳两条备选路线，待用户拍板；候选顺延回 #2289
- 注：普查当日 #3129 c0 零评论看似无主——**timeline cross-ref 是唯一可靠查重通道**（本例报告者
  在正文中都没提到这个 PR），再次入册强化纪律

## 【2026-09-18：#2289 现状核验=已修未关（第 8 例验后翻空），验证评论已发】
- 用户拍板转向 #2289（res:// 孤儿别名泄漏进 SSE）→ 查重干净（c0 + 零关联 PR）→ upstream/main
  @c8ebb9ed 全链路亲验：**三路全已剥离孤儿别名**
  - 聊天流式：chat_completion_stream.go:111-112 走 modelContext.StreamDecoder()，末级
    orphanResourceStreamFilter（stream.go）剥 `res://\d+` 且跨 chunk 持有部分后缀防劈叉泄漏
  - agent 流式：think.go:70-71 同款组合解码器（:166 的 OrphanResourceHandles 告警仅剩观测意义）
  - 非流式：DecodeOutputText（registry.go:329 StripOrphanHandles；:177-178 与
    session_knowledge_qa.go:1231 调用）
- 时间线：38c594ae（07-15）仅告警版=issue 所述 → **07-27 三个 modelcontext 提交**
  （5e413c64/66632685/69b79239）引入剥离，即 issue 提出（07-24）后 3 天已修，挂 52 天未关
- 残余（评论中已注明）：剥离仅在发射时，07-27 前持久化的旧消息仍含字面 res:// 无回填
- 已发验证评论 issuecomment-5724353420（全 file:line 证据+建议关闭）；无 PR 可提
- GLM key（.glm-coding-key，0600）保留待用户处置
- 外部池幸存候选只剩 #3337（qdrant collection 不自动创建，需定性）与 #3185（薄报告）

## 【2026-09-19：二扫（快照差分）——外部池出清确认，窗口实测 39 分钟】
- 差分快照 /tmp/weknora-scan-20260918b/（380 open，较前次 +5 新 0 关）
- 新到 5 件：#3383（智能推理跨轮重复渲染，高质量确定性复现）→ **39 分钟内出 PR #3386**
  （hata33，issue 03:10 → PR 03:49）；#3390（wiki taxonomy embedding 绕过批处理）→ po-et
  认领评论+**双 PR 竞争**（#3411/#3422）；#3380（脱敏 feature）/#3401（Windows bug 大杂烩）
  不适合；#3403（图谱 tab 500/2900 节点卡，唯一无主）但属前端渲染性能+分层展示 feature
  设计（feat·前端陷阱簇），非我方车道
- 旧幸存者全灭：#3337 被 LeonPure 认领（认领评论自带根因分析——竞争者水位再抬升）；
  #3185 仍薄报告无主；11 个持道 PR 全部仍 open，无车道释放
- **结论：外部池对我方已无可用候选。窗口从 90 分钟（09-18 实测）缩到 39 分钟（09-19 实测），
  抢新车道正式关闭。剩余真实机会=我方自有线程：#3342（报告者等我们回复，残余变体若
  实锤即我方域内新 PR）、#3338 切片3（前端引导，后端 data 已备）、S-26、S-16**

## 【2026-09-20：三扫——大扫除+三机会浮现（#3342/S-15 黄金位坐实）】
- 快照 /tmp/weknora-scan-20260920/：302 open（380→302，**78 件被批量关闭**=维护者大扫除，
  含大量远古件；#3337/#3362/#3383/#3390 随各自修复落地关闭）；我方 #3296 被 lyingbug 关为
  completed（线程干净了结）
- **#3342 残余变体被第二报告者 Arming03 独立证实**（09-18 06:52，Claude 辅助代码审查）：
  main 上 PDF/OCR 抽图仍 403，根因=①入库缺 extracted_image binding（SaveBytes 只登记不绑定），
  两条授权路径都要 live binding ②merge.go:227 用调用方租户富化，共享库命中 image_info 整体丢失
  ——**①正是我方 S-15（09-07 #3022 期间实测登记"提取图片不建 resource_bindings"），三线合一
  （我方实测+两报告者）。我们的诊断问询（09-19）已发，Arming03 评论提供了分流所需的大部分信息**
- 新到幸存候选：**#3453**（wiki ingest selectRelevantFolders 裸 BatchEmbed 绕过池化，
  wiki_ingest_taxonomy.go:195/:200——**#3422（po-et，09-19 合并）修的是同文件另一处**，
  本件=完成 #3422 未竟工作形状，c0 无认领，今日 05:07 新鲜）；**#3451**（VLM 请求硬编码
  detail:"auto"，MiniMax OpenAI 兼容端点 400，c0 无认领，小修）；死件：#3452（lyingbug 自开自修
  #3445 已闭）、#3426（第三方安全大审计自带 PR #3425，95 文件）、#3442（薄问答）、#3450（feature）
- 在审 5 件（#3283/#3251/#3176/#3150/#3062）无变化，全 open 零 review
- 机会排序：**①#3342/S-15 修复（我方域+两报告者等待+第一手数据，无竞速）②#3453（新鲜，
  窗口小时级）③#3451（小修）**——①为旗舰，②③视用户意愿抢窗

## 【2026-09-20 续：三件套执行——#3342 认领 + #3453 翻空 + #3451 当日闭环 PR #3457】
- **#3342 整合评论+认领已发**（issuecomment-5747978269）：三方证据线（Arming03 审查+我方 09-07
  实测+main@a62a51e6 全链核验）+ 机制链 file:line（SaveBytes 不建绑定 / 两路授权收敛到
  IsReferencedByKnowledgeBase / 其实现注释明言"文本不算证据"=binding-only / #3069 时代不查
  binding→收紧引入回归）+ merge.go resolveParentChunks 用调用方租户查父块丢 image_info（第二
  缺陷亦实锤）；修复方向 A 入库建绑定+存量回填、B 文本证据臂（需维护者拍板，router 注释与
  实现的矛盾已摆上台面）、C merge.go 租户改属主——**A+C 起步**
- **#3453 核验=已修未关（第 9 例）**：selectRelevantFolders 两处已是 BatchEmbedWithPool（注释
  引用 #3390），修复随 #3422（aea51ecb）落地，报告者对的是合并前版本；核验评论已发
  （issuecomment-5747979032）建议关闭
- **#3451 当日闭环**：认领（issuecomment-5747979161）→ worktree weknora-3451（分支
  fix/vlm-image-detail-omit，基线 main@a62a51e6，提交 189204e5）→ VLM Predict 与 chat
  msg.Images 兜底两处去掉硬编码 detail:"auto"（omitempty→字段整个消失，OpenAI 行为不变，
  显式配置仍透传）→ 双包全绿+vet/gofmt 净 → **PR #3457** → 回链（issuecomment-5747990968）
  → CI 进行中（detect-lint 已绿）。诚实边界：无 MiniMax key 未真机验证，已注明并邀请报告者复测
- 战况：**8 合并 + 7 在审**（#3457/#3283/#3251/#3176/#3150/#3062）+ #3342 修复在制（A+C 方案）

## 【2026-09-21：四扫——"issue+自提PR"工业化确认，池面出清，我方主线=#3342 执行】
- 快照 /tmp/weknora-scan-20260921/：316 open（+15 新/-1 关：#3453 随我方核验评论关闭）
- **#3457 CI 四项全绿** clean；#3342 认领后暂无维护者回应（方案 A/B/C 已在桌面）
- **#3342 报告者四岔路答复已到位**（09-20 03:03，早于我方认领评论）：URL=消息级端点、
  错误体="forbidden: file not accessible from this resource"（= access.ErrForbidden，与
  我方机制链的"证据门过、binding 检查挂"完全吻合）、切块视图同样 403——四岔路问询结论
  与机制分析互证，无需再等任何信息，可直接进 A+C 实现
- 新到 15 件中 6 件可看，**4 件已被"issue+自提 PR"模式当场占位**：#3458/#3459→PR#3466
  （linus-liu-web 一 PR 双修，其 #3453→本次三连=工业化 issue+PR 流水线）/#3468→#3492
  （Bruce-Yii）/#3485→#3487（CodeZen-Lizhi 自提）——竞争形态从"抢认领"进化为
  "报告者自带 PR"，外部池对第三方贡献者已结构性关闭
- 无主幸存：**#3461/#3462**（ben0112 的 wiki:ingest 双件——积压并发只有配置值 1/5 的
  触发扇出缺失 + asynq 租约过期任务永久不可回收）——wiki 生命周期我方车道，但属
  深水区（并发编排/asynq 语义），且是 #3222 被静默关闭的 agent/wiki 核心域，风险中高；
  暂列观察，不当快赢
- 其余新件：features（#3456/#3464/#3465/#3478/#3479/#3486 架构讨论）/问答（#3480）/
  官方热区（#3474 skills）——不适合
- 结论：外部池无新增可做项；**我方最优动作=执行已认领的 #3342 A+C 实现**（无竞争、
  双报告者待复测、方案已声明）

## 【2026-09-21：#3342 首片修复闭环 → PR #3493（A 入库绑定 + C merge.go 租户）】
- 实现（worktree weknora-3342@97b856c3，基线 main@a62a51e6，9 文件 +322/-18）：
  - **A**：bindStoredImages（knowledge_create.go）镜像 bindContentResources 范式——Resolve
    →同租户校验→Bind(extracted_image)，best-effort；两条调用线：knowledge_process 图片解析后 +
    triggerManualProcessing（provider:// 形态图片正文扫描看不到，需从 resolver 列表直接认领）
  - **C**：resolveParentChunks 三处租户过滤换 *Only 变体（ListChunksByIDOnly 先例 + 新增
    ListChunksByParentIDsOnly repo/接口方法 + searchutil CollectImageInfoByChunkIDsOnly
    平行函数）；删除 tenant 提取块
- 测试：bindStoredImages 四态（同租户双形态/空白/不可解析/跨租户/Bind错容忍）；merge 跨租户
  回归（tenantScopedChunkRepo 严格模拟 SQL WHERE tenant_id，**stash 反向验证旧代码红**）；
  chat_pipeline/searchutil/service 三包绿（唯 S-16 存量环境项）；gofmt/build/vet 净
- **集成验证（一次性全新栈）**：fresh postgres+redis+官方镜像壳挂分支二进制；踩坑三则入册：
  ①迁移是 file://migrations/versioned **文件系统路径**（镜像自带迁移集停在 96，须挂载分支
  migrations 目录→96→107）；②manual 文档 draft 不处理，发布=PUT /api/v1/knowledge/manual/:id
  （/knowledge 组下，非 KB 路径）；③1×1 探针图被 isIconImage 判为图标删除，须 ≥64×64——
  最终：发布带内嵌图文档 → 日志 Resolved 1 + Bound 1/1 → DB 出现 extracted_image 绑定
  （与 attachment 并存）——死链打通实锤
- **PR #3493** + issue 回链（issuecomment-5754429050）；CI 进行中；存量回填明示为第二切片
  （housekeeping 周期扫 vs 一次性，向维护者征询形态）
- 战况：**8 合并 + 8 在审**（#3493/#3457/#3283/#3251/#3176/#3150/#3062）；worktree weknora-3342
  保留待 PR 迭代；一次性栈容器/网络/二进制已清净

## 【2026-09-21 下午-09-22 早：五扫+六扫——#3493 全绿、#3501 窗口关闭、#3150 过时关闭】
- **#3493 lint 修复当日闭环**：revive 未用 ctx + gofumpt 两处 → bfb7f65e → **CI 4/4 绿**；
  教训入册：提交前加跑 gofumpt（gofmt 不够）
- **#3150（U-03）被 lyingbug 关闭未合**：理由=分支过时（#3381 将 knowledge_search.go 重构为
  search_knowledge.go），但明示"去重仍值得做"——**U-03 对新结构重做=维护者背书的候选**，
  列入下一主任务
- #3457/#3283/#3251/#3176/#3062 全 open 无 review；六扫（09-22 早）：321 open，+3 新
- **#3501（agent-chat 引用缺失）夜里被 vinhchuquang PR #3522 占位**（存活一天后失守）；
  #3509 早被 #3515；#3504/#3494/#3512 当日消化——报告者自提 PR 模式持续
- 新到三件：#3527（MCP ask 会话归属 StorageID 错配）=linus-liu-web issue+自提 PR #3528 死件；
  #3526（重复摄取产生 concept/X+entity/X 双页面，slug 判重带不稳定类型前缀）=同作者 issue
  无 PR 但其自提模式风险极高+涉及 wiki 页面身份语义（设计决策域），不抢；#3516（anydoc 多页
  字段丢失）=外部引擎限制+评论已建议换引擎，不碰
- 六扫结论：外部池无可做项；主任务=**U-03 对 #3381 新结构重做**（无竞速+维护者邀约），
  次选 #3342 回填切片设计、S-26 空闲档

## 【2026-09-22：U-03 重做开工——现状核验 + 设计定稿 + 上海二开对照（三步前两步完成）】
- **现状核验（upstream/main@33c0333e）**：#3381 重构后重复依旧双存——agent 侧
  search_knowledge.go:1010 compositeScore（含 positionPrior，clamp 在乘后）+:1043 applyMMR
  （增量 maxRedundancy 形态）+三个纯委托方法（clampFloat/tokenizeSimple/jaccard）；chat 侧
  rerank.go:439 compositeScore（无 prior）+:458 applyMMR（朴素扫描+ParallelMap 分词+
  pipelineInfo 日志+avgRedundancy 仅用于日志）；chatManage 参数仍疑似未用。差异图谱与
  09-09 原始分析一致——旧设计可整体复用，仅需重锚
- **设计（行为零变更纯去重）**：searchutil.RankingCore：①CompositeScoreRaw（0.6/0.3/0.1+
  web_search 0.95，不 clamp——chat 直接 clamp，agent 乘 PositionPrior 后 clamp，两侧位级对齐）
  ②PositionPrior(startAt,endAt)（agent 专用因子集中暴露）③泛型 ApplyMMR[T]（增量形态，
  返回 selection+avgRedundancy；tokens/score 经闭包注入——chat 保留 ParallelMap 分词+日志，
  agent 保留串行分词）；调用侧删三委托+未用参数；测试=金值运行时计算+朴素vs增量差分模糊
  （300 例选择序+平均冗余逐位一致）
- **上海对照（SSH 实读 feature/weighted-ranking，已并入沪 main）**：
  - 沪 theme-3 v1（8a77b068c）：types.RankingConfig 可配置权重+recency 半衰期+MMR λ，
    未设字段回落旧常量（"enable-with-defaults 构造性 no-op"+parity 单测）——**no-op by
    construction 范式直接借鉴到我们的去重 parity 测试**
  - 沪**刻意不动 agent 侧 composite 副本**（"intentionally unchanged in v1"）——与上游
    去重互补：我方统一核心落地后沪 weighted 变体可挂到共享核心上不再度分裂（PR 里作为
    future work 一句话点出，不实现）
  - **沪三臂评测（27548b2ea，eval-100 池模式）**：rerank 是最大单杠杆（top3 +12.7/EM +6.1）；
    **MMR λ0.7 是功臣**（λ1.0 回吐 top5 −4.5——多样性惩罚防近重复挤占名额）；RRF 基线分
    仅 0.008-0.011 → 旧公式 0.3×基线项贡献≈0.003，**权重再平衡是死胡同，有效旋钮=接不接
    rerank 和 λ**——即：统一必须位级保真 λ0.7 与公式，任何"顺手调优"都是错的方向；
    v3 发现 chat 池模式此前静默跳过 rerank（=U-01 根因的沪侧实证）
  - 不汲取进上游 PR 的：RankingConfig/recency/请求级开关/前端开关（fork 实验域，且沪评测
    自证权重面无收益）；参考文档 docs/design/weighted-ranking-deep-dive.md（217 行）在沪仓

## 【2026-09-22：U-03 重做当日闭环 → PR #3533（CI 跑动中）】
- 实现（worktree weknora-u03b@6cceb069，分支 refactor/unify-ranking-core-2，基线 main@33c0333e，
  5 文件 +358/-145）：searchutil/ranking.go 三件套（CompositeScoreRaw 不 clamp + PositionPrior
  集中暴露 + 泛型 ApplyMMR 增量形态/调用方注入 token sets/返回平均冗余）；chat 侧保留并行分词
  +pipeline 日志、删未用 chatManage 参数；agent 侧保留串行富化分词、删三个一行委托；λ/权重/
  日志零变更
- 测试：parity（两套旧公式逐字保留为参考预言机，全矩阵 scores×sources×positions 位级复现）+
  300 轮随机差分（选择序+平均冗余 1e-12）+ agent 包既有朴素预言机测试改跑共享核心原样通过；
  实现中自查抓到一个真 bug（avgRedundancy 误用循环下标索引 tokenSets，应为选中项原始下标）
- 门禁：gofmt/gofumpt（吸取 #3493 教训先跑）+build+vet 净；searchutil/agent tools/chat_pipeline/
  application service 全绿（唯 S-16 环境项）；本机 gofmt 与上游 CI 有版本偏差（3 个上游自有
  测试文件被本机 gofmt 标记，非我改动，CI 侧绿——已备注）
- **PR #3533** + #3093 回链（issuecomment-5770368083）；PR 正文致谢关闭 #3150 的指针并注明
  "第二轮"；future work 一句话：统一核心形状已为可配置加权变体留好接口（沪侧协同）
- 战况：**8 合并 + 8 在审**（#3533/#3493/#3457/#3283/#3251/#3176/#3062）；worktree weknora-u03b
  保留待 review

## 【2026-09-22 下午：七扫——#3493 合并（第 9 件！）+ #3533 lint 修复 + 池面仅存 #3539】
- **#3493（#3342 首片：提取图片绑定+merge.go 租户）已于 09-22 09:52 UTC 被 lyingbug 合并——
  累计 9 合并**（#3069/#3036/#3096/#3104/#3273/#3336/#3339/#3367/#3493），零评论直合；
  **#3342 存量回填第二切片随之解锁**（PR 正文已声明 follow-up，合并=默许）
- #3533（U-03 重做）golangci-lint 红：ineffassign 抓到测试预言机的 ineffectual default 赋值
  ——f3a3d07d 修复已推，CI 重跑中（教训二连：本地把 ineffassign 类也预跑一遍/上 golangci-lint）
- 七扫（324 open，+7 新）：**四件高价值新件全部自带 PR**——#3558/#3559/#3560（rerank 静默跳过/
  分批退化/FilterTopK 硬截断，linus-liu-web 三连自提 #3564/#3561/#3565）、#3551（generic 行
  思考档位失效，DerrickLinus 自提 #3552）；**唯一无主=#3539**（process_config chunk_size 无
  数值下界，实测放大 28.8 倍饿死共享队列——knowledge_process_config.go:258 校验缺口+chunker
  仅 <=0 回退，tokg-venv 报告，7h 零认领）——管线域我方车道，修法=ValidateProcessOverrides
  补数值边界
- 其余新件：#3532（wiki 跨库搜索 feature）/#3536（paddleOCRVLTimeout 常量）不适合
- 在审 7 件：#3533（CI 重跑中）/#3457/#3283/#3251/#3176/#3062；#3493 出列

## 【2026-09-22 傍晚：#3539 当日闭环 → PR #3566 CI 四绿；#3533 排障记】
- **#3539（chunk_size 无下界）当日闭环**：认领（5777497370，含三处缺口核验）→ worktree
  weknora-3539@4443f311（基线 main@0a99a285，3 文件 +103）：共享校验器
  validateChunkingSizeBounds（[100,10000]+overlap≥0，镜像向导 binding）接线三处（上传级
  ValidateProcessOverrides/KB 创建/KB 更新——后两处此前零校验且持久化），越界 BadRequest
  而非静默回退，零值=未设置直通；测试=九态边界矩阵（含实测值 1）+上传级端到端；
  follow-up 明示：总量上限（建议②）/父子块尺寸/preview 只读端点；**PR #3566 CI 四项全绿**
  → 回链（5777608515，邀请报告者贴实验脚本做②的回归基础）
- **#3533 排障二连**：ineffassign 修复（f3a3d07d）后 lint 仍红——lll 报的是我没碰过的
  handler/knowledge_spans_test.go，判定=lint 对比窗口把上游新提交（0a99a285 族）长行算进
  PR；**rebase 到最新 main（78977b5d）后 lint 转绿**。教训三连入册：①测试预言机别写无效
  default 赋值 ②lint 红且报非我文件时先想基座漂移，rebase 是解 ③本地装 golangci-lint 预跑
  提上日程
- 战况：**9 合并 + 8 在审**（#3566/#3533/#3457/#3283/#3251/#3176/#3062）；worktree+3539 保留

## 【2026-09-22 晚：上海侧 issue 草稿核验=机制不成立，拦截未投（跨节点草稿也要重锚）】
- 上海会话发来 issue 草稿（大 chunk 数文档详情页冻浏览器，归因"merged 全文视图拼接
  全部 chunks 无大小守卫"，基于 v0.8.0 fork 实测冻屏），要求新加坡投官方
- **upstream 核验四处全部推翻其机制**（v0.8.0@1edcd54b 与 main 双版比对）：
  ①后端 /chunks/:knowledge_id 分页 + PageSize>100 封顶在 v0.8.0 就有（chunk.go:120-124）；
  ②前端 getfDetails 单页 25 条（KNOWLEDGE_CHUNK_PAGE_SIZE），两版代码逐字相同；
  ③merged 视图 mergeChunks(props.details.md) 只拼接**当前页** 25 条——非全量；
  ④xlsx 是 excel 预览型（filePreview.ts register('excel',[xlsx,...])），file 类型详情
  **默认视图=preview 不是 merged**（doc-content.vue watch 自动切换）
- 真嫌疑改判：excel **预览渲染器**（客户端渲染 9MB/2.4 万行表格→DOM 爆炸）——草稿把
  归因写反了视图；且其实测在 fork（feature/agent-lab）上，不能排除 fork 前端差异
- 处置：未投递；需上海补三件事再定：①冻屏时激活的是哪个视图（默认应是 preview，
  devtools/截图）②官方原版镜像是否复现（排除 fork 差异）③文件多大开始冻。
  或者新加坡用官方栈+browser-use 自行复现后再按"excel 预览缺大小守卫"重写 issue
- 教训入册：**跨节点协作的 issue/PR 草稿同样是"接力证据"，投递前必须逐条重锚
  upstream/main**（S-26 归属勘误教训的推广形态）；这次若直接投=一次权威性自伤

## 【2026-09-22 深夜：WSL2 回执+机制终钉——excel 预览三连击实锤，issue 成稿待批】
- **归属勘误**：草稿出自 **WSL2 节点**（生产判读位），非上海——登记更正
- WSL2 回执：认账机制归因错误（教训"数据加载全路径必须验证"其侧入册）；**fork 差异排除**
  （doc-content.vue/filePreview.ts/document-preview.vue 相对 v0.8.0 零 diff，fork 前端改动
  仅门户/标签树）→ 复现若成立即上游 bug；实测细节：国泰海通系 xlsx 9.28MB/31,924 chunks，
  打开详情页后浏览器弹 "Page unresponsive"
- **SG 机制终钉（main 核验，file:line）**：document-preview.vue renderExcel(:241)——
  ①XLSX.read 全量解析整个工作簿（SheetJS 客户端）②workbook.SheetNames.forEach 无条件
  sheet_to_html 全行转 HTML（:262-266）③sanitizeHTML 全量消毒→v-html 一次性注入（:583）
  ——**无行数/体积守卫、无虚拟化、无 sheet 截断**；触发链=xlsx 注册 excel 预览型
  （filePreview.ts:49）+file 类型详情默认 preview（doc-content.vue watch）→用户未点标签即冻
- **证据链双版闭合**：v0.8.0 组件（fork 逐字相同）上实测冻屏 + main 同款代码核验——
  上游 bug 成立；唯一保留=未在官方原版镜像复现（可诚实标注）
- 成稿（excel 预览缺守卫方向，英文+file:line）已备，待用户拍板投递或补自复现

## 2026-09-22 R3 — excel 预览冻屏 issue 投递（WSL2 中继 → 新加坡核验 → 投稿）
- **#3586 已投**：Document detail page freezes then crashes on large .xlsx — renderExcel 无守卫（open）
  - 触发链：filePreview.ts:49 excel 可预览 → doc-content.vue 详情默认预览 → document-preview.vue renderExcel(:241) XLSX.read 全量 + sheet_to_html 每 sheet 全行(:262-266) + sanitizeHTML + v-html(:583)，零守卫
- 用户第一手实测补全（信创 UOS + 360 浏览器）：9.28MB xlsx → 24,283 chunks；截图1=详情抽屉元数据渲染完、内容区空白、已弹"1个页面无响应"（主线程阻塞）；截图2="喔唷，崩溃啦！SIGTRAP"（渲染进程内存耗尽）。解析中/解析后行为一致（与解析状态无关，预览拉原始文件字节）
- 截图含 DLP 水印+券商文档标题，按 #3251 惯例不上传，文字证据成稿
- v0.8.0 UI 形态与 main 有差异（"预览"按钮+"查看分块"链接 vs main 三视图标签），但 renderExcel 组件两版核验一致；此差异不影响机制归因
- 流程复盘：WSL2 初稿机制归因错（合并视图全量拼接）被我拦下 → WSL2 承认并 diff 排除 fork 因素 → 用户补环境+截图 → 双版证据链闭合 → 投稿。跨节点草稿必须重新锚定的纪律再次生效

## 2026-09-23 R4 — 第 8 轮全池扫描（战局质变：自有 issue 进入农场狩猎半径）
- **外部池零机会，贴牌窗口塌缩到 4-18 分钟**：#3596→PR#3597（4min）、#3494→#3499（18min）、#3501→#3522、#3599→po-et 认领（73min）、#3551→PR#3552、#3361→PR#3389、#3403→yaodong-shen 待方向、#3516→tsumon 最小复现中
- **#3586（我方 15:43 投）被 dvd233 于 21:10 抢答 PR #3592**（5.5h）：8MiB 守卫+sheetRows 5001 截断检测+50K cells 上限+五语言+测试，质量高。判定：不硬拼；转"作者立场评审"——我方有唯一第一手复现数据（24283 chunks/SIGTRAP/解析前后均冻），另指出残余缺口：cells 上限在 metrics 检查处，宽表（5001×16384）解析成本在拒绝前已发生
- **#3342 第二片被 tsumon 以 issue #3594 占位**（等维护者确认入口即实现）。判定：放弃竞赛（我方已拿主片 #3493）；维护者定入口后可做 #3493 实现细节的技术输入（CreateBinding OnConflict DoNothing 幂等、同租户校验）
- **#3539 follow-up ② 材料到手**：tokg-venv（issue 作者）23:39 交付真实管线入口放大测量脚本+数据，正是我评论里要的回归基础。gated on #3566 合并
- 在途 7 PR（#3566/#3533/#3457/#3283/#3251/#3176/#3062）均无维护者评论
- 农场阵容确认：linus-liu-web 3h 连发 7 issue（#3558-#3584 批）+ LuckVd 对号自PR（#3605/#3606）；tsumon、po-et、yaodong-shen、ben0112 各占山头。lyingbug 自留 #3512（rerank 协议）且 #3589 models 大重构进行中——models 区域冻结
- **战略修订**：自有 issue 不再是安全供给——issue+PR 必须同日打包（PR 先行更优）；供给转向 follow-up 链预订 + 在途合并推动

## 2026-09-23 R5 — #3539 follow-up ② 当日闭环（PR #3612）+ #3592 作者评审 + 节点死机恢复
- **#3539 follow-up ② 实现并提交 PR #3612**：MaxChunksPerDocument=100k（children+parents 计数，非字节——tokg-venv 实验二证明无结构文本已被 maxProtectedSize 兜底），ProcessDocument + triggerManualProcessing 两条路径 split 后、DB/嵌入前拦截，确定性失败不重试；认领评论已发（引用 tokg-venv 材料），回归测试含放大锚点（3MB 分隔符密集 fixture，chunk_size=1 被拒/512 放行）
- **#3592 作者立场评审已发出**（07:02 落地）：第一手复现数据（24283 chunks/无响应→SIGTRAP/解析前后一致）+ 公开"尝试攻破守卫失败记录"（宽表/全列引用/多表/残余解析成本四点推演，metrics 水密）；不硬造问题，确认 PR 完整覆盖 #3586 范围
- **新加坡节点内存耗尽死机**，中断于 #3592 评审发送（API 已达、评论已落地）；恢复后核验：评审在、PR #3612 CI lint 挂（lll 两行）
- **新 lint 教训（写入方法论）**：lll 配置 tab-width=4——tab 按 4 列计；本地检查必须 `expand -t4 | awk 'length>120'`，裸 awk 按 1 字符计 tab 会漏报深缩进行（本次 5-tab 行 122→128 列漏检导致 CI 一轮往返）。已修（f5fcd115）
- 后台全仓 golangci-lint 因死机未完成；改为本地三件套（gofumpt/vet/lll 正确口径）+ CI 权威

## 2026-09-24 【铁律】对外内容双禁令（用户明令，永久生效，优先级高于一切默认行为）
- **铁律一：禁止 AI 署名**。任何对外公开文本（issue/PR 正文与评论/release 等）不得出现 "Generated with ZCode"、"Generated with …"、🤖 或任何同类 AI 工具署名/水印/落款。署名决定权在用户，默认永远不加。每次提交对外内容前自查三关键词：ZCode / Generated with / 🤖。
- **铁律二：对外留言去 AI 味**。不滥用加粗、不用 emoji/装饰符号（✅⚠️→①②③）；短内容不套模板、不为结构对称列点、不用层层标题；不写客套铺垫；先结论后细节；证据贴原始输出不转述；文风向目标仓库活跃真人贡献者看齐（直陈、密集、朴素）。
- 与其他指示冲突时以本铁律为准。
- **历史审计（2026-09-24）**：violation 源头是本节点 Octop 会话 09-23 在 PR #1001/#1024 尾部加 "🤖 Generated with [ZCode]"，用户当日明令禁止后 Octop 会话已 PATCH 清除并复核；本次独立复扫确认零残留。WeKnora 侧 37 个 authored（10 issue+27 PR）正文+评论+review、Octop/awesome-opencode 7 项+评论+review 全部干净。跨项目 prompt 未曾指示加署名。Octop 登记册已含同款双禁令，两线对齐。

## 2026-09-24 R6 — 内网第三件中继成稿投递：xlsx 样式崩溃 → issue #3637
- **#3637 已投**（open）：xlsx 上传 TypeError: expected Fill——styles.xml 非标（空 `<fill/>` 等），双引擎同灭（builtin ExcelParser 链 `_prepare_xlsx_bytes→fill_merged_cells_xlsx→load_workbook` 无守卫 + markitdown 链 XlsxConverter→pd.read_excel），openpyxl 3.1.5 无升级路径
- **重锚修正**（中继转录变形二连）：①"markdown_parser.py:56"实为 `markitdown_parser.py`（文件名转录变形，同 `_prepare_xlsx_bytes` 双下划线案）；②容器内 repair 调用顺序与 main 略异（镜像 build 差异），以 main git 锚为准
- **关键新发现（中继未覆盖）**：#1528（wolfkill，5月开、9-21 lyingbug 关闭未合并）正是同签名修复，关评论明确邀请"still hit on current main → open an issue with a sample file"——#3637 正是接这张牌；修复建议刻意避开被否的"手写 XML fallback"路线，改为扩展 xlsx_repair.py 既有 zip 级修复模式（维护性异议的对症回答）
- **样例交付**：本地 WeKnora-docreader 容器（openpyxl 3.1.5/py3.10）合成畸形 xlsx，迭代出三种命中形态（空 `<fill/>`/大写 `<Fill/>`/文本内容），取最小 diff 形态做成生成脚本 gist（vicfei/21f84de4）附于 issue——内网原件不外发，合成样例等效且可复现（traceback 与生产逐行一致：stylesheet.py→sequence.py:27→base.py:61）
- 引用三件全部亲验：openpyxl Heptapod #1805（双签名在案）、pandas #40499（崩溃全在 openpyxl 内、Excel 可开）、SO 72276196
- **脱敏**：无公司名/用户名/主机名/DB端点/内部文件名；"云文档系统导出"泛化表述。铁律自查通过（ZCode/Generated with/🤖 零命中），文风按铁律二（模板头沿用仓库格式，正文平实直陈）
- 关联在树前案已引：#2648/#2663（图表序列化）、#3599/#3608（dataValidation sqref，po-et 在修）

## 2026-09-24 R7 — #3637 当日 issue→PR 闭环：PR #3638（styles 清洗双链修复）
- **#3637 投出 2 小时内自带 PR #3638**（新纪律"issue+PR 同日打包"首次执行）；认领评论已发（方案三点：就地替换保索引/快乐路径单次 styles 扫描/双链差异化接入）
- 实现：`xlsx_repair.py` 新增 `sanitize_xlsx_styles`（zip 级，四种畸形形态就地替换为 no-op patternFill，cellXf fillId 引用稳定；干净工作簿返回 None）；链 A `_prepare_xlsx_bytes` TypeError→清洗→重试一次（清洗后字节流转 pd.ExcelFile）；链 B markitdown xlsx/xlsm 前置清洗（挂既有按类型预处理旁，lazy 重试在 MarkItDown 内不可靠）
- 对 #1528 关闭理由（手写解析器维护成本）的对症设计：openpyxl 仍是唯一读取器，零新增解析器
- 测试：docreader 容器（py3.10.18/openpyxl 3.1.5，与 CI 同版）6 新测全绿 + 全套 197 过/12 跳（唯一 error 是容器无 testdata/ 的环境缺项，与改动无关）；compileall 干净
- 发现记录：`<fill><Foo/></fill>`（unknown-child）openpyxl 实际容忍不崩——测试拆两组（三种崩溃形态做锚 + tolerated 单独断言规整化）
- 铁律自查通过（PR 正文/认领评论 grep 零命中，文风平实）
  - PR #3638 CI 一次全绿（Python tests + Go client + 安全扫描，2026-09-24）

## 2026-09-24 R8 — 第 9 轮全池扫描（外部池持续零机会；models 区解冻信号）
- 新批 6 issue 全部出清：#3609→作者自修 PR#3611；**#3625（MCP 图片 ImageContent）一日三 PR（#3630/#3639/#3640）**——农场开始互相复刻，竞争烈度再升；#3636 RFC 非快 PR 材料；#3626 大设计无维护者卷入；#3634 纯提问；#3629 低质量报告（正文零文字全靠截图，图片服务拒收 GitHub 附件无法读；代码面 skill API 全套俱在——/api/v1/skills、catalog install、sandbox skills CRUD——具体缺口无法定位）
- **重要信号：lyingbug 的 #3589 models 大重构已合并（09-23 06:20）——models 区解冻**。#3512（lyingbug 自提的 rerank 协议+补厂商行）随重构落地变为潜在可做区，但属维护者自有 issue，观望优先于抢入
- 我方 10 项在途全部无维护者动静（最老 #3062 已 17 天、#3176 14 天；暂不催——维护者厌催，等 lyingbug 批量审阅窗口）
- #3592（dvd233，修我方 #3586）仍未合并
- 结论不变：外部池结构性关闭；供给=在途合并+自有 follow-up 链（#3637 的 dxfs/.xls、#3539 的 preview 端点）+ 空闲槽 S-26
  - 2026-09-24 补 commit 502fa79b（用户拍板吸收 WSL2 对比结论两项）：①命中日志（计数+复发计量器语义，对齐 sharedStrings 修复日志先例，xlsx_repair.py 增 logger）②never-raise 包装（内部异常→返回 None 原样透传+warning 日志，公共函数拆 _sanitize_xlsx_styles 实现）；新增 2 测试（assertLogs 计数断言 + mock _rewrite_zip 抛 OSError 断言 None），容器 8/8 绿，CI 二连绿

## 2026-09-24 R9 — 第 10 轮全池扫描（质变终局：issue 与 PR 零间隔配对）
- 新批 9 issue：6 个实质项全部出生即带 PR（#3643→#3645、#3648→#3656、#3649→#3654、#3652→#3653、#3657→#3658、#3659→#3660）——**贴牌窗口从 4-18 分钟塌缩到 0 分钟：issue+fixture+PR 三件套流水线**（#3659 作者 Perfecto23 在 issue 里直接附自己 fork 的回归测试和 go test 命令，PR 同小时挂出）
- 池子文风"我方化"：证据密度型标题（"与同函数其他失败路径不一致"/"silently accepts truncated"）批量出现，Perfecto23 一小时两发——多账号 agent 农场在新规模复制我们的作业形态。issue 池正式变成别家 PR 的广播频道
- 剩余两项：#3646（检索引用回溯原文位置，真 feature 但设计面大，等维护者定方向，观察项）；#3655（提问级，四栏同句，扩展名混淆类）
- #3659（xlsx style-only sheet 幻影列）虽在我专业区但已被作者自修——农场连邻近选题都预占
- 我方 10 项在途依旧零维护者动静；#3512 无动静。供给线不变：在途合并 + 自有 follow-up（#3637 dxfs/.xls、#3539 preview 端点）+ S-26 空闲槽

## 2026-09-24 R10 — 牌桌盘点：#3533 收到 lyingbug 评审（漏接两天的活牌，已接）
- **发现机制盲区**：09-23/24 两轮扫描只查了 issue 评论端点，PR 评审在 reviews 端点——#3533 于 09-22 11:59 收到 lyingbug "we'd like to merge it. A few small things first" 评审，两天后才补扫到。教训：**PR 状态核查必须含 reviews + pulls/comments（inline）两个端点**
- 三阻塞项处置：①ineffassign 已在 78977b5d 解决（评审快照早于修复推送）；②lowerASCII 删除换 strings.EqualFold + 测试 oracle 换 strings.ToLower（eea10f3d）；③PositionPrior 注释改为真实语义（ratio 恒正，multiplier ∈ [1.0,1.05]，无低于 1.0 惩罚）。rebase 至 3e8b0bfc，CI 四绿
- **可选项是明牌**："a follow-up issue would be appreciated" → 已提 **#3663**（PositionPrior 语义：ratio=chunkLen/(startAt+chunkLen)，startAt≤19×chunkLen 即满额——实际近恒定 +0.05，残余变化与 chunk 尺寸耦合；三个选项请维护者定方向）
- 评审回复已发（逐项对应+commit 引用+issue 链接）；agent/tools 的 TestSkillPythonPackageRecovery 失败为宿主 ensurepip 环境缺项（登记册既有 pristine same-fail 记录）
- **牌桌全貌（本轮盘点）**：lyingbug 09-22 对全开 PR 池批量评审 ~20 个（含对我方 #3533；#3499 被指"Go 白名单缺 sql 端到端无效"）。剩余牌：#3512（他自提 rerank，#3589 合并后解冻，无明邀）、#3572（讨论型）、#3594（等他确认入口）、#3646（needs-triage 无表态）。我方其余 8 PR 排队等下一批评审窗口

## 2026-09-25 R11 — 第 11 轮机会扫描（#3533 终局 + 维护者整合潮 + 我方 PR 主动对齐）
- **#3533 关闭未合并（superseded）**：lyingbug #3675 落地同一整合（新 internal/reranking 包：rerank+composite+MMR，chat 与 agent 双管线共用），PositionPrior 按我方 #3663 选项 2 删除；我方源 issue #3093 closed as fixed。判定：实质胜出（16 天推动的方向落地 + #3663 的代数直接塑形其设计），形式未合。worktree u03b 已清理
- **#3646 关闭**：lyingbug 自己实现 #3700（引用打开到原文段落）——观察牌被维护者收回自做。近期 UX feature 请求他都在亲自做
- **维护者整合潮**：#3675（rerank 统一）/#3687（recall 正确性+分数尺度）/#3696（stuck processing）三天连发，retrieval+processing 两区大重组。**#3696 动了 #3612 的两个接线文件**——我方 #3566/#3612 已双双 rebase 至 8619bdf3，语义核验（插入点仍在：knowledge_process.go:3984/knowledge_create.go:1393，测试全过）并推送（0812d7f7/820d8e10），CI 自动重跑
- 外部池：#3668→PR#3669 预占；yeliheng-010 三连自供（Notion/Yuque sync bugs）；#3698/#3699（UX 分类/搜索）needs-triage 无表态——按 #3646 先例大概率维护者自做
- **战略读法**：lyingbug 正在把社区提案方向吸收进自己的大重构（#3675 吸收我方排名整合、#3700 吸收 #3646）。我方最高杠杆动作从"PR 实现竞争区"转向：①精确高分析度 issue（#3663 模式——他一天内采纳执行）②避开其活跃整合区的 PR（docreader #3638 安全区、knowledge 校验 #3566/#3612 半安全）
- 牌桌更新：#3594 仍等入口确认；#3512 常备；S-26 空闲槽

## 2026-09-26 R12 — 中秋两日（09-25/26）动静分析：#3638 合并（第10合）+ 维护者插件架构开幕
- **#3638 于 09-25 14:23 合并——第 10 个合并 PR**；#3637 同秒自动关闭。全周期 36 小时（issue 投递→PR→合并），史上最快。worktree weknora-3637 已清理
- **#3176 关闭（superseded）**：lyingbug 09-25 13:12——引号包裹/残留 Markdown 已由 unwrapTitleQuotes + #3633 的 title cleanup 处理；answer-leak 启发式在 main 无法复现，"没有具体案例不愿加"。教训：启发式修复必须有可复现锚点，否则维护者宁可不要
- **中秋不休**：lyingbug 09-25 单日合并 ~30 个 PR（10:47-14:33 一波清了 ~20 个积压，含农场作品 Perfecto23 #3653/dvd233 #3611/DerrickLinus #3552），自创自合 ~10 个
- **插件系统架构开幕（重大战略面）**：#3711→#3716→#3720→#3721→#3724→#3725→#3727 七连发（builtin/declarative MCP+skills/code plugins+Go SDK/Host API+KV/remote runtime+Python SDK/standalone hosts+Redis discovery/sandboxed pages）——两天内 laying 的新地基。后续必然派生：新 issue 群、社区插件生态位、协议文档缺口
- 我方余 7 PR：#3566 clean；#3612/#3457/#3283/#3251/#3062 mergeable:null（大合并后待 GitHub 重算，监控项）
- 新 issue 池 25/26 共 7 个：农场自供 4（yeliheng×2、hahaha×1、tangkh UX×2 待分诊）+ RFC #3708（二次投递）

## 2026-09-27 R13 — 机会扫描 + 四 PR 全量对齐当前 main（CI 全绿）
- **扫描结论**：外部池零可认领（农场 issue+PR 预配对持续）；插件系统七连发已全合入（新地基完整落地，生态层等维护者开牌）；#3750（OneNote 导入）唯一无 PR 真需求但需维护者表态
- **#3251（doubao）重对齐**：三处冲突解（serply 先合，双保留）+ 三轮 lint 波（lll×9→staticcheck/revive×6→导出注释/签名换行）+ **swagger 教训**：本机 swag v1.16.4 重生成会丢契约测试要求的定义——正确做法是恢复 main 文档三件套后外科手术式只加 doubao 枚举+x-enum-varnames（原 PR 的老手法）。fa773ec6 ALL GREEN
- **#3457（vlm detail）重做而非 rebase**：#3589 重构删除 go-openai 后分支不可救——语义核查发现缺陷**在重构中幸存且扩散为 4 处**（vlm Predict/completions Images fallback/responses Images fallback + responses MultiContent 的 orDefault 强制 auto）。基于新架构重写（留空即消失，omitempty 双 wire 类型确认）+ 3 组测试 + 更新钉死旧行为的存量测试 TestBuildRequestBodyImagesAndAuto。a90ae004 四绿，PR 评论已发
- **#3283（pdf 表格量词）**：冲突与上游新 SOURCE_BOXES 行框特性同点——双保留合并（我方参数化调用+上游 line_boxes），容器 49 测过。1bed1b51 绿
- **#3062（opencode 插件）**：README 重构为表格形态——我方段落改为表格行融入（镜像 dsh 行，四语言）。a22656cf 绿
- **新教训**：①rebase 后 CI 以新 main 为 lint 基准，老 PR 代码全部进"新代码窗口"——lll/staticcheck/revive 全套补课；②swagger 生成物冲突永远外科手术、不整文件重生成；③本地导出符号审计正则要含带接收者方法；④awk 行长对 CJK 是字节口径，CI lll 是字符口径
- 在途 8→7 PR 全部 clean 待下一批审阅波（lyingbug 节奏：09-22/09-25 各一批）

## 2026-09-27 R14 — 第 13 轮 PR 机会扫描（合并低谷期；#3796 机制证伪）
- 我方 6 PR 全 clean 零维护者触碰；合并低谷（20h 仅 1 合并，#3794 lyingbug citations 自修）——09-25 大清仓后无新批，审阅窗口时机不明
- 农场新动向：linus-liu-web 转向钉钉数据源全家桶（今日 7 组 issue+PR 对：Validate/连接器/上传文件/表格/Base/wiki 写保护）
- **#3796（RRF 按切片位置排名）唯一无主候选，但机制在当前 main 证伪**：bestRanks→deduplicateByScore 结尾 sortByScoreDesc——每列表先按分排序再取位置，完成序不泄漏。报告者或测于 #3687 之前版本。残余关切=列表局部排名跨不等长列表的 RRF 语义（设计特性）。判定：验证评论机会（po-et 式），非认领机会——等用户拍板再发
- #3803/#3804（SIGTERM 关停竞态）为本账号另一会话 17:42 新发（非本会话）——纳入视野不触碰
- #3797→#3801/#3802 预占；#3780→#3807 预占；#3789（skill 示例 docs）显示插件生态文档位开始被社区填充
  - #3796 验证评论已发（用户批准）：当前 main 机制证伪（bestRanks→deduplicateByScore 内含 sortByScoreDesc，完成序不进排名，#3687 或为分界）+ 残余 list-local RRF 语义问题独立成_thread 的建议 + 请求报告者钉版本。铁律自查通过

## 2026-09-28 R15 — 解决侧分布分析（148 合并 / 171 关闭，窗口 09-20+）
- 核心读数：合并潮=09-24 v0.8.2 发版（#3632 changelog 同步）；171 关闭中大头是 09-20 stale 清档（#98-#1616 上古批量归档），真修复关闭为少数
- 我方窗口内合并 2 个（#3493/#3638），个人贡献者前列

## 2026-09-28 R16 — 接上海节点交接：上游哨位（SIGTERM 竞态线）
- 交接核验通过：/tmp/WeKnora-pr（fix/sigterm-cleanup-race@6b6b9967）、/tmp/sigpkg（补丁+证据+issue 草稿）、~/golang/go 均在位
- 状态快照：PR #3804 open/clean/CI 四绿，零评审零评论；#3803 open 1c（互链）；#3806 open 0c（BrowserSkill 跨轮失效，或落 Tencent/BrowserSkill 仓库）；#3805 已撤回关闭（勿动）
- 职责并入既有看护：双端点纪律照常；**修复所有权在上海**——我方只回澄清类评论、按指令 git am 上海新补丁并推送；信誉动作先经用户确认；小机不做重编译
- 此前 R13 扫描发现的"本账号另一会话"#3803-#3806 即此线（本机受托发布的 GitHub 出口动作），谜底解开
- 定时巡查 cron：上海提议待用户定周期，未设

## 2026-09-28 R17 — WSL2 中继：xlsx 大表守卫调研（重锚四论断全过）
- ①行级切块在 main 实锤（excel_parser.py:118 iterrows→:135 chunks.append）②大表守卫缺失实锤（无任何 row/threshold/guard）③ParserEngineRules 按类型引擎规则在位 ④xlsx_first_row_as_header 在位（knowledge_process_config.go:13）
- 调研增量：calamine/fastexcel（Rust 读取派，样式免疫+提速一个量级，pandas engine 级替换）；SpreadsheetLLM（微软，结构锚点压缩，学术正解）；sheetwise（其开源实现，压缩派 96% token 缩减）vs knowledgestack/excel-parser（保真引用派，source_uri 精确到 Sheet!A1:F18，引用召回 0.889 vs Docling 0.000）；业界共识：xlsx 大表分诊无人做
- **关键定位**：两家借鉴库都站在 openpyxl 上——我们的 #3638 sanitizer 是它们的前置刚需（openpyxl 上游不修、下游生态集体买单，可作跨库 issue 证据）
- 「大表守卫」issue 成熟度跃升：第一手量化数据（9MB→24,283 块、3.4K块/MB vs PDF 百万字 2.1-2.5K、单档 1.5h vs 常规 46-57块/s）+ 业界空白确认 + 学术设计依据（锚点压缩替代简单截断）+ source_uri 溯源差异化方向。与 #3586/#3637 构成 xlsx 治理三部曲第三部
- PoC 场地定 SG（合成工作簿，生产 36 巨兽不出内网）；等用户拍板 issue 成稿投递

## 2026-09-28 R18 — 独立库 xlsx-triage 落地（用户拍板：先建库，WeKnora issue 暂缓）
- **vicfei/xlsx-triage（PRIVATE）已建仓推送**：RAG 分诊层定位——小表行级 / 大表锚点压缩（schema画像+verbatim头部+section锚点+显式coverage），全 chunk 带 source_uri（#Sheet!A1:F18），内置 #3638 移植的样式清洗作为读取前置（never-raise）
- 纯 Python（仅依赖 openpyxl），src 布局，8 模块；25 测试全绿（四畸形形态矩阵/分诊边界含生产规模数字 24283/uri 构造/压缩 token 缩减 >90%/端到端混合模式）；CI workflow（3.10+3.12）
- 许可核查：sheetwise 实体 Apache-2.0（README 标 MIT 是错的）→ 只借鉴思想零拷贝；excel-parser MIT；本库 MIT，README 致谢设计来源
- 测试环境：宿主缺 python3-venv，用 docreader 容器跑（PYTHONPATH=src）；两处测试期望自纠（unknown-child 容忍形态不触发清洗路径 / 坏 zip 构造改 mock）
- **保密纪律**：库计划对 WeKnora 侧零披露（登记册为内部文档）；WeKnora issue「大表分诊缺失」按用户决定暂缓，与库解耦
- 下一步（未执行）：calamine 引擎位预留已留（reader seam）；锚点压缩深化；插件系统 re-land 后做 WeKnora 集成

## 2026-09-29 R19 — 第 14 轮扫描：#3804 合并（第 11 合，上海线首胜）+ 我方旧六 PR 三波未被审
- **PR #3804 于 09-28 15:37 合并（零评审直接合）**：上海诊断的 SIGTERM 竞态修复经我方出口上岸——账号累计第 11 合；#3803 同秒自动关闭；#3806（BrowserSkill）仍零回应。按 handoff 职责：已向用户报告"下次上游同步收入"（上海走官方优先纪律不手动摘樱桃）
- 09-28 14:00-17:32 又一波 ~13 合并（linus 错误吞噬七连+钉钉、yeliheng RSS/Notion/GitLab、VictorMaznyuk、BaiMoHan、dajiaohuang、nullptr）：**该波吃了我方 #3804 但旧六 PR（#3457/#3251/#3283/#3062/#3612/#3566）全部零触碰**——三波模式：每波带走我方 1-2 个新旧交替，旧六排队已 4-20 天
- 外部池持续零机会：linus 又发 issue+PR 七连预配对（错误吞噬家族+分页防护家族）；#3820 embed 400 → #3850 已合 + 两竞速 PR；#3828/#3829 均自带 PR
- 牌桌不变：#3572 用例征集牌（用户已知）、#3172/#3353 增强评论机会、插件 re-land 观察、#3594 等待

## 2026-09-29 R20 — 第 15 轮扫描（外部池连续第五轮零可认领）
- 我方 6 PR 第三波被跳过（09-29 的 4 合并又无我方）——旧六排队 5-21 天，全部 clean 零触碰
- linus-liu-web 14:11 一分钟 13 issue（CopyIndices 四库家族/RebuildLinks/query_knowledge_graph 截断/web_fetch/GitLab 体积/IMA/Notion 分页/OCR 超时/token 颁发/MCP 连接测试）+ PR 随配；dajiaohuang 双自配对；it235 Confluence 自配对
- 四候选出清：#3865（KnowledgeQA usage）被 BaiMoHan 评论认领出局；#3867（关配置后问句向量残留，iceriverlin 二连报，带生产只读统计 63,467 行）无 PR 但落在检索区+#2652 维护者"由检索效果评测决定"先例——设计敏感，只宜验证评论不宜抢修；#3849 无复现素材弱；#3851 贡献者自留可能
- 新个体观察：BaiMoHan（合并+认领）与 iceriverlin（RRF+问句向量两连深报，生产统计型）在成型——池子里的"分析师型个体"在增加
- 牌桌四张不变：#3572 用例/#3172+#3353 增强评论/xlsx-triage 库深化；#3594 无动静
  - 2026-09-30/10-01 快查：合并波持续（09-30 八连：lyingbug AnyDoc 0.2.4 升级+邀请制注册档、linus 13 连开始落地×3、nullptr×2）；我方旧六第四波被跳过；#3849（docx 页眉）已有 helloxade #3914 修复 PR（弱候选自然出清）；插件系统仍未 re-land

## 2026-10-03 R21 — 第 16 轮扫描（国庆静默期；仅两个无主候选）
- **近 48h 零合并**（10-01 07:26 后无合并波）——国庆假期效应；提交流量仍在（farm 预配对照常：linus EMF/WMF 对、icearia0219 工具参数对）。我方旧六第五个周期零触碰（#3062 已 26 天），假期不宜 ping
- 本账号另一会话新线：#3941（技能安装验证 vendored 依赖树）、#3942（沙箱清扫器竞态）+ PR #3943（10-02）——非本会话，不碰
- 无主候选仅二：#3940（QA 脚本默认 gpt-4o-2024-05-13 已下线，一行级修）、#3923（pt-BR i18n——通道已被 Polish/vi-VN/zh-TW 验证可合，但体量大且非母语质量风险，farm 不做 i18n，竞争低）。#3922/#3926 均已被 PR 预占
- 生态信号：#3917 有人给仓库加 docs/agents/* 工程文档——agent 友好化趋势
- 节后预判：假期后大概率有清仓波（09-25 大扫除先例），我方六张 clean 牌在波前就位

## 2026-10-03 R22 — 上海委托独立复核（四提交物）完成
- **#3943（重点）三段复核全过**：①机理证实——20行 Go 验证器实measured 5000 vendored 路径→命令串 340,039 字节>131072（内核头 MAX_ARG_STRLEN=PAGE_SIZE*32 实锚），补丁后同输入 39 字节；②Skill 测试 182 过/1 败（TestSkillPythonVerifier 基线同败=环境性，严格归因）；③**嵌套边界缺口成立**（ParseSkillBundle 的 Files=zip 相对路径，tools/.venv 合法）→ 按授权追加加固 commit 9b40f63b（underVendoredTree 任意深度过滤 + 嵌套回归测试），已推送
- **引文核对全部证实，零乌龙**：#3941 的 for 单参数拼接✅（正文未引 512MB/20000——那是交接摘要自身的数字，20000 与实际常量 100_000 不符但不影响 issue）；#3942 三处逐字✅（sweeper 注释 docker_idle_sweeper.go:16 / makeDir 格式真身 docker_remote_client.go:1046 firstNonEmptyLine / remote_client.go:358 DefaultSandboxExecUser="root"）
- **#3942 机理审计评论已发**：B 排除（Create 有 waitUntilRunning:298 注释记录历史 409、exec 有 ensureRunning:526 门）；A 成立+窗口五步刻画（inspect 过→清扫删→exec 空 stderr→InvalidRequest:1043→CanReplaceRemoteBinding:254 白名单不含→断自愈）；关键增量=清扫器安全声明只对 inspect-404 路径成立，mid-flight 窗口不成立；修复方向一（exec 失败后 inspect 复核改判）改动面更小
- **交接陈旧信息标记**：#3804 于 09-28 已合并（漂移检查无意义）——交接写于合并前
- GitHub 动作：#3943 分支加固 commit 推送；#3942 审计评论；无其他（遵只动授权范围纪律）

## 2026-10-05 R23 — 第 5 棒委托执行（中继推送 + 两处交接乌龙核实）
- **任务一完成**：bundle（78M 全量，verify 通过）中继推送 kbpaamc/main：ce00329c..8573abcf，远端 HEAD 确认 8573abcf（102-sync + fork-v5）。只推 main，未碰 fix 分支
- **任务二两处乌龙（未执行其指令，依据核实）**：①#3804 早已于 09-28 合并（merge_commit=ec0ca463），"评论并 close"无意义；②bccb4b15 实为 embed 修复（与 SIGTERM 无关）；③**反转**：引入 ShutdownBudgets 的 ec0ca463 正是 #3804 自己的合并提交——上海在上游看到的"官方实现"就是我们出口合并的他们自己的最终扩展版（8+ 文件：shutdown.go/shutdown_test.go/双 main/cleanup.go/cleaners，远超初版 +13/-5，说明合并前上海推过大扩展补丁）。无需任何 PR 动作
- **任务三核实**：#3942 审计评论在案（issuecomment-5956982734，2026-10-02T16:45Z，即本会话 10-03 段）——上海"网页端零评论"为缓存/看错，未重复发送
- **任务四巡检**：#3943 open/clean/0c（含我方加固 9b40f63b）；#3803 closed（随合并自动关）；#3941 open 0c；#3806 open 0c。upstream/main HEAD=bccb4b15（09-30）后零新提交——国庆全冻结
- GitHub 动作：仅 kbpaamc 推送。零多余动作（两处乌龙均拦截在执行前）

## 2026-10-06 R24 — 第 5 棒收口委托执行完毕
- **任务一 ✅**：差量 bundle（109K，sha256 校验通过，基点 8573abcf 具备）fetch→push kbpaamc/main：8573abcf..d3636da1，远端确认 **d3636da1a**。FF 安全预检后推送，未 force。注：区间实数 17 提交（交接称 19，小出入无害，HEAD 精确匹配）
- **任务二 ✅ PR #3980 已开**（fix/sandbox-idle-sweep-race@1bb8bb741，Bug3=#3942 机理A的"方向一"修复）：分支复核 2 文件+88/-17 与委托书精确一致；单包回归测试两条 PASS（消失容器→NotFound+换绑 / 真失败→InvalidRequest+保绑定）；铁律自查过；#3942 链接评论已发（issuecomment-5999642917）；**CI 四绿**
- **任务三巡检**：#3943/#3941/#3806 零动静（10-02/09-27 起）；#3942 现 2 评论（我们的审计+链接评论）；upstream bccb4b15（09-30）后仍零新提交——国庆第 7 天全冻结
- GitHub 动作：kbpaamc push、origin 推分支、开 PR #3980、#3942 评论。无异常

## 2026-10-07 R25 — 例行委托：v3.1 分支中继 + 巡检
- **v3.1 分支补推 ✅**：bundle 前提 bb5b37d0 具备→fetch（80a950ad，基点上恰 3 提交：bocha/doubao 紧急回移+DMZ 适配集成测试+P1/P2/P4）→ 新建推送 kbpaamc `backport/v3.1-bocha-doubao`，远端确认 80a950ad9。未碰 main
- **kbpaamc/main 核对 ✅ = 9df00ac72**（10-07 08:05，上海直推的 P2/P4 在位）
- 巡检：#3980/#3943/#3941/#3806 全零动静；#3942 两评论（皆我方）；**upstream 仍冻在 bccb4b15（09-30）**——国庆假期名义上今天结束，维护者尚未回归
- 无异常；两次 jq 引号笔误自纠（不影响任何远端操作）

## 2026-10-12 R26 — 第 17 轮扫描：节后大丰收 + #3612 技术性否决 + 唯一真候选 #4125
- **三连动静**：#3980（Bug3 沙箱竞态）与 #3943（vendored 过滤，含我方加固）10-07 17:28 同分钟合并——**账号累计 13 合**；#3612（chunk 预算）10-07 关闭未合并，lyingbug 技术否决两点（50MB 默认上限下合法大表可超 10 万块会误杀真文档；检查点在 split 后不省内存成本）+ **点名 #3566 为根因正解**——间接背书
- 余 5 PR 全 clean（#3566/#3457/#3251/#3283/#3062）；#3566 分支落后 main 232 提交但无冲突，被点名后随时可 rebase 刷新
- 节后合并波 10-10→10-12 大开：lyingbug 自己连发（gallery 无限滚动/wiki 图谱/OCR 校验/observability/preview 引用）；社区大件：Cohere rerank v2、Claude 5.5 模型行、平台用户管理、docker 交互终端；农场有斩获（Perfecto23 helm/LuckVd paradedb）
- 候选出清：#4129 被 tayadwx 自留（画廊按文档筛图方案）；#4149 是 tayadwx 自己的三臂实验线（agent 治理实体清单方案三）；**#4125（MDX 导入支持）唯一真候选**——正文已查清 Go 白名单 import_filetypes.go + builtin_converter simpleFormats 两处缺口，两天无人认领，.sql 线同族（lyingbug 在 #3499 评审里亲自教过"端到端白名单"课），farm 未碰
- 行动选项待用户拍板：认领 #4125（推荐）/ #3612 礼貌性回复 / 持牌

## 2026-10-12 R27 — 三任务推进完毕（磁盘两度中断均恢复）
- **① #3566 rebase 刷新完成**：b18b10622（7925f774d 基），CI 四绿——lyingbug 点名"正解"后的存在感刷新
- **② #3612 礼貌回复已发**：认可两点否决理由（50MB 数学/后置检查不省成本）+ 提及 #3566 已刷新
- **③ #4125 MDX 支持当日闭环：PR #4182 已开，CI 七项全绿（ba2613d9）**：
  - 五层接线：导入白名单（单源真理覆盖上传/URL/worker/连接器）+ simpleFormats + 双引擎 FileTypes + 前端 DEFAULT_VALID_TYPES
  - MDX 降级器（mdx.go）：行扫描状态机（RE2 无反向引用教训）——import/export 语句行丢弃、JSX/HTML 标签剥壳留瓤、代码围栏逐字保留（围栏内 JSX 不动）、标题存活保 chunking；`a < b` 散文数学安全
  - 测试涟漪三处自纠：镜像断言加 mdx（本就是 PR 的目的）；Seafile 两夹具把"不支持样例".mdx→.exe（.zip 样例在，意图保留）
  - **MCP TestResourceListStopsRepeatedCursors 判定为 main 存量破损**（纯净 c2edec192 本地双复现）——PR 评论已附证据链；首轮 CI 它挂、次轮 CI 它过（CI 侧 flaky/环境差异），PR 侧全绿
- 磁盘事件两度中断（会话执行区满→上海清 docker 缓存 20G+；再次满→再清 18G 在位）；根因：多项目共用节点积累，深层清理建议已列（octop-memory-scan 5.1G、~/go 3.5G、weknora-images 3G、他会在 /tmp 690M+）
- 在途：7 PR 排队（#4182 新 + #3457/#3251/#3283/#3062/#3566 + 上海线 #3941/#3806 issue）

## 2026-10-12 R28 — WSL2 战役委托：裸上游验证完成 + 战役形态修正
- **裸官方栈验证 ✅**（wechatopenai:main 镜像，恢复栈→修测试账号 bcrypt 密码（Go 工具链生成，容器无 pip 的弯路）→builtin 绑 model+rerank（两次 400 报错引导）→三组对照）：knowledge-chat references=1+落库 1 条；**builtin agent-chat 零事件+落库 []+原始流字符串级零出现**；内联 <kb/> 非确定（同栈两次 3 处/0 处）——"唯一通道不可靠"论点实锚
- **查重修正战役**：#3501（09-21 同题 issue）仍开零评论即该立的牌；#3522（社区修复 PR）悬置三周未合并（曾获合并意向+作者已响应评审）；当前 main 代码级定罪：AgentReferencesData 唯一发射点 session_knowledge_qa.go:1331（knowledge-chat 侧），agent 引擎零发射者——fork"自定义有引用"=回移 #3522，builtin 连 fork 也无
- 正确打法：#3501 发证据增强评论（矩阵+上游运行时+代码分析+#3522 中性提示），不开新 issue；docs PR 照做
- 产物：~/java-sse-kit/SG-RESULT-upstream-verify-20261012.md（协调文件，含分工建议：SG 起草+投递、上海把关互锚）+ sse-sample-agent-chat-20261012-upstream-builtin.txt（171 行裸上游原始流）
- 栈已复停（恢复用户暂停态）；测试账号密码已重置为一次性值（登记：opencode-manual@test.local / SseTest#2026，本地测试栈）

## 2026-10-12 R29 — WSL2 裁决执行：两份草稿完成，待上海互锚后投递
- 裁决采纳：不开新 issue、增强 #3501；docs 措辞护栏（agent-chat 差异链接 #3501 注"修复讨论中"，不写成永久契约）
- **草稿一**（~/java-sse-kit/DRAFT-comment-3501.md）：#3501 证据增强评论——中文（线程语言）；结构=当前 main 完全成立且影响面更广（custom+builtin 一律）→代码级机理（唯一发射点+handleReferences 连体）→官方镜像栈运行时对照表→多环境交叉→"fork 自定义有引用系本地增强"澄清→内联标记非确定实测（3→0）+#3522 中性提示与独立佐证→builtin 配置前置
- **草稿二**（~/java-sse-kit/DRAFT-docs-sse-contract.md）：docs PR 补丁——落位 02-api-chat.md（agent-chat 端点后）；三块新增=两接口差异表（护栏措辞）、内联 <kb/> 解析三要点（流式切块聚合/非确定性降级/字段同源）、builtin 绑模型前置（curl 示例）；总览 SSE 节已有信封与事件枚举不重复
- 投递顺序：上海审 #3522 diff+互锚两稿 → SG PAT 投递（评论→docs PR 互链）。当前状态：**等上海互锚**

## 2026-10-12 R30 — SSE 契约战役投递完成（三节点协作闭环）
- **#3501 证据增强评论已投**（issuecomment-6124755690）：上海互锚两处修订落实——①"fork 本地增强"归因撤回换中性表述（上海分支考古证伪：fork 全分支+v0.8.0 官方均无 agent 侧发射器，WSL2 10-08 样本的 references=1 成因未定按红线不提交）②#3522 覆盖面升级为确定性表述（上海审阅：收集逻辑挂通用 ReAct 循环、与工具名解耦、builtin/custom 同路覆盖——合并后两场景一并关闭）
- **docs PR #4204 已开（CI 绿）**：02-api-chat.md +38 行——两接口差异表（"修复讨论中 #3501"护栏措辞×2）、内联 <kb/> 解析三要点、builtin 绑模型前置 curl；PR 正文链 #3501 评论
- 战役三件套落位：#3501（牌，已增强）↔ #4204（docs，在途）↔ #3522（社区修复，获独立佐证+覆盖面确认）；等 WSL2 登记收口
- 流程复盘：双向重锚纪律全效——SG 裸上游运行时+main 行号、上海分支考古+草稿核验+#3522 审阅；"只提交验证过的断言"红线拦下一次归因乌龙（fork 增强）

## 2026-10-16 R31 — 第 18 轮扫描：池面全预占（唯一漏网 #4313）；我方七牌穿越两波未叫号
- 我方 7 PR（#4204/#4182/#3457/#3251/#3283/#3062/#3566）穿越 10-14→16 两波合并全部零触碰；#3522 仍未合（09-23 后无动）；#3501 我方评论后暂无维护者回应
- 大盘：lyingbug 进入产品建造模式——"WeKnora 助手"套件 10+ PR 连发（助手管 KB/agent/技能/文档/FAQ+侧栏+权限）+RRF 设置控件+swagger 真实契约文档；外部评审带宽被自家工程挤压是排队延迟的合理注解
- 池面：新批 30+ issue 全部预占（#4273/4275→自PR、#4329→#4354、#4268→自PR+他人认领、#4243→#4279、#4331→#4332、#4335→旧PR#3498、#4311→#4392）；**唯一无主：#4313**（liouxb：带图/文件请求的审计与记忆写库 varchar(1000) 溢出+base64 全量进应用日志——真实但非我方专域，报告者三连报型可能自续）
- 值记：Greenplumwine #3497 排队 26 天后终于合并——排队耐心有先例可援
- 战役件去向：#4204/#4182/#3522/#3501 四件等波次

## 2026-10-20 R32 — 第 19 轮扫描：预配对覆盖率 100%（含个体贡献者）；七牌穿越第三波零叫号
- 六候选全预占（#4477→#4478、#4458→#4459、#4484→#4485、#4469→#4470、#4503→#4505、#4486→#4487）——**issue+PR 同发已成为全体贡献者的标准工作流**（不再限于农场），"先 issue 后认领"模式正式死亡
- 我方 7 PR 穿越 10-17→20 第三波合并（lyingbug automation/助手权限/多智能体协作大套件 + nullptr 双模式沙箱基础 + 农场多件）全部零触碰；#3062 排队 23 天（Greenplumwine 先例 26 天，30 天时考虑 ping）
- 大盘注解：lyingbug 持续自家产品建造（automation 套件、统一 agent 权限模型、助手多智能体协作），外部评审带宽继续被挤压
- 我方新 PR 的可行路径收敛为三条：自有发现同日打包（现行为）、维护者邀约牌、战役线程延续

## 2026-10-20 R33 — 本地官方栈升级 v0.8.3 并恢复服务
- 流程：pg_dump 备份（434K，/home/ubuntu/weknora-backup-20261020-2354.sql）→ .env WEKNORA_VERSION main→v0.8.3 → 三镜像拉取（app/ui/docreader）→ up -d
- 结果：五容器运行（app+docreader healthy），启动迁移自动完成（80 表），数据完好（1 KB/1 completed 文档/测试账号可登录）
- 冒烟：knowledge-chat 全链通——references=1 事件（v0.8.3 上引用通道照常）、complete 正常终止、DashScope 模型端点活跃
- 注：compose 的 sandbox 服务未起（v0.8.3 镜像集未含或门控关闭，与主链无关）；本地栈现作为"官方最新版试验场"，与上游 main 开发验证解耦

## 2026-10-21 R34 — v0.8.3 栈沙箱配置：Docker 后端全绿交付，Cube 待凭据
- **Docker 后端完整落地**：①占位服务预拉 weknora-sandbox:v0.8.3 镜像；②.env WEKNORA_SANDBOX_DOCKER_ENABLED=true（部署级闸门，注释明示 docker.sock=宿主 root）；③compose 取消注释挂载 /var/run/docker.sock（入口脚本自动按 GID 加组）；④重建 app（日志实锚 sandbox.docker_enabled applied enabled=true）；⑤POST /sandbox-configs 建 docker-local 配置（id=2f009e19）；⑥**官方 deep 完整验证五项全绿**（daemon 可达/凭据/模板/真实建容器跑探针 sandbox_exec 140ms/出站可达）+ capabilities: pause_resume/reconnect
- 架构笔记：compose 的 sandbox 服务是 profile=full 占位（跑 true 只为拉镜像），真后端=app 按 session 用该镜像建容器（空闲 TTL 清扫即 #3942/#3980 所修子系统）；后端配置全部在「设置→沙箱后端」（TenantSandboxConfig：cube/e2b/docker 三型+网络策略+EnvVars 加密+卷挂载）
- **Cube 后端待用户凭据四件套**：api_url（控制面）、api_key（按集群）、template_id、sandbox_domain（数据面，自托管另有 proxy_url）；就绪后一键 sandbox-check（deep 会真建远端沙箱）→ POST /sandbox-configs
- 测试账号备注：opencode-manual@test.local / SseTest#2026（本地栈）

## 2026-10-26 R35 — 会话续接：第 20 轮巡检，七牌穿越 10-26 早波零叫号；节点磁盘 94% 预警
- **上游今日（10-26 UTC 04:24–05:35）一波 15 件合并**，main 头 236d79614（05:35）——lyingbug #4729（共享沙箱跨技能保留）+ ydflow 六连（agent 压缩/沙箱 stderr 预览/#4675 deep-check 进度保持）+ 社区多件（sqlite 组织支持/rerank 分数刻度/docreader PDF 边界）；**我方 7 PR 全 open 零触碰，双端点（reviews+comments since 10-20）全零**，updated_at 停在各自最后动作日
- 战役件：#3501 仍只有我方 10-12 评论，维护者零回应；#3522 悬置如故（09-23 后无动）
- **#3062 排队第 29 天**（09-27 开），明日 10-27 满 30 天=礼貌 ping 决策日（Greenplumwine 26 天先例已过）
- 节点健康：内存正常（used 1.7G/3.6G）、WeKnora 五容器 v0.8.3 健康；**磁盘 94%（7.6G 空闲）预警**——Docker 镜像 52.75G 其中 34.16G 可回收（未被运行/停止容器引用）为最大杠杆，`docker image prune -a` 可释 34G；共节点多项目（deer-flow 等），清理留用户拍板未执行；/tmp 无我方遗留；他人项目大户不动（octop-memory-scan 5.4G、~/go 3.8G、weknora-images 3.0G）
- 等待输入不变：WSL2 Cube 四件套；DeepSeek Search provider 等用户点头
- **【R35 勘误 10-28】**GitHub 权威核验：①#3062 创建日实为 09-07（登记册误记 09-27，该日是对齐 main 的刷新日）→ 排队已 51 天，30 天 ping 决策已过点，下次巡检时升级处理；②在途实为 **8 PR** 非 7——#4069（10-08，中文向 provider 连通性测试修复）在册外遗漏；#4204 author=vicfei 实锚（gh pr list 偶发漏列，以 API 直查为准）；③合并 13 件全清单已 GitHub 实锚（3036/3069/3096/3104/3273/3336/3339/3367/3493/3638/3804/3943/3980，跨度 09-07→10-07）+ issue 17 件——为用户试用期汇报材料提供的数字基座

## 2026-10-30 R36 — 第 21 轮扫描：v0.9.0 发布（4 天 44 合并）；#4204 被 lyingbug 静默关闭；DeepSeek 方向出局；5 PR 转 dirty
- 大盘：上游 10-29 发布 **v0.9.0**（assistant onboarding）；10-26 06:00 以来 44 件合并（社区大件：Nextcloud WebDAV #4601、语音输入 #4804、deepseek search #4792 等）；我方 7 PR 双端点零新动静（穿越第 5 波零叫号）
- **#4204 被 lyingbug 10-26 15:02 静默关闭**（未合并/零评论/非批量清理——同期被关仅 5 件均为个案）；v0.9.0 文档重构（c73c06b4b 10-29 改写 website-docs/04-api/02-api-chat.md）为大概率动因（同文件冲突规避）；**新版 607 行实测三缺口仍在**：两接口事件差异/references 发射差异、内联 <kb/> 解析要点、builtin 绑定前置——战役延续牌成立：适配新文档结构重投新 PR（不 reopen 旧件；是否行动留用户裁决）
- **DeepSeek Search 方向出局**：issue #4828（10-28）当日配对 begoniezhao PR #4792，10-29 lyingbug 合并（初读 state=closed 误判被拒，实为合并后关闭）；chengjoey #4837 撞车后 10-30 自关——**provider 类小件的"issue→PR→次日合并"快车道仍有效**（我方 bocha/doubao 打法被他人复制验证）
- **在途维护警报**：合并波后 #4182/#4069/#3566/#3251/#3283 全部 **dirty**（与 main 冲突），仅 #3457/#3062 clean——rebase 刷新为最高优先常规动作（#3566 被 lyingbug 点名"正解"尤需保鲜）
- 新池：10-26 以来 14+ 新 issue，bug 型全部 1 日内被配对（#4908/#4921/#4907/#4909/#4917/#4918）；未配对者全为大型 feature（#4887 解析队列跨空间公平调度／#4892 整库重建／#4878 批量共享授权／#4914 Confluence 附件摄取）——均非同日牌；#4887 与我方摄取管线专域重合但需设计讨论先行，仅记录
- 其他：#3062 排队第 53 天（ping 决策过点待用户）；#3501 维护者零回应、#3522 悬置如故；本地栈 v0.8.3→v0.9.0 升级是自有发现矿脉（待排）；#4791（client 不完整 SSE 帧上报，ydflow）合并——SSE 健壮性仍是维护者活跃兴趣区，佐证契约文档牌价值

## 2026-10-30 R37 — 本地栈升级 v0.9.0 完成：迁移 118→134、Docker 沙箱复验全绿、knowledge-chat 引用通道正常
- 流程：pg_dump 备份（467K，~/weknora-backup-20261030-2317.sql）→ .env v0.8.3→v0.9.0 → 四镜像拉取（app 2.45G/ui 124M/docreader 5.98G/sandbox 728M）→ up -d 重建
- 结果：五容器 healthy；**迁移 118→134（16 步）dirty=false**；数据完好（1 KB/账号俱在）；磁盘 89%（15G 空闲，拉取耗 7G）；v0.8.3 四镜像保留作回滚（后续可释约 8.9G）
- **Docker 沙箱后端 v0.9.0 复验五项全绿**：TenantSandboxConfig image 已 PUT 更新 v0.9.0；deep 校验正确姿势 `{"config_id":...,"deep":true}`（**deep 是布尔，不是 mode 字段**）；真实建容器探针 41ms/出站 197ms（cn:baidu）
- **v0.9.0 API 行为变化三点实测入册**：①knowledge-chat 需先建会话（裸 session_id 报 1003 Session not found）；②/system/sandbox-check 走 RBAC g.Admin()（租户 Admin+），非授权 token 报"invalid or expired token"（文案误导，实为权限拒绝）；③登录响应 JWT 在顶层 `token` 字段（非 access_token）
- 测试账号 opencode-manual 已提 is_system_admin=true（DB 直改，R28 惯例；便于 v0.9.0 管理面探索；租户角色保持 owner——一度误降 admin 已复位）
- knowledge-chat 冒烟：298 SSE 事件/检索命中 1/references 事件带 knowledge_references/complete 带 final_content——**引用通道在 v0.9.0 照常工作**（SSE 契约战役 knowledge-chat 侧证据新增 v0.9.0 版本锚；agent-chat 侧未测）

## 2026-11-03 R38 — 第 22 轮扫描：v0.9.0 后 4 天 80 合并；真机会牌 #4962（沙箱 Registry Mirror）；5 dirty 待 rebase
- 大盘：10-30 14:00 以来 **80 件合并**（main 头 11-02 d9c1cf65f）；我方 7 PR 第 6 波零叫号（双端点零动静）；#3522/#3501 无变化；唯一未合关闭=#5026（yetuge 数据分析，个案）
- **真机会：#4962（沙箱镜像 Registry Mirror/非安全传输，Feature）**——10-31 开、2.5 天无配对零评论、作者 AndrewTsao 一次性报告者（无自续风险）；**代码实锚**：sandbox.go:53 `DefaultDockerImage="wechatopenai/weknora-sandbox:main"` + :63 `DefaultCubeTemplateImage="...:main-cube"` 硬编码 Docker Hub，内网/离线部署真痛点；撞车检查：近 80 合并无 registry/mirror 件（nullptr 沙箱线在做浏览器共享/rebind，正交）；**双重价值**：内网 registry 正是内部 fork DMZ 适配的同类需求；注意 docker 后端 image 本就 per-config 可改（我们 PUT 过），痛点主体在默认值+cube 模板路径+拉取传输层；动作待用户裁决：直接认领 issue 评论+PR 同日打包（快车道打法）或先设计评论探维护者入口
- 在途维护：5 PR（#4182/#4069/#3566/#3251/#3283）复查仍 dirty（累计 80 合并后更严重），rebase 待批；#3062 排队第 57 天
- 新池配对：14 新 issue 中 bug 型全配对（5019/5008/5027+5028/5052/5034/5024）；未配对=#4968（local_browser 兼容，lyingbug 自域）、#5003/#5001（linghengqian 自续型）
- 快车道持续验证：#4714 Runcrate 模型 provider、#4807 SearchApi 搜索 provider、#4936 DuckDuckGo 修复、Claude 5.5 OpenRouter 均 1-2 天合并——provider 小件 lane 仍活

## 2026-11-03 R39 — #4962 战役当日闭环：深度分析→实现→测试全绿→issue 评论+PR #5053 投递
- **深度分析（当前 main d9c1cf65f 重锚，断网前后各一次——旧分支分析全部作废重验）**：拉取全在下游（Docker Engine via docker.sock / Cube 集群 BuildTemplate / E2B FromImage），app 零拉取、零 go-containerregistry 依赖 → 修复本质=引用重写；四个默认镜像常量共享仓库路径 weknora-sandbox（:main/:main-cube/:main-desktop/:main-desktop-cube，桌面双变体为双模式重构新增）；normalizeImageRepository 本就剥任意 host 比较，镜像化引用天然过 standard 判定
- **实现（ff04109c2，feat/sandbox-image-registry-mirror 基 upstream/main）**：新 internal/sandbox/image_mirror.go——WEKNORA_IMAGE_REGISTRY_MIRROR 仅重写仍指向 DockerHub（隐式/显式 docker.io）的标准镜像引用，保 tag/digest、幂等、管理员自填私有 host 放行；Standard*Image() 四访问器替换 16 个调用点（cube 8/e2b 4/docker catalog 1/service merge 1/DefaultConfig 1）；文档=.env.example+04-configuration.md
- **诚实设计点**：INSECURE flag 不做（app 无拉取动作，no-op 会误导运维）——文档指路 daemon.json insecure-registries；issue 评论明示该取舍并留"后续 sandbox-check 探测镜像可达性"为讨论项
- **测试**：image_mirror_test.go 五函数（重写表 14 例/无 mirror 透传/mirror 归一化/访问器/catalog 护栏）；`go test ./internal/sandbox/ ./internal/application/service/` 全绿——唯一失败 TestSkillPythonVerifier 为宿主 Python 环境存量破损（纯净 main 复现同败+S-16 旧档，PR 正文已注明）；go build ./... + vet 过
- **投递**：issue #4962 认领评论（6584091679，中文线程）+ PR **#5053** 同日；铁律自查双零（zcode/generated with/🤖 各 0 匹配）；CI 启动 pending
- 流程注记：本轮一个险情——首次分析在旧分支 merge/upstream-20260904 上做完，切新分支后全部锚点重验才发现桌面双变体（旧分支只有 2 常量），"分支从 upstream/main 切+证据以当前 main 为准"纪律再立一功

## 2026-11-03 R40 — 用户质疑触发 #5053 测试补强：wire 载荷断言×5 + 真机 docker E2E + 修一个真缺口
- **用户两问（基点？充分？）触发复盘**：①基点实锚——upstream/main 仍=d9c1cf65f（fetch 复核），分支 merge-base 同值落后 0 提交，PR MERGEABLE；②充分性质疑命中真缺口——第一轮只测了重写函数，"设 mirror 后载荷真的上 wire"无人断言
- **补强五测（38c57c842）**：cube 标准构建/桌面构建/in-place rebuild 载荷断言 + e2b 标准/桌面 fromImage 断言（全部 t.Setenv mirror + httptest 桩捕获 wire 载荷）；顺带验证"hub 形态 imageInfo 在 mirror 激活时仍识别为 standard"
- **修一个真缺口**：dockerSettingsFromConfig 原样透传配置 image——配置里存 Docker Hub 形态（手填/引入 mirror 前保存）会绕过 docker 路径的 mirror；settings 投影层补 ApplyStandardImageMirror（外来 host 仍放行）
- **真机 E2E（env 门控 WEKNORA_DOCKER_MIRROR_E2E，CI 自动跳过）**：registry:2@127.0.0.1:5000 + 沙箱镜像推成镜像路径 + 删本地 tag 排除假阳性 → EnsureStandardTemplate → daemon 持有 127.0.0.1:5000/...:main（2.03s PASS）——应用发镜像引用+Engine 从本地 registry 解析拉取的完整闭环实锚
- 诚实边界（PR 评论已公开）：cube/e2b 断言打的是 httptest 桩非真集群——本进程能控的"上 wire 的引用"已全部钉死；真 Cube 集群验证恰是 WSL2 Cube 四件套到货后 sandbox-check deep 顺手可做之事
- 全量回归：sandbox 18s + service 90s 全绿（仍排除 S-16 存量）；PR 评论 6584846344 已发；现场已清（registry 容器+镜像 tag 均删）
- **追加（用户提议跨节点分工）**：真 Cube 验证委托 WSL2 节点——新增双重门控集成测试 `TestIntegrationCubeTemplateBuildCarriesMirror`（build tag `integration` + env `CUBE_MIRROR_E2E`，d895f097c 已推 PR 分支）：ReplaceStandardTemplate 发镜像引用 → 轮询 READY（envd 探针闸门=拉取成功的充分证据）；委托 prompt 存 `/home/ubuntu/WSL2-TASK-5053-cube-mirror-verify.md`（含 registry:2 灌镜像步骤、交叉取证=registry GET 日志、四件套顺手收集、回执格式）；回执到后 SG 侧定夺是否在 PR 追评论附真集群证据

## 2026-11-03 R41 — WSL2 回执：真 Cube 集群 PASS，#5053 验证故事闭环；反馈回灌；隧道断待重建
- **WSL2 真集群验证 PASS（10.04s）**：TestIntegrationCubeTemplateBuildCarriesMirror 在自托管 CubeSandbox v0.7.3（cube-api 4411c96b，镜像 main-cube@sha256:fb79ed7e…）上通过——模板就地重建、引用断言 mirror 形态、READY 达成；交叉证据=registry:2 日志 8 条 manifest/blob GET（拉取方 go-containerregistry/v0.21.6=Cube 集群构建器，测试前本地 tag 已删）；**PR 证据评论已发（6592534793）**——#5053 验证覆盖现全链：单测→wire 桩断言→docker 真机→真 Cube 集群
- **WSL2 两反馈回灌（a32934559 已推）**：①integrationConfig 增加 CUBE_ALLOW_PRIVATE=1 门控（loopback CubeAPI 被 SSRF 出站策略拦，默认行为不变）；②默认端口注释记"部署间有差异（3000/8480 已验证）"；委托文档 Go 版本笔误（写 ≥1.24，go.mod 实际 1.26）确认在案
- **四件套到手但隧道已断**：WSL2 回执称 SG 侧曾验 9300 通，本轮复锚=连接瞬拒/无监听（网络漂移，只能 WSL2 侧重建）；数据面 8480 从未建隧道（deep 校验需要）；四件套=api_url http://127.0.0.1:9300（SG 视角）/api_key 未展示（自托管默认形态待试 e2b_000000）/template_id tpl-a369c6316ac446d3ae5a0fef/sandbox_domain cube.app/数据面 8480
- **待用户动作**：让 WSL2 重建双隧道 `ssh -f -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 9300:127.0.0.1:3000 -R 9301:127.0.0.1:8480 ubuntu@<SG>`（9301 新增=数据面）→ SG 侧随即跑 cube sandbox-check（deep）→ 建 cube 配置 → 双后端对比测试
- WSL2 现场注记：mirror-registry-5053 容器须保留（标准模板现指向本地 mirror，删容器则未来模板重建拉镜像失败）；~/WeKnora-5053 clone 保留待复验（一条命令可复跑）
- PR 状态：4 commits、MERGEABLE、CI 对新提交排队中；v0.9.0 rebase 提醒已澄清（基点 d9c1cf65f 晚于 v0.9.0 发布，无需因它 rebase）

## 2026-11-03 R42 — Cube 后端接入：双隧道+容器网络打通，deep 四绿一红（egress），cube 配置已建
- **隧道新形态（WSL2 侧升级）**：systemd user 服务 `cube-tunnel.service`（Restart=always+linger，断线 10s 自愈，替代裸 ssh -f；旧重建命令作废）；SG 侧复锚 9300 `{"status":"ok","sandboxes":0}`、9301 HTTP 400（proxy 对裸根路径正常拒）✓；WSL2 记了 pkill -f 自匹配坑（[s] 方括号正解）
- **容器网络坑（SG 侧现场排掉）**：app 在容器内，隧道绑宿主 loopback → 首次 deep 校验"端点拒绝连接"（8ms 瞬拒=容器自身 loopback）；解法=宿主 socat 网桥转发：`172.18.0.1:19300→127.0.0.1:9300`、`19301→9301`（apt 装 socat，nohup 起，**重启会丢——待固化**；备选=WSL2 隧道直接绑网桥 IP，需 SG sshd GatewayPorts）
- **deep 校验结果（两跑一致）**：api_url_reachable✓495ms／credential_valid✓（**默认占位 e2b_000000 直接通过**）／template_exists✓（tpl-a369c…被认）／**sandbox_exec✓592ms（真实建沙箱执行探针，走容器→socat→隧道→WSL2 集群全链）**／egress_available✗（沙箱内 DNS 解析超时 curl:28，两跑同错=稳定环境问题，非策略跳过；WSL2 回执曾提其 cube 有独立 egress 组件且本机 docker daemon 有死代理——出网问题归属 WSL2 侧诊断）
- **cube 配置已建**：id `ccb503c1-aa74-4411-8c23-8d5265f84b14`，name wsl2-cube-tunnel，type cube，allow_private_endpoints=true（loopback/网桥 IP 必需），端点 172.18.0.1:19300/19301，template tpl-a369c6316ac446d3ae5a0fef，api_key 默认占位有效；http 明文经隧道无 mkcert/TLS 问题（登记册预判的 rootCA 坑未触发）
- **双后端格局成**：docker-local（id 2f009e19）+ wsl2-cube-tunnel（id ccb503c1）并存于 v0.9.0 栈；待办=①把 egress 问题带话 WSL2（沙箱内 DNS/出网诊断，影响技能安装类对比）②socat 转发固化（systemd unit 或 GatewayPorts 方案）③双后端对比测试（执行/生命周期可先行，技能安装等 egress 修复）

## 2026-11-03 R43 — WSL2 意见评估 + egress 修复复锚：Cube deep 五项全绿，双后端对比解锁
- **WSL2 egress 三层根因修复（NAT 直通+systemd 固化）经 SG 复锚确认**：deep 校验五项全绿（egress "reachable via cn:baidu"，与 docker 后端同探针目标）——**Cube 后端在 v0.9.0 栈完整验证，双后端对比测试（含技能安装类）全部解锁**
- **WSL2 意见评估结论**：11 项清单质量高、定性基本准确；两个"真 bug"判定——①SSRF 集成测试缺陷=准确但**已修**（a32934559 已推+PR 评论 6592534793 已发，其起草的 PR 评论因此过时，**不照贴**：会重复发布已有证据+提出已落地的 diff，观感"作者不看自己分支"）；②CubeSandbox 重启非幂等（eBPF tc attach+NAT MASQUERADE 重启丢失、服务不恢复、egress 容器照常 running 静默失败）=**成立**，支持反馈 CubeSandbox 上游，报告内容需 WSL2 台账三层根因，是否发+用何账号待用户拍板
- 微勘误：WSL2 清单第 1 项"文档假设错误"——33000/80 出自仓库集成测试原作者环境注释（非 SG 凭空假设），该注释已在 a32934559 记录部署差异；其余定性（含它自认的 3 项自身失误）均认可
- WSL2 过程注记值得记档：pkill -f 自匹配坑二踩（[s] 方括号正解）、ssh ExitOnForwardFailure 静默绑定失败、代拉管道流污染净化法

## 2026-11-03 R44 — 并行两线：双后端对比首批数据（timing+技能安装）+ CubeSandbox issue 草稿
- **对比①执行/出网时延（3×deep 取样）**：docker exec 31-71ms/egress 174-352ms vs cube（经隧道跨节点）exec 290-329ms/egress 419-459ms——约 10 倍差主要由隧道 RTT+跨节点链路贡献，两端波动均小；本地同机房部署 cube 时差距应显著收窄（本组数据代表的是"跨节点自托管"形态）
- **对比②技能安装（同包双端）**：自制 net-probe 技能（SKILL.md+requirements.txt 装 six==1.17.0+验证脚本）zip 上传两端 sandbox-configs——**docker ~20s ready、cube ~30s ready，双成功**；cube 全程走通隧道往返+WSL2 建沙箱+出网 pip 安装+验证+快照——**WSL2 的 egress 修复在真实产品流中验证**（技能 id：docker 37d960a9 / cube c0c3f15d）
- 方法论入档：技能包格式=zip{SKILL.md(frontmatter name+description)+scripts/+requirements.txt}；安装异步（202+skillID），轮询 GET /sandbox-configs/:id/skills/:skillId 到终态；zip 命令节点没有，用 python zipfile
- **CubeSandbox issue 草稿**（/home/ubuntu/DRAFT-issue-cubesandbox-egress.md）：重启非幂等三层根因+复现+期望+临时规避框架已成，三处 [待补] 需 WSL2 台账（内核版本/tc 与 iptables 前后对比输出/规避命令）——待用户审批后投递，勿直接发
- 对比剩余维度：空闲清扫（需短 TTL 配置观察回收）、session vs user 分配模式（需 WEKNORA_SANDBOX_USER_ALLOCATION=enabled+Redis 已配）——择期执行

## 2026-11-03 R45 — #5053 CI 修复+rebase（lll×7 重构；main+4 rebase 唯一冲突 writableLayerSize 1G→64G）；WSL2 认领错位+issue 素材待传
- **CI 双问题当场修**：①golangci-lint 挂=lll 行宽 7 处（测试表最长 162>120）——变量化重构（mirroredRepo/adminRef），本地 awk 扫描全文件≤120 复验；②mergeable 转 CONFLICTING（main 前进 4 提交）——rebase 唯一冲突在 cubeStandardTemplateSpec：上游把 writableLayerSize 1G→**64G**（注释：全部会话工作区与依赖活在这层），解法=上游 64G+注释 ∪ 我方 StandardCubeTemplateImage()；上游已同步改测试断言（cube_remote_client_test.go:719 / cube_template_catalog_test.go:425 均 64G），自洽
- 结果：5/5 rebase 完成（头 4a23f5109），sandbox 全量 16.9s 绿，force-with-lease 推送，CI 重启 pending，**MERGEABLE 恢复**；教训：本机装 golangci-lint 预检可省一轮 CI——下次提交前跑 `golangci-lint run internal/sandbox/`（若可装）
- **WSL2 回执认领两错位**（PR 评论草稿作废正确+33000 出处勘误），台账 c0d5dee；其 CubeSandbox issue 英文全文已成于 WSL2 侧 `~/sr-exp/cubesandbox-egress-issue.md`——**文件在 WSL2 文件系统，SG 取不到，需其 scp 过来**（转发命令已给用户：scp 至 ubuntu@43.134.172.70:/home/ubuntu/）；到手后 SG 侧流程=审读+与我中文草稿互校+铁律自查→用户批准→vicfei 账号投递→登记跟踪
- 上游 4 提交里含 #5031 BrowserSkill v0.4.1（对应新 issue #4968 的修复，lyingbug 自域快速闭环又一例）

## 2026-11-03 R46 — 公司生产反馈核实（两条均实锤）+ #2984 战役开工：web 排序权重可配置化已实现
- **生产反馈核实（代码级实锚，fork v3.1 同款验证）**：①问答混入弱相关图片——图片 OCR/caption 分块与文本同池召回（门槛低），fork v3.1 无 rerank 时零语义把关（新版 main 的 pictorial 保留设计 fork 没有），主因=无 rerank+caption 质量差；②本地库与 web 结果混排且本地靠后——三环机制：chat_pipeline/search.go 两 goroutine 同列表混排 + **web 结果硬编码 Score=0.6（conversion.go:73，fork 同款）** + merge 按分排序后 filter_top_k 截断挤掉本地；rerank 开启时 CompositeScore 来源权重 0.95 仅象征性惩罚
- **#2984 战役（用户指令：bocha E2E+同日打包）**：查重命中 **#2984（09-02，open，零配对）**——与反馈镜像同题（IM+KB+web 混排、SEO 压内部文档）；bigdu332 09-27 申请方案 1（级联）零回复五周无 PR；我方走**方案 2 最小非破坏形态**：不新开 issue（会撞车），PR 将 close #2984+评论向两位先行者致意
- **实现完成（0fc5f9c83，feat/web-search-blend-weights 基 upstream/main e3fb2335b）**：types.RetrievalConfig +web_search_base_score/web_search_source_weight（omitempty+GetEffective* 双方法+双默认常量 0.6/0.95，RRF 字段同款模式）；消费点在管线阶段内部解析 tenant.RetrievalConfig（Search 阶段 WithBaseScore、Rerank 阶段 opts.SourceWeight）——覆盖 QA/quick answer/IM/embed 全入口且不动 ChatManage/DI；handler 双 0-1 校验；searchutil.WithBaseScore 选项（0 回落默认）；CompositeScore/scoredCopy 加权重参数；文档=11-web-search.md 新节（含 #2984 引用）
- 测试：types/searchutil/reranking 新单测三文件 + 全量绿（service 89s 含 chat_pipeline/handler）+ go vet 过；#5053 CI 四项全过（lll 修复生效，golangci-lint 8m13s pass）
- **E2E 阻塞点：bocha 密钥本节点未找到**（providers 空/dev.env/交接档均无）——已实现部分就绪，等密钥或用户在栈 UI 配好 bocha 即跑基线（stock v0.9.0 复现）→分支镜像（修复验证）→评论+PR

## 2026-11-03 R47 — #2984 战役当日闭环：bocha E2E 三段验证 + PR #5070 投递；执行区磁盘第三次事件
- **bocha E2E 三段全过**（stock v0.9.0 + bocha 真搜索 + 分支 bookworm 二进制换装法）：
  ①基线复现：同题（KB 文档可答+联网开）→ 11 引用=1 本地 0.747 + **10 web 全钉 0.600**（SEO 噪音页），引用列表 10:1 web 主导——生产反馈机制实锤；
  ②修复验证：PUT web_search_base_score=0.3 → web 全降 0.3、本地居首（任何 >0.3 本地命中压过全部网页）；
  ③默认回归：旋钮清零 → web 回 0.600——**不设置=行为零变化**
- 前置排障三件记档：会话默认绑助手走 agent 流（需 agent_enabled:false+管线确认）、web 检索需 provider 设 is_default（否则 web_config_missing 静默跳过）、paradedb 查询扩展报 3678（side-find 另记）
- **投递**：#2984 认领评论（6597932726，向 YG52052051/bigdu332 致意+方案 2 定位）+ **PR #5070**（Closes #2984）；铁律自查双零
- **执行区磁盘第三次事件**：后台 docker build 的日志灌满会话 exec 小文件系统→输出全断；处置=TaskStop+盲清会话日志+docker builder prune；镜像构建改道=**golang:1.26-bookworm 容器构建二进制+docker cp 换装**（-buildvcs=false 治 git 属主、CGO 必需 sqlite-vec、宿主 glibc 过新不可直编）——此法 10 分钟替代整镜像构建，磁盘友好，已验证可复用；清自家旧测试镜像 ~6G；栈已恢复 stock（healthy）
- bocha provider 留存栈上（is_default，密钥不落登记册）；#5070 待 CI

## 2026-11-03 R48 — CubeSandbox 线事后复查（状态错位第二起）：issue #2141 与 PR #2142 复查通过，一项架构疑问待 WSL2 答辩
- **状态错位第二起（我方滞后）**：CubeSandbox issue **#2141**（06:07）与 PR **#2142**（06:12，fix/egress-net-deferred-install）昨夜已由用户拍板投递，我方"互校→自查→批准"四步被实际进度越过，审读转事后复查；WSL2 提出并落地新纪律=里程碑事件（issue/PR/部署）入 worklog，各节点拉取可见——我方镜像遵守：登记册本就承担此职，跨节点动作前先拉对方 worklog
- **issue #2141 复查：通过**。与 scp 文件逐字一致（仅首行标题行由 GitHub title 承载）；泄密检查干净（环境泛化：Ubuntu/WSL2/内核号/默认子网，无用户名/内部主机名/公司信息）；技术表述稳妥——"钩子不存在"有全仓 grep 背书、eBPF 项诚实降级为"观察项"、workaround 如实注明绕过 TPROXY；无 AI 署名问题
- **PR #2142 复查：实现紧凑通过，一项架构疑问**。5 文件 +29/-6：path unit 盯 /sys/class/net/cube-dev 出现触发 egress 安装、ConditionPathExists 限定 one-click 环境、PartOf 随栈停、注释同步去"虚构钩子"化、common.sh 收录 *.path 安装——各点到位。**疑问（已转 WSL2 答辩）**：oneshot+RemainAfterExit=yes 的服务在"延迟成功退出"后处于 active(exited)，systemd path unit 的 Unit= 触发是 start 语义——对 active oneshot 是 no-op；若 cube-dev 在 30s 等待窗之后才出现（首次建沙箱恰是懒创建场景），规则是否真的会重装？若 WSL2 三段验证未覆盖"冷启动+>30s 后建首个沙箱"时序，建议补测或改用去 RemainAfterExit/模板化 restart 触发
- 跨节点协作记档：scp 判断验证正确（出站 SSH 直达）；WSL2 另有 MinerU/harbor 线与 WeKnora 4.1.3 适配在跑（用户直管，不属 SG 战线）

## 2026-11-03 R49 — #2142 二版复查通过：trampoline 修复各点到位，跨节点复查链路首次全闭环
- **疑问实锤与修复**：SG 提出的 path-unit start 语义对 RemainAfterExit oneshot no-op 问题被 WSL2 实锤双证（ExecMainStartTimestamp 不动+down 后 start 链不回）；其验证 B 原用 restart 触发=验证设计与语义不匹配（其自认）；修复=SG 方案 b 变体：trampoline 单元（Type=oneshot 无 RemainAfterExit，ExecStart=systemctl --no-block try-restart 安装单元）
- **二版复查五点全过**：①try-restart 语义正确（active(exited)→stop+start 重跑 ExecStart；inactive 时 no-op 硬化）②--no-block 有实测教训背书（嵌套 job 同步等待可观察假失败）且落注释 ③path 单元 Unit= 改指 trampoline，注释含实锤证据 ④trampoline 免 target 接线（path 触发+PartOf 停栈传播成对）⑤透明评论 6599779515 在位（缺陷过程+证据+设计理由，给维护者完整记录）；单 commit f72fa3c7 用户重签 DCO
- 遗留（诚实）：冷启动全时序终验（冷启→30s+→建沙箱→curl）留合并前有条件环境补——机制链已等价覆盖，SG 认可此安排
- **跨节点复查链路首次全闭环**：提交→对侧复查→抓出真缺陷→实锤→修复→透明记录，worklog 双向纪律首日兑现；两枚新坑入册（oneshot+path start 语义陷阱、ExecStart 嵌套 systemctl 必须 --no-block）——均为 SG 登记册可复用教训
- **#5070 CI 首轮 lint 修复**：errcheck×2（新校验块 c.Error 补 `_ =` 前缀，agent_grant.go 同款惯例；存量同型行不标记=linter 只查新行）+ lll×1（scoredCopy 四参行折行）；已推（style commit），CI 重跑验证中——**流程教训升级：提交前本地预检 gawk>120 + errcheck 惯例，两条 PR 各交了一次 lint 学费**

## 2026-11-03 R50 — 第 23 轮扫描：真机会牌 #5069（跨空间共享 KB 图片 403，我方 #3069 同族专域）；#5053/#5070 双 clean 排队
- 大盘：今日仅 4 件合并（平静日），main 头 e3fb2335b 未动（我两张新牌的基点）；#2984 我方评论后暂无维护者回应
- 我方：#5070/#5053 双 clean 零评审排队（5053 两评论皆我方）；旧 7 牌零动静，5 dirty rebase 与 #3062 ping 仍待用户
- 新池 12 件：#5056 已配对（5057）；无配对者=**#5069（v0.8.3 跨空间共享 KB 快速问答图片 403，请求路径正是我方 #3069 建的消息级文件代理端点）**——org-share 方向我们修过，跨空间 share 方向疑似残留缺口，S-22/S-24/S-15 档案直接可用；作者 guohonglin 全库仅此一 issue（一次性报告者，无自续风险）；待办：①当前 main 复现（报告者 v0.8.3）②查 share 方向的 KBAccessRead 判定路径③动作需用户拍板
- 其他观察：#5073（v0.9.0 生成中切会话回来自流空白，产品流回归）、#5078（自托管 Langfuse 无 token 量）、#5058/#5072/#5068（大件 feature 不属快车道）——仅记录

## 2026-11-03 R51 — #5069 深探完成：当前 main 实测不可复现（B 取图 200）；根因收敛至 v0.8.3 特有 share 形态；v0.8.3 副栈重放待用户
- **复现场景全搭建成功**（真栈编排 8 步）：CreateSystemUser 造 b-user（个人空间 10022，密码 Btest#2026，DB 复制 A 的对话模型行 m-b-chat-0001 过"无模型"坎）→ 建组织 xspace-repro-org（invite ce50d5…，A 为 owner）→ B join → KB 共享 org（share 08521fb7，viewer）→ KB 开 VLM（qwen3.8-max 视觉行 ed4bb23f；**VLM 是 KB 级配置**，PUT 需带 name 必填）→ PIL 生成文字图 probe-image.png 入库（cdea58b0，parse completed）→ B 快速问答命中 image_caption/image_ocr/text 三引用（handle resource://NFDcJhdy… 同现 content+image_info）
- **实测判定：v0.9.0（e3fb2335b）org-share 形态下 B 经消息文件代理取图 = 200**——resourceAccessibleViaSharedKB 四道门（证据收集/KB 租户匹配/CheckTenantKBPermission viewer/Bindings）全过；与报告者"v0.9.0 未复现"一致
- **根因收敛**：报错文件（message_files.go/files.go）v0.8.3=v0.9.0 逐字相同（报告者已 diff）→ 行为差异必在 share 行形态或证据数据：CheckTenantKBPermission 要求 share.Organization 非空且源/B 双方均为组织成员——**怀疑报告者的 share 行无组织（旧版分享形态/直连共享）**，检索侧经上下文授权放行而代理侧无此路径
- **待用户拍板**：v0.8.3 副栈重放（本节点存有 v0.8.3 四镜像；需第二 compose 项目+独立卷+改端口，RAM/磁盘代价约 1G）→ 复现后定夺"v0.9.0 已顺手修复（回评论建议升级，无 PR）"或"现行版仍有缺口（出 PR）"；备选=issue 评论问报告者 share 形态
- 战场清理待办：xspace 测试件留存（org/share/租户 10021 空壳/10022+模型行/KB 图片文档/VLM 配置）——若决定出 PR 需留作复验，否则可清

## 2026-11-04 R52 — 第 24 轮扫描：安静夜零合并；#5070 CI 四绿；无新可打牌（唯一无主 #5116 属自续型作者）
- #5070 lint 修复后 CI 四项全过，与 #5053 双 clean 排队零评审；上游 13:00 后零合并，main 头未动（e3fb2335b）
- 新池 7 件：#5111 MinerU 4.1 断裂**已双 PR 配对**（5113/5121——恰是用户内部 MinerU 适配线同域，情报已转告）；#5110/#5102/#5108 全部即时配对；**唯一无主 #5116**（SYSTEM_AES_KEY 尺寸错误静默禁用静态加密，v0.8.3+main 双验证，crypto.go:19）——但作者 liouxb 为活跃自续型（#5108 当日自配 PR #5119），按 R31 #4313 先例不抢跑，观察
- 悬而未决三件不变：5 dirty rebase、#3062 ping、#5069 方向（v0.8.3 重放 or 问报告者）

## 2026-11-04 R53/54 — 补记 LeRobot 线（用户并行战线首入册）+ 第 25 轮扫描：上游冻结持续零合并；#5116 如预期自配（5146）
- **LeRobot 三牌入册**（用户 10-11/12 并行开，huggingface/lerobot，SG 此前无档）：#4924（ACT state-only，Blocking 已答 12 天无复审——ping 点位）、#4925（video backend fail-fast，10-26 后静默 8 天）、#4929（shape 归一化，jinchuntan"测试未钉住修复"质疑挂起）；三张 CI 绿，球均在对方半场
- **第 25 轮扫描**：上游自 11-03 03:33（e3fb2335b）后**持续零合并超一天**（前周 80+/日的反差，维护者离场迹象）；我方 9 PR 状态不变（2 clean 新+5 dirty+2 clean 旧）；新池仅 2 件且即时配对（5148→5149、5138→5142）；**#5116 如 R52 预判被 liouxb 自配（PR #5146）**——不抢跑决策再次验证
- 结论：无新可打牌；上游冻结期=维护窗口（rebase 五连仍待批）；三仓在途全景=WeKnora 9 + CubeSandbox 1（CI 绿）+ LeRobot 3（等复审）

## 2026-11-06 R55 — 跨节点受托验证收官：WeKnora v0.9.0 七项缺陷独立验证（B1-B6 REPRODUCED / B7 NOT-REPRODUCED），RESULT.md 已推回 worklog 仓
- **任务链**：wsl2 经 worklog 仓（vicfei/worklog，SG 首次接入该通道，clone 于 ~/worklog-xnode）委托七项内网发现缺陷的官方源独立验证；SG 用官方 v0.9.0 镜像栈+mineru[api]==2.2.2+自备落盘 mock 完成，RESULT.md+log 条目已推（rebase 一次后 f82cc21）
- **判定**：B1 live 双向（留空→max_tokens=24576[tools=13 主轮]/设8192→8192）；B2 三重（运行态 FileTypes 含 bmp/tiff 超任务书+端到端 400+直传对照）；B3 终态 failed 无降级（对照内置 19.6ms 成功）；B4 docreader 容器零请求+文案反向指路（加重）；B5 代码级（Input-field.vue:975 固定键+注释错述 localStorage 语义）；B6 200+warn（session_qa_helpers.go:183 实锚）；**B7 NOT-REPRODUCED**（官方默认 ppt/pptx→markitdown/anydoc，fresh 租户空规则+实测走内置）——fork 生产现象为部署侧配置非上游默认
- **环境实战坑四条**（入 RESULT 复现者笔记）：SSRF_WHITELIST 网段放行（模型调用层也校验）、agent mode 枚举连字符 smart-reasoning（下划线静默降级 2048 预算——差点误判 B1）、smart-reasoning 强制 rerank_model_id、mock 必须回 SSE 流
- 流程注记：B1 曾因 mode 枚举笔误近误判（2048），三因素排查（tools=0→mode→rerank）后才见 24576——验证环境本身的技术坑会伪装成 NOT-REPRODUCED，"复现者笔记"一节即为此立；issue/PR 组稿权按纪律留 wsl2，RESULT 附英文草稿供其定稿

## 2026-11-06 R56 — 四连发战役当日闭环：B5/B6/B1/B4 各 issue+PR 同日投递（#5208-#5215）
- **B5（前端 localStorage 用户隔离）**：issue #5208 + PR #5209——复用 preferenceStorage 既有 per-user 命名空间（WeKnora_${userId}_${suffix}，theme/font 同款先例）；双消费者（Input-field + useSkillInstallerModel）接入+legacy 键清理+auth.ts 租户切换同步改；VM fixture 编译真实 preferenceStorage 进测试，11/11 绿+vue-tsc 净
- **B6（快速问答 complete 补 model_id）**：issue #5210 + PR #5211——管线在 FinalAnswer Done marker 盖 chatManage.ChatModelID 章→handler 捕获→AgentCompleteData.ModelID；两测绿（Done marker 携带+complete 事件透传），全 session handler 套件通过
- **B1（未知上限 omit wire cap）**：issue #5212 + PR #5213——**素 #2867 设计论证**：内部 24576 预算保留（#2867 防截断动机成立），wire 层新 wireCompletionBudget()：ModelMaxOutputTokens==0→不发字段；**实弹 A/B 表**：未设→ABSENT（原为 24576），8192→8192（原样）——用 golang 容器构建分支二进制+mock 换装法验证；agent 套件全绿（含两个旧测试按新契约重写）
- **B4（引擎名+上游错透传）**：issue #5214 + PR #5215——docreaderContainerEngines 集合（""/builtin/markitdown 保留原文案）+ parseFailureMessageForEngine（其余引擎点名+上游错）；服务套件全绿
- 纪律执行：四项各 issue→PR 同日；每项铁律自查零匹配；lint 教训应用（awk>120 行宽预检+_ = c.Error 惯例）；B1/B4 均带 live repro 证据表/日志锚
- 当前在途牌局：WeKnora 13 PR（旧 9 + 新 4），CubeSandbox #2142（等 v4 决策），LeRobot 3（用户自管）

## 2026-11-09 R57 — 第 26 轮扫描：上游解冻后 21 合并/3 天；我方 13 PR 穿越仍零叫号；新池即时配对持续
- 大盘：main 头 77ac9d7b5（11-09 05:18），11-06 以来 21 件合并——上游从 11-03 冻结恢复；我方 13 PR 全部 open 零评审零评论（含 11-06 四连发 #5209-#5215 全 CI 绿），穿越解冻后波次仍零叫号
- 新池 14 件（11-06→11-09）：**配对率 6/8 检查过**（#5296→5301、#5277→5280、#5275→5276、#5294→5299、#5279→5283、#5278→5282）；无主 2 件：**#5297**（CLI model create/update --default 静默 no-op，作者 Bluuok=coco413 同域活跃自续型高概率）+ **#5300**（深色模式 TXT 代码块不可见，纯前端 CSS）
- 值记：#5277 JSJ189"温 D 漏掉 deleting 态"（幽灵文档族第四件，我方 #3339/#3367/#3493 同族但此为 sweep 维度）已配对；#5294 Neo4j 死锁已配对
- 结论：无新可打牌（#5297 高概率自续、#5300 前端暗色 CSS 价值低）；13 PR 积压是当前主线——建议将五张 dirty PR 的 rebase 提上日程（main 3 天走 21 件，冲突面持续扩大）

## 2026-11-09 R58 — 上海委托 PR #5335 独立验证完成：双相对照 PASS（Phase A 0 locator / Phase B 全部有 locator）
- **上海 8899 不可达**（SG 侧连接超时）；自制五件等效 HTML 夹具（headings/table/nested/chrome/long）替代
- **Phase A（main @26723dca3）**：五件 HTML 文档入库 completed，全部 chunks **source_locators = NULL**——HTML 是唯一无 parse-time 结构块的主流文本格式，引用定位的结构性缺失实锤
- **Phase B（pr-5335 @7d59a59e9）**：同五件入库 completed，全部 chunks **source_locators 非空**：
  - headings: section 锚点带 title="Cloud Architecture Guide"/"Compute Layer"（1-based ordinal）
  - table: 表格行合并为单元、GFM 管道分隔符已归一
  - nested: 嵌套列表结构保持
  - chrome: nav/footer 重复 chrome 也产生了 locator（section锚点仍指向正文标题），但 body 段落有独立精确锚点
  - long: 八段长文每个 h2 章节有独立 section 锚点+title+quote（中文完整保留）
- 所有 locator 均为 type=section、mapping=exact、带 quote（原文引用）、section ordinal（1-based）、source_hash
- **双相矩阵：0/5 → 5/5**——后端结构块功能验证 PASS；前端渲染预览+定位 UI 需 UI 镜像重建验证（不在本轮范围）
- 方法：main/pr-5335 双分支各构建 bookworm 二进制→换装→独立 KB→同五件→DB 层直接检查 chunks.source_locators

## 2026-11-09 R59 — PR #5335 上海原版夹具正式验证：双相 0/9→9/9 PASS（R58 初轮升级为正式）
- 上海原版五件（sha256 核符 55e500d8…）经 gwpull SSH 通道 scp 直达；上一轮 R58 自制件降级为"初步验证"（方法论教训：有 SSH 通路时应取原版而非自封等效）
- **Phase A（main @26723dca3）**：五件 9 chunks **全部 source_locators=NULL**——与 R58 初轮结论一致
- **Phase B（pr-5335 @7d59a59e9）**：五件 9 chunks **全部有 locator**——双相 0/9→9/9
- **上海点名的三个边界构造全部验证 PASS**：
  ①噪音页面（nav×2+sidebar×2+footer×2 逐字重复+script/style）：正文段落均有独立 section 锚点（title="关于华信科技"/"发展历程"/"核心能力"），chrome 也产生 locator 但不阻塞正文锚——mapping=exact + title 明确区分
  ②财务表格（千分位 15,500/12,840 + 全角括号 EPS（元））：quote 中千分位逗号完整保留（`| EPS（元） | 1.82 | 2.42 | 3.07 | 3.79 |`），归一化不破坏数字精度
  ③长文多节（八章全中文混排）：section ordinal 2-9 完整覆盖八章，中文标题完整（第一章 行业背景与挑战 → 第八章 客户价值总结），第四章出现两次（不同 chunk 含同章不同段落——正确行为）
- 方法：串行构建双分支二进制（教训修正：R58 并行构建曾因共享挂载卷导致代码混编），独立 KB 各自入库，DB 层直查 chunks.source_locators

## 2026-11-09 R60 — #4069 死因诊断与裁决：lll 一行 167 字符 + dirty 冲突 + 核心问题已被上游 DeepSeek PR #4792 架构覆盖 → 建议关闭
- **CI 失败原因**：golangci-lint lll 规则——doTestSearch 函数签名改双返回值后那行 **167 字符**（上限 120），只有这一条 lint error，一行折行即可修——与 #5070/#5211 的 lll 同款（第三次犯）
- **dirty 原因**：该文件在 10-08 之后被 3 个上游 PR 改动（#4792 DeepSeek/#4427/#4304），diff 49+/39-——签名变更（doTestSearch 双返回值）与上游改动碰撞产生 1 处冲突
- **核心问题是否已被解决**：**部分被 #4792 架构覆盖**——canned query 仍是 "test"（main:446），但 #4792 重构了 provider 注册体系；连通性测试的行为路径已有变化，但中文系供应商用 "test" 返回空的问题**依然存在**
- **裁决建议**：**关闭 #4069**，以当前 main 为基线重做——变更很小（改一个常量+返回值），但要在 #4792 后的新架构上重写；issue #4068 仍有效（问题未修），可配新 PR

## 2026-11-10 R61 — #4069 放弃裁决 + 会话交接
- **#4069/#4068 放弃**：博查公开 API 实测搜 "test" 返回 1000 万匹配（test succeeded, results=1），核心前提在当前时点不成立——canned query 改中文的价值仅在豆包/百度单独验证后才有；放弃重做，issue 挂起不关
- **上下文将满，交接新加坡节点 ZCode 会话**：交接 prompt 存 /home/ubuntu/HANDOFF-sg-session-20261110.md

## 2026-11-10 R62 — 会话续接 + 第 27 轮扫描：**首次双合并里程碑**（#5209/#5215 由 lyingbug 合入 main）；wsl2 经 SG 通道自提 #5337-#5339 补记
- **双合并**：#5209（localStorage 用户隔离）+ #5215（解析失败引擎名+上游错透传）于 11-09 15:18 UTC 由 lyingbug 合入（同波次 15 件批量合并，main 头现为 cbdcebabf）——13+ PR 零叫号期后首次破冰，四连发 B 系列两员先上岸；vicfei 名下 upstream 合并数 0→2
- **wsl2 补记**：worklog 拉取发现 wsl2 于 11-09 经 SSH(SG)→SG worktree→push vicfei fork→开 issue/PR **全程无 SG 会话介入**完成 MinerU V1 4.1.3 适配三件套：issue #5337 + PR #5338(B 纯4.1.3)/#5339(A fallback)，CI 5/5 绿 MERGEABLE 等评审——登记册此前无录系正常（非本会话动作）；牌局修正=vicfei open PR 现 14 张（12 活跃 + #4069 已裁决弃 + #5335 沪牌）
- **剩余 PR 动静**：双端点全查零外部新动静（所有 reviews/comments 均我方旧记录）；mergeable 快照：#5338/#5339/#5335/#5213/#5211/#5070 CLEAN，#4069 CONFLICTING（弃），#4182/#3566/#3251/#3283/#3457/#3062/#5053 UNKNOWN（GitHub 批量合并后重算中，需下轮复查）
- **#5053 坏评论事故确认**：PR 上两条我方评论（11-02/11-03）正文仅 "@/tmp/draft-pr-comment-5053*.md" 路径无内容——草稿原件本地完好（1786B/1732B：wire 断言补强+真 Cube 集群 PASS 证据），修复=编辑补正文，**对外动作待用户批**
- **新池 4 件**（≥11-09）：#5329（markdown 相对链接入库归一/映射，SAXEM1997，承接 #5189，**无配对真候选**，与 #5335 引用定位同域）；#5333/#5331（OUAO-FRANK 自引用疑自配）/#5314（lizijing98 自引用疑自配）
- 结论：双合并验证"四连发直球小修复+全套证据"路线有效；主线仍是 12 活跃牌等评审；待用户决策件不变（5 dirty rebase 更紧迫：#5209/#5215 合并后冲突面又变）

## 2026-11-12 R63 — PR 机会全池探测（280+ open，分页全扫+短名单逐件配对核实）：真无配对收敛至 2.5 张；MinerU 竞争警报
- **方法**：open issue 全池分页拉全（278+，API 混排 PR 需过滤+分页——首查 27 件的假象教训）→ 域契合短名单 40 件逐件查 timeline PR cross-ref → 疑点读正文+评论
- **池子动力学定案**：报告者自配对窗口 ~24-48h（OUAO-FRANK 8 件全自带 PR；LuckVd/SAXEM/wzxsdf/lnuxe/yetuge/fxia0018/RyoKusnadi/jianyx1 群狼）；R57 判断修正：#5297（判自续）被 yetuge #5326 拿、#5300（判低价值）被 1zrj #5310 拿、#5069（R50 真机会牌）被 PoisonGodv #5396 拿——小型直球已无捡漏空间，剩余机会=验证重活/硬骨头/feature 大件
- **真无配对（代码可修）**：①**#5305**（batch reparse 沿用上传时 process_overrides 快照→KB 级启图谱对存量文档无效；ningL32 生产实测 26/26 completed 图谱 0 入队三重验证+PoisonGodv 静态核对；覆盖链已在本地 origin/main 逐行锚定 knowledge_process_config.go:82-84；我栈可验证无需 neo4j——asynq 队列键+日志两路即可）②**#4725**（引用流解码器剥字面 <ref> 文本；errpunk 代码级分析+回归清单；Frank-zhu2000 认领后退赛警示"边缘案例层出不穷需更大重构"；弃置 16 天零竞争；我方 mock 可三分钟复现）③#5436（企微长连接收尾帧静默失败，#3239 盲区；今晨新件报告质量高但完整复现需真实企微环境，我方只能 fake WS 单元级验证——弱 0.5 张）
- **MinerU 竞争警报**：#5111（lynnqiang 11-04，早我方 #5337 五天）已有两个 open PR——#5121（PoisonGodv 代码修复）+#5113（jianyx1 docs）；wsl2 当时"无人先修确认"只查了 main 合并态、漏查在途竞争 PR——我方 #5338/#5339 现处三 PR 同题竞争+双 issue 重复格局；处置（交叉引用/差异化/撤案）组稿权在 wsl2，待用户
- 无配对 feature 大件（备查）：#5309 分析中断、#5161 wiki 运维接口、#5157 MCP 会话白名单

## 2026-11-12 R64 — MinerU 四方案硬对比裁决（#5121 vs 我方A/B vs #5113）：#5121 设计与实现双优；我方 A/B 存在文档证实的取消路由缺陷
- **方法**：四 PR diff 全读 + MinerU 官方 tasks.md（mineru-4.1.0-released 分支）核对协议事实
- **官方契约关键点**：取消=POST /v1/tasks/{tid}/cancel（文档明言"no public DELETE"）；manifest 可选 sha256sum 启用校验+上传缓存预检；上传=PUT 回执 upload.url+headers（仅 waiting-file 态）；产物=files[].result_url（本地即 /v1/files/...，SaaS 为签名外链，key 只附同源）
- **裁决**：#5121（PoisonGodv，+734/-19）全契约吻合（sha256/cache-hit/upload-action 语义/result_url 凭据隔离/文档锚定的取消路由）+健康探测选路（capability→版本→保守 Jobs）+ping 用鉴权只读 /v1/usage 且拒一切非200+474 行对抗测试（SSRF 七连/陈旧 action/身份一致性/双路取消）——设计实现双优，唯未声明真机验证；我方 A（#5339）最小增量回退设计成立+真机 4.1.3 实证（6s 全文）但三缺口：①取消调不存在端点 DELETE（超时泄任务）②ping 在 4.1 上 GET /v1/tasks=405（#5111 实测矩阵）非404即真——错误 key 可能误报通③manifest 无 sha256/不认服务器签发 upload url+headers（本地形态可用，SaaS 形态必挂）；我方 B（#5338）除继承 A 三缺口外无回退无探测——4.0.x 直接硬断（issue 报告人正以 4.0.12 为回滚工作态），作上游候选被严格支配；#5113（docs）是诚实过渡件与代码修复互补
- **教训入册**：wsl2 fakeMinerUV1413 按 A/B 客户端猜测实现 DELETE 路由=循环验证（fake 应照 spec 造不照客户端造）；"无人先修"查重须含在途 PR 双端点（timeline cross-refs）
- 处置待用户/wsl2：B 建议撤；A 撤或重定位；向 #5111/#5121 交叉引用补真机验证证据为信誉正着

## 【2026-11-14（校时后）：协议合规 + 断点后官方侧变化刷新】
- **准入 protocol 协同体系**：读 vicfei/protocol COORDINATION.md；本窗口按准则 1 向
  sessionlog/worklog 各追加两条（a05c8e2 / c641be9，直推 main）；准则 2 跑
  sync-singapore.sh（fe09ce3，记忆快照含脱敏门降级为 NOTE）；事后确认真实时钟
  =2026-11-14（GitHub 响应头校时），此前 09-15~17 为本机慢钟读数
- **官方侧在窗口关闭后的处理**（GitHub 时间线）：
  · #3367（幽灵文档切片2）09-17 16:55 合并 → **累计 8 合并**
  · #3150（排序统一）09-21 关闭未合并：lyingbug 称方向值得做，但 #3381 已把
    knowledge_search.go 改名 search_knowledge.go 并重构 retriever——分支过期；
    如重启需在新基线上重做（未来候选）
  · #3176（标题泄漏）09-25 关闭未合并：#3633（09-24 合）的 unwrapTitleQuotes 与
    标题清理已覆盖同类问题，lyingbug 致谢我方修复 → 记被上游取代并入
  · #3328（方言修复）早前被第三方直提 0ad08d41 取代，已自关（致谢）
  · #3342（共享空间图片403）报告者确认升级后修复，闭环
  · #3296（禁注册登录）**官方指派给 vicfei**：lyingbug 确认我方判断（flag 不 gate
    login，SearXNG HTML=请求未达 app，端口/反代拓扑问题），并已关闭误修的 #3377；
    责任=继续向报告者（Jennifer-peng）索要 URL/.env 端口/反代/docker ps 清单
- **终态**：8 合并（#3069/#3036/#3096/#3104/#3273/#3336/#3339/#3367）+ **3 在审**
  （#3283 PDF/#3251 豆包/#3062 插件）+ 2 被取代致谢关闭（#3150/#3176）+
  影响分 #3343（#3280 评论→官方自修）
- 第 6 棒待办修正：交接 prompt 中"7 合并+6 在审"更新为"8+3"；#3296 跟进入列；
  #3150 若重启需先 rebase 到 #3381 后基线

## 2026-11-14 R62 — 协议接入 + 本窗口脱漏补记：sessionlog/worklog 双写三批 + 记忆 sync
- 按 COORDINATION.md（vicfei/protocol，唯一真相源）窗口准则执行：读协议→检查覆盖→补写脱漏→双仓推送→记忆 sync
- 核实：**#5209（localStorage 用户隔离）与 #5215（引擎名+上游错透传）已于 11-09 15:18Z 被 lyingbug 合并**——四连发两中两在途（#5211/#5213 open）；#5338（wsl2 的 MinerU PR）已被关闭未合并，#5339 仍 open
- 补记三批（此前只入登记册/部分入 worklog，sessionlog 缺失）：11-06 两项（七项缺陷验证 + 四连发战役）、11-09 一项（#5335 双相验证）、11-10 一项（#4069 裁决）——sessionlog commit fdf251a；worklog commit 0c1581c（与他窗口 13:50 条目冲突已按时间序合并保留双方）
- 记忆同步已执行（sync-singapore.sh → synced & pushed，含 weknora 项目记忆快照）
- 协议缺口备忘：本窗口标识 sg-weknora-main(zcode)，此后所有收官任务按双写模板执行

## 2026-11-15 R65 — 协同协议接入 + wsl2 四动作确认 + 在途承诺登记（#5121 真机复验待执行）
- **protocol 接入**：按 vicfei/protocol COORDINATION.md 执行——WeKnora 根落 AGENTS.md（项目映射，已入 .git/info/exclude 防混入上游分支）；sessionlog/worklog 双写补记 11-10/11-12 三任务；sync-singapore.sh 与 brainvault sync.sh 均已推
- **wsl2 11-12 四动作确认**（sessionlog wsl2 11-12 + GitHub 双端点核实）：#5339 自曝两缺陷评论（05:48）→ #5338 评论+关闭（B 案下线）→ #5121 真机验证请缨（05:49）→ #5111 补矩阵；战略=自曝换信誉+验证合伙人定位；fork 侧 v2 已按 spec 修 cancel→POST /cancel、ping→/v1/usage、fake 照 spec 造
- **在途承诺（下窗口必须跟进）**：PoisonGodv 06:54 已接受请缨，指定复验 #5121 commit `7aaf9373` 于真实 MinerU 4.1.3 部署——复验执行方需真机 4.1.3 环境（wsl2 本地容器侧，SG 侧无 4.1.3 服务），结果回帖 #5121；#5339 保持 open 等 #5121 走向（若 #5121 先合则关 A 并致谢）
- 状态：五对象现状 #5111 open(2 评论)/#5121 open(3)/#5113 open(docs)/#5338 closed/#5339 open(1)；#5305/#4725 机会牌仍未动

## 2026-11-15 R66 — 第 28 轮扫描（3 天复扫）：配对率 21/23 密度再升；#5305 三天零认领仍首推；新增 #5530 深水候选
- **新件 23（11-13→11-15）配对 21/23**：#5530（JSJ189 极端宽高比图片，见下）与 #5481（外部云 PG18 建表脚本不全，部署支持类，排除）为仅有无配对；群狼密度再升——#5473/#5472 各双 PR 竞争
- **前候选状态**：#5436 被 icearia0219 #5441 拿走（验证受限判断落空）；**#5305 三天零认领**（仅 PoisonGodv 11-10 静态核对，未做运行时复现、未 claim）——保持首推；#4725 弃置 18 天不变（Frank 退赛后再无动静）
- **#5530 深水新候选**：imageprep 无几何概念（Limits 只有字节/MIME），1×526 类退化条经 VLM 400 永久失败烧预算归档（生产 129 失败/49 文档）；建议两分处理=退化条入队前跳过+长表切分；与 #5528 同调用点（image_multimodal.go:359）但 burrows99 #5531 只修 Limits 调用不覆盖几何——独立问题成立；风险=JSJ189 件 24h 内被抢概率高
- MinerU 线无新动静；#5121@7aaf9373 真机复验承诺仍在 wsl2 侧
- **结论**：可打牌 2.5 张——#5305（首推：零竞争+我方栈可全链验证+修复方向已给）/ #4725（零竞争硬骨头）/ #5530（深但抢手，需当日出手）

## 2026-11-15 R67 — #5305 复现完成（v0.9.0 官方栈）：四场景矩阵全闭环，额外实锤 rebuild-index 同病；证据档入 .context
- **环境**：weknora-official v0.9.0 补启 neo4j:2025.10.1（.env 备份 .env.bak-20261115-r5305）+ app 重建；tenant 10000 opencode-manual
- **矩阵**（同栈连续）：A1 批量重建无 overrides → graph 入队 0/neo4j 0（issue 原路径复现）；A2 编辑器 rebuild-index（v0.9.0 handler:3507 固定传 nil）→ 0 入队/neo4j 30→30（UI 承诺路径同病，额外发现）；B1 批量重建带 graph_enabled=true → 入队 2/neo4j 23（唯一变量二分）；B2 启图谱后新上传无 overrides → 入队 1/neo4j 23→30（"仅新文档生效"实证）
- **根因三重锁定**（v0.9.0 行号）：knowledge.go:3507 nil + knowledge_process.go:2941/2956 nil-keeps-stored + knowledge_process_config.go:93-94 显式 false 覆盖 KB true + post_process.go:210 扇出门控；A1 日志 "entered finalizing (pending_subtasks=1)" 证明 graph 槽从未播种，summary 管线正常（排除环境）
- **下一步（待用户批）**：按 issue 建议 a/b/c 选型做修复——倾向 a（batch-reparse 无 overrides 时按 KB 当前配置刷新快照）或最小语义修正=reparse 时仅对"未提供 overrides"的 graph/extract 字段取 KB 值；先出设计再编码，issue+PR 同日打包
- **产物**：/home/ubuntu/WeKnora/.context/r5305-repro-evidence.md；残留 KB 7753a2a8/aa8135a4 与日志 /tmp/r5305-logs-*.txt

## 2026-11-15 R68 — #5305 修复选型裁决：nil→{} 统一（ReparseKnowledge 单点）；{} 语义栈上实证已存在
- **选型分析六案**：A nil→{} 统一（service 单点）/ B 前端显式传配置 / C 仅文档 / D 稀疏快照重构 / E 字段域刷新（仅 graph/extract）/ F handler 层逐点转换——裁决 **A**
- **决定性依据**：栈上实验（任务 5b6512b1）同文档 nil→0 入队 vs {}→1 入队+neo4j 39——{} 语义现网已可用，修复=统一非新发明；`ValidateProcessOverrides(&{})` 通过；worker 重读存储快照（post_process.go:144 等 10 处）→ 持久化刷新即传播
- **A 案要点**：`ReparseKnowledge` 入口 `if processOverrides == nil { processOverrides = &KnowledgeProcessOverrides{} }`——单点覆盖列表批量（KnowledgeBase.vue:514 不传）+timeline 重试（timeline.vue:461 不传）+空 body 单文档 API；显式 overrides（全量/部分）语义不变；单文档 UI 弹窗显式回传快照→per-doc 意图保留；无需迁移，陈旧快照下次重建自愈
- **已知边缘（PR 须披露）**：图片文档+KB 级 VLM 关+上传时 per-doc VLM 开的窄路径，nil 重建将从"沿用快照静默成功"变为 400 可见错误（与今天显式传 {} 完全同门槛）——可见可行动优于静默错配，写明即可
- **弃案理由**：B 不修 API/timeline 且 main 编辑器 rebuild 路由缺失（前端 api/knowledge-base/index.ts:166 调用后端无路由——独立回归，另立 issue 素材）；C 不修；D 正确架构但 diff 面过大（前端载荷重设计+存量快照语义）宜后续；E 语义不一致难测试；F 多点易漏且未来 nil 调用方复发
- 下一步（待用户批）：出 PR——单点修改+单测四件（nil 等价 {}/显式胜出/VLM 门可见错/worker 传播）+双相 E2E 矩阵；issue+PR 同日

## 2026-11-16 R69 — #5305 修复实现与验证闭环：A 案落地（a5b96f069），E2E 三面全过（翻转/钉住/不变）
- 实现：分支 fix-reparse-nil-refresh（基 main 9b4f792a0），ReparseKnowledge nil→{} 归一 +21/-16；单测四件 163 行；service/handler 包绿+全仓 build 干净+lint 预检净（三次 lll 学费未再犯）；DCO 签名已推 fork
- E2E：bookworm 容器构建（宿主 glibc 2.38 教训：裸 golang 容器缺 libsqlite3-dev 头文件，补装后 BUILD-OK）换装 v0.9.0 栈——A1'' nil 重建快照 false→{}、入队 0→2、neo4j +25；B1'-inverse 显式 false 仍 0 入队钉住；B2 新上传不变；首轮 A1'/B1' 互踩（5s 间隔删块致 "chunk not found"）定位为测试节奏非缺陷，A1'' 单独验证补齐
- 栈已复原 v0.9.0 原版（备份 /tmp/WeKnora.stock-app）；KB3 现场留存
- 待办：PR 文稿+issue 评论稿过稿后提交（Fixes #5305）；附带披露 main 前端调 rebuild-index 而后端路由缺失的独立回归（另立 issue 素材）

## 2026-11-16 R70 — #5305 测试充分性补强：用户质询触发六缺口排查，全部关闭（lint CI 语义 0 issues + 两个 E2E 缺口）
- 质询响应：诚实列出未覆盖面——①golangci-lint 未本地跑过（三次 lll 死亡史）②单文档 reparse/timeline nil 路径无 E2E ③VLM 边缘只有单测 ④ASR 门无单测 ⑤部分 overrides 替换语义无测试 ⑥chunking/QG 顺带刷新靠推断
- 关闭记录：①docker golangci-lint v2.12.2 `--new-from-rev=9b4f792a0` 复刻 CI（only-new-issues）= **0 issues**（全包 190 条全为存量噪声）；②单文档空 body reparse：显式 false 钉住后翻转——快照 {}（jsonb typeof=object 实证）、queue_graph=1、neo4j 70→60（DelGraph）→70（重抽取）；③图片文档（74B PNG）per-doc VLM-on 快照 + KB VLM-off：nil 重建 **HTTP 400 "上传图片文件需要设置VLM模型"**，显式 VLM overrides 重建即恢复（accepted/pending）；④⑤新增单测两件（ASR 门 mp3、部分 overrides 整体替换语义）并 amend 进提交（129bba5c4 force-push）；⑥经 ⑤ 的整体替换机制实证（快照是全量替换非合并）
- 遗留（评估后接受）：URL 型文档 nil 重建未单独 E2E（html 非图/音无门，同机制）；重叠重建的 "graph ignore chunk: chunk not found" 为存量行为非本修复引入
- 栈已复原 v0.9.0；现场 KB5 11eb1a68 + imgdoc 3b38e05d 留存

## 2026-11-16 R71 — 补交付：MinerU 4.1.3 API 接口文档（用户索要"随服务提供的接口文档"）
- 事实核对：4.1.3 镜像打包线在 wsl2（harbor 生产镜像+G/D 盘 kit/bundle），SG 无 4.1.3 镜像（docker images 零命中，仅 2.2.2 venv）；worklog 任务夹原无独立接口文档（当时依赖上游文档+现场探活）
- 补齐：拉 opendatalab/MinerU **mineru-4.1.3-released 精确标签**的 http_api.md（总纲，"Tasks is the single asynchronous parsing API"）+ tasks.md（详规：端点/manifest 字段/tier 解析序/状态机/3600s 链接过期/hash 缓存/错误码枚举），叠加实测锚点（wsl2 生产验收三步+双案 e2e 6s/2s+/v1/usage 命中+#5111 404/405 矩阵）成稿
- 产物：worklog tasks/2026-11-09-mineru-v1-413-prs/MINERU-4.1.3-API.md（含 FastAPI 自带 /docs+/openapi.json 导出法——服务原生就带接口文档，建议 wsl2 导出后入 G 盘 kit 补第 9 件）

## 2026-11-16 R72 — #5305 修复 PR 投递：**PR #5591**（Fixes #5305）+ issue 复现评论，CI 起跑
- 投递物：PR #5591（head=vicfei:fix-reparse-nil-refresh@129bba5c4 → Tencent/WeKnora main，基 9b4f792a0 零漂移）；正文含四要素根因链/nil≡{} 统一论证/VLM+ASR 边缘披露/五场景 E2E 矩阵表（含 before-fix 行与图片边缘 400+恢复）；issue #5305 复现+定案评论（nil vs {} 二分叙述）已发（issuecomment-6923840764）
- 铁律自查：两文稿 grep 零命中；发前双稿已经用户过稿批准（"发吧"）
- CI 初态：OPEN+MERGEABLE；detect lint modules SUCCESS，Format/vet/test/build、golangci-lint、SCAN 跑动中——按 #5211 经验 lint 是主险，已在本地以 CI 同口径（v2.12.2+--new-from-rev）预跑 0 issues
- 把握评估已答复用户：原样合并约七成，含评审迭代八成五（风险=语义判断>流程运气；竞争面 7 天零 PR）
- 后续跟进点：CI 全绿确认；报告者 ningL32 的确认信号；评审若提"字段域刷新"式意见则接受迭代（方案 E 曾评估后弃，可按评审导向复活）

## 2026-11-17 R73 — PR #5591 CI 红灯根因：**"零漂移"误判**（查了 fork 的 main 而非 upstream，实漂 1379 提交）；上游已把 nil=沿用快照钉成测试契约，A 案需转 E 案重做
- **流程错误（本条核心教训）**：R72 的"main 零漂移"是 `git fetch origin main`（origin=fork，fork main 停在 9b4f792a0）——**查上游漂移必须 fetch upstream remote**。GitHub Actions 测 pull_request 的合并树（对上游当前 main），于是 CI 编译出我分支里不存在的代码
- **CI 失败解码**：①既有新测试 `TestReparseKnowledgePreservesOrChangesSummaryChoice/reuse_upload_choice`（knowledge_batch_reparse_test.go:142-187）断言 nil 重建后 SummaryEnabled 保持非 nil 的存储值——与 A 案整体刷新直接冲突；②我方三测试报 "knowledge does not belong to its knowledge base"——上游新增 `loadKnowledgeWrite` 归属校验+`access.WithKBTaskWrite` 上下文，测试需适配；③golangci-lint/SCAN/模块探测反而全绿
- **上游现状**：ReparseKnowledge 重构为 wrapper+内部 reparseKnowledge（tasksDequeued 参数服务 ReplaceKnowledgeFile）+preflightReparseEngine 预检（#5094 方向）；**nil 块原样保留**；KnowledgeProcessOverrides 新增 SummaryEnabled 字段（我基线无此字段）；#5305 仍 open 且 1379 提交中零引用——图谱 bug 未修
- **裁决方向（待用户批）**：A 案整体刷新与上游新契约冲突 → 转 **E 案字段域刷新**（nil 时仅 graph/extract 按 KB 当前值刷新，summary/chunking/VLM 等选择保留）——此前弃 E 的"语义不一致"理由已被上游自己的字段线（选择类保留）消解；需全量 rebase+测试适配（WithKBTaskWrite+新 mock）+ 重跑 E2E；对外动作（#5591 披露评论或关闭重开）待用户拍板
- 把握评估作废，重做后重新校准

## 2026-11-17 R74 — #5591 E 案重做收官：**CI 四项全绿** + E2E 选择保留实证；漂移误判修复流程固化
- 实现：基 upstream/main（7d064bc3a，漂移后正确 remote）重建分支——nil 时仅摘除快照中 graph/extract 两钉（摘除后走既有 validate+persist 路径=与显式请求同校验），summary/chunking/VLM/ASR/question 全保留；测试四件重写（适配上游克隆返回模式+WithKBTaskWrite；require.Same→值断言——克隆行为是上游重构引入）
- 本地全绿：service 包（唯一例外 TestSkillPythonVerifier=已知宿主环境依赖，CI 绿）+handler+build+golangci-lint --new-from-rev=7d064bc3a 0 issues
- E2E（上游基二进制换装，迁移至 schema 134 后干净启动）：nil 重建→graph 入队 1/快照钉摘除（graph_enabled+extract_config 消失）/summary_enabled=false 保留/chunking+VLM+ASR 原样/neo4j +10；显式 graph=false→0 入队/钉回/neo4j 80→70（删旧无新抽自洽）
- 投递态：force-push d5868845e；**CI 四项全 SUCCESS**（含上游 reuse_upload_choice 契约测试与我的四件共存活）；PR 正文已更新为 E 语义；透明说明评论已发（issuecomment-6924418481）；栈已复原 v0.9.0 原版
- 把握重校准：语义与上游新契约对齐+CI 绿+零竞争——原样合并概率回升至 ~0.75，含评审迭代 ~0.9

## 2026-11-17 R75 — #5591 充分性质询二轮审计：四调用方全分类 + 换文件继承确认 + 发现图片向量姊妹 bug 胚子（后续机会）
- 用户二轮质询触发系统审计：①**四调用方全枚举分类**——单文档端点（request overrides）/批量消费器（省略即 nil）/handler 直调/**ReplaceKnowledgeFile（knowledge_replace.go:178 传 nil）**；②换文件路径深读：签名不带 overrides、旧快照经 mergeKnowledgeMetadata 存活、nil 走派生分支→**修复对换文件同样生效且语义正确**（原上传早于启图谱的文档换文件后新文件也踩同款 bug，现跟随当前策略）——加分面已补进 PR 正文 v3；③字段分类核清：结构体除 graph/extract 外全为"每文档选择"（注释自证 image_* 为 per-document override），摘除清单无需扩
- **新发现（未验证，不入 PR）**：UploadConfirmDialog 恒钉 image_vector_enabled（1296 预填→1349 恒发送）→"KB 后开图片向量索引、存量文档 nil 重建不生效"的同款姊妹 bug 胚子——待复现后可另立 issue+PR（下一张牌候选）
- 残余评估接受项：单文档端点/timeline 在新基二进制上未单独重跑 E2E（与批量共享同一 nil 分支+CI 合并树 handler 测试绿）；重叠重建竞态为存量行为（上轮已评估）
- PR 正文 v3 已更新（换文件继承句+四调用方审计句）；铁律自查零命中

## 2026-11-17 R76 — #5591 PoisonGodv 正面技术评审 + 三项修正闭环 + 回复/正文 v4 已发：达"评审对话中"态，CI 复绿
- **评审要点**（COMMENTED，非 approve）：确认两钉摘除=最小正确集（补锚 :144 eff.GraphEnabled&&eff.ExtractConfig.Enabled 门控，我方已在描述引用）；三项可落地——replace.go:91 过时注释/Swagger+代码注释旧契约/fail-fast 边缘披露——前两项 cc3629191 修复推送，第三项入正文 v4；另点出姊妹 PR #4217（快照压实）/#2763（worker 层规则钉清除）时序关系（#2763 若后合建议归拢我方 service 层归一化）与前端跟进方向（重建确认框"应用当前策略"选项）
- **投递态**：评审回复（逐条回应+表态愿接 #2763 归拢）issuecomment-6940907798 已发；正文 v4（fail-fast 句+调用方审计句+换文件继承句）已更新；cc3629191 CI 四项全绿
- 把握终校准：正面社区评审+响应完整+CI 绿+零漂移零竞争——原样 ~0.85，含维护者迭代 ~0.95；后续跟进=lyingbug 波次时机、#2763 归拢（本 PR 落地后）、image_vector 姊妹 bug 复现（下张牌）

## 2026-11-17 R77 — image_vector 姊妹 bug 复现实锤（四格矩阵+settle 时序关死）；阿里云多模态嵌入链路新就位
- **环境**：DashScope key 从栈内密文按 app 自身 AES-256-GCM 方案本地解密复用（SYSTEM_AES_KEY 同源，owner 零脱敏裁定覆盖）→ 建 tongyi-embedding-vision-flash（768d，8e3fadad）；直连真实嵌入先行验证（PNG→768 维 OK）；分支二进制（main+#5591 补丁，不触图片字段=main 原样行为）换装
- **矩阵**：上传时 UI 同款钉 false→0 向量（caption 正常）；KB 后开+nil 重建→**0 新向量**（settle 90s 复核+nil 窗口 Indexed 日志 0 条+caption 重生成证明源块在——时序误判关死）；新上传无 overrides→1 indexed；显式 true 重建→1 indexed（异步 best-effort，completed 后落）
- **根因锚**：UploadConfirmDialog:1296/1351 恒钉 + process_config:125-126 显式 false 压 KB true + knowledge_process:4796 payload→image_multimodal:832-836 门关；与 #5305 完全同构，v0.9.0 与 main 皆有该特性
- 附带观察（未定性）：image_* chunk 行跨重建累积不清理——reparse 清理对图片块语义需单独核实
- **打法（待用户批）**：独立 issue（证据矩阵+代码锚，与 #5305 互引）；修复二选一——(A) 扩展 #5591 摘钉清单加 ImageVectorEnabled（一行+测试+本次 E2E 已备，评审人已在线上下文中）或 (B) #5591 落地后跟进 PR（评审节奏零风险）；倾向 A

## 2026-11-18 R78 — #5591 评审二轮收尾：PoisonGodv 核验三项修正+E2E 矩阵背书+#2763 归拢正式+1；swagger 生成物尾巴已收
- 评审二轮（11-17 14:12）：knowledge_replace.go 注释与 fail-fast 披露"checks out"；E2E 矩阵被其静态核验（"line up with the code paths"）；item3 半完成=docs/swagger.yaml 生成物未重生成（CI 不红，礼貌项）——make docs 已跑并推 e15f47c7c（新文案确认在生成物，docs.go gofmt 净）
- 战略利好：#2763 parser 钉归拢我方获 +1——落地后的跟进 PR 有社区背书；与姊妹 bug 的 image_vector 钉摘除同住一处代码，未来可一炉
- 姊妹 bug：遵用户指令 issue 挂起，等 #5591 状态变化
- 待办：回复稿（docs 重生成确认+谢 +1）已备待批；监控 CI（docs-only 低险）
- R78 补记：回复已发（issuecomment-6970553973，用户批准）——docs 重生成确认+谢 +1+接 #2763 承诺；#5591 对话闭环，进入纯等评审/合并状态

## 2026-11-19 R79 — 第 29 轮扫描（狼群无差别收割）+ #5591 rebase 事件闭环（--theirs 语义反噬教训）
- **池面**：11-15→11-18 新件 35，含强域候选 20 件**全部有 PR 且多数当天被抢**（#5662 三 PR 竞争、#5617/#5589 双 PR）；新工作狼 lnuxe/tsumon 加入，PoisonGodv 也在收割（#5651 跨空间泄露已被其 #5668 拿走）；feature 类亦被报告者自配对——**唯一已知真无配对可修件仍是 #4725**（弃置 24 天），另三件大 feature（#5610 folder_path/#5626 表格分析/#5618 平台默认 MCP）不属我方证据修复线
- **#5591 rebase 事件**：上游 3 天 18 提交致 CONFLICTING——其中含两个 reparse 相关修复落地（#5024 可检索性保持+资源交换守卫，与我们的归一块无冲突共存）+ **#5639 文档体系重构**（docs.go 改 110 行 embed 方案+新增 sync/contract 治理测试+CI 门禁 #5636）；rebase 冲突解决时 `git checkout --theirs` 在 rebase 语义=正在重放的自己提交（旧式 44k 生成物覆盖上游新方案）致双 CI 红灯——修复=恢复上游 docs 全套+新流程 make docs（swagger-gen 脚本）再生成，diff 收敛至 json/yaml 各 2 行文案；**4dbf6e2f6 后 CI 六项全绿回 MERGEABLE**
- **教训入册**：rebase 冲突取上游侧必须 `git checkout upstream/main -- <path>`（禁 --theirs/--ours 心算）；上游换生成流程后本地工具链要跟着换（swag init 时代已终结）
- 状态：#5591 等评审/合并；姊妹 bug issue 挂起；#2763 归拢待落地后接手
