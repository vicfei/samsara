# Octop 会话任务：为 Octop 接入 bocha / 豆包（火山）网络搜索（2026-09-21）

## 你是谁、要做什么
你是新加坡节点上 Octop 项目（/home/ubuntu/Octop）的 ZCode agent。任务：把 bocha（博查）和/或
豆包（火山 feedcoopapi）网络搜索能力接入 Octop，方法论完整借鉴同机 WeKnora 项目已合并的
两个 provider 实现（bocha=WeKnora PR #3036、doubao=PR #3251 在审）。两个密钥都由用户持有，
到达真实 API 验证阶段时向用户索取。

## 最重要的纪律：WeKnora 资产只读、跨项目不混写
- 参考实现（只读，勿改勿推）：
  - /home/ubuntu/weknora-bocha（分支 bocha-web-search）→ internal/infrastructure/web_search/bocha.go + bocha 测试
  - /home/ubuntu/weknora-doubao（分支 feat/doubao-web-search）→ internal/infrastructure/web_search/doubao.go + 测试 + 六接线点全套
  - 深潜文档：/home/ubuntu/WeKnora/.context/research/bocha-provider-deepdive.md
    （wire format 实证、与 13 家官方 provider 对照、六层验证矩阵）
  - 经验档案：/home/ubuntu/WeKnora/.context/upstream-issues-register-merged-20260907.md（bocha/doubao 各节）
- 登记写 Octop 自己的 .context/octop-register-20260918.md（追加式）；绝不写 WeKnora 的 .context。

## Wire format 速览（实证过的事实，细节以参考实现为准，先读代码再调 API 省钱）
**bocha**（https://api.bochaai.com/v1/web-search，Bearer）：
- 成功响应：**数字型** `code:200` + `data.webPages.value[]`（Bing 兼容：name/url/snippet/summary/
  datePublished 带时区偏移/dateLastCrawled）；`summary` 是 AI 摘要，优先作 snippet
- **错误响应是另一套形态**：字符串型 `code:"401"` + `message` 字段（不是 msg/code:int）——
  解析必须容错双形态，否则真实 401 会丢细节甚至 Unmarshal 失败（WeKnora 首版就栽在这里）
- freshness=日期区间过滤 "YYYY-MM-DD..YYYY-MM-DD"；响应上限 4MB；约 ¥0.03-0.04/次（带摘要）
**doubao**（火山 feedcoopapi，Bearer JSON）：
- 优势：服务端日期区间过滤（time_range "YYYY-MM-DD..YYYY-MM-DD"）+ markdown 全文（Content，
  7-17k 字符）+ 每结果 ISO 发布时间（+08:00 时区正确解析）；need_content 默认开；约 ¥0.02/次
- 集成时注意 WebSearchResult 字段直映：Content(markdown)/PublishTime 直映，几乎零变换

## 第一步：发现 Octop 自己的搜索架构（等价于"现状核验"，先做再做任何设计）
1. `cd /home/ubuntu/Octop && make install && make install-hooks`（首次，重活）
2. 摸清 Octop 现有网络能力：读 README/AGENTS.md §5 模块边界 + grep src/octop/ 里
   web/search/connector 相关模块（大小写不敏感 grep！WeKnora 的血泪：大小写敏感 grep 漏掉
   常量名接线点）。Octop 有 Connector 生态（腾讯系 Docs/We博/News）+ MCP 网关 + plugins/ 体系
3. 判定集成形态：若已有 web search provider 注册表 → 照既有 provider 模式加两家（黄金路径）；
   若没有 → 评估"新建 web_search 工具/connector" vs "做成独立 plugin"（plugins/ 有 demo 可参照），
   **形态结论先向用户汇报再动手**
4. 列出 Octop 侧的全部接线点（WeKnora 是 6 处：类型常量+元信息表/服务层双 switch/container
   注册/前端联合类型/swagger 三文件/网站文档——Octop 的等价物自己找全，用 grep 验证每一处）

## 开发方法（WeKnora 门禁四步，全部过才 push）
1. **单测全绿**：请求形态/字段映射/校验矩阵/HTTP 错误/空 time_range——照参考实现的测试用例移植
   （bocha 双形态错误、doubao 零值陷阱：直构结构体会绕过构造器致 needContent 零值，必须显式传参）
2. **适配器级真实 API 验证**（拿到 key 后）：先验真实错误路径（错 key → 401，bocha 预期
   "Invalid API KEY" 文案），再验 happy path（3 条结果、日期窗过滤生效、时区解析）；
   成本预算告知用户（bocha 两次约 ¥0.07；doubao 每次 ¥0.02）
3. **本机集成验证**：起本地 Octop（make dev），真实建配置→真搜→看结果进对话；若加 UI 配置面，
   **必须 UI 走查**（WeKnora 教训：动态表单只有 select 分支，text 字段渲染不出输入框——
   API E2E 全过 ≠ UI 可用）
4. 全过才 push；对外开 PR 需用户点头

## 密钥纪律（血泪规矩）
- key 由用户在验证阶段提供：经 0600 文件中转（如 /home/ubuntu/.bocha-key、/home/ubuntu/.doubao-key，
  仓库外），命令内读进环境变量引用，**绝不打印/回显/落仓库/进 git 历史**；用后按用户指示删留
- 拿不到 key 时：错误路径用假 key 打真实端点（bocha 401 不扣费）；happy path 明示"未验证"再交付

## Octop 贡献规范（与 WeKnora 不同处，全部硬性）
- **feature PR 的 base 是 develop 不是 main**；分支从**新 fetch 的 upstream/develop** 切
  （git fetch upstream && git switch -c feat/xxx upstream/develop）
- ship bar：后端 `make all`；动前端 `make check-all`；pre-commit 强制
- 测试一律 `uv run pytest`；ruff 风格；CI 跑 Linux+Windows 双平台（tmp_path/pathlib、posix_only）
- 用户可见行为变化 → 更新 CHANGELOG.md
- AGENTS.md：最小 diff、不顺手清理无关代码、说"完成"前给验证证据

## 流程顺序与边界
现状核验（上述第一步）→ 形态结论报用户拍板 → 实现+单测 → 真实 API 验证 → 集成+UI 走查 →
push fork →（用户点头后）向 upstream/develop 开 PR。中断恢复：状态都在磁盘/GitHub，先查
Octop/.context 登记簿再续。每完成一环即追加登记。
