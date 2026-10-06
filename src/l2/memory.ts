// 三层记忆(M2-S3,主文档 §6.5):工作(会话上下文,不入库)/ 情景(会话收尾提炼)/ 语义(闸门写入)
// 写路径:闸门(信任 × 内容体检)→ 向量化(可缺席)→ CAS(内容+向量,重放自洽)→ 账本 memory.write;
// 读路径:embedding 召回(不耗对话 LLM)→ rerank 重排 → 注入上下文;
// 遗忘:memory.forget → status=forgotten + forgotten_seq(托管期回滚走 memory.forget.rollback;加密擦除属 K.6/M3)。
// 隔离:一切读写以 sessionKey 分片(per-channel-peer 从消息层贯穿到记忆层)。

import type { Kernel } from "../kernel/kernel.js";
import type { Projection } from "../kernel/projection.js";
import type { LedgerActor } from "../kernel/types.js";
import { CHAT_SERVICE } from "../llm/chat.js";
import type { ChatService } from "../llm/chat.js";
import { EMBEDDING_SERVICE, RERANK_SERVICE } from "../llm/embedding.js";
import type { EmbeddingService, RerankService } from "../llm/embedding.js";

export type MemoryLayer = "episodic" | "semantic";

// spec-constants: memory_item_max_bytes / memory_recall_candidates / memory_recall_top_n
export const MEMORY_ITEM_MAX_BYTES = 4096;
export const MEMORY_RECALL_CANDIDATES = 8;
export const MEMORY_RECALL_TOP_N = 4;
// spec-constants: memory_distill_idle_min / memory_distill_max_items / memory_distill_check_sec / memory_pending_window
export const MEMORY_DISTILL_IDLE_MIN = 30;
export const MEMORY_DISTILL_MAX_ITEMS = 6;
export const MEMORY_DISTILL_CHECK_SEC = 60;
export const MEMORY_PENDING_WINDOW = 40;

/** 记忆投毒防御(§6.5):内容体检——记忆是事实,不应携带指令/授权模式 */
const POISON_PATTERNS = [
  /以后(都|直接|一律|全部)?(执行|照做|照办|跳过)/,
  /无需(再次|任何)?(确认|审批|审核|授权)/,
  /(跳过|禁用|绕过)(一切)?(确认|审批|审核)/,
  /(永久|始终|从此)(授权|允许|信任)/,
  /(授权|允许|信任)(你|它)?(永久|始终|一切|无需)/,
  /ignore\s+(all\s+)?(previous|future)/i,
  /不需要(再)?(问|确认|征求)/,
];

export class MemoryGateError extends Error {}
export class MemoryLintError extends Error {
  constructor(readonly violations: string[]) { super(`记忆体检未通过: ${violations.join("; ")}`); }
}

export interface MemoryProvenance {
  source: string;          // agent / distiller / human / curator …
  trace_id?: string;
  trust?: string;          // 写入者信任级快照
  note?: string;
}

export interface MemoryItem {
  cas: string;
  layer: MemoryLayer;
  sessionKey: string;
  status: string;          // active / stale / archived / forgotten
  text: string;
  provenance: MemoryProvenance;
  embedding: { model: string; dim: number; vector: number[] } | null;
  createdSeq: number;
  createdTs?: string;      // 写入账本时刻(时段遗忘的过滤基准)
  forgottenSeq: number | null;
}

export interface MemoryHit {
  cas: string;
  layer: MemoryLayer;
  text: string;
  score: number;
  stage: "embedding" | "rerank" | "recency"; // 命中路径(入轨迹食料,§6.5 检索质量进 L3)
}

interface MemoryCasObject {
  schema: "samsara-memory/0";
  text: string;
  embedding: { model: string; dim: number; vector: number[] } | null;
}

/** 余弦相似度(纯 JS——个人级记忆规模,毫秒级) */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? -1 : Number((dot / d).toFixed(6));
}

