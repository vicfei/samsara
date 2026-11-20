# 双宿主对照实测：dsh vs opencode（同一 WeKnora 知识库 + 同一模型）

> 作者：新加坡节点 2026-09-09（第 5 棒研究窗口）。配套：dsh-plugin-architecture.md（宿主架构深潜）、
> opencode-plugin-deepdive.md（我方插件开发记录）。原始数据在 /home/ubuntu/dualhost-lab/results/
> （deterministic.json / real.json，不进仓库）。实验对象：dsh@0.1.2-rc.1 headless（官方插件
> @wxg-prc-cpg/dsh-weknora@0.1.0）vs opencode 1.18.29 run（我方插件 opencode-weknora@0.1.0，
> npm 缓存版）。WeKnora=本机官方实例（bocha 补丁镜像）+ 测试租户 10017 单 KB 单文档
> （phoenix-ops.md，4 chunks，含种入事实：暗号 AURORA-7-9F2C / 回滚 SLA 45 分钟 /
> 发布窗口 周二四 02:00–04:00 UTC / PagerDuty·Phoenix-oncall / phoenix-consistency-audit）。

## 0. 实验设计（两条轨道）

- **确定性轨道**：本地假模型服务器（OpenAI 兼容 SSE，脚本化策略 search→read→用检索结果作答，
  范式取自上游 packages/dsh-weknora/test/e2e/fake-model.mjs），逐字节记录每个宿主发给"模型"的
  请求。两宿主同一假模型 + 同一真实 WeKnora + 同一任务 → 测得的是**宿主管线开销**而非模型差异。
- **真实轨道**：qwen3.8-max（dashscope），6 个任务 × 双宿主，从各宿主存储提取工具序列与
  token 用量（dsh：~/.dsh/sessions zstd 日志 + storages 投影；opencode：opencode.db）。
- 公平性控制：同 API key 同 KB 同模型同任务文本；双方插件工具同名（weknora_*）同描述同渲染。

## 1. 结论速览

1. **两个宿主都能可靠地把 WeKnora 检索能力用好**：真实轨道 12/12 通过（6 事实题答案全对且含
   ground-truth 数值 + 缺席探针题双方都明确答"没有"未幻觉）。插件/工具面质量不是差异来源。
2. **模型可见上下文的体量差一个数量级**：确定性轨道同任务下，opencode 发给模型的系统提示
   40,824 B vs dsh 4,499 B（9.1×），首请求总消息体 41,966 B vs 5,144 B（8.2×），且每轮重发
   全部工具 schema。这是两宿主**每 token 成本与上下文预算**的核心差异，对长会话影响放大。
3. **工具面策略差异显著**：dsh 单轮纪律性强（真实轨道平均 1.7 次工具调用/题，多为 search→read
   标准链）；opencode 更发散（平均 3.2 次，出现重复搜索、先 bash 探路等）。发散不损正确性，
   但推高时延与 token（真实轨道总耗时 dsh 193.6s vs opencode 244.5s，1.26×）。
4. **weknora 工具结果文本在两端几乎逐字节一致**（确定性轨道 search 结果渲染 1,439 vs 1,441 B；
   read 2,778 = 2,778 B）——官方 dsh 插件与我方 opencode 插件对同一 API 的渲染收敛，说明
   "把什么文本交给模型"这个决策双方已趋同。
5. 附带工程发现：opencode run 在此环境**必须伪终端（pty）**才能执行任务（无 TTY 时静默
   exit 0 不建会话，本窗口踩坑约 1 小时）；其模型解析只认 models.dev 目录中存在的模型 id
   （自定义 provider 下用 qwen3.8-max 可解析，scripted/deepseek-v4-flash 形态均失败），
   且每轮把全部 40 个工具（含 17.9KB 的 skill 描述与 LSP/MCP 工具）重发给模型。

## 2. 确定性轨道明细（假模型，同策略）

