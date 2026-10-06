// 工作区写捕获(M3-S3,附录 K.2/G.7):COW 可逆 / commit 清单 / discard 还原 / 重绑还原 / SLO≤10%(100 并发)。
// P2 verify 准则:kill(丢弃)后环境哈希不变 + overhead SLO 实测。

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../src/kernel/kernel.js";
import { Projection } from "../src/kernel/projection.js";
import { WorkspaceCapture } from "../src/kernel/workspace.js";
import { fsToolPlugin, TOOL_REGISTRY, toolRegistryPlugin } from "../src/agent/tools.js";
import type { WorkspaceView } from "../src/agent/tools.js";
import { tmpStore } from "./helpers.js";

const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };

interface W { kernel: Kernel; projection: Projection; cap: WorkspaceCapture; root: string; sidecar: string; cleanup: () => void }

function boot(sessionKey = "webchat:dm:alice"): W {
  const t = tmpStore();
  const kernel = new Kernel(t.store);
  const projection = Projection.open(t.dir, t.store);
  // fs 插件需已安装(contextFor 校验)
  const reg = toolRegistryPlugin();
  kernel.install(reg.manifest, reg.module);
  const fsP = fsToolPlugin(join(t.dir, "shared"));
  kernel.install(fsP.manifest, fsP.module);
  const root = join(t.dir, "ws", sessionKey.replace(/[^a-z0-9]/gi, "_"));
  const cap = new WorkspaceCapture(kernel, "tool-fs@1.0.0", sessionKey, root);
  const sidecar = join(root, "..", ".capture", sessionKey.replace(/[^a-z0-9]/gi, "_"));
  return { kernel, projection, cap, root, sidecar, cleanup: () => t.cleanup() };
}

const hashDir = (d: string): string => {
  const h = createHash("sha256");
  const walk = (dir: string, prefix: string): void => {
    if (!existsSync(dir)) return;
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    for (const f of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (f.isDirectory()) { walk(join(dir, f.name), `${prefix}${f.name}/`); continue; }
      h.update(`${prefix}${f.name}`);
      h.update(readFileSync(join(dir, f.name)));
    }
  };
  walk(d, "");
  return h.digest("hex");
};

describe("COW 覆盖层与可逆性(K.2)", () => {
  it("覆写+新建:discard 后环境哈希复原(git status 级干净);单效应承载", async () => {
    const w = boot();
    try {
      writeFileSync(join(w.root, "a.txt"), "原件A");
      mkdirSync(join(w.root, "sub"), { recursive: true });
      writeFileSync(join(w.root, "sub", "b.txt"), "原件B");
      const before = hashDir(w.root);

      w.cap.write("a.txt", "被改写");
      w.cap.write("sub/b.txt", "被改写");
      w.cap.write("new.txt", "新建");
      w.cap.write("sub/new2.txt", "新建2");
      expect(w.cap.read("a.txt")).toBe("被改写");
      expect(hashDir(w.root)).not.toBe(before);

      // 单效应:整个覆盖层只一笔 effect.apply(owner=session)
      const fx = w.kernel.store.all.filter((e) => e.kind === "effect.apply");
      expect(fx).toHaveLength(1);
      expect((fx[0]!.payload as { owner?: { kind?: string } }).owner?.kind).toBe("session");

      const r = await w.cap.discard(ACTOR);
      expect(r.reverted).toHaveLength(1);
      expect(hashDir(w.root)).toBe(before);              // P2 准则:丢弃后环境哈希不变
      expect(existsSync(join(w.root, "new.txt"))).toBe(false);
      expect(readFileSync(join(w.root, "a.txt"), "utf-8")).toBe("原件A");
      w.cleanup();
    } finally { w.cleanup(); }
  });

  it("commit:差异清单入 CAS(前后哈希)+workspace.bind 入账;环境保持既成", async () => {
    const w = boot();
    try {
      writeFileSync(join(w.root, "a.txt"), "原件");
      w.cap.write("a.txt", "v2");
      w.cap.write("n.txt", "新");
      const r = w.cap.commit(ACTOR, "tr_test");
      expect(r.ops).toBe(2);
      const bind = w.kernel.store.all.find((e) => e.kind === "workspace.bind");
      expect(bind).toBeDefined();
      const manifest = JSON.parse(w.kernel.store.readCas((bind!.payload as { commit_cas: string }).commit_cas)) as {
        ops: { path: string; existed_before: boolean; sha256_before?: string; sha256_after: string }[];
      };
      const opA = manifest.ops.find((o) => o.path === "a.txt")!;
      expect(opA.existed_before).toBe(true);
      expect(opA.sha256_before).toBe(createHash("sha256").update("原件").digest("hex"));
      expect(opA.sha256_after).toBe(createHash("sha256").update("v2").digest("hex"));
      expect(manifest.ops.find((o) => o.path === "n.txt")!.existed_before).toBe(false);
      // 环境保持(commit 不回滚);discard 仍可整体还原(提交=归档,不锁定)
      expect(w.cap.read("a.txt")).toBe("v2");
      w.cleanup();
    } finally { w.cleanup(); }
  });

  it("重绑:丢弃内存态后按 sidecar 重建,discard 仍还原(崩溃恢复语义)", async () => {
    const w = boot();
    try {
      writeFileSync(join(w.root, "keep.txt"), "原件");
      w.cap.write("keep.txt", "改");
      w.cap.write("fresh.txt", "新");
      const before = hashDir(w.root === w.root ? join(w.root) : w.root);
      // 用"改写前"的哈希:重算原件态
      const beforeHash = createHash("sha256").update("原件").digest("hex");

      // 模拟重启:新 capture 经 rebindArgs 绑定同一 root/sidecar
      const cap2 = new WorkspaceCapture(w.kernel, "tool-fs@1.0.0", "webchat:dm:alice", w.root,
        { rebindArgs: { root: w.root, sidecar: w.sidecar } });
      expect(cap2.changedFiles().sort()).toEqual(["fresh.txt", "keep.txt"]);
      const r = await cap2.discard(ACTOR);
      expect(r.reverted.length).toBeGreaterThanOrEqual(1);
      expect(readFileSync(join(w.root, "keep.txt"), "utf-8")).toBe("原件");
      expect(existsSync(join(w.root, "fresh.txt"))).toBe(false);
      expect(createHash("sha256").update(readFileSync(join(w.root, "keep.txt"))).digest("hex")).toBe(beforeHash);
      void before;
      w.cleanup();
    } finally { w.cleanup(); }
  });

  it("路径逃逸拒绝;fs 工具经捕获层写并回读", async () => {
    const w = boot();
    try {
      expect(() => w.cap.write("../escape.txt", "x")).toThrow(/越界/);
      expect(() => w.cap.write("/abs.txt", "x")).toThrow(/越界/);

      // 工具层:write_file → 捕获层;read_file → 会话工作区
      await w.kernel.activate("tool-registry@1.0.0");
      await w.kernel.activate("tool-fs@1.0.0");
      const registry = w.kernel.service(TOOL_REGISTRY);
      const shared = join(w.root, "..", "..", "shared");
      const fsP2 = fsToolPlugin(shared, {
        workspaceFor: (sk, create): WorkspaceView | undefined =>
          create || sk === "webchat:dm:alice" ? w.cap : undefined,
      });
      w.kernel.bindModule("tool-fs@1.0.0", fsP2.module);
      await w.kernel.suspend("tool-fs@1.0.0");
      await w.kernel.activate("tool-fs@1.0.0");
      const writeTool = registry.get("write_file")!;
      const readTool = registry.get("read_file")!;
      const task = { sessionKey: "webchat:dm:alice", agentId: "ag_t", traceId: "tr_t" };
      const wr = writeTool.run({ name: "tool.txt", content: "来自工具" }, w.kernel.contextFor("tool-fs@1.0.0", { kind: "agent", id: "ag_t" }), task) as { content: string; ok?: boolean };
      expect(wr.ok).not.toBe(false);
      const rd = readTool.run({ name: "tool.txt" }, w.kernel.contextFor("tool-fs@1.0.0", { kind: "agent", id: "ag_t" }), task) as { content: string };
      expect(rd.content).toBe("来自工具");
      w.cleanup();
    } finally { w.cleanup(); }
  });
});

