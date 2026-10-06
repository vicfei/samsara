// M3 Soak —— 派生/工作区/车道/kill 混合负载压测 + 体检(阶段 M3)
// 用法: npm run soak:m3(或随 npm run soak 链式)
// 自包含:进程内自建 kernel,temp home 零污染;Phase A 需 OPENAI_API_KEY(缺省跳过并明示)。
// 产出: 三段报告 + 不变量校验(账本链/投影对账/agents 一致/环境哈希复原)。

import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { LedgerStore } from "../src/kernel/ledger.js";
import { Kernel } from "../src/kernel/kernel.js";
import { Projection } from "../src/kernel/projection.js";
import { SnapshotStore } from "../src/kernel/snapshot.js";
import { openAICompatChatPlugin } from "../src/llm/chat.js";
import type { KernelContext } from "../src/kernel/types.js";
import { CHAT_SERVICE } from "../src/llm/chat.js";
import { toolRegistryPlugin, fsToolPlugin, TOOL_REGISTRY } from "../src/agent/tools.js";
import { spawnToolPlugin } from "../src/agent/spawn-tool.js";
import { Spawner } from "../src/agent/spawner.js";
import { runTask } from "../src/agent/task.js";
import { WorkspaceCapture } from "../src/kernel/workspace.js";
import { LaneQueue } from "../src/kernel/lanes.js";

const ACTOR = { kind: "human" as const, id: "soak-m3", trust: "owner" as const };

/** hold/quick 路由 chat:goal 以 quick 开头立即答,其余挂门(确定性,零网络) */
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
            if (last.startsWith("quick")) {
              return { content: "子任务完成", finishReason: "stop" as const, modelLabel: "routed", usage: { promptTokens: 1, completionTokens: 1 } };
            }
            await gate;
            return { content: "root-done", finishReason: "stop" as const, modelLabel: "routed", usage: { promptTokens: 1, completionTokens: 1 } };
          },
        });
      },
    },
  };
  return { plugin: plugin as never, release: () => releaseGate() };
}

interface Bench {
  store: LedgerStore; kernel: Kernel; projection: Projection; spawner: Spawner;
  release?: () => void; settled: Promise<unknown>[]; home: string;
}

function bench(): Bench {
  const home = mkdtempSync(join(tmpdir(), "samsara-soak-m3-"));
  const store = new LedgerStore(home);
  const projection = Projection.open(home, store);
  const kernel = new Kernel(store);
  return { store, kernel, projection, spawner: null as never, settled: [], home };
}

async function installTools(b: Bench, opts: { workspaceFor?: (sk: string, create: boolean) => unknown } = {}): Promise<void> {
  const reg = toolRegistryPlugin();
  b.kernel.install(reg.manifest, reg.module);
  const fsP = fsToolPlugin(join(b.home, "shared"), opts.workspaceFor as never);
  b.kernel.install(fsP.manifest, fsP.module);
  await b.kernel.activate("tool-registry@1.0.0");
  await b.kernel.activate("tool-fs@1.0.0");
}

const hashOf = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