| 指标 | dsh | opencode | 倍率 |
|---|---|---|---|
| 模型请求轮数 | 4（3 主循环 + 1 标题生成小请求 573B） | 3（--title 免标题请求） | — |
| 墙钟 | 1.95 s | 7.16 s | 3.7× |
| 系统提示 | 4,499 B | 40,824 B | 9.1× |
| 首请求消息体 | 5,144 B（sys 4,499 + user 51 + user 466） | 41,966 B（sys 40,824 + user 53） | 8.2× |
| 工具数量 | 30（weknora 4 + 原生 26：bash/edit/read/…） | 40（weknora 4 + 原生/LSP/MCP/第三方插件 36，其中 skill 工具描述 17,868B） | 1.3× |
| weknora_search schema | desc 498B + schema 532B | desc 498B + schema 615B | 描述相同 |
| 轮次消息体增长 | 5.1→10.1 KB（回放历史） | 41.9→46.9 KB（sys 恒定 + 结果追加） | — |
| search 结果文本 | 1,439 B | 1,441 B | 1.000× |
| read 结果文本 | 2,778 B | 2,778 B | 1× |

读数解释：
- dsh 标题生成走独立小请求（sys 363B）——不占主上下文；opencode 用 --title 参数跳过（若不加，
  也会发小请求）。两宿主皆有"标题子代理"成本，均可免。
- opencode 的 40 个工具每轮全量重发（~2.3KB×40 的 schema+desc 在 messages 之外的 tools 数组），
  是 token 大头之一；dsh 同样每轮重发 30 个，但体量小（其工具描述更精简）。
- 差异来源不是 weknora 插件：两插件同名同描述；差异是**宿主自带工具面与系统提示**（opencode
  的 skill/任务/MCP/LSP 工具、巨型 skill 描述；dsh 的精简 code-runtime 提示）。

## 3. 真实轨道明细（qwen3.8-max，dashscope，6 题）

| 题 | 内容 | dsh 工具序列 | oc 工具序列 | 双端正确性 |
|---|---|---|---|---|
| T1 | 暗号 | search→read_document | search→search | 双 PASS（AURORA-7-9F2C） |
| T2 | 有哪些知识库 | **list_knowledge_bases** | **list_knowledge_bases** | 双 PASS |
| T3 | 发布窗口原文 | search→read_document | search×2→read_document | 双 PASS |
| T4 | 监控告警综合 | search→search→read→search | search×3→read | 双 PASS |
| T5 | 北极星预算（缺席探针） | search×3→list→read→search | search×2→list→search×2 | 双 PASS（均答"没有"，无幻觉） |
| T6 | 回滚校验任务 | bash(ls)→search→**read 本地文件** | search→bash→**read 本地文件** | 双 PASS（值对） |

时延与用量（真实轨道；opencode 列含 pty 渲染开销）：

| 题 | dsh 墙钟 | oc 墙钟 | dsh token(未缓存入/出/缓存读) | oc token(入/出/缓存读) |
|---|---|---|---|---|
| T1 | 21.4 s | 31.8 s | 12,124 / 670 / 17,920 | 2,867 / 391 / 54,272 |
| T2 | 12.5 s | 15.7 s | 467 / 304 / 17,408 | 1,169 / 214 / 54,272 |
| T3 | 28.2 s | 53.1 s | 3,339 / 889 / 26,624 | 5,511 / 496 / 82,944 |
| T4 | 61.8 s | 64.0 s | 5,681 / 1,966 / 39,936 | 6,591 / 1,011 / 83,968 |
| T5 | 45.4 s | 45.1 s | 7,301 / 1,224 / 50,688 | 4,535 / 496 / 111,872 |
| T6 | 24.3 s | 34.8 s | 3,781 / 619 / 27,136 | 4,294 / 493 / 82,944 |
| Σ | 193.6 s | 244.5 s | 32,693 / 5,672 / 179,712 | 24,967 / 3,101 / 470,272 |

读法（同模型同知识库，成本差只能来自宿主）：
- **总墙钟 dsh 快 1.26×**，主要差在 T1/T3/T6 的链式任务（opencode 多发 1-2 轮请求）。
- **输出 token 双端同量级**（dsh Σ5.7K vs oc Σ3.1K，因 oc 平均轮数多但每轮输出短）。
- **缓存读 token oc 是 dsh 的 2.6×**（470K vs 180K）——40KB 系统提示 + 全量工具每轮都进
  缓存（dashscope 按缓存读计费时这是实打实的成本差）；dsh 的 4.5KB 提示缓存占用小得多。
