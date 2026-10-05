// 三分类效应契约(附录 K.1 / INV-2 系统内限定)
// class 0 可逆:apply→revert 环境哈希不变(§3.4 契约测试)
// class 1 可补偿:补偿动作执行并记 effect.compensate,不作状态复原承诺
// class 2 不可逆:无前置审批即拒(PREAPPROVAL_REQUIRED);回滚时如实上报不可撤销

import { describe, expect, it } from "vitest";
import { Kernel } from "../src/kernel/kernel.js";
import type { LedgerActor } from "../src/kernel/types.js";
import { HashEnv, makePlugin, tmpStore } from "./helpers.js";

const ACTOR: LedgerActor = { kind: "human", id: "owner-test", trust: "owner" };

describe("K.1 副作用三分类", () => {
  it("class 0:revert 后环境哈希恢复(契约测试原型)", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const env = new HashEnv();
    const before = env.hash();

    let ctxRef: import("../src/kernel/kernel.js").KernelContext | undefined;
    const { manifest, module } = makePlugin({
      name: "p-rev",
      onStart: (ctx) => {
        ctxRef = ctx;
        ctx.provide({ name: "p-rev.svc" } as never, {});
      },
    });
    kernel.install(manifest, module);
    await kernel.activate("p-rev@1.0.0");
    await ctxRef!.effect("写 env:k=v",
      () => { const snap = env.snapshot(); env.set("k", "v"); return snap; }, // 捕获前置状态
      (snap) => env.restore(snap as Map<string, string>));

    expect(env.hash()).not.toBe(before); // apply 生效
    const summary = await kernel.revertOwner({ kind: "plugin", id: "p-rev@1.0.0" }, ACTOR);
    expect(summary.reverted).toHaveLength(1);
    expect(env.hash()).toBe(before);      // 精确复原
    expect(store.verifyChain().ok).toBe(true);
    const kinds = store.all.map((e) => e.kind);
    expect(kinds).toContain("effect.apply");
    expect(kinds).toContain("effect.revert");
    cleanup();
  });

  it("class 1:补偿执行并记 effect.compensate(不承诺状态全等)", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const sent: string[] = [];

    let ctxRef: import("../src/kernel/kernel.js").KernelContext | undefined;
    const { manifest, module } = makePlugin({
      name: "p-comp",
      onStart: (ctx) => { ctxRef = ctx; ctx.provide({ name: "p-comp.svc" } as never, {}); },
    });
    kernel.install(manifest, module);
    await kernel.activate("p-comp@1.0.0");
    await ctxRef!.effect("发通知(外部不可撤,补偿=发更正)",
      () => { sent.push("原通知"); return "原通知" as const; },
      (m) => { sent.push(`更正:${m}`); },
      { rClass: 1 });

    const summary = await kernel.revertOwner({ kind: "plugin", id: "p-comp@1.0.0" }, ACTOR);
    expect(summary.compensated).toHaveLength(1);
    expect(summary.reverted).toHaveLength(0);
    expect(sent).toEqual(["原通知", "更正:原通知"]); // 补偿 ≠ 复原:留下完整痕迹
    expect(store.all.map((e) => e.kind)).toContain("effect.compensate");
    cleanup();
  });

  it("class 2:无前置审批 → 拒绝;有审批 → 放行且回滚时如实上报不可撤销", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    let deleted = false;

    let ctxRef: import("../src/kernel/kernel.js").KernelContext | undefined;
    const { manifest, module } = makePlugin({
      name: "p-irr",
      onStart: (ctx) => { ctxRef = ctx; ctx.provide({ name: "p-irr.svc" } as never, {}); },
    });
    kernel.install(manifest, module);
    await kernel.activate("p-irr@1.0.0");

    // 同步快速失败:审批缺失在 apply 之前同步抛出,不留半截副作用
    expect(() => ctxRef!.irreversible("删库", 999999, () => { deleted = true; }))
      .toThrow(/PREAPPROVAL_REQUIRED/); // 伪造 seq 无效
    expect(deleted).toBe(false);

    const approvalSeq = kernel.preapprove("删库(双人复核)", ACTOR, { target: "db.x" });
    await ctxRef!.irreversible("删库", approvalSeq, () => { deleted = true; });
    expect(deleted).toBe(true);

    const summary = await kernel.revertOwner({ kind: "plugin", id: "p-irr@1.0.0" }, ACTOR);
    expect(summary.irreversibleSkipped).toHaveLength(1); // 不伪造撤销
    expect(deleted).toBe(true);                            // 既成事实保留
    expect(store.all.map((e) => e.kind)).toContain("effect.preapproval");
    cleanup();
  });

  it("LIFO:同 owner 多效应按逆序回滚", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const order: string[] = [];

    let ctxRef: import("../src/kernel/kernel.js").KernelContext | undefined;
    const { manifest, module } = makePlugin({
      name: "p-lifo",
      onStart: (ctx) => { ctxRef = ctx; ctx.provide({ name: "p-lifo.svc" } as never, {}); },
    });
    kernel.install(manifest, module);
    await kernel.activate("p-lifo@1.0.0");
    for (const step of ["a", "b", "c"]) {
      await ctxRef!.effect(`step-${step}`,
        () => { order.push(`apply:${step}`); return step; },
        () => { order.push(`revert:${step}`); });
    }
    await kernel.revertOwner({ kind: "plugin", id: "p-lifo@1.0.0" }, ACTOR);
    expect(order).toEqual(["apply:a", "apply:b", "apply:c", "revert:c", "revert:b", "revert:a"]);
    cleanup();
  });

  it("owner 归属(GAP1):agent 效应独立成栈,revertOwner(agent) 不碰插件效应", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const touched: string[] = [];

    let ctxRef: import("../src/kernel/kernel.js").KernelContext | undefined;
    const { manifest, module } = makePlugin({
      name: "p-owner",
      onStart: (ctx) => { ctxRef = ctx; ctx.provide({ name: "p-owner.svc" } as never, {}); },
    });
    kernel.install(manifest, module);
    await kernel.activate("p-owner@1.0.0");
    await ctxRef!.effect("插件自身效应", () => 1, () => { touched.push("plugin"); });
    await ctxRef!.effect("ag_1 的工具调用效应", () => 2, () => { touched.push("agent"); },
      { owner: { kind: "agent", id: "ag_1" } });

    const summary = await kernel.revertOwner({ kind: "agent", id: "ag_1" }, ACTOR);
    expect(summary.reverted).toHaveLength(1);
    expect(touched).toEqual(["agent"]);       // 只动了 agent 的栈
    expect(kernel.effectRecord(summary.reverted[0]!)!.ownerId).toBe("ag_1");
    expect(kernel.observable().chainOk).toBe(true);
    cleanup();
  });

  it("恢复态效应回滚 → 诚实拒绝:不写 revert 条目、状态不变(账本诚实回归测试)", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const env: string[] = [];

    let ctxRef: import("../src/kernel/kernel.js").KernelContext | undefined;
    const { manifest, module } = makePlugin({
      name: "p-rec",
      onStart: (ctx) => {
        ctxRef = ctx;
        ctx.provide({ name: "p-rec.svc" } as never, {});
      },
    });
    kernel.install(manifest, module);
    await kernel.activate("p-rec@1.0.0");
    await ctxRef!.effect("恢复态将被回滚的效应",
      () => { env.push("applied"); return 1; },
      () => { env.push("reverted"); },
      { owner: { kind: "agent", id: "ag_r" } });

    // 崩溃:丢弃内存态,仅账本幸存 → 重放恢复(效应记录无运行时句柄)
    const { kernel: recovered } = Kernel.recover(store);
    const revertsBefore = store.all.filter((e) => e.kind === "effect.revert").length;
    const summary = await recovered.revertOwner({ kind: "agent", id: "ag_r" }, ACTOR);

    expect(summary.unrebound).toHaveLength(1);        // 诚实上报:无法回滚
    expect(summary.reverted).toHaveLength(0);
    expect(store.all.filter((e) => e.kind === "effect.revert").length).toBe(revertsBefore); // 不伪造条目
    const rec = recovered.effectRecord(summary.unrebound[0]!)!;
    expect(rec.status).toBe("applied");               // 状态不被谎言污染
    expect(env).toEqual(["applied"]);                  // revertFn(不存在)从未执行
    expect(store.verifyChain().ok).toBe(true);
    cleanup();
  });

  it("rollbackTo:整账本回滚到早期位置,marker 入账", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const env = new HashEnv();
    const before = env.hash();

    let ctxRef: import("../src/kernel/kernel.js").KernelContext | undefined;
    const { manifest, module } = makePlugin({
      name: "p-rb",
      onStart: (ctx) => { ctxRef = ctx; ctx.provide({ name: "p-rb.svc" } as never, {}); },
    });
    kernel.install(manifest, module);
    await kernel.activate("p-rb@1.0.0");
    const anchorSeq = store.lastSeq;
    await ctxRef!.effect("写 env",
      () => { const snap = env.snapshot(); env.set("k", "v"); return snap; },
      (snap) => env.restore(snap as Map<string, string>));

    const summary = await kernel.rollbackTo(anchorSeq, ACTOR);
    expect(summary.reverted).toHaveLength(1);
    expect(env.hash()).toBe(before);
    const kinds = store.all.map((e) => e.kind);
    expect(kinds).toContain("rollback.marker");
    expect(store.verifyChain().ok).toBe(true);
    cleanup();
  });
});
