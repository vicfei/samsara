// 余效应生命周期保证(§3.2.3)+ 插件状态机(§3.3)
// B 依赖 A ⇒ B 只在 A 就绪后激活、在 A 停止前停用、A 失败时 B 不启动

import { describe, expect, it } from "vitest";
import { Kernel, KernelError } from "../src/kernel/kernel.js";
import { makePlugin, tmpStore } from "./helpers.js";

describe("反应式余效应(§3.2.3)", () => {
  it("依赖未就绪 → 等待;服务出现 → 自动激活", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const a = makePlugin({ name: "a" });
    const b = makePlugin({ name: "b", requires: ["a.svc"] });
    kernel.install(a.manifest, a.module);
    kernel.install(b.manifest, b.module);

    const r1 = await kernel.activate("b@1.0.0"); // A 未激活:B 等待
    expect(r1.activated).toBe(false);
    expect(kernel.pluginState("b@1.0.0")).toBe("installed");

    await kernel.activate("a@1.0.0");            // A 出现 → B 反应式激活
    expect(kernel.pluginState("a@1.0.0")).toBe("active");
    expect(kernel.pluginState("b@1.0.0")).toBe("active");
    expect(kernel.serviceNames()).toEqual(["a.svc", "b.svc"]);
    cleanup();
  });

  it("A 停止 → B 先于 A 停用;A 恢复 → B 自动回归", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const stopOrder: string[] = [];
    const a = makePlugin({ name: "a", stop: () => { stopOrder.push("a"); } });
    const b = makePlugin({ name: "b", requires: ["a.svc"], stop: () => { stopOrder.push("b"); } });
    kernel.install(a.manifest, a.module);
    kernel.install(b.manifest, b.module);
    await kernel.activate("a@1.0.0");
    await kernel.activate("b@1.0.0");

    await kernel.suspend("a@1.0.0");
    expect(stopOrder).toEqual(["b", "a"]);       // B 在 A 之前停用
    expect(kernel.pluginState("b@1.0.0")).toBe("suspended");
    expect(kernel.pluginState("a@1.0.0")).toBe("suspended");

    await kernel.activate("a@1.0.0");            // 恢复 → 依赖方自动回归
    expect(kernel.pluginState("b@1.0.0")).toBe("active");
    expect(kernel.observable().chainOk).toBe(true);
    cleanup();
  });

  it("深链:C 停 → B 不受影响(A 仍在);A 停 → B、C 依次连带", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const a = makePlugin({ name: "a" });
    const b = makePlugin({ name: "b", requires: ["a.svc"] });
    const c = makePlugin({ name: "c", requires: ["b.svc"] });
    for (const p of [a, b, c]) kernel.install(p.manifest, p.module);
    await kernel.activate("a@1.0.0");
    await kernel.activate("b@1.0.0");
    await kernel.activate("c@1.0.0");

    await kernel.suspend("c@1.0.0");
    expect(kernel.pluginState("b@1.0.0")).toBe("active"); // 上游不受下游影响

    await kernel.suspend("a@1.0.0");
    expect(kernel.pluginState("b@1.0.0")).toBe("suspended");
    expect(kernel.pluginState("c@1.0.0")).toBe("suspended");
    cleanup();
  });

  it("操作者停用的插件不被服务出现强制拉起(意愿棘轮)", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const a = makePlugin({ name: "a" });
    const b = makePlugin({ name: "b", requires: ["a.svc"] });
    kernel.install(a.manifest, a.module);
    kernel.install(b.manifest, b.module);
    await kernel.activate("a@1.0.0");
    await kernel.activate("b@1.0.0");
    await kernel.suspend("b@1.0.0");             // 操作者主动停 B

    await kernel.suspend("a@1.0.0");
    await kernel.activate("a@1.0.0");            // A 回来,B 仍保持停用
    expect(kernel.pluginState("b@1.0.0")).toBe("suspended");
    cleanup();
  });
});

describe("生命周期状态机(§3.3)", () => {
  it("start 抛错 → 自动回滚至 installed,已生效效应被逆应用,依赖方不启动", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const env: string[] = [];

    const bad = makePlugin({
      name: "bad",
      onStart: (ctx) => {
        ctx.provide({ name: "bad.svc" } as never, {});
        void ctx.effect("半途效应", () => { env.push("applied"); return 1; },
          () => { env.push("reverted"); });
        throw new Error("启动失败");
      },
    });
    const dependent = makePlugin({ name: "dep", requires: ["bad.svc"] });
    kernel.install(bad.manifest, bad.module);
    kernel.install(dependent.manifest, dependent.module);
    await kernel.activate("dep@1.0.0"); // 等待 bad

    await expect(kernel.activate("bad@1.0.0")).rejects.toThrow(KernelError);
    expect(kernel.pluginState("bad@1.0.0")).toBe("installed"); // 回滚至 installed
    expect(env).toEqual(["applied", "reverted"]);               // 半途效应被回滚
    expect(kernel.pluginState("dep@1.0.0")).not.toBe("active"); // A 失败 B 不启动
    expect(kernel.observable().chainOk).toBe(true);
    cleanup();
  });

  it("dispose:级联停用 + LIFO 回滚本插件效应", async () => {
    const { store, cleanup } = tmpStore();
    const kernel = new Kernel(store);
    const a = makePlugin({ name: "a" });
    const b = makePlugin({ name: "b", requires: ["a.svc"] });
    kernel.install(a.manifest, a.module);
    kernel.install(b.manifest, b.module);
    await kernel.activate("a@1.0.0");
    await kernel.activate("b@1.0.0");

    const summary = await kernel.dispose("a@1.0.0");
    expect(summary.reverted).toHaveLength(0); // makePlugin 不注册效应,回滚为空但流程完整
    expect(kernel.pluginState("a@1.0.0")).toBe("disposed");
    expect(kernel.pluginState("b@1.0.0")).toBe("suspended");
    expect(kernel.serviceNames()).toEqual(["b.svc"].filter(() => kernel.pluginState("b@1.0.0") === "active"));
    cleanup();
  });
});
