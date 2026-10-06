// spawn_agent 工具测试(M3 测试加固,issue #15):工具壳校验 / 正常派生 /
// kill agent 与 session 工作区捕获层的边界(人走茶不凉:kill 不动会话资产) /
// mock 剧本驱动的"模型派生子任务"完整 E2E(账本 parent 链验证)。

import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../src/kernel/kernel.js";
import { Projection } from "../src/kernel/projection.js";
import { mockChatPlugin } from "../src/llm/chat.js";
import type { MockTurn } from "../src/llm/chat.js";
import { CHAT_SERVICE } from "../src/llm/chat.js";
import { Spawner } from "../src/agent/spawner.js";
import { spawnToolPlugin } from "../src/agent/spawn-tool.js";
import { runTask } from "../src/agent/task.js";
import { toolRegistryPlugin, fsToolPlugin, TOOL_REGISTRY } from "../src/agent/tools.js";
import type { KernelContext } from "../src/kernel/types.js";
import { WorkspaceCapture } from "../src/kernel/workspace.js";
import { tmpStore } from "./helpers.js";

const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };
const SESSION = "test:dm:owner";

/** 按 goal 路由的 chat:quick* 立即答,其余挂门(goal 出现在最后一条 user 消息) */
function routedChatPlugin(): { plugin: { manifest: never; module: never }; release: () => void } {
  let releaseGate!: () => void;
  const gate = new Promise<void>((r) => { releaseGate = r; });
  const plugin = {
    manifest: { name: "llm-routed", version: "1.0.0", kind: "tool", provides: ["llm.chat"], requires: [], rLevel: "R0" },
    module: {
      start(ctx: KernelContext) {
        ctx.provide(CHAT_SERVICE, {
          async complete(req: { messages: { role: string; content: string }[] }) {
            const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
            if (last.startsWith("quick")) return { content: "子任务完成", finishReason: "stop" as const, modelLabel: "routed", usage: { promptTokens: 1, completionTokens: 1 } };
            await gate;
            return { content: "root-done", finishReason: "stop" as const, modelLabel: "routed", usage: { promptTokens: 1, completionTokens: 1 } };
          },
        });
      },
    },
  };
  return { plugin: plugin as never, release: () => releaseGate() };
}

interface W {
  kernel: Kernel; projection: Projection; spawner: Spawner; rootId: string;
  settled: Promise<unknown>[]; release: () => void; cleanup: () => void;
  spawnTool: ReturnType<typeof spawnToolPlugin>["module"] extends never ? never : { run(a: unknown, c: KernelContext, t?: unknown): Promise<{ content: string; ok?: boolean }> | { content: string; ok?: boolean } };
}

/** 装配:路由 chat + 工具注册表 + spawn 工具 + 真实挂起根任务 */
async function boot(): Promise<W> {
  const t = tmpStore();
  const kernel = new Kernel(t.store);
  const projection = Projection.open(t.dir, t.store);
  const r = routedChatPlugin();
  kernel.install(r.plugin.manifest, r.plugin.module);
  const reg = toolRegistryPlugin();
  kernel.install(reg.manifest, reg.module);
  const fsP = fsToolPlugin(join(t.dir, "shared"));
  kernel.install(fsP.manifest, fsP.module);
  await kernel.activate("llm-routed@1.0.0");
  await kernel.activate("tool-registry@1.0.0");
  await kernel.activate("tool-fs@1.0.0");
  const spawner = new Spawner(kernel, runTask, { runtimePluginId: "llm-routed@1.0.0" });
  const sp = spawnToolPlugin(spawner);
  kernel.install(sp.manifest, sp.module);
  await kernel.activate("tool-spawn@1.0.0");
  const rootId = `ag_rt_${Math.random().toString(36).slice(2, 8)}`;
  const settled: Promise<unknown>[] = [runTask(kernel, {
    goal: "hold-root", sessionKey: SESSION, runtimePluginId: "llm-routed@1.0.0",
    actor: ACTOR, maxSteps: 8, agentId: rootId, spawner,
  })];
  await new Promise((res) => setTimeout(res, 20));
  const registry = kernel.service(TOOL_REGISTRY);
  const tool = registry.get("spawn_agent")!;
  return {
    kernel, projection, spawner, rootId, settled, release: r.release,
    spawnTool: tool as never,
    cleanup: () => t.cleanup(),
  };
}

