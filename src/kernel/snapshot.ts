// L0 快照存储 —— 数据模型 §3.2(快照与重放)+ §9(保留策略)
// 触发:每 10⁵ 条或每日(先到者为准;常量 spec-constants: ledger_snapshot_every_entries)
// 内容:kernel-state.json(内核簿记)+ index.sqlite 投影一致性副本(VACUUM INTO)
// 原子性:写临时目录后 rename——崩溃时残缺快照永远不会成为"最近快照"
// 保留:最近 7 个 + 每月 1 个(该月最大 seq)
// 格式注:规格写 snapshot_<seq>.tar.zst 单文件;M0 落地为同名目录(免 zstd 原生依赖),
//        打包压缩随 M0 完成期收尾,格式头 samsara-snapshot/1 保持前向兼容。

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Kernel } from "./kernel.js";
import type { Projection } from "./projection.js";
import type { LedgerStore } from "./ledger.js";

export interface SnapshotManifest {
  schema: "samsara-snapshot/1";
  seq: number;
  ts: string;
  files: { kernel_state: string; sqlite: string };
}

export interface SnapshotInfo { seq: number; dir: string; ts: string }

export interface SnapshotOptions {
  everyEntries?: number; // 默认 100000(spec-constants)
  everyMs?: number;      // 默认 24h(每日)
  keep?: number;         // 默认 7(数据模型 §9)
}

export class SnapshotStore {
  readonly rootDir: string;
  private readonly dir: string;
  private readonly everyEntries: number;
  private readonly everyMs: number;
  private readonly keep: number;

  constructor(rootDir: string, opts: SnapshotOptions = {}) {
    this.rootDir = rootDir;
    this.dir = join(rootDir, "ledger", "snapshots");
    this.everyEntries = opts.everyEntries ?? 100_000;
    this.everyMs = opts.everyMs ?? 24 * 60 * 60 * 1000;
    this.keep = opts.keep ?? 7;
    mkdirSync(this.dir, { recursive: true });
  }

  /** 最近可用快照(seq 最大且 manifest 完整);onlyUsable:seq 须不超账本长度 */
  latest(ledgerLastSeq = Infinity): SnapshotInfo | null {
    const cands: SnapshotInfo[] = [];
    for (const name of readdirSync(this.dir, { withFileTypes: true })) {
      const m = /^snapshot_(\d+)$/.exec(name.name);
      if (!m || !name.isDirectory()) continue;
      const dir = join(this.dir, name.name);
      try {
        const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as SnapshotManifest;
        if (manifest.schema !== "samsara-snapshot/1") continue;
        if (!existsSync(join(dir, manifest.files.kernel_state))) continue;
        if (manifest.seq <= ledgerLastSeq) cands.push({ seq: manifest.seq, dir, ts: manifest.ts });
      } catch { /* 残缺快照:跳过(原子性保证不会出现,防御读取竞态) */ }
    }
    return cands.sort((a, b) => b.seq - a.seq)[0] ?? null;
  }

  /** 生成快照:kernel 簿记 + 投影 SQLite 副本,原子发布 */
  create(kernel: Kernel, projection: Projection, store: LedgerStore): SnapshotInfo {
    const seq = store.lastSeq;
    const ts = new Date().toISOString();
    const finalDir = join(this.dir, `snapshot_${seq}`);
    const tmpDir = join(this.dir, `.tmp_${seq}_${Date.now()}`);
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });

    writeFileSync(join(tmpDir, "kernel-state.json"), JSON.stringify(kernel.serializeState(), null, 0));
    // VACUUM INTO:SQLite 一致性在线备份(WAL 模式下安全)
    projection.db.exec(`VACUUM INTO '${join(tmpDir, "index.sqlite").replace(/'/g, "''")}'`);
    const manifest: SnapshotManifest = {
      schema: "samsara-snapshot/1", seq, ts,
      files: { kernel_state: "kernel-state.json", sqlite: "index.sqlite" },
    };
    writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    rmSync(finalDir, { recursive: true, force: true }); // 同 seq 重建:先移旧
    renameSync(tmpDir, finalDir);
    this.prune();
    return { seq, dir: finalDir, ts };
  }

  /** 触发规则(§3.2:每 everyEntries 条或每 everyMs,先到者为准) */
  maybeAutoCreate(kernel: Kernel, projection: Projection, store: LedgerStore): SnapshotInfo | null {
    if (store.lastSeq < 1) return null; // 空账本不快照
    const last = this.latest();
    const lastSeq = last?.seq ?? 0;
    const lastTs = last ? Date.parse(last.ts) : 0;
    const byEntries = store.lastSeq - lastSeq >= this.everyEntries;
    const byDaily = Date.now() - lastTs >= this.everyMs; // 无快照时视为已超期(建基线)
    if (!byEntries && !byDaily) return null;
    return this.create(kernel, projection, store);
  }

  loadKernelState(snap: SnapshotInfo): unknown {
    return JSON.parse(readFileSync(join(snap.dir, "kernel-state.json"), "utf-8"));
  }

  sqlitePath(snap: SnapshotInfo): string { return join(snap.dir, "index.sqlite"); }

  /** 保留策略(§9):最近 keep 个 + 每月最大 seq 一个 */
  prune(): number {
    const all: SnapshotInfo[] = [];
    for (const name of readdirSync(this.dir, { withFileTypes: true })) {
      const m = /^snapshot_(\d+)$/.exec(name.name);
      if (m && name.isDirectory()) all.push({ seq: Number(m[1]), dir: join(this.dir, name.name), ts: "" });
    }
    all.sort((a, b) => b.seq - a.seq);
    const keepSet = new Set(all.slice(0, this.keep).map((s) => s.seq));
    const monthlyMax = new Map<string, number>();
    for (const s of all) {
      try {
        const mf = JSON.parse(readFileSync(join(s.dir, "manifest.json"), "utf-8")) as SnapshotManifest;
        const key = mf.ts.slice(0, 7); // YYYY-MM
        if (!monthlyMax.has(key)) { monthlyMax.set(key, s.seq); keepSet.add(s.seq); }
      } catch { /* 残缺:不保留 */ }
    }
    let removed = 0;
    for (const s of all) {
      if (!keepSet.has(s.seq)) { rmSync(s.dir, { recursive: true, force: true }); removed++; }
    }
    return removed;
  }

  /** 恢复投影 SQLite 副本到指定路径(调用方负责关闭目标库并重建监听) */
  restoreSqliteTo(snap: SnapshotInfo, targetPath: string): void {
    rmSync(targetPath, { force: true });
    rmSync(targetPath + "-wal", { force: true });
    rmSync(targetPath + "-shm", { force: true });
    cpSync(this.sqlitePath(snap), targetPath);
  }
}
