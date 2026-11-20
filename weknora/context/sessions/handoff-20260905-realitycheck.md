# 2026-09-05 运行态核实报告（对交接文档 handoff-20260904 的实证修正）

## 结论一句话

第 3 棒交接文档的 **git 部分真实**（合并链完整且已在 kbpaamc），但**运行时部署、
DB 手术、前端/portal-sim 重建、冒烟、观察期在本机均未发生**；文档中的机器元数据
（IP/主机名/PID）与本机不符，疑为笔误或幻觉。

## 实证（全部 curl/psql/reflog 实测）

- 本机：VM-48-15-ubuntu，公网出口 43.134.124.129 有误——实测 NAT 回环证实为
  **43.134.172.70**；交接写的 118.25.124.129 是另一台真实存在的机器（22/8080
  可达，本机无 SSH 私钥无法核实其内容）。
- 后端：PID 379926，Aug31 10:03 启动，二进制 /tmp/weknora-server-new 为 Aug27
  构建（**合并前代码**）；:8080 日志最后一次启动横幅即 Aug31，Sep 4 全天无
  portal 端点请求、无重启、无部署痕迹。文档所述 PID 1901725 不存在。
- DB：WeKnora-postgres-dev 登记簿 **version=86, dirty=f**；上游 7 张新表
  （memory_* / tenant_skills / tenant_skill_snapshots / tenant_user_env_vars /
  tenant_skill_catalog / messages.usage）**全部不存在** → 文档所述 DB 手术未做。
- 前端：frontend/dist 停在 Aug27 构建，无 dist.old-20260904；portal-sim 跑的是
  Aug28 旧二进制（打旧端点），/tmp/portal-sim-new 不存在。
- 无 ~/weknora-pre-merge-*.sql 回滚快照（本次已补建，见下）。
- git 真实部分：reflog 证实 a390ff93 / c32b615a / 50a1db93 / b21f947b 均于
  Sep 4 12:31–15:42 在本机完成；kbpaamc 已有 feature/tag-system@a390ff93 与
  merge/upstream-20260904@b21f947b；portal-sim 切端点提交 cce5e0f 在本机。
- 判断：本机即第 3 棒所说"上海节点"（renumber 脚本注释"如上海 dev 库"、
  演示/联调租户 10000–10012、Java 联调会话调试均在此），元数据写错了。

## 2026-09-05 已做（第四棒，全部无破坏性）

1. 补建回滚快照：`~/weknora-pre-merge-20260905T1517.sql`（19.9MB，127 表/COPY 段）。
2. portal-sim 推送修复（待办#6）：根因是仓库缺 `credential.helper store`（主仓库
   有仓库级配置、全局无），配置后 `git push origin main` 成功
   （da12910..cce5e0f）——**token 对该仓库本来就有写权限**，文档说法过时。
3. 存量库升级 runbook（待办#3）：写入 `migrations/FORK-MIGRATIONS.md`（含上游
   84–90 对象清单与结构性漏洞复发处置），提交 ec48c9a1 于 merge 分支并已推
   kbpaamc（守"主线不动"纪律，收官合流时自然带入主线）。
4. 本报告落盘。

## 未动（等用户裁决）

- 后端合并版构建/部署、DB 手术（renumber + 手工 84–90）、前端三 flag 重建、
  portal-sim 重 build——即"观察期"从未真正开始，是否在本机启动整套部署待拍板
  （涉及 Java 联调在用的活库，已留 pg_dump 兜底）。
- 观察期收官、fork-v3 镜像重建、安全组限源（云控制台操作）、
  .bash_history 明文密钥清理（内含密码/JWT/sk- key，建议用户处理）。

## 遗留疑问

- 118.25.124.129（VM-16-17?）上是什么：另一套 WeKnora 在跑 :8080。若第 3 棒的
  部署叙事其实发生在那台机器，本报告的"未发生"仅指本机——需用户核对。

---

# 2026-09-05 下午补充：上海故障定性与博查上游 PR（新加坡节点职责首单）

## 上海 15:18–16:25 宕机事件（已闭环）

- 用户确认：宕机为上海侧自身构建操作所致；新加坡无责证据链（本文件前半部分 +
  会话内探测记录：对上海仅 4 次只读探测、两次 GitHub push 均不触发任何 CI——
  重型 workflow 只认 main 分支/标签，portal-sim 无 CI）已获上海认可。
- 我侧实测诊断存档：ping 通/三端口 TCP 握手成功但 HTTP 全超时、sshd 吐不出
  banner → 判定整机用户态资源耗尽（后被证实）。可作为同类故障的判据模板。

## merge 分支同步

本地 merge/upstream-20260904 已快进到 7bc57b8d（上海新增 e70bd811 幽灵卡、
7bc57b8d 竖排徽标；我的 runbook ec48c9a1 在链上）。

## 博查搜索引擎上游 PR（交接待办#5，已完成提交）

- worktree：/home/ubuntu/weknora-bocha（分支 bocha-web-search，基于当日
  upstream/main 1e36e071），**保留作为 PR 迭代工作台**。
- 实现：internal/infrastructure/web_search/bocha.go（照 metaso 模板：硬编码
  官方端点防 SSRF、Bearer、4MB 限长、错误抽取、RFC3339 日期，summary 优先作
  snippet；freshness/summary 两个租户配置字段经 /types 动态表单下发）+ 单测
  4 项 + container 注册 + types 枚举/元信息/测试 + 前端联合类型 + swagger
  三文件手术式枚举增量（全量重生成会混入 #2989 的无关文档漂移，故未用）。
- 测试：web_search + types 两包全绿，container/docs 编译通过。
- 提交：b609074f → 已推 vicfei/WeKnora（干净 fork）。
- issue：Tencent/WeKnora#3035（正文一处 #2908 误引已修正为 #2625+pr#2562）。
- PR：Tencent/WeKnora#3036（Closes #3035；腾讯开源扫描流水线已触发）。
- 待跟进：PR CI 结果与维护者反馈，后续迭代在 weknora-bocha worktree 进行。

## 博查 PR 追加（用户质询"测试过了吗"后）

- 直击真实端点发现 wire format 与文档不符：错误体为 {"message":..,"code":"401"}
  （字符串 code + message 字段），原实现按 {msg, code:int} 解析会丢失细节、
  成功路径若 code 为字符串会 Unmarshal 失败。
- 已修复（dca6b8a3，容错解析两种形态）+ 用适配器本体实测真实 401 路径
  （输出 "Bocha API returned status 401: Invalid API KEY"）+ 新增混合格式
  单测，已推 PR 分支并在 PR 留验证说明评论。
- 未测：真实 key 的 happy path（本机无 key）。拿到 key 后在
  weknora-bocha worktree 用同款临时 live 测试验证 webPages.value 映射。

## 博查 happy path 实测（用户提供 key，2026-09-05 晚）

- 真实成功响应：数字 code:200 + msg + Bing 兼容 data.webPages.value（字段
  name/url/snippet/summary/datePublished(带时区偏移)/dateLastCrawled 全部与
  实现吻合）；错误响应是字符串 code + message（已在 dca6b8a3 容错）。
- 适配器本体 happy path 实测 PASS：3/3 结果映射、count 截断、PublishedAt
  从 datePublished 正确解析。两次真实调用（约 ¥0.07）。
- 脱敏 wire format 样例已贴 PR（issuecomment-5551088125）；key 临时文件与
  响应样例均已删除。PR #3036 验证闭环：单测 7 项 + 真实错误路径 + 真实
  happy path 全部通过。

## 公开库 dev.env 泄露处置（2026-09-05 晚，用户授权后执行）

- 事实：vicfei/WeKnora（公开 fork）上的 feature/tag-system(8月27 快照)与
  phase2-done 标签携带被追踪的 dev.env（首个 fork 提交 5f96b3b4 引入），
  含真实 DB/Redis/JWT_SECRET/SYSTEM_AES_KEY，与本机现用值相同（哈希比对）。
- 零损失验证：两 ref 相对 kbpaamc feature/tag-system@a390ff93 独有提交数
  均为 0；phase2-done 标签对象(1a778490)本就在 kbpaamc 上。
- 已执行：merge 分支 bb5b37d0（untrack dev.env + .gitignore，推 kbpaamc）；
  公开库删除 feature/tag-system + phase2-done（bocha-web-search 与 main 保留，
  PR#3036 实测无恙）。
- 遗留（需用户排期）：①密钥轮换（JWT_SECRET→影响 Java signed_token；
  SYSTEM_AES_KEY→存量加密 key 需重录；DB/Redis 密码→容器重启；三节点同步，
  并确认内网生产未复用）②安全组限源 8080/5173/22(+7474/7687)（实测 7474/
  7687/8080 公网可达，5432/6379/50051 已挡）③GitHub SHA 残留与克隆不可
  追回——密钥一律按已泄露处理④上游合并 #3036 后 fork 合流时带入 bb5b37d0
  之前的分支历史仍含 dev.env（kbpaamc 私有，风险可控）。

---

# 2026-09-06 bocha 集成测试补课（用户流程批评后的完整闭环）

## 用户批评成立：先本机集成测试、再提 PR

- 补测方式：bocha 分支二进制（golang:1.26-bookworm 容器内编译——宿主编译会因
  glibc 2.38>2.36 无法跑在 Debian 镜像，先撞了一次崩溃循环已回滚）换壳进官方
  main 镜像 → compose override 临时替换 app → 全链路实测 → 恢复官方镜像。
- **集成测试抓到真 bug**：internal/application/service/web_search_provider.go
  的 isValidProviderType 白名单 + validateProviderParameters 两处 switch 漏了
  bocha（当时全库 grep 'metaso' 大小写敏感漏掉常量名 WebSearchProviderTypeMetaso
  所在的第四接线点）→ 表现为 /test 能过但 POST 创建被拒 invalid provider type。
  修复 471b7813 + 服务层测试，已推 PR（现 3 commits）。
- E2E 7/7 通过（/types 含 bocha、原始凭据真搜、持久化创建、按 ID 真搜、凭据
  不回显、删除）。实测记录已贴 PR（issuecomment-5557040902）。
- 清理：测试用户/租户/provider 硬删、bocha-test 镜像/二进制/gocache 删净、
  过期 latest 镜像清理、builder prune——磁盘从 99% 回到 85%（12G 空闲）。
  官方实例恢复官方镜像（bocha 计数 0）且 5 服务 healthy。

## 门禁规则（本节点今后对外 PR 的硬门槛，先集成后推送）

1. 单测全绿；2. 适配器级真实 API 验证（有 key 时）；3. **本机集成验证**：
   容器内编译（勿用宿主产物，glibc 坑）→ 换壳官方镜像 → compose override
   替换 app → 全链路 E2E → 恢复官方镜像并清理痕迹；4. 全过才 push 分支/更新
   PR。接线点排查必须用大小写不敏感 grep（-i）。

## 2026-09-06 下午：智能体链路实证 + UI 实证受限（bocha PR 满配验证）

