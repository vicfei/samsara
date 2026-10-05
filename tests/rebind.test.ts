// 效应重绑定(效应重绑定):崩溃恢复后接回服务实例与逆操作闭包
//  语义:重绑是纯运行时操作——不写账本、不重放 apply(环境已反映既成事实);
//  rebindArgs 随 effect.apply 入账(additive),插件据此重建 revert 闭包;
//  未声明 rebind 或漏挂的效应维持"诚实拒绝"(unrebound),不伪造回滚。

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerStore } from "../src/kernel/ledger.js";
import { Kernel } from "../src/kernel/kernel.js";
import { serviceKey } from "../src/kernel/types.js";
import type { PluginManifest, PluginModule, RebindContext } from "../src/kernel/types.js";
import { makePlugin, tmpStore } from "./helpers.js";

const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };
const OWNER = { kind: "agent" as const, id: "ag_rb" };

function crashAndRecover(t: { dir: string; store: LedgerStore }) {
  void t;
  return (store: LedgerStore) => Kernel.recover(store);
}
void crashAndRecover;

/** 带可逆文件写入 + rebind 能力的插件 */
function fsToolsPlugin(workDir: string, opts: { reattachAll?: boolean; recapture?: boolean } = {}): {
  manifest: PluginManifest; module: PluginModule;
} {
  const manifest: PluginManifest = {
    name: "fst", version: "1.0.0", provides: ["fst.svc"], requires: [], rLevel: "R0",
  };
  const files: string[] = [];
  const svc = { filesWritten: () => [...files] };
  const module: PluginModule = {
    start(ctx) {
      ctx.provide(serviceKey("fst.svc"), svc);
      void ctx.effect(
        "write report.md",
        () => { const p = join(workDir, "report.md"); mkdirSync(workDir, { recursive: true }); writeFileSync(p, "内容"); return p; },
        (p) => { rmSync(p as string); files.pop(); },
        { owner: OWNER, rebindArgs: { name: "report.md" } },
      );
    },
    rebind(rc: RebindContext) {
      rc.provide(serviceKey("fst.svc"), svc); // 重建服务
      if (!opts.reattachAll && opts.reattachAll !== undefined) return; // 测试:故意漏挂
      for (const e of rc.pendingEffects) {
        const name = (e.rebindArgs as { name: string }).name;
        rc.reattach(
          e.token,
          () => { rmSync(join(workDir, name)); files.pop(); },
          opts.recapture ? () => join(workDir, name) : undefined, // captured 现场重取
        );
      }
    },
  };
  return { manifest, module };
}

