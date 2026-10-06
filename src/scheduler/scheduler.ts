// 调度器(附录 C,M2 切片 1)——"到点发事件,其余复用既有架构"
// 状态全部走账本:jobs 投影行 + job.* 条目;上次触发从账本推导(重放即恢复,§C.1)。
// 触发链路(§C.3):到点 → job.fire 入账 → 标准 runTask(sessionKey=job:<id>,独立会话)
// → 产出交 notifier(M2 最小形态:守护日志/回调;smart 的注意力路由器裁决属 M4)。
// 单写入者纪律:引擎只在其所属守护进程内 tick;跨进程管理走回环 HTTP 管理面。

import { randomUUID } from "node:crypto";
import cronParser from "cron-parser";
const { parseExpression } = cronParser as unknown as { parseExpression: typeof import("cron-parser").parseExpression };
import type { Kernel } from "../kernel/kernel.js";
import type { Projection } from "../kernel/projection.js";
import type { LedgerActor, TrustLevel } from "../kernel/types.js";

export interface JobView {
  id: string;
  goal: string;
  schedule_cron: string;
  timezone: string;
  misfire: "skip" | "runOnce" | "catchUp";
  notification: "smart" | "immediate" | "silent";
  r_ceiling: string;
  state: "active" | "paused" | "deleted";
  expires_at: string | null;
  created_ts: string;
  last_fired_ts: string | null;
  next_fire_ts: string | null;
  creator?: { channel?: string; id?: string };  // C.4 信任重校验的锚点
}

export interface CreateJobOptions {
  goal: string;
  schedule?: string;                    // cron;缺省则由 compileSchedule 编译
  timezone?: string;
  misfire?: "skip" | "runOnce" | "catchUp";
  notification?: "smart" | "immediate" | "silent";
  rCeiling?: "R0" | "R1" | "R2" | "R3" | "R4";
  budgetTokens?: number;
  expiresAt?: string;                   // R3+ 必填(CHECK 约束)
  actor?: LedgerActor;
  creatorChannel?: string;              // 创建渠道(sessionKey 通道段,C.4 信任重校验锚点)
}

export interface FireNotification {
  job: JobView;
  dueAt: string;
  outcome: string;
  reply?: string;
  error?: string;
}

export type TaskRunner = (goal: string, sessionKey: string, actor: LedgerActor) => Promise<{ outcome: string; reply?: string; error?: string; traceId: string }>;

export function validateCron(expr: string, timezone: string): Date {
  return parseExpression(expr, { tz: timezone }).next().toDate();
}

/** 自然语言 → cron(§C.2:约 1 次 LLM 调用);返回经校验的调度三要素 */
export async function compileSchedule(
  complete: (prompt: string) => Promise<string>,
  goalText: string,
  defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Promise<{ cron: string; timezone: string; goal: string }> {
  const prompt = `把以下定时任务意图编译为 cron 调度。只输出一个 JSON 对象,不要任何其他文字:
{"cron":"<5 字段 cron,分 时 日 月 周>","timezone":"<IANA 时区,如 Asia/Shanghai>","goal":"<规范化后的任务描述,一句话>"}
意图:${goalText}
规则:不确定的省略用 *;"每周五 9 点"→"0 9 * * 5";"每天"→"0 9 * * *"仅当提到时刻,否则 "* * * * *" 不可用,选合理默认并在 goal 里注明。`;
  const raw = await complete(prompt);
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) throw new Error(`调度编译失败:模型未返回 JSON(${raw.slice(0, 60)})`);
  const parsed = JSON.parse(m[0]) as { cron?: string; timezone?: string; goal?: string };
  if (typeof parsed.cron !== "string" || typeof parsed.goal !== "string") throw new Error("调度编译失败:缺 cron/goal 字段");
  const timezone = typeof parsed.timezone === "string" && parsed.timezone ? parsed.timezone : defaultTz;
  validateCron(parsed.cron, timezone); // 编译结果必须可解析
  return { cron: parsed.cron, timezone, goal: parsed.goal };
}

export class Scheduler {
  /** 每 job 触发串行(lane 语义);tick 重入保护 */
  private readonly inflight = new Map<string, Promise<unknown>>();
  private ticking = false;
  private lastFireCache = new Map<string, string>(); // job_id → ts(账本推导 + 运行增量)