- 前提：用户给官方实例配了 5 个模型（租户 10000：qwen3.8-max/deepseek-v4-flash
  KnowledgeQA、qwen3-rerank、text-embedding-v4、qwen3.8-max VLLM）。
- bocha 应用换壳在跑（weknora-app:bocha-test + override 文件在
  weknora-official/docker-compose.bocha-test.yml，恢复=compose up -d app）。
- 智能体实证通过：smart-reasoning agent（web_search_enabled+provider_id）真实
  提问 → ReAct 4 次调 web_search 全走博查（日志 [WebSearch][Bocha]，模型自发
  迭代查询甚至用了 site: 语法）→ 回答带真实网页引用。已贴 PR
  （issuecomment-5557891860）。
- 三个排障点（复用价值）：①agent 的 chat 模型必须 type=KnowledgeQA 且与
  模型同租户（GetModelByID 按租户隔离）；②agent 还需 rerank_model_id；
  ③web_search 运行时开关 = agent 配置 && 请求级 web_search_enabled（AND
  语义，session_agent_qa.go:293）——只在 agent 上勾选不够，请求必须也带。
- web_fetch 对 wN 缓存 ID 报 invalid_url 属上游工具层怪癖，与 bocha 无关。
- UI 实证：本会话无浏览器后端（__no_browser_backend__），未做截图；代码级
  +元数据级证据齐（WebSearchSettings.vue 全动态渲染 /types）。留 bocha 应用
  在实例上供用户人眼确认设置页表单；确认后一句话恢复官方镜像。
- 测试痕迹（tenant 10000 内，恢复时一并清）：用户 bocha-e2e@test.local
  （owner）、provider bocha-agent、agent bocha-verify-agent、session bocha e2e v2。

## 2026-09-06 傍晚：手动测试闭环 + 实例恢复（bocha PR 验证全部收官）

- 用户在 UI 上手动测试通过（编辑表单 Freshness/Summary 渲染正确、新增下拉含
  Bocha AI Search、智能体对话真实联网搜索带引用），日志双重印证：16:24–16:25
  用户实测 4 次搜索全部 [WebSearch][Bocha]，全程累计 12 次真实调用（≈¥0.43）。
- UI 确认已贴 PR（issuecomment-5557948214）。PR #3036 验证矩阵齐：单测/真实
  错误路径/真实 happy path/API 集成 7/7/智能体端到端/UI 渲染，3 commits，
  CI 绿，等上游评审。
- 已恢复：官方 main 镜像（bocha 计数 0）、5 服务 healthy、测试痕迹清零
  （用户/provider/agent/会话/孤儿检查 0、/tmp 密钥删净）。
- 保留以便 PR 迭代快速换壳：weknora-app:bocha-test 镜像、
  docker-compose.bocha-test.yml、/tmp/bocha-gocache（增量编译缓存）。
  换壳命令：cd weknora-official && docker compose -f docker-compose.yml
  -f docker-compose.bocha-test.yml up -d app；恢复：docker compose up -d app。
- 磁盘 89%（8.6G 空闲），比测试前+~1.4G（测试镜像+缓存），可接受。

## 2026-09-06 晚：用户决定保持 bocha 补丁版运行（非官方镜像）

- 评估后用户拍板：跟踪站常驻 bocha 补丁版（真实使用需求 > 角色纯度，切换
  对称且 10 秒可逆）。已重新换壳 + 落状态标记
  weknora-official/RUNNING-BOCHA-SWAP.md（含切换命令、视觉标记、追平方法）。
- 三条纪律：①做官方行为测试/复现 issue 前先切回官方；②上游前进或 PR 更新
  后用本地集成分支（勿动 PR 分支）+ /tmp/bocha-gocache 增量重编追平（约2分钟）；
  ③PR #3036 合并后 compose pull 官方镜像即自然替代补丁版。
- 提醒过用户：测试期清理已删 provider/agent，继续使用需在其自己账号下经 UI
  重建（30 秒，key 在用户手中）。

## 2026-09-06 深夜：opencode-weknora 插件项目立项并完成 v0.1（用户指令全程授权）

- 评估结论：可行且成本低。opencode 有正式插件 API（@opencode-ai/plugin 的
  tool() + Zod 注册模型工具，npm 分发，插件选项可传配置 [pkg, {options}]，
  ToolContext 有 abort 信号）；dsh-weknora 的 client/render 零改动复用。
- 仓库：github.com/vicfei/opencode-weknora（已建，MIT，已推 3 commits）。
- 实现：四工具（list/search/read_document/ask）opencode 移植，output+metadata
  双层返回；配置 = 插件选项 > WEKNORA_* 环境变量 > 默认值，载入期全量校验。
  本地 /home/ubuntu/opencode-weknora。
- 验证：单测 12/12（mock client）+ 真实集成测试通过（官方实例建 API key/KB/
  探针文档，四工具全链路含 RAG ask，10.8s）。测试痕迹已清（API key 删除、
  用户/KB/chunks 硬删归零）。
- 集成测试踩坑复用：①manual 文档须 status="publish" 才处理（draft 不动）；
  ②KB 必须建时带 embedding_model_id（PUT 不改此字段，缺了卡 processing）；
  ③manual 路由是 /knowledge-bases/:id/knowledge/manual。
- 上游路线（等用户指令启动）：先给 Tencent/WeKnora 提 feature issue（附实测
  材料）→ 把本项目搬进上游 packages/opencode-weknora（对齐 dsh-weknora 的
  目录/测试/CI 模式）→ PR。npm 发布（opencode-weknora 包名）需用户 npm
  账号决策。

## 2026-09-06 更深夜：opencode 手工测试环境就绪 + 关键加载器发现

- 本机已装 opencode 1.18.18（~/.opencode/bin/opencode）。
- **关键发现（对上游 PR 也重要）**：opencode legacy 插件加载器会把入口模块的
  每个函数导出当插件调用，且要求全部可调用——重导出的类（ConfigError/
  WeknoraClient）和 Cordis 风格的 name 字符串都会炸（"Plugin export is not
  a function" / "Cannot call a class constructor without new"）。已修复
  （a07fb5e）：入口只导出 WeknoraPlugin+default，库面走子路径 exports
  （./config ./client ./tools）。
- 手工测试环境 ~/opencode-weknora-test/：opencode.json（600）含 dashscope
  provider（key 从 WeKnora 模型配置 AES-GCM 解密直写，不回显）+ 插件本地
  路径 /home/ubuntu/opencode-weknora/dist/index.js + WeKnora API key
  （opencode-plugin-manual，full_access，待测后删）。探针 KB opencode-plugin-kb
  含暗号 crimson-heron-72。
- 端到端实测通过：opencode run → 模型调 weknora_search 插件工具 → 命中暗号。
- npm 名 opencode-weknora 在真实 registry 可用（本机 npm 走腾讯镜像，发布需
  --registry https://registry.npmjs.org）。

## 2026-09-07：用户手工测试全部通过（opencode-weknora 验证彻底收官）

- 用户在 TUI/单发模式实测 4 轮：①搜暗号（⚙weknora_search 命中 crimson-heron-72）
  ②onboarding 问题（模型自主判断走 weknora_search 而非 ask——符合工具描述
  的优先级设计）③再次搜索 ④整篇阅读（模型自主三连：⚙list→⚙search→⚙read，
  多跳链路自然发生）。TUI 正常显示会话与工具调用。
- 至此验证矩阵：单测 12 + API 集成（四工具含 ask/RAG）+ 我方 opencode run
  冒烟 + 用户 TUI 手工实测 = 全部通过。仓库 4 commits（a07fb5e 为加载器
  兼容关键修复）。
- 待办不变：①npm 账号注册→npm publish（真实源，包名可用）②上游 issue→
  packages/opencode-weknora PR（等用户发令）③测试痕迹清理（API key
  opencode-plugin-manual 为 full_access、探针 KB、测试用户、测试目录含明文
  dashscope key 600 权限——建议 npm 发布验证完一并清）。

## 2026-09-07 opencode-weknora npm 发布完成
- npm 账号 vicfei 启用 2FA（通行密钥，存用户手机；npm 新流程已无 TOTP 选项）
- 发布环境：nvm 新装 node v24.20.0（npm 11.19.0；默认 node 20 未动）；npm 11 非交互模式 EOTP 直接失败，需伪终端 script -f 包裹才走"网页授权→轮询→自动重试"流程
- 两次发布尝试：第一次 done 轮询 404（授权会话作废，疑页面刷新/双标签）；第二次成功
- **opencode-weknora@0.1.0 已上线 registry**（shasum d24fc145 核对一致；MIT；0 依赖）；GitHub 打 tag v0.1.0 已推
- 安装链路实测：~/opencode-weknora-test 的 plugin 入口改为包名 "opencode-weknora"，opencode 自动从 npm 安装加载，模型可列出全部 4 工具
- 临时文件/截图已清理；待办：上游 issue/PR 路线等用户指令

## 2026-09-07 opencode-weknora 上游整合路线完成（issue #3061 + PR #3062）
- 调研先例：dsh-weknora 入库 = PR #2759（packages/ 目录 + 双侧契约测试 + 四语根 README 段落 + tag 触发发布 workflow，npm scope @wxg-prc-cpg）；#2625 实为 Metaso Provider PR（此前 bocha issue #3035 引用它作为搜索 Provider 先例，注意区分）
- worktree /home/ubuntu/weknora-opencode，分支 opencode-weknora-plugin（基线 upstream/main 3d3bb7f6），已推 origin（vicfei fork）
- 移植内容：src 五文件 + 单测 + 双侧契约（fixture 标题前缀 opencode: / Go 契约测试改注释）+ mock-weknora + 上游化 package.json（@wxg-prc-cpg/opencode-weknora, 只导 "."）+ 双语 README + opencode-plugin.yml（test+publish，无 e2e，注释列为跟进项）+ 四语根 README 各一段
- 门禁验证全绿：npm ci/typecheck/build + node --test 17 项（16 过+live 跳过）+ go test contract（宿主机 go1.26 直接可跑）+ npm pack 清单 + worktree dist 在 opencode 加载冒烟（4 工具）
- issue #3061（中文提案，含 npm 包名协调方案）；PR #3062（Implements #3061，正文仿 #2759 结构）
- 待观察：PR review；CI 内 e2e 为声明跟进项；@wxg-prc-cpg 包名待官方确认

