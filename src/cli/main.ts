// samsara CLI —— M0 最小壳(附录 I.1:CLI 是 M0 交付)
// daemon start:进程内自检启动(常驻服务/WS 网关随 M2 车道队列交付)
// doctor:账本哈希链 + CAS 引用完整性校验(对应 samsara doctor 语义)

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { LedgerStore } from "../kernel/ledger.js";
import { Kernel } from "../kernel/kernel.js";
import { Projection } from "../kernel/projection.js";
import { SnapshotStore } from "../kernel/snapshot.js";
import { serviceKey } from "../kernel/types.js";
import type { PluginManifest, PluginModule } from "../kernel/types.js";
import { mockChatPlugin, openAICompatChatPlugin } from "../llm/chat.js";
import { dashScopePlugin, mockEmbeddingPlugin } from "../llm/embedding.js";
import { runTask, CHANNEL_TASK_MAX_STEPS } from "../agent/task.js";
import { Spawner } from "../agent/spawner.js";
import { spawnToolPlugin } from "../agent/spawn-tool.js";
import { WorkspaceCapture } from "../kernel/workspace.js";
import type { WorkspaceView } from "../agent/tools.js";
import { calcToolPlugin, fsToolPlugin, skillToolPlugin, toolRegistryPlugin } from "../agent/tools.js";
import { clockToolPlugin, webSearchToolPlugin } from "../agent/tools-web.js";
import { Skills } from "../l2/skills.js";
import { Memory, MEMORY_DISTILL_IDLE_MIN, MEMORY_DISTILL_CHECK_SEC } from "../l2/memory.js";
import { TraceProjection } from "../agent/traces.js";
import { startWebChat } from "../channel/webchat.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { WeChatChannel, loadWeChatCredential } from "../channel/wechat-ilink.js";
import { deriveTrust, grantTrust, revokeTrust, loadTrustConfig, DEFAULT_TRUST } from "../channel/trust.js";

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
    case "job": return jobCmd(rest);
    case "wechat": return wechatCmd(rest);
    case "memory": return memoryCmd(rest);
    case "trust": return trustCmd(rest);
    case "models": return modelsCmd(rest);
    case "workspace": return workspaceCmd(rest);
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
      console.log("samsara (M2) — 内核 + ReAct 回路 + WebChat + 三层记忆\n  run \"任务\"               单轮任务(mock 或 OPENAI_API_KEY)\n  webchat [--port=N]         回环 HTTP 渠道(浏览器对话)\n  job add|ls|…               调度任务管理\n  wechat bind|status|unbind  微信 iLink 渠道管理\n  memory ls|forget|rollback  三层记忆管理(§6.5)\n  trust ls|grant|revoke      渠道对端信任映射(§4.4)\n  models ls [--refresh]      模型注册表(附录 E.1)\n  daemon start|status|stop   运行时自检\n  doctor                     账本与 CAS 完整性校验");
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

/** 幂等启动:重启场景下插件已在账本(恢复态 active、服务待重建)——
 *  重绑模块并 suspend→activate 重跑 start,服务/工具注册随之重建;
 *  注册类效应会新增条目(重启即重注册,账本事实),卸载时逆操作平衡。 */
