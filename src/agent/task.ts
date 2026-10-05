// M1 任务回路:ReAct 变体(主文档 §5.1 完整五步)
//   装配上下文 → LLM 推理 → 工具执行(经 L0 effect 登记,归属 agent)→ 轨迹记录 → 中断检查
// 工具经注册表发现(§agent/tools);效应三分类由工具自决;每步结果入 ReplayBundle(K.5)。

import { randomUUID } from "node:crypto";
import type { Kernel } from "../kernel/kernel.js";
import type { LedgerActor, OwnerRef } from "../kernel/types.js";
import { CHAT_SERVICE } from "../llm/chat.js";
import type { ChatMessage } from "../llm/chat.js";
import { TOOL_REGISTRY } from "./tools.js";
import type { AgentTool, ToolRegistry } from "./tools.js";

export interface TaskOptions {
  goal: string;
  sessionKey: string;       // <channel>:<scope>:<peer>
  /** 归属插件(效应的 pluginId 与重绑定发现;通常为 agent-runtime 插件) */
  runtimePluginId: string;
  actor?: LedgerActor;
  model?: string;
  systemPrompt?: string;
  maxSteps?: number;        // 步数预算(默认 8):耗尽即"放弃"(§5.1 until 子句)
  signal?: AbortSignal;     // 中断信号(§5.1 第 5 步:介入/回收的最小形态)
}

export interface TraceStep {
  no: number;
  kind: "tool";
  name: string;
  ok: boolean;
  ms: number;
}

export interface TaskResult {
  agentId: string;
  traceId: string;
  outcome: "success" | "failure" | "aborted";
  reply?: string;
  error?: string;
  steps: TraceStep[];
  bundleCas: string;
  traceCas: string;
  usage: { promptTokens: number; completionTokens: number };
  durationMs: number;
}

/** 脱敏闸(K.5):M1 结构级免染——bundle 不含任何凭据字段;凭据形态扫描随 M2 增强 */
function redact<T>(v: T): T { return v; }