/** 情景提炼提示词(④ 类调用,每会话收尾 1 次) */
function distillPrompt(exchanges: { user: string; reply: string; ts: string }[], maxItems: number): string {
  const convo = exchanges.map((e) => `[${e.ts.slice(0, 19)}][user] ${e.user}\n[samsara] ${e.reply}`).join("\n\n");
  return [
    "你是记忆提炼器。把以下对话提炼为关键事实与事件摘要(情景记忆),供未来会话召回。",
    `规则:最多 ${maxItems} 条;每条一行独立事实,含时间与结果;只陈述发生过的事,不猜测、不下指令;用中文。`,
    "只输出 JSON 字符串数组,不要任何其他文字。示例:[\"2026-10-06 用户询问了 X,结果是 Y\"]",
    "对话:",
    convo,
  ].join("\n");
}

export class Memory {
  /** 会话收尾缓冲:未提炼的对话尾部(进程内;守护关停时尽力提炼,重启丢尾部为 M2 已知限制) */
  private readonly pending = new Map<string, { user: string; reply: string; ts: string }[]>();
  private readonly lastActivity = new Map<string, number>();

  constructor(
    private readonly kernel: Kernel,
    private readonly projection: Projection,
  ) {}

  // ── 写路径(闸门 → 体检 → 向量化 → CAS → 账本)────────────

  /** 写入记忆。语义层闸门:仅 owner 自动写入(guest/untrusted 只允许情景层,人审管道属 M4) */
  async write(sessionKey: string, layer: MemoryLayer, text: string, actor: LedgerActor,
              provenance: MemoryProvenance): Promise<{ cas: string; embedded: boolean }> {
    const trimmed = text.trim();
    if (!trimmed) throw new MemoryGateError("记忆内容为空");
    const bytes = Buffer.byteLength(trimmed, "utf-8");
    if (bytes > MEMORY_ITEM_MAX_BYTES) {
      throw new MemoryLintError([`尺寸 ${bytes}B 超上限 ${MEMORY_ITEM_MAX_BYTES}B`]);
    }
    if (layer === "semantic" && actor.trust !== "owner") {
      throw new MemoryGateError(`语义记忆写入需 owner(当前 ${actor.trust ?? "untrusted"});guest/untrusted 会话只允许情景记忆(§6.5 闸门)`);
    }
    const violations = POISON_PATTERNS.filter((p) => p.test(trimmed)).map((p) => `含指令/授权模式: ${p.source}`);
    if (violations.length > 0) throw new MemoryLintError(violations);

    let embedding: MemoryCasObject["embedding"] = null;
    try {
      const emb = this.kernel.service(EMBEDDING_SERVICE);
      const [vec] = await emb.embed([trimmed]);
      embedding = { model: emb.modelLabel, dim: emb.dim, vector: vec ?? [] };
    } catch { /* 向量化缺席:事实仍入账,召回对该条退化为时序 */ }

    const obj: MemoryCasObject = { schema: "samsara-memory/0", text: trimmed, embedding };
    const { cas } = this.kernel.store.putCas(obj);
    this.kernel.store.append({
      actor, kind: "memory.write", ref: { memory: cas },
      payload: {
        cas, layer, session_key: sessionKey, text_len: bytes,
        provenance: { ...provenance, trust: actor.trust ?? "untrusted", ...(embedding ? { embedded: true } : {}) },
      },
    });
    return { cas, embedded: embedding !== null };
  }

  // ── 遗忘(托管期回滚;加密擦除属 K.6/M3)──────────────────

  /** 精确遗忘:按 cas 或 (sessionKey + layer + 时段);账本逐条入账,status→forgotten */
  forget(sessionKey: string, actor: LedgerActor,
         target: { cas?: string; layer?: MemoryLayer; after?: string; before?: string } = {}): number {
    const items = this.list(sessionKey, target.layer, "active").filter((m) => {
      if (target.cas !== undefined) return m.cas === target.cas;
      if (target.after !== undefined && m.createdTs !== undefined && m.createdTs < target.after) return false;
      if (target.before !== undefined && m.createdTs !== undefined && m.createdTs >= target.before) return false;
      return true;
    });
    if (target.cas !== undefined && items.length === 0) throw new Error(`未找到记忆: ${target.cas}`);
    let n = 0;
    for (const m of items) {
      this.kernel.store.append({
        actor, kind: "memory.forget", ref: { memory: m.cas },
        payload: { cas: m.cas, session_key: sessionKey, layer: m.layer },
      });
      n += 1;
    }
    return n;
  }

