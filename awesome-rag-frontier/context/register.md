# Awesome-RAG-Frontier 工作登记册（append-only）

> 跨会话延续用，不入库。新条目只追加在文件末尾，不改历史条目。

## 2026-09-27
- 仓库创建并首推（f932940）：40 条目、双语 README、criteria.md、周更自动化（refresh.yml = update_projects + arxiv_digest 两个脚本）、news/2026-09 创刊。
- workflow_dispatch 首触发 CI 全绿，frontier-bot 自动提交链路打通。
- LICENSE 署名 Chen Fei 2026（与 WeKnora 贡献记录构成身份链）。

## 2026-09-27/28（续）
- Radar 机制落地：RAG×Agent Skills 浪潮 5 条（radar.json、双语表格生成、criteria 补规则）。
- parsing 补 markitdown（187k★）与 firecrawl/anydoc（22k★，WeKnora 内置解析器即此库）。
- 教学类补 3：ai-engineering-hub 38k / llm-universe 14k / llm-zoomcamp 7.4k；确立课程收录线（RAG 须为主线），有意排除 120k/83k 通用课程并写入 criteria。
- awesome-lint 合规（徽章/TOC/star-history）；首份 arXiv 草稿精选 3/5 入 Frontier 2026（裁决理由回写草稿）。
- 企业落地实践节上线（4 条一手案例，链接逐一验证）。
- 核查矩阵完成（7 清单 × 4 项目 grep：WeKnora 0/7、PixelRAG 0/7）；发布套件在 /home/ubuntu/Awesome-RAG-Frontier-launch/（article-zh/en + launch-checklist.md）。

## 2026-10-08
- 决策层浪潮入库：新类目 decision-layer（laya 31.7k / kev 8.7k / SemIf-OpenJev 4.7k / AnyJev 1.1k 诺基亚出品），雷达 +2（hotchpotch/jev-reranker、aifabrice/jev-rag），news/2026-10 开篇。
- 重要教训：Jev 初判"疑似幻觉"是错的——9 个点名仓库全部存在，决策专用模型为真实浪潮（TypeSafe，Noul/Choice/Score 三原语）。基准数字未独立复现，不传播。
- 周一例行刷新多次自动触发（cron 生产验证）；一次 rebase 冲突以"以 data/*.json 为事实源重跑生成脚本"化解。

## 2026-10-09
- github_sweep.py 上线：每周扫近 14 天 RAG 新仓库（3 组关键词、≥20★、排除已收录），refresh.yml 第三步。首跑 9 候选在 news/_drafts/github-sweep-2026-10-09.md，待用户裁决（雷达/主表/均不收）。
- 采纳节点规范 /home/ubuntu/PROMPT-github-token-usage-20261006.md：正式变更走 issue → PR → 等用户指示 merge（merge commit 不 squash）→ 清分支；直推 main 仅限微小修正；对外内容双铁律（禁 AI 署名、去 AI 味）；PAT 纪律与单一 HTTPS 凭据通道。
- 本登记册同日建立并回填。

## 2026-10-09（续）
- 首次走节点规范的完整闭环：issue #1（sweep 裁决：3 收雷达 / 6 拒）→ 分支 curation/sweep-2026-10-09 → PR #2（Closes #1）→ 用户授权下由 agent 合并（merge commit 9666129）→ 双端删分支。雷达现 10 条。
- 经验：issue/PR 正文 JSON 一律 python 生成完整文件，不做 sed 后处理（首次尝试因此 400）。
- 经用户授权创建 vicfei/vicfei 个人主页仓库（public，README 含 WeKnora rank#17 与本仓库导流）；贡献者事实经 API 核验：WeKnora 第 17 位属实、Octop 前 100 无记录故不写。待用户 UI 操作：pin 仓库、og 预览图。
- 主页补充 deer-flow 贡献：commits?author=vicfei 证实 1 个已合并 commit（PR #6463，邮箱 cnfeichen@163.com 关联本账号），contributors 前 100 不含（1 commit 排名靠后）；PR #6464 关闭未合并，仅写已合并项与 bug 报告。
- 主页贡献条目按用户指示模糊化：deer-flow/Octop 只写 contributor。Octop 核验底细：commits?author=0（合并提交邮箱未关联账号），但 PR #1336 已合并、另有 #1228 等 5 个在途 PR 与 bug 报告——contributor 口径成立。WeKnora 保留 rank #17 精确口径。

