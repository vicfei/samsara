// L0 可组合内核 —— 主文档 §3(Context/可逆效应/反应式余效应/串行账本)+ 附录 K.1(三分类)
// INV-1 汇流性 / INV-2 可逆性(系统内状态,K.1 限定)/ INV-4 单写入者 由本模块与测试共同守护。

import type {
  Budget, Disposable, EffectToken, EventKey, KernelContext, LedgerActor, LedgerEntry,
  PluginManifest, PluginModule, PluginStateName, OwnerRef, ReversibilityClass,
  ServiceKey, ServiceHandle, TrustLevel, TypedEvent, EffectOptions,
} from "./types.js";
import { EventBus } from "./bus.js";
import { EffectStacks, newEffectToken, type EffectRecord, type RevertSummary } from "./effects.js";
import { LedgerStore } from "./ledger.js";

export type { KernelContext, ServiceHandle, EffectOptions } from "./types.js";

// ── 错误:类型化,禁止自由文本(接口文档 §6.3 精神)──────────────

export type KernelErrorCode =
  | "PLUGIN_NOT_FOUND" | "MODULE_NOT_LOADED" | "INVALID_STATE"
  | "DEPS_MISSING" | "PREAPPROVAL_REQUIRED" | "PLUGIN_START_FAILED";
export class KernelError extends Error {
  constructor(readonly code: KernelErrorCode, message: string) { super(`[${code}] ${message}`); }
}

// ── 插件记录(内核内部)───────────────────────────────────────

interface PluginRecord {
  manifest: PluginManifest;
  module?: PluginModule | undefined;
  state: PluginStateName;
  requested: boolean;                    // 操作者意愿:activate(id)→true,suspend(id)→false
  suspendReason?: "operator" | "dependency" | undefined; // 强制停用与主动停用在账本与重放中可区分
  dynamicDeps: Set<string>;              // inject() 运行时补充的余效应声明
  providedServices: string[];            // 实际 provide 的服务(随 activate 入账,供重放)
}

const SYSTEM_ACTOR: LedgerActor = { kind: "system", id: "kernel" };

// ── 内核 ─────────────────────────────────────────────────────

export class Kernel {
  readonly store: LedgerStore;
  readonly bus = new EventBus();
  private readonly stacks = new EffectStacks();
  private readonly plugins = new Map<string, PluginRecord>();
  private readonly services = new Map<string, { impl: unknown; providerId: string }>();
  private readonly preapprovals = new Set<number>();
  private quiescing = false;

  constructor(store: LedgerStore) { this.store = store; }

  // ── 插件生命周期(§3.3:状态迁移全部经账本登记)─────────────

  install(manifest: PluginManifest, module?: PluginModule, actor: LedgerActor = SYSTEM_ACTOR): string {
    const id = `${manifest.name}@${manifest.version}`;
    if (this.plugins.has(id)) throw new KernelError("INVALID_STATE", `插件已安装: ${id}`);
    this.plugins.set(id, {
      manifest, ...(module !== undefined ? { module } : {}),
      state: "installed", requested: false,
      dynamicDeps: new Set(), providedServices: [],
    });
    this.store.append({ actor, kind: "plugin.install", ref: { plugin: id }, payload: { manifest } });
    return id;
  }

  /** 激活(操作者意愿)。依赖未就绪 → 记「请求」入账并等待(resolved),服务出现后反应式激活。 */
  async activate(id: string, actor: LedgerActor = SYSTEM_ACTOR): Promise<{ activated: boolean }> {
    const rec = this.require(id);
    if (rec.state === "disposed") throw new KernelError("INVALID_STATE", `已销毁: ${id}`);
    rec.requested = true;
    rec.suspendReason = undefined;
    if (rec.state !== "active" && !this.depsSatisfied(rec)) {
      // §3.3 resolved:请求已表达、依赖未就绪——意愿必须入账,否则重放后等待者会丢失
      this.store.append({ actor, kind: "plugin.activate", ref: { plugin: id, reason: "waiting" } });
    }
    const activated = await this.activateNow(id, actor);
    await this.quiesce(actor);
    return { activated };
  }

  /** 主动停用:先级联停用依赖方(§3.2.3 保证),再停自身;未激活时亦释放意愿(入账) */
  async suspend(id: string, actor: LedgerActor = SYSTEM_ACTOR): Promise<void> {
    const rec = this.require(id);
    if (rec.state === "disposed") return;
    if (rec.state !== "active") {
      if (rec.requested) this.store.append({ actor, kind: "plugin.suspend", ref: { plugin: id, reason: "operator" } });
      rec.requested = false;
      return;
    }
    await this.cascadeSuspend(id, actor, "operator");
  }

