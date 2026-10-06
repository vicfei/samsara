// Worker 隔离穿透测试(M2-S6,附录 K.3 M2 行,P3 的 verify 准则之一):
// 结构化克隆边界 / 协议白名单 / 账本落款在宿主 / 崩溃与挂死 containment / 诚实回滚失败。
// 夹具:tests/fixtures/{good,malicious}-worker.cjs(纯 CJS,真实 fork 子进程)。

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../src/kernel/kernel.js";
import { mockChatPlugin } from "../src/llm/chat.js";
import { spawnSandboxed, registerHostKernel } from "../src/worker/sandbox.js";
import { serviceKey } from "../src/kernel/types.js";
import { tmpStore } from "./helpers.js";

const GOOD = join(import.meta.dirname, "fixtures", "good-worker.cjs");
const EVIL = join(import.meta.dirname, "fixtures", "malicious-worker.cjs");
const MARKER = join(tmpdir(), `samsara-wtest-${process.pid}-marker`);

const goodManifest = {
  name: "ext-demo", version: "1.0.0", kind: "tool",
  provides: ["demo.echo"], requires: [], rLevel: "R0",
} as const;

function sandboxed(path: string, manifest = goodManifest, callTimeoutMs = 4_000) {
  return spawnSandboxed(manifest as never, path, { callTimeoutMs, startTimeoutMs: 8_000 });
}

async function bootGood() {
  const t = tmpStore();
  const kernel = new Kernel(t.store);
  registerHostKernel(kernel);
  // worker 的 host-call 目标:llm.chat
  const chat = mockChatPlugin(() => "来自宿主的回答");
  kernel.install(chat.manifest, chat.module);
  await kernel.activate("llm-mock@1.0.0");
  const p = sandboxed(GOOD);
  kernel.install(p.manifest, p.module);
  await kernel.activate("ext-demo@1.0.0");
  return { t, kernel };
}

beforeEach(() => {
  process.env.SANDBOX_TEST_MARKER = MARKER; // 夹具经 env 接收标记文件路径(fork 继承)
  writeFileSync(MARKER, "(初始)");
});
afterEach(() => {
  delete process.env.SANDBOX_TEST_MARKER;
  rmSync(MARKER, { force: true });
  rmSync("/tmp/samsara-malicious-probe", { force: true });
});

describe("良好外部插件全链路(结构化克隆边界)", () => {
  it("服务调用经 IPC 往返;效应账本落款在宿主;dispose 触发 worker 内 revert", async () => {
    const { t, kernel } = await bootGood();
    try {
      const svc = kernel.service(serviceKey<{ echo(s: string): Promise<string>; state(): Promise<string> }>("demo.echo"));
      expect(await svc.echo("你好")).toBe("echo:你好");
      expect(readFileSync(MARKER, "utf-8")).toBe("applied"); // apply 已在 worker 执行

      // 账本事实在宿主:effect.apply 条目 + ref.plugin
      const fx = kernel.store.all.find((e) => e.kind === "effect.apply" && e.ref?.plugin === "ext-demo@1.0.0");
      expect(fx).toBeDefined();
      expect((fx!.payload as { rebindArgs?: { marker?: string } }).rebindArgs?.marker).toBe(MARKER);

      // worker → 宿主服务调用(host-call 白名单)
      const r = await (svc as unknown as { askLlm(p: string): Promise<{ content: string }> }).askLlm("问题");
      expect(r.content).toBe("来自宿主的回答");

      // 销毁:LIFO 回滚 → worker 内 revert 执行(captured 经 IPC 往返)
      await kernel.dispose("ext-demo@1.0.0");
      expect(readFileSync(MARKER, "utf-8")).toBe("reverted(from=applied)");
      t.cleanup();
    } finally { t.cleanup(); }
  });
});

