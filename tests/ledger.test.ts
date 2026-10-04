// 账本:哈希链完整性 / 篡改检测 / CAS 外置 / 规范化 JSON(数据模型 §3)

import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, LedgerStore, sha256Hex } from "../src/kernel/ledger.js";
import { LEDGER_KINDS } from "../src/kernel/types.js";
import { tmpStore } from "./helpers.js";

const ACTOR = { kind: "system" as const, id: "test" };

describe("账本哈希链", () => {
  it("追加后链校验通过,seq 单调", () => {
    const { store, cleanup } = tmpStore();
    for (let i = 0; i < 20; i++) {
      store.append({ actor: ACTOR, kind: "review.event", payload: { i } });
    }
    expect(store.lastSeq).toBe(20);
    expect(store.verifyChain().ok).toBe(true);
    cleanup();
  });

  it("篡改任意条目内容 → entry_hash 校验失败(篡改可被校验发现)", () => {
    const { store, dir, cleanup } = tmpStore();
    store.append({ actor: ACTOR, kind: "review.event", payload: { verdict: "approve" } });
    store.append({ actor: ACTOR, kind: "job.fire", payload: { job: "j1" } });

    const logPath = join(dir, "ledger", "head.log");
    const lines = readFileSync(logPath, "utf-8").trimEnd().split("\n");
    const tampered = JSON.parse(lines[1]!);
    tampered.payload = { job: "j2-hacked" }; // 只改内容,不动 hash
    lines[1] = JSON.stringify(tampered);
    writeFileSync(logPath, lines.join("\n") + "\n");

    const reopened = new LedgerStore(dir);
    const result = reopened.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.firstBad).toBe(2);
    expect(result.reason).toContain("篡改");
    cleanup();
  });

  it("kind 枚举为 GAP4 补全版(关键新增 kind 在列)", () => {
    const must = ["effect.compensate", "effect.preapproval", "mode.changed",
      "intervene.immediate", "memory.forget.rollback", "trust.anchor_missing",
      "device.pair_approved", "channel.fallback", "rollback.marker"];
    for (const k of must) expect(LEDGER_KINDS).toContain(k);
  });
});

describe("CAS 与规范化", () => {
  it("payload >1KB 外置 CAS:内联不出现、blob 可回读、引用完整", () => {
    const { store, cleanup } = tmpStore();
    const big = { blob: "x".repeat(4096) };
    const e = store.append({ actor: ACTOR, kind: "memory.write", payload: big });
    expect(e.payload).toBeUndefined();
    expect(e.payload_cas).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.parse(store.readCas(e.payload_cas!))).toEqual(big);
    expect(store.verifyCas().ok).toBe(true);
    cleanup();
  });

  it("小 payload ≤1KB 内联", () => {
    const { store, cleanup } = tmpStore();
    const e = store.append({ actor: ACTOR, kind: "review.event", payload: { ok: true } });
    expect(e.payload).toEqual({ ok: true });
    expect(e.payload_cas).toBeUndefined();
    cleanup();
  });

  it("同内容去重:两次外置只落一个 blob", () => {
    const { store, cleanup } = tmpStore();
    const big = { blob: "y".repeat(2048) };
    store.append({ actor: ACTOR, kind: "memory.write", payload: big });
    store.append({ actor: ACTOR, kind: "memory.write", payload: big });
    expect(store.casBlobCount()).toBe(1);
    cleanup();
  });

  it("canonicalJson 键序无关,哈希稳定", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });
});