  /** 销毁:级联停用 → LIFO 回滚本插件全部可逆/可补偿效应(A.2 约束)→ disposed */
  async dispose(id: string, actor: LedgerActor = SYSTEM_ACTOR): Promise<RevertSummary> {
    const rec = this.require(id);
    if (rec.state === "disposed") return { reverted: [], compensated: [], irreversibleSkipped: [], unrebound: [] };
    if (rec.state === "active") await this.cascadeSuspend(id, actor, "operator");
    const summary = await this.revertOwner({ kind: "plugin", id }, actor);
    rec.requested = false;
    rec.state = "disposed";
    this.store.append({ actor, kind: "plugin.dispose", ref: { plugin: id } });
    this.bus.emit({ type: "plugin.state-changed", payload: { id, state: "disposed" } });
    return summary;
  }

  // ── 前置审批与回滚(K.1 / INV-2)───────────────────────────

  /** 不可逆操作的预审批:独立账本条目,审批者身份随 actor 入账 */
  preapprove(desc: string, actor: LedgerActor, payload?: unknown): number {
    const e = this.store.append({ actor, kind: "effect.preapproval", ref: { desc }, payload: { desc, ...payload ? { detail: payload } : {} } });
    this.preapprovals.add(e.seq);
    return e.seq;
  }

  /** 按 owner LIFO 回滚其全部 applied 效应(K.1 三分类语义) */
  async revertOwner(owner: OwnerRef, actor: LedgerActor = SYSTEM_ACTOR): Promise<RevertSummary> {
    const summary: RevertSummary = { reverted: [], compensated: [], irreversibleSkipped: [], unrebound: [] };
    for (const rec of [...this.stacks.appliedOf(owner)].reverse()) {
      if (rec.rClass === 2) { summary.irreversibleSkipped.push(rec.token); continue; }
      if (rec.revertFn === undefined) {
        // 恢复态效应:无运行时句柄,物理上无法回滚——诚实拒绝,
        // 不写 revert 条目、不改状态(账本诚实优先于"看起来成功")
        summary.unrebound.push(rec.token);
        this.bus.emit({ type: "effect.revert-refused", payload: { token: rec.token, reason: "unrebound" } });
        continue;
      }
      try {
        await rec.revertFn(rec.captured);
        const kind = rec.rClass === 1 ? "effect.compensate" : "effect.revert";
        rec.status = rec.rClass === 1 ? "compensated" : "reverted";
        const revertEntry = this.store.append({ actor, kind, ref: { token: rec.token, plugin: rec.pluginId } });
        rec.revertSeq = revertEntry.seq;
        (rec.rClass === 1 ? summary.compensated : summary.reverted).push(rec.token);
      } catch (err) {
        rec.status = "failed";
        this.bus.emit({ type: "effect.revert-failed", payload: { token: rec.token, error: String(err) } });
      }
    }
    return summary;
  }

  /** 回滚至指定账本位置:记 rollback.marker,然后 LIFO 逆应用其后全部 applied 效应。
   *  注:INV-2 的"回滚一次回滚"(重放前滚)语义留待 M0 完成期实现——marker 已为其预留锚点。 */
  async rollbackTo(seq: number, actor: LedgerActor = SYSTEM_ACTOR): Promise<RevertSummary> {
    if (seq < 0 || seq > this.store.lastSeq) throw new KernelError("INVALID_STATE", `非法回滚位置: ${seq}`);
    this.store.append({ actor, kind: "rollback.marker", payload: { to_seq: seq } });
    const targets = this.stacks.all()
      .filter((r) => r.status === "applied" && r.applySeq > seq)
      .sort((a, b) => b.applySeq - a.applySeq); // LIFO
    const summary: RevertSummary = { reverted: [], compensated: [], irreversibleSkipped: [], unrebound: [] };
    const byOwner = new Map<string, EffectRecord[]>();
    for (const r of targets) {
      const k = `${r.ownerKind}|${r.ownerId}`;
      byOwner.set(k, [...(byOwner.get(k) ?? []), r]);
    }
    for (const [k, group] of byOwner) {
      const [kind, id] = k.split("|") as [OwnerRef["kind"], string];
      const s = await this.revertOwner({ kind, id }, actor);
      summary.reverted.push(...s.reverted);
      summary.compensated.push(...s.compensated);
      summary.irreversibleSkipped.push(...s.irreversibleSkipped);
      summary.unrebound.push(...s.unrebound);
    }
    return summary;
  }

