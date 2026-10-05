// 快照 + 增量重放(数据模型 §3.2/§9)
//  核心等价性:Kernel.boot(最近快照 + 尾部重放) ≡ Kernel.recover(全量重放)
//  触发规则、轮换(最近 7 + 每月 1)、投影快照加速重建同样钉死。

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LedgerStore } from "../src/kernel/ledger.js";
import { Kernel } from "../src/kernel/kernel.js";
import { Projection } from "../src/kernel/projection.js";
import { SnapshotStore } from "../src/kernel/snapshot.js";
import { makePlugin, rng, tmpStore } from "./helpers.js";

describe("快照创建与内容", () => {
  it("create:三件套落盘,manifest 完整,内核簿记可读", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const p = Projection.open(t.dir, t.store);
    const snaps = new SnapshotStore(t.dir);

    const a = makePlugin({ name: "a" });
    kernel.install(a.manifest, a.module);
    await kernel.activate("a@1.0.0");
    const snap = snaps.create(kernel, p, t.store);

    expect(snap.seq).toBe(t.store.lastSeq);
    expect(existsSync(join(snap.dir, "manifest.json"))).toBe(true);
    expect(existsSync(join(snap.dir, "kernel-state.json"))).toBe(true);
    expect(existsSync(join(snap.dir, "index.sqlite"))).toBe(true);
    const state = snaps.loadKernelState(snap) as { plugins: { id: string; state: string }[] };
    expect(state.plugins[0]!.state).toBe("active");
    p.close(); t.cleanup();
  });
});

describe("核心等价性:boot(快照+尾) ≡ recover(全量)", () => {
  it("随机操作序列 + 随机快照点,两种引导方式终态一致", async () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = rng(seed);
      const t = tmpStore();
      const kernel = new Kernel(t.store);
      const p = Projection.open(t.dir, t.store);
      const snaps = new SnapshotStore(t.dir);

      const plugins = Array.from({ length: 4 }, (_, i) =>
        makePlugin({ name: `p${i}`, requires: i > 0 && r() < 0.7 ? [`p${i - 1}.svc`] : [] }));
      for (const pl of plugins) kernel.install(pl.manifest, pl.module);

      const ops = Array.from({ length: 10 }, () => ({
        target: Math.floor(r() * 4),
        op: r() < 0.65 ? "activate" : "suspend",
      }));
      const snapAt = 1 + Math.floor(r() * (ops.length - 1));
      for (let k = 0; k < ops.length; k++) {
        if (k === snapAt) snaps.create(kernel, p, t.store);
        const id = `p${ops[k]!.target}@1.0.0`;
        await (ops[k]!.op === "activate" ? kernel.activate(id) : kernel.suspend(id));
      }

      const booted = Kernel.boot(t.store, snaps);
      const recovered = Kernel.recover(t.store);
      expect(booted.fromSnapshot, `seed=${seed}`).not.toBeNull();
      expect(booted.replayedCount, `seed=${seed} 尾部应短于全量`).toBeLessThan(t.store.all.length);

      const a = booted.kernel.observable();
      const b = recovered.kernel.observable();
      expect(a.pluginStates, `seed=${seed}`).toEqual(b.pluginStates);
      expect(a.activeIds).toEqual(b.activeIds);
      expect(a.services).toEqual(b.services);
      expect(booted.kernel.effectTimeline()).toEqual(recovered.kernel.effectTimeline());
      expect(booted.needsRebind).toEqual(recovered.needsRebind);

      p.close(); t.cleanup();
    }
  });

  it("快照损坏 → 自动退回全量重放(不崩)", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const p = Projection.open(t.dir, t.store);
    const snaps = new SnapshotStore(t.dir);
    const a = makePlugin({ name: "a" });
    kernel.install(a.manifest, a.module);
    await kernel.activate("a@1.0.0");
    const snap = snaps.create(kernel, p, t.store);
    rmSync(join(snap.dir, "kernel-state.json")); // 损坏

    const booted = Kernel.boot(t.store, snaps);
    expect(booted.fromSnapshot).toBeNull();          // 退回全量
    expect(booted.kernel.pluginState("a@1.0.0")).toBe("active");
    p.close(); t.cleanup();
  });
});

describe("触发规则与轮换(§3.2/§9)", () => {
  it("条数触发:everyEntries=5,第 5 条后自动快照", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const p = Projection.open(t.dir, t.store);
    const snaps = new SnapshotStore(t.dir, { everyEntries: 5, everyMs: Infinity });
    expect(snaps.maybeAutoCreate(kernel, p, t.store)).toBeNull(); // seq<5 不触发

    for (let i = 0; i < 4; i++) kernel.install(makePlugin({ name: `n${i}` }).manifest, undefined);
    expect(t.store.lastSeq).toBe(4);
    expect(snaps.maybeAutoCreate(kernel, p, t.store)).toBeNull(); // 4 < 5
    kernel.install(makePlugin({ name: "n4" }).manifest, undefined);
    const snap = snaps.maybeAutoCreate(kernel, p, t.store);
    expect(snap?.seq).toBe(5);
    p.close(); t.cleanup();
  });

  it("每日触发:everyMs=0,任何非空账本即触发", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const p = Projection.open(t.dir, t.store);
    const snaps = new SnapshotStore(t.dir, { everyMs: 0, everyEntries: Infinity });
    kernel.install(makePlugin({ name: "a" }).manifest, undefined);
    const snap = snaps.maybeAutoCreate(kernel, p, t.store);
    expect(snap?.seq).toBeGreaterThan(0);
    p.close(); t.cleanup();
  });

  it("轮换:超过 keep=7 后清理,保留最近 7 个(同月按最大 seq)", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const p = Projection.open(t.dir, t.store);
    const snaps = new SnapshotStore(t.dir, { keep: 7 });
    for (let i = 0; i < 10; i++) {
      kernel.install(makePlugin({ name: `x${i}` }).manifest, undefined);
      snaps.create(kernel, p, t.store);
    }
    const remaining = readdirSync(join(t.dir, "ledger", "snapshots")).filter((d) => d.startsWith("snapshot_"));
    expect(remaining.length).toBeLessThanOrEqual(7);
    expect(remaining).toContain("snapshot_10"); // 最新必留
    expect(remaining).not.toContain("snapshot_1"); // 最旧已清(同月)
    p.close(); t.cleanup();
  });
});

describe("投影快照加速重建", () => {
  it("删 index.sqlite → rebuild 走快照路径,结果 ≡ 删除前", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const p = Projection.open(t.dir, t.store);
    const snaps = new SnapshotStore(t.dir);
    const a = makePlugin({ name: "a" });
    const b = makePlugin({ name: "b", requires: ["a.svc"] });
    kernel.install(a.manifest, a.module);
    kernel.install(b.manifest, b.module);
    await kernel.activate("a@1.0.0");
    await kernel.activate("b@1.0.0");
    snaps.create(kernel, p, t.store);
    await kernel.suspend("b@1.0.0"); // 快照后追加(尾部)
    const before = p.dump();
    p.close();

    rmSync(join(t.dir, "ledger", "index.sqlite"));
    rmSync(join(t.dir, "ledger", "index.sqlite-wal"), { force: true });
    rmSync(join(t.dir, "ledger", "index.sqlite-shm"), { force: true });

    const p2 = Projection.open(t.dir, t.store);
    p2.rebuild(t.store); // 快照路径:恢复副本 + 追平尾部
    expect(p2.dump()).toEqual(before);
    expect(p2.reconcile(t.store).ok).toBe(true);
    p2.close(); t.cleanup();
  });
});