async function ensureActive(kernel: Kernel, manifest: PluginManifest, module: PluginModule): Promise<string> {
  const id = `${manifest.name}@${manifest.version}`;
  const state = kernel.pluginState(id);
  if (state === undefined) kernel.install(manifest, module);
  else kernel.bindModule(id, module);
  if (kernel.pluginState(id) === "active") await kernel.suspend(id);
  await kernel.activate(id);
  return id;
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
  const providerId = await ensureActive(kernel, provider.manifest, provider.module);

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

/** samsara wechat bind|status|unbind —— 微信 iLink 渠道管理(回环 HTTP) */
async function wechatCmd(args: string[]): Promise<number> {
  const [sub] = args;
  const port = 18790;
  const daemonUrl = `http://127.0.0.1:${port}`;
  switch (sub) {
    case "bind": {
      console.log("发起微信绑定…");
      const start = await (await fetch(`${daemonUrl}/wechat/bind/start`)).json() as { ok: boolean; qrcode?: string; qr_data_url?: string; error?: string };
      if (!start.ok) { console.error(`绑定发起失败: ${start.error}`); return 1; }
      console.log("\n请用微信扫描 WebChat 页面上的二维码:");
      console.log(`  浏览器打开 http://127.0.0.1:${port} → 点击"绑定微信"`);
      console.log(`\n绑定令牌: ${start.qrcode?.slice(0, 16)}…`);
      console.log("等待微信扫码确认(每 3 秒检查,Ctrl-C 取消)…");
      for (let i = 0; i < 120; i++) {
        await new Promise((done) => setTimeout(done, 3_000));
        try {
          const poll = await (await fetch(`${daemonUrl}/wechat/bind/poll/${encodeURIComponent(start.qrcode!)}`, { signal: AbortSignal.timeout(5_000) })).json() as { ok: boolean; status?: string; message?: string };
          if (poll.status === "confirmed") {
            console.log(`\n✓ ${poll.message}`);
            console.log("  重启守护进程(samsara webchat)后微信消息通道生效。");
            return 0;
          }
          if (poll.status === "scaned") { console.log("  已扫码,等待确认…"); continue; }
          if (poll.status === "expired") { console.error("\n✗ 二维码已过期,请重新执行 samsara wechat bind"); return 1; }
        } catch { /* 网络抖动继续轮询 */ }
      }
      console.error("超时,请重新执行 samsara wechat bind");
      return 1;
    }
    case "status": {
      try {
        const r = await (await fetch(`${daemonUrl}/wechat/status`)).json() as { ok: boolean; bound: boolean; bound_at?: string; polling?: boolean };
        console.log(`绑定: ${r.bound ? "✓" : "✗(未绑定)"}${r.bound_at !== undefined ? ` (${r.bound_at.slice(0, 19)})` : ""}`);
        console.log(`消息轮询: ${r.polling === true ? "运行中" : "未启动"}`);
        if (!r.bound) console.log("提示: 执行 samsara wechat bind 发起绑定");
      } catch { console.log("守护进程未运行(本地读凭据)"); const cred = loadWeChatCredential(); console.log(`绑定: ${cred !== null && cred.bot_token !== "" ? "✓" : "✗"}`); }
      return 0;
    }
    case "unbind": {
      await fetch(`${daemonUrl}/wechat/unbind`).catch(() => undefined);
      console.log("✓ 已解绑(如守护进程在线则同步生效)");
      return 0;
    }
    default: console.error("用法: samsara wechat bind|status|unbind"); return 2;
  }
}

/** samsara workspace ls|commit|discard <sessionKey> —— 会话工作区写捕获(K.2/G.7,M3-S3)
 *  本地直连:重绑捕获层(sidecar 在盘)后操作;commit=差异入 CAS, discard=整体还原 */
async function workspaceCmd(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const sk = rest.find((a) => !a.startsWith("--"));
  if (sub !== "ls" && (sk === undefined || sk === "")) {
    console.error("用法: samsara workspace ls|commit|discard <sessionKey>");
    return 2;
  }
  const store = new LedgerStore(HOME);
  const projection = Projection.open(HOME, store);
  const { kernel } = Kernel.boot(store, new SnapshotStore(HOME));
  const actor = { kind: "human" as const, id: "cli-owner", trust: "owner" as const };
  const traceId = rest.find((a) => a.startsWith("--trace="))?.split("=")[1];
  try {
    const dir = join(HOME, "workspace", (sk ?? "").replace(/[^a-z0-9]/gi, "_").slice(0, 60));
    const sidecar = join(dir, "..", ".capture", (sk ?? "").replace(/[^a-z0-9]/gi, "_"));
    if (!existsSync(dir)) { console.log(`无此会话工作区: ${sk}`); return 1; }
    // 重绑(或新建)捕获层——sidecar 在盘即原件可还原
    const cap = new WorkspaceCapture(kernel, "tool-fs@1.0.0", sk ?? "", dir, { rebindArgs: { root: dir, sidecar } });
    switch (sub) {
      case "ls": {
        console.log(`会话工作区 ${sk}(root=${dir}):`);
        for (const f of cap.changedFiles()) console.log(`  M ${f}`);
        if (cap.changedFiles().length === 0) console.log("  (无捕获改动)");
        return 0;
      }
      case "commit": {
        const r = cap.commit(actor, traceId);
        console.log(`提交 ✓ ${r.ops} 项改动 → CAS ${r.cas.slice(7, 23)}…(环境保持;workspace.bind 入账)`);
        return 0;
      }
      case "discard": {
        const r = await cap.discard(actor);
        console.log(`丢弃 ✓ 还原 ${r.reverted.length} 效应(git status 级干净)`);
        return 0;
      }
      default:
        console.error("用法: samsara workspace ls|commit|discard <sessionKey> [--trace=<id>]");
        return 2;
    }
  } catch (err) {
    console.error(`workspace ${sub ?? ""} 失败: ${String(err)}`);
    return 1;
  } finally {
    projection.close();
  }
}

/** samsara models ls [--refresh] —— 模型注册表(附录 E.1,接口 §3.7 registry.refresh 的 CLI 形态)
 *  发现走厂商清单接口(密钥仅环境变量,永不出现在输出/缓存);价格=版本化资产(用户表>种子) */
async function modelsCmd(args: string[]): Promise<number> {
  const { ModelRegistry } = await import("../llm/registry.js");
  const registry = new ModelRegistry();
  if (args.includes("--refresh")) {
    const cache = await registry.refresh();
    console.log(`已刷新: ${cache.models.length} 个模型(${configuredProvidersCount()} 个提供者;密钥不落盘)`);
  }
  const models = registry.list();
  if (models.length === 0) {
    console.log("(注册表空:执行 samsara models ls --refresh 发现;需 OPENAI_API_KEY/DASHSCOPE_API_KEY)");
    return 0;
  }
  const resolved = registry.resolve(args.find((a) => !a.startsWith("--")));
  console.log(`模型注册表(${models.length};刷新于 ${(registry.load().refreshed_at || "未刷新").slice(0, 19).replace("T", " ")}):`);
  for (const m of models) {
    const price = m.price !== undefined && (m.price.input_cents_per_mtok !== null || m.price.output_cents_per_mtok !== null)
      ? `$${m.price.input_cents_per_mtok ?? "?"}/${m.price.output_cents_per_mtok ?? "?"} 每百万token`
      : "价格未知";
    const def = resolved !== undefined && resolved.id === m.id ? " ←默认" : "";
    console.log(`  ${m.provider}/${m.id}${m.context_length !== undefined ? ` (ctx ${m.context_length})` : ""} ${price}${def}`);
  }
  return 0;
}

function configuredProvidersCount(): number {
  // 计数不触密钥内容
  let n = 0;
  if ((process.env.OPENAI_API_KEY ?? "") !== "") n += 1;
  if ((process.env.DASHSCOPE_API_KEY ?? "") !== "") n += 1;
  return n;
}

/** samsara trust ls|grant|revoke —— 渠道对端信任映射(§4.4/K.4,~/.samsara/trust.json 0600)
 *  映射变更 = R2 级操作:仅 owner 本地进程可写(文件属主权限承载);推导来源随 session.open 入账 */
async function trustCmd(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const positional = rest.filter((a) => !a.startsWith("--"));
  try {
    switch (sub) {
      case "ls": {
        const cfg = loadTrustConfig();
        const channels = Object.keys(cfg.channels);
        console.log(`信任映射(${channels.length} 渠道;代码默认: ${Object.entries(DEFAULT_TRUST).map(([c, t]) => `${c}=${t}`).join(", ")},未知渠道=untrusted)`);
        let n = 0;
        for (const [ch, conf] of Object.entries(cfg.channels)) {
          if (conf.default_trust !== undefined) console.log(`  ${ch}: 默认 ${conf.default_trust}`);
          for (const g of conf.allowlist) {
            n += 1;
            console.log(`  ${ch}  ${g.peer_id.slice(0, 20)}  → ${g.trust}  (${g.granted_at.slice(0, 19)}${g.note !== undefined ? ` ${g.note}` : ""})`);
          }
        }
        if (n === 0) console.log("  (allowlist 空:微信绑定者由守护启动时自动授予 owner)");
        return 0;
      }
      case "grant": {
        const [channel, peerId, trust] = positional;
        if (channel === undefined || peerId === undefined || trust === undefined) {
          console.error("用法: samsara trust grant <channel> <peer_id> <owner|known|guest|untrusted> [--note=备注]");
          return 2;
        }
        grantTrust(channel, peerId, trust as "owner", rest.find((a) => a.startsWith("--note="))?.split("=").slice(1).join("="));
        console.log(`已授予 ✓ ${channel}:${peerId.slice(0, 20)} → ${trust}`);
        return 0;
      }
      case "revoke": {
        const [channel, peerId] = positional;
        if (channel === undefined || peerId === undefined) { console.error("用法: samsara trust revoke <channel> <peer_id>"); return 2; }
        revokeTrust(channel, peerId);
        console.log(`已撤销 ✓ ${channel}:${peerId.slice(0, 20)}(回退渠道默认)`);
        return 0;
      }
      default:
        console.error("用法: samsara trust ls|grant|revoke(§4.4 渠道对端信任派生)");
        return 2;
    }
  } catch (err) {
    console.error(`trust ${sub ?? ""} 失败: ${String(err)}`);
    return 1;
  }
}

/** samsara memory ls|forget|rollback —— 记忆管理(§6.5/接口 §3.2 memory.list/memory.forget 的 CLI 形态)
 *  本地直连账本(守护在线时记忆写入也是安全的:同库 SQLite WAL;但避免与蒸馏器并发写,建议守护停止时操作) */
async function memoryCmd(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const flag = (name: string): string | undefined => {
    const f = rest.find((a) => a.startsWith(`--${name}=`));
    return f !== undefined ? f.split("=").slice(1).join("=") : undefined;
  };
  const store = new LedgerStore(HOME);
  const projection = Projection.open(HOME, store);
  const { kernel } = Kernel.boot(store, new SnapshotStore(HOME));
  const memory = new Memory(kernel, projection);
  const actor = { kind: "human" as const, id: "cli-owner", trust: "owner" as const };
  try {
    switch (sub) {
      case "ls": {
        const sk = flag("session") ?? "webchat:dm:browser";
        const layer = flag("layer");
        const wantLayer = layer === "episodic" || layer === "semantic" ? layer : undefined;
        const statuses = flag("all") === "1" ? ["active", "forgotten"] : ["active"];
        const rows = statuses.flatMap((st) => memory.list(sk, wantLayer, st));
        console.log(`会话 ${sk}: ${rows.length} 条`);
        for (const m of rows) {
          console.log(`${m.cas.slice(7, 15)}  [${m.layer}/${m.status}]${m.createdTs !== undefined ? ` ${m.createdTs.slice(0, 16).replace("T", " ")}` : ""}`);
          console.log(`  ${m.text.replace(/\s+/g, " ").slice(0, 90)}`);
        }
        return 0;
      }
      case "forget": {
        const target = rest.find((a) => !a.startsWith("--"));
        if (target === undefined) { console.error('用法: samsara memory forget <cas|sha256前缀> [--session=key]'); return 2; }
        const sk = flag("session") ?? "webchat:dm:browser";
        const hit = memory.list(sk).find((m) => m.cas === target || m.cas.startsWith(`sha256:${target}`) || m.cas.includes(target));
        if (hit === undefined) { console.error(`未找到(会话 ${sk}): ${target}`); return 1; }
        const n = memory.forget(sk, actor, { cas: hit.cas });
        console.log(`遗忘 ✓ ${hit.cas.slice(7, 15)}(${n} 条;托管期回滚: memory.rollback)`);
        return 0;
      }
      case "rollback": {
        const target = rest.find((a) => !a.startsWith("--"));
        if (target === undefined) { console.error("用法: samsara memory rollback <cas|sha256前缀> [--session=key]"); return 2; }
        const sk = flag("session") ?? "webchat:dm:browser";
        const hit = memory.list(sk, undefined, "forgotten").find((m) => m.cas === target || m.cas.startsWith(`sha256:${target}`) || m.cas.includes(target));
        if (hit === undefined) { console.error(`未找到 forgotten 态记忆(会话 ${sk}): ${target}`); return 1; }
        memory.rollbackForget(hit.cas, actor);
        console.log(`回滚遗忘 ✓ ${hit.cas.slice(7, 15)} → active`);
        return 0;
      }
      default:
        console.error("用法: samsara memory ls|forget|rollback [--session=<sessionKey>] [--layer=episodic|semantic]");
        return 2;
    }
  } catch (err) {
    console.error(`memory ${sub ?? ""} 失败: ${String(err)}`);
    return 1;
  } finally {
    projection.close();
  }
}

/** samsara job add|ls|pause|resume|delete|renew —— 调度任务管理(§C.2/接口 §3.5)
 *  单写入者纪律:守护进程在线时经回环 HTTP 管理面操作;停止时本地直连账本 */
async function jobCmd(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const flag = (name: string): string | undefined => {
    const f = rest.find((a) => a.startsWith(`--${name}=`));
    return f !== undefined ? f.split("=").slice(1).join("=") : undefined;
  };
  const daemonAlive = await (async () => {
    try { const r = await fetch(`http://127.0.0.1:${Number(flag("port") ?? 18790)}/health`, { signal: AbortSignal.timeout(1500) }); return r.ok; }
    catch { return false; }
  })();
  const jobsReq = async (body: Record<string, unknown>): Promise<unknown> => {
    const port = Number(flag("port") ?? 18790);
    const r = await fetch(`http://127.0.0.1:${port}/jobs`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json() as { ok: boolean; result?: unknown; error?: string };
    if (!j.ok) throw new Error(j.error ?? "管理面拒绝");
    return j.result;
  };

  try {
    switch (sub) {
      case "add": {
        const goal = rest.filter((a) => !a.startsWith("--")).join(" ").trim();
        if (!goal) { console.error('用法: samsara job add "任务描述" [--cron="0 9 * * 5"] [--tz=Asia/Shanghai] [--misfire=skip|runOnce|catchUp]'); return 2; }
        if (daemonAlive) {
          const job = await jobsReq({ action: "add", goal, ...(flag("cron") !== undefined ? { cron: flag("cron") } : {}), ...(flag("tz") !== undefined ? { timezone: flag("tz") } : {}), ...(flag("misfire") !== undefined ? { misfire: flag("misfire") } : {}) }) as { id: string; schedule_cron: string; timezone: string; next_fire_ts: string | null };
          console.log(`已创建(经守护进程): ${job.id}`);
          console.log(`  cron=${job.schedule_cron} tz=${job.timezone} 下次=${job.next_fire_ts ?? "-"}`);
          return 0;
        }
        // 本地模式(守护停止):自然语言编译需真实模型,否则要求 --cron
        const store = new LedgerStore(HOME);
        const projection = Projection.open(HOME, store);
        const { kernel } = Kernel.boot(store, new SnapshotStore(HOME));
        const scheduler = new Scheduler(kernel, projection, async () => { throw new Error("管理操作不执行任务"); });
        let cron = flag("cron");
        let canonicalGoal = goal;
        if (cron === undefined) {
          if (!process.env.OPENAI_API_KEY) { console.error("守护未运行且无 OPENAI_API_KEY:自然语言编译不可用,请用 --cron 或先启动守护(samsara webchat)"); return 2; }
          const { openAICompatChatPlugin } = await import("../llm/chat.js");
          const prov = openAICompatChatPlugin({
            ...(process.env.OPENAI_BASE_URL !== undefined ? { baseUrl: process.env.OPENAI_BASE_URL } : {}),
            model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
          });
          kernel.install(prov.manifest, prov.module);
          await kernel.activate("llm-openai-compat@1.0.0");
          const svc = kernel.service((await import("../llm/chat.js")).CHAT_SERVICE);
          const compiled = await (await import("../scheduler/scheduler.js")).compileSchedule(
            async (prompt) => (await svc.complete({ messages: [{ role: "user", content: prompt }] })).content,
            goal, flag("tz") ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
          cron = compiled.cron; canonicalGoal = compiled.goal;
        }
        const job = scheduler.createJob({
          goal: canonicalGoal, schedule: cron,
          ...(flag("tz") !== undefined ? { timezone: flag("tz")! } : {}),
          ...(flag("misfire") !== undefined ? { misfire: flag("misfire")! as "skip" | "runOnce" | "catchUp" } : {}),
        });
        console.log(`已创建(本地): ${job.id}`);
        console.log(`  cron=${job.schedule_cron} tz=${job.timezone} 下次=${job.next_fire_ts ?? "-"}(守护启动后生效)`);
        projection.close();
        return 0;
      }
      case "ls": {
        const withCost = rest.includes("--cost");
        const list = (daemonAlive
          ? await jobsReq({ action: "list" })
          : await withLocalScheduler(async (sch) => sch.list())) as Array<{ id: string; goal: string; schedule_cron: string; timezone: string; state: string; next_fire_ts: string | null; last_fired_ts: string | null; misfire: string }>;
        if (list.length === 0) { console.log("(无任务)"); return 0; }
        for (const j of list) {
          console.log(`${j.id}  [${j.state}]`);
          console.log(`  ${j.goal.slice(0, 50)}`);
          console.log(`  cron=${j.schedule_cron} tz=${j.timezone} misfire=${j.misfire} 上次=${j.last_fired_ts?.slice(0, 16).replace("T", " ") ?? "-"} 下次=${j.next_fire_ts?.slice(0, 16).replace("T", " ") ?? "-"}`);
        }
        if (withCost) {
          if (daemonAlive) { console.log("\n(--cost 明细需守护停止时本地查询;任务级 token 统计依赖 Parquet)"); }
          else {
            const { DuckDBInstance } = await import("@duckdb/node-api");
            const inst = await DuckDBInstance.create(":memory:");
            const con = await inst.connect();
            const parquet = join(HOME, "traces", "*.traces.parquet");
            if (existsSync(join(HOME, "traces"))) {
              const rows = await con.runAndReadAll(
                `SELECT session_key, count(*) AS fires, sum(prompt_tokens + completion_tokens) AS tokens FROM read_parquet('${parquet.replace(/'/g, "''")}') WHERE session_key LIKE 'job:%' GROUP BY session_key ORDER BY fires DESC`,
              );
              const costRows = rows.getRowObjects() as unknown as { session_key: string; fires: bigint; tokens: bigint }[];
              console.log("\n成本(--cost,来自 Parquet):");
              for (const c of costRows) console.log(`  ${c.session_key}: 触发 ${c.fires} 次,tokens ${c.tokens}`);
              if (costRows.length === 0) console.log("  (尚无任务触发记录)");
            }
          }
        }
        return 0;
      }
      case "pause": case "resume": case "delete": {
        const id = rest.find((a) => !a.startsWith("--"));
        if (id === undefined) { console.error(`用法: samsara job ${sub} <job_id>`); return 2; }
        const job = daemonAlive
          ? await jobsReq({ action: sub, id }) as { id: string; state: string }
          : await withLocalScheduler((sch) => (sub === "pause" ? sch.pause(id) : sub === "resume" ? sch.resume(id) : sch.remove(id)));
        console.log(`${sub} ✓ ${job.id} state=${job.state}`);
        return 0;
      }
      case "renew": {
        const id = rest.find((a) => !a.startsWith("--"));
        if (id === undefined) { console.error("用法: samsara job renew <job_id> [--days=30]"); return 2; }
        const days = flag("days") !== undefined ? Number(flag("days")) : 30;
        const job = daemonAlive
          ? await jobsReq({ action: "renew", id, days }) as { id: string; expires_at: string | null }
          : await withLocalScheduler((sch) => sch.renew(id, days));
        console.log(`续期 ✓ ${job.id} expires_at=${job.expires_at}`);
        return 0;
      }
      default:
        console.error("用法: samsara job add|ls|pause|resume|delete|renew");
        return 2;
    }
  } catch (err) {
    console.error(`job ${sub ?? ""} 失败: ${String(err)}`);
    return 1;
  }

  /** 本地模式:守护停止时直连账本执行管理操作 */
  async function withLocalScheduler<T>(fn: (sch: Scheduler) => T | Promise<T>): Promise<T> {
    const store = new LedgerStore(HOME);
    const projection = Projection.open(HOME, store);
    const { kernel } = Kernel.boot(store, new SnapshotStore(HOME));
    const scheduler = new Scheduler(kernel, projection, async () => { throw new Error("管理操作不执行任务"); });
    const out = await fn(scheduler);
    projection.close();
    return out;
  }
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
  const reg = toolRegistryPlugin();
  const providerId0 = useMock ? "llm-mock@1.0.0" : "llm-openai-compat@1.0.0"; void providerId0;
  await ensureActive(kernel, reg.manifest, reg.module); // 注册表先就绪(工具反应式接入)
  const providerId = await ensureActive(kernel, provider.manifest, provider.module);

  // 检索插件(M2-S3 §6.5):有 DASHSCOPE_API_KEY 用 DashScope,否则 mock 明示降级
  const useMockEmbed = !process.env.DASHSCOPE_API_KEY;
  const retrieval = useMockEmbed ? mockEmbeddingPlugin() : dashScopePlugin();
  await ensureActive(kernel, retrieval.manifest, retrieval.module);
  const memory = new Memory(kernel, projection);
  if (!useMockEmbed) console.log("记忆层: DashScope 检索已接入(embedding+rerank)");
  else console.log("记忆层: DASHSCOPE_API_KEY 未配置,检索用 mock 向量(时序兜底可用;source providers.env 后重启)");
  const workDir = join(HOME, "workspace");
  // M3-S3 工作区写捕获(K.2):per-session COW 覆盖层,单效应承载,commit/discard 可逆
  const captures = new Map<string, WorkspaceCapture>();
  const sessionDir = (sk: string) => join(workDir, sk.replace(/[^a-z0-9]/gi, "_").slice(0, 60));
  const workspaceFor = (sk: string, create: boolean): WorkspaceView | undefined => {
    const existing = captures.get(sk);
    if (existing !== undefined) return existing;
    if (create) {
      const c = new WorkspaceCapture(kernel, "tool-fs@1.0.0", sk, sessionDir(sk));
      captures.set(sk, c);
      return c;
    }
    // 历史会话(重启后):目录在则只读视图(写需重绑捕获层——workspace CLI 会做)
    if (existsSync(sessionDir(sk))) {
      const root = sessionDir(sk);
      return {
        root,
        write: () => { throw new Error("只读视图(重启后经 workspace 命令重绑捕获层)"); },
        read: (rel) => { try { return readFileSync(join(root, rel), "utf-8"); } catch { return undefined; } },
      };
    }
    return undefined;
  };
  const calc = calcToolPlugin();
  const fsT = fsToolPlugin(workDir, { workspaceFor });
  const sk = skillToolPlugin(skills);
  const clk = clockToolPlugin();
  const ws = webSearchToolPlugin();
  await ensureActive(kernel, calc.manifest, calc.module);
  await ensureActive(kernel, fsT.manifest, fsT.module);
  await ensureActive(kernel, sk.manifest, sk.module);
  await ensureActive(kernel, clk.manifest, clk.module);
  await ensureActive(kernel, ws.manifest, ws.module);
  // M3 派生器(§5.4):spawn_agent 工具可用;深度软限外默认无人批准(拒绝+日志,审批 UI 随控制面)
  const spawner = new Spawner(kernel, runTask, { runtimePluginId: providerId, ...(skills !== undefined ? { skills } : {}), memory });
  const sp = spawnToolPlugin(spawner);
  await ensureActive(kernel, sp.manifest, sp.module);
  for (const id of needsRebind) console.log(`提示:插件 ${id} 为恢复态,如需其服务请重绑`);
  const snap = snapshots.maybeAutoCreate(kernel, projection, store); // §3.2 每日快照(引导时检查)
  if (snap) console.log(`快照: 已生成 snapshot_${snap.seq}(每日触发)`);

  // 调度器(§C.1):到点发事件 → 标准 runTask;通知 M2 最小形态=守护日志
  // 信任联动(§C.4):触发前重校验创建者当前信任级(微信/webchat 经 trust.json 派生),降级自动暂停+告警
  const scheduler = new Scheduler(kernel, projection, (goal, sessionKey, actor) =>
    runTask(kernel, {
      goal, sessionKey, runtimePluginId: providerId,
      ...(skills !== undefined ? { skills } : {}),
      memory, spawner, maxSteps: CHANNEL_TASK_MAX_STEPS,
      actor, systemPrompt: "你是 Samsara 定时任务的执行体;直接产出任务结果,简洁完成。",
    }), {
    // 通知 M2 最小形态:守护日志(smart 的注意力路由器裁决属 M4;渠道投递随 M2 切片 4)
    notifier: (n) => console.log(`[job ${n.job.id.slice(4, 12)} 触发 ${n.dueAt.slice(11, 16)}] ${n.outcome}: ${(n.reply ?? n.error ?? "").slice(0, 120).replace(/\n/g, " ")}`),
    trustCheck: (job) => {
      if (job.creator?.channel === undefined || job.creator?.id === undefined) return undefined;
      return deriveTrust(job.creator.channel, job.creator.id).trust;
    },
  });
  const stopTick = scheduler.startLoop();

  // 微信 iLink 渠道(如已绑定则启动消息长轮询;§4.1/§4.2 纯出站)
  const wechatCred = loadWeChatCredential();
  const wechatChannel = new WeChatChannel({
    runner: (goal, sessionKey, actor, channelCtx) => {
      // 会话开启记派生来源(§4.4/K.4 审计:trust_source=allowlist|default;修复微信会话从未
      // openSession 的缺口——此前微信端 save_skill 会"会话未开启"报错)
      skills.openSession(sessionKey, actor, ...(channelCtx?.trustSource !== undefined ? [{ trustSource: channelCtx.trustSource }] : []));
      return runTask(kernel, {
        goal, sessionKey, runtimePluginId: providerId,
        ...(skills !== undefined ? { skills } : {}),
        memory, spawner, maxSteps: CHANNEL_TASK_MAX_STEPS,
        actor,
        systemPrompt: "你是 Samsara,一个自托管智能体;回答简洁;可用工具完成任务。多主题或可拆分的调研任务,优先用 spawn_agent 工具分头调研再汇总:子任务传 max_steps=6-8(调研类子任务需要足够步数);若子任务未完成,基于已有检索直接汇总,不要全部重做。",
      });
    },
    onTokenExpired: () => console.log("[wechat] Token 失效(errcode -14),渠道已暂停;执行 samsara wechat bind 重新绑定"),
    store: kernel.store, // 媒体入 CAS(§4.6 落地注:媒体经 CAS 引用)
  });
  if (wechatCred !== null && wechatCred.bot_token !== "") {
    wechatChannel.start(wechatCred);
    console.log(`微信渠道: 已绑定(${(wechatCred.bound_at ?? "?").slice(0, 19)}),消息长轮询启动`);
  }

  // 情景蒸馏器(§6.5 会话收尾):空闲超 memory_distill_idle_min 的会话提炼入情景记忆;
  // LLM 失败保留缓冲下轮重试。守护关停时对所有待提炼会话补跑(进程内缓冲,不跑即丢)。
  const distillIdleMs = MEMORY_DISTILL_IDLE_MIN * 60_000;
  const distillIdle = setInterval(() => {
    for (const p of memory.pendingSessions()) {
      if (p.idleMs < distillIdleMs) continue;
      memory.distillPending(p.sessionKey)
        .then((n) => console.log(`[memory] 会话 ${p.sessionKey} 空闲提炼: +${n} 条情景记忆`))
        .catch((err) => console.log(`[memory] 提炼失败(缓冲保留): ${String(err).slice(0, 120)}`));
    }
  }, MEMORY_DISTILL_CHECK_SEC * 1000);
  distillIdle.unref();

  const server = await startWebChat(kernel, {
    port, runtimePluginId: providerId, skills, scheduler, wechat: wechatChannel, memory, spawner,
    systemPrompt: "你是 Samsara,一个自托管智能体;回答简洁;可用工具完成任务。技能正文不在工作区文件里——需要技能详细步骤时用 read_skill 工具,不要用 read_file 猜路径。多主题或可拆分的调研任务,优先用 spawn_agent 工具分头调研再汇总:子任务传 max_steps=6-8;若子任务未完成,基于已有检索直接汇总,不要全部重做。",
  });
  console.log(`WebChat: http://127.0.0.1:${server.port}(Ctrl-C 退出;管理面 POST /jobs)`);
  const llmDesc = useMock ? "mock" : `${process.env.OPENAI_MODEL ?? "gpt-4o-mini"} @ ${new URL(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").host}`;
  console.log(`运行时: 账本 seq=${store.lastSeq} | LLM=${llmDesc} | 工具=calc/read_file/write_file/save_skill/read_skill/promote_skill/clock/web_search/spawn_agent | 记忆=${useMockEmbed ? "mock 检索" : "DashScope(embedding+rerank)"} | 轨迹投影=duckdb/parquet`);
  // 渠道对端信任(§4.4):微信扫码绑定者=owner(K.4 T3 配对审批的运行时形态);未列名微信私聊=guest
  const wxOwner = loadWeChatCredential()?.ilink_user_id;
  if (wxOwner !== undefined) {
    const d = deriveTrust("wechat", wxOwner);
    if (d.source !== "allowlist") {
      grantTrust("wechat", wxOwner, "owner", "QR 绑定自动授予(守护启动)");
      console.log(`信任: 微信绑定者 ${wxOwner.slice(0, 12)}… 已自动授予 owner(原派生=${d.trust})`);
    }
  }

  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true;
    console.log("\n关闭中:情景提炼补跑 + 投影对账…");
    clearInterval(distillIdle);
    stopTick();
    wechatChannel.stop();
    await server.close();
    for (const p of memory.pendingSessions()) {
      try {
        const n = await memory.distillPending(p.sessionKey);
        if (n > 0) console.log(`[memory] 关停提炼 ${p.sessionKey}: +${n} 条情景记忆`);
      } catch (err) { console.log(`[memory] 关停提炼失败(${p.sessionKey}): ${String(err).slice(0, 120)}`); }
    }
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

async function doctor(): Promise<number> {
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
    // Parquet 对账:轨迹行数 == 账本 agent.terminate(带 trace_cas)条数(异步落盘,允许水印滞后)
    const parquetDir = join(HOME, "traces");
    if (existsSync(parquetDir)) {
      const parquets = readdirSync(parquetDir).filter((f) => f.endsWith(".traces.parquet"));
      if (parquets.length > 0) {
        const terminated = store.all.filter((e) => e.kind === "agent.terminate" && (e.payload as { trace_cas?: string } | undefined)?.trace_cas).length;
        try {
          const { DuckDBInstance } = await import("@duckdb/node-api");
          const inst = await DuckDBInstance.create(":memory:");
          const con = await inst.connect();
          const r = await con.runAndReadAll(`SELECT count(*) AS n FROM read_parquet('${join(parquetDir, "*.traces.parquet").replace(/'/g, "''")}')`);
          const rows = Number((r.getRowObjects()[0] as { n: bigint | number }).n);
          const parquetOk = rows === terminated;
          console.log(`Parquet 对账: ${parquetOk ? `一致(${rows} 行 = ${terminated} 条 terminate)` : `漂移(Parquet ${rows} 行 ≠ 账本 ${terminated} 条;若服务运行中属异步滞后)`}`);
          ok = ok && parquetOk;
        } catch (err) {
          console.log(`Parquet 对账: 跳过(${String(err).slice(0, 80)})`);
        }
      }
    }
  }
  console.log(ok ? "doctor: 全部通过" : "doctor: 存在问题");
  return ok ? 0 : 1;
}

cmd(process.argv.slice(2)).then((code) => process.exit(code));
