// clock + web_search 工具(soaks 发现的缺口 + 博查检索)
// clock:纯函数确定性断言;web_search:mock fetch(不打真实 API);真 key 冒烟在 tests/smoke-real.test.ts(隔离)

import { describe, expect, it } from "vitest";
import { Kernel } from "../src/kernel/kernel.js";
import { clockToolPlugin, webSearchToolPlugin } from "../src/agent/tools-web";
import { toolRegistryPlugin, TOOL_REGISTRY } from "../src/agent/tools";
import type { ToolRegistry } from "../src/agent/tools";
import { tmpStore } from "./helpers.js";

const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };

async function assemble() {
  const t = tmpStore();
  const kernel = new Kernel(t.store);
  const reg = toolRegistryPlugin();
  kernel.install(reg.manifest, reg.module);
  const clk = clockToolPlugin();
  kernel.install(clk.manifest, clk.module);
  const ws = webSearchToolPlugin();
  kernel.install(ws.manifest, ws.module);
  await kernel.activate("tool-registry@1.0.0");
  await kernel.activate("tool-clock@1.0.0");
  await kernel.activate("tool-websearch@1.0.0");
  const registry = kernel.service(TOOL_REGISTRY);
  return { t, kernel, registry };
}

describe("clock 工具", () => {
  it("返回当前时间:ISO + 人类可读 + 时区;自定义时区;无效时区拒绝", async () => {
    const { t, kernel, registry } = await assemble();
    const clock = registry.get("clock")!;

    const r1 = await clock.run({}, kernel.contextFor("tool-clock@1.0.0", { kind: "agent", id: "a1" }));
    expect(r1.ok).not.toBe(false);
    expect(r1.content).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO
    expect(r1.content).toMatch(/人类可读:/);

    const r2 = await clock.run({ timezone: "Asia/Shanghai" }, kernel.contextFor("tool-clock@1.0.0", { kind: "agent", id: "a1" }));
    expect(r2.content).toContain("Asia/Shanghai");
    expect(r2.content).toMatch(/星期/); // zh-CN weekday

    const r3 = await clock.run({ timezone: "Invalid/Zone" }, kernel.contextFor("tool-clock@1.0.0", { kind: "agent", id: "a1" }));
    expect(r3.ok).toBe(false);
    expect(r3.content).toContain("无效时区");
    t.cleanup();
  });
});

describe("web_search 工具", () => {
  it("缺 BOCHA_API_KEY → 引导提示(不崩)", async () => {
    const { t, kernel, registry } = await assemble();
    const prev = process.env.BOCHA_API_KEY;
    delete process.env.BOCHA_API_KEY;
    const tool = registry.get("web_search")!;
    const r = await tool.run({ query: "test" }, kernel.contextFor("tool-websearch@1.0.0", { kind: "agent", id: "a1" }));
    expect(r.ok).toBe(false);
    expect(r.content).toContain("BOCHA_API_KEY");
    if (prev !== undefined) process.env.BOCHA_API_KEY = prev;
    t.cleanup();
  });

  it("网关失败 → 回文含[未核验]引用纪律指引(批次二十五②)", async () => {
    const { t, kernel, registry } = await assemble();
    process.env.BOCHA_API_KEY = "fake-key-for-test";
    // 打 mock fetch 返回 403
    const tool = registry.get("web_search")!;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;
    try {
      const r = await tool.run({ query: "x" }, kernel.contextFor("tool-websearch@1.0.0", { kind: "agent", id: "a1" }));
      expect(r.ok).toBe(false);
      expect(r.content).toContain("网关 403");
      expect(r.content).toContain("[未核验]");
      expect(r.content).toContain("不要给出具体编号");
    } finally {
      globalThis.fetch = origFetch;
      delete process.env.BOCHA_API_KEY;
      t.cleanup();
    }
  });

  it("缺 query 参数 → 错误提示", async () => {
    const { t, kernel, registry } = await assemble();
    process.env.BOCHA_API_KEY = "fake-key-for-test";
    const tool = registry.get("web_search")!;
    const r = await tool.run({}, kernel.contextFor("tool-websearch@1.0.0", { kind: "agent", id: "a1" }));
    expect(r.ok).toBe(false);
    expect(r.content).toContain("query");
    delete process.env.BOCHA_API_KEY;
    t.cleanup();
  });

});

describe("工具注册即效应(dispose 即注销,§3.2.2 原生示例)", () => {
  it("clock 和 web_search 均注册/注销", async () => {
    const { t, kernel, registry } = await assemble();
    expect(registry.list().map((x) => x.name)).toContain("clock");
    expect(registry.list().map((x) => x.name)).toContain("web_search");
    await kernel.dispose("tool-clock@1.0.0");
    expect(registry.list().map((x) => x.name)).not.toContain("clock");
    expect(registry.list().map((x) => x.name)).toContain("web_search"); // 只删了 clock
    t.cleanup();
  });
});
