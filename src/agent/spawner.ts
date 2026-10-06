// 子 Agent 派生器(M3,§5.4)——授权代数三条不变式的服务端强制 + 派生树簿记 + kill 回收
//
// 三条不变式(INV-3 操作化,§5.4):
//   child.capabilities ⊆ parent.capabilities   能力只减(信任级随派生只降)
//   child.budget       < parent.remaining      配额递减 ⇒ 递归必然终止(无需运行时监督者)
//   child.rCeiling     ≤ parent.rLevel         动刀权限只降
// 深度(INC3):软限 3——超出需批准(review.event 入账,depth_approval_ref 随 agent.spawn);
//            硬顶 5——不可逾越(agents 表 CHECK 兜底)。
// kill(child) = 卸载插件树:AbortController 中止 → 活子代自底向上递归 kill
//            → revertOwner LIFO 回滚其全部 effect → intervene.kill 入账 → 配额归还。
// 人走茶不凉:子 Agent 的分支资产(技能/文件)是账本事实,不随 kill 消失。

import { randomUUID } from "node:crypto";
import type { Kernel } from "../kernel/kernel.js";
import type { LedgerActor, RLevel, TrustLevel } from "../kernel/types.js";
import type { RevertSummary } from "../kernel/effects.js";
import type { runTask } from "./task.js";
import type { TaskOptions, TaskResult } from "./task.js";

// spec-constants: spawn_depth_soft_limit / spawn_depth_hard_limit(接口 §3.4)
export const SPAWN_DEPTH_SOFT_LIMIT = 3;
export const SPAWN_DEPTH_HARD_LIMIT = 5;

export type SpawnerErrorCode =
  | "AGENT_NOT_FOUND" | "AGENT_NOT_RUNNING"
  | "CAPABILITY" | "BUDGET" | "R_CEILING" | "DEPTH_HARD" | "APPROVAL_DENIED";

export class SpawnerError extends Error {
  constructor(readonly code: SpawnerErrorCode, message: string) { super(`[${code}] ${message}`); }
}

export interface AgentMeta {
  agentId: string;
  parentAgentId: string | null;
  depth: number;               // 根=0
  rLevel: RLevel;              // 本代动刀上限(child.rCeiling ≤ 此值)
  trust: TrustLevel;           // 能力只减:child.trust ≤ parent.trust
  budget: { maxSteps: number; wallMs?: number };
  sessionKey: string;
  state: "running" | "done" | "killed";
  settledAt?: string;
}

export interface SpawnSpec {
  goal: string;
  /** 能力声明(⊆ caller);缺省继承父代(合法——父代自身已受限) */
  trust?: TrustLevel;
  rCeiling?: RLevel;                  // 缺省 R0(§5.4 接口默认)
  budget?: { maxSteps?: number; wallMs?: number };  // 各维必须 < 父代剩余
  systemPrompt?: string;
  model?: string;
}

/** 子代句柄(§5.4 派生接口):spawn 立即返回;结果/终止另行操作(并行形态) */
export interface ChildHandle {
  agentId: string;
  result: Promise<TaskResult>;
  kill: (actor?: LedgerActor) => Promise<RevertSummary>;
}

const TRUST_ORDER: TrustLevel[] = ["untrusted", "guest", "known", "owner"];
const R_ORDER: RLevel[] = ["R0", "R1", "R2", "R3", "R4", "R5"];

export class Spawner {
  private readonly agents = new Map<string, AgentMeta>();
  /** 父 → 活子代集合(配额占用;settle/kill 释放) */
  private readonly liveChildren = new Map<string, Set<string>>();
  /** kill 句柄:agentId → 中止信号 + 任务 promise */
  private readonly handles = new Map<string, { abort: AbortController; promise: Promise<unknown> }>();

  constructor(
    private readonly kernel: Kernel,
    private readonly runTaskFn: typeof runTask,
    private readonly opts: {
      runtimePluginId: string;
      rootRLevel?: RLevel;              // 根代动刀上限缺省 R2(与 job rCeiling 默认一致)
      rootTrust?: TrustLevel;
      /** 深度批准钩子(超软限):返回批准依据(入 review.event)或 null=拒绝 */
      approver?: (req: { parent: AgentMeta; depth: number; goal: string }) => string | null;
      /** kill 等待子任务在步边界退出的宽限(毫秒);超时继续回收——abort 信号已置,任务稍后自行退出 */
      killGraceMs?: number;
      skills?: TaskOptions["skills"];
      memory?: TaskOptions["memory"];
    },
  ) {}