describe("效应重绑定", () => {
  it("恢复 + rebind → revertOwner 真正回滚(文件删除、revert 入账、unrebound=0)", async () => {
    const t = tmpStore();
    const workDir = join(tmpdir(), "samsara-rb-" + Date.now());
    const kernel = new Kernel(t.store);
    const { manifest, module } = fsToolsPlugin(workDir);
    kernel.install(manifest, module);
    await kernel.activate("fst@1.0.0");
    expect(existsSync(join(workDir, "report.md"))).toBe(true);

    // 崩溃:仅账本幸存 → 恢复(未重绑:拒绝)
    const recovered = Kernel.recover(t.store).kernel;
    const before = await recovered.revertOwner(OWNER, ACTOR);
    expect(before.unrebound).toHaveLength(1);
    expect(existsSync(join(workDir, "report.md"))).toBe(true);
    const seqBefore = t.store.lastSeq;

    // 重绑:服务重建 + 逆操作接回(不写账本)
    const rb = await recovered.rebind("fst@1.0.0", module);
    expect(rb.reattached).toHaveLength(1);
    expect(rb.pendingRemaining).toHaveLength(0);
    expect(t.store.lastSeq).toBe(seqBefore); // 纯运行时操作

    // 现在回滚真正生效
    const after = await recovered.revertOwner(OWNER, ACTOR);
    expect(after.reverted).toHaveLength(1);
    expect(after.unrebound).toHaveLength(0);
    expect(existsSync(join(workDir, "report.md"))).toBe(false); // 文件真的没了
    expect(t.store.all.filter((e) => e.kind === "effect.revert")).toHaveLength(1); // revert 诚实入账
    rmSync(workDir, { recursive: true, force: true });
    t.cleanup();
  });

  it("rebind 重建服务:inject 句柄返回活实例", async () => {
    const t = tmpStore();
    const workDir = join(tmpdir(), "samsara-rb2-" + Date.now());
    const kernel = new Kernel(t.store);
    const { manifest, module } = fsToolsPlugin(workDir);
    kernel.install(manifest, module);
    await kernel.activate("fst@1.0.0");

    const recovered = Kernel.recover(t.store).kernel;
    let got: unknown = "unset";
    // 恢复态服务 impl 为 undefined(待重绑)
    const handleProbe = (recovered as unknown as {
      services: Map<string, { impl: unknown }>;
    }).services.get("fst.svc");
    expect(handleProbe?.impl).toBeUndefined();

    await recovered.rebind("fst@1.0.0", module);
    const svc = (recovered as unknown as {
      services: Map<string, { impl: { filesWritten(): string[] } }>;
    }).services.get("fst.svc")!.impl;
    got = svc.filesWritten();
    expect(got).toEqual([]); // 活实例可调用
    rmSync(workDir, { recursive: true, force: true });
    t.cleanup();
  });

  it("漏挂的效应维持诚实拒绝(pendingRemaining 上报)", async () => {
    const t = tmpStore();
    const workDir = join(tmpdir(), "samsara-rb3-" + Date.now());
    const kernel = new Kernel(t.store);
    const full = fsToolsPlugin(workDir);
    kernel.install(full.manifest, full.module);
    await kernel.activate("fst@1.0.0");

    const recovered = Kernel.recover(t.store).kernel;
    // 用"故意漏挂"的模块重绑
    const partial = fsToolsPlugin(workDir, { reattachAll: false });
    const rb = await recovered.rebind("fst@1.0.0", partial.module);
    expect(rb.reattached).toHaveLength(0);
    expect(rb.pendingRemaining).toHaveLength(1);
    const s = await recovered.revertOwner(OWNER, ACTOR);
    expect(s.unrebound).toHaveLength(1); // 仍拒绝,不伪造
    expect(existsSync(join(workDir, "report.md"))).toBe(true);
    rmSync(workDir, { recursive: true, force: true });
    t.cleanup();
  });

  it("rebindArgs 随账本往返;class 2 不进 pendingEffects;recapture 现场重取", async () => {
    const t = tmpStore();
    const workDir = join(tmpdir(), "samsara-rb4-" + Date.now());
    const kernel = new Kernel(t.store);
    let ctxRef: import("../src/kernel/kernel.js").KernelContext | undefined;
    const { manifest, module } = makePlugin({
      name: "mix",
      onStart: (ctx) => {
        ctxRef = ctx;
        ctx.provide({ name: "mix.svc" } as never, {});
      },
    });
    kernel.install(manifest, module);
    await kernel.activate("mix@1.0.0");
    await ctxRef!.effect("带参数的可逆", () => 1, () => {},
      { owner: OWNER, rebindArgs: { path: "/tmp/x", n: 7 } });
    const ap = kernel.preapprove("破坏", ACTOR);
    await ctxRef!.irreversible("破坏", ap, () => {}, { owner: OWNER });

    const recovered = Kernel.recover(t.store).kernel;
    const seen: { token: string; args: unknown }[] = [];
    const rbModule: PluginModule = {
      start() {},
      rebind(rc) {
        for (const e of rc.pendingEffects) seen.push({ token: e.token, args: e.rebindArgs });
        for (const e of rc.pendingEffects) {
          rc.reattach(e.token, (captured) => { expect(captured).toBe(42); }, () => 42); // recapture 供 revert
        }
      },
    };
    const rb = await recovered.rebind("mix@1.0.0", rbModule);
    expect(rb.reattached).toHaveLength(1);              // class 2 被排除,pending 只有 1 条
    expect(seen[0]!.args).toEqual({ path: "/tmp/x", n: 7 }); // rebindArgs 账本往返无损
    const s = await recovered.revertOwner(OWNER, ACTOR);
    expect(s.reverted).toHaveLength(1);                 // recapture 的 42 已被 revert 消费(断言内)
    expect(s.irreversibleSkipped).toHaveLength(1);      // class 2 语义不变
    rmSync(workDir, { recursive: true, force: true });
    t.cleanup();
  });

  it("非 active 插件重绑 → 拒绝(INVALID_STATE)", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const { manifest, module } = makePlugin({ name: "na" });
    kernel.install(manifest, module);
    await expect(kernel.rebind("na@1.0.0", module)).rejects.toThrow(/INVALID_STATE/);
    t.cleanup();
  });

  it("快照引导后的重绑同样生效(boot+rebind 组合)", async () => {
    const t = tmpStore();
    const workDir = join(tmpdir(), "samsara-rb5-" + Date.now());
    const kernel = new Kernel(t.store);
    const { manifest, module } = fsToolsPlugin(workDir);
    kernel.install(manifest, module);
    await kernel.activate("fst@1.0.0");
    const store2 = new LedgerStore(t.dir); // 快照用的同源读取
    void store2;
    const booted = Kernel.boot(t.store, new (await import("../src/kernel/snapshot.js")).SnapshotStore(t.dir));
    const rb = await booted.kernel.rebind("fst@1.0.0", module);
    expect(rb.reattached).toHaveLength(1);
    const s = await booted.kernel.revertOwner(OWNER, ACTOR);
    expect(s.reverted).toHaveLength(1);
    expect(existsSync(join(workDir, "report.md"))).toBe(false);
    rmSync(workDir, { recursive: true, force: true });
    t.cleanup();
  });
});