  // ── 崩溃恢复(§3.3:重放账本至最近快照,重建内存状态)────────

  /**
   * 从存储重放,重建投影(插件状态/效应栈/预审批)。
   * 诚实边界:JS 服务实现无法从账本复活——active 插件标记为「待重绑」,
   * 重绑 = 重新装载模块并再激活(M0 完成期交付;届时快照+增量重放同此入口)。
   */
  static recover(store: LedgerStore): { kernel: Kernel; needsRebind: string[] } {
    const kernel = new Kernel(store);
    const needsRebind: string[] = [];
    for (const e of store.all) kernel.applyEntry(e, needsRebind);
    // 只有终态为 active 的插件需要重绑服务(中途激活后又停用/销毁的不算)
    const finalActive = new Set(kernel.observable().activeIds);
    return { kernel, needsRebind: needsRebind.filter((id) => finalActive.has(id)) };
  }

  private applyEntry(e: LedgerEntry, needsRebind: string[]): void {
    const pid = e.ref?.plugin as string | undefined;
    switch (e.kind) {
      case "plugin.install": {
        const manifest = (e.payload as { manifest: PluginManifest }).manifest;
        this.plugins.set(pid!, {
          manifest, state: "installed", requested: false,
          dynamicDeps: new Set(), providedServices: [],
        });
        break;
      }
      case "plugin.activate": {
        const rec = this.plugins.get(pid!); if (!rec) break;
        rec.requested = true;
        if (e.ref?.reason === "waiting") break; // 意愿已入账,依赖未就绪(resolved)
        rec.state = "active";
        const provides = (e.payload as { provides?: string[] }).provides ?? rec.manifest.provides;
        rec.providedServices = provides;
        for (const s of provides) this.services.set(s, { impl: undefined, providerId: pid! });
        needsRebind.push(pid!);
        break;
      }
      case "plugin.suspend": {
        const rec = this.plugins.get(pid!); if (!rec) break;
        const reason = e.ref?.reason as string | undefined;
        if (reason === "dependency") {
          rec.state = "suspended"; rec.suspendReason = "dependency"; // 意愿保留,依赖回归后自动复活
          for (const s of rec.providedServices) this.services.delete(s);
        } else if (reason === "failed") {
          rec.requested = false; // 启动失败:释放意愿,状态保持
        } else {
          rec.requested = false; // operator
          if (rec.state === "active") {
            rec.state = "suspended"; rec.suspendReason = "operator";
            for (const s of rec.providedServices) this.services.delete(s);
          }
        }
        break;
      }
      case "plugin.dispose": {
        const rec = this.plugins.get(pid!); if (!rec) break;
        rec.state = "disposed"; rec.requested = false;
        for (const s of rec.providedServices) this.services.delete(s);
        break;
      }
      case "effect.apply": {
        const p = e.payload as { desc: string; rClass: ReversibilityClass; owner: OwnerRef };
        this.stacks.restore({
          token: e.ref?.token as string, desc: p.desc,
          ownerKind: p.owner.kind, ownerId: p.owner.id,
          pluginId: pid, rClass: p.rClass, applySeq: e.seq,
          preapprovalSeq: p.rClass === 2 ? (e.ref?.preapproval as number) : undefined,
          status: "applied",
        });
        break;
      }
      case "effect.revert": case "effect.compensate": {
        const rec = this.stacks.get(e.ref?.token as string);
        if (rec) { rec.status = e.kind === "effect.revert" ? "reverted" : "compensated"; rec.revertSeq = e.seq; }
        break;
      }
      case "effect.preapproval": this.preapprovals.add(e.seq); break;
      default: break; // 其余 kind 属 L1–L3 领域,M0 内核仅保序入链
    }
  }

  // ── 汇流性组合(INV-1 的 canonical 语义,测试对照用)────────

  /** 静止可观测态:汇流性断言比较此投影(§3.4) */
  observable(): {
    activeIds: string[]; services: string[];
    pluginStates: Record<string, PluginStateName>;
    effectStatuses: Record<string, string>;
    chainOk: boolean; lastSeq: number;
  } {
    const pluginStates: Record<string, PluginStateName> = {};
    for (const [id, r] of this.plugins) pluginStates[id] = r.state;
    const effectStatuses: Record<string, string> = {};
    for (const r of this.stacks.all()) effectStatuses[r.token] = r.status;
    return {
      activeIds: [...this.plugins.entries()].filter(([, r]) => r.state === "active").map(([id]) => id).sort(),
      services: [...this.services.keys()].sort(),
      pluginStates, effectStatuses,
      chainOk: this.store.verifyChain().ok, lastSeq: this.store.lastSeq,
    };
  }

