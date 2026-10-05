// M1 Soak —— 真实负载压测 + 全链体检(阶段 0)
// 用法: tsx scripts/soak.ts [--port 18790] [--base http://127.0.0.1:18790]
// 前提: webchat 服务已在运行(建议已 source 凭据库接真实模型)。
// 产出: 分类任务统计、账本/Parquet/投影对账、增长率对照 §11。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const portFlag = args.find((a) => a.startsWith("--port"));
const PORT = portFlag !== undefined ? Number(portFlag.split("=")[1]) : 18790;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = process.env.SAMSARA_HOME ?? join(homedir(), ".samsara");

interface TaskSpec { cat: string; message: string; peer?: string; burst?: boolean }
interface TaskResult extends TaskSpec { outcome: string; steps: number; ms: number; ok: boolean }

const TASKS: TaskSpec[] = [
  // ① 问答类 ×12(纯 LLM,无工具)
  ...[
    "一句话解释什么是事件溯源",
    "哈希链和普通日志的区别是什么?两句话",
    "COW(写时复制)的好处?一句话",
    "TypeScript 的 const 断言是什么?一句话",
    "为什么个人智能体要自托管?三个理由,每个一句话",
    "SQLite WAL 模式的优点?一句话",
    "什么是幂等性?一句话加一个例子",
    "DAG 和树的区别?一句话",
    "JSON Schema 是干什么的?一句话",
    "cron 表达式 '0 9 * * FRI' 什么意思?",
    "内容寻址存储(CAS)如何防篡改?一句话",
    "领域驱动设计里的聚合根是什么?一句话",
  ].map((message): TaskSpec => ({ cat: "qa", message })),
  // ② 计算并写文件 ×10(工具链:calc → write_file)
  ...Array.from({ length: 10 }, (_, i): TaskSpec => ({
    cat: "calc_write",
    message: `调用计算器算 ${17 + i}×${23 + i},把结果(只写数字)写入文件 soak-${i + 1}.txt`,
  })),
  // ③ 技能沉淀 ×6(save_skill)
  ...[
    ["commit-style", "写 git 提交信息时", "首行 ≤50 字符祈使句;正文说为什么不说什么"],
    ["meeting-notes", "整理会议纪要时", "先结论后细节;行动项单独列出并带负责人"],
    ["code-review", "做代码评审时", "先夸真实优点;问题按严重度排序;每条给修法"],
    ["report-layout", "写周报时", "三段式:结论/数据/下周计划;不超过 300 字"],
    ["api-naming", "设计 API 时", "资源名用名词复数;动作用 HTTP 方法表达;蛇形命名"],
    ["error-msg", "写报错信息时", "说发生了什么、为什么、怎么办三件事;不责备用户"],
  ].map(([name, trigger, body]): TaskSpec => ({
    cat: "skill_save",
    message: `把以下经验存成技能:名字 ${name},触发条件"${trigger}",内容:${body}`,
  })),
  // ④ 晋升 ×2(promote_skill)
  { cat: "promote", message: "把技能 commit-style 晋升为全局" },
  { cat: "promote", message: "把技能 report-layout 晋升为全局" },
  // ⑤ 其他会话 ×4
  { cat: "peer", message: "计算 999*999 并告诉我结果", peer: "carol" },
  { cat: "peer", message: "把'测试会话隔离'写入文件 carol-note.txt", peer: "carol" },
  { cat: "peer", message: "你是谁?一句话", peer: "dave" },
  { cat: "peer", message: "算 2 的 20 次方", peer: "dave" },
];

async function chat(spec: TaskSpec, timeoutMs = 180_000): Promise<TaskResult> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: spec.message, ...(spec.peer !== undefined ? { peer: spec.peer } : {}) }),
      signal: ac.signal,
    });
    const j = await res.json() as { outcome?: string; steps?: number; error?: string };
    return { ...spec, outcome: j.outcome ?? "http-error", steps: j.steps ?? 0, ms: Date.now() - t0, ok: res.status === 200 && j.outcome === "success" };
  } catch (err) {
    return { ...spec, outcome: `exception:${String(err).slice(0, 60)}`, steps: 0, ms: Date.now() - t0, ok: false };
  } finally { clearTimeout(timer); }
}

const VERIFY_ONLY = args.includes("--verify-only");