  /** 托管期内回滚遗忘(forgotten_seq 为账本锚点) */
  rollbackForget(cas: string, actor: LedgerActor): void {
    const row = this.projection.db.prepare(
      `SELECT status FROM memory_items WHERE cas_id=?`,
    ).get(cas) as { status: string } | undefined;
    if (row === undefined) throw new Error(`未找到记忆: ${cas}`);
    if (row.status !== "forgotten") throw new Error(`记忆非 forgotten 态(当前 ${row.status}),无可回滚遗忘`);
    this.kernel.store.append({
      actor, kind: "memory.forget.rollback", ref: { memory: cas },
      payload: { cas, session_key: this.sessionOf(cas) },
    });
  }

  // ── 情景提炼(会话收尾,④ 类调用 1 次)────────────────────

  /** 记录一次成功交互(由任务回路在 outcome=success 时调用);超过滑窗上限丢弃最旧 */
  noteExchange(sessionKey: string, user: string, reply: string): void {
    const buf = this.pending.get(sessionKey) ?? [];
    buf.push({ user: user.slice(0, 2000), reply: reply.slice(0, 2000), ts: new Date().toISOString() });
    if (buf.length > MEMORY_PENDING_WINDOW) buf.splice(0, buf.length - MEMORY_PENDING_WINDOW);
    this.pending.set(sessionKey, buf);
    this.lastActivity.set(sessionKey, Date.now());
  }

  /** 待提炼会话(供空闲蒸馏器轮询) */
  pendingSessions(): { sessionKey: string; count: number; idleMs: number }[] {
    const now = Date.now();
    return [...this.pending.entries()]
      .filter(([, buf]) => buf.length > 0)
      .map(([sessionKey, buf]) => ({
        sessionKey, count: buf.length,
        idleMs: now - (this.lastActivity.get(sessionKey) ?? now),
      }));
  }

  /** 提炼并写情景记忆;成功后清空缓冲。LLM 失败 → 抛出(缓冲保留,下轮重试) */
  async distillPending(sessionKey: string, actor: LedgerActor = { kind: "system", id: "memory-distiller" }): Promise<number> {
    const buf = this.pending.get(sessionKey);
    if (buf === undefined || buf.length === 0) return 0;
    const llm = this.kernel.service(CHAT_SERVICE) as ChatService;
    const raw = await llm.complete({ messages: [{ role: "user", content: distillPrompt(buf, MEMORY_DISTILL_MAX_ITEMS) }] });
    const items = parseJsonArray(raw.content).slice(0, MEMORY_DISTILL_MAX_ITEMS);
    for (const text of items) {
      if (typeof text !== "string" || !text.trim()) continue;
      // 提炼产物理论上是事实摘要;若 LLM 越权产出指令模式,闸门在此拦截(缓冲不丢,人工可见)
      await this.write(sessionKey, "episodic", text, actor, { source: "distiller" });
    }
    this.pending.set(sessionKey, []);
    return items.length;
  }

  // ── 读路径(召回 → 重排 → 注入)─────────────────────────

