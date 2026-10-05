// L0 SQLite 投影层 —— 数据模型设计文档 §5(DDL 为规格)+ §7(投影与物化视图)
// 账本是唯一事实来源,本投影是可重建的派生读模型(可丢失性:可重建)。
// 集成方式:订阅 LedgerStore.onAppend,逐条应用(幂等:按 seq 去重)。
// M0 投影范围:ledger_entries 全量索引 + plugins + effects(有写入方的实体);
// 其余表按 §5 DDL 先建好,投影器随对应领域写入方(M1+)落地。

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LedgerEntry } from "./types.js";
import type { LedgerStore } from "./ledger.js";
import { SnapshotStore } from "./snapshot.js";
import { existsSync } from "node:fs";

/** 数据模型 §5 DDL(逐表移植;projection_meta 为基建增补——记录投影水位) */
const DDL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('installed','resolved','active','suspended','failed','disposed')),
  r_level TEXT NOT NULL CHECK (r_level IN ('R0','R1','R2','R3','R4')),
  manifest_cas TEXT NOT NULL,
  installed_seq INTEGER NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS effects (
  token TEXT PRIMARY KEY,
  plugin_id TEXT REFERENCES plugins(id),
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  desc TEXT NOT NULL,
  apply_seq INTEGER NOT NULL,
  revert_seq INTEGER,
  compensable INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('applied','reverted','compensated','failed'))
);
CREATE INDEX IF NOT EXISTS idx_effects_owner ON effects(owner_kind, owner_id, status);
CREATE INDEX IF NOT EXISTS idx_effects_plugin ON effects(plugin_id);

CREATE TABLE IF NOT EXISTS branches (
  branch_id TEXT PRIMARY KEY,
  base_cas TEXT NOT NULL,
  owner_session TEXT,
  state TEXT NOT NULL CHECK (state IN ('open','merged','abandoned')),
  created_seq INTEGER NOT NULL,
  closed_seq INTEGER
);

-- 分支覆盖差异(B.2:overlay 只存差异;§5 DDL 勘误——批次八补建,评审时 B.2 提及而 DDL 缺失)
CREATE TABLE IF NOT EXISTS branch_ops (
  branch_id TEXT NOT NULL,
  op_seq INTEGER NOT NULL,
  op_kind TEXT NOT NULL,
  target_cas TEXT,
  patch_cas TEXT,
  PRIMARY KEY (branch_id, op_seq)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_key TEXT PRIMARY KEY,
  lane_id TEXT NOT NULL,
  trust_level TEXT NOT NULL CHECK (trust_level IN ('owner','known','guest','untrusted')),
  branch_id TEXT REFERENCES branches(branch_id),
  workspace_id TEXT REFERENCES workspaces(id),
  mode TEXT NOT NULL DEFAULT 'auto_edit'
    CHECK (mode IN ('plan','confirm','auto_edit','full_access')),
  mode_expires_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('open','closed')),
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES agents(id),
  session_key TEXT NOT NULL REFERENCES sessions(session_key),
  depth INTEGER NOT NULL CHECK (depth <= 5),
  depth_approval_ref TEXT,
  budget_json TEXT NOT NULL,
  r_ceiling TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','done','killed')),
  trace_id TEXT
);

CREATE TABLE IF NOT EXISTS nodes (
  device_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('node','client')),
  caps TEXT NOT NULL,
  trust_evidence_cas TEXT,
  paired_at TEXT,
  paired_by TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','approved','revoked'))
);

CREATE TABLE IF NOT EXISTS trust_edges (
  id TEXT PRIMARY KEY,
  src_node TEXT NOT NULL REFERENCES nodes(device_id),
  dst_node TEXT NOT NULL REFERENCES nodes(device_id),
  created_seq INTEGER NOT NULL,
  revoked_seq INTEGER,
  state TEXT NOT NULL CHECK (state IN ('active','revoked')),
  UNIQUE (src_node, dst_node, created_seq)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(device_id),
  root TEXT NOT NULL,
  env_profile TEXT,
  trust_ceiling TEXT NOT NULL CHECK (trust_ceiling IN ('owner','known','guest','untrusted')),
  created_seq INTEGER NOT NULL
);