describe("穿透防线(恶意插件 containment)", () => {
  it("协议白名单:索要内核的伪操作被拒;越权 provide 不登记;宿主与内核状态无损", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    registerHostKernel(kernel);
    const evil = sandboxed(EVIL, {
      name: "ext-evil", version: "1.0.0", kind: "tool",
      provides: ["evil.svc"], requires: [], rLevel: "R0",
    } as never, 2_000);
    kernel.install(evil.manifest, evil.module);
    await kernel.activate("ext-evil@1.0.0");

    // ② 越权 provide:extra.sneaky 不在 manifest.provides → 宿主无此服务
    expect(kernel.serviceNames()).not.toContain("extra.sneaky");
    expect(kernel.serviceNames()).toContain("evil.svc");

    // ① 伪操作后宿主无恙:服务可正常调用(插件还活着,未受伪操作影响)
    const svc = kernel.service(serviceKey<{ probeHostAlive(): Promise<string> }>("evil.svc"));
    expect(await svc.probeHostAlive()).toBe("alive");

    // 内核完整性:链未断、无异常条目
    expect(kernel.observable().chainOk).toBe(true);
    expect(kernel.pluginState("ext-evil@1.0.0")).toBe("active");

    await kernel.dispose("ext-evil@1.0.0");
    t.cleanup();
  });

  it("死循环服务:调用超时击杀 worker;宿主存活,后续调用拒绝,链完整", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    registerHostKernel(kernel);
    const evil = sandboxed(EVIL, {
      name: "ext-evil2", version: "1.0.0", kind: "tool",
      provides: ["evil.svc"], requires: [], rLevel: "R0",
    } as never, 400); // 短超时
    kernel.install(evil.manifest, evil.module);
    await kernel.activate("ext-evil2@1.0.0");
    const svc = kernel.service(serviceKey<{ loopForever(): Promise<never> }>("evil.svc"));

    await expect(svc.loopForever()).rejects.toThrow(/SANDBOX_(TIMEOUT|DEAD)/);
    // 宿主与内核无损:链完整;服务表由内核生命周期管理(不随 worker 击杀离场),
    // 但代理调用全部拒绝(SANDBOX_DEAD)——worker 侧实现已不可达
    expect(kernel.observable().chainOk).toBe(true);
    await expect(svc.loopForever()).rejects.toThrow(/SANDBOX_DEAD/);
    t.cleanup();
  });

  it("worker 自杀(进程退出):待决调用拒绝,宿主存活", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    registerHostKernel(kernel);
    const evil = sandboxed(EVIL, {
      name: "ext-evil3", version: "1.0.0", kind: "tool",
      provides: ["evil.svc"], requires: [], rLevel: "R0",
    } as never, 3_000);
    kernel.install(evil.manifest, evil.module);
    await kernel.activate("ext-evil3@1.0.0");
    const svc = kernel.service(serviceKey<{ die(): Promise<never> }>("evil.svc"));
    await expect(svc.die()).rejects.toThrow(/SANDBOX_DEAD/);
    expect(kernel.observable().chainOk).toBe(true);
    t.cleanup();
  });

  it("worker 死亡后的效应回滚:诚实失败(status=failed + revert-failed 事件),不伪造成功", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    registerHostKernel(kernel);
    const p = spawnSandboxed(goodManifest as never, GOOD, { callTimeoutMs: 400, startTimeoutMs: 8_000 });
    kernel.install(p.manifest, p.module);
    await kernel.activate("ext-demo@1.0.0");
    const svc = kernel.service(serviceKey<{ hang(): Promise<never> }>("demo.echo"));
    await expect(svc.hang()).rejects.toThrow(/SANDBOX_(TIMEOUT|DEAD)/); // worker 已被击杀

    const events: string[] = [];
    kernel.bus.on({ type: "effect.revert-failed" }, () => events.push("revert-failed"));
    await kernel.dispose("ext-demo@1.0.0"); // dispose = suspend → revertOwner:revert 需回 worker 执行
    // worker 已死 → 诚实失败;文件保持 applied(环境已反映既成事实),不伪造 revert 条目
    expect(readFileSync(MARKER, "utf-8")).toBe("applied");
    expect(events).toContain("revert-failed");
    const token = kernel.store.all.find((e) => e.kind === "effect.apply" && e.ref?.plugin === "ext-demo@1.0.0")?.ref?.token;
    expect(kernel.effectRecord(token as string)?.status).toBe("failed");
    t.cleanup();
  });
});