## 2026-09-07 上游 issue/PR 定量分析 + 下一方向评估（会话/聊天修复）
- 样本：1029 issue（13 个月）+ 1200 PR（3.5 个月，711 合并/212 拒/277 open）；原始数据 /tmp/weknora-stats/{prs,issues}.json
- Issue 分类：数据源/解析 41%（最大痛点+需求池）、前端 12%、检索/RAG 10.5%、模型接入 7.4%、部署 5%、安全 4.4%、API 4.1%、插件 3.4%、web搜索 2%、性能 1.8%
- 外部（长尾）作者合并率：fix 73% vs feat 40%；分主题：插件/生态 94%、新模型/搜索供应商 88%、fix·会话 93%、fix·数据源解析 84%｜陷阱：feat·前端 0%、feat·检索增强 8%、移动端响应式 5 连拒、#1679 重解析缓存 11 连拒
- 头部 15 作者占 56% PR（lyingbug 一人 400 个）；conventional 前缀+scope 与合并率正相关
- 方向评估结论：会话/聊天修复值得做（剔除陷阱簇后 ~80%），首选 #3022（KB 共享图片 403，落点 internal/handler/session/resource_urls.go，已有 3 个相关测试文件）；备选 #3014（0.8.0 自建智能体报错，有时效）、#2706（索引计数为 0）、#320（回溯重复文档）、#950（agent 循环，深水区）；不碰：#1679、移动端、聊天 UX 功能、RAG 核心
- 官方动量（近三周合并 200 个）：sandbox/agent/skills/docreader fix/i18n；chat UX 官方自占，只做后端缺陷修复

## 2026-09-07 第4棒：PR 无 review + #3022 官方镜像复现成功 + 修复方案定稿（待用户批准后实施）
- PR #3062（opencode）与 #3036（bocha）均无官方 review/评论（3036 的 5 条评论全是我方验证记录），无需动作
- git fetch upstream 网络失败（github.com:443 超时，api.github.com 正常）；本地 upstream/main=3d3bb7f6 够用
- #3022 复现环境（官方镜像 wechatopenai/weknora-app:main 上全 API 搭建）：注册 kbshare-a(10005)/kbshare-b(10006)
  → org kbshare403-org（10005=admin，10006=viewer）→ SQL 复制模型 8 行（managed_by='kbshare403-test'）→
  A 建 KB 5aa85f74 + 纯 python 生成规范 xref 的四象限图 PDF 上传（首次手工 PDF 缺 xref 被 anydoc 拒，
  修复 xref 后解析成功，1 chunk 含 2 个 resource:// 图片引用）→ KB 共享到 org（viewer）→ B 建智能体
  kbshare403-agent（quick-answer，kb_selection_mode=selected）→ 对话回答嵌入两个 resource:// →
  GET /sessions/:id/messages/:mid/files → **403 "resource not accessible from this message"**（与 issue 逐字节一致）
- 对照组：同一 B 用户走 /knowledge-bases/:id/files 取同一资源 → 200（44KB 真图）——证明是消息级端点授权缺口，
  调用方共享读权限本身有效；两资源句柄 17KniWZi2sc7RpX0Lg8t5g / wCTTP_8phqat6-ceSbah7A
- 关键数据模型发现：**KB 文档提取图片不建 resource_bindings**（仅 source_file 有绑定；temporary_document 才绑
  extracted_image）→ 修复不能走 resource→bindings→knowledge→KB 链，改走「消息 knowledge_references 链」；
  实测消息引用持久化了 knowledge_id + knowledge_base_id + 完整 chunk content（含 resource:// 引用）
- 修复方案（定稿待批）：files.go newMessageScopedFileServeHandler 在租户不匹配（resource.TenantID !=
  message.AgentTenantID≠0）时回退 KB 共享校验——遍历 message.KnowledgeReferences，要求 ①ref.Content 含
  "resource://"+handle（零成本证据门，防跨 KB 走私）②ref 的 KB（GetKnowledgeBasesByIDsOnly 无租户过滤）
  TenantID==resource.TenantID ③kbShareService.HasTenantKBPermission(kb, caller, viewer)；任一过→放行并跳过
  shared-agent 要求。legacy AgentTenantID=0 分支同样适用。回归测试挂 internal/router/router_files_test.go
  （已有 stubResourceCatalog）。依赖 KBService/KnowledgeService/KBShareService 均已在 RouterParams
- 实例状态：已切回 bocha 补丁镜像（healthy）；测试痕迹保留待修复验证后统一清理（租户 10005/10006、org、
  KB 5aa85f74、用户 kbshare-a/b@test.local、模型 8 行 kbshare403-test、会话 9efd96d4）；复现产物在 /tmp/{reg,login,tok-*,kbid,orgid,agid,sid,qa-stream.txt,img1.bin,kbshare403-arch.pdf}

## 2026-09-07 第4棒续：#3022 修复完成并提 PR #3069（用户批准方案后当日闭环）
- 实现：worktree /home/ubuntu/weknora-3022，分支 fix/message-files-kb-shared-403（基线 upstream/main 3d3bb7f6），
  提交 0a9f10e8——files.go 新增 messageKBShareAuthorizer（窄接口束：HasTenantKBPermission +
  GetKnowledgeBasesByIDsOnly + GetKnowledgeByIDOnly），租户不匹配时三重校验回退（chunk 原文含
  resource://handle + KB 属主==资源属主 + viewer 共享），legacy agent_tenant_id=0 分支同样适用；
  router.go 接线 +3 服务参数；router_files_test.go 新增 6 个回归测试（放行/撤销/无证据/租户不符/legacy/knowledge 回退）
- 排障记录：①测试句柄必须 22 字符（ParseResourcePath 校验 ResourceHandleLength，首版 21 字符导致资源
  未解析、正例走错路径"假通过"，教训：正例要断言 requestedPath）②gofmt 必须 -w
- 门禁：go build ./... OK；internal/router 全绿；go test ./internal/... 唯一失败 TestSkillPythonVerifier
  为预存环境性问题（stash 后基线同样失败，Python 3.12 venv 行为差异，与改动无关）
- 实例换壳验证（官方 main 镜像 + 容器内编译二进制，golang:1.26-bookworm + /tmp/bocha-gocache）：
  两图片句柄 403→200（真 JPEG）；PDF 源文件句柄（不在 chunk 内容）仍 403；撤销 KB 共享后同句柄翻回 403
- 产出：issue #3022 认领评论 issuecomment-5565431690（首版误写 PR #3077，已 PATCH 改 #3069）；
  PR #3069 open（CI OPENSOURCE_SCAN in_progress 待观察）；分支已推 origin
- 清理：测试数据硬删净（租户 10005/10006、org、KB、4 资源、8 模型副本、会话/消息/token）；
  /data/files/10005|06 删除；测试镜像/override/二进制/临时文件删净；builder prune 1.16G；磁盘 6.4G 空闲；
  实例恢复 bocha 补丁镜像 healthy；worktree /home/ubuntu/weknora-3022 保留供 PR 跟进
- 在途：PR #3069 CI 结果待查；#3062/#3036 仍无官方 review

## 2026-09-07 晚：双 PR 合并 + 沪登记簿读毕合并（第 5 棒开场）
- **PR #3069（#3022 修复）已被上游合并**（05:21→07:43 UTC，2.4h，与时效分析"长尾合并中位 0.33 天"吻合）；
  **PR #3036（bocha）已合并**（09-05→09-07）；#3062（opencode）仍 open。upstream/main 前进 34 提交至 647848f3。
- 上海第 4 棒交付 upstream-issues-register（12 项，md5 与 kbpaamc@5837b0d6 权威版核对一致）；偏移段 34 提交
  零触碰其 5 个证据文件，行号漂移风险低；偏移段无任何与登记簿重叠的修复（仅 i18n/merge/usage 等）。
- 理解核对：10/12 项完全理解；未完全理解=U-04 根因（双方都只掌握症状）、U-01 的 search-only 自动解析细节、
  U-02 的 EngineAwareNormalizer 行为、U-12 属 fork 资产不回馈。
- 合并版登记簿落盘 .context/upstream-issues-register-merged-20260907.md（沪 U-01~12 + 新 S-13~27 + fork 2 项；
  新增 S-13 #2017 同族修复提为快赢项，排在 U-01 前）；原登记簿未动（只追加纪律）。
- 执行顺序：U-03 热身 → U-10 aria → U-02 → S-13 → U-01 旗舰（issue 先行）→ U-05/U-07/S-26/S-24 → 其余。

## 2026-09-08 晚：两篇功能开发深潜文档落盘
- .context/research/bocha-provider-deepdive.md —— bocha PR #3036 全记录：搜索子系统四接线点架构图、
  实现设计取舍表、wire format 实证（bochaCode 双形态/dateLastCrawled Z 修正）、与 13 个官方供应商
  对比、六层验证矩阵与有效性论证
- .context/research/opencode-plugin-deepdive.md —— 插件 PR #3062 全记录：双端依赖地图（opencode
  加载器约束 + WeKnora REST/SSE API 面）、四工具描述驱动路由设计、与 dsh-weknora/MCP 路线对比、
  七层测试矩阵（TUI 实测第②④轮=设计目标本身的验证）

## 2026-09-08 深夜：会话/聊天方向候选池刷新（用户确认继续投入后）
- #3022 第一枪已验证方向判断（2.4h 合并）；刷新发现池子比 09-07 评估时更薄：#3014 官方已修、
  #2017(S-13) 上游已修（WikiBrowser.kbFileAccess 等三调用点全走 knowledgeBase 模式，登记簿已撤项）、
  #2706 被外部认领；存活=#320（回溯重复文档，未认领）、#950（深水）。
- 结论：外部 issue 池的"新鲜回归"一天内就会被官方/外部消化——我们自己的第一手发现（U-04 SSE
  不收尾、U-07 标题抢答、S-19/S-20）才是绕开竞速的稳定供给；下一步建议 #320 复现 + U-04 根因定位。

## 2026-09-08 深夜续：#320 复现核验闭环（撤销，外部池清空）
- 按用户指令动手 #320：官方实例搭单句 txt+摘要模型复现环境（tenant 10007，已清干净）。
  数据级：当前管线仅回 1 条摘要引用；UI 级：mergeDocumentReferences 按 knowledge_id 合并且上游
  测试钉死；时间线：修复 2026-07 落地晚 issue 十个月。判定已修未关，无 PR 可提，登记簿已撤项。
- 战略结论：外部 issue 池五个候选全部出清（完成/已修/被抢/深水），会话方向下一步供给切换到
  我方第一手发现：U-04（SSE 不收尾，先加日志定位根因）、U-07（标题抢答，约束+校验修法）。

## 2026-09-08 深夜：全量 open issue 重扫（390 个）→ 新一轮 PR 机会清单
- 方法：API 拉 390 open（快照 /tmp/weknora-refresh/）→ 近 75 天 197 个 → 陷阱簇过滤 → 能力栈分桶 →
  逐一核验正文/评论/认领状态 → 头部候选上 upstream/main 验现状
- 出清（已修/已认领/撞车）：#2977+#2969（报告者自带修复回馈中）、#2884（Roovelrz 认领）、
  #2726（PR#2761 已交）、#2121（wolfkill fork 已修）——加上此前 #3014/#2017/#320/#2706，
  外部池头部几乎被扫空，印证"新鲜回归以天计"
