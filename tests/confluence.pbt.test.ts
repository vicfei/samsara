// INV-1 汇流性 PBT(§3.4):任意激活/停用序列的静止态 ≡ 按依赖序一次性组合最终集合的状态。
// 可观测态取 {activeIds, services}(非活跃的"为何非活跃"不属于汇流性断言范围)。
// M0 出口标准之一。

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Kernel } from "../src/kernel/kernel.js";
import { makePlugin, tmpStore } from "./helpers.js";

interface Spec { n: number; reqIdx: number[][] }
interface Op { target: number; op: "activate" | "suspend" }

const arbSpec: fc.Arbitrary<Spec> = fc.record({
  n: fc.integer({ min: 1, max: 6 }),
  reqIdx: fc.array(fc.array(fc.integer({ min: 0, max: 5 })), { minLength: 0, maxLength: 6 }),
});

const arbOps: fc.Arbitrary<Op[]> = fc.array(
  fc.record({
    target: fc.integer({ min: 0, max: 5 }),
    op: fc.constantFrom("activate" as const, "suspend" as const),
  }), { maxLength: 30 },
);

function buildPlugins(spec: Spec) {
  return Array.from({ length: spec.n }, (_, i) => {
    const deps = [...new Set((spec.reqIdx[i] ?? []).filter((j) => j < i))].map((j) => `p${j}.svc`);
    return makePlugin({ name: `p${i}`, requires: deps });
  });
}

describe("INV-1 汇流性(property-based)", () => {
  it("任意 activate/suspend 序列的静止态 ≡ 一次性组合最终请求集", async () => {
    await fc.assert(
      fc.asyncProperty(arbSpec, arbOps, async (spec, rawOps) => {
        const plugins = buildPlugins(spec);
        const ops = rawOps.filter((o) => o.target < spec.n);

        // 轨迹 A:随机序列
        const ta = tmpStore();
        const kernelA = new Kernel(ta.store);
        for (const p of plugins) kernelA.install(p.manifest, p.module);
        const requested = new Set<string>();
        for (const op of ops) {
          const id = `p${op.target}@1.0.0`;
          if (op.op === "activate") { requested.add(id); await kernelA.activate(id); }
          else { requested.delete(id); await kernelA.suspend(id); }
        }

        // 轨迹 B:一次性组合"最终请求集"(依赖序由内核反应式解析)
        const tb = tmpStore();
        const kernelB = new Kernel(tb.store);
        for (const p of plugins) kernelB.install(p.manifest, p.module);
        for (const id of requested) await kernelB.activate(id);

        const obsA = kernelA.observable();
        const obsB = kernelB.observable();
        expect(obsA.activeIds).toEqual(obsB.activeIds);
        expect(obsA.services).toEqual(obsB.services);
        expect(obsA.chainOk && obsB.chainOk).toBe(true);

        ta.cleanup(); tb.cleanup();
      }), { numRuns: 150 },
    );
  });

  it("静止性:静止后无操作则状态不再变化(无隐藏振荡)", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const plugins = buildPlugins({ n: 4, reqIdx: [[], [0], [0, 1], [2]] });
    for (const p of plugins) kernel.install(p.manifest, p.module);
    // 依赖语义:requires ≠ 代为激活——依赖方必须自身被请求;
    // 逆序请求 p3→p2→p1→p0,全部就位后反应式按依赖序整体拉起
    await kernel.activate("p3@1.0.0");
    await kernel.activate("p2@1.0.0");
    await kernel.activate("p1@1.0.0");
    expect(kernel.observable().activeIds).toEqual([]); // 全部在等待 p0

    await kernel.activate("p0@1.0.0"); // 根就绪 → p1→p2→p3 依次自动激活
    const s1 = kernel.observable();
    const s2 = kernel.observable(); // 无操作再读一次:静止
    expect(s1.activeIds).toEqual(s2.activeIds);
    expect(s1.activeIds).toEqual(["p0@1.0.0", "p1@1.0.0", "p2@1.0.0", "p3@1.0.0"]);
    cleanup();
  });
});
