# WeKnora 原生 Agent 调研报告（调研 B · 对应 R4）

> **日期**：2026-08-24 ｜ **方法**：只读源码（全部结论有 file:line）+ 专用实验库实测（§8）
> **用途**：决定阶段四（Agent 合规审计）立项范围。代码事实与推测分开标注。

## 一句话结论

**执行链路和工具编排成熟（ReAct 循环、40+ 工具、MCP 审批、上下文管理），但"合规审计三件套"基本缺失：token 用量零落盘（❌）、smart-reasoning 引用非结构化（⚠️）、Agent 配置无快照（⚠️）；结构化输出与敏感词拦截原生不存在（❌）。**

---

## 1. 执行链路（代码事实）

`POST /agent-chat/:session_id` → `handler/session/qa.go:817 AgentQA` → `:855 executeQA`（先落 user/assistant 两条 messages，assistant `IsCompleted=false`）→ SSE setup（`:928`，发首个 `agent_query` 事件 + 事件总线）→ 异步 `sessionService.AgentQA`（`session_agent_qa.go:20`：buildAgentConfig → LoadAgentHistory → CreateAgentEngine）→ `agent/engine.go:196 Execute`。

**ReAct 循环**：`engine.go:387` `for state.CurrentRound < config.MaxIterations`；单轮 `runReActIteration`（`:458`）= think（流式 LLM，`think.go:29`）→ analyze（停止判定，`observe.go:211`：自然停止/content_filter/工具空转）→ act（工具执行，`act.go:215`，支持 errgroup 并行）→ observe（结果回写+上下文管理，`observe.go:602`）。卡死检测：同内容重复 ≥maxRepeatedResponseRounds 提前终止（`engine.go:559-576`）。

**max_iterations**：默认 10（`custom_agent.go:494`），上限 100（`agent_service.go:25`），builtin-smart-reasoning 配 50；超限不报错——把全部工具结果拼上下文做**一次额外的强制总结 LLM 调用**（`finalize.go:160 handleMaxIterations` → `streamFinalAnswerToEventBus:27`）。

**工具白名单 = 注册期过滤**（LLM 看不到未注册工具，`agent_service.go:430-698`）：空 allowed_tools → 11 个默认工具；按 KB 范围/web_search/共享只读逐层剔除；MCP 工具独立注册（`:244-318`）。

**SSE 事件**（枚举 `event/event.go:45-77`）：`agent_query`（setup 时）/`thinking`（reasoning 流）/`tool_call`（两阶段：流中 pending `think.go:257` + 执行前带参数 `act.go:413`）/`tool_result`（含时长）/`references`（**仅 quick-answer 管线发**，`session_knowledge_qa.go:1192`）/`final_answer`（流式分片）/`complete`（恰好一次，带 FinalAnswer/AgentSteps/TotalDurationMs，`finalize.go:181`）/`error`/`tool_approval_*`/`mcp_oauth_*`。事件经 Redis（TTL 24h）中转，handler 100ms 轮询转发。

## 2. 溯源（引用）机制（代码事实，两套并存）

1. **quick-answer**：检索后发 `references` 事件 → handler 累积写入 `messages.knowledge_references`（`agent_stream_handler.go:385-428`）。结构 = `[]*types.SearchResult`（`types/search.go:151-227`：chunk_id/knowledge_id/标题/score/match_type/kb_id…）。
2. **smart-reasoning（agent 模式）**：`AgentState.KnowledgeRefs` 初始化为空后**全程无人填充**（`engine.go:252`；全仓无 append 点）→ **messages.knowledge_references 恒为空数组**（实验实测确认）。引用走 **modelcontext 内联标签**：系统 prompt 注入 `<ref id="cN"/>` 协议（`citations.go:14-39`）→ 工具结果注册来源句柄 → 流式解码器把 `<ref/>` 展开为公开标签 **`<kb doc="标题" chunk_id="..." kb_id="..."/>` / `<web url=.../>`**（`citations.go:193-287`）；**未注册句柄 fail-closed 直接删除**（`:169-186`）。开关 `citation_enabled`（agent 级，默认 true）。**事后追溯 agent 引用的唯一落盘来源 = messages.content 里的内联标签属性**。
3. citation-generator skill：纯提示词技能（教模型输出规范引用格式），与上述机器零耦合、无强制校验。

## 3. 结构化输出（代码事实：不存在）

全仓无 `json_schema/response_format/output_format` 类约束；唯一 JSON Schema 通道是**工具入参**（`types/agent.go:166-179`）。接近的只有 query 改写的提示词级 JSON 约定。占位符机制（`types/placeholder.go:37-155`：`{{knowledge_bases}}/{{contexts}}/{{language}}/{{current_time}}` 等）只作用于系统/改写/兜底模板，**回答侧无任何模板**。→ R4 的"结构化输出"需完全自建（response_format 透传或输出校验+重试层）。

