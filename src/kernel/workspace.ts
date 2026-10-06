// 工作区写捕获(M3-S3,附录 K.2 → G.7):copy-on-first-write 覆盖层,可逆、可提交、可丢弃。
//
// 语义(K.2):
//   会话绑定工作区 → 开层(单效应,owner={kind:"session"}):首写前原件副本入 sidecar,
//   后续写纯 Map 命中直写——拦截开销即一次查表(SLO:≤10%,100 并发实测);
//   commit  = 差异清单入 CAS(samsara-workspace-commit/1)+ workspace.bind 入账(环境保持既成);
//   discard / kill = revert 该会话 owner 的效应 → 按 sidecar 还原全部原件(git status 级干净,F-03);
//   重绑:rebindArgs 携带 root/sidecar 路径,崩溃恢复后 discard 仍可还原(原件在盘)。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Kernel } from "./kernel.js";
import type { LedgerActor } from "./types.js";

export interface CommitManifest {
  schema: "samsara-workspace-commit/1";
  session_key: string;
  root: string;
  ops: { path: string; existed_before: boolean; sha256_before?: string; sha256_after: string }[];
  committed_at: string;
}

export interface WorkspaceCaptureOptions {
  /** 已存在的覆盖层沿用(重绑/复用);缺省新开 */
  rebindArgs?: { root: string; sidecar: string };
}

export class WorkspaceCapture {
  readonly root: string;
  readonly sidecar: string;
  /** 路径+状态缓存(SLO:稳态每次写 = 一次 Map.get + 直写,零 path 解析零重复查表) */
  private readonly entries = new Map<string, { rel: string; abs: string; dir: string; orig: string; origDir: string; stashed: boolean; dirOk: boolean }>();
  private readonly dirsOk = new Set<string>();
  readonly token: string;

  constructor(
    private readonly kernel: Kernel,
    private readonly pluginId: string,
    readonly sessionKey: string,
    rootDir: string,
    opts: WorkspaceCaptureOptions = {},
  ) {
    this.root = opts.rebindArgs?.root ?? rootDir;
    this.sidecar = opts.rebindArgs?.sidecar ?? join(rootDir, "..", ".capture", `${sessionKey.replace(/[^a-z0-9]/gi, "_")}`);
    mkdirSync(this.root, { recursive: true });
    mkdirSync(this.sidecar, { recursive: true });
    // 开层:单效应承载整个覆盖层(每写一笔账会主导开销——SLO 设计约束)
    const ctx = this.kernel.contextFor(this.pluginId, { kind: "session", id: sessionKey });
    const t = ctx.effect(
      `workspace 写捕获 ${sessionKey}`,
      () => undefined,
      () => this.restoreAll(),
      { owner: { kind: "session", id: sessionKey }, rebindArgs: { root: this.root, sidecar: this.sidecar } },
    ) as { token: string }; // apply 同步返回 undefined → effect 同步提交
    this.token = t.token;
    if (opts.rebindArgs !== undefined) {
      // 重绑:盘点 sidecar 已存的原件(崩溃恢复后 discard 仍可还原)
      for (const se of scanSidecar(this.sidecar)) {
        const abs = join(this.root, se.rel);
        this.entries.set(se.rel, { rel: se.rel, abs, dir: dirname(abs), orig: join(this.sidecar, se.rel), origDir: dirname(join(this.sidecar, se.rel)), stashed: true, dirOk: true });
      }
    }
  }

  /** 拦截写:首写前原件入 sidecar(COW);此后单次查表直写(SLO 稳态路径) */
  write(relPath: string, content: string | Buffer): void {
    let e = this.entries.get(relPath);
    if (e === undefined) {
      const rel = this.resolve(relPath).rel;
      const abs = join(this.root, rel);
      const orig = join(this.sidecar, rel);
      e = { rel, abs, dir: dirname(abs), orig, origDir: dirname(orig), stashed: false, dirOk: false };
      this.entries.set(relPath, e);
    }
    if (!e.stashed) {
      if (existsSync(e.abs)) {
        this.ensureDir(e.origDir);
        cpSync(e.abs, e.orig);             // 原件副本(还原=覆盖回去)
      } else {
        this.ensureDir(e.origDir);
        writeFileSync(newMarker(e.orig), ""); // 新文件标记(还原=删除)
      }
      e.stashed = true;
    }
    if (!e.dirOk && !this.dirsOk.has(e.dir)) { mkdirSync(e.dir, { recursive: true }); this.dirsOk.add(e.dir); }
    e.dirOk = true;
    writeFileSync(e.abs, content);
  }

