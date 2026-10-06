// Worker 隔离宿主(附录 K.3 M2 行,M2-S6):外部来源插件(MCP/市场技能)一律入子进程。
// 形态:spawnSandboxed(manifest, pluginPath) 返回普通 {manifest, module} 组合体——
// 内核零改动;module.start 在宿主侧 fork bootstrap.cjs,挂服务转发代理 + 效应中介。
//
// 安全性质(穿透测试钉死,tests/worker.test.ts):
//   1. 结构化克隆边界——worker 拿不到宿主对象;协议白名单外一律拒绝;
//   2. 账本落款只在宿主——worker 的 effect 经 IPC 中介入账,apply/revert 代码在 worker 执行,
//      captured 必须可克隆(IPC JSON 序列化天然强制);
//   3. 崩溃/挂死 containment——worker 挂掉/超时:待决调用全部拒绝,宿主与内核状态不受损;
//   4. OS 层威胁(文件系统等)在威胁模型之外(K.3/INV-5 措辞),缓解为部署纪律。

import { fork, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { Kernel } from "../kernel/kernel.js";
import { serviceKey } from "../kernel/types.js";
import type { EffectToken, KernelContext, PluginManifest, PluginModule } from "../kernel/types.js";

// spec-constants: worker_call_timeout_ms / worker_start_timeout_ms
export const WORKER_CALL_TIMEOUT_MS = 15_000;
export const WORKER_START_TIMEOUT_MS = 10_000;

const BOOTSTRAP = join(import.meta.dirname, "bootstrap.cjs");

export interface SandboxOptions {
  /** 服务调用/效应回调超时(毫秒);超时即击杀 worker(检疫语义:fail-fast) */
  callTimeoutMs?: number;
  /** start 就绪超时 */
  startTimeoutMs?: number;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * 外部插件的沙箱化装载:返回与自研插件同形的 {manifest, module},
 * 经 kernel.install/activate 走完全标准生命周期(账本/级联/回滚照旧)。
 */
export function spawnSandboxed(manifest: PluginManifest, pluginPath: string, opts: SandboxOptions = {}): {
  manifest: PluginManifest; module: PluginModule;
} {
  const callTimeout = opts.callTimeoutMs ?? WORKER_CALL_TIMEOUT_MS;
  const startTimeout = opts.startTimeoutMs ?? WORKER_START_TIMEOUT_MS;

  let child: ChildProcess | null = null;
  const pending = new Map<number, Pending>();
  const readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  let rpcSeq = 0;
  let dead = false;

  const killAll = (reason: string): void => {
    if (dead) return;
    dead = true;
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`[SANDBOX_DEAD] ${reason}`));
    }
    pending.clear();
    if (child !== null && child.exitCode === null) child.kill("SIGKILL");
  };

  const rpc = (msg: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (dead || child === null) { reject(new Error(`[SANDBOX_DEAD] worker 不可用`)); return; }
      const id = ++rpcSeq;
      const timer = setTimeout(() => {
        pending.delete(id);
        // 超时 = 挂死/死循环:击杀整个 worker(检疫 fail-fast),宿主继续
        killAll(`调用超时(${callTimeout}ms): ${String(msg.t)}`);
        reject(new Error(`[SANDBOX_TIMEOUT] 调用超时(${callTimeout}ms): ${String(msg.t)}`));
      }, callTimeout);
      pending.set(id, { resolve, reject, timer });
      child.send({ ...msg, id });
    });

  const module: PluginModule = {
    async start(ctx: KernelContext): Promise<void> {
      if (child !== null && child.exitCode === null) killAll("重启前清理旧 worker(suspend→resume 再激活)");
      dead = false; // killAll 之后可再次服役(同模块实例跨 suspend/resume 复用)
      child = fork(BOOTSTRAP, [pluginPath], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
      child.on("message", (m: Record<string, unknown>) => { void handleMessage(m, ctx); });
      child.on("exit", (code, signal) => {
        if (!dead) killAll(`worker 退出(code=${code} signal=${signal ?? "?"})`);
      });
      child.on("error", (err) => { if (!dead) killAll(`worker 错误: ${String(err)}`); });

      // 生命周期挂钩:worker 存活到 disposed 为止(dispose = suspend → revertOwner → disposed,
      // 效应回滚发生在 stop 之后——提前击杀会让 revert 诚实失败)
      ctx.on({ type: "plugin.state-changed" }, (e) => {
        const p = e.payload as { id?: string; state?: string } | undefined;
        if (p?.id === `${manifest.name}@${manifest.version}` && p.state === "disposed") {
          killAll("插件已销毁");
        }
      });

      // 就绪等待(带超时)
      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`[SANDBOX_TIMEOUT] start 超时(${startTimeout}ms)`)), startTimeout);
        readyWaiters.push({ resolve: () => { clearTimeout(timer); resolve(); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      });
      child.send({ t: "start", manifest });
      await ready;

      // 服务转发代理:manifest.provides 逐名预挂(调用经 IPC;方法级动态转发)
      for (const svcName of manifest.provides) {
        ctx.provide(serviceKey<unknown>(svcName), makeProxy(svcName));
      }
    },

    async stop(): Promise<void> {
      // 优雅自理即止——不击杀:dispose 的 revertOwner 随后仍需 worker 执行逆操作
      if (child === null || child.exitCode !== null) return;
      try {
        await rpc({ t: "stop" });
      } catch { /* 已死/超时:exit 处理器兜底 */ }
    },
  };

  function flushReady(err?: string): void {
    for (const w of readyWaiters.splice(0)) {
      if (err === undefined) w.resolve();
      else w.reject(new Error(`[SANDBOX_START_FAILED] ${err}`));
    }
  }

  function makeProxy(svcName: string): Record<string, (...args: unknown[]) => Promise<unknown>> {
    return new Proxy({}, {
      get(_t, method) {
        if (typeof method !== "string") return undefined;
        return (...args: unknown[]) => rpc({ t: "svc-call", service: svcName, method, args });
      },
    }) as Record<string, (...args: unknown[]) => Promise<unknown>>;
  }

  function handleMessage(m: Record<string, unknown>, ctx: KernelContext): void {
    switch (m.t) {
      case "boot": return; // 子进程协议栈就绪
      case "ready": {
        flushReady(typeof m.error === "string" ? m.error : undefined);
        return;
      }
      case "provide": {
        // 服务实现在 worker 自持;宿主已在 start 预挂代理——
        // 越权 provide(不在 manifest.provides)不予登记
        return;
      }
      case "svc-result": {
        const p = pending.get(m.id as number);
        if (p !== undefined) {
          pending.delete(m.id as number);
          clearTimeout(p.timer);
          if (m.ok === true) p.resolve(m.value);
          else p.reject(new Error(String(m.error)));
        }
        return;
      }
      case "fx": {
        // 效应中介:账本落款在宿主;apply/revert 经 fx-run 回到 worker 执行
        void (async () => {
          const fxId = String(m.fxId);
          const rClass = (m.rClass as 0 | 1 | 2) ?? 0;
          try {
            // apply 的返回值 = captured(IPC 克隆回宿主,供日后 revert 传入 worker)
            const run = (op: "apply" | "revert", captured?: unknown): Promise<unknown> =>
              rpc({ t: "fx-run", fxId, op, ...(op === "revert" && captured !== undefined ? { captured } : {}) });
            let tokenRef: string;
            if (rClass === 2) {
              const t2 = await ctx.irreversible(String(m.desc), Number(m.preapproval),
                async () => { await run("apply"); });
              tokenRef = t2.token;
            } else {
              const t1 = await ctx.effect<unknown>(
                String(m.desc),
                () => run("apply"),
                async (captured) => { await run("revert", captured); },
                {
                  rClass,
                  ...(m.rebindArgs !== undefined ? { rebindArgs: m.rebindArgs } : {}),
                },
              );
              tokenRef = t1.token;
            }
            child?.send({ t: "host-result", id: m.id, ok: true, value: { token: tokenRef } });
          } catch (err) {
            child?.send({ t: "host-result", id: m.id, ok: false, error: String(err) });
          }
        })();
        return;
      }
      case "emit": {
        const evt = m.evt as { type: string; payload?: unknown } | undefined;
        if (evt !== undefined && typeof evt.type === "string") ctx.emit(evt);
        return;
      }
      case "host-call": {
        // worker 调用宿主服务(白名单:仅宿主已激活服务;如 llm.chat)
        void (async () => {
          try {
            const kernel = currentHostKernel;
            if (kernel === null) throw new Error("宿主内核未登记(registerHostKernel)");
            const svc = kernel.service<unknown>(serviceKey<unknown>(String(m.service))) as
              | { [k: string]: ((...a: unknown[]) => Promise<unknown>) | undefined }
              | undefined;
            const fn = svc?.[String(m.method)];
            if (typeof fn !== "function") throw new Error(`宿主服务不可用: ${String(m.service)}.${String(m.method)}`);
            const value = await fn(...((m.args as unknown[] | undefined) ?? []));
            child?.send({ t: "host-result", id: m.id, ok: true, value });
          } catch (err) {
            child?.send({ t: "host-result", id: m.id, ok: false, error: String(err) });
          }
        })();
        return;
      }
      default:
        // 协议白名单外:拒绝应答(穿透防线——worker 无法借协议触达内核)
        if (typeof m.id === "number") {
          child?.send({ t: "host-result", id: m.id, ok: false, error: `协议拒绝: ${String(m.t)}` });
        }
        return;
    }
  }

  return { manifest, module };
}

/** 宿主内核登记(daemon 装配时调用一次;host-call 白名单解析用) */
let currentHostKernel: Kernel | null = null;
export function registerHostKernel(kernel: Kernel): void { currentHostKernel = kernel; }