  /** runTask 的 agent.spawn 后登记(根/子皆经此)——派生树的运行时权威(首个 await 前同步执行) */
  register(meta: Omit<AgentMeta, "state">): void {
    this.agents.set(meta.agentId, { ...meta, state: "running" });
    if (meta.parentAgentId !== null) {
      const sib = this.liveChildren.get(meta.parentAgentId) ?? new Set<string>();
      sib.add(meta.agentId);
      this.liveChildren.set(meta.parentAgentId, sib);
    }
  }

  /** runTask 的 agent.terminate 后结算(kill 的 killed 态由 kill() 终置)。
   *  只把自己从父代的活子代集合移除——自己的子代集合不动(树形 kill 仍可递归回收)。 */
  settle(agentId: string): void {
    const meta = this.agents.get(agentId);
    if (meta === undefined || meta.state !== "running") return;
    meta.state = "done";
    meta.settledAt = new Date().toISOString();
    if (meta.parentAgentId !== null) this.liveChildren.get(meta.parentAgentId)?.delete(agentId);
    this.handles.delete(agentId);
  }

  meta(agentId: string): AgentMeta | undefined { return this.agents.get(agentId); }
  list(): AgentMeta[] { return [...this.agents.values()]; }
  isRunning(agentId: string): boolean { return this.agents.get(agentId)?.state === "running"; }

  /** 剩余配额 = 自身预算 − 活子代已分配(父代自身已耗步数由其回路约束;保守口径) */
  remainingOf(agentId: string): { maxSteps: number; wallMs?: number } {
    const meta = this.require(agentId);
    let usedSteps = 0;
    let usedWall = 0;
    for (const cid of this.liveChildren.get(agentId) ?? []) {
      const c = this.agents.get(cid);
      if (c !== undefined && c.state === "running") {
        usedSteps += c.budget.maxSteps;
        usedWall += c.budget.wallMs ?? 0;
      }
    }
    return {
      maxSteps: meta.budget.maxSteps - usedSteps,
      ...(meta.budget.wallMs !== undefined ? { wallMs: meta.budget.wallMs - usedWall } : {}),
    };
  }

