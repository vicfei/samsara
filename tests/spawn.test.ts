// 子 Agent 派生器(M3-S1,§5.4/INC3):授权代数三不等式 / 深度软硬限 / kill 回收无残留 / 派生树穷尽。
// 出口标准:M3 ①派生树穷尽测试 ②kill 回收无残留(环境哈希不变)。
// 基建:门控 chat 插件——agent 的首轮 LLM 调用挂起在门上,测试全程保持 running 态。

import { describe, expect, it } from "vitest";
import { Kernel } from "../src/kernel/kernel.js";
import { Projection } from "../src/kernel/projection.js";
import { serviceKey } from "../src/kernel/types.js";
import { CHAT_SERVICE } from "../src/llm/chat.js";
import { Spawner, SpawnerError, SPAWN_DEPTH_SOFT_LIMIT, SPAWN_DEPTH_HARD_LIMIT } from "../src/agent/spawner.js";
import { runTask } from "../src/agent/task.js";
import { tmpStore, rng, HashEnv } from "./helpers.js";

const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };
const SESSION = "test:dm:owner";

/** 门控 chat:complete 永远等门——agent 保持 running;release 后全部以 "leaf-done" 完成 */
function gatedChatPlugin(): { plugin: { manifest: never; module: never }; release: () => void } {
  let releaseGate!: () => void;
  const gate = new Promise<void>((r) => { releaseGate = r; });
  const plugin = {
    manifest: { name: "llm-gated", version: "1.0.0", kind: "tool", provides: ["llm.chat"], requires: [], rLevel: "R0" },
    module: {
      start(ctx: import("../src/kernel/types.js").KernelContext) {
        ctx.provide(CHAT_SERVICE, {
          async complete(req: { messages: { content: string }[] }) {
            await gate;
            const promptTokens = req.messages.reduce((n, m) => n + m.content.length, 0);
            return { content: "leaf-done", finishReason: "stop" as const, modelLabel: "gated", usage: { promptTokens, completionTokens: 9 } };
          },
        });
      },
    },
  };
  return { plugin: plugin as never, release: () => releaseGate() };
}

interface World {
  kernel: Kernel;
  projection: Projection;
  spawner: Spawner;
  env: HashEnv;
  rootAgentId: string;
  release: () => void;
  settled: Promise<unknown>[];
  cleanup: () => void;
}

/** 装配:门控 chat + 真实根任务(挂起保持 running) */
async function boot(rootSteps = 8, approver?: () => string | null, killGraceMs = 100): Promise<World> {
  const t = tmpStore();
  const kernel = new Kernel(t.store);
  const projection = Projection.open(t.dir, t.store);
  const g = gatedChatPlugin();
  kernel.install(g.plugin.manifest, g.plugin.module);
  await kernel.activate("llm-gated@1.0.0");
  const spawner = new Spawner(kernel, runTask, {
    runtimePluginId: "llm-gated@1.0.0",
    killGraceMs,
    ...(approver !== undefined ? { approver: () => approver() } : {}),
  });
  const env = new HashEnv();
  const rootAgentId = `ag_root_${Math.random().toString(36).slice(2, 10)}`;
  const settled: Promise<unknown>[] = [runTask(kernel, {
    goal: "root", sessionKey: SESSION, runtimePluginId: "llm-gated@1.0.0",
    actor: ACTOR, maxSteps: rootSteps, agentId: rootAgentId, spawner,
  })];
  await new Promise((r) => setTimeout(r, 20)); // 根登记完成(首个 await 前)且已进入门控等待
  expect(spawner.isRunning(rootAgentId)).toBe(true);
  return {
    kernel, projection, spawner, env, rootAgentId, settled,
    release: g.release,
    cleanup: () => { t.cleanup(); },
  };
}