export async function runTask(kernel: Kernel, opts: TaskOptions): Promise<TaskResult> {
  const actor: LedgerActor = opts.actor ?? { kind: "human", id: "cli", trust: "owner" };
  const started = Date.now();
  const agentId = `ag_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const traceId = `tr_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const maxSteps = opts.maxSteps ?? 8;

  // 准入闸:服务就绪才产生条目(缺提供者 → DEPS_MISSING,零半截账)
  const llm = kernel.service(CHAT_SERVICE);
  let tools: ToolRegistry | undefined;
  try { tools = kernel.service(TOOL_REGISTRY); } catch { /* 无注册表 = 纯对话模式 */ }
  const owner: OwnerRef = { kind: "agent", id: agentId };
  const ctx = kernel.contextFor(opts.runtimePluginId, owner); // 任务作用域:效应归属 agent

  kernel.store.append({
    actor, kind: "agent.spawn",
    ref: { agent: agentId },
    payload: { goal: opts.goal, session_key: opts.sessionKey, parent: null, budget: { max_steps: maxSteps } },
  });

  const messages: ChatMessage[] = [
    ...(opts.systemPrompt !== undefined ? [{ role: "system" as const, content: opts.systemPrompt }] : []),
    { role: "user" as const, content: opts.goal },
  ];
  /** bundle 的逐步明细:完整 args/results(K.5 重放保真) */
  const bundleSteps: { no: number; name: string; args: unknown; result: string; ok: boolean; ms: number }[] = [];
  const traceSteps: TraceStep[] = [];
  const usage = { promptTokens: 0, completionTokens: 0 };
  let modelLabel = "unknown";

  let outcome: TaskResult["outcome"] = "success";
  let reply: string | undefined;
  let error: string | undefined;

  try {
    let step = 0;
    // ── ReAct 主循环(§5.1)──────────────────────────────
    while (true) {
      if (opts.signal?.aborted) { outcome = "aborted"; break; }        // 第 5 步:中断检查
      if (step >= maxSteps) { outcome = "aborted"; error = `步数预算耗尽(${maxSteps})`; break; }

      const r = await llm.complete({
        messages,
        ...(tools ? { tools: tools.list().map((t) => ({ name: t.name, description: t.description, ...(t.parameters ? { parameters: t.parameters } : {}) })) } : {}),
        ...(opts.model !== undefined ? { model: opts.model } : {}),
      });                                                               // 第 2 步:LLM 推理 → 动作决策
      modelLabel = r.modelLabel;
      usage.promptTokens += r.usage?.promptTokens ?? 0;
      usage.completionTokens += r.usage?.completionTokens ?? 0;

      if (!r.toolCalls || r.toolCalls.length === 0) {                   // 动作 = 回复 → 任务完成
        reply = r.content;
        messages.push({ role: "assistant", content: reply }); // 收尾消息入 bundle(重放完整)
        break;
      }

      messages.push({ role: "assistant", content: r.content, toolCalls: r.toolCalls });
      for (const call of r.toolCalls) {                                 // 第 3 步:执行动作(经 effect 登记)
        step += 1;
        if (step > maxSteps) { outcome = "aborted"; error = `步数预算耗尽(${maxSteps})`; break; }
        const t0 = Date.now();
        const tool: AgentTool | undefined = tools?.get(call.name);
        let resultContent: string;
        let ok = true;
        if (!tool) {
          resultContent = `工具不存在: ${call.name}`; ok = false;
        } else {
          try {
            // 效应归属:工具自带 pluginId(重绑定发现),owner=本任务 agent
            const toolCtx = tool.pluginId !== undefined && tool.pluginId !== opts.runtimePluginId
              ? kernel.contextFor(tool.pluginId, owner)
              : ctx;
            const r2 = await tool.run(call.args, toolCtx);
            resultContent = r2.content;
            ok = r2.ok !== false;
          } catch (err) {
            resultContent = `工具执行失败: ${String(err)}`; ok = false; // 失败不熔断循环,交模型决策
          }
        }
        const ms = Date.now() - t0;
        traceSteps.push({ no: step, kind: "tool", name: call.name, ok, ms }); // 第 4 步:轨迹记录
        bundleSteps.push({ no: step, name: call.name, args: call.args, result: resultContent, ok, ms });
        messages.push({ role: "tool", content: resultContent, toolCallId: call.id });
      }
      if (outcome === "aborted") break;
    }
  } catch (err) {
    outcome = "failure";
    error = String(err);
  }

  // ReplayBundle:入站/出站全文 + 逐步 args/results + 环境指纹(K.5)
  const bundle = redact({
    schema: "samsara-bundle/0",
    session_key: opts.sessionKey,
    goal: opts.goal,
    model: modelLabel,
    messages,
    steps: bundleSteps,
    env: { node: process.version, channel: opts.sessionKey.split(":")[0] ?? "cli" },
  });
  const { cas: bundleCas } = kernel.store.putCas(bundle);

  const durationMs = Date.now() - started;
  const trace = {
    schema: "samsara-trace/0",
    trace_id: traceId, session_key: opts.sessionKey, agent_id: agentId,
    outcome, ...(error !== undefined ? { error } : {}),
    steps: traceSteps, usage, duration_ms: durationMs, model: modelLabel,
    replay_bundle_cas: bundleCas,
    task_cluster: "agent.react",
  };
  const { cas: traceCas } = kernel.store.putCas(trace);

  kernel.store.append({
    actor, kind: "agent.terminate",
    ref: { agent: agentId },
    payload: { outcome, trace_id: traceId, trace_cas: traceCas, replay_bundle_cas: bundleCas },
  });

  return {
    agentId, traceId, outcome, steps: traceSteps,
    ...(reply !== undefined ? { reply } : {}),
    ...(error !== undefined ? { error } : {}),
    bundleCas, traceCas, usage, durationMs,
  };
}
