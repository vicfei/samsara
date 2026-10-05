// 回滚一次回滚(INV-2 字面承诺):广义时间旅行语义
//  rollbackTo(N) 逆应用 (N, head] 内全部效应类条目:apply 的逆 = revert,revert 的逆 = 前滚;
//  redo() = rollbackTo(最近 marker 的 seq)。账本轨迹:apply → revert → apply(重新入账)。

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerStore } from "../src/kernel/ledger.js";
import { Kernel } from "../src/kernel/kernel.js";
import { makePlugin, tmpStore } from "./helpers.js";

const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };
const OWNER = { kind: "agent" as const, id: "ag_rd" };

/** 建文件型可逆效应(apply 可重放——redo 契约);同 ctx 支持多文件 */
function fileEffectPlugin(workDir: string, name = "a.md", content = "A") {
  const pathOf = (n: string) => join(workDir, n);
  let ctxRef: import("../src/kernel/kernel.js").KernelContext | undefined;
  const { manifest, module } = makePlugin({
    name: "fe",
    onStart: (ctx) => {
      ctxRef = ctx;
      ctx.provide({ name: "fe.svc" } as never, {});
    },
  });
  return {
    manifest, module, ctx: () => ctxRef!,
    write: (n = name, c = content) => ctxRef!.effect(
      `write ${n}`,
      () => { mkdirSync(workDir, { recursive: true }); writeFileSync(pathOf(n), c); return pathOf(n); },
      () => { rmSync(pathOf(n)); },
      { owner: OWNER },
    ),
    exists: (n = name) => existsSync(pathOf(n)),
  };
}