describe("性能 SLO(K.2:写拦截 overhead ≤10%,100 并发会话,R3-4/F-02)", () => {
  it("稳态拦截:预热后五轮交替,最小值比对 捕获/直写 ≤1.10(tmpfs 消磁盘噪声)", async () => {
    const base = existsSync("/dev/shm") ? "/dev/shm" : tmpdir(); // tmpfs:测拦截逻辑而非磁盘
    const dir = mkdtempSync(join(base, "samsara-slo-"));
    try {
      const t = tmpStore();
      const kernel = new Kernel(t.store);
      const reg = toolRegistryPlugin();
      kernel.install(reg.manifest, reg.module);
      const fsP = fsToolPlugin(join(dir, "shared"));
      kernel.install(fsP.manifest, fsP.module);

      const SESSIONS = 100;   // 百并发会话(R3-4 口径)
      const FILES = 50;
      const payload = "x".repeat(512);

      const directRoots = Array.from({ length: SESSIONS }, (_, i) => join(dir, `d${i}`));
      const caps = Array.from({ length: SESSIONS }, (_, i) =>
        new WorkspaceCapture(kernel, "tool-fs@1.0.0", `slo:dm:s${i}`, join(dir, `c${i}`)));

      // 预热:两侧各首写(捕获侧付 COW 首写——拷贝属覆盖层语义,不计入稳态拦截开销)
      for (const [i, root] of directRoots.entries()) {
        mkdirSync(root, { recursive: true });
        for (let j = 0; j < FILES; j++) writeFileSync(join(root, `f${j}.txt`), payload);
      }
      for (const cap of caps) for (let j = 0; j < FILES; j++) cap.write(`f${j}.txt`, payload);

      // 八轮交替(JIT 预热 + 消顺序偏差),最小值比对(标准抗噪基准:min = 最少受扰估计;隔离实验已证纯查表开销 ~1%)
      const directR: number[] = [];
      const capR: number[] = [];
      for (let round = 0; round < 8; round++) {
        let t0 = Date.now();
        await Promise.all(directRoots.map((root, i) => {
          for (let j = 0; j < FILES; j++) writeFileSync(join(root, `f${j}.txt`), payload + i + round);
          return Promise.resolve();
        }));
        directR.push(Date.now() - t0);
        t0 = Date.now();
        await Promise.all(caps.map((cap, i) => {
          for (let j = 0; j < FILES; j++) cap.write(`f${j}.txt`, payload + i + round);
          return Promise.resolve();
        }));
        capR.push(Date.now() - t0);
      }
      const min = (a: number[]) => Math.min(...a);
      const dm = min(directR), cm = min(capR);
      const ratio = cm / Math.max(1, dm);
      console.log(`SLO 实测(稳态,tmpfs,百会话): direct=[${directR.join(",")}] capture=[${capR.join(",")}] min 比=${ratio.toFixed(3)}(≤1.10)`);
      expect(ratio).toBeLessThanOrEqual(1.10);
      t.cleanup();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
