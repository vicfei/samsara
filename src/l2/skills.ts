// 最小 L2:技能资产 + 会话 COW 分支(主文档 §6.1/§6.2/§6.4 的 M1 子集)
// 会话开启 → 绑定分支;技能写入落分支(局部可见);体检(lint)通过后晋升 main(全局);
// 晋升判据的完整管道(影子验证/R 闸)属 M4——M1 只做 lint 体检 + 单会话者自动合并。
// 资产不可变:内容入 CAS,版本树在投影(skill_nodes/branch_ops)。

import type { Kernel } from "../kernel/kernel.js";
import type { Projection } from "../kernel/projection.js";
import type { LedgerActor } from "../kernel/types.js";

export const SKILL_MAX_BYTES = 15360; // spec-constants: skill_max_bytes

/** 体检规则(§6.4 示例的最小集):尺寸/前置元数据/危险指令模式 */
const FORBIDDEN_PATTERNS = [/跳过确认/, /禁用审批/, /绕过审批/, /跳过审核/, /ignore\s+approval/i];

export interface SkillFrontmatter {
  name: string;
  trigger?: string; // 何时使用(供检索/上下文注入)
}

export interface SkillMeta {
  cas: string;
  name: string;
  version: number;
  branch: string;
  trigger?: string;
}

export class SkillLintError extends Error {
  constructor(readonly violations: string[]) { super(`技能体检未通过: ${violations.join("; ")}`); }
}

/** 晋升闸门(INC5):全局资产变更的信任级要求 */
export class SkillGateError extends Error {}

function parseFrontmatter(markdown: string): { fm: Record<string, string>; violations: string[] } {
  const violations: string[] = [];
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(markdown);
  const fm: Record<string, string> = {};
  if (!m) {
    violations.push("缺少 frontmatter(需以 --- 开始,含 name 字段)");
    return { fm, violations };
  }
  for (const line of m[1]!.split("\n")) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line.trim());
    if (kv) fm[kv[1]!] = kv[2]!.trim();
  }
  if (!fm.name) violations.push("frontmatter 缺少 name");
  return { fm, violations };
}

export function lintSkill(markdown: string, name?: string): { fm: SkillFrontmatter; violations: string[] } {
  const { fm, violations } = parseFrontmatter(markdown);
  if (name !== undefined && fm.name !== name) violations.push(`frontmatter name(${fm.name})与目标名(${name})不一致`);
  const bytes = Buffer.byteLength(markdown, "utf-8");
  if (bytes > SKILL_MAX_BYTES) violations.push(`尺寸 ${bytes}B 超上限 ${SKILL_MAX_BYTES}B`);
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(markdown)) violations.push(`含危险指令模式: ${p.source}`);
  }
  return { fm: { name: fm.name ?? "", ...(fm.trigger ? { trigger: fm.trigger } : {}) }, violations };
}

/** 技能与分支服务:读走投影(读模型),写走账本(事实源) */
export class Skills {
  constructor(private readonly kernel: Kernel, private readonly projection: Projection) {}

  /** 会话开启(幂等):绑定一条 COW 分支(§6.2 一个活跃 sessionKey 一条分支)
   *  trust_level/trust_source:渠道对端信任派生结果随条目入账(§4.4/K.4 审计) */
  openSession(sessionKey: string, actor: LedgerActor, opts: { trustSource?: string } = {}): string {
    const existing = this.branchOf(sessionKey);
    if (existing) return existing;
    const branchId = `br_${sessionKey.replace(/[^a-z0-9]/gi, "_").slice(0, 40)}_${Date.now().toString(36)}`;
    this.kernel.store.append({
      actor, kind: "session.open", ref: { session: sessionKey },
      payload: {
        session_key: sessionKey, branch_id: branchId,
        trust_level: actor.trust ?? "untrusted",
        ...(opts.trustSource !== undefined ? { trust_source: opts.trustSource } : {}),
        base_cas: this.mainHeadCas(),
      },
    });
    return branchId;
  }

  /** 会话收尾:分支合并(晋升过)或放弃(§5.3 会话回收) */
  closeSession(sessionKey: string, actor: LedgerActor, branchState: "merged" | "abandoned" = "merged"): void {
    const branch = this.branchOf(sessionKey);
    if (!branch) return;
    this.kernel.store.append({
      actor, kind: "session.close", ref: { session: sessionKey },
      payload: { session_key: sessionKey, branch_id: branch, branch_state: branchState },
    });
  }