-- 主键 (branch, cas_id):同内容可同时存在于分支与 main(COW 分支+晋升的语义必然;
-- 单 cas_id 主键为 §5 DDL 勘误,批次八修正——实现暴露:晋升即同 cas 双行)
CREATE TABLE IF NOT EXISTS skill_nodes (
  cas_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  parent_cas TEXT, -- 版本链边;自引用 FK 随复合主键勘误移除(完整性由写入方保证,批次八)
  branch TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL CHECK (status IN ('active','stale','archived','quarantined')),
  provenance TEXT NOT NULL,
  metrics_json TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes <= 15360),
  PRIMARY KEY (branch, cas_id)
);
CREATE INDEX IF NOT EXISTS idx_skill_lookup ON skill_nodes(name, branch, status);

CREATE TABLE IF NOT EXISTS memory_items (
  cas_id TEXT PRIMARY KEY,
  layer TEXT NOT NULL CHECK (layer IN ('working','episodic','semantic')),
  session_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','stale','archived','forgotten')),
  provenance TEXT NOT NULL,
  forgotten_seq INTEGER
);
CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_items(session_key, layer, status);

CREATE TABLE IF NOT EXISTS promotion_requests (
  id TEXT PRIMARY KEY,
  asset_cas TEXT NOT NULL,
  source_branch TEXT NOT NULL,
  gate_stage TEXT NOT NULL CHECK (gate_stage IN ('lint','shadow','gate','merged','rejected')),
  verdict_json TEXT,
  reviewer TEXT,
  created_seq INTEGER NOT NULL,
  decided_seq INTEGER
);