/** 派生挂起子代(结果入 settled,门开时一并结算) */
async function spawnHeld(w: World, parent: string, depth: number, maxSteps = 2): Promise<string> {
  const h = await w.spawner.spawn(parent, { goal: "held", budget: { maxSteps } });
  // 子代 parent/depth 由 runTask 的 parent 选项带入(此处经 handle 直接再跑一个真任务模拟树)
  void depth;
  w.settled.push(h.result);
  await new Promise((r) => setTimeout(r, 15));
  return h.agentId;
}

describe("授权代数三条不变式(§5.4,服务端强制)", () => {
  it("能力只减:guest 子代派 owner 孙代 → CAPABILITY;合法派生 trust 随链只降", async () => {
    const w = await boot();
    try {
      // 根(owner)→ 子 guest(合法)
      const h = await w.spawner.spawn(w.rootAgentId, { goal: "c", trust: "guest", budget: { maxSteps: 4 } });
      expect(w.spawner.meta(h.agentId)!.trust).toBe("guest");
      w.settled.push(h.result);
      // 子 guest → 孙 owner:越界拒绝
      await expect(w.spawner.spawn(h.agentId, { goal: "g", trust: "owner", budget: { maxSteps: 2 } }))
        .rejects.toMatchObject({ code: "CAPABILITY" });
      // 孙 known 同样越界;孙 guest 合法
      await expect(w.spawner.spawn(h.agentId, { goal: "g2", trust: "known", budget: { maxSteps: 2 } }))
        .rejects.toMatchObject({ code: "CAPABILITY" });
      const h2 = await w.spawner.spawn(h.agentId, { goal: "g3", trust: "guest", budget: { maxSteps: 2 } });
      w.settled.push(h2.result);
    } finally { w.release(); await Promise.allSettled(w.settled); w.cleanup(); }
  });

  it("动刀权限只降:child.rCeiling > 父代 rLevel(默认 R2)→ R_CEILING;≤ 合法", async () => {
    const w = await boot();
    try {
      await expect(w.spawner.spawn(w.rootAgentId, { goal: "c", rCeiling: "R3", budget: { maxSteps: 2 } }))
        .rejects.toMatchObject({ code: "R_CEILING" });
      const h = await w.spawner.spawn(w.rootAgentId, { goal: "c2", rCeiling: "R2", budget: { maxSteps: 2 } });
      expect(w.spawner.meta(h.agentId)!.rLevel).toBe("R2");
      w.settled.push(h.result);
    } finally { w.release(); await Promise.allSettled(w.settled); w.cleanup(); }
  });

  it("配额递减:child.maxSteps ≥ 剩余 → BUDGET;活子代占用配额,并行第二子受限", async () => {
    const w = await boot(8);
    try {
      await expect(w.spawner.spawn(w.rootAgentId, { goal: "c", budget: { maxSteps: 8 } }))
        .rejects.toMatchObject({ code: "BUDGET" });
      w.settled.push((await w.spawner.spawn(w.rootAgentId, { goal: "c1", budget: { maxSteps: 5 } })).result); // 占 5
      expect(w.spawner.remainingOf(w.rootAgentId).maxSteps).toBe(3);
      await expect(w.spawner.spawn(w.rootAgentId, { goal: "c2", budget: { maxSteps: 4 } }))
        .rejects.toMatchObject({ code: "BUDGET" }); // 4 > 剩余 3
      w.settled.push((await w.spawner.spawn(w.rootAgentId, { goal: "c3", budget: { maxSteps: 2 } })).result); // 恰可
    } finally { w.release(); await Promise.allSettled(w.settled); w.cleanup(); }
  });
});

