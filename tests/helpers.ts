// 测试助手:临时存储目录、插件工厂、环境哈希(契约测试用)

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerStore } from "../src/kernel/ledger.js";
import { canonicalJson, sha256Hex } from "../src/kernel/ledger.js";
import type { PluginManifest, PluginModule } from "../src/kernel/types.js";

export function tmpStore(): { store: LedgerStore; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "samsara-test-"));
  return {
    store: new LedgerStore(dir),
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export interface PluginSpec {
  name: string;
  provides?: string[];
  requires?: string[];
  /** start 钩子(默认:provide 声明的全部服务) */
  onStart?: PluginModule["start"];
  stop?: PluginModule["stop"];
}

export function makePlugin(spec: PluginSpec): { manifest: PluginManifest; module: PluginModule } {
  const manifest: PluginManifest = {
    name: spec.name, version: "1.0.0",
    provides: spec.provides ?? [`${spec.name}.svc`],
    requires: spec.requires ?? [],
    rLevel: "R0",
  };
  const module: PluginModule = {
    start: spec.onStart ?? ((ctx) => {
      for (const s of manifest.provides) ctx.provide({ name: s } as never, { by: spec.name });
    }),
    ...(spec.stop ? { stop: spec.stop } : {}),
  };
  return { manifest, module };
}

/** 可哈希环境:契约测试断言 apply→revert 后环境哈希不变(§3.4) */
export class HashEnv {
  private readonly m = new Map<string, string>();
  set(k: string, v: string) { this.m.set(k, v); }
  del(k: string) { this.m.delete(k); }
  get(k: string) { return this.m.get(k); }
  hash(): string { return sha256Hex(canonicalJson([...this.m.entries()].sort())); }
  snapshot(): Map<string, string> { return new Map(this.m); }
  restore(snap: Map<string, string>) { this.m.clear(); for (const [k, v] of snap) this.m.set(k, v); }
}

/** 确定性 RNG(mulberry32)——崩溃恢复模糊测试用 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
