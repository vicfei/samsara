// 轨迹 Parquet 投影(数据模型 §7:实时双写、按月分区、列式压缩)
// 订阅账本 onAppend:agent.terminate 携 trace_cas → 读回轨迹 → 追加进当月 Parquet 分区。
// duckdb 内存库 + 读旧分区合并重写(M1 量级够用;增量 append 优化随 M2 记分卡需求评估)。
// 可丢失性:可重建(重放账本全量 agent.terminate 即可;重建昂贵——建议额外备份,§7 原文)。

import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LedgerStore } from "../kernel/ledger.js";
import type { LedgerEntry } from "../kernel/types.js";

export interface TraceRow {
  trace_id: string;
  session_key: string;
  agent_id: string;
  outcome: string;
  task_cluster: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  duration_ms: number;
  step_count: number;
  replay_bundle_cas: string;
  ts: string;
}

const DUCK_SCHEMA = `(
  trace_id VARCHAR, session_key VARCHAR, agent_id VARCHAR, outcome VARCHAR,
  task_cluster VARCHAR, model VARCHAR, prompt_tokens INTEGER, completion_tokens INTEGER,
  duration_ms INTEGER, step_count INTEGER, replay_bundle_cas VARCHAR, ts VARCHAR
)`;

function rowOf(e: LedgerEntry, trace: Record<string, unknown>): TraceRow {
  return {
    trace_id: String(trace.trace_id ?? ""),
    session_key: String(trace.session_key ?? ""),
    agent_id: String(trace.agent_id ?? ""),
    outcome: String(trace.outcome ?? ""),
    task_cluster: String(trace.task_cluster ?? ""),
    model: String(trace.model ?? ""),
    prompt_tokens: Number((trace.usage as { promptTokens?: number } | undefined)?.promptTokens ?? 0),
    completion_tokens: Number((trace.usage as { completionTokens?: number } | undefined)?.completionTokens ?? 0),
    duration_ms: Number(trace.duration_ms ?? 0),
    step_count: Array.isArray(trace.steps) ? (trace.steps as unknown[]).length : 0,
    replay_bundle_cas: String(trace.replay_bundle_cas ?? ""),
    ts: e.ts,
  };
}

export class TraceProjection {
  private lastSeq = 0;
  private appended = 0;
  private detach: (() => void) | undefined;
  private readonly tracesDir: string;
  private readonly watermarkFile: string;
  /** 串行队列:parquet 读改写不可并发;错误入 lastError 不外抛(unhandled) */
  private queue: Promise<void> = Promise.resolve();
  lastError: string | undefined;

  private constructor(
    private readonly store: LedgerStore,
    private readonly instance: Awaited<ReturnType<typeof DuckDBInstance.create>>,
    private readonly con: Awaited<ReturnType<typeof this.instance.connect>>,
    rootDir: string,
  ) {
    this.tracesDir = join(rootDir, "traces");
    this.watermarkFile = join(rootDir, "traces", ".watermark");
  }

  static async open(rootDir: string, store: LedgerStore): Promise<TraceProjection> {
    mkdirSync(join(rootDir, "traces"), { recursive: true });
    const instance = await DuckDBInstance.create(":memory:");
    const con = await instance.connect();
    const p = new TraceProjection(store, instance, con, rootDir);
    // 恢复持久化水位(重开不重复追平;崩溃窗口至多重复一行——投影可重建,查询侧可按 trace_id 去重)
    if (existsSync(p.watermarkFile)) p.lastSeq = Number(readFileSync(p.watermarkFile, "utf-8")) || 0;
    await p.catchUp(store); // 先追平存量,再订阅增量
    p.detach = store.onAppend((e) => { p.enqueue(e); });
    return p;
  }

  /** 入队(同步返回;调用方需确定性时用 flush) */
  enqueue(e: LedgerEntry): Promise<void> {
    if (e.seq <= this.lastSeq) return this.queue;
    this.lastSeq = e.seq; // 幂等闸同步推进,重复入队无害
    this.queue = this.queue
      .then(() => this.applyNow(e))
      .catch((err) => { this.lastError = String(err); });
    return this.queue;
  }

  /** 等待队列排空(测试/关停前用) */
  async flush(): Promise<void> { await this.queue; }

  private async applyNow(e: LedgerEntry): Promise<void> {
    if (e.kind !== "agent.terminate") return;
    const payload = e.payload as { trace_cas?: string } | undefined;
    if (!payload?.trace_cas) return;
    const trace = JSON.parse(this.store.readCas(payload.trace_cas)) as Record<string, unknown>;
    const row = rowOf(e, trace);
    const parquet = join(this.tracesDir, `${e.ts.slice(0, 7)}.traces.parquet`);
    await this.con.run(`CREATE OR REPLACE TABLE sink ${DUCK_SCHEMA}`);
    if (existsSync(parquet)) {
      await this.con.run(`INSERT INTO sink SELECT * FROM read_parquet('${this.esc(parquet)}')`);
    }
    await this.con.run(
      `INSERT INTO sink VALUES ('${this.esc(row.trace_id)}','${this.esc(row.session_key)}','${this.esc(row.agent_id)}',
       '${this.esc(row.outcome)}','${this.esc(row.task_cluster)}','${this.esc(row.model)}',
       ${row.prompt_tokens},${row.completion_tokens},${row.duration_ms},${row.step_count},
       '${this.esc(row.replay_bundle_cas)}','${this.esc(row.ts)}')`,
    );
    await this.con.run(`COPY sink TO '${this.esc(parquet)}' (FORMAT PARQUET)`);
    writeFileSync(this.watermarkFile, String(this.lastSeq));
    this.appended += 1;
  }

  async catchUp(store: LedgerStore): Promise<void> {
    for (const e of store.all) await this.enqueue(e);
    await this.flush();
  }

  /** SQL 直达列式分区(M4 记分卡的食粮;跨月用 glob:read_parquet('traces/*.traces.parquet')) */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    const r = await this.con.runAndReadAll(sql);
    return r.getRowObjects() as unknown as Record<string, unknown>[];
  }

  get count(): number { return this.appended; }

  async close(): Promise<void> {
    this.detach?.();
    try { await (this.con as unknown as { close?: () => Promise<void> }).close?.(); } catch { /* 已关 */ }
    try { await (this.instance as unknown as { dispose?: () => Promise<void> }).dispose?.(); } catch { /* 已关 */ }
  }

  private esc(s: string): string { return s.replace(/'/g, "''"); }
}