describe("深度软限/硬顶(INC3)", () => {
  it("无批准:链在 depth=4 派生时被 APPROVAL_DENIED 截断;agent.spawn 条目 ≤ 软限", async () => {
    const w = await boot();
    try {
      let current = w.rootAgentId;
      const codes: string[] = [];
      for (const steps of [5, 4, 3, 2, 1]) {
        try {
          const h = await w.spawner.spawn(current, { goal: "chain", budget: { maxSteps: steps } });
          w.settled.push(h.result);
          current = h.agentId;
        } catch (err) { codes.push((err as SpawnerError).code); break; }
      }
      expect(codes).toEqual(["APPROVAL_DENIED"]);
      const depths = w.spawner.list().map((m) => m.depth);
      expect(Math.max(...depths)).toBe(SPAWN_DEPTH_SOFT_LIMIT);
      const spawns = w.kernel.store.all.filter((e) => e.kind === "agent.spawn");
      expect(spawns).toHaveLength(SPAWN_DEPTH_SOFT_LIMIT + 1); // 根(0)+子(1..3),depth4 派生被拒
      // 投影:派生树完整(隐式 branch+session 补行,FK 通过)
      const rows = w.projection.db.prepare(`SELECT id, depth, state FROM agents ORDER BY depth`).all() as { id: string; depth: number; state: string }[];
      expect(rows).toHaveLength(SPAWN_DEPTH_SOFT_LIMIT + 1);
      expect(rows.every((r) => r.state === "running")).toBe(true);
    } finally { w.release(); await Promise.allSettled(w.settled); w.cleanup(); }
  });

  it("有批准:软限外可派(批准落 review_events + depth_approval_ref 随 spawn 入账);硬顶 5 仍拒", async () => {
    const approvals: string[] = [];
    const w = await boot(8, () => { approvals.push("yes"); return "owner-cli 批准"; });
    try {
      let current = w.rootAgentId;
      const got: number[] = [];
      for (const steps of [5, 4, 3, 2, 1, 1]) {
        try {
          const h = await w.spawner.spawn(current, { goal: "chain", budget: { maxSteps: steps } });
          w.settled.push(h.result);
          got.push(w.spawner.meta(h.agentId)!.depth);
          current = h.agentId;
        } catch (err) {
          expect((err as SpawnerError).code).toBe("DEPTH_HARD");
          break;
        }
      }
      expect(Math.max(...got)).toBe(SPAWN_DEPTH_HARD_LIMIT);
      expect(approvals).toHaveLength(SPAWN_DEPTH_HARD_LIMIT - SPAWN_DEPTH_SOFT_LIMIT);
      const rv = w.projection.db.prepare(`SELECT count(*) AS n FROM review_events`).get() as { n: number };
      expect(rv.n).toBeGreaterThanOrEqual(2);
      const deep = w.kernel.store.all.find((e) => e.kind === "agent.spawn" && (e.payload as { depth?: number }).depth === 4);
      expect((deep!.payload as { depth_approval_ref?: string }).depth_approval_ref).toMatch(/^seq:/);
    } finally { w.release(); await Promise.allSettled(w.settled); w.cleanup(); }
  });
});