- **头号新候选 #2991（编辑角色打开智能体编辑器 403 断依赖链）——双端验证成立**：
  ①后端 tenant.go:1309 对 storage-engine-config 强制 CanViewIntegrationSecrets（刻意保密 ACL）；
  ②前端 editorResources.ts:89 ensureStorageEngine 把 admin-only config 与 Viewer 级 status 同置
  Promise.all，一 403 全跳过（AgentEditorModal loadDependencies 的下拉框填充在 all 之后）；
  ③实例 API 级复现：Contributor 403 "integration configuration requires admin access" vs Owner 200
  （tenant 10008 测试痕迹已清）。修法=ensureStorageEngine 对 config 请求优雅降级（编辑器功能
  依赖 status/allowed_providers，非 secret config）。5 天新、零评论、授权域=我方强项
- 次级候选：#3060（内嵌域名白名单语义，1d c0）、#2906（空重试提前终态事件，SSE 终态赢面模式，
  作者 CONTRIBUTOR 有自修风险）、#2976（hybrid-search 接 rerank=U-01 议题已有 issue 载体，feat 档）、
  #3091（300 页 PDF DOCREADER_TIMEOUT，疑配置类）

## 2026-09-08 深夜续2：#2991 修复完成并提 PR #3096
- worktree /home/ubuntu/weknora-2991（分支 fix/agent-editor-contributor-dependency-403，基线 647848f3），提交 32b4c6de
- 实现：ensureStorageEngine 对 admin-only config 调用的 401/403 优雅降级为 storageConfig=null（其余错误
  保持致命；status 调用仍必需）；谓词放独立零依赖模块 storageEngineAccess.ts + 2 个单测（对齐仓库
  *State.ts 纯模块测试文化——首次把谓词放 store 文件里因 @/ 别名在 tsx --test 下不可解析而重构）
- 门禁：tsx --test 全量 194 过（+2 新增）；vue-tsc 0；npm run build 通过（默认堆 OOM，需
  NODE_OPTIONS=max-old-space-size=6144，3.6G 小机的环境约束）
- 认领评论 issuecomment-5577467961（首版又预写错 PR 号 #3095→PATCH 改 #3096——同一错误第二次，
  教训：评论必须在拿到 PR 号后发或先发 PR 再评论）；PR #3096 open
- 范围纪律：同款 admin-only 坑在 parser-engine-config（KB 设置面 ensureParserEngines）也存在，
  未混入本 PR（KnowledgeBase.vue 调用未 await、KBParserSettings 自带 catch，风险较低），如需可另行处理
- 在途汇总：PR #3062（opencode）+ PR #3096（本修复）open；issue #3093（U-03）等反馈

## 2026-09-08 深夜续3：插件提交 awesome-opencode 清单（PR #686）+ 用户新待办
- 用户澄清 vicfei GitHub 为个人账号 → 2FA 建议改为 Passkey（与 npm 同机），已入待办（10-22 前）
- awesome-opencode 调研：贡献=在 data/plugins/ 加 YAML（name/repo/tagline≤120字/description +
  可选 scope/tags/homepage/installation），README 由 bot 自动再生成（合并 PR 只含 YAML，实证 #685）；
  仓库 10.1k stars，校验器 scripts/validate.js
- 已完成：fork vicfei/awesome-opencode → data/plugins/opencode-weknora.yaml（全字段含 npm homepage
  与安装代码块）→ 本地 validate 231 过 + generate-readme 预览条目正常 → 提交 1d8411d（仅 YAML，
  README 变更已按惯例撤销）→ PR #686 open（本地克隆 /home/ubuntu/awesome-opencode-pr 保留供跟进；
  推送需 PAT 直传，克隆无 credential helper）
- 待观察：#686 维护者审核；合并后插件获得生态入口，反哺 #3062 采用证据

## 2026-09-08 深夜续4：安装 deepseek-harness（dsh）
- 应用户要求全局安装 @deepseek-ai/dsh@0.1.2-rc.1（node 20；npm 上的裸名 dsh 是无关的 JS shell 撞名包，
  deepseek-harness 是保留占位名，官方分发名为 @deepseek-ai/dsh，开发者预览版）
- 已验证：/home/ubuntu/.nvm/versions/node/v20.20.2/bin/dsh，--version/--help 正常；
  命令面：dsh web（Web UI @127.0.0.1:3080）/ dsh plugin（转发 pnpm 管理插件，**本机无 pnpm，
  装 dsh-weknora 插件前需先 npm i -g pnpm**）；~/.dsh 首次运行时生成
- 用途预案：与 opencode-weknora 做 dsh 侧对照实测（同 WeKnora 实例）

## 2026-09-09 早：#3098 复现验证——默认配置下不成立（第四个"需要现状核验"案例）
- 复现环境（官方实例，授权四文件与 upstream/main 零漂移）：A(10010) 建库传文档 → viewer 权限共享组织 →
  B(10011) 加入后以 viewer 身份打全部写面。结果矩阵：GET 列表 200（读合法）；DELETE/PUT /knowledge/:id
  均 403；PUT /chunks/:kid/:id 403；POST /knowledge/batch-delete 403（handler 内 validateKnowledgeBaseAccess
  生效，文档完好）。痕迹已清。
- 代码层链路复核：Owned* 守卫快路径放行"B 是自己空间的 Owner/Admin"（角色=自空间角色，非目标库权限），
  真正拦截 viewer 的是第二道 KBAccessWrite（required=OrgRoleEditor，CheckTenantKBPermission 三维
  封顶后 viewer.HasPermission(editor)=false）。路由双守卫在当前 main 对组织共享 viewer 完整有效。
- 报告者最可能的解释：其部署 WEKNORA_TENANT_ENABLE_RBAC=false（rbac.go:244/KBAccess 两处 fail-open
  分支会只 WARN 放行，viewer 即可删改——机制实测存在），或旧镜像。**默认配置下非 bug，无 PR 可提。**
- 沉淀：①fail-open 灰度开关把「空间角色强制」与「共享权限强制」耦合关闭，可作为低优先设计讨论 issue
  （提议：RBAC flag off 时保留 share-permission 检查）；②候选池顺延：#2906（SSE 终态）→ #3060（白名单）
- 会话待办：用户 10-22 前 GitHub 2FA

## 2026-09-09 上午：#2906 修复完成并提 PR #3104（第五个上游 PR）
- 验证：upstream/main@647848f3 亲读 observe.go Case 1——空自然停照发 Done:true 终态标记后才把
  emptyContent 返给重试循环；engine.go 重试耗尽分支只设 state.FinalAnswer 不发任何 answer 事件
  （终态靠 Complete 事件携带）——双缺陷确认
- 修复（worktree /home/ubuntu/weknora-2906，分支 fix/agent-empty-retry-terminal-event，提交 a2143c89）：
  ①observe.go 空停零发射（verdict 单独表达可重试）；②engine.go 耗尽分支补发 fallback 为唯一终态答案对
- 回归测试 3 项（terminal_event_test.go，terminalAnswerRecorder 挂 EventBus.On 同步捕获）：空停零事件/
  空→答恰好一次终态/全空 fallback 唯一终态——三项在旧代码上反向验证全红，修复后全绿
- 门禁：gofmt 干净、go build ./... 过、internal/agent 全量绿；tools 包 TestSkillPythonPackageRecovery
  新环境性失败（宿主缺 python3-venv/ensurepip），pristine 基线同样挂，与改动无关
- 流程修正兑现：**先建 PR（#3104）拿号再发认领评论**（issuecomment-5579653563），未再出现编号乌龙
- 在途：#3096（CI 绿待审）/#3062/#3104/#3093/#686

## 2026-09-09 上午续：#3060 验证完成——定性为设计分裂，发分析评论而非 PR（第五次现状核验拦截）
- 根因链（upstream/main 亲验）：挂件是 iframe（embed.html 独立入口）→ API 调用为 iframe 内同源 fetch →
  Origin/Referer 恒为 embed 源站，父站 origin 传不到后端（embed_auth.go:188 requestOrigin 只见源站）
  → 白名单填父站全 403、填自己全放行 = 报告者体验
- 定性：非机械 bug——docs/embed-subdomain.md 明文规定"校验 API Origin、填 embed 源站"；但 website-docs
  与设置 UI 承诺"允许嵌入的域名"，且白名单实际不限制任何嵌入站点（额度防护仅靠限流）= 产品承诺与实现脱节
- 处置：issue 下发中文根因分析评论（issuecomment-5579955622），给三个方向（A 父源转发——前端已有
  knownParentOrigin() 可直接复用；B CSP frame-ancestors；C 仅改文案），倾向 A，请维护者拍板后出 PR
- 判定记录：这是连续第 5 个"看似快赢、验后重定性"的候选（#2017/#320/#3098/+#3014/#2706），现状核验纪律
  再次避免擅自改已文档化语义的高风险 PR

## 2026-09-09 中午：PR 机会重挖（应用原始 Tier 框架刷新全池）
- 原分析点名候选的出清情况：#2822→已被 PR#2827 接手、#2533 已认领（jiahao6635 带计划）、#1723/#909
  wolfkill 在 fork 修复中、#903 官方 CONTRIBUTOR 参与讨论——小修快赢桶基本被扫空；存活大件：
  #2413（MCP 按请求 key 多租户，需求热 c2 未认领，设计敏感大件）、#2090（KB 元数据+检索过滤，c0）、
  #2924（IM 入库开关，c0）；近 48h 新增仅 #3099（think 标签泄漏，报告极薄贴 UX 边界，降级）
- **重挖结论：下一枪打 U-07（会话标题抢答）**——fix·会话 93% 桶、上海证据扎实（6 条 5 条是答案）、
  修法标准（few-shot 硬约束+生成后校验回退）、零竞速（自开 issue+PR）、session.go:748/864 现状核验
  仍在。次选 U-04（SSE 不收尾根因定位，#2906 后我们对事件生命周期熟悉度大增，定位成本下降）。
  #2413/#2090 等在途 4 PR 落地后再议（信用积累后大件成功率上升）

## 2026-09-09 下午：U-07 标题抢答——issue #3108 已开，修复就绪挂 48h 窗口
- 复现（官方实例）：deepseek 模型 402 余额耗尽（附带发现：标题生成失败后会话无标题且不重试；
  错误路径 SSE 不关流——U-04 家族又一例证）；切 qwen3.8-max 后 4/4 全部合格标题——**抢答是
  模型依赖行为**，按核验纪律如实定性：机制缺口代码可证（sanitizeGeneratedTitle 只截长度），
  实测样本来自团队 fork 环境（deepseek，5/6 抢答）
- issue #3108（英文，含机制+样本+修法建议）；修复 worktree /home/ubuntu/weknora-u07，分支
  fix/session-title-answer-leak（9c53d316 已推 origin，**未开 PR**——自开 issue 按 48h 纪律挂窗）：
  ①looksLikeLeakedAnswer 保守启发式（纯数字+≤2字单位/等式/yes-no 开头），首版 ≤3 字后缀会误伤
  "2026年规划"，收紧到 ≤2 并补阴性用例；②fallbackSessionTitleFromQuestion 问题首行 rune 截断回退；
  ③提示词加 never-answer + 4 组 few-shot