## 4. fallback（代码事实）

仅 quick-answer 有：检索零命中（`ErrSearchNothing`）→ `fixed`（直接出 `fallback_response` 文案）或 `model`（渲染 `fallback_prompt` + 带历史再调一次 LLM，失败再降 fixed；`session_knowledge_qa.go:921-994`）。`is_fallback` 经 `IsFallback:true` 事件 → handler 置位 → 落 `messages.is_fallback`。**agent 模式引擎无 fallback 概念，is_fallback 永不置位**（buildAgentConfig 不拷贝 Fallback 字段，`session_agent_qa.go:254-271`）。

## 5. 审计落盘盘点（R4 核心，逐项对照资管合规清单）

messages 完成时落：Content / IsCompleted / **AgentSteps** / KnowledgeReferences / **AgentDurationMs** / IsFallback / Artifacts（`qa.go:1413-1431`）。`agent_steps[]` 结构：`{Iteration, Thought, ReasoningContent, ToolCalls[]{Name,Args,Result,Duration}}`（`types/agent.go:208-236`；落库前瘦身剔除大体积数据，`tools/persist.go:71-101`）。audit_logs **与问答完全无关**（action 全集无 chat 类）。SSE 明细仅 Redis 24h；链路追踪仅 Langfuse（默认关）。

| 合规项 | 状态 | 依据 |
|--------|------|------|
| 谁问的（用户/渠道） | ✅ | sessions.UserID + messages.RequestID/Channel |
| 哪个租户 | ✅ | sessions.TenantID + messages.AgentTenantID（共享 agent 源租户） |
| 哪份 Agent 配置 | ⚠️ | 仅 AgentID + config_hash（**且 hash 不含 system_prompt/allowed_tools/max_iterations**）；无完整快照，事后改配置无法复原当次行为 |
| 检索了哪些库 | ✅/⚠️ | execution_context.knowledge_base_ids ✅；实际逐次检索范围要解析 agent_steps 的工具 Args ⚠️ |
| 引用了哪些来源 | ⚠️ | quick-answer ✅（knowledge_references）；**agent 模式仅 content 内联 `<kb/>` 标签**（可解析、非结构化字段）；citation_enabled=false 时连标签也剥除 |
| 调了哪些工具及参数 | ✅ | agent_steps.tool_calls（名/参数/时长/结果，含审批拒绝） |
| 审批决策（谁批/何时/改参） | ❌ | 仅 SSE/Redis 24h，不落库 |
| 是否 fallback | ⚠️ | quick-answer ✅；agent 模式永不置位 |
| 最终答复全文 | ✅ | messages.content |
| 耗时 | ✅/⚠️ | agent 模式 agent_duration_ms ✅；quick-answer 仅 SSE 元数据（24h）⚠️ |
| token 消耗 | ❌ | 仅内存/Debug 日志/Langfuse；无 DB 落盘（`TokenUsage` 不持久化） |
| 中间 thinking | ⚠️ | AgentSteps.Thought/ReasoningContent 已含；完整渲染 prompt 仅 quick-answer 有 rendered_content 列 |

## 6. 性能与上下文（代码事实）

- ContextConfig（tenant 级 max_tokens/compression/recent_count/threshold）**实际未接线**（sessions 字段已注释，无消费者）——二开不可依赖。实际管理走 agent 的 `max_context_tokens`（默认 200k，`types/agent.go:71`）：每轮工具结果预算裁剪（1/5 上下文，钳 8k–32k）+ 超限 LLM 摘要合并（`memory/consolidator.go`）+ BPE 估算（`observe.go:29-77`）。
- 一次 smart-reasoning 的 LLM 调用数 = 迭代轮数 + （超限时总结 1 次）+ （标题 1 次）+（追问建议 1 次）；**无 query 改写**（那是 quick-answer 的）。quick-answer 主链 = 改写 1 + 答案流 1。

## 7. MCP 审批与 Skills（代码事实，摘要）

MCP 工具可配人工审批：执行前发 `tool_approval_required`（SSE 卡片）→ 阻塞等 Decision（可改参数，默认 10 分钟）→ checker 异常 **fail-close**（`approval/gate.go:196-206`），多副本 Redis PubSub 扇出。Skills 三级加载：L1 元数据入系统 prompt → L2 `read_skill` 读全文 → L3 读附属文件；沙箱可执行脚本，产物挂 messages.artifacts。

## 8. 实验记录（2026-08-24，专用库，两模式各一次）

**① quick-answer**（问"锂电池行业的投资建议"）：
- 事件分布：thinking×78、answer×65、tool_call×2/tool_result×2（检索+重排）、**references×1**（命中 锂电行业研报.txt）、complete×1。
- 正文含内联引用 `<kb doc="锂电行业研报.txt" chunk_id="3462..." kb_id="269d..."/>` ✅。
- messages 落盘：`knowledge_references` 有值 ✅、is_fallback=f、agent_duration_ms=0（⚠️ 实证 quick-answer 无时长落盘）、steps=1。

