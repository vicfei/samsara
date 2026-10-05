// SQLite 投影层(数据模型 §5/§7):读模型与账本的一致性
//  1. §5 DDL 全量落地(关键表存在);
//  2. plugin.*/effect.* 投影内容断言(状态机/owner/三分类/reinstall);
//  3. 增量投影 ≡ 全量重建(可重建性);
//  4. 重开追平:错过追加后重开,水位补齐、内容一致;
//  5. 崩溃等价:仅凭账本文件 + 全量重建 ≡ 活投影。

import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { LedgerStore } from "../src/kernel/ledger.js";
import { Kernel } from "../src/kernel/kernel.js";
import { Projection } from "../src/kernel/projection.js";
import { makePlugin, tmpStore } from "./helpers.js";

function openProjection(t: { dir: string }): Projection {
  return Projection.open(t.dir, new LedgerStore(t.dir)); // onAppend 挂在临时 store 上仅用于打开
}

describe("投影 schema(数据模型 §5)", () => {
  it("关键表全部存在(21 表 + 基建 meta)", () => {
    const t = tmpStore();
    const p = openProjection(t);
    const names = (p.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    ).all() as { name: string }[]).map((r) => r.name).sort();
    const must = ["plugins", "effects", "branches", "sessions", "agents", "nodes", "trust_edges",
      "workspaces", "skill_nodes", "memory_items", "promotion_requests", "shadow_runs", "jobs",
      "scorecards", "ledger_entries", "idempotency_keys", "review_events", "prompt_assets",
      "workflows", "workflow_runs"];
    for (const m of must) expect(names).toContain(m);
    p.close(); t.cleanup();
  });
});

describe("投影内容(随内核操作)", () => {
  it("插件状态机全投影:waiting→resolved、激活、连带停用、销毁、重装", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const p = Projection.open(t.dir, t.store);

    const a = makePlugin({ name: "a" });
    const b = makePlugin({ name: "b", requires: ["a.svc"] });
    kernel.install(a.manifest, a.module);
    kernel.install(b.manifest, b.module);

    await kernel.activate("b@1.0.0"); // 依赖未就绪 → resolved
    expect(p.plugins().find((x) => x.name === "b")?.state).toBe("resolved");

    await kernel.activate("a@1.0.0"); // a 激活 → b 连带激活
    expect(p.plugins().find((x) => x.name === "a")?.state).toBe("active");
    expect(p.plugins().find((x) => x.name === "b")?.state).toBe("active");

    await kernel.suspend("a@1.0.0"); // 连带:b 先停
    expect(p.plugins().find((x) => x.name === "a")?.state).toBe("suspended");
    expect(p.plugins().find((x) => x.name === "b")?.state).toBe("suspended");

    await kernel.dispose("a@1.0.0");
    expect(p.plugins().find((x) => x.name === "a")?.state).toBe("disposed");

    kernel.install(a.manifest, a.module); // disposed 后重装 → 新生命周期
    await kernel.activate("a@1.0.0");
    expect(p.plugins().find((x) => x.name === "a")?.state).toBe("active");
    expect((p.stats()).plugins).toBe(2); // 同 name@version 不重复计数

    p.close(); t.cleanup();
  });

  it("效应投影:三分类/owner/revert-compensate/reinstall 后新效应", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const p = Projection.open(t.dir, t.store);
    const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };
    const OWNER = { kind: "agent" as const, id: "ag_x" };

    let ctxRef: import("../src/kernel/kernel.js").KernelContext | undefined;
    const { manifest, module } = makePlugin({
      name: "fx",
      onStart: (ctx) => { ctxRef = ctx; ctx.provide({ name: "fx.svc" } as never, {}); },
    });
    kernel.install(manifest, module);
    await kernel.activate("fx@1.0.0");
    await ctxRef!.effect("可逆", () => 1, () => {}, { owner: OWNER });
    await ctxRef!.effect("可补偿", () => 2, () => {}, { rClass: 1, owner: OWNER });
    const ap = kernel.preapprove("不可逆", ACTOR);
    await ctxRef!.irreversible("不可逆", ap, () => {}, { owner: OWNER });

    const rows = p.effects();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.compensable)).toEqual([0, 1, 2]);        // K.1 三分类
    expect(rows.every((r) => r.owner_id === "ag_x")).toBe(true);       // GAP1 owner 归属
    expect(rows.every((r) => r.status === "applied")).toBe(true);

    const s = await kernel.revertOwner(OWNER, ACTOR);
    expect(s.reverted).toHaveLength(1);
    expect(s.compensated).toHaveLength(1);
    const after = p.effects();
    expect(after[0]!.status).toBe("reverted");
    expect(after[0]!.revert_seq).toBeGreaterThan(after[0]!.apply_seq);
    expect(after[1]!.status).toBe("compensated");
    expect(after[2]!.status).toBe("applied");                          // 不可逆不动
    p.close(); t.cleanup();
  });
});

