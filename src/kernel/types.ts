// L0 基础类型 —— 主文档 §1.4 名词表 / §3.2 核心抽象
// 约定(接口文档 §开头):ID 带前缀 ULID;时间 UTC ISO8601;金额/配额整数最小单位。

export type TrustLevel = "owner" | "known" | "guest" | "untrusted";
export type RLevel = "R0" | "R1" | "R2" | "R3" | "R4" | "R5";

// ── 服务与事件(反应式余效应的键)─────────────────────────────

export interface ServiceKey<T> {
  readonly __brand?: T; // 仅用于类型推导,运行时不存在
  readonly name: string;
}
export function serviceKey<T>(name: string): ServiceKey<T> {
  return { name } as ServiceKey<T>;
}

export interface TypedEvent {
  readonly type: string;
  readonly payload?: unknown;
}
export interface EventKey<T extends TypedEvent> {
  readonly __brand?: T;
  readonly type: string;
}
export function eventKey<T extends TypedEvent>(type: string): EventKey<T> {
  return { type } as EventKey<T>;
}
export interface Disposable {
  dispose(): void;
}

// ── 预算与信任(随 Context 只读暴露,接口文档 §5.1)────────────

export interface Budget {
  tokens?: number;
  wallMs?: number;
  gpuMs?: number;
}

// ── 账本 kind 枚举(GAP4 补全版,数据模型 §3.1;只允许 additive 变更)──

export const LEDGER_KINDS = [
  "plugin.install", "plugin.activate", "plugin.suspend", "plugin.dispose",
  "effect.apply", "effect.revert", "effect.compensate", "effect.preapproval",
  "session.open", "session.close",
  "agent.spawn", "agent.terminate",
  "skill.commit", "skill.promote", "skill.quarantine",
  "memory.write", "memory.forget", "memory.forget.rollback",
  "job.fire", "job.missed",
  "trust.link", "trust.unlink", "trust.anchor", "trust.anchor_missing",
  "workspace.bind", "mode.changed",
  "intervene.queued", "intervene.immediate", "intervene.kill",
  "device.pair_request", "device.pair_approved",
  "channel.fallback",
  "rollback.marker",
  "review.event",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

// ── 账本条目(数据模型 §3.1)──────────────────────────────────

export interface LedgerActor {
  kind: "system" | "plugin" | "agent" | "human";
  id: string;
  trust?: TrustLevel;
  device?: string;
}

export interface LedgerRef {
  plugin?: string | undefined;
  token?: string | undefined;
  [k: string]: unknown;
}

export interface LedgerEntry {
  seq: number;
  ts: string; // UTC ISO8601
  actor: LedgerActor;
  kind: LedgerKind;
  ref?: LedgerRef;
  /** 小 payload(≤ ledger_inline_payload_max_bytes=1KB)内联;大 payload 只存哈希+CAS 引用 */
  payload?: unknown;
  payload_hash: string;
  payload_cas?: string;
  prev_hash: string;
  entry_hash: string;
}

// ── 效应归属(GAP1:效应栈按 owner 组织,kill/回滚的依据)────────

export type OwnerKind = "plugin" | "agent" | "session" | "job";
export interface OwnerRef {
  kind: OwnerKind;
  id: string;
}

// ── 可逆性三分类(附录 K.1,sideEffect 挂点)───────────────────

export type ReversibilityClass = 0 | 1 | 2; // 0=可逆 1=可补偿 2=不可逆(须前置审批)

export interface EffectToken {
  readonly token: string; // fx_…
}

// ── Context(插件与系统交互的唯一通道,主文档 §3.2.1 / 接口文档 §5.1)──

export interface ServiceHandle<T> { get(): T }

export interface EffectOptions {
  /** 0=可逆(默认) 1=可补偿;2 不可逆走 ctx.irreversible */
  rClass?: 0 | 1;
  /** 效应归属(GAP1):默认归属当前插件;agent/session/job 场景显式指定 */
  owner?: OwnerRef;
  /** 重绑定参数(JSON 可序列化,随 effect.apply 入账):崩溃恢复时插件据此重建逆操作闭包 */
  rebindArgs?: unknown;
}

export interface KernelContext {
  inject<T>(key: ServiceKey<T>): ServiceHandle<T>;
  /** 同步 apply → 同步入账返回 token;异步 apply → Promise(解析时入账) */
  effect<T>(desc: string, apply: () => T | Promise<T>,
            revert: (t: T) => void | Promise<void>,
            opts?: EffectOptions): EffectToken | Promise<EffectToken>;
  /** K.1 第三类:不可逆效应无 revert 语义,必须携带前置审批的账本 seq */
  irreversible(desc: string, preapprovalSeq: number,
               apply: () => void | Promise<void>, opts?: EffectOptions): EffectToken | Promise<EffectToken>;
  provide<T>(key: ServiceKey<T>, impl: T): void;
  emit(evt: TypedEvent): void;
  on<T extends TypedEvent>(key: EventKey<T>, handler: (e: T) => void): Disposable;
  readonly trust: TrustLevel;
  readonly budget: Budget;
}

// ── 插件清单(主文档 §3.2.5)──────────────────────────────────

export type PluginStateName =
  | "installed" | "resolved" | "active" | "suspended" | "failed" | "disposed";

export interface PluginManifest {
  name: string;
  version: string;
  kind?: string;                 // channel / node / tool / scheduler / …(数据模型 A.1)
  provides: string[];            // 服务名(与 ServiceKey.name 对应)
  requires: string[];            // 必需依赖(余效应声明)
  optionalRequires?: string[];   // 可选依赖,缺席时降级
  rLevel: RLevel;                // 修改本插件所需授权等级
}

export interface PluginModule {
  start(ctx: KernelContext): Promise<void> | void;
  stop?(): Promise<void> | void; // 优雅停机钩子(effect 逆操作之外的自理)
  /** 崩溃恢复重绑定:重建服务(provide)+ 按 pendingEffects 重挂逆操作。
   *  纯运行时操作,不写账本——不重放 apply,环境已反映既成事实。 */
  rebind?(rc: RebindContext): Promise<void> | void;
}

/** 重绑定上下文:恢复期交还给插件,用于重建服务与效应逆操作 */
export interface RebindContext {
  provide<T>(key: ServiceKey<T>, impl: T): void;
  /** 重挂一条已应用效应的逆操作;captured 由 recapture 现场重取(如重读环境);
   *  reapply 供前滚(redo)重放 apply 使用——未提供则该效应的前滚将被诚实拒绝。
   *  返回 false:token 不属于本插件 / 非 applied / class 2(本无 revert)。 */
  reattach(token: string,
           revert: (captured: unknown) => void | Promise<void>,
           recapture?: () => unknown,
           reapply?: () => unknown | Promise<unknown>): boolean;
  /** 本插件名下待重挂的 applied 效应(按 applySeq;class 2 除外——其无逆操作) */
  readonly pendingEffects: readonly PendingEffectView[];
  /** 本插件名下全部效应(含 reverted/compensated)——绑定 reapply 供前滚(redo)使用 */
  readonly knownEffects: readonly (PendingEffectView & { status: string })[];
}

export interface PendingEffectView {
  readonly token: string;
  readonly desc: string;
  readonly rClass: ReversibilityClass;
  readonly ownerKind: OwnerRef["kind"];
  readonly ownerId: string;
  readonly applySeq: number;
  readonly rebindArgs?: unknown;
}