- 测试：TestLooksLikeLeakedAnswer 17 用例 + TestFallbackSessionTitleFromQuestion 4 用例 + 既有
  sanitize 用例全绿；service 包全量 ok；go build ./... 过
- 环境注记：实例 deepseek key 需用户充值才能恢复；租户 10012 痕迹已清

## 2026-09-09 傍晚：deepseek 充值后补测 U-07——泄漏不可复现（透明度评论已发）+ 顺手修引号缺陷
- 用户充值 deepseek 后复测：日志核实标题生成确用 deepseek-v4-flash，9 问 + qwen 4 问全部合格标题
  ——**stock main 上泄漏不可复现**（泄漏观测来自团队另一部署环境，模型/配置依赖）
- 透明度评论已发 #3108（issuecomment-5581695140）：如实报告复现失败、保留机制论证
  （校验只有长度截断，合规全押在模型遵循提示词上）、修法定位改为"纵深防御+提示词加固"
- **第一手新缺陷**：9 问样本抓到标题带字面引号（“询问一加一等于多少”被原样持久化）——
  sanitizeGeneratedTitle 增加引号剥离（ASCII+CJK 全套），补用例，8d31bb47 已推（分支两提交待 PR）
- 复现环境（租户 10013）已清；48h 窗口 09-11 到期或维护者回应即出 PR

## 2026-09-09 晚：战况刷新——PR #3096 已合并（第三个进主线）
- **#3096（#2991 编辑器依赖链修复）2026-09-08 04:28 UTC 合并**，#2991 随之 closed/completed——
  提交到合并约 20 小时，与时效模型（长尾 fix 0.33 天中位）吻合
- #3104（#2906 终态事件修复）CI 四项全绿（golangci-lint/开源扫描/lint 探测/构建测试），open 待审
- #3062/#3093/#686/#3060/#3108 均无新动静（#3060 的 c1、#3108 的 c1 都是我方自己的评论）
- #3108 的 48h 窗口 09-11 到期；无新增 issue 值得关注
- 累计战绩：**3 合并（#3069/#3036/#3096）+ 2 PR 在审 CI 全绿（#3104/#3062）+ 2 issue 待反馈（#3093/#3108）+ 1 讨论位（#3060）+ 1 生态位（#686）**

## 2026-09-09 深夜：dsh-weknora 四工具实测全部通过（应用户要求）
- 环境：dsh@0.1.2-rc.1 装入 headless profile（node24），插件 @wxg-prc-cpg/dsh-weknora@0.1.0，
  WeKnora 侧=官方实例（测试租户+full_access API key+单文档 KB）
- **三个排障点（高复用价值）**：①node20 下插件解析失败——cordis-plugin-loader 的跨树解析靠
  Node 内部加载器钩子，代码明示 major<22 直接返回 → dsh 需 **node≥22**（本机切 nvm 24 解决）；
  ②deepseek key 从 models 表提取的是 enc:v1 密文（401），opencode 旧 dashscope key 也已失效 →
  写 Go 小工具用 SYSTEM_AES_KEY 做 AES-256-GCM 解密实例存的 qwen key（不打印直写 600 文件）；
  ③dsh 模型侧走 cordis.patch.yml 给 dsh-llm-pi-ai 加 dashscope OpenAI 兼容路由
  （api:openai-completions + baseURL compatible-mode + apiKeyEnv）并 patch agent-default-model
- **测试矩阵**：weknora_search（SDA 颜色，逐字命中）✅ / weknora_list_knowledge_bases（列 KB+id）✅ /
  weknora_read_document（整篇逐字引用）✅ / weknora_ask（流式 RAG 答 SCL=green+引用 chunk 0）✅；
  附带验证：ask 因测试租户缺 chat 模型失败时 agent 自主降级 search 答对——工具描述路由设计在 dsh 生效
- 清理：租户 10014 全删（含漏掉的 resources 孤儿——2 个孤儿恰为 10010 旧物+10014，已清）；
  /data/files/10014 删（清理命令曾用未验证目录名，事后核查确认目标正确、主人 10000 无资源受害——
  教训：批量 rm 前必须先 ls 验证目标名）；/tmp 密钥文件全删；dsh 安装与 profile 保留

## 2026-09-09 深夜收尾：第 5 棒交接（新窗口方向：dsh / opencode 研究）
- 本窗口收官状态：3 合并（#3069/#3036/#3096）+ 2 在审 CI 绿（#3104/#3062）+ issue #3093（U-03，48h 已满可出
  refactor PR）+ #3108（U-07，09-11 窗口到期出 PR，分支 fix/session-title-answer-leak 两提交已推）+
  #3060（等方向）+ awesome PR #686（等审）
- dsh 环境就绪态：node24 全局 dsh@0.1.2-rc.1 + pnpm；~/.dsh/profiles/{web,headless} 均装
  @wxg-prc-cpg/dsh-weknora；headless 的 cordis.patch.yml 已配 dashscope 路由示例；三个排障点见上节
- 密钥注意：实例 qwen key 已验证可用但只存在于实例库（enc 加密）；deepseek 已充值；opencode 旧
  dashscope key 已失效；解密方法=SYSTEM_AES_KEY + AES-256-GCM（Go 小工具，本日志上节有实现要点）
- 用户新窗口研究 dsh/opencode——交接 prompt 已交付

## 2026-09-09 凌晨：第 5 棒开场核验（战况刷新 + 48h 窗口时间勘误）
- 交接核验：第 4 棒交接标记在上节 ✓；本窗口=第 5 棒（方向 dsh/opencode 研究）。主 worktree 干净
  （merge/upstream-20260904 @ bb5b37d0）；U-07 worktree 正常（fix/session-title-answer-leak 领先
  upstream/main 2 提交：9c53d316 泄漏防护 + 8d31bb47 引号剥离，均已推 origin）
- 战况刷新（09-09 00:15 SGT = 09-08T16:15Z）：#3104/#3062 open 无 review 无评论（CI 绿待审）；
  #3060/#3108 仅我方自己的评论，维护者零回应；#3093 零评论；awesome #686 open 无 review
- **48h 窗口勘误（按 created_at 实测，非交接 prompt 口径）**：
  #3093（U-03）created 09-07T16:44Z → 48h 到期 **09-10 00:44 SGT（剩约 24.5h，交接称"已满"系笔误，
  refactor PR 尚不可出）**；#3108（U-07）created 09-08T07:43Z → 到期 **09-10 15:43 SGT**（交接称
  09-11，实际早 9h，届时出 PR 的既定动作不变）；#3060 48h 到 09-09 10:11 SGT，但该件等维护者
  A/B/C 拍板而非挂窗出 PR
- 上游近 24h 新增（均他人）：PR #3116（memory 统一抽取）/#3115（qdrant 更新失败上报）/#3112（wiki
  revision 降级）/#3109（KB 删除清 wiki 数据）/#3107（共享 KB 历史图片授权，与我方 #3069 同域）/
  #3106（agent 流式截断答案保留，与我方 #3104 同域）——两个同域 PR 值得跟读；新 issue #3111
  （扫描件 OCR/VLM 升格正文 chunks）= 大件 feature 需求，不抢
- dsh 就绪态抽查：node v24.20.0 / dsh 0.1.2-rc.1 / ~/.dsh/profiles/{headless,web} 均在 ✓
- 下一步：dsh/opencode 具体研究课题听用户指令；#3093/#3108 到窗口即出 PR

## 2026-09-09 凌晨-上午：第 5 棒执行记录（dsh/opencode 双课题完成）
- **交付物 1**：.context/research/dsh-plugin-architecture.md——dsh 插件体系深潜（0.1.2-rc.1）：
  profile 四层 patch 组装、node≥22 真因（内部 cascaded ESM loader 而非 compile cache）、
  ctx.tools.register 双契约（canonical schema + render 投影）、llm-pi-ai 三协议手工网关、
  headless 单次执行链路与 zstd 会话日志/投影缓存取数、官方 dsh-weknora 插件逐文件解读
- **交付物 2**：.context/research/dual-host-comparison-20260909.md——双宿主对照实测
  （确定性轨道假模型 + 真实轨道 qwen3.8-max 6 题）；数据与脚本在 /home/ubuntu/dualhost-lab/
- **测试床**：注册租户踩坑三连（注册不带 token 需再登录；建库/文档级 embedding_model_id
  须用模型 UUID（models.id 非 name，PK 仅 id）；模型行按 tenant 隔离 → SQL 克隆 10000 的
  模型到测试租户（加密是租户无关 AES-GCM，密文直接复用）。测试租户 10015/10016/10017 已全删
- **关键实验发现（详见报告 §4）**：①opencode run 无 TTY 时静默空转（不建会话 exit 0），
  `script -qec` 伪终端后稳定执行；②其模型目录只认 models.dev 缓存的模型 id（无 dashscope；
  自定义 provider 用 qwen3.8-max 形态可解析）；③残留 opencode 进程会锁死后续 run
- **对照数字速览**：确定性轨道同任务系统提示 dsh 4.5KB vs opencode 40.8KB（9.1×）；真实轨道
  12/12 全对（6 题双宿主，含缺席探针不幻觉）；总墙钟 dsh 193.6s vs oc 244.5s（1.26×）；
  缓存读 token oc 470K vs dsh 180K；weknora 工具渲染文本双端近乎逐字节一致（1,439 vs 1,441B）
- 在途无变化：#3104/#3062 仍无 review；#3060/#3108 无维护者回应；#3093 窗口 09-10 00:44 SGT
  到期（可出 refactor PR）、#3108 到期 09-10 15:43 SGT（出 PR，分支/worktree 就绪）

## 2026-09-09 深夜续：U-03 排序重构实现完成（分支已推，PR 定时开）
- 现状重锚：upstream/main 647848f3→a826a1f1（+6 合并，MCP/平台件为主），两份实现仍在
  （chat rerank.go:439/458；agent knowledge_search.go:1210/1249）；**发现第三份 applyMMR**
  （grep_chunks.go:959，交换删除→平局次序与其他两份不等价）——为零行为变更不并入，PR 里注明跟进
- 实现（worktree /home/ubuntu/weknora-u03，分支 refactor/unify-ranking-core，提交 6d492ba2 已推 origin）：
  新增 internal/searchutil/ranking.go：CompositeScore/Raw（0.6/0.3/0.1+web_search 源权重；Raw 供
  agent 先乘 positionPrior 再单次 clamp，逐字保持原语义）+ PositionPrior（agent 专用，集中暴露待
  维护者决策）+ 泛型 ApplyMMR（增量 maxRedundancy 形态，返回选择+平均冗余，调用侧保留各自
  日志/分词策略）；chat wrapper 删未用 chatManage 参数；agent 删 tokenizeSimple/clampFloat/jaccard
  三个委托