- T5 缺席探针两宿主都做了多轮检索+枚举（读全库确认"没有"），正确且诚实；dsh 把证据写进答案
  （引用 score≈0.26-0.28 的相关性），opencode 以多轮搜索表达。

**实验工件告警（T6 失真）**：两宿主 cwd 都是 dualhost-lab，目录里躺着 phoenix-ops.md 源文件；
T6 上两宿主都先 bash ls 发现它，然后绕过 WeKnora 直接 read 本地文件作答。答案内容同源所以
仍正确，但 T6 的工具序列不代表真实 KB 检索路径。后续实验应将 cwd 换成无源文件的净目录。

## 4. 工程发现（opencode run 在本机的坑，均有复现证据）

1. **无 TTY 静默空转**：execFile 直跑 `opencode run` 在本装（1.18.29）下时而静默 exit 0（不建
   会话、零输出），时而进 loop 后报错；`script -qec "opencode run ..."`（伪终端）后稳定执行。
   历史 dashscope/deepseek 会话全部来自 TUI 交互，与此一致。排障 1 小时才定位。
2. **模型解析目录限定**：`Model not found: <provider>/<model>` 反复出现；实证可解析的形态 =
   模型 id 存在于 models.dev 缓存（~/.cache/opencode/models.json，213 providers，**无
   dashscope**）且经自定义 provider 声明同名模型（dualhost/qwen3.8-max 可跑；scripted、
   deepseek-v4-flash 覆盖形态失败）。真实 dashscope 流量 = 自定义 provider 的
   npm=@ai-sdk/openai-compatible + options.baseURL=https://dashscope…（qwen key 复用
   opencode-weknora-test 配置字面量，已实测有效）。
3. 残留 opencode 进程会锁死后续 run（孤儿进程致其余 run 空转）——实验前必须清进程。

## 5. 对我方插件的启示（opencode-weknora 迭代方向）

- **描述已收敛**：官方 dsh 插件与我方插件的工具描述/渲染文本几乎逐字节一致，说明 0.1.0 的
  描述策略（检索优先、ask 兜底）已是生态共识，无需大改。
- **省 token 机会在宿主侧不在插件侧**：opencode 单轮 ~43KB 上下文中我们插件只占 ~3KB
  （4 工具 schema+desc）。若想为 opencode 用户降本，可建议其关掉无关插件/agent 或给
  opencode 官方提"工具 schema 增量下发"的 feature request——这是宿主级优化。
- **T5 行为启示**：缺席问题的多轮搜索是模型对"找不到"的低置信表达；插件可在 search 空结果
  时渲染"0 hits + 已搜范围 + 建议换措辞"提示（dsh 插件已有 describeScope 输出），我方
  opencode 插件 search 渲染同样有此信息（'Nothing in WeKnora matched…'），实测有效。
- **read 本地文件捷径**（T6）暴露检索链路一个产品缺口：编码 agent 在本地已有源文件时会绕过
  KB 阅读——这正是"私有知识进编码上下文"场景的真实形态，值得在文档中把 weknora_ask 的
  描述往"库内版本与本地文件可能不同步"上再拧一拧。

## 6. 方法与可复现性

- 假模型服务器 + 驱动：/home/ubuntu/dualhost-lab/{fake-model.mjs, run-deterministic.mjs,
  run-real.mjs}（含测试租户密钥的 secrets.env 不随报告分发；租户 10017 清理后需重建）。
- 取数路径：dsh 会话 zstd 日志（tool/call、request/context）+ session_projcache tokenUsage
  投影；opencode.db（session 按 --title 定位，message.data 带 tokens 明细）。
- 局限：单模型（qwen3.8-max）单 KB 单文档；每任务单次运行（无重跑取均值）；T6 受本地文件
  捷径污染；dsh 标题生成小请求计入确定性轨道轮数但真实轨道用默认（其 session/title 事件
  显示 dsh 真实轨道也发了标题小请求，未计入上面 dsh 用量口径外的成本）。
