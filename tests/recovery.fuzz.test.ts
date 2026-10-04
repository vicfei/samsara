// 崩溃恢复模糊测试(§3.4 / M0 出口标准之二)
// 随机操作序列 + 随机时刻"崩溃"(丢弃内存态,仅留账本文件)→ 重放恢复:
//  1. 恢复后的投影(插件状态/效应时间线/服务清单)与崩溃前一致;
//  2. 与无崩溃的参考运行终态一致;
//  3. 恢复后可继续安装/激活新插件,链始终完整。
// 诚实边界:JS 服务实现与 revertFn 无法从账本复活——恢复的是投影,重绑属 M0 完成期。

import { describe, expect, it } from "vitest";
import { Kernel } from "../src/kernel/kernel.js";
import { makePlugin, rng, tmpStore } from "./helpers.js";

interface Op { target: number; op: "activate" | "suspend" }
interface Script { n: number; deps: number[][]; ops: Op[]; crashAt: number; effectsPer: number[] }

function makeScript(seed: number): Script {
  const r = rng(seed);
  const n = 2 + Math.floor(r() * 4); // 2..5
  const deps: number[][] = [];
  for (let i = 0; i < n; i++) {
    const cnt = Math.floor(r() * i); // 只引用更早者 → DAG
    const d = new Set<number>();
    for (let k = 0; k < cnt; k++) d.add(Math.floor(r() * i));
    deps.push([...d]);
  }
  const ops: Op[] = [];
  const total = 6 + Math.floor(r() * 10);
  for (let k = 0; k < total; k++) {
    ops.push({ target: Math.floor(r() * n), op: r() < 0.6 ? "activate" : "suspend" });
  }
  const effectsPer = Array.from({ length: n }, () => Math.floor(r() * 3)); // 0..2 个效应
  const crashAt = 1 + Math.floor(r() * (ops.length - 1));
  return { n, deps, ops, crashAt, effectsPer };
}

function projection(kernel: Kernel) {
  const obs = kernel.observable();
  return {
    activeIds: obs.activeIds,
    services: obs.services,
    pluginStates: obs.pluginStates,
    effectTimeline: kernel.effectTimeline(),
    lastSeq: obs.lastSeq,
  };
}

/** 执行脚本;crash=true 时在 crashAt 处丢弃内存态并从账本重放恢复 */
async function runScript(script: Script, crash: boolean) {
  const t = tmpStore();
  let kernel = new Kernel(t.store);

  const plugins = Array.from({ length: script.n }, (_, i) => {
    const fx = script.effectsPer[i]!;
    return makePlugin({
      name: `p${i}`,
      requires: script.deps[i]!.map((j) => `p${j}.svc`),
      onStart: (ctx) => {
        ctx.provide({ name: `p${i}.svc` } as never, { by: i });
        for (let k = 0; k < fx; k++) {
          void ctx.effect(`p${i}-fx${k}`,
            () => k, () => { /* 测试环境无外部状态 */ },
            { owner: { kind: "agent", id: `ag_${i}_${k}` } });
        }
      },
    });
  });
  for (const p of plugins) kernel.install(p.manifest, p.module);

  let preCrash: ReturnType<typeof projection> | undefined;
  for (let k = 0; k < script.ops.length; k++) {
    if (crash && k === script.crashAt) {
      preCrash = projection(kernel);
      const recovered = Kernel.recover(t.store); // 崩溃:仅账本文件幸存
      kernel = recovered.kernel;
      // 重绑:模块是代码不是账本态——真实守护进程恢复时同样重新装载插件代码
      for (let i = 0; i < plugins.length; i++) kernel.bindModule(`p${i}@1.0.0`, plugins[i]!.module);
    }
    const op = script.ops[k]!;
    const id = `p${op.target}@1.0.0`;
    if (op.op === "activate") await kernel.activate(id).catch((e) => { /* MODULE_NOT_LOADED 视为合法跳过 */ if (!String(e).includes("MODULE_NOT_LOADED")) throw e; });
    else await kernel.suspend(id);
  }

  // 恢复后继续运转:新插件安装+激活(不依赖旧模块实例)
  const fresh = makePlugin({ name: "post-crash", requires: [] });
  kernel.install(fresh.manifest, fresh.module);
  await kernel.activate("post-crash@1.0.0");

  const final = projection(kernel);
  const chainOk = kernel.store.verifyChain().ok;
  t.cleanup();
  return { preCrash, final, chainOk };
}

describe("崩溃恢复模糊测试(随机 40 个种子)", () => {
  it("恢复投影 = 崩溃前投影;终态 = 无崩溃参考;链完整", async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const script = makeScript(seed);
      const crashed = await runScript(script, true);
      const reference = await runScript(script, false);

      // 1. 崩溃即丢内存:恢复出的投影必须等于崩溃前的账本投影
      {
        const t2 = await runScriptAt(script, script.crashAt); // 只跑到崩溃点,断言恢复 == 崩溃前
        expect(t2.recoveredAfter, `seed=${seed} 恢复投影漂移`).toEqual(t2.before);
      }

      // 2. 终态与无崩溃参考一致(忽略 token 类随机性:effectTimeline 按 seq 比对)
      expect(crashed.final.activeIds).toEqual(reference.final.activeIds);
      expect(crashed.final.services).toEqual(reference.final.services);
      expect(crashed.final.pluginStates).toEqual(reference.final.pluginStates);
      expect(crashed.final.effectTimeline).toEqual(reference.final.effectTimeline);
      expect(crashed.final.lastSeq).toEqual(reference.final.lastSeq);

      // 3. 链完整
      expect(crashed.chainOk, `seed=${seed} 链损坏`).toBe(true);
    }
  });
});

/** 跑到崩溃点,返回「恢复后立即取的投影」——用于断言恢复 == 崩溃前 */
async function runScriptAt(script: Script, stopAt: number) {
  const t = tmpStore();
  let kernel = new Kernel(t.store);
  const plugins = Array.from({ length: script.n }, (_, i) => {
    const fx = script.effectsPer[i]!;
    return makePlugin({
      name: `p${i}`, requires: script.deps[i]!.map((j) => `p${j}.svc`),
      onStart: (ctx) => {
        ctx.provide({ name: `p${i}.svc` } as never, { by: i });
        for (let k = 0; k < fx; k++) {
          void ctx.effect(`p${i}-fx${k}`, () => k, () => {},
            { owner: { kind: "agent", id: `ag_${i}_${k}` } });
        }
      },
    });
  });
  for (const p of plugins) kernel.install(p.manifest, p.module);
  for (let k = 0; k < stopAt; k++) {
    const op = script.ops[k]!;
    const id = `p${op.target}@1.0.0`;
    if (op.op === "activate") await kernel.activate(id);
    else await kernel.suspend(id);
  }
  const before = projection(kernel);
  const recovered = projection(Kernel.recover(t.store).kernel);
  t.cleanup();
  return { before, recoveredAfter: recovered };
}