  constructor(
    private readonly kernel: Kernel,
    private readonly projection: Projection,
    private readonly runner: TaskRunner,
    private readonly opts: {
      tickIntervalMs?: number;          // 默认 30_000(spec-constants: scheduler_tick_interval_sec)
      graceMs?: number;                 // "当期"判定窗口,默认 2×tick
      notifier?: (n: FireNotification) => void;
      systemActor?: LedgerActor;
      /** C.4 信任重校验:返回创建者当前信任级;undefined=无意见(放行,向后兼容)。
       *  非 owner → 任务自动暂停(job.pause reason=trust_downgrade)并告警;恢复不自动复活(owner 手动 resume) */
      trustCheck?: (job: JobView) => TrustLevel | undefined;
    } = {},
  ) {
    this.rebuildLastFireCache();
  }

  private get tickMs(): number { return this.opts.tickIntervalMs ?? 30_000; }

  // ── 任务管理(§C.2/§C.4)────────────────────────────────

  createJob(o: CreateJobOptions): JobView {
    const timezone = o.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const cron = o.schedule;
    if (cron === undefined) throw new Error("缺少 schedule(自然语言编译请先经 compileSchedule)");
    validateCron(cron, timezone);
    const rCeiling = o.rCeiling ?? "R2";
    const expiresAt = o.expiresAt ?? null;
    if (["R3", "R4"].includes(rCeiling) && expiresAt === null) {
      throw new Error(`rCeiling=${rCeiling} 的任务必须有有效期(§C.4:到期需 owner 续期)`);
    }
    const actor = o.actor ?? { kind: "human", id: "cli", trust: "owner" as const };
    const id = `job_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const { cas } = this.kernel.store.putCas(o.goal);
    this.kernel.store.append({
      actor, kind: "job.create", ref: { job: id },
      payload: {
        schedule_cron: cron, timezone, goal_cas: cas, goal: o.goal,
        trust_snapshot: actor.trust ?? "owner",
        creator: { ...(o.creatorChannel !== undefined ? { channel: o.creatorChannel } : {}), id: actor.id },
        budget: { ...(o.budgetTokens !== undefined ? { tokens: o.budgetTokens } : {}) },
        r_ceiling: rCeiling,
        notification: o.notification ?? "smart",
        misfire: o.misfire ?? "skip",
        ...(expiresAt !== null ? { expires_at: expiresAt } : {}),
      },
    });
    return this.view(id)!;
  }

  pause(id: string, actor: LedgerActor = { kind: "human", id: "cli", trust: "owner" }, reason?: string): JobView {
    this.require(id);
    this.kernel.store.append({ actor, kind: "job.pause", ref: { job: id, ...(reason !== undefined ? { reason } : {}) } });
    return this.view(id)!;
  }
  resume(id: string, actor?: LedgerActor): JobView {
    this.require(id);
    this.kernel.store.append({ actor: actor ?? { kind: "human", id: "cli", trust: "owner" }, kind: "job.resume", ref: { job: id } });
    return this.view(id)!;
  }
  remove(id: string, actor?: LedgerActor): JobView {
    this.require(id);
    this.kernel.store.append({ actor: actor ?? { kind: "human", id: "cli", trust: "owner" }, kind: "job.delete", ref: { job: id } });
    return this.view(id)!;
  }
  renew(id: string, days: number, actor?: LedgerActor): JobView {
    const v = this.view(id);
    if (!v) throw new Error(`任务不存在: ${id}`);
    const base = v.expires_at !== null ? new Date(v.expires_at).getTime() : Date.now();
    const expiresAt = new Date(base + days * 86_400_000).toISOString();
    this.kernel.store.append({
      actor: actor ?? { kind: "human", id: "cli", trust: "owner" },
      kind: "job.renew", ref: { job: id }, payload: { expires_at: expiresAt },
    });
    return this.view(id)!;
  }

  list(): JobView[] {
    const rows = this.projection.db.prepare(
      `SELECT id, schedule_cron, timezone, misfire, notification, r_ceiling, state, expires_at, creator_channel, creator_id FROM jobs WHERE state != 'deleted' ORDER BY rowid`,
    ).all() as unknown as Record<string, unknown>[];
    return rows.map((r) => this.hydrate(r)).filter((v): v is JobView => v !== null);
  }

  view(id: string): JobView | undefined {
    const r = this.projection.db.prepare(
      `SELECT id, schedule_cron, timezone, misfire, notification, r_ceiling, state, expires_at, creator_channel, creator_id FROM jobs WHERE id=?`,
    ).get(id) as unknown as Record<string, unknown> | undefined;
    const h = r !== undefined ? this.hydrate(r) : null;
    return h ?? undefined;
  }

  /** 投影行 → 视图:goal 从 CAS,时间从账本推导 */
  private hydrate(r: Record<string, unknown>): JobView | null {
    const id = String(r.id);
    const created = this.projection.db.prepare(
      `SELECT ts FROM ledger_entries WHERE kind='job.create' AND ref_json LIKE ? ORDER BY seq DESC LIMIT 1`,
    ).get(`%"${id}"%`) as { ts: string } | undefined;
    if (created === undefined) return null; // 投影先行于账本的瞬态,忽略
    const goal = this.readGoal(id, created.ts);
    const last = this.lastFireCache.get(id) ?? this.lastFireFromLedger(id);
    const next = this.nextFire(String(r.schedule_cron), String(r.timezone), last ?? created.ts);
    return {
      id, goal,
      schedule_cron: String(r.schedule_cron),
      timezone: String(r.timezone),
      misfire: r.misfire as JobView["misfire"],
      notification: r.notification as JobView["notification"],
      r_ceiling: String(r.r_ceiling),
      state: r.state as JobView["state"],
      expires_at: r.expires_at === null ? null : String(r.expires_at),
      created_ts: created.ts,
      last_fired_ts: last,
      next_fire_ts: next,
      ...(r.creator_channel !== null && r.creator_channel !== undefined || r.creator_id !== null && r.creator_id !== undefined
        ? { creator: { ...(r.creator_channel ? { channel: String(r.creator_channel) } : {}), ...(r.creator_id ? { id: String(r.creator_id) } : {}) } }
        : {}),
    };
  }

  // ── tick:到点发事件(§C.3)──────────────────────────────

  /** 一次调度检查(可注入时钟);返回本次触发的 job id 列表 */
  async tick(now = new Date()): Promise<string[]> {
    if (this.ticking) return []; // 重入保护:上轮未完不叠跑
    this.ticking = true;
    const fired: string[] = [];
    try {
      for (const job of this.list()) {
        if (job.state !== "active") continue;
        // §C.4:触发前重校验创建者当前信任级(定时任务="现在的自己委托未来的自己";
        // 降级 → 自动暂停并告警,宁停勿滥——恢复后不自动复活,owner 手动 resume)
        const trust = this.opts.trustCheck?.(job);
        if (trust !== undefined && trust !== "owner") {
          this.kernel.store.append({
            actor: this.systemActor(), kind: "job.pause",
            ref: { job: job.id, reason: `trust_downgrade:${trust}` },
          });
          this.opts.notifier?.({
            job: this.view(job.id)!, dueAt: now.toISOString(), outcome: "trust_paused",
            error: `创建者${job.creator?.id !== undefined ? ` ${String(job.creator.id).slice(0, 16)}…` : ""}信任降级为 ${trust},任务已自动暂停(§C.4);信任恢复后需 owner 手动 resume`,
          });
          continue;
        }
        if (job.expires_at !== null && new Date(job.expires_at).getTime() <= now.getTime()) {
          // §C.4:到期自动暂停并告警(R3+ 有效期)
          this.kernel.store.append({
            actor: this.systemActor(), kind: "job.pause", ref: { job: job.id, reason: "expired" },
          });
          this.opts.notifier?.({ job: this.view(job.id)!, dueAt: now.toISOString(), outcome: "expired", error: "任务有效期届满,已自动暂停;需 owner 续期(job.renew)" });
          continue;
        }
        const due = this.dueTimes(job, now);
        if (due.length === 0) continue;
        const grace = this.opts.graceMs ?? this.tickMs * 2;
        const current = due.filter((t) => now.getTime() - t.getTime() <= grace);
        const older = due.filter((t) => now.getTime() - t.getTime() > grace);
        let toFire: Date[];
        switch (job.misfire) {
          case "skip": toFire = current; break;                       // 错过即弃:只跑仍在当期窗口内的
          case "runOnce": case "catchUp": toFire = due.length > 0 ? [due[due.length - 1]!] : []; break; // 恢复后补最近一次(§3.5 注:两态在 M2 最小形态行为等价)
        }
        for (const t of older) {
          this.kernel.store.append({ actor: this.systemActor(), kind: "job.missed", ref: { job: job.id }, payload: { due_at: t.toISOString() } });
        }
        for (const t of toFire) {
          await this.fire(job.id, t);
          fired.push(job.id);
        }
      }
    } finally { this.ticking = false; }
    return fired;
  }

  /** 常驻循环(守护进程用);返回停止函数 */
  startLoop(intervalMs = this.tickMs): () => void {
    const timer = setInterval(() => { void this.tick(); }, intervalMs);
    return () => clearInterval(timer);
  }

  private async fire(jobId: string, dueAt: Date): Promise<void> {
    const prev = this.inflight.get(jobId) ?? Promise.resolve();
    const run = prev.then(async () => {
      const job = this.view(jobId);
      if (!job || job.state !== "active") return;
      // 创建者身份随触发携带(C.4;信任级已经 tick 重校验为当前态)
      const actor: LedgerActor = { kind: "human", id: job.creator?.id ?? `creator:${jobId}`, trust: "owner" };
      this.kernel.store.append({
        actor: this.systemActor(), kind: "job.fire", ref: { job: jobId }, payload: { due_at: dueAt.toISOString() },
      });
      this.lastFireCache.set(jobId, dueAt.toISOString());
      try {
        const r = await this.runner(job.goal, `job:${jobId}`, actor);
        if (job.notification !== "silent") {
          this.opts.notifier?.({ job, dueAt: dueAt.toISOString(), outcome: r.outcome, ...(r.reply !== undefined ? { reply: r.reply } : {}), ...(r.error !== undefined ? { error: r.error } : {}) });
        }
      } catch (err) {
        this.opts.notifier?.({ job, dueAt: dueAt.toISOString(), outcome: "exception", error: String(err) });
      }
    }).catch(() => undefined); // 单任务失败不阻塞后续触发;账本内已有失败轨迹
    this.inflight.set(jobId, run);
    await run;
  }

  // ── 内部 ──────────────────────────────────────────────

  private systemActor(): LedgerActor { return this.opts.systemActor ?? { kind: "system", id: "scheduler" }; }
  private require(id: string): void { if (this.view(id) === undefined) throw new Error(`任务不存在: ${id}`); }

  private dueTimes(job: JobView, now: Date): Date[] {
    const since = job.last_fired_ts ?? job.created_ts;
    const out: Date[] = [];
    try {
      const it = parseExpression(job.schedule_cron, { tz: job.timezone, currentDate: new Date(since), endDate: now });
      while (true) {
        const d = it.next().toDate();
        out.push(d);
        if (out.length >= 1000) break; // 防风暴上限(极密调度+长期宕机的极端)
      }
    } catch { /* 迭代到 now 自然结束 */ }
    return out;
  }

  private nextFire(cron: string, tz: string, since: string): string | null {
    try { return parseExpression(cron, { tz, currentDate: new Date(since) }).next().toISOString(); }
    catch { return null; }
  }

  private lastFireFromLedger(id: string): string | null {
    // 上次触发锚点 = due_at(调度时刻,防重放重触发):直读账本条目(投影表无 payload 本体)
    const entry = [...this.kernel.store.all].reverse().find((e) => e.kind === "job.fire" && (e.ref?.job === id));
    const iso = (entry?.payload as { due_at?: string } | undefined)?.due_at;
    if (iso !== undefined) this.lastFireCache.set(id, iso);
    return iso ?? null;
  }
  private rebuildLastFireCache(): void {
    for (const e of this.kernel.store.all) {
      if (e.kind !== "job.fire") continue;
      const jid = e.ref?.job as string | undefined;
      const due = (e.payload as { due_at?: string } | undefined)?.due_at;
      if (jid !== undefined && due !== undefined) this.lastFireCache.set(jid, due);
    }
  }
  private readGoal(id: string, fallbackTs: string): string {
    void fallbackTs;
    const row = this.projection.db.prepare(`SELECT goal_cas FROM jobs WHERE id=?`).get(id) as { goal_cas: string } | undefined;
    if (row?.goal_cas === undefined) return "(goal 不可读)";
    try {
      const goal = this.kernel.store.readCas(row.goal_cas); // goal 原文入 CAS(字符串原文存储)
      return goal === "" ? "(空 goal)" : goal;
    } catch { return "(goal CAS 读取失败)"; }
  }
}