  effectRecord(token: string) { return this.stacks.get(token); }
  pluginState(id: string): PluginStateName | undefined { return this.plugins.get(id)?.state; }
  serviceNames(): string[] { return [...this.services.keys()].sort(); }

  /** 效应状态时间线(按 applySeq):崩溃恢复等价性比对用——token 跨运行不同,seq 稳定 */
  effectTimeline(): { applySeq: number; rClass: ReversibilityClass; status: string }[] {
    return this.stacks.all()
      .sort((a, b) => a.applySeq - b.applySeq)
      .map((r) => ({ applySeq: r.applySeq, rClass: r.rClass, status: r.status }));
  }

  /** 重绑:恢复态插件重新装载模块实例(模块是代码不是账本态;服务再提供随激活执行) */
  bindModule(id: string, module: PluginModule): void {
    this.require(id).module = module;
  }

  // ── 内部:激活/停用/反应式驱动(§3.2.3)─────────────────────

  private require(id: string): PluginRecord {
    const rec = this.plugins.get(id);
    if (!rec) throw new KernelError("PLUGIN_NOT_FOUND", id);
    return rec;
  }

  private depsOf(rec: PluginRecord): Set<string> {
    return new Set([...rec.manifest.requires, ...rec.dynamicDeps]);
  }

  private depsSatisfied(rec: PluginRecord): boolean {
    for (const d of this.depsOf(rec)) if (!this.services.has(d)) return false;
    return true;
  }

  private async activateNow(id: string, actor: LedgerActor): Promise<boolean> {
    const rec = this.require(id);
    if (rec.state === "active" || rec.state === "disposed") return rec.state === "active";
    if (!this.depsSatisfied(rec)) return false; // resolved:等待服务出现,不入账
    if (!rec.module) throw new KernelError("MODULE_NOT_LOADED", `恢复态插件无模块,需重绑: ${id}`);
    const ctx = this.makeContext(id);
    try {
      await rec.module.start(ctx);
    } catch (err) {
      // §3.3:失败迁移触发自动回滚至 installed(其已生效效应 LIFO 逆应用;
      // 失败同时释放激活意愿并入账,重放不复活已失败的请求)
      await this.revertOwner({ kind: "plugin", id }, actor);
      rec.state = "installed"; rec.requested = false;
      this.store.append({ actor, kind: "plugin.suspend", ref: { plugin: id, reason: "failed" } });
      this.bus.emit({ type: "plugin.failed", payload: { id, error: String(err) } });
      throw new KernelError("PLUGIN_START_FAILED", `${id}: ${String(err)}`);
    }
    rec.state = "active";
    rec.providedServices = [...this.services.entries()].filter(([, v]) => v.providerId === id).map(([k]) => k);
    this.store.append({ actor, kind: "plugin.activate", ref: { plugin: id }, payload: { provides: rec.providedServices } });
    this.bus.emit({ type: "plugin.state-changed", payload: { id, state: "active" } });
    return true;
  }

  /** 级联停用:先停依赖方(递归),再停自身(§3.2.3:B 在 A 停止前停用)。
   *  reason 入账:operator(操作者意愿)/dependency(被连带)——重放据此还原 requested。 */
  private async cascadeSuspend(id: string, actor: LedgerActor, via: "operator" | "dependency"): Promise<void> {
    const rec = this.require(id);
    const myServices = new Set([...this.services.entries()].filter(([, v]) => v.providerId === id).map(([k]) => k));
    for (const [depId, dep] of this.plugins) {
      if (dep.state !== "active") continue;
      const needsMe = [...this.depsOf(dep)].some((d) => myServices.has(d));
      if (needsMe) await this.cascadeSuspend(depId, actor, "dependency"); // 依赖我的先停(含其自身依赖方)
    }
    if (rec.state !== "active") return;
    await rec.module?.stop?.();
    for (const s of myServices) this.services.delete(s);
    rec.state = "suspended";
    rec.suspendReason = via;
    if (via === "operator") rec.requested = false;
    this.store.append({ actor, kind: "plugin.suspend", ref: { plugin: id, reason: via } });
    this.bus.emit({ type: "plugin.state-changed", payload: { id, state: "suspended", reason: via } });
  }

