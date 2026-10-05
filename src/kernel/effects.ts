// L0 可逆效应 —— 主文档 §3.2.2 / 附录 K.1(三分类)/ 数据模型 §4 A.2(GAP1 owner 归属)
// 效应栈按 owner 组织;kill(owner) = 按 LIFO 回滚其全部 effect,配额/资产语义归上层。

import { randomUUID } from "node:crypto";
import type { OwnerRef, ReversibilityClass } from "./types.js";

export type EffectStatus = "applied" | "reverted" | "compensated" | "failed";

export interface EffectRecord {
  token: string; // fx_<uuid>
  desc: string;
  ownerKind: OwnerRef["kind"];
  ownerId: string;
  pluginId?: string | undefined;
  rClass: ReversibilityClass; // K.1:0=可逆 1=可补偿 2=不可逆(前置审批)
  applySeq: number;
  revertSeq?: number | undefined;
  preapprovalSeq?: number | undefined; // rClass=2 必填
  rebindArgs?: unknown | undefined;    // 随 effect.apply 入账,重绑定依据
  status: EffectStatus;
  /** 运行态句柄(仅活内核持有;重放投影不含) */
  revertFn?: (captured: unknown) => void | Promise<void>;
  captured?: unknown;
}

export class EffectStacks {
  private readonly byToken = new Map<string, EffectRecord>();
  private readonly byOwner = new Map<string, EffectRecord[]>(); // key: kind|id,按 apply 序

  private static key(o: OwnerRef): string { return `${o.kind}|${o.id}`; }

  push(rec: EffectRecord): void {
    this.byToken.set(rec.token, rec);
    const k = EffectStacks.key({ kind: rec.ownerKind, id: rec.ownerId });
    let arr = this.byOwner.get(k);
    if (!arr) { arr = []; this.byOwner.set(k, arr); }
    arr.push(rec);
  }

  get(token: string): EffectRecord | undefined { return this.byToken.get(token); }

  /** 按 owner 取仍处 applied 态的效应,apply 序返回(调用方以 LIFO 消费) */
  appliedOf(owner: OwnerRef): EffectRecord[] {
    return (this.byOwner.get(EffectStacks.key(owner)) ?? [])
      .filter((r) => r.status === "applied");
  }

  /** 按插件取仍处 applied 态的效应(重绑定的重挂对象;apply 序) */
  appliedByPlugin(pluginId: string): EffectRecord[] {
    return this.all().filter((r) => r.pluginId === pluginId && r.status === "applied");
  }

  allOf(owner: OwnerRef): EffectRecord[] {
    return this.byOwner.get(EffectStacks.key(owner)) ?? [];
  }

  all(): EffectRecord[] { return [...this.byToken.values()]; }

  /** 重放恢复:按账本事实重建投影(无运行态句柄) */
  restore(rec: Omit<EffectRecord, "revertFn" | "captured">): void {
    this.push({ ...rec });
  }
}

export function newEffectToken(): string {
  return `fx_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** 回滚结果摘要:可逆/可补偿各归其位;不可逆与未重绑效应不伪造撤销,单独上报 */
export interface RevertSummary {
  reverted: string[];      // class 0:revert 后状态复原
  compensated: string[];   // class 1:补偿动作已执行
  irreversibleSkipped: string[]; // class 2:前置审批过的既成事实,不伪造撤销
  unrebound: string[];     // class 0/1 但处于恢复态(无运行时句柄):诚实拒绝,不写 revert 条目
}