const taskOf = (w: W) => ({ sessionKey: SESSION, agentId: w.rootId, traceId: "tr_t" });

describe("spawn_agent 工具壳", () => {
  it("参数校验:缺 goal/无任务上下文/父代非运行态 → 明确错误文案", async () => {
    const w = await boot();
    try {
      const ctx = w.kernel.contextFor("tool-spawn@1.0.0", { kind: "agent", id: w.rootId });
      expect((w.spawnTool.run({}, ctx, taskOf(w)) as { content: string }).content).toContain("需 {goal}");
      expect((w.spawnTool.run({ goal: "x" }, ctx) as { content: string }).content).toContain("任务上下文");
      expect((w.spawnTool.run({ goal: "x" }, ctx, { sessionKey: SESSION, agentId: "ag_不存在", traceId: "t" }) as { content: string }).content).toContain("不在派生树运行态");
      // 无 task(无 agentId)时与父代缺失同样拒绝
      w.release();
      await Promise.allSettled(w.settled);
      expect((w.spawnTool.run({ goal: "x" }, ctx, taskOf(w)) as { content: string }).content).toContain("不在派生树运行态"); // 根已结算
    } finally { w.cleanup(); }
  });

  it("正常派生:quick 子任务经工具执行并回传结果;child actor.trust 随链只降", async () => {
    const w = await boot();
    try {
      const ctx = w.kernel.contextFor("tool-spawn@1.0.0", { kind: "agent", id: w.rootId });
      const r = await w.spawnTool.run({ goal: "quick-调研三家竞品", max_steps: 2 }, ctx, taskOf(w));
      expect(r.content).toContain("子任务[success]");
      expect(r.content).toContain("子任务完成");
      // 账本:子 agent.spawn 带 parent 链
      const spawns = w.kernel.store.all.filter((e) => e.kind === "agent.spawn");
      expect(spawns).toHaveLength(2); // 根 + 子
      const child = spawns.find((e) => (e.payload as { parent?: string }).parent === w.rootId);
      expect(child).toBeDefined();
      // 越界派生经工具映射为'派生被拒'文案(R 越界)
      const r2 = await w.spawnTool.run({ goal: "quick-x", r_ceiling: "R4" }, ctx, taskOf(w));
      expect(r2.content).toContain("派生被拒");
      expect(r2.content).toContain("权限只降");
    } finally { w.release(); await Promise.allSettled(w.settled); w.cleanup(); }
  });
});