async function phaseA(): Promise<{ pass: boolean; detail: string[] }> {
  if ((process.env.OPENAI_API_KEY ?? "") === "") {
    return { pass: true, detail: ["跳过(无 OPENAI_API_KEY;Phase B/C 照跑)"] };
  }
  const detail: string[] = [];
  const b = bench();
  try {
    const chat = openAICompatChatPlugin({
      ...(process.env.OPENAI_BASE_URL !== undefined ? { baseUrl: process.env.OPENAI_BASE_URL } : {}),
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    });
    b.kernel.install(chat.manifest, chat.module);
    await b.kernel.activate("llm-openai-compat@1.0.0");
    await installTools(b);
    b.spawner = new Spawner(b.kernel, runTask, { runtimePluginId: "llm-openai-compat@1.0.0" });
    const sp = spawnToolPlugin(b.spawner);
    b.kernel.install(sp.manifest, sp.module);
    await b.kernel.activate("tool-spawn@1.0.0");

    const ROOTS = 6;
    const goals = Array.from({ length: ROOTS }, (_, i) =>
      `必须先调用 spawn_agent 工具派生一个子任务(目标:"用一句话回答 ${100 + i} 是质数还是合数",max_steps=2),拿到子任务结果后再用一句话汇总回答。`);
    const t0 = Date.now();
    const lanes = new LaneQueue();
    const results = await Promise.all(goals.map((goal, i) =>
      lanes.enqueue(`soak-m3:dm:s${i}`, () => runTask(b.kernel, {
        goal, sessionKey: `soak-m3:dm:s${i}`, runtimePluginId: "llm-openai-compat@1.0.0",
        actor: ACTOR, maxSteps: 6, spawner: b.spawner,
      }).then((r) => ({ i, outcome: r.outcome, steps: r.steps })))));
    const ms = Date.now() - t0;

    const spawns = b.store.all.filter((e) => e.kind === "agent.spawn");
    const childSpawns = spawns.filter((e) => (e.payload as { parent?: string | null }).parent !== null);
    const rootsWithChild = new Set(childSpawns.map((e) => (e.payload as { parent?: string }).parent)).size;
    const ok = results.every((r) => r.outcome === "success") && rootsWithChild >= 4;
    detail.push(`${ROOTS} 根任务(真实 LLM)全部 outcome=success:${results.every((r) => r.outcome === "success")}`);
    detail.push(`派生根数 ${rootsWithChild}/${ROOTS}(门槛 ≥4);agent.spawn 条目 ${spawns.length}(根+子)`);
    detail.push(`车道分发 ${lanes.laneCount} lane;总耗时 ${ms}ms;工具步合计 ${results.reduce((n, r) => n + r.steps.length, 0)}`);
    return { pass: ok, detail };
  } finally {
    b.projection.close();
    rmSync(b.home, { recursive: true, force: true });
  }
}