## 2026-10-10
- 更正 2026-10-09 登记"Octop commits?author=0 系合并提交邮箱未关联账号"——此机制解释错误，经复核：邮箱 cnfeichen@163.com 已关联 vicfei（squash 提交 aef21910 的 author.login=vicfei）。真因：commits API 默认只查默认分支 main，而 #1336 合入 develop（当前领先 main 84 个提交）。下次发版 develop→main 后，commits 计数、contributors 名单与主页徽章将自动出现，无需任何操作。
- 最短自证路径存档：`is:pr author:vicfei is:merged` → #1336；`commits?author=vicfei&sha=develop` → aef21910。另一会话提示本地 Octop 检出分支已变为 feat/bocha-search-plugin（非本会话工作区，不动）。
- 用户拍板 C+1：选型观察做成仓库章节 + 第二波文章，发布日照常。已走闭环 issue #3 → PR #4 → merge（8fcae66）：双语「知识路由」章节上线（素材×查询路由表 + 五原则 + 浪潮关联），TOC 更新。第一篇文章（article-zh/en）补入决策层二次检验与最新数字；第二篇（article2-zh/en）选型框架草稿完成；launch-checklist 增补第二波计划与发帖铁律自查。待用户：周二（10-13）发布。
- 方向调整：用户明确推广暂缓，优先充实仓库内容。闭环 issue #5 → PR #6 → merge（c4f1b4a）：企业落地实践 +4 条带出处与性质标注（袋鼠云/OODER/达观/腾讯ADP）；新增双语「知识形态」章节（引《从 RAG 到知识编译》微信原文，用户提供链接确认）；docs/enterprise-kb-playbook.md 完整中文手册（EN 摘要 + 8 条编号引用 + 开放问题）。微信文章=G5_XI7ZgCoyrfZGx6cEcow 即用户贴的《知识编译》全文；gm7.org 持续 502、sgpjbg 403 不收。
- 主页补工作履历（用户提供）：2017-2022 中电科38所 / 2022-2024 兴业银行金融科技研究院 / 2024-2025 智谱 / 2025-2026 平安资管。仅写单位+年份，未添加岗位描述（避免杜撰，用户可自行补充每段的角色一句话）。
- 全办三件事完成：① jev-rag-zh-benchmark 经 API 补 MIT LICENSE（commit 27ec0b9，GitHub 识别 MIT）——该仓库疑似另一会话所建，未动其工作副本；② 闭环 issue #7 → PR #8 → merge（e87b915）：雷达 +1（首个中文 Jev 独立复现，条目带维护者披露），news/2026-10 新增 10-12 条目，caveat 升级为"中文复现已有、英文仍缺"；③ 本日恰为周一（10-12），例行刷新再触发（8b94c63），PR 又撞车，照例以数据重生成化解。注意：今晨 sweep 产出新草稿 news/_drafts/github-sweep-2026-10-12.md 待用户裁决。
- 周裁决积压清偿（用户委托裁决权）：四份草稿 40 候选一次裁决。闭环 issue #9 → PR #10 → merge（0b7304a）。论文 7 篇入 Frontier 2026（Stale-Document Poisoning/Reasoning-Language Alignment/DBRAG/UNREAL/Agentic AutoRAG/Placebo 结构消融/RIT-RAG），仓库 1 个入雷达（IHMT-MEMORY，纯文件树 Agent 记忆），其余 32 条全部拒绝并回写理由；10-09 已拒的重复候选按原判维持。观察名单留了两条（Matryoshka、PRIME）。雷达现 12 条，Frontier 2026 现 11 篇。