describe("kill 与 session 工作区边界(人走茶不凉:kill agent 不动会话捕获层)", () => {
  it("kill 子代:agent 效应回滚,session 捕获层文件原样;随后 discard 才还原工作区", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const projection = Projection.open(t.dir, t.store);
    const r = routedChatPlugin();
    kernel.install(r.plugin.manifest, r.plugin.module);
    const reg = toolRegistryPlugin();
    kernel.install(reg.manifest, reg.module);
    const fsP = fsToolPlugin(join(t.dir, "shared"));
    kernel.install(fsP.manifest, fsP.module);
    await kernel.activate("llm-routed@1.0.0");
    await kernel.activate("tool-registry@1.0.0");
    await kernel.activate("tool-fs@1.0.0");
    const spawner = new Spawner(kernel, runTask, { runtimePluginId: "llm-routed@1.0.0", killGraceMs: 50 });
    const rootId = "ag_bnd_root";
    const settled = [runTask(kernel, {
      goal: "hold-root", sessionKey: SESSION, runtimePluginId: "llm-routed@1.0.0",
      actor: ACTOR, maxSteps: 8, agentId: rootId, spawner,
    })];
    await new Promise((res) => setTimeout(res, 20));
    try {
      // 子代(挂起,保持 running)
      const h = await spawner.spawn(rootId, { goal: "hold-child", budget: { maxSteps: 3 } });
      settled.push(h.result);
      await new Promise((res) => setTimeout(res, 20));
      // 会话捕获层(session 归属)先落一笔工作区写入
      const cap = new WorkspaceCapture(kernel, "tool-fs@1.0.0", SESSION, join(t.dir, "ws"));
      cap.write("report.md", "工作区产物");
      // 子代自身的 agent 归属效应
      let flag = false;
      kernel.contextFor("tool-fs@1.0.0", { kind: "agent", id: h.agentId }).effect(
        "子代临时标记", () => { flag = true; return undefined; }, () => { flag = false; });

      await spawner.kill(h.agentId, ACTOR);
      expect(flag).toBe(false);                                   // agent 效应已回滚
      expect(existsSync(join(t.dir, "ws", "report.md"))).toBe(true); // 捕获层不受 kill 影响(人走茶不凉)
      expect(readFileSync(join(t.dir, "ws", "report.md"), "utf-8")).toBe("工作区产物");

      const d = await cap.discard(ACTOR);                          // 会话 discard 才还原工作区
      expect(d.reverted.length).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(t.dir, "ws", "report.md"))).toBe(false);
    } finally {
      r.release();
      await Promise.allSettled(settled);
      t.cleanup();
    }
  });
});

describe("模型派生 E2E(mock 剧本:模型决策调用 spawn_agent)", () => {
  it("根任务→工具调用派生→子任务执行→汇总回复;账本 parent 链完整", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const projection = Projection.open(t.dir, t.store);
    // 共享剧本:第 1 轮=请求派生工具;其后=最终回复(子任务与根收尾共用末条)
    const script: MockTurn[] = [
      { toolCalls: [{ id: "call_1", name: "spawn_agent", args: { goal: "汇总子任务结果", max_steps: 2 } }] },
      "派生已完成,这是汇总回复",
    ];
    const chat = mockChatPlugin(script);
    kernel.install(chat.manifest, chat.module);
    const reg = toolRegistryPlugin();
    kernel.install(reg.manifest, reg.module);
    const fsP = fsToolPlugin(join(t.dir, "shared"));
    kernel.install(fsP.manifest, fsP.module);
    await kernel.activate("llm-mock@1.0.0");
    await kernel.activate("tool-registry@1.0.0");
    await kernel.activate("tool-fs@1.0.0");
    const spawner = new Spawner(kernel, runTask, { runtimePluginId: "llm-mock@1.0.0" });
    const sp = spawnToolPlugin(spawner);
    kernel.install(sp.manifest, sp.module);
    await kernel.activate("tool-spawn@1.0.0");
    try {
      const r = await runTask(kernel, {
        goal: "调研两家竞品并汇总", sessionKey: SESSION, runtimePluginId: "llm-mock@1.0.0",
        actor: ACTOR, maxSteps: 6, spawner,
      });
      expect(r.outcome).toBe("success");
      expect(r.steps).toHaveLength(1);               // 一步工具调用(spawn_agent)
      expect(r.steps[0]!.name).toBe("spawn_agent");
      expect(r.steps[0]!.ok).toBe(true);
      // 账本:根+子派生链,子 parent=根;两者均 terminate
      const spawns = kernel.store.all.filter((e) => e.kind === "agent.spawn");
      expect(spawns).toHaveLength(2);
      const child = spawns.find((e) => (e.payload as { parent?: string | null }).parent === r.agentId);
      expect(child).toBeDefined();
      const terms = kernel.store.all.filter((e) => e.kind === "agent.terminate");
      expect(terms).toHaveLength(2);
      // 投影派生树:子行 depth=1、state=done
      const rows = projection.db.prepare(`SELECT depth, state FROM agents WHERE id=?`).get((child!.ref?.agent as string)) as { depth: number; state: string };
      expect(rows).toMatchObject({ depth: 1, state: "done" });
    } finally { t.cleanup(); }
  });
});