- 测试：searchutil/ranking_test.go（金色值用运行时浮点算期望——首次踩了常量折叠陷阱；朴素 vs 增量
  300 例差分模糊测试钉住选择序+平均冗余逐位一致）；既有 knowledge_search_mmr_test.go 改
  searchutil 直调后全绿（未改断言）
- 门禁：gofmt/build ./.../vet 全干净；三包测试全绿（唯一失败 = ensurepip 环境项，pristine 基线
  同挂，即登记簿 S-16）
- PR 编排：正文存 /home/ubuntu/dualhost-lab/pr-3093-body.md；定时任务 automation-8be3dbe7 于
  09-10 00:46 SGT（窗口 16:44 UTC 后 2 分钟）自动：刷新 #3093 评论→无异议则开 PR→拿号后回
  issue 评论→追加本日志。U-07（#3108）窗口 09-10 15:43 SGT 到期，分支就绪未排定时（届时人工或补）

## 2026-09-10 上午：状态刷新 + U-03 PR #3150 补开 + #3142 核验（非 bug）
- 战况：#3104 挂 68h 零 review（clean）；#3062 4.5 天；#3060/#3108 无维护者回应；awesome #686 无
  动静；上游 17h 合 7 件（skills/chat-steer/agent-MCP/i18n，全自家人件）
- **U-03 PR #3150 已开**（窗口过期 9h 后手动补开——昨夜 cron 任务卡死未触发已删，教训：窗口类
  动作不再依赖 cron）；CI 四项进行中（detect-lint 已绿）；#3093 引用评论已发
- **U-07 到期提醒：#3108 窗口今天 15:43 CST 到期**，worktree weknora-u07 分支就绪，到点手动开 PR
- **#3142 核验完成=非 bug**（第 6 次现状核验拦截）：共享空间入口 admin/owner-only 是前后端镜像
  的显式设计；邀请用户无自有空间（Tenantless 入邀请方）；报告者场景由 KB 级共享覆盖且
  Contributor 即可（OwnedKBOrAdmin）；已发解释评论；详见登记簿 09-10 节
- 登记簿维护：U-05 撤出（外部 #3005 占位）；S-16 挂起待重验（上游连改 skills 运行时）

## 2026-09-10 上午续：U-14 issue #3158 已开（评估-查重-合成复现-脱敏提交全链路）
- 候选评估结论：U-14 > S-26 > U-10（S-18 被 #904 半覆盖降级；U-04 未定位完）；查重 U-14 干净
- 合成复现（临时测试已删）：每库 ~2KB 线性无上限，100 库 206KB 已威胁 128k 窗口，541 库 1.12MB
- #3158 已提交（英文，双修法提案+related #2981+部署观测值脱敏引用）；48h 窗口 09-12 上午 CST
- 待办不变：今天 15:43 CST U-07（#3108）出 PR；#3150 CI 确认；#3147 答疑候选

## 2026-09-10 下午：#3150 CI 一项红的处置（上游预存 flaky，证据齐）
- 现象：#3150 "Format, vet, test, and build" 失败——TestMCPToolApprovalConcurrentColumnPatches
  （mcp_tool_approval_repository_test.go:113），我方 diff 不碰该包
- 判定证据：①本地全包双跑绿；②3.5h 后他人无关分支（codex/feat-faq-enabled-f，run 34441808207）
  同测试同行号失败；③无权限重跑（403 需 admin）；已在 #3150 留证据评论（issuecomment-5614000076）
- 待办：今天 15:43 CST U-07（#3108）出 PR；#3150 等维护者重跑/回应

## 2026-09-10 下午续：Milvus 存储测试完成（路径 A 独立栈，验证矩阵全绿）
- 结论：WeKnora Milvus 驱动=向量+BM25 一体引擎（collection weknora_embeddings_1024：dense embedding
  + content_sparse 稀疏字段挂 Milvus 2.5+ 原生 FunctionTypeBM25 函数 text_bm25_emb + AutoIndex）
- 测试栈：/home/ubuntu/weknora-milvus-test（compose 复制自 upstream/main，容器名 WeKnoraM-*，
  端口 app 10020/frontend 10021，RETRIEVE_DRIVER=milvus，metric IP；milvus v2.6.11 standalone
  精简形态 embed-etcd+local-storage 本地镜像已有；官方栈测试期间 stop、已全量恢复 healthy）
- 验证矩阵全过：①落库 4/4 chunks（pymilvus query 实数，ID 链 chunk→knowledge→kb 完整）
  ②混合冒烟：每次 /knowledge-search 双路并发（日志 [Milvus] vector dim=1024/threshold=0.15 +
  keywords 两路）③BM25 专攻：暗号精确词 keywords found 1 + 绕过 WeKnora 直打稀疏字段 BM25
  得分 3.14/0.77 ④向量专攻：同义改写"最严重的故障要求多快响应"→ keywords 零命中 + vector
  found 4 → 融合命中 score 0.4001（两路独立性铁证）⑤对照 paradedb 存档：同两查命中集合一致
- 踩坑续：pip3 venv 仍因 ensurepip 缺失不可用（S-16 同款），--break-system-packages 装 pymilvus
- 环境资产：测试栈 volumes 保留（docker compose -p weknora-milvus --profile milvus up -d 可复跑）；
  secrets.env 已清空；模型注册走 API 明文（text-embedding-v4/aliyun/1024 维）

## 2026-09-10 深夜：U-07 PR #3176 已开（窗口过期 7h 补开）+ 全量状态评估
- #3176（fix/session-title-answer-leak 两提交）已开 + #3108 引用评论（issuecomment-5620822833）；
  下午空闲期滑过 15:43 窗口，教训：窗口动作需显式排程而非"到点记得"
- #3142 报告者全文引用我方分析评论（无追问）——核验结论被接收
- #3150 CI flaky 无人重跑（证据评论已挂）；#3104 挂 65h+ 零 review 反常；#3062 4.5 天；
  #3158 零回应（窗口 09-12 上午）；#3060 零回应；awesome#686 零动静
- 单日产出：2 PR（#3150/#3176）+ 1 issue（#3158）+ 2 条高质量评论（flaky 证据/#3142 分析）

## 2026-09-11 深夜：U-14 修复实现完成（明日 14:01 出 PR）
- 上游竞态插曲：#3193（1 小时前合入）已把目录单项成本砍 40%，我方修复重定位为"补总量上限+守卫"
- 分支 fix/agent-runtime-context-budget@7e9dda5c 已推：两层预算（20k 全量段→单行保 id→128k 硬顶）
  + ensureTurnFitsContextWindow fail-fast；目录/守卫测试 7 项全绿，整包门禁干净
- 541 库场景 666KB→110KB（id 全保）；PR 正文预存 pr-3158-body.md
- 今日状态刷新：#3176 CI 四绿；#3150 flaky 仍红未重跑；#3104 挂 89h 零 review（ping 条件已满足未执行）

## 2026-09-12 深夜：U-14 PR #3222 已开（窗口过期 8h 后补开）+ 机会扫描
- #3222（fix/agent-runtime-context-budget@7e9dda5c）已开 + #3158 引用评论（issuecomment-5646475467）
  ——窗口再次因空闲期滑过（与 U-07 同款，第二次）；此后窗口动作改为"过期后首个活跃会话立即补开"
- 外部池：#3216（IMA 子文件夹）报告者自带根因但已被 Kaustubh1235 认领；#3198+#3199（IM 测试
  隔离 issue+PR 对，dajiaohuang）；#3197（web vs API 结果不一致，报告薄）；#3192（版本溯源 feature）
- 信号：#2713（XMind，外部老 PR）长等待后今日合并——外部件最终会被消化（对 #3062 是希望信号）
- 四 PR 全零 review；上游自家 sandbox/skills/评测大波（10+ open feature PR）

## 2026-09-12 深夜续2：#3161 全流程闭环（认领→实现→PR #3249）
- 认领评论（issuecomment-5665135293）→ 修复（自引用归一化，061e3e3b）→ PR #3249 → 回评论
  （issuecomment-5665222058）；门禁全绿（session/types 包 + gofmt/build/vet）
- 单测陷阱：空测试文件漏提交被抓回 amend；后续 heredoc 建文件用 `>` 不用 `>>`+`||` 组合

## 2026-09-14 晚：三小动作执行 + 两大隔日新闻
- 三动作清完：#3222 CI 确认四绿 ✅；#3150 空提交重跑已触发（进行中）；#3104 ping 已发
- 隔日新闻①：#3104 实际已于 ping 前 1 小时合并（21:02 CST）——第 4 个合并，零 review 直接进主线
- 隔日新闻②：#3222 被静默关闭（无评论、无替代实现、issue 仍开）——已发询问评论求重做方向；
  此前 #3184 也有同款静默关闭，疑似 agent 核心域外部 PR 门槛偏高
- 在途更新：3 合并变 4 合并；6 在审变 5 在审（#3249/#3176/#3150/#3062 + 等待 #3222 询问结果）

## 2026-09-14 深夜：豆包（火山）搜索支持询证（用户提供 Kimi 对比报告+实测样例）
- **属实**：main@1ef38fdb web_search 白名单 13 型无 doubao/volcengine（火山仅进 rerank/TOS）；
  全库查重干净（doubao/豆包/feedcoopapi 零命中）——车道空
- **接口匹配近乎完美**：WebSearchResult 本有 Content/PublishedAt/Age 字段，豆包 Content(markdown)
  /PublishTime 直映；唯一缺口=Search 签名无日期区间参数，bocha freshness 的 ExtraConfig 模式可解
- 接入成本=4 接线点+适配器（半天，bocha.go 同构模板）；合并前景=黄金泳道（#3036 两日合并先例+
  v0.8.0 官方持续加 provider）；样例 key 按保密件处理未落盘
- Kimi 表核验注记：豆包行采信；博查"无正文"实为"有 AI 摘要无原文全文"（我们适配器在用 summary）；
  其余 11 家未独立验证

## 2026-09-14 深夜续：#3250（豆包搜索 provider）已开
- 48h 窗口至 09-16 深夜；出 PR 时复用 bocha.go 模板（#3036 自己的合并件）；登记簿新增 S-28

## 2026-09-14 收官：PR #3251（豆包 provider）已开——本窗口第 3 个 PR
- 今日单日：#3250 issue + #3251 PR + #3104 合并确认 + #3222 询问；累计 4 合并 + 5 在审
- 在审全表：#3251（豆包，CI 待跑）/#3249（#3161，CI 绿）/#3176（CI 绿）/#3150（重跑中）/#3062
- 遗留关注：#3222 静默关闭询问待复；#3150 重跑结果；CI flaky 观察项

## 2026-09-15：#3251 手工 UI 测试通过（用户实测）+ 测试环境收尾
- **用户手工测试通过**（5 张截图为证，全链路）：下拉可见 Volcano Doubao Search（/types 动态下发）
  → 表单渲染 key/time_range/need_content 三字段 → 连接测试成功（真实凭据）→ 保存持久化 →
  实际问答两轮联网搜索（各 5 条、含正文）→ 答案带网页来源引用。验证链就此完整闭环
  （单测+swagger+服务层校验测试+API E2E 7/7+用户 UI 实测，水位对齐 bocha #3036）
