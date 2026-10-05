// samsara CLI —— M0 最小壳(附录 I.1:CLI 是 M0 交付)
// daemon start:进程内自检启动(常驻服务/WS 网关随 M2 车道队列交付)
// doctor:账本哈希链 + CAS 引用完整性校验(对应 samsara doctor 语义)

import { homedir } from "node:os";
import { join } from "node:path";
import { LedgerStore } from "../kernel/ledger.js";
import { Kernel } from "../kernel/kernel.js";
import { Projection } from "../kernel/projection.js";
import { SnapshotStore } from "../kernel/snapshot.js";
import { serviceKey } from "../kernel/types.js";
import type { PluginManifest, PluginModule } from "../kernel/types.js";
import { mockChatPlugin, openAICompatChatPlugin } from "../llm/chat.js";
import { runTask } from "../agent/task.js";
import { calcToolPlugin, fsToolPlugin, skillToolPlugin, toolRegistryPlugin } from "../agent/tools.js";
import { Skills } from "../l2/skills.js";
import { TraceProjection } from "../agent/traces.js";
import { startWebChat } from "../channel/webchat.js";

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
    case "run": return runCmd(rest);
    case "webchat": return webchatCmd(rest);
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
      console.log("samsara (M1) — 内核 + ReAct 回路 + WebChat\n  run \"任务\"               单轮任务(mock 或 OPENAI_API_KEY)\n  webchat [--port=N]         回环 HTTP 渠道(浏览器对话)\n  daemon start|status|stop   运行时自检\n  doctor                     账本与 CAS 完整性校验");
      return 0;
    }
    default: console.error(`未知命令: ${cmdName}(--help 查看用法)`); return 2;
  }
}

async function daemonStart(): Promise<number> {
  const store = new LedgerStore(HOME);
  const projection = Projection.open(HOME, store);
  const snapshots = new SnapshotStore(HOME);
  const { kernel, needsRebind, fromSnapshot, replayedCount } = Kernel.boot(store, snapshots);
  const source = fromSnapshot !== null ? `快照@seq${fromSnapshot} + 重放 ${replayedCount} 条` : `全量重放 ${replayedCount} 条`;
  console.log(`引导完成:账本 seq=${store.lastSeq}(来源:${source}),投影水位=${projection.watermark},待重绑插件 ${needsRebind.length} 个`);
  try {
    kernel.install(SELFTEST_MANIFEST, SELFTEST_MODULE);
    const { activated } = await kernel.activate("selftest@0.1.0");
    const obs = kernel.observable();
    console.log(`自检插件: activated=${activated}, active=${obs.activeIds.join(",") || "(无)"}, services=${obs.services.join(",") || "(无)"}`);
    console.log(`链完整性: ${obs.chainOk ? "通过" : "损坏"},seq=${obs.lastSeq}`);
    const summary = await kernel.dispose("selftest@0.1.0");
    console.log(`自检清理: revert=${summary.reverted.length}, compensate=${summary.compensated.length}, irreversibleSkipped=${summary.irreversibleSkipped.length}`);
    console.log(`投影对账: ${projection.reconcile(store).ok ? "一致" : "漂移"}(ledger/index.sqlite)`);
    const snap = snapshots.maybeAutoCreate(kernel, projection, store);
    if (snap) console.log(`快照: 已生成 snapshot_${snap.seq}(触发规则:条数/每日)`);
    console.log("daemon start: 自检通过(M0 进程内模式)");
    projection.close();
    return 0;
  } catch (err) {
    console.error(`自检失败: ${String(err)}`);
    projection.close();
    return 1;
  }
}

/** samsara run "任务" —— M1 最小任务回路:有 OPENAI_API_KEY 用真模型,否则 mock(明示) */
async function runCmd(args: string[]): Promise<number> {
  const goal = args.filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!goal) { console.error("用法: samsara run \"任务描述\" [--model <id>]"); return 2; }
  const modelFlag = args.find((a) => a.startsWith("--model"));
  const model = modelFlag?.split("=")[1] ?? modelFlag?.split(" ")[1];

  const store = new LedgerStore(HOME);
  const projection = Projection.open(HOME, store);
  const snapshots = new SnapshotStore(HOME);
  const { kernel } = Kernel.boot(store, snapshots);

  const useMock = !process.env.OPENAI_API_KEY;
  const provider = useMock
    ? mockChatPlugin(() => `[mock-1] ${goal}(设置 OPENAI_API_KEY 使用真实模型)`)
    : openAICompatChatPlugin({
        ...(process.env.OPENAI_BASE_URL !== undefined ? { baseUrl: process.env.OPENAI_BASE_URL } : {}),
        model: model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      });
  const providerId = useMock ? "llm-mock@1.0.0" : "llm-openai-compat@1.0.0";
  kernel.install(provider.manifest, provider.module);
  await kernel.activate(providerId);

  const r = await runTask(kernel, {
    goal, sessionKey: "cli:dm:owner", runtimePluginId: providerId,
    ...(model !== undefined ? { model } : {}),
    actor: { kind: "human", id: "cli-owner", trust: "owner" },
  });
  console.log(`[${r.outcome}] ${r.reply ?? r.error}`);
  console.log(`trace=${r.traceId} bundle=${r.bundleCas.slice(7, 19)}… 耗时=${r.durationMs}ms 账本 seq=${store.lastSeq}`);
  await kernel.dispose(providerId);
  projection.close();
  return r.outcome === "success" ? 0 : 1;
}