  /**
   * 派生子 Agent(§5.4 派生接口):三不变式强制校验(同步拒绝)→ runTask(独立 agentId/中止信号)
   * → 立即返回 ChildHandle(结果/kill 另行操作;并行形态)。
   */
  async spawn(parentAgentId: string, spec: SpawnSpec,
              actor: LedgerActor = { kind: "human", id: "spawner", trust: "owner" }): Promise<ChildHandle> {
    const parent = this.require(parentAgentId);
    if (parent.state !== "running") {
      throw new SpawnerError("AGENT_NOT_RUNNING", `父代非运行态: ${parentAgentId}(${parent.state})`);
    }

    // ① 能力只减:child.trust ≤ parent.trust
    const childTrust = spec.trust ?? parent.trust;
    if (TRUST_ORDER.indexOf(childTrust) > TRUST_ORDER.indexOf(parent.trust)) {
      throw new SpawnerError("CAPABILITY", `能力只减:child.trust=${childTrust} > parent=${parent.trust}`);
    }
    // ③ 动刀权限只降:child.rCeiling ≤ parent.rLevel
    const childCeil = spec.rCeiling ?? "R0";
    if (R_ORDER.indexOf(childCeil) > R_ORDER.indexOf(parent.rLevel)) {
      throw new SpawnerError("R_CEILING", `动刀权限只降:child.rCeiling=${childCeil} > parent.rLevel=${parent.rLevel}`);
    }
    // 深度(INC3,先于配额——硬顶是绝对约束):硬顶拒;超软限需批准
    const depth = parent.depth + 1;
    if (depth > SPAWN_DEPTH_HARD_LIMIT) {
      throw new SpawnerError("DEPTH_HARD", `深度硬顶 ${SPAWN_DEPTH_HARD_LIMIT} 不可逾越(当前 ${depth})`);
    }
    let approvalSeq: number | undefined;
    if (depth > SPAWN_DEPTH_SOFT_LIMIT) {
      const basis = this.opts.approver?.({ parent, depth, goal: spec.goal });
      if (basis === null || basis === undefined) {
        throw new SpawnerError("APPROVAL_DENIED", `深度 ${depth} 超软限 ${SPAWN_DEPTH_SOFT_LIMIT},owner 未批准`);
      }
      approvalSeq = this.recordApproval(actor, parent, depth, spec.goal, basis);
    }
    // ② 配额递减:child.budget < parent.remaining(子代各维严格小于)
    const remaining = this.remainingOf(parentAgentId);
    const childSteps = spec.budget?.maxSteps ?? Math.max(1, Math.floor(remaining.maxSteps / 2));
    if (childSteps >= remaining.maxSteps) {
      throw new SpawnerError("BUDGET", `配额递减:child.maxSteps=${childSteps} ≥ parent.remaining=${remaining.maxSteps}`);
    }
    if (spec.budget?.wallMs !== undefined && remaining.wallMs !== undefined && spec.budget.wallMs >= remaining.wallMs) {
      throw new SpawnerError("BUDGET", `配额递减:child.wallMs=${spec.budget.wallMs} ≥ parent.remaining=${remaining.wallMs}`);
    }

    const childAgentId = `ag_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const childActor: LedgerActor = { kind: "agent", id: parentAgentId, trust: childTrust };
    const abort = new AbortController();
    const opts: TaskOptions = {
      goal: spec.goal,
      sessionKey: parent.sessionKey,   // 子代同会话(资产留分支;§5.4 回收语义)
      runtimePluginId: this.opts.runtimePluginId,
      actor: childActor,
      agentId: childAgentId,           // 外部指定:kill 句柄在 register 前即可关联
      ...(spec.systemPrompt !== undefined ? { systemPrompt: spec.systemPrompt } : {}),
      ...(spec.model !== undefined ? { model: spec.model } : {}),
      maxSteps: childSteps,
      signal: abort.signal,
      parent: { agentId: parentAgentId, depth, ...(approvalSeq !== undefined ? { approvalSeq } : {}) },
      rCeiling: childCeil,
      spawner: this,
      ...(this.opts.skills !== undefined ? { skills: this.opts.skills } : {}),
      ...(this.opts.memory !== undefined ? { memory: this.opts.memory } : {}),
    };
    const promise = this.runTaskFn(this.kernel, opts);
    // runTask 首个 await 前同步完成 register——此处句柄已可挂
    this.handles.set(childAgentId, { abort, promise });
    return {
      agentId: childAgentId,
      result: promise as Promise<TaskResult>,
      kill: (a?: LedgerActor) => this.kill(childAgentId, a),
    };
  }

  /** kill(child) = 卸载插件树:快活子代 → 中止 → 自底向上递归 kill → LIFO 回滚 → intervene.kill → 配额归还 */
  async kill(agentId: string,
             actor: LedgerActor = { kind: "human", id: "owner", trust: "owner" }): Promise<RevertSummary> {
    const meta = this.require(agentId);
    if (meta.state !== "running") {
      throw new SpawnerError("AGENT_NOT_RUNNING", `非运行态: ${agentId}(${meta.state})`);
    }
    meta.state = "killed"; // 先置态:settle 的 done 翻转由此让位(kill 是终态)
    const kids = [...(this.liveChildren.get(agentId) ?? [])]; // 快照:await 期间 settle 不清本集合,防御性固化
    const handle = this.handles.get(agentId);
    handle?.abort.abort();
    if (handle !== undefined) {
      // 宽限等待:任务在步边界感知 abort 并退出;卡住(LLM 网关悬挂等)则超时继续回收
      const grace = this.opts.killGraceMs ?? 2_000;
      await Promise.race([
        handle.promise.catch(() => undefined),
        new Promise((r) => setTimeout(r, grace)),
      ]);
    }
    for (const cid of kids) {
      const c = this.agents.get(cid);
      if (c !== undefined && c.state === "running") await this.kill(cid, actor);
    }
    const summary = await this.kernel.revertOwner({ kind: "agent", id: agentId }, actor);
    this.kernel.store.append({
      actor, kind: "intervene.kill", ref: { agent: agentId },
      payload: {
        depth: meta.depth, parent: meta.parentAgentId,
        reverted: summary.reverted.length, compensated: summary.compensated.length,
      },
    });
    meta.settledAt = new Date().toISOString();
    this.liveChildren.delete(agentId);
    if (meta.parentAgentId !== null) this.liveChildren.get(meta.parentAgentId)?.delete(agentId);
    this.handles.delete(agentId);
    return summary;
  }

  // ── 内部 ────────────────────────────────────────────────

  private require(agentId: string): AgentMeta {
    const meta = this.agents.get(agentId);
    if (meta === undefined) throw new SpawnerError("AGENT_NOT_FOUND", `未知 agent: ${agentId}`);
    return meta;
  }

  /** 软限外的 owner 批准落 review_events(接口 §3.4:批准记录落 review_events) */
  private recordApproval(actor: LedgerActor, parent: AgentMeta, depth: number, goal: string, basis: string): number {
    const e = this.kernel.store.append({
      actor, kind: "review.event",
      ref: { review: `spawn:${parent.agentId}:${depth}` },
      payload: { kind: "approve", target: `spawn-depth:${depth}`, context: { goal: goal.slice(0, 120), basis } },
    });
    return e.seq;
  }
}