describe("回滚一次回滚(redo/前滚)", () => {
  it("基本:redo 撤销上一次回滚——文件回归,账本 apply→revert→apply,重放终态一致", async () => {
    const t = tmpStore();
    const workDir = join(tmpdir(), `samsara-rdo-${Date.now()}-1`);
    const kernel = new Kernel(t.store);
    const fe = fileEffectPlugin(workDir);
    kernel.install(fe.manifest, fe.module);
    await kernel.activate("fe@1.0.0");
    const beforeEffect = t.store.lastSeq; // 锚点:效应写入之前
    await fe.write();
    expect(fe.exists()).toBe(true);

    await kernel.rollbackTo(beforeEffect, ACTOR); // 回滚:文件删除
    expect(fe.exists()).toBe(false);
    const summary = await kernel.redo(ACTOR);     // 回滚一次回滚:前滚
    expect(summary.reapplied).toHaveLength(1);
    expect(fe.exists()).toBe(true);               // 文件回来了

    const kinds = t.store.all.map((e) => e.kind);
    expect(kinds.filter((k) => k === "effect.apply")).toHaveLength(2);   // 原始 + 前滚
    expect(kinds.filter((k) => k === "effect.revert")).toHaveLength(1);
    expect(kinds.filter((k) => k === "rollback.marker")).toHaveLength(2);
    expect(t.store.verifyChain().ok).toBe(true);

    // 重放终态 = applied(前滚条目被投影正确消费)
    const replayed = Kernel.recover(t.store).kernel;
    expect(replayed.effectTimeline()).toEqual([{ applySeq: 7, rClass: 0, status: "applied" }]); // 前滚后最新 apply 条目
    rmSync(workDir, { recursive: true, force: true });
    t.cleanup();
  });

  it("INV-2 往返:rollback → redo → 再 rollback(撤销前滚)——状态循环一致", async () => {
    const t = tmpStore();
    const workDir = join(tmpdir(), `samsara-rdo-${Date.now()}-2`);
    const kernel = new Kernel(t.store);
    const fe = fileEffectPlugin(workDir);
    kernel.install(fe.manifest, fe.module);
    await kernel.activate("fe@1.0.0");
    const anchor = t.store.lastSeq; // 锚点:效应写入之前
    await fe.write();

    await kernel.rollbackTo(anchor, ACTOR);
    expect(fe.exists()).toBe(false);
    await kernel.redo(ACTOR);
    expect(fe.exists()).toBe(true);
    const s3 = await kernel.redo(ACTOR);          // 撤销前滚 = 再回滚
    expect(s3.reverted).toHaveLength(1);
    expect(s3.reapplied).toHaveLength(0);
    expect(fe.exists()).toBe(false);
    expect(t.store.verifyChain().ok).toBe(true);
    const markers = t.store.all.filter((e) => e.kind === "rollback.marker");
    expect(markers).toHaveLength(3);              // 三次时间旅行,全部留痕
    rmSync(workDir, { recursive: true, force: true });
    t.cleanup();
  });

  it("净移动语义:区间内先 apply 后 revert 的效应不再动", async () => {
    const t = tmpStore();
    const workDir = join(tmpdir(), `samsara-rdo-${Date.now()}-3`);
    const kernel = new Kernel(t.store);
    const fe = fileEffectPlugin(workDir);          // 单插件,同 ctx 写两个文件
    kernel.install(fe.manifest, fe.module);
    await kernel.activate("fe@1.0.0");
    await fe.write("a.md", "A"); const seqA = t.store.lastSeq; // 时点:a 刚写完
    await fe.write("b.md", "B");
    await kernel.revertOwner(OWNER, ACTOR);       // 两个都回滚(a、b 都没了)

    // 回到"a 刚写完"时点:区间含 apply(b) + revert(a,b)
    // 净移动:a 目标 applied(现 reverted)→ 前滚;b 该时点尚不存在 → 保持 reverted
    const s = await kernel.rollbackTo(seqA, ACTOR);
    expect(s.reapplied).toHaveLength(1);          // 只有 a 回来
    expect(fe.exists("a.md")).toBe(true);
    expect(fe.exists("b.md")).toBe(false);

    // 再回到 a 之前:撤销 a
    const s2 = await kernel.rollbackTo(seqA - 1, ACTOR);
    expect(s2.reverted).toHaveLength(1);
    expect(fe.exists("a.md") || fe.exists("b.md")).toBe(false);
    expect(t.store.verifyChain().ok).toBe(true);
    rmSync(workDir, { recursive: true, force: true });
    t.cleanup();
  });

  it("无 marker 时 redo → INVALID_STATE", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    await expect(kernel.redo(ACTOR)).rejects.toThrow(/INVALID_STATE/);
    t.cleanup();
  });

  it("恢复态无 applyFn → 前滚诚实拒绝(reapplyUnavailable,不伪造条目)", async () => {
    const t = tmpStore();
    const workDir = join(tmpdir(), `samsara-rdo-${Date.now()}-4`);
    const kernel = new Kernel(t.store);
    const fe = fileEffectPlugin(workDir);
    kernel.install(fe.manifest, fe.module);
    await kernel.activate("fe@1.0.0");
    const anchor = t.store.lastSeq; // 锚点:效应写入之前
    await fe.write();
    await kernel.rollbackTo(anchor, ACTOR);

    const recovered = Kernel.recover(t.store).kernel; // 无 applyFn
    const appliesBefore = t.store.all.filter((e) => e.kind === "effect.apply").length;
    const s = await recovered.redo(ACTOR);
    expect(s.reapplyUnavailable).toHaveLength(1);
    expect(s.reapplied).toHaveLength(0);
    expect(t.store.all.filter((e) => e.kind === "effect.apply").length).toBe(appliesBefore); // 不伪造
    rmSync(workDir, { recursive: true, force: true });
    t.cleanup();
  });

  it("重绑定提供 reapply → 恢复态前滚生效;投影表同步(apply_seq 更新)", async () => {
    const t = tmpStore();
    const workDir = join(tmpdir(), `samsara-rdo-${Date.now()}-5`);
    const kernel = new Kernel(t.store);
    const projection = await import("../src/kernel/projection.js").then((m) => m.Projection.open(t.dir, t.store));
    const fe = fileEffectPlugin(workDir);
    kernel.install(fe.manifest, fe.module);
    await kernel.activate("fe@1.0.0");
    const anchor = t.store.lastSeq; // 锚点:效应写入之前
    await fe.write();
    await kernel.rollbackTo(anchor, ACTOR);
    const snap = projection.dump();
    void snap;

    const recovered = Kernel.recover(t.store).kernel;
    await recovered.rebind("fe@1.0.0", {
      start() {},
      rebind(rc) {
        // 此刻效应已 reverted——经 knownEffects 绑定逆操作与前滚重放
        for (const e of rc.knownEffects) {
          rc.reattach(e.token, () => { rmSync(join(workDir, "a.md")); }, undefined,
            () => { mkdirSync(workDir, { recursive: true }); writeFileSync(join(workDir, "a.md"), "A"); });
        }
      },
    });
    const s = await recovered.redo(ACTOR);
    expect(s.reapplied).toHaveLength(1);
    expect(existsSync(join(workDir, "a.md"))).toBe(true);

    const rows = projection.effects(); // 增量投影收到前滚条目
    expect(rows[0]!.status).toBe("applied");
    expect(rows[0]!.apply_seq).toBeGreaterThan(anchor);
    expect(projection.reconcile(t.store).ok).toBe(true);
    projection.close();
    rmSync(workDir, { recursive: true, force: true });
    t.cleanup();
  });
});