  /** 写技能到会话分支(默认局部,§6.4);lint 先行(体检不过不落盘) */
  write(sessionKey: string, name: string, markdown: string, actor: LedgerActor,
        provenance: { trace_id?: string; source?: string } = {}): SkillMeta {
    const { fm, violations } = lintSkill(markdown, name);
    if (violations.length > 0) throw new SkillLintError(violations);
    const branch = this.branchOf(sessionKey);
    if (!branch) throw new Error(`会话未开启: ${sessionKey}(技能默认局部,须落分支)`);
    const head = this.headOf(name, branch);
    const version = (head?.version ?? 0) + 1;
    const { cas } = this.kernel.store.putCas(markdown);
    this.kernel.store.append({
      actor, kind: "skill.commit", ref: { skill: name },
      payload: {
        name, cas, version, branch, session_key: sessionKey, size: Buffer.byteLength(markdown, "utf-8"),
        parent_cas: head?.cas ?? null,
        provenance: { ...provenance, session_key: sessionKey, actor_trust: actor.trust ?? "owner", source: provenance.source ?? "agent" },
        ...(fm.trigger ? { trigger: fm.trigger } : {}),
      },
    });
    return { cas, name, version, branch, ...(fm.trigger ? { trigger: fm.trigger } : {}) };
  }

  /** 晋升:分支头 → lint → main 新版本(R0/R1 自动合并的最小形态;完整管道属 M4)
   *  闸门(INC5 最小形态):晋升全局库 = owner-only;known 提案进 review 队列属 M4 */
  promote(sessionKey: string, name: string, actor: LedgerActor): SkillMeta {
    if (actor.trust !== "owner") {
      throw new SkillGateError(`技能晋升需 owner(当前 ${actor.trust ?? "untrusted"});known 提案队列属 M4(§6.4/INC5)`);
    }
    const branch = this.branchOf(sessionKey);
    if (!branch) throw new Error(`会话未开启: ${sessionKey}`);
    const branchHead = this.headOf(name, branch);
    if (!branchHead) throw new Error(`分支无此技能: ${name}`);
    const markdown = this.kernel.store.readCas(branchHead.cas);
    const { fm, violations } = lintSkill(markdown, name);
    if (violations.length > 0) throw new SkillLintError(violations);
    const mainHead = this.headOf(name, "main");
    const version = (mainHead?.version ?? 0) + 1;
    this.kernel.store.append({
      actor, kind: "skill.promote", ref: { skill: name },
      payload: {
        name, cas: branchHead.cas, version, from_branch: branch, session_key: sessionKey,
        parent_cas: mainHead?.cas ?? null,
        ...(fm.trigger ? { trigger: fm.trigger } : {}),
      },
    });
    return { cas: branchHead.cas, name, version, branch: "main", ...(fm.trigger ? { trigger: fm.trigger } : {}) };
  }

  /** 上下文装配(§5.1 第 1 步):main 活跃技能清单 */
  listMain(): SkillMeta[] {
    return (this.projection.db.prepare(
      `SELECT cas_id AS cas, name, version, branch FROM skill_nodes
       WHERE branch='main' AND status='active' ORDER BY name, version DESC`,
    ).all() as { cas: string; name: string; version: number; branch: string }[])
      .filter((r, i, arr) => arr.findIndex((x) => x.name === r.name) === i) // 每名取最新版
      .map((r) => ({ cas: r.cas, name: r.name, version: r.version, branch: r.branch }));
  }

  readMain(name: string): string | undefined {
    const meta = this.listMain().find((s) => s.name === name);
    return meta !== undefined ? this.kernel.store.readCas(meta.cas) : undefined;
  }

  /** 供系统提示注入的摘要行 */
  contextLines(): string[] {
    return this.listMain().map((s) => {
      const content = this.kernel.store.readCas(s.cas);
      const trig = /trigger:\s*(.+)/.exec(content ?? "")?.[1];
      return trig !== undefined ? `- ${s.name}(v${s.version}):${trig.trim()}` : `- ${s.name}(v${s.version})`;
    });
  }

  // ── 内部:读投影 ────────────────────────────────────────

  private branchOf(sessionKey: string): string | undefined {
    const row = this.projection.db.prepare(
      `SELECT branch_id FROM sessions WHERE session_key=? AND state='open'`,
    ).get(sessionKey) as { branch_id: string } | undefined;
    return row?.branch_id;
  }

  private headOf(name: string, branch: string): { cas: string; version: number } | undefined {
    return this.projection.db.prepare(
      `SELECT cas_id AS cas, version FROM skill_nodes WHERE name=? AND branch=? AND status='active'
       ORDER BY version DESC LIMIT 1`,
    ).get(name, branch) as { cas: string; version: number } | undefined;
  }

  private mainHeadCas(): string {
    const row = this.projection.db.prepare(
      `SELECT cas_id FROM skill_nodes WHERE branch='main' AND status='active' ORDER BY version DESC LIMIT 1`,
    ).get() as { cas_id: string } | undefined;
    return row?.cas_id ?? "";
  }
}