/** samsara webchat —— M1 WebChat 渠道:回环 HTTP 服务,浏览器对话 */
async function webchatCmd(args: string[]): Promise<number> {
  const portFlag = args.find((a) => a.startsWith("--port"));
  const port = portFlag !== undefined ? Number(portFlag.split("=")[1] ?? portFlag.split(" ")[1] ?? 18790) : 18790;

  const store = new LedgerStore(HOME);
  const projection = Projection.open(HOME, store);
  const snapshots = new SnapshotStore(HOME);
  const { kernel, needsRebind } = Kernel.boot(store, snapshots);
  const traces = await TraceProjection.open(HOME, store);
  const skills = new Skills(kernel, projection);

  // 运行时装配:LLM(mock 或 OPENAI_API_KEY)+ 工具注册表 + 工具 + 技能沉淀
  const useMock = !process.env.OPENAI_API_KEY;
  const provider = useMock
    ? mockChatPlugin((req) => `收到:${req.messages[req.messages.length - 1]?.content ?? ""}(mock-1;设 OPENAI_API_KEY 用真实模型)`)
    : openAICompatChatPlugin({
        ...(process.env.OPENAI_BASE_URL !== undefined ? { baseUrl: process.env.OPENAI_BASE_URL } : {}),
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      });
  const providerId = useMock ? "llm-mock@1.0.0" : "llm-openai-compat@1.0.0";
  kernel.install(provider.manifest, provider.module);
  const reg = toolRegistryPlugin(); kernel.install(reg.manifest, reg.module);
  const calc = calcToolPlugin(); kernel.install(calc.manifest, calc.module);
  const workDir = join(HOME, "workspace");
  const fsT = fsToolPlugin(workDir); kernel.install(fsT.manifest, fsT.module);
  const sk = skillToolPlugin(skills); kernel.install(sk.manifest, sk.module);
  await kernel.activate("tool-registry@1.0.0");
  await kernel.activate(providerId);
  await kernel.activate("tool-calc@1.0.0");
  await kernel.activate("tool-fs@1.0.0");
  await kernel.activate("tool-skill@1.0.0");
  for (const id of needsRebind) console.log(`提示:插件 ${id} 为恢复态,如需其服务请重绑`);

  const server = await startWebChat(kernel, {
    port, runtimePluginId: providerId, skills,
    systemPrompt: "你是 Samsara,一个自托管智能体;回答简洁;可用工具完成任务。",
  });
  console.log(`WebChat: http://127.0.0.1:${server.port}(Ctrl-C 退出)`);
  const llmDesc = useMock ? "mock" : `${process.env.OPENAI_MODEL ?? "gpt-4o-mini"} @ ${new URL(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").host}`;
  console.log(`运行时: 账本 seq=${store.lastSeq} | LLM=${llmDesc} | 工具=calc/read_file/write_file/save_skill | 轨迹投影=duckdb/parquet`);

  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true;
    console.log("\n关闭中:投影对账…");
    await server.close();
    await traces.close();
    projection.close();
    console.log(`投影对账: ${projection.reconcile(store).ok ? "一致" : "漂移"};再见。`);
    process.exit(0);
  };
  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
  // 常驻:本命令永不返回,关停经 SIGINT → shutdown → process.exit
  return await new Promise<never>(() => {});
}

function daemonStatus(): number {
  const store = new LedgerStore(HOME);
  const projection = Projection.open(HOME, store);
  const byKind = new Map<string, number>();
  for (const e of store.all) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  console.log(`账本: seq=${store.lastSeq}, head=${store.headHash.slice(0, 16)}…`);
  for (const [k, n] of [...byKind.entries()].sort()) console.log(`  ${k}: ${n}`);
  console.log(`投影(index.sqlite): 水位=${projection.watermark}`);
  for (const [t, n] of Object.entries(projection.stats()).sort()) {
    if (n > 0) console.log(`  ${t}: ${n}`);
  }
  projection.close();
  return 0;
}

function doctor(): number {
  const store = new LedgerStore(HOME);
  const chain = store.verifyChain();
  const cas = store.verifyCas();
  console.log(`ledger 链校验: ${chain.ok ? "通过" : `失败 @seq=${chain.firstBad}(${chain.reason})`}`);
  console.log(`CAS 引用校验: ${cas.ok ? "通过" : `缺失 ${cas.missing.length},损坏 ${cas.corrupted.length}`}`);
  let ok = chain.ok && cas.ok;
  if (store.lastSeq > 0) {
    const snapshots = new SnapshotStore(HOME);
    const boot = Kernel.boot(store, snapshots);
    console.log(`重放恢复: 可重建(${boot.fromSnapshot !== null ? `快照@${boot.fromSnapshot}+重放 ${boot.replayedCount} 条` : `全量重放 ${boot.replayedCount} 条`}),待重绑插件 ${boot.needsRebind.length} 个`);
    const snap = snapshots.latest(store.lastSeq);
    if (snap) console.log(`快照: 最近 snapshot_${snap.seq}(${snap.ts})`);
    const projection = Projection.open(HOME, store);
    const rec = projection.reconcile(store);
    console.log(`投影对账: ${rec.ok ? `一致(水位 ${rec.watermark})` : `漂移(投影 ${rec.watermark} ≠ 账本 ${rec.ledgerSeq})`}`);
    ok = ok && rec.ok;
    projection.close();
  }
  console.log(ok ? "doctor: 全部通过" : "doctor: 存在问题");
  return ok ? 0 : 1;
}

cmd(process.argv.slice(2)).then((code) => process.exit(code));