async function main(): Promise<number> {
  const health0 = await (await fetch(`${BASE}/health`)).json() as { ledgerSeq: number };
  const seq0 = health0.ledgerSeq;
  const results: TaskResult[] = [];
  if (VERIFY_ONLY) {
    console.log(`verify-only 模式:跳过任务执行(账本 seq=${seq0})\n`);
    return verify(results, seq0, seq0);
  }
  console.log(`Soak 开始: ${TASKS.length} 个任务 → ${BASE}`);
  console.log(`起始账本 seq=${seq0}\n`);
  // 顺序批(①-④)
  for (const spec of TASKS.filter((t) => t.peer === undefined)) {
    const r = await chat(spec);
    results.push(r);
    const flag = r.ok ? "✓" : "✗";
    console.log(`  ${flag} [${spec.cat}] ${r.ms}ms steps=${r.steps} ${spec.message.slice(0, 34)}…`);
  }
  // 并发批(⑤:carol/dave 并行 = 会话间并行;同会话内串行由 lane 保证)
  const burstSpecs = TASKS.filter((t) => t.peer !== undefined);
  const burst = await Promise.all(burstSpecs.map((s) => chat(s)));
  results.push(...burst);
  for (const r of burst) console.log(`  ${r.ok ? "✓" : "✗"} [${r.cat}:${r.peer}] ${r.ms}ms steps=${r.steps}`);

  return verify(results, seq0, 0);
}

async function verify(results: TaskResult[], seq0: number, _unused: number): Promise<number> {
  console.log("\n══ 全链体检 ══");
  const health1 = await (await fetch(`${BASE}/health`)).json() as { ledgerSeq: number };
  const seq1 = health1.ledgerSeq;
  const parquetRows = await countParquet();
  const ledgerTerminates = countTerminates();
  const ledgerLines = countLedgerLines();
  const skillFiles = countWorkspace();

  const byCat = new Map<string, { n: number; ok: number; steps: number; ms: number }>();
  for (const r of results) {
    const c = byCat.get(r.cat) ?? { n: 0, ok: 0, steps: 0, ms: 0 };
    c.n += 1; c.ok += r.ok ? 1 : 0; c.steps += r.steps; c.ms += r.ms;
    byCat.set(r.cat, c);
  }
  console.log("\n类别        成功/总数    平均耗时   工具步合计");
  for (const [cat, c] of [...byCat.entries()].sort()) {
    console.log(`${cat.padEnd(11)} ${String(c.ok).padStart(3)}/${String(c.n).padEnd(3)}     ${Math.round(c.ms / c.n)}ms      ${c.steps}`);
  }
  const toolEngaged = TASKS.filter((t) => t.cat !== "qa").length;
  const withSteps = results.filter((r) => r.cat !== "qa" && r.steps > 0).length;

  console.log("\n指标                          值                 判定");
  const checks: [string, string, boolean][] = [
    ["任务成功率", `${results.filter((r) => r.ok).length}/${results.length}`, results.length === 0 || results.every((r) => r.ok)],
    ["工具触达率(非问答)", results.length === 0 ? "n/a(verify-only)" : `${withSteps}/${toolEngaged}`, results.length === 0 || withSteps >= toolEngaged * 0.8],
    ["账本增长", seq1 === seq0 ? `n/a(verify-only,当前 seq=${seq1})` : `+${seq1 - seq0} 条(≈${((seq1 - seq0) / Math.max(results.length, 1)).toFixed(1)}/任务)`, true],
    ["Parquet 对账", `${parquetRows} 行 = ${ledgerTerminates} terminate`, parquetRows === ledgerTerminates],
    ["账本行数 = seq", `${ledgerLines} = ${seq1}`, ledgerLines === seq1],
    ["工作区产物(calc_write 10 + carol 1)", `${skillFiles} 个文件`, skillFiles >= 11],
  ];
  let allOk = true;
  for (const [name, val, ok] of checks) {
    console.log(`${name.padEnd(28)} ${val.padEnd(18)} ${ok ? "✓" : "✗"}`);
    allOk = allOk && ok;
  }
  console.log(`\nSoak ${allOk ? "通过 ✅" : "存在问题 ❌(详见上方)"}——完整体检建议再跑: npm run cli -- doctor`);
  return allOk ? 0 : 1;
}

async function countParquet(): Promise<number> {
  const dir = join(HOME, "traces");
  if (!existsSync(dir)) return 0;
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const inst = await DuckDBInstance.create(":memory:");
  const con = await inst.connect();
  const r = await con.runAndReadAll(`SELECT count(*) AS n FROM read_parquet('${join(dir, "*.traces.parquet").replace(/'/g, "''")}')`);
  return Number((r.getRowObjects()[0] as { n: bigint }).n);
}
function countTerminates(): number {
  return readLedger().filter((e) => e.kind === "agent.terminate").length;
}
function countLedgerLines(): number {
  return readLedger().length;
}
function readLedger(): { kind: string }[] {
  const f = join(HOME, "ledger", "head.log");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf-8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { kind: string });
}
function countWorkspace(): number {
  const dir = join(HOME, "workspace");
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.startsWith("soak-") || f === "carol-note.txt").length;
}

main().then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(1); });