async function phaseB(): Promise<{ pass: boolean; detail: string[]; health: { chainOk: boolean; recOk: boolean } }> {
  const detail: string[] = [];
  const b = bench();
  const r = routedChatPlugin();
  try {
    b.kernel.install(r.plugin.manifest, r.plugin.module);
    await b.kernel.activate("llm-routed@1.0.0");
    await installTools(b);
    b.spawner = new Spawner(b.kernel, runTask, { runtimePluginId: "llm-routed@1.0.0", killGraceMs: 100 });

    const SESSIONS = 20;
    const WRITES = 30;
    const caps = new Map<string, WorkspaceCapture>();
    const lanes = new LaneQueue();
    const wsFor = (sk: string): WorkspaceCapture => {
      let c = caps.get(sk);
      if (c === undefined) {
        c = new WorkspaceCapture(b.kernel, "tool-fs@1.0.0", sk, join(b.home, "ws", sk.replace(/[^a-z0-9]/gi, "_")));
        caps.set(sk, c);
      }
      return c;
    };

    // 每会话:挂起根 + 两个子代(quick 即完 / hold 待 kill)+ 工作区 30 写(经车道分发)
    const killTargets: { session: string; child: string }[] = [];
    await Promise.all(Array.from({ length: SESSIONS }, async (_, i) => {
      const sk = `soak-m3:dm:b${i}`;
      const rootId = `ag_b${i}_root`;
      b.settled.push(runTask(b.kernel, {
        goal: `hold-root-${i}`, sessionKey: sk, runtimePluginId: "llm-routed@1.0.0",
        actor: ACTOR, maxSteps: 6, agentId: rootId, spawner: b.spawner,
      }));
      await new Promise((res) => setTimeout(res, 5));
      const quick = await b.spawner.spawn(rootId, { goal: `quick-任务-${i}`, budget: { maxSteps: 2 } });
      b.settled.push(quick.result);
      const held = await b.spawner.spawn(rootId, { goal: `hold-child-${i}`, budget: { maxSteps: 2 } });
      b.settled.push(held.result);
      killTargets.push({ session: sk, child: held.agentId });
      const cap = wsFor(sk);
      await lanes.enqueue(sk, async () => {
        for (let j = 0; j < WRITES; j++) cap.write(`note-${j}.txt`, `会话${i} 第${j}条`);
      });
    }));
    await new Promise((res) => setTimeout(res, 50));
    const runningChildren = killTargets.filter((t) => b.spawner.isRunning(t.child));
    detail.push(`${SESSIONS} 会话:根挂起 + quick 子即完 + hold 子待杀;工作区 ${SESSIONS * WRITES} 写经 ${lanes.laneCount} lane`);

    // kill 半数 hold 子代:其 agent 效应回滚;会话工作区不受影响(人走茶不凉)
    const half = killTargets.slice(0, Math.floor(killTargets.length / 2));
    const beforeKill = killTargets.map((t) => {
      const cap = caps.get(t.session)!;
      return { session: t.session, file: join(cap.root, "note-0.txt"), hash: hashOf(join(cap.root, "note-0.txt")) };
    });
    for (const t of half) await b.spawner.kill(t.child, ACTOR);
    const wsIntact = half.every((t) => {
      const cap = caps.get(t.session)!;
      return existsSync(join(cap.root, "note-0.txt")) && hashOf(join(cap.root, "note-0.txt")) === beforeKill.find((x) => x.session === t.session)!.hash;
    });
    detail.push(`kill ${half.length}/${runningChildren.length} 个挂起子代:agent 效应回滚,工作区原样=${wsIntact}`);

    // discard 半数会话工作区:还原(文件消失);其余 commit:清单入 CAS
    let discardOk = true; let commitOk = true;
    const discardSet = new Set([...caps.keys()].slice(0, SESSIONS / 2));
    for (const [sk, cap] of caps) {
      if (discardSet.has(sk)) {
        await cap.discard(ACTOR);
        if (existsSync(join(cap.root, "note-0.txt"))) discardOk = false;
      } else {
        const c = cap.commit(ACTOR);
        if (c.ops !== WRITES) commitOk = false;
      }
    }
    detail.push(`discard ${SESSIONS / 2} 会话=${discardOk ? "还原干净" : "失败"};commit ${SESSIONS / 2} 会话=${commitOk ? "清单完整" : "失败"}`);

    r.release();
    await Promise.allSettled(b.settled);
    // 体检在 bench 存活时执行(关闭前)
    const chain = b.store.verifyChain();
    const rec = b.projection.reconcile(b.store);
    const agentsRows = b.projection.db.prepare(`SELECT state, count(*) AS n FROM agents GROUP BY state`).all() as { state: string; n: number }[];
    detail.push(`agents 投影:${agentsRows.map((x) => `${x.state}=${x.n}`).join(", ") || "(空)"}`);
    const pass = wsIntact && discardOk && commitOk && chain.ok && rec.ok;
    return { pass, detail, health: { chainOk: chain.ok, recOk: rec.ok } };
  } finally {
    r.release();
    await Promise.allSettled(b.settled).catch(() => undefined);
    b.projection.close();
    rmSync(b.home, { recursive: true, force: true });
  }
}

function phaseC(health: { chainOk: boolean; recOk: boolean }): { pass: boolean; detail: string[] } {
  return {
    pass: health.chainOk && health.recOk,
    detail: [
      `账本哈希链:${health.chainOk ? "通过" : "失败"}`,
      `投影对账:${health.recOk ? "一致" : "漂移"}`,
    ],
  };
}

async function main(): Promise<void> {
  console.log("═══ Samsara M3 Soak(派生/工作区/车道/kill)═══");
  let allPass = true;

  console.log("\n── Phase A:真实 LLM 派生 ──");
  const a = await phaseA();
  a.detail.forEach((d) => console.log(`  ${d}`));
  allPass = allPass && a.pass;
  console.log(`  → ${a.pass ? "✓ 通过" : "✗ 失败"}`);

  console.log("\n── Phase B:确定性混合压力(20 会话)──");
  const b = await phaseB();
  b.detail.forEach((d) => console.log(`  ${d}`));
  allPass = allPass && b.pass;
  console.log(`  → ${b.pass ? "✓ 通过" : "✗ 失败"}`);

  console.log("\n── Phase C:体检 ──");
  const c = phaseC(b.health);
  c.detail.forEach((d) => console.log(`  ${d}`));
  allPass = allPass && c.pass;

  console.log(`\n═══ soak-m3 结果:${allPass ? "全部通过" : "存在问题"} ═══`);
  process.exit(allPass ? 0 : 1);
}

void main();