  private ensureDir(dir: string): void {
    if (!this.dirsOk.has(dir)) { mkdirSync(dir, { recursive: true }); this.dirsOk.add(dir); }
  }

  read(relPath: string): string | undefined {
    const abs = join(this.root, this.resolve(relPath).rel);
    return existsSync(abs) ? readFileSync(abs, "utf-8") : undefined;
  }

  /** 差异清单(相对 sidecar 记录的原件) */
  changedFiles(): string[] { return [...this.entries.values()].filter((e) => e.stashed).map((e) => e.rel); }

  /** commit:差异入 CAS(环境保持既成事实;不回滚) */
  commit(actor: LedgerActor, traceId?: string): { cas: string; ops: number } {
    const ops = [...this.entries.values()].filter((e) => e.stashed).map((e) => {
      const isNew = existsSync(newMarker(e.orig));
      return {
        path: e.rel,
        existed_before: !isNew,
        ...(!isNew ? { sha256_before: sha256File(e.orig) } : {}),
        sha256_after: sha256File(e.abs),
      };
    });
    const manifest: CommitManifest = {
      schema: "samsara-workspace-commit/1",
      session_key: this.sessionKey,
      root: this.root,
      ops,
      committed_at: new Date().toISOString(),
    };
    const { cas } = this.kernel.store.putCas(manifest);
    this.kernel.store.append({
      actor, kind: "workspace.bind", ref: { session: this.sessionKey },
      payload: { session_key: this.sessionKey, root: this.root, commit_cas: cas, ops: ops.length, ...(traceId !== undefined ? { trace_id: traceId } : {}) },
    });
    return { cas, ops: ops.length };
  }

  /** discard:整层还原(git status 级干净)——经账本 revert(诚实:不可逆的损坏会失败而非静默) */
  async discard(actor: LedgerActor): Promise<{ reverted: string[] }> {
    const summary = await this.kernel.revertOwner({ kind: "session", id: this.sessionKey }, actor);
    rmSync(this.sidecar, { recursive: true, force: true });
    return { reverted: summary.reverted };
  }

  /** 副作用还原(effect revert 回调):按 sidecar 恢复全部原件 */
  private restoreAll(): void {
    for (const e of scanSidecar(this.sidecar)) {
      const abs = join(this.root, e.rel);
      const orig = join(this.sidecar, e.rel);
      if (e.isNew) {
        rmSync(abs, { force: true }); // 捕获层新建的文件 → 移除
      } else {
        mkdirSync(dirname(abs), { recursive: true });
        cpSync(orig, abs);            // 覆写回原件
      }
    }
  }

  /** 路径安全:拒绝越出 root 的逃逸(../ 与绝对路径) */
  private resolve(relPath: string): { rel: string } {
    const norm = relPath.replace(/\\/g, "/");
    if (norm.startsWith("/") || norm.includes("..")) {
      throw new Error(`工作区路径越界: ${relPath}`);
    }
    return { rel: norm };
  }
}

// ── sidecar 助手 ─────────────────────────────────────────

/** 新文件标记:该路径在开层前不存在(还原 = 删除) */
const NEW_MARKER = ".samsara-new";
function newMarker(origPath: string): string { return `${origPath}${NEW_MARKER}`; }

/** 盘点 sidecar:内容原件 + 新文件标记 → {rel, isNew}(跳过标记本体命名歧义) */
function scanSidecar(dir: string): { rel: string; isNew: boolean }[] {
  const out: { rel: string; isNew: boolean }[] = [];
  const walk = (d: string, prefix: string): void => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) { walk(join(d, f.name), `${prefix}${f.name}/`); continue; }
      if (f.name.endsWith(NEW_MARKER)) out.push({ rel: `${prefix}${f.name.slice(0, -NEW_MARKER.length)}`, isNew: true });
      else out.push({ rel: `${prefix}${f.name}`, isNew: false });
    }
  };
  walk(dir, "");
  return out;
}

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}
