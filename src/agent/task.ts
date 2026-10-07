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
import type { Skills } from "../l2/skills.js";
import type { Memory } from "../l2/memory.js";

// spec-constants: channel_task_max_steps(§5.1 落地注,批次二十三)——
// 多主题调研实测需要 10-12 步(3 主题×2-3 轮检索+汇总),单问答默认 8 对渠道任务偏紧
export const DEFAULT_MAX_STEPS = 8;
export const CHANNEL_TASK_MAX_STEPS = 16;

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
  skills?: Skills;          // L2:上下文装配注入 main 技能(§5.1 第 1 步"检索到的技能")
  memory?: Memory;          // L2:召回注入(§6.5 读取路径)+ 成功交互入提炼缓冲
  /** M3 派生(§5.4):父代/深度/R 顶——授权代数由 Spawner 服务端强制 */
  parent?: { agentId: string; depth: number; approvalSeq?: number };
  rCeiling?: import("../kernel/types.js").RLevel;
  spawner?: import("./spawner.js").Spawner;
  /** 外部指定 agentId(Spawner 派生:kill 句柄在 register 前关联);缺省随机 */
  agentId?: string;
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
  const agentId = opts.agentId ?? `ag_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const traceId = `tr_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

  // 准入闸:服务就绪才产生条目(缺提供者 → DEPS_MISSING,零半截账)
  const llm = kernel.service(CHAT_SERVICE);
  let tools: ToolRegistry | undefined;
  try { tools = kernel.service(TOOL_REGISTRY); } catch { /* 无注册表 = 纯对话模式 */ }
  const owner: OwnerRef = { kind: "agent", id: agentId };
  const ctx = kernel.contextFor(opts.runtimePluginId, owner); // 任务作用域:效应归属 agent

  kernel.store.append({
    actor, kind: "agent.spawn",
    ref: { agent: agentId },
    payload: {
      goal: opts.goal, session_key: opts.sessionKey, budget: { max_steps: maxSteps },
      ...(opts.parent !== undefined
        ? { parent: opts.parent.agentId, depth: opts.parent.depth, ...(opts.parent.approvalSeq !== undefined ? { depth_approval_ref: `seq:${opts.parent.approvalSeq}` } : {}) }
        : { parent: null, depth: 0 }),
      ...(opts.rCeiling !== undefined ? { r_ceiling: opts.rCeiling } : {}),
    },
  });
  // Spawner 登记(§5.4 派生树:深度/R 顶/信任/配额——后续 spawn 校验的权威)
  opts.spawner?.register({
    agentId, parentAgentId: opts.parent?.agentId ?? null,
    depth: opts.parent?.depth ?? 0,
    rLevel: opts.rCeiling ?? "R2",
    trust: actor.trust ?? "owner",
    budget: { maxSteps },
    sessionKey: opts.sessionKey,
  });

  // 装配上下文(§5.1 第 1 步):系统提示 + main 活跃技能清单 + 记忆召回(§6.5 读取路径)
  // 召回失败不阻断任务(检索服务缺席/网关抖动 → 降级为无记忆注入,任务照常)
  const skillLines = opts.skills !== undefined ? opts.skills.contextLines() : [];
  let memoryLines: string[] = [];
  if (opts.memory !== undefined) {
    try { memoryLines = await opts.memory.recallLines(opts.sessionKey, opts.goal); }
    catch { memoryLines = []; }
  }
  // 工作记忆(批次二十四①):本会话最近几轮对话注入——多轮追问("分头调研"式)即刻有上文;
  // 中止交换也入缓冲,追问"刚才那个任务"不丢线索
  let recentLines: string[] = [];
  if (opts.memory !== undefined) {
    try {
      const recent = opts.memory.recentExchanges(opts.sessionKey, 6);
      if (recent.length > 0) {
        recentLines = [`近期对话(本会话工作记忆,最新在后;当前请求是其延续,用于理解指代与省略):
${recent.map((r) => `用户: ${r.user.slice(0, 240)}\nSamsara: ${r.reply.slice(0, 240)}`).join("\n---\n")}`];
      }
    } catch { /* 工作记忆缺席不阻断 */ }
  }
  const systemParts = [
    ...(opts.systemPrompt !== undefined ? [opts.systemPrompt] : []),
    ...(skillLines.length > 0 ? [`可用技能(同类任务优先按技能步骤执行):\n${skillLines.join("\n")}`] : []),
    ...(memoryLines.length > 0 ? [`相关记忆(过往会话沉淀,事实参考;如与当前请求冲突以当前为准):\n${memoryLines.join("\n")}`] : []),
    ...recentLines,
  ];
  const messages: ChatMessage[] = [
    ...(systemParts.length > 0 ? [{ role: "system" as const, content: systemParts.join("\n\n") }] : []),
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
            const r2 = await tool.run(call.args, toolCtx, { sessionKey: opts.sessionKey, agentId, traceId });
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

  // ReplayBundle:入站/出站全文 + 逐步 args/results + 环境指纹(K.5;信任级随入站消息入 bundle)
  const bundle = redact({
    schema: "samsara-bundle/0",
    session_key: opts.sessionKey,
    goal: opts.goal,
    trust: actor.trust ?? "untrusted",
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
    trust: actor.trust ?? "untrusted",
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
  opts.spawner?.settle(agentId); // 派生树簿记:退出 running(kill 的 killed 态由 Spawner.kill 标记)

  // §6.5 情景提炼食料+工作记忆:成功与中止交互均入会话缓冲(中止也记——追问"刚才那个任务"有线索;
  // 守护空闲蒸馏;exception 不入——异常回复无语义价值)
  if (opts.memory !== undefined && (reply !== undefined || outcome === "aborted")) {
    opts.memory.noteExchange(opts.sessionKey, opts.goal,
      reply ?? `[任务中止]${error !== undefined ? ` ${error.slice(0, 120)}` : ""}`);
  }

  return {
    agentId, traceId, outcome, steps: traceSteps,
    ...(reply !== undefined ? { reply } : {}),
    ...(error !== undefined ? { error } : {}),
    bundleCas, traceCas, usage, durationMs,
  };
}

/**
 * 预算耗尽的渠道友好文案(C 项,批次二十三):不把内部错误串直发用户——
 * 给出两条可行路径(派生分头调研 / 拆单问题),并如实告知已完成步数。
 */
export function abortedMessage(r: { outcome: string; error?: string; steps?: { length: number } }): string | undefined {
  if (r.outcome !== "aborted" || r.error === undefined) return undefined;
  if (!r.error.includes("步数预算")) return undefined; // 非预算类中止(外部中断等)不转写
  const done = r.steps?.length ?? 0;
  return `[任务中止] 这个任务的工作量超出了单次步数预算(已完成 ${done} 步检索/操作,未及汇总)。建议:\n① 回复"分头调研"——我用 spawn_agent 拆成子任务并行,每个子任务有独立预算;\n② 或拆成单个问题逐个来。`;
}