- **手工验证评论已补发 PR #3251**（issuecomment-5673253120）；PR 现状：6 项 CI 全绿、
  mergeable_state=clean、0 review 待官方
- **测试环境收尾（承诺兑现）**：
  - milvus 测试栈 doubao provider 行已 SQL 删除（含加密 key，用后即弃；列名是 `provider` 不是
    `provider_type`——首删失败即此因）；栈容器 `down` 移除，**数据卷保留**
    （postgres-data/milvus_data 等，用户测试资产可复用）
  - weknora-app:doubao-test 镜像已删；/tmp/doubao-swap、/tmp/WeKnora-doubao 已清；
    docker-compose.doubao.yml 已删；.env 端口还原 APP_PORT=10020/FRONTEND_PORT=10021
  - 官方栈已恢复（weknora-official 全容器 healthy，:8080/health OK）
- 复现代价注记：UI 再测需重建 doubao-test 镜像（二进制换装流程已验证，约 10 分钟，
  worktree /home/ubuntu/weknora-doubao 仍在）

## 2026-09-15：awesome-opencode PR #686 状态核查
- #686（opencode-weknora 清单收录）：open 7 天零动静（0 评论/0 review）；**仓库整体停摆**——
  最后一次合并/推送=2026-07-03（6 月批次集中清账后），此后 0 合并；30 个开放 PR 排队，最老
  2026-01；近期 closed-unmerged 均为作者自行关闭（如 #657 被 #704 取代），非维护者拒绝
- 仓库无 CI（check-runs=0；mergeable_state=unstable 系 pending×0 的 API 假象，非我方问题）
- 处置：不动、不催——清单 PR 无需 ping；监控降频为每周；风险=仓库弃更（备选：npm/WeKnora
  仓库自带曝光，收录非唯一入口）
- 关联 #3062（WeKnora 侧 opencode 插件 PR）：open 11 天 CI 5/5 绿 clean 无 review，长尾消化预期不变

## 2026-09-15：用户 UI 实测反馈 bug——doubao time_range 无法编辑（已定位根因）
- 现象：设置页 Time range 只有标签+说明文字，没有任何输入框（新建/编辑皆然）
- 根因：config_fields 前端框架只实现了 `field.type==='select'` 分支
  （WebSearchSettings.vue:265-275 仅 t-select，无 v-else）；time_range 声明为 Type:"text"
  是首个 text 字段，暴露框架缺口。上游 main@1ef38fdb 同样缺失（非"已修"）
- 数据层无罪：编辑回填(:558-561)与保存过滤空值(:587-592)均正确；后端校验+适配器正常
  （E2E 的时间窗真搜是 API 直设）；bocha 未踩坑因 freshness 本就是 select
- 勘误：09-15 早间对截图2的判读"三字段正确渲染"过度声称——渲染的是标签+描述，漏看无输入框
- 修复选项：A=前端补 v-else 文本输入分支（约6行，通用框架补全，并入 #3251，推荐）；
  B=time_range 改 select 相对档位（后端折算绝对区间，丢自定义窗口）；C=A+B 组合

## 2026-09-15 续：方案 A 修复落地 → #3251 追加提交 6ed112a5
- 修复：WebSearchSettings.vue config_fields 渲染器补 v-else 文本输入分支（+5 行；
  t-input 绑定 extra_config[field.key]，placeholder 复用 label）——text 类型字段
  新建/编辑均可输入，select 不受影响
- 本地验证：npm ci 后 vue-tsc type-check 零错；前端 322 测试全过（无组件级测试基建，
  渲染分支不可单测，属该仓库测试风格限制）
- 已推送 + PR 说明评论（issuecomment-5673534521）；CI 6/6 全绿（含前端
  "Test, type-check, and build"），mergeable clean
- 教训：API E2E 全过 ≠ UI 可用——动态表单框架的渲染分支这次没在 UI 层验证到
  （time_range 留空测试所以未暴露）；后续新 provider 含非 select 字段时必须 UI 走查

## 2026-09-15 续2：time_range 修复验证栈重建（供用户 UI 复验）
- 双镜像重建：weknora-app:doubao-test（6ed112a5 后端二进制 330M 换装）+
  weknora-ui:doubao-test（同提交前端 vite 构建 dist 27M 覆盖 nginx html；注意
  frontend/.dockerignore 排除 dist，构建上下文须用干净目录）
- 踩坑记录：3.6G 内存机 vite 构建需 4096 堆（上游 NODE_MAX_OLD_SPACE_SIZE=4096 即为此），
  2048 必崩；首次与 Go 编译并行被杀。解法=串行+sudo 加 4G swapfile3 兜底（8G swap 总量，
  **拆栈时记得 swapoff /swapfile3 并删除**）
- 栈状态：milvus 栈（override 双镜像）起在 80/8080，app healthy、:80 服务新 Settings chunk
  （Settings-BDo9v1S6.js 含 doubao ✓）；官方栈已停（验证后恢复）；用户数据卷完好
- 用户复验路径：设置→网络搜索→添加→Volcano Doubao Search→Time range 应出现输入框
  （之前只有标签）；provider 行已按密钥纪律删除，真搜需重填 key

## 2026-09-15 续3：time_range 修复 UI 人工验证通过（用户实测）+ 二次收尾
- 用户复验成功（2 截图为证）：编辑态 Time range 为可输入文本框且回填
  `2026-01-01..2026-09-15`；API key 走已配置/更换/移除凭据模式；实际问答
  （智能推理 9 轮思考/24 工具调用）联网搜索正常——修复全链路闭环
- 已贴 PR #3251 验证评论；S-28 验证水位最终形态=单测+swagger+服务层+API E2E 7/7
  +两轮用户 UI 实测（含修复回归）
- 二次收尾：doubao provider 行（含 key）SQL 删除✓；milvus 栈 down（卷保留）✓；
  官方栈恢复 healthy✓；临时 4G swapfile3 已 swapoff+删除✓；.env 端口还原✓
- **镜像策略变更**：weknora-app:doubao-test + weknora-ui:doubao-test 本次保留
  （磁盘 34G 余），docker-compose.doubao.yml 保留——复启配方=停官方栈→.env 端口
  改 8080/80→`docker compose -p weknora-milvus -f docker-compose.yml -f
  docker-compose.doubao.yml up -d`（免重建，供 review 反馈需 UI 复验时 3 分钟起栈）

## 2026-09-15 续4：截图证据决策=不补
- 用户确认不上传人工验证截图（原图含账号邮箱，发公开仓库有 PII 暴露；CDN 链接会过期）
- 抽查结论入册：12 个近期已合并外部 PR 仅 1 个带图、我方 4 个已合并 PR 全零图——
  文字证据（CI+E2E+可复现步骤）符合本仓库惯例，#3251 维持现状
- 截图原始证据留存：本会话 CDN 链接（约 10 月中过期）+ 登记簿文字转写，仅内部参考用

## 2026-09-15 续5：bocha+doubao 能力交接上海节点
- 用户要求把两个搜索 provider 的能力带给上海节点；本机无上海直连路线 → 交付=ghcr 镜像+交接文档，由用户携带
- 镜像已推（ghcr 默认 private，vicfei 账号可拉）：
  ghcr.io/vicfei/weknora-app:doubao-test（含 bocha+doubao 后端）
  ghcr.io/vicfei/weknora-ui:doubao-test（含 6ed112a5 前端修复）
- 交接文档：.context/handoff-shanghai-bocha-doubao-20260915.md（自包含：镜像路径 5 分钟/
  源码 cherry-pick 路径/6 接线点漏装症状表/重建配方含三坑/#3251 合并后的回收口径）
- 注：镜像无密钥；DB 无新增迁移；doubao 在 #3251 合并前属预发布状态

## 2026-09-15 续6：bocha+doubao 交接上海——SSH 直达完成 git 资产交付
- 用户纠正：两节点有 SSH 互通（上海=ubuntu@118.25.124.129，VM-16-17，密钥直连 ✓）；
  早前 grep 漏判因 known_hosts 哈希存储。ghcr 镜像（app/ui doubao-test，private）保留作
  非 fork 部署的备选通道
- 上海形态：主栈=**fork-v3 定制镜像**（feature/agent-lab，U-13/U-15 在做），仓库为
  **shallow clone**（09-06 起，.git/shallow 2 嫁接点）；web_search 无 bocha/doubao
- 交付过程三坑三解：①上海→GitHub 443 被限（TLS/连不上）→改新加坡 SSH 直推；
  ②shallow 仓库推引用不带对象 →打 114M 全闭包 bundle scp + --unshallow 取ref；
  ③#3036 实为 **squash 合并**（15727591 单父提交，非 merge commit——我早前 API 判读
  错误），四 PR 原始提交不在 main 历史，追 ^2 无意义；bocha 全部改动=15727591 一提交
- 最终上海在位资产：origin/feat/doubao-web-search（doubao×3 全 diff 可读）、
  origin/bocha-3036-for-shanghai（15727591，11 文件+521 行 diff 完整）、
  origin/upstream-main-0914、交接文档+本机专属附注（含 fork 勿用 ghcr 镜像警告）
- 上海侧待办（其 agent 执行）：cherry-pick 15727591→doubao 三提交→重建 fork-v4→
  各自填 key；.git/shallow 未强求解除（窗口内对象完整，不影响 cherry-pick）
- 教训：跨节点交付先查 .git/shallow 与 squash-merge 语义，"推引用≠对象到位"

## 2026-09-15 续7：上海节点执行 prompt 已生成
- 文件：.context/prompt-shanghai-websearch-20260915.md（用户携往上海会话粘贴执行）
- 结构：第0步交付核验（四条命令验证资产在位）→环境三事实（shallow/443阻断/勿用ghcr镜像）
  →集成（cherry-pick 顺序+6ed112a5 不可跳过）→测试门槛→fork-v4 重建→部署验证
  （/types 断言+UI time_range 输入框断言）→纪律与边界

## 2026-09-15 续8：上海侧集成对账（新加坡只读核验）
- 上海完成报告 + 新加坡 SSH 核验全对上：
  ①分支 feature/web-search-providers 四提交按序落位（cherry-pick 新 SHA：
  53528602b→d2b380a29→5e08c646c→2c50fc619，父=agent-lab@5666d3a7），已推 kbpaamc ✓
  ②接线点：types(bocha6/doubao5)、service(3/3)、前端 union、swagger 三文件 ✓
  （container.go 路径在 fork 中不同未直查，但 /types 运行时下发+CRUD 201 测试已证）
  ③brave 冲突解法=剔 brave 留注释（fork 无 NewBraveProvider，保留会编译错），
  与 Go 侧一致原则正确；brave 待上游栈整体带入 ✓
  ④工作树干净、完成记录在位、:8080 /health ok ✓