describe("投影一致性", () => {
  it("增量投影 ≡ 全量重建(数据模型 §7 可重建性)", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const p = Projection.open(t.dir, t.store);
    const a = makePlugin({ name: "a" });
    const b = makePlugin({ name: "b", requires: ["a.svc"] });
    kernel.install(a.manifest, a.module);
    kernel.install(b.manifest, b.module);
    await kernel.activate("a@1.0.0");
    await kernel.activate("b@1.0.0");
    await kernel.suspend("a@1.0.0");
    await kernel.activate("a@1.0.0");
    const incremental = p.dump();

    p.rebuild(t.store);
    expect(p.dump()).toEqual(incremental);
    expect(p.reconcile(t.store).ok).toBe(true);
    p.close(); t.cleanup();
  });

  it("重开追平:错过追加后重开,水位补齐且内容一致", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const p1 = Projection.open(t.dir, t.store);
    const a = makePlugin({ name: "a" });
    kernel.install(a.manifest, a.module);
    await kernel.activate("a@1.0.0");
    const atClose = p1.dump();
    p1.close();

    // 关闭期间继续追加(投影错过这段)
    const b = makePlugin({ name: "b" });
    kernel.install(b.manifest, b.module);
    await kernel.activate("b@1.0.0");

    const p2 = openProjection(t); // 重开:自动追平
    const now = p2.dump();
    expect(p2.reconcile(t.store).ok).toBe(true);
    expect(now.plugins).toHaveLength(2);
    expect((now.ledger_entries as { seq: number }[]).length)
      .toBeGreaterThan((atClose.ledger_entries as { seq: number }[]).length);
    p2.close(); t.cleanup();
  });

  it("崩溃等价:仅凭账本文件全量重建 ≡ 活投影", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const pLive = Projection.open(t.dir, t.store);
    const a = makePlugin({ name: "a" });
    const b = makePlugin({ name: "b", requires: ["a.svc"] });
    kernel.install(a.manifest, a.module);
    kernel.install(b.manifest, b.module);
    await kernel.activate("b@1.0.0");
    await kernel.activate("a@1.0.0");
    await kernel.suspend("b@1.0.0"); // operator 意图释放
    const live = pLive.dump();
    pLive.close();

    // "崩溃":丢弃一切内存态;仅账本文件 + index.sqlite 幸存
    rmSync(join(t.dir, "ledger", "index.sqlite"), { force: true });
    rmSync(join(t.dir, "ledger", "index.sqlite-wal"), { force: true });
    rmSync(join(t.dir, "ledger", "index.sqlite-shm"), { force: true });
    const pRebuilt = openProjection(t);
    expect(pRebuilt.dump()).toEqual(live);
    expect(pRebuilt.reconcile(t.store).ok).toBe(true);
    pRebuilt.close(); t.cleanup();
  });
});