  /** 召回:embedding 余弦 top-K(不耗对话 LLM)→ rerank 重排(③ 类调用)→ top-N */
  async recall(sessionKey: string, query: string,
               opts: { candidates?: number; topN?: number } = {}): Promise<MemoryHit[]> {
    const candidates = opts.candidates ?? MEMORY_RECALL_CANDIDATES;
    const topN = opts.topN ?? MEMORY_RECALL_TOP_N;
    const items = this.list(sessionKey, undefined, "active");
    if (items.length === 0) return [];

    let qvec: number[] | null = null;
    let stage: MemoryHit["stage"] = "recency";
    try {
      const emb = this.kernel.service(EMBEDDING_SERVICE);
      const [qv] = await emb.embed([query]);
      if (qv !== undefined) { qvec = qv; stage = "embedding"; }
    } catch { /* 无检索服务:时序兜底 */ }

    const scored = items
      .map((m, i) => ({
        item: m,
        score: qvec && m.embedding && m.embedding.vector.length === qvec.length
          ? cosine(m.embedding.vector, qvec) : -1 - i * 1e-9, // 无向量条目按时序殿后(稳定排序)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, candidates);

    if (stage === "embedding") {
      try {
        const rr = this.kernel.service(RERANK_SERVICE);
        const ranked = await rr.rerank(query, scored.map((s) => s.item.text), topN);
        if (ranked.length > 0) {
          return ranked
            .filter((r) => scored[r.index] !== undefined)
            .map((r) => ({ cas: scored[r.index]!.item.cas, layer: scored[r.index]!.item.layer,
                           text: scored[r.index]!.item.text, score: r.score, stage: "rerank" as const }));
        }
      } catch { /* rerank 失败:保序降级(embedding 序) */ }
    }
    return scored.slice(0, topN).map((s) => ({
      cas: s.item.cas, layer: s.item.layer, text: s.item.text, score: s.score, stage,
    }));
  }

  /** 供系统提示注入的摘要行(§5.1 第 1 步装配) */
  async recallLines(sessionKey: string, query: string, opts?: { candidates?: number; topN?: number }): Promise<string[]> {
    const hits = await this.recall(sessionKey, query, opts);
    return hits.map((h) => `- (${h.layer}) ${h.text.replace(/\s+/g, " ").slice(0, 200)}`);
  }

  // ── 查询(投影读模型)───────────────────────────────────

  list(sessionKey: string, layer?: MemoryLayer, status = "active"): MemoryItem[] {
    const rows = this.projection.db.prepare(
      `SELECT m.cas_id, m.layer, m.session_key, m.status, m.provenance, m.forgotten_seq, m.created_seq, m.created_ts
       FROM memory_items m
       WHERE m.session_key=? AND m.status=? ${layer !== undefined ? "AND m.layer=?" : ""}
       ORDER BY m.created_seq DESC`,
    ).all(...(layer !== undefined ? [sessionKey, status, layer] : [sessionKey, status])) as {
      cas_id: string; layer: MemoryLayer; session_key: string; status: string;
      provenance: string; forgotten_seq: number | null; created_seq: number; created_ts: string | null;
    }[];
    return rows.flatMap((r) => {
      const obj = this.readCas(r.cas_id);
      if (obj === null) return [];
      return [{
        cas: r.cas_id, layer: r.layer, sessionKey: r.session_key, status: r.status,
        text: obj.text, provenance: JSON.parse(r.provenance) as MemoryProvenance,
        embedding: obj.embedding, createdSeq: r.created_seq,
        ...(r.created_ts !== null ? { createdTs: r.created_ts } : {}),
        forgottenSeq: r.forgotten_seq,
      }];
    });
  }

  private readCas(cas: string): MemoryCasObject | null {
    try {
      const obj = JSON.parse(this.kernel.store.readCas(cas)) as MemoryCasObject;
      return obj?.schema === "samsara-memory/0" ? obj : null;
    } catch { return null; }
  }

  private sessionOf(cas: string): string {
    const row = this.projection.db.prepare(`SELECT session_key FROM memory_items WHERE cas_id=?`)
      .get(cas) as { session_key: string } | undefined;
    return row?.session_key ?? "";
  }
}

/** 从 LLM 输出稳健解析 JSON 字符串数组(容忍代码围栏/前后缀) */
function parseJsonArray(content: string): unknown[] {
  const m = /\[[\s\S]*\]/.exec(content.replace(/```(?:json)?/g, ""));
  if (m === null) throw new Error(`提炼输出非 JSON 数组: ${content.slice(0, 120)}`);
  const parsed = JSON.parse(m[0]) as unknown;
  if (!Array.isArray(parsed)) throw new Error("提炼输出非数组");
  return parsed;
}