describe("kill 回收(§5.4:卸载插件树;人走茶不凉)", () => {
  it("kill:中止子代、其效应 LIFO 回滚、环境哈希复原、配额归还、intervene.kill 入账+投影 killed", async () => {
    const w = await boot();
    const childId = `ag_c_${Math.random().toString(36).slice(2, 8)}`;
    w.settled.push(runTask(w.kernel, {
      goal: "child", sessionKey: SESSION, runtimePluginId: "llm-gated@1.0.0",
      actor: ACTOR, maxSteps: 2, agentId: childId,
      parent: { agentId: w.rootAgentId, depth: 1 }, spawner: w.spawner,
    }));
    await new Promise((r) => setTimeout(r, 20));
    const before = w.env.hash();
    // 子代运行中产生的可逆效应(归属 child agent)
    w.kernel.contextFor("llm-gated@1.0.0", { kind: "agent", id: childId }).effect(
      "子代写环境", () => { w.env.set("k", "dirty"); return undefined; },
      () => { w.env.del("k"); });
    expect(w.spawner.remainingOf(w.rootAgentId).maxSteps).toBe(6);

    // kill 走宽限路径(abort 已置);随后放门让任务在步边界退出
    const summary = await w.spawner.kill(childId, ACTOR);
    w.release();

    expect(summary.reverted).toHaveLength(1);
    expect(w.env.hash()).toBe(before);                     // 出口标准②:无残留
    expect(w.spawner.meta(childId)!.state).toBe("killed");
    expect(w.spawner.remainingOf(w.rootAgentId).maxSteps).toBe(8); // 配额归还
    expect(w.kernel.store.all.some((e) => e.kind === "intervene.kill" && e.ref?.agent === childId)).toBe(true);
    const row = w.projection.db.prepare(`SELECT state FROM agents WHERE id=?`).get(childId) as { state: string };
    expect(row.state).toBe("killed");
    await Promise.allSettled(w.settled);
    w.cleanup();
  });

  it("树形 kill:kill 父代递归回收活子代,全树环境哈希复原", async () => {
    const w = await boot();
    const a = await spawnHeld(w, w.rootAgentId, 1, 3);
    const b = await spawnHeld(w, w.rootAgentId, 1, 3);
    const a1 = await spawnHeld(w, a, 2, 2);
    const b1 = await spawnHeld(w, b, 2, 2);
    const before = w.env.hash();
    for (const [id, key] of [[a, "a"], [b, "b"], [a1, "a1"], [b1, "b1"]] as [string, string][]) {
      w.kernel.contextFor("llm-gated@1.0.0", { kind: "agent", id }).effect(
        `写 ${key}`, () => { w.env.set(key, "dirty"); return undefined; },
        () => { w.env.del(key); });
    }
    // 门保持关闭:kill 经宽限超时路径回收(abort 已置,子任务稍后在步边界退出)
    await Promise.all([w.spawner.kill(a, ACTOR), w.spawner.kill(b, ACTOR)]);
    w.release();
    expect(w.env.hash()).toBe(before);
    expect([a, b, a1, b1].every((id) => w.spawner.meta(id)!.state === "killed")).toBe(true);
    await Promise.allSettled(w.settled);
    w.cleanup();
  });
});

describe("派生树穷尽(出口标准①)", () => {
  it("随机树:任意 spawn 序列,不变式逐节点成立,有限步终止(配额+深度双保险)", async () => {
    for (const seed of [1, 7, 42, 2026]) {
      const r = rng(seed);
      const w = await boot(8);
      try {
        const live = new Set<string>([w.rootAgentId]);
        let ops = 0;
        while (live.size > 0 && ops < 300) {
          ops += 1;
          const pick = [...live][Math.floor(r() * live.size)]!;
          const ceil = ["R0", "R1", "R2", "R3", "R4"][Math.floor(r() * 5)] as "R0" | "R4";
          try {
            const h = await w.spawner.spawn(pick, { goal: "leaf", rCeiling: ceil, budget: { maxSteps: 1 + Math.floor(r() * 4) } });
            w.settled.push(h.result);
            const m = w.spawner.meta(h.agentId)!;
            const pm = w.spawner.meta(pick)!;
            expect(m.depth).toBeLessThanOrEqual(SPAWN_DEPTH_HARD_LIMIT);
            expect(m.budget.maxSteps).toBeLessThanOrEqual(pm.budget.maxSteps); // 配额不增
            const R = ["R0", "R1", "R2", "R3", "R4", "R5"];
            if (R.indexOf(ceil) <= R.indexOf(pm.rLevel)) live.add(res.agentId); // 服务端已拒越界
          } catch { live.delete(pick); }
        }
        expect(ops).toBeLessThan(300); // 终止性
        const depths = w.spawner.list().map((m) => m.depth);
        expect(Math.max(...depths)).toBeLessThanOrEqual(SPAWN_DEPTH_HARD_LIMIT);
      } finally { w.release(); await Promise.allSettled(w.settled); w.cleanup(); }
    }
  });
});