  /** 反应式驱动至静止:requested 且依赖已满足的等待者依次激活(§3.2.3) */
  private async quiesce(actor: LedgerActor): Promise<void> {
    if (this.quiescing) return; // 防重入:激活波浪在当前调用内收敛
    this.quiescing = true;
    try {
      let progress = true;
      while (progress) {
        progress = false;
        for (const [id, rec] of this.plugins) {
          if (!rec.requested) continue;
          if (rec.state === "active") continue;
          if (rec.state === "disposed") continue;
          if (rec.state === "suspended" && rec.suspendReason === "operator") continue;
          if (!rec.module) continue; // 恢复态未重绑:反应式驱动跳过(显式激活会报 MODULE_NOT_LOADED)
          if (await this.activateNow(id, actor)) progress = true;
        }
      }
    } finally { this.quiescing = false; }
  }

  // ── Context 实现(每个插件一份,绑定 owner=plugin)──────────

  private makeContext(pluginId: string): KernelContext {
    const self = this;
    const rec = () => self.require(pluginId);
    return {
      get trust(): TrustLevel { return "owner"; },   // K.3 M0 临时态:自研插件同进程,信任即宿主
      get budget(): Budget { return {}; },           // 配额体系随 M3 授权代数接入
      inject<T>(key: ServiceKey<T>): ServiceHandle<T> {
        rec().dynamicDeps.add(key.name);
        return {
          get(): T {
            const svc = self.services.get(key.name);
            if (!svc) throw new KernelError("DEPS_MISSING", `服务未就绪: ${key.name}`);
            return svc.impl as T;
          },
        };
      },
      effect<T>(desc: string, apply: () => T | Promise<T>,
                revert: (t: T) => void | Promise<void>, opts?: EffectOptions): EffectToken | Promise<EffectToken> {
        const rClass = opts?.rClass ?? 0;
        const owner = opts?.owner ?? { kind: "plugin" as const, id: pluginId };
        const result = apply();
        const commit = (captured: unknown): EffectToken =>
          self.commitEffect(pluginId, desc, rClass, owner, captured, revert as ((c: unknown) => void | Promise<void>) | undefined, undefined);
        return isThenable(result) ? Promise.resolve(result).then(commit) : commit(result);
      },
      irreversible(desc: string, preapprovalSeq: number,
                   apply: () => void | Promise<void>, opts?: EffectOptions): EffectToken | Promise<EffectToken> {
        const owner = opts?.owner ?? { kind: "plugin" as const, id: pluginId };
        if (!self.preapprovals.has(preapprovalSeq)) {
          throw new KernelError("PREAPPROVAL_REQUIRED", `不可逆效应缺前置审批(K.1): ${desc}`);
        }
        const result = apply();
        const commit = (): EffectToken =>
          self.commitEffect(pluginId, desc, 2, owner, undefined, undefined, preapprovalSeq);
        return isThenable(result) ? Promise.resolve(result).then(commit) : commit();
      },
      provide<T>(key: ServiceKey<T>, impl: T): void {
        self.services.set(key.name, { impl, providerId: pluginId });
      },
      emit(evt: TypedEvent): void { self.bus.emit(evt); },
      on<T extends TypedEvent>(key: EventKey<T>, handler: (e: T) => void): Disposable {
        return self.bus.on(key, handler);
      },
    };
  }

  /** 同步落账:token 分配、effect.apply 入链、效应入栈(apply 的结果由调用方传入) */
  private commitEffect(
    pluginId: string, desc: string, rClass: ReversibilityClass, owner: OwnerRef,
    captured: unknown,
    revert: ((captured: unknown) => void | Promise<void>) | undefined,
    preapprovalSeq: number | undefined,
  ): EffectToken {
    if (rClass === 2 && !this.preapprovals.has(preapprovalSeq!)) {
      throw new KernelError("PREAPPROVAL_REQUIRED", `不可逆效应缺前置审批(K.1): ${desc}`);
    }
    // 可逆/可补偿的 revert 存在性已在 ctx 层于 apply 之前校验(先验后动,失败不留半截效应)
    const token = newEffectToken();
    const entry = this.store.append({
      actor: SYSTEM_ACTOR, kind: "effect.apply",
      ref: { plugin: pluginId, token, ...(rClass === 2 && preapprovalSeq !== undefined ? { preapproval: preapprovalSeq } : {}) },
      payload: { desc, rClass, owner },
    });
    this.stacks.push({
      token, desc, ownerKind: owner.kind, ownerId: owner.id, pluginId,
      rClass, applySeq: entry.seq, status: "applied",
      ...(revert !== undefined ? { revertFn: revert } : {}),
      ...(captured !== undefined ? { captured } : {}),
      ...(preapprovalSeq !== undefined ? { preapprovalSeq } : {}),
    });
    return { token };
  }
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return typeof v === "object" && v !== null && typeof (v as PromiseLike<unknown>).then === "function";
}