**② smart-reasoning**（问"对比锂电行业和固收策略的风险"）：
- 3 轮 ReAct，工具 5 次（grep_chunks×2、knowledge_search×1、list_knowledge_chunks×2；tool_call 事件 10 = 每次两阶段）；thinking×1211、answer×543。
- 1916 字回答，正文内联引用覆盖两份文档（`<kb doc="锂电行业研报.txt"...>`、`<kb doc="债券固收策略.txt"...>`）✅。
- messages 落盘：**knowledge_references = `[]`（空数组，实证"恒空"结论）**、agent_steps=3 轮 ✅、agent_duration_ms=18709 ✅、execution_context 含 agent_config_hash + kb 范围 ✅、is_fallback=f（无触发场景）。

## 9. 对 R4 的覆盖度评估（三栏清单）

| 原生已满足 | 需二开补强 | 需完全自建 |
|-----------|-----------|-----------|
| ReAct 执行链（迭代/工具编排/并行/卡死检测/超限总结） | **引用结构化**：解析 content 内联 `<kb/>` 标签回填 knowledge_references（或挂点 `engine.go:252`/`finalize.go:185` 填充 AgentState.KnowledgeRefs） | **token 用量落盘**（messages 加 usage 列或 agent_execution_audit 表；数据源 `usage.go:18 logUsage` 已有全量） |
| 工具调用全量落盘（agent_steps：名/参/时长/结果） | **Agent 配置快照**（messages 存当次完整 config JSON 或修订 hash 覆盖面） | **结构化输出**（schema 约束/校验/重试层） |
| 内联引用 fail-close 语义（未注册来源必删）+ agent 级开关 | quick-answer 时长落盘；审批决策落库 | **敏感词拦截**（生成链路无任何内容过滤钩子，唯一拦截点是 provider content_filter） |
| MCP 审批闭环（fail-close）+ SSE 全事件流（24h） | Langfuse 启用（链路追踪现成、只差配置） | 合规报表（按人/按库/拦截统计） |

**审计缺口最小补齐方案**（立项时按此砍范围）：不新建大审计表也可达到"可追溯"——①`agent_execution_audit` 最小列集（message_id 外键 + prompt/completion tokens + 配置快照 jsonb + 拦截标记）在 `completeAssistantMessage`（`qa.go:1413`）后写入，数据全部现成；②引用结构化做一个 content 后处理器（正则解析 `<kb/>` → SearchResult 列表回填）；③敏感词在 `streamFinalAnswer`/answer 事件出口做一次扫描拦截。三件事互不依赖，可分独立提交。

## 10. 实验消耗（token 记账，来源 `[LLM Usage]` debug 日志，deepseek-v4-flash）

**① quick-answer（1 问）**：

| 阶段 | purpose | prompt | completion | total | 缓存命中 |
|------|---------|--------|-----------|-------|---------|
| 问题改写 | query_rewrite | 2400 | 192 | 2592 | - |
| RAG 答案流 | knowledge_qa | 1159 | 142 | 1301 | - |
| 追问建议 | （空） | 752 | 916 | 1668 | 256 |
| **小计** | | **4311** | **1250** | **5561** | |

**② smart-reasoning（1 问，3 轮）**：

| 轮次 | prompt | completion | total | 其中缓存命中 |
|------|--------|-----------|-------|-------------|
| Round-1 | 6131 | 403 | 6534 | 5504 |
| Round-2 | 8388 | 251 | 8639 | 6528 |
| Round-3 | 9197 | 1397 | 10594 | 8576 |
| **小计** | **23716** | **2051** | **25767** | **20608（80%）** |

- **量级结论**：quick-answer ≈ 5.6k token/问；smart-reasoning ≈ 26k token/问（**但 80% 是 prompt 缓存命中，实付未命中部分 ≈ 5.2k**——多轮上下文高度重叠，缓存收益显著）。计入标题生成/追问建议则各再加 ~1–2k。
- 嵌入/重排调用未计入上表（usage 日志仅记 chat 类）；检索侧每次问答另计 embedding（查询向量）+ rerank（若启用）费用。
- 跑批测算：1000 次 quick-answer ≈ 560 万 token；1000 次 3 轮 agent 问答 ≈ 2600 万 token（实付口径 ≈ 520 万 + 写缓存首轮）。按模型刊例价代入即得金额。

## 11. 实验资产处置

同调研 A（§12）：实验库与 EXP001 保留待检视，platform key 已删、demo01 已降权。两个实验会话（实验-快答/实验-推理）及其 messages 留在库内供查验审计字段实况。
