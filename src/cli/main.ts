// samsara CLI —— M0 最小壳(附录 I.1:CLI 是 M0 交付)
// daemon start:进程内自检启动(常驻服务/WS 网关随 M2 车道队列交付)
// doctor:账本哈希链 + CAS 引用完整性校验(对应 samsara doctor 语义)

import { homedir } from "node:os";
import { join } from "node:path";
import { LedgerStore } from "../kernel/ledger.js";
import { Kernel } from "../kernel/kernel.js";
import { serviceKey } from "../kernel/types.js";
import type { PluginManifest, PluginModule } from "../kernel/types.js";

const HOME = process.env.SAMSARA_HOME ?? join(homedir(), ".samsara");

const SELFTEST_MANIFEST: PluginManifest = {
  name: "selftest", version: "0.1.0",
  provides: ["selftest.ping"], requires: [], rLevel: "R0",
};
const SELFTEST_MODULE: PluginModule = {
  start(ctx) {
    const flag = { up: true };
    ctx.provide(serviceKey<{ up: boolean }>("selftest.ping"), flag);
    void ctx.effect("selftest: 标记启动",
      () => { flag.up = true; return flag; },
      (f) => { f.up = false; });
  },
};

async function cmd(argv: string[]): Promise<number> {
  const [cmdName, ...rest] = argv;
  const sub = rest[0];
  switch (cmdName) {
    case "daemon": {
      if (sub === "start") return daemonStart();
      if (sub === "status") return daemonStatus();
      if (sub === "stop") {
        console.log("M0:daemon 为进程内自检模式,无常驻进程;常驻服务随 M2 车道队列交付。");
        return 0;
      }
      console.log("用法: samsara daemon start|status|stop");
      return 2;
    }
    case "doctor": return doctor();
    case "--help": case "-h": case undefined: {
      console.log("samsara (M0) — 可组合内核\n  daemon start|status|stop   运行时自检\n  doctor                     账本与 CAS 完整性校验");
      return 0;
    }
    default: console.error(`未知命令: ${cmdName}(--help 查看用法)`); return 2;
  }
}

async function daemonStart(): Promise<number> {
  const store = new LedgerStore(HOME);
  const { kernel, needsRebind } = Kernel.recover(store);
  console.log(`引导完成:账本 seq=${store.lastSeq},待重绑插件 ${needsRebind.length} 个`);
  try {
    kernel.install(SELFTEST_MANIFEST, SELFTEST_MODULE);
    const { activated } = await kernel.activate("selftest@0.1.0");
    const obs = kernel.observable();
    console.log(`自检插件: activated=${activated}, active=${obs.activeIds.join(",") || "(无)"}, services=${obs.services.join(",") || "(无)"}`);
    console.log(`链完整性: ${obs.chainOk ? "通过" : "损坏"},seq=${obs.lastSeq}`);
    const summary = await kernel.dispose("selftest@0.1.0");
    console.log(`自检清理: revert=${summary.reverted.length}, compensate=${summary.compensated.length}, irreversibleSkipped=${summary.irreversibleSkipped.length}`);
    console.log("daemon start: 自检通过(M0 进程内模式)");
    return 0;
  } catch (err) {
    console.error(`自检失败: ${String(err)}`);
    return 1;
  }
}

function daemonStatus(): number {
  const store = new LedgerStore(HOME);
  const byKind = new Map<string, number>();
  for (const e of store.all) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  console.log(`账本: seq=${store.lastSeq}, head=${store.headHash.slice(0, 16)}…`);
  for (const [k, n] of [...byKind.entries()].sort()) console.log(`  ${k}: ${n}`);
  return 0;
}

function doctor(): number {
  const store = new LedgerStore(HOME);
  const chain = store.verifyChain();
  const cas = store.verifyCas();
  console.log(`ledger 链校验: ${chain.ok ? "通过" : `失败 @seq=${chain.firstBad}(${chain.reason})`}`);
  console.log(`CAS 引用校验: ${cas.ok ? "通过" : `缺失 ${cas.missing.length},损坏 ${cas.corrupted.length}`}`);
  if (store.lastSeq > 0) {
    const { needsRebind } = Kernel.recover(store);
    console.log(`重放恢复: 可重建,待重绑插件 ${needsRebind.length} 个`);
  }
  const ok = chain.ok && cas.ok;
  console.log(ok ? "doctor: 全部通过" : "doctor: 存在问题");
  return ok ? 0 : 1;
}

cmd(process.argv.slice(2)).then((code) => process.exit(code));
