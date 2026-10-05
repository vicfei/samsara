// M1 任务回路·第一片:单轮对话(主文档 §5.1 的最小可跑形态)
// 完整 ReAct(工具调用/子 Agent 派生/中断检查)随 M1 后续片交付;
// 本片先把"任务 = 账本条目 + 轨迹 + ReplayBundle"的骨架立起来——
// 影子验证的口粮从第一天开始采(RM2/K.5,接口文档 §6.1 replay_bundle_cas)。

import { randomUUID } from "node:crypto";
import type { Kernel } from "../kernel/kernel.js";
import type { LedgerActor } from "../kernel/types.js";
import { CHAT_SERVICE } from "../llm/chat.js";
import type { ChatMessage } from "../llm/chat.js";

export interface TaskOptions {
  goal: string;
  sessionKey: string;      // <channel>:<scope>:<peer>(K.4 信任派生属 M2)
  actor?: LedgerActor;
  model?: string;          // 缺省用提供者默认
}

export interface TaskResult {
  agentId: string;
  traceId: string;
  outcome: "success" | "failure";
  reply?: string;
  error?: string;
  bundleCas: string;       // samsara-bundle/0(重放包)
  traceCas: string;        // samsara-trace/0(轨迹快照;Parquet 投影随 M1 后续接入)
  usage?: { promptTokens: number; completionTokens: number };
  durationMs: number;
}

/** 脱敏闸(K.5):写入 bundle 前剔除凭据形态的值——M1 为结构级免染(不含任何密钥字段) */
function redact<T>(v: T): T { return v; }

export async function runTask(kernel: Kernel, opts: TaskOptions): Promise<TaskResult> {
  const actor: LedgerActor = opts.actor ?? { kind: "human", id: "cli", trust: "owner" };
  const started = Date.now();
  const agentId = `ag_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const traceId = `tr_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

  // 服务就绪是任务准入条件(缺提供者 → DEPS_MISSING,任务不产生半截条目)
  const llm = kernel.service(CHAT_SERVICE);

  kernel.store.append({
    actor, kind: "agent.spawn",
    ref: { agent: agentId },
    payload: { goal: opts.goal, session_key: opts.sessionKey, parent: null, budget: {} },
  });

  const messages: ChatMessage[] = [{ role: "user", content: opts.goal }];
  let outcome: "success" | "failure" = "success";
  let reply: string | undefined;
  let error: string | undefined;
  let usage: TaskResult["usage"];
  let modelLabel = "unknown";

  try {
    const r = await llm.complete({ messages, ...(opts.model !== undefined ? { model: opts.model } : {}) });
    reply = r.content;
    modelLabel = r.modelLabel;
    if (r.usage) usage = r.usage;
    messages.push({ role: "assistant", content: reply });
  } catch (err) {
    outcome = "failure";
    error = String(err);
  }

  // ReplayBundle:入站消息全文 + 模型输出 + 环境指纹(K.5 组成,单轮无工具步)
  const bundle = redact({
    schema: "samsara-bundle/0",
    session_key: opts.sessionKey,
    goal: opts.goal,
    model: modelLabel,
    messages,
    env: { node: process.version, channel: opts.sessionKey.split(":")[0] ?? "cli" },
  });
  const { cas: bundleCas } = kernel.store.putCas(bundle);

  const durationMs = Date.now() - started;
  const trace = {
    schema: "samsara-trace/0",
    trace_id: traceId, session_key: opts.sessionKey, agent_id: agentId,
    outcome, ...(error !== undefined ? { error } : {}),
    ...(usage !== undefined ? { usage } : {}),
    duration_ms: durationMs, model: modelLabel,
    replay_bundle_cas: bundleCas,
    task_cluster: "chat.single_turn",
  };
  const { cas: traceCas } = kernel.store.putCas(trace);

  kernel.store.append({
    actor, kind: "agent.terminate",
    ref: { agent: agentId },
    payload: { outcome, trace_id: traceId, trace_cas: traceCas, replay_bundle_cas: bundleCas },
  });

  return {
    agentId, traceId, outcome,
    ...(reply !== undefined ? { reply } : {}),
    ...(error !== undefined ? { error } : {}),
    bundleCas, traceCas,
    ...(usage !== undefined ? { usage } : {}),
    durationMs,
  };
}