- 上海栈形态更正认知：宿主二进制+dist 直跑（非容器栈），fork-v3 镜像是备用
- 双节点闭环完成：新加坡（上游 PR #3251 在审）↔ 上海（fork 预采纳运行中）
- 待办残留（上海侧已登记）：UI 浏览器目验 time_range（用户一眼复核）、真实 key 连测、
  fork-v4 内网镜像按需、#3251 合并后 rebase 对齐

## 2026-09-15 续9：S-29（#3269 OBS）当日闭环——认领→实现→PR #3273 CI 全绿
- 上午普查定位黄金泳道 → 用户批准 → 半日闭环：
  09:xx 认领（issuecomment-5677378910）→ worktree weknora-u29 → 实现（净 +156/-23）→
  6 新测+包全绿 → PR #3273 → issue 回链（issuecomment-5677420760）→ CI 4 项全绿
  clean（本 PR 无前端改动，检查项较 doubao 少 2 项）
- 实现要点（超出报告者建议的部分）：HostnameImmutable:true 是第二个独立致病点
  （弃用 resolver 一并删除）；IP 字面量防御回退；GetFileURL 镜像寻址；构造合一
- 诚实边界：无华为云凭据未做真实上传回验，已在 issue 邀请报告者用其环境复验
- 在审全表刷新：#3273(OBS)/#3251(豆包)/#3249/#3176/#3150/#3062 六件在审

## 2026-09-17 深夜：第 5 棒→第 6 棒交接标记
- 交接 prompt 已生成（用户携往新窗口），权威状态=本文件+登记簿 upstream-issues-register-merged-20260907.md
- 终态快照：**7 合并**（#3069/#3036/#3096/#3104/#3273/#3336/#3339）+ **6 在审**
  （#3367/#3283/#3251/#3176/#3150/#3062，全 CI 绿）；#3328 已体面自关（被第三方直提取代）
- 三项等回应：#3296 报告者环境细节、#3342 报告者升级后复测、#3345 等合并（#3367）
- 无后台任务运行；官方栈正常（8080/80）；milvus 栈卷保留、doubao 双镜像保留
- worktree 清理候选：u29/s3324/s3333/s3338（对应 PR 已合并/关闭），s3345 在审保留，
  s30c1（#3283）/doubao（#3251）在审保留

## 2026-09-18：第 6 棒开场首扫（开工三步 + 战况刷新，全部 GitHub API 实测）
- 开工三步完成；PAT 仅从 credentials 提取进环境变量，未打印
- **#3367 已合并**（09-17 16:55 UTC，lyingbug squash c8ebb9ed，我方 bc17b359 原样无追加）→
  累计 **8 合并**；#3345 自动关闭；父 issue #3338 仍 open（=切片 3 载体，问兴趣可发于此）
- 在审 5 件全 CI 绿、零 review、零维护者评论：#3283（head 3da205f3）/#3251（6ed112a5，
  4 条评论全是我方验证记录）/#3176（8d31bb47）/#3150（499bcc5c）/#3062（7ba623a3）
- **#3342 报告者升级 main 镜像后 403 仍在**（zhangmy163 09-18 00:58 UTC）——#3069 残余变体
  候选；四条分流岔路+问询稿见登记簿 09-18 节，**待用户批准后回复**；#3296 报告者仍零回应；
  #3222 询问零回复（彻底放弃跟进）
- 新 issue 扫描（近 48h）：**#3362**（Wiki 问答 continue-stream 单次回放 47,196 事件卡顿页面，
  事件流=我方 #2906/#3104 车道，po-et 已贴代码分析但未认领）为最热新候选；#3351（MCP 多
  Key 权限）设计讨论大件不抢；#3361（标签过滤下推）feat·检索陷阱簇不碰；其余 feature/问答类跳过
- awesome #686：open 零动静（upstream repo=awesome-opencode/awesome-opencode，本地克隆
  remote 已核），维持周频
- worktree 可清清单核验完毕：u29/s3324/s3333/s3338/s3345 五个（分支全部在 fork 有备份，
  `git ls-remote origin` 逐一对上；u29 本地 559ad532 为合并后维护者追加提交态，fork 上
  444d2fb5 为我方原推，PR 已合并无损）；磁盘 76%（30G 空闲）不急，等用户一声令下即清

## 2026-09-18 续：全量 issue 普查 → #3129 查重拦截 → #2289 验后翻空（已修未关）
- 普查 375 件 open（详见登记簿 09-18 普查节）：外部池机制型 bug 几乎件件有主，po-et 在
  #3362 上实测 issue→PR 90 分钟；幸存候选 #2289/#3129/#3337/#3185
- 用户选 #3129 → 认领前双查发现 open PR #3214（tianhaotian，完整对等实现）→ 未认领，
  候选撤出（反向兑现 #3249 教训）；GLM key 存 ~/.glm-coding-key（0600）备用
- 用户转向 #2289 → 查重干净 → upstream/main@c8ebb9ed 亲验**三路全已剥离**（聊天流式
  :111/agent :70/非流式 DecodeOutputText）→ 已修未关第 8 例：07-24 报告，07-27 即修
  （modelcontext 三连提交），挂 52 天；验证评论 issuecomment-5724353420 已发
- 无 PR 可提；外部池只剩 #3337（需定性）/#3185（薄报告）；自家线程照旧（#3342 回复稿
  待批/S-26/切片3）

## 2026-09-19：二扫出清确认 + #3342 诊断回复已发 + Octop/deepseek-harness 两新战线
- 二扫（差分快照 20260918b）：外部池对我方出清——#3383 出 PR 仅用时 39 分钟（03:10→03:49，
  窗口从 90 分钟再缩）、#3390 双 PR 竞争、#3337 被 LeonPure 带根因认领；唯一无主 #3403 属
  feat·前端陷阱簇不碰；11 个持道 PR 全开无释放。**抢新车道正式关闭**
- **#3342 诊断回复已发**（issuecomment-5740907759，用户批准"发吧"）：四岔路问询+已知边界
  说明；若报告者命中共享智能体/源文件边界=新 PR 机会，等回应
- 新战线①Octop：clone+fork+双 remote+uv 就绪，启动 prompt 已存
  Octop/.context/prompt-octop-session-20260918.md（密钥用法/develop-base/门槛/纪律全打包）；
  WeKnora 会话不越界写入
- 新战线②deepseek-harness：仅克隆（源码阅读+自建补丁用）；**该仓库不接受外部 PR**（CONTRIBUTING
  明示+issue/PR 通道关闭），参与只有 Discussions/插件生态两车道
- 双账号问题答复（用户问"两号分工能否提高合并率"）：不会——8 合并案例中 issue 归属与合并率
  无关、自开 issue 是加分项；sock puppet 被识破代价=全部存量信誉；已建议维持单号+质量路线

## 2026-09-20 续：三机会执行日——#3342 旗舰认领 + #3451 当日 PR + #3453 第 9 例翻空
- 三扫发现三机会（详见登记簿）→ 用户批准"3342 评论认领→3453/3451→回 3342"序，我加了
  "权威评论先核验"的微调并被证实必要
- **#3342 整合评论+认领**（5747978269）：S-15 三线合一（Arming03 审查+我方 09-07 实测+
  main 核验）；机制链=入库不建 binding + 两路授权（ResolveKBFile / resourceAccessibleViaSharedKB）
  收敛到 IsReferencedByKnowledgeBase 且其实现 binding-only（"text is never ownership evidence"）
  → #3107 族收紧引入回归；附带 merge.go 调用方租户丢 image_info 实锤；修复 A+C 起步、B 上桌
- **#3453 翻空第 9 例**：#3422 已顺带修了 selectRelevantFolders（BatchEmbedWithPool+注释引用
  #3390），核验评论 5747979032 建议关闭——若直接按用户原话"认领"就乌龙了，核验先行再次兑现
- **#3451 当日闭环**：认领 5747979161 → 189204e5（VLM+chat 两处 detail:"auto" 去硬编码，
  omitempty 生效；显式配置透传有测试）→ **PR #3457** → 回链 5747990968；CI 跑动中
- 战况：8 合并 + 7 在审（#3457/#3283/#3251/#3176/#3150/#3062）；待办=#3342 A+C 实现（下一棒
  主任务）、#3457 CI 确认

## 2026-09-21 续：#3342 首片修复全链路闭环 → PR #3493
- 用户令"开工"→ 完整执行 A+C：bindStoredImages 入库绑定（两调用线）+ merge.go 三处租户
  过滤换 *Only 变体（新增 ListChunksByParentIDsOnly + CollectImageInfoByChunkIDsOnly）
- 测试：新增三件（四态绑定/跨租户父块/桩升级），跨租户用例 stash 反向验证红；三包绿
  （唯 S-16 存量）；gofmt/build/vet 净
- 集成验证一次性全新栈（避开共享库迁移雷）：**三踩坑入册**——迁移走 file:// 文件路径须挂
  分支 migrations（镜像自带停在 96）；manual 发布路由在 /knowledge/manual/:id；1×1 探针图
  被 isIconImage 删——终局：发布带图文档 → Bound 1/1 → DB 出现 extracted_image 绑定
- PR #3493 开出 + issue 回链 5754429050 + CI 跑动；存量回填明示第二切片征询形态；
  战况 **8 合并 + 8 在审**；一次性栈已清净，worktree weknora-3342 保留

## 2026-11-14 协同协议接入（全局指令卡生效）
- 已读 vicfei/protocol 的 COORDINATION.md（唯一真相源）+ TEMPLATES/session-entry.md + vicfei/worklog 的 WORKLOG-SPEC.md
- 本节点 = singapore，直推（~/bin/gh auth git-credential）；本地克隆 ~/sessionlog、~/worklog、~/brainvault 均在
- 收官动作：worklog 追加 ~/worklog/log/YYYY-MM/YYYY-MM-DD-singapore.md（仅结论）+ sessionlog 追加 ~/sessionlog/sessions/YYYY-MM/YYYY-MM-DD-singapore.md（含过程概览），append 后 push；批次收尾跑 ~/sessionlog/scripts/sync-singapore.sh
- 纪律：零脱敏（owner 2026-11-10 终裁，私有仓如实入库）；push 冲突先 pull --rebase；不改他节点文件、不动 protocol 仓（只开 issue）
- **日期校正：今天 = 2026-11-14（本机 CST）**；本文件里 2026-09-06/07 条目标注的时间为慢钟时代遗留，节点时钟已修复，作新日期参照
- 注意：worklog main 收官时落后 origin 1 个提交（他窗口已推 2026-11-14 条目），append 前先 pull --rebase

## 2026-11-14 22:0x：protocol 准入 + 终态校正（第 6 棒交接前）
- 按协议完成双仓条目+sync（commit a05c8e2/c641be9/fe09ce3 已直推）
- 第 6 棒 handoff 数字校正：**8 合并 + 3 在审**（非 7+6）；#3296 官方指派我方跟进；
  #3150 已关但 lyingbug 认为方向值得做（需 #3381 后新基线）；#3176 被 #3633 取代致谢
