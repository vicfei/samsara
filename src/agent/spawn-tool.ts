// spawn_agent 工具(M3-S1,§5.4):模型可在任务内派生子 Agent(并行拆解)。
// 三条不变式与深度软硬限由 Spawner 服务端强制(工具只是薄壳);
// 父代必须是已登记的运行中 agent(task.agentId)。

import type { PluginManifest, PluginModule } from "../kernel/types.js";
import { TOOL_REGISTRY } from "./tools.js";
import type { AgentTool } from "./tools.js";
import type { Spawner } from "./spawner.js";

export function spawnToolPlugin(spawner: Spawner): { manifest: PluginManifest; module: PluginModule } {
  const manifest: PluginManifest = {
    name: "tool-spawn", version: "1.0.0", kind: "tool",
    provides: [], requires: ["tools.registry"], rLevel: "R0",
  };

  const spawnTool: AgentTool = {
    name: "spawn_agent",
    description: "派生子 Agent 并行执行子任务,如 {\"goal\": \"搜集三个竞品的价格\", \"max_steps\": 3};适合可独立拆解的子任务;子任务结果直接返回;深度/配额/权限受限(授权代数)",
    sideEffect: "write", // 派生 = 子代生命周期条目入账(agent.spawn/terminate)
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "子任务目标(独立可执行)" },
        max_steps: { type: "number", description: "子任务步数预算(必须小于父代剩余)" },
        r_ceiling: { type: "string", description: "子代动刀上限 R0-R4(只降,缺省 R0)" },
      },
      required: ["goal"],
    },
    pluginId: "tool-spawn@1.0.0",
    run(args, _ctx, task) {
      const { goal, max_steps, r_ceiling } = args as { goal?: string; max_steps?: number; r_ceiling?: string };
      if (typeof goal !== "string" || goal.trim() === "") return { content: "错误:需 {goal}", ok: false };
      if (task === undefined) return { content: "错误:须在任务上下文中调用", ok: false };
      if (!spawner.isRunning(task.agentId)) {
        return { content: `错误:父代 ${task.agentId} 不在派生树运行态(深度/权限校验失败)`, ok: false };
      }
      return spawner.spawn(task.agentId, {
        goal: goal.trim(),
        ...(typeof max_steps === "number" && max_steps > 0 ? { budget: { maxSteps: Math.floor(max_steps) } } : {}),
        ...(r_ceiling !== undefined && /^R[0-4]$/.test(r_ceiling) ? { rCeiling: r_ceiling as "R0" | "R1" | "R2" | "R3" | "R4" } : {}),
        systemPrompt: "你是 Samsara 的子 Agent;直接产出子任务结果,简洁完整。",
      }).then((h) => h.result).then((r) => ({
        content: `子任务[${r.outcome}]${r.reply !== undefined ? `: ${r.reply.slice(0, 500)}` : r.error !== undefined ? `: ${r.error.slice(0, 300)}` : ""}(trace=${r.traceId},steps=${r.steps.length})`,
        ok: r.outcome !== "failure",
      })).catch((err: unknown) => ({
        content: `派生被拒: ${String(err instanceof Error ? err.message : err).slice(0, 200)}(授权代数:能力只减/配额递减/权限只降)`,
        ok: false,
      }));
    },
  };

  const module: PluginModule = {
    start(ctx) {
      ctx.inject(TOOL_REGISTRY).get().register(spawnTool);
      ctx.effect("spawn 工具注册",
        () => undefined,
        () => { /* 注销经插件卸载级联;注册表镜像随进程 */ },
        { owner: { kind: "plugin", id: "tool-spawn@1.0.0" } });
    },
  };
  return { manifest, module };
}
