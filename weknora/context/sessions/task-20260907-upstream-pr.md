# 任务：上游回馈 PR 工作台（来自上海节点第 4 棒，2026-09-07）

## 一、你是谁、材料从哪来

你是新加坡节点：团队的 GitHub 网关、官方库（Tencent/WeKnora）跟踪器和 PR 工作台。本任务材料由上海节点（开发/评估节点）第 4 棒准备，已完成交接传输：

- **核心材料**：`~/WeKnora/.context/upstream-issues-register-20260907.md`（12 项官方库问题的登记簿，按上游 PR 候选优先级排序，每条附证据/建议修法/可行性评级/fork 处置状态）
- **git 源**（权威版本）：远端 `kbpaamc/feature/weighted-ranking` 分支，`docs/upstream-issues-register.md`，提交 5837b0d6（已 fetch 到本地）
- 支撑证据（按需向上海要）：评测报告数字在 `:5173/report-weighted-ranking-v1-100.html`（fork 域名，issue 里转述数字即可，别贴内网链接）

## 二、要做什么

把登记簿里的候选项按**文末顺序**回馈官方库，走"**先 issue 后 PR**"两段式：

1. **复现确认**：每个候选项先在本地 `upstream/main` 上复现/核实（登记簿证据来自 fork 环境，行号以 upstream/main 为准重新定位；复现不了的降级或退回）。
2. **开 issue**：对确认的候选项在 `Tencent/WeKnora` 开 issue（英文，标题简洁，正文引用登记簿的证据与影响；U-01 附评测数字：接入 rerank 后检索金标 top3 70.5→83.2、top5 77.0→90.3、EM 47.0→53.1，100 题池模式配对实验）。
3. **提 PR**：maintainer 认可（或 issue 挂 48h 无异议）后，**从 upstream/main 切修复分支**提 PR，提交到 `vicfei/WeKnora`（origin fork）再向上游发 PR；每项一个独立 PR，不带任何二开 flag/kb-routing/请求级开关代码。

## 三、顺序与预期产出

| 序 | 候选 | 性质 | 验收产出 |
|---|---|---|---|
| 1 | U-03 排序公式双路径重复（chat_pipeline/rerank.go vs agent/tools/knowledge_search.go） | 纯重构热身，零行为变更 | issue + PR |
| 2 | U-10c 工具栏图标无 aria-label | 纯增量，理想首 PR | issue + PR |
| 3 | U-02 混合检索单路分数不归一（复合分饱和） | 小修 + 单测 | issue + PR |
| 4 | U-01 chat 链路从不接 rerank 模型（旗舰，行为变更） | 见下方特别纪律 | issue（先讨论开关方案）→ PR |
| 5 | U-05 embedding 批量无退避节流 / U-07 会话标题抢答无校验 | 标准修复 | issue（视 maintainer 反馈决定 PR） |

其余（U-04 SSE 不收尾、U-06 降级无标记、U-08 前端白名单、U-09/11/12）按登记簿标注处理：先定位/先讨论/记录在案，不急于 PR。

## 四、纪律（血泪教训，必须遵守）

- **分支卫生**：修复分支一律从 `upstream/main` 切出；先 `git fetch upstream` 确认最新；PR 描述里写明 fixes #issue。
- **U-01 特别纪律**：这是默认行为变更（默认开 rerank 会增加每问一次模型调用），PR 必须带开关方案（建议复用/新增全局配置项）并在描述中说明成本；maintainer 有异议就停在 issue 阶段。
- **不回馈清单**：fork 的请求级开关体系（enable_weighted_ranking/rerank_model_id/enable_kb_routing）、kb-routing 特性本身、评估工具链——这些是二开资产，不是上游修复。
- **密钥自查**：任何提交前 `git diff` 过一遍，无 token/key/内网地址；origin 是公开 fork。
- **结论必须实测**：issue 里写的行号/复现步骤必须你在 upstream/main 上亲手验过，不照抄登记簿行号（fork 与 upstream 可能有偏移）。
- **进度留痕**：每完成一项，在本文件同目录 `progress.md` 追加一行（日期/候选项/issue 或 PR 链接）；全部完成或卡住时，在 `.context/sessions/` 写 handoff 文档并把结果回报给人类用户（三节点信息总线）。

## 五、开始动作

1. 读 `~/WeKnora/.context/upstream-issues-register-20260907.md` 全文；
2. `cd ~/WeKnora && git fetch upstream && git log upstream/main --oneline -3`（确认官方库当前 HEAD，检查与 fork 基线的偏移）；
3. 从 U-03 开始。
