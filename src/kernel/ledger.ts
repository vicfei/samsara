// L0 串行账本 —— 主文档 §3.2.4 / 数据模型 §3
// 事件溯源:账本是唯一事实来源,内存状态是重放投影。
// 哈希链:entry_hash = sha256(prev_hash ‖ canonical(entry)),篡改可被校验发现。
// 存储:追加日志(ledger/head.log,每行一条 JSON)+ CAS(assets/blobs/,内容寻址)。
// payload > 1KB(ledger_inline_payload_max_bytes,spec-constants)一律外置 CAS。

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { LedgerActor, LedgerEntry, LedgerKind, LedgerRef } from "./types.js";

export const GENESIS_HASH = "0".repeat(64);
export const LEDGER_INLINE_PAYLOAD_MAX_BYTES = 1024; // spec-constants: ledger_inline_payload_max_bytes

/** 规范化 JSON:对象键排序、无空格——哈希链对序列化形态必须敏感且确定 */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(sort);
    if (v instanceof Map) throw new TypeError("Map 不可入账,先转普通对象");
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sort(val); // undefined 不参与规范化
    }
    return out;
  };
  return JSON.stringify(sort(value));
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function entryHash(entry: Omit<LedgerEntry, "entry_hash">): string {
  const { entry_hash: _drop, ...rest } = entry as LedgerEntry; // 防御:不计入自身
  return sha256Hex(entry.prev_hash + canonicalJson(rest));
}

export interface AppendOptions {
  actor: LedgerActor;
  kind: LedgerKind;
  ref?: LedgerRef;
  payload?: unknown;
}

/** 账本存储:追加日志 + CAS。单写入者(INV-4),进程内串行调用。 */
export class LedgerStore {
  private entries: LedgerEntry[] = [];
  private head = GENESIS_HASH;
  private seq = 0;
  private readonly logPath: string;
  private readonly casDir: string;

  constructor(rootDir: string) {
    const ledgerDir = join(rootDir, "ledger");
    this.logPath = join(ledgerDir, "head.log");
    this.casDir = join(rootDir, "assets", "blobs");
    mkdirSync(dirname(this.logPath), { recursive: true });
    mkdirSync(this.casDir, { recursive: true });
    this.loadExisting();
  }

  private loadExisting(): void {
    if (!existsSync(this.logPath)) return;
    for (const line of readFileSync(this.logPath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as LedgerEntry;
      this.entries.push(entry);
      this.seq = entry.seq;
      this.head = entry.entry_hash;
    }
  }

  append(opts: AppendOptions): LedgerEntry {
    this.seq += 1;
    const base: Omit<LedgerEntry, "entry_hash"> = {
      seq: this.seq,
      ts: new Date().toISOString(),
      actor: opts.actor,
      kind: opts.kind,
      ...(opts.ref !== undefined ? { ref: opts.ref } : {}),
      ...(this.materializePayload(opts.payload)),
      prev_hash: this.head,
    };
    const entry: LedgerEntry = { ...base, entry_hash: entryHash(base) };
    appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
    this.entries.push(entry);
    this.head = entry.entry_hash;
    return entry;
  }

  /** payload ≤1KB 内联;>1KB 外置 CAS,账本只存 payload_hash + payload_cas(数据模型 §3.1) */
  private materializePayload(payload: unknown): Pick<LedgerEntry, "payload" | "payload_hash" | "payload_cas"> {
    if (payload === undefined) return { payload_hash: sha256Hex("null") };
    const json = canonicalJson(payload);
    if (Buffer.byteLength(json) <= LEDGER_INLINE_PAYLOAD_MAX_BYTES) {
      return { payload, payload_hash: sha256Hex(json) };
    }
    const hash = sha256Hex(json);
    const blobPath = join(this.casDir, hash.slice(0, 2), hash.slice(2, 4), hash);
    if (!existsSync(blobPath)) {
      mkdirSync(dirname(blobPath), { recursive: true });
      appendFileSync(blobPath, json);
    }
    return { payload_hash: hash, payload_cas: `sha256:${hash}` };
  }

  readCas(casRef: string): string {
    const hash = casRef.replace(/^sha256:/, "");
    return readFileSync(join(this.casDir, hash.slice(0, 2), hash.slice(2, 4), hash), "utf-8");
  }

  get all(): readonly LedgerEntry[] { return this.entries; }
  get lastSeq(): number { return this.seq; }
  get headHash(): string { return this.head; }

  slice(fromSeqExclusive: number, toSeqInclusive = this.seq): LedgerEntry[] {
    return this.entries.filter((e) => e.seq > fromSeqExclusive && e.seq <= toSeqInclusive);
  }

  /** 链完整性校验:重算每条 entry_hash 并验证 prev_hash 链(数据模型 §3.3) */
  verifyChain(fromSeq = 1, toSeq = this.seq): { ok: boolean; firstBad?: number; reason?: string } {
    let prev = GENESIS_HASH;
    for (const e of this.entries) {
      if (e.seq < fromSeq) { prev = e.entry_hash; continue; }
      if (e.seq > toSeq) break;
      if (e.prev_hash !== prev) return { ok: false, firstBad: e.seq, reason: "prev_hash 断裂" };
      const { entry_hash, ...rest } = e;
      if (entryHash(rest as Omit<LedgerEntry, "entry_hash">) !== entry_hash) {
        return { ok: false, firstBad: e.seq, reason: "entry_hash 不匹配(内容被篡改)" };
      }
      prev = entry_hash;
    }
    return { ok: true };
  }

  /** CAS 引用完整性:被引用 blob 必须存在且内容哈希一致(抽查全量) */
  verifyCas(): { ok: boolean; missing: string[]; corrupted: string[] } {
    const missing: string[] = [], corrupted: string[] = [];
    for (const e of this.entries) {
      if (!e.payload_cas) continue;
      const hash = e.payload_cas.replace(/^sha256:/, "");
      const p = join(this.casDir, hash.slice(0, 2), hash.slice(2, 4), hash);
      if (!existsSync(p)) { missing.push(hash); continue; }
      if (sha256Hex(readFileSync(p, "utf-8")) !== hash) corrupted.push(hash);
    }
    return { ok: missing.length === 0 && corrupted.length === 0, missing, corrupted };
  }

  /** 仅测试用途:统计 CAS blob 数 */
  casBlobCount(): number {
    let n = 0;
    const walk = (d: string) => {
      if (!existsSync(d)) return;
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(join(d, f.name));
        else n++;
      }
    };
    walk(this.casDir);
    return n;
  }
}