CREATE TABLE IF NOT EXISTS shadow_runs (
  id TEXT PRIMARY KEY,
  variant_cas TEXT NOT NULL,
  baseline_cas TEXT,
  traceset_ref TEXT,
  metrics_json TEXT,
  verdict TEXT,
  cost_cents INTEGER
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  schedule_cron TEXT NOT NULL,
  timezone TEXT NOT NULL,
  goal_cas TEXT NOT NULL,
  trust_snapshot TEXT NOT NULL,
  budget_json TEXT NOT NULL,
  r_ceiling TEXT NOT NULL,
  notification TEXT NOT NULL DEFAULT 'smart',
  misfire TEXT NOT NULL DEFAULT 'skip' CHECK (misfire IN ('skip','runOnce','catchUp')),
  expires_at TEXT,
  state TEXT NOT NULL DEFAULT 'active',
  CHECK (r_ceiling IN ('R0','R1','R2','R3','R4')),
  CHECK (r_ceiling IN ('R0','R1','R2') OR expires_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS scorecards (
  task_cluster TEXT NOT NULL,
  model_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  overrides INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  avg_cost_cents INTEGER,
  updated_at TEXT,
  PRIMARY KEY (task_cluster, model_id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  seq INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_json TEXT,
  payload_hash TEXT NOT NULL,
  payload_cas TEXT,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_kind ON ledger_entries(kind, seq);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  first_seq INTEGER NOT NULL,
  result_cas TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  actor_trust TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('approve','reject','edit','intervene_queued','intervene_immediate','kill')),
  target_ref TEXT,
  latency_ms INTEGER,
  context_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_ts ON review_events(ts);

CREATE TABLE IF NOT EXISTS prompt_assets (
  cas_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  parent_cas TEXT REFERENCES prompt_assets(cas_id),
  status TEXT NOT NULL CHECK (status IN ('active','stale','archived','quarantined')),
  provenance TEXT NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS workflows (
  cas_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  parent_cas TEXT REFERENCES workflows(cas_id),
  compiled_from TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','degraded','decompiled','archived')),
  metrics_json TEXT,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_cas TEXT NOT NULL REFERENCES workflows(cas_id),
  started_at TEXT NOT NULL,
  outcome TEXT CHECK (outcome IN ('success','fallback','failed')),
  fallback_nodes INTEGER DEFAULT 0,
  trace_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_wfruns ON workflow_runs(workflow_cas, started_at);

-- 基建增补(非 §5 规格):投影水位,支持增量追平与全量重建的对账
CREATE TABLE IF NOT EXISTS projection_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** 插件 id 派生:确定性(重放不变)——name@version 的内容哈希 */
export function pluginRowId(name: string, version: string): string {
  return "pl_" + createHash("sha256").update(`${name}@${version}`).digest("hex").slice(0, 24);
}

/** 账本 ref.plugin("name@version")→ plugins.id */
function refPluginId(pid: string): string {
  const at = pid.indexOf("@");
  return pluginRowId(pid.slice(0, at), pid.slice(at + 1));
}

interface EffectApplyPayload {
  desc: string; rClass: number; owner: { kind: string; id: string };
}
interface PluginInstallPayload {
  manifest: { name: string; version: string; rLevel: string; kind?: string };
}

export class Projection {
  readonly db: Database.Database;
  private lastSeq = 0;
  private detach: (() => void) | undefined;
  private rootDir: string;
  private dbPath: string;
  private attachedStore: LedgerStore | undefined;

  private constructor(db: Database.Database, rootDir: string, dbPath: string) {
    this.db = db;
    this.rootDir = rootDir;
    this.dbPath = dbPath;
    this.readWatermark();
  }

  private readWatermark(): void {
    // 恢复持久化水位:重开时从 projection_meta 续读,而非从 0 重放(避免 UNIQUE 冲突)
    const row = this.db.prepare(`SELECT value FROM projection_meta WHERE key='last_seq'`).get() as { value: string } | undefined;
    this.lastSeq = row ? Number(row.value) : 0;
  }

  /** 打开(或创建)投影;自动从账本追平到最新 */
  static open(rootDir: string, store: LedgerStore): Projection {
    const dir = join(rootDir, "ledger");
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "index.sqlite");
    const db = new Database(dbPath);
    db.exec(DDL);
    const p = new Projection(db, rootDir, dbPath);
    p.catchUp(store);
    p.detach = store.onAppend((e) => p.apply(e));
    p.attachedStore = store;
    return p;
  }

  get watermark(): number { return this.lastSeq; }

  /** 增量追平:应用账本中尚未投影的条目 */
  catchUp(store: LedgerStore): void {
    for (const e of store.all) this.apply(e);
  }

  /**
   * 重建(数据模型 §7"可重建"):优先从最近快照恢复 SQLite 副本后仅追平尾部(§3.2 加速);
   * 无可用快照则清空全量重放。两条路径的等价性由 tests/snapshot.test.ts 钉死。
   */
  rebuild(store: LedgerStore): void {
    const snap = new SnapshotStore(this.rootDir).latest(store.lastSeq);
    if (snap) {
      const attached = this.attachedStore;
      this.close();
      new SnapshotStore(this.rootDir).restoreSqliteTo(snap, this.dbPath);
      (this as { db: Database.Database }).db = new Database(this.dbPath);
      this.readWatermark();
      if (attached) {
        this.attachedStore = attached;
        this.detach = attached.onAppend((e) => this.apply(e));
      }
      this.catchUp(store);
      return;
    }
    this.rebuildFromScratch(store);
  }

  private rebuildFromScratch(store: LedgerStore): void {
    const tables = [
      "workflow_runs", "workflows", "prompt_assets", "review_events", "idempotency_keys",
      "ledger_entries", "scorecards", "jobs", "shadow_runs", "promotion_requests",
      "memory_items", "skill_nodes", "workspaces", "trust_edges", "nodes", "agents",
      "sessions", "branches", "branch_ops", "effects", "plugins", "projection_meta",
    ];
    this.db.transaction(() => {
      for (const t of tables) this.db.exec(`DELETE FROM ${t}`);
      this.lastSeq = 0;
      for (const e of store.all) this.apply(e);
    })();
  }

  /** 幂等应用一条账目(按 seq 单调推进) */
  apply(e: LedgerEntry): void {
    if (e.seq <= this.lastSeq) return;
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO ledger_entries (seq, ts, actor_json, kind, ref_json, payload_hash, payload_cas, prev_hash, entry_hash)
         VALUES (@seq, @ts, @actor_json, @kind, @ref_json, @payload_hash, @payload_cas, @prev_hash, @entry_hash)`,
      ).run({
        seq: e.seq, ts: e.ts, actor_json: JSON.stringify(e.actor), kind: e.kind,
        ref_json: e.ref !== undefined ? JSON.stringify(e.ref) : null,
        payload_hash: e.payload_hash, payload_cas: e.payload_cas ?? null,
        prev_hash: e.prev_hash, entry_hash: e.entry_hash,
      });
      this.projectEntry(e);
      this.lastSeq = e.seq;
      this.db.prepare(`INSERT INTO projection_meta (key, value) VALUES ('last_seq', ?)
                       ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(e.seq));
    })();
  }

  private projectEntry(e: LedgerEntry): void {
    const pid = e.ref?.plugin as string | undefined;
    switch (e.kind) {
      case "plugin.install": {
        const m = (e.payload as PluginInstallPayload).manifest;
        this.db.prepare(
          `INSERT INTO plugins (id, name, version, kind, state, r_level, manifest_cas, installed_seq)
           VALUES (?, ?, ?, ?, 'installed', ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET state='installed', installed_seq=excluded.installed_seq, manifest_cas=excluded.manifest_cas`,
        ).run(
          pluginRowId(m.name, m.version), m.name, m.version, m.kind ?? "unspecified",
          m.rLevel, `sha256:${e.payload_hash}`, e.seq,
        );
        break;
      }
      case "plugin.activate": {
        if (!pid) break;
        const id = refPluginId(pid);
        if (e.ref?.reason === "waiting") {
          // §3.3 resolved:请求已表达、依赖未就绪
          this.db.prepare(`UPDATE plugins SET state='resolved' WHERE id=? AND state='installed'`).run(id);
        } else {
          this.db.prepare(`UPDATE plugins SET state='active' WHERE id=?`).run(id);
        }
        break;
      }
      case "plugin.suspend": {
        if (!pid) break;
        const id = refPluginId(pid);
        const reason = e.ref?.reason;
        if (reason === "dependency") {
          this.db.prepare(`UPDATE plugins SET state='suspended' WHERE id=?`).run(id);
        } else if (reason === "failed") {
          this.db.prepare(`UPDATE plugins SET state='installed' WHERE id=?`).run(id);
        } else {
          // operator:激活态→suspended;等待态(resolved)→回 installed(意愿已释放)
          this.db.prepare(
            `UPDATE plugins SET state = CASE WHEN state='resolved' THEN 'installed' ELSE 'suspended' END WHERE id=?`,
          ).run(id);
        }
        break;
      }
      case "plugin.dispose": {
        if (!pid) break;
        const id = refPluginId(pid);
        this.db.prepare(`UPDATE plugins SET state='disposed' WHERE id=?`).run(id);
        break;
      }
      case "effect.apply": {
        const p = e.payload as EffectApplyPayload;
        this.db.prepare(
          `INSERT INTO effects (token, plugin_id, owner_kind, owner_id, desc, apply_seq, compensable, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'applied')
           ON CONFLICT(token) DO UPDATE SET apply_seq=excluded.apply_seq, status='applied', revert_seq=NULL`,
        ).run(
          e.ref?.token as string,
          pid ? refPluginId(pid) : null,
          p.owner.kind, p.owner.id, p.desc, e.seq, p.rClass,
        );
        break;
      }
      case "effect.revert":
      case "effect.compensate": {
        this.db.prepare(
          `UPDATE effects SET status=?, revert_seq=? WHERE token=?`,
        ).run(e.kind === "effect.revert" ? "reverted" : "compensated", e.seq, e.ref?.token as string);
        break;
      }
      case "session.open": {
        const p = e.payload as { session_key: string; branch_id: string; trust_level?: string; base_cas?: string };
        // 先分支后会话(sessions.branch_id 外键指向 branches;better-sqlite3 默认启用 FK)
        this.db.prepare(
          `INSERT INTO branches (branch_id, base_cas, owner_session, state, created_seq)
           VALUES (?, ?, ?, 'open', ?)
           ON CONFLICT(branch_id) DO UPDATE SET state='open'`,
        ).run(p.branch_id, p.base_cas ?? "", p.session_key, e.seq);
        this.db.prepare(
          `INSERT INTO sessions (session_key, lane_id, trust_level, branch_id, mode, state, created_at, last_active_at)
           VALUES (?, 'default', ?, ?, 'auto_edit', 'open', ?, ?)
           ON CONFLICT(session_key) DO UPDATE SET state='open', last_active_at=excluded.last_active_at`,
        ).run(p.session_key, p.trust_level ?? "owner", p.branch_id, e.ts, e.ts);
        break;
      }
      case "session.close": {
        const p = e.payload as { session_key: string; branch_id: string; branch_state?: string };
        this.db.prepare(`UPDATE sessions SET state='closed', last_active_at=? WHERE session_key=?`).run(e.ts, p.session_key);
        this.db.prepare(`UPDATE branches SET state=?, closed_seq=? WHERE branch_id=?`)
          .run(p.branch_state === "abandoned" ? "abandoned" : "merged", e.seq, p.branch_id);
        break;
      }
      case "skill.commit": {
        const p = e.payload as {
          name: string; cas: string; version: number; branch: string; size: number;
          parent_cas?: string | null; provenance?: unknown; trigger?: string;
        };
        this.db.prepare(
          `INSERT INTO skill_nodes (cas_id, name, version, parent_cas, branch, status, provenance, metrics_json, size_bytes)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        ).run(p.cas, p.name, p.version, p.parent_cas ?? null, p.branch,
              JSON.stringify(p.provenance ?? {}),
              JSON.stringify(p.trigger !== undefined ? { trigger: p.trigger } : {}), p.size);
        if (p.branch !== "main") {
          this.db.prepare(
            `INSERT INTO branch_ops (branch_id, op_seq, op_kind, target_cas, patch_cas) VALUES (?, ?, 'skill.commit', ?, ?)`,
          ).run(p.branch, e.seq, p.cas, p.cas);
        }
        break;
      }
      case "skill.promote": {
        const p = e.payload as { name: string; cas: string; version: number; parent_cas?: string | null; from_branch: string };
        this.db.prepare(
          `INSERT INTO skill_nodes (cas_id, name, version, parent_cas, branch, status, provenance, metrics_json, size_bytes)
           SELECT ?, ?, ?, ?, 'main', 'active', provenance, metrics_json, size_bytes
           FROM skill_nodes WHERE cas_id=? AND branch=? LIMIT 1`,
        ).run(p.cas, p.name, p.version, p.parent_cas ?? null, p.cas, p.from_branch);
        break;
      }
      default:
        break; // 其余 kind:表已备、投影器随对应写入方(M2+)落地
    }
  }

  // ── 查询面(CLI/测试)───────────────────────────────────────

  stats(): Record<string, number> {
    const out: Record<string, number> = {};
    const tables = this.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'projection_meta'`,
    ).all() as { name: string }[];
    for (const { name } of tables) {
      out[name] = (this.db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n;
    }
    return out;
  }

  plugins(): { id: string; name: string; version: string; state: string; installed_seq: number }[] {
    return this.db.prepare(`SELECT id, name, version, state, installed_seq FROM plugins ORDER BY installed_seq`).all() as never;
  }

  effects(): {
    token: string; owner_kind: string; owner_id: string; desc: string;
    apply_seq: number; revert_seq: number | null; compensable: number; status: string;
  }[] {
    return this.db.prepare(
      `SELECT token, owner_kind, owner_id, desc, apply_seq, revert_seq, compensable, status FROM effects ORDER BY apply_seq`,
    ).all() as never;
  }

  /** 投影对账:水位 == 账本末位(doctor / 冻结检查项) */
  reconcile(store: LedgerStore): { ok: boolean; watermark: number; ledgerSeq: number } {
    return { ok: this.lastSeq === store.lastSeq, watermark: this.lastSeq, ledgerSeq: store.lastSeq };
  }

  /** 测试辅助:整库快照(确定性排序) */
  dump(): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const [t] of Object.entries(this.stats())) {
      out[t] = this.db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all();
    }
    return out;
  }

  close(): void {
    this.detach?.();
    this.db.close();
  }
}
