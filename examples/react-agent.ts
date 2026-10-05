// ReAct 多轮回路演示(主文档 §5.1 五步的完整形态):
// 任务"计算 12×7 并写入 result.txt" → LLM 决策两次工具调用(calc → write_file)→ 最终回复;
// 然后 kill 任务:文件被 LIFO 撤销(效应归属 agent);
// 最后崩溃 + 恢复 + 重绑定:kill 依然有效。
// (mock LLM 剧本化,零网络;真实模型经 OPENAI_API_KEY 走同一回路——CLI `samsara run`)

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerStore } from "../src/kernel/ledger.js";
import { Kernel } from "../src/kernel/kernel.js";
import { mockChatPlugin } from "../src/llm/chat.js";
import { calcToolPlugin, fsToolPlugin, toolRegistryPlugin, TOOL_REGISTRY } from "../src/agent/tools.js";
import { runTask } from "../src/agent/task.js";

const say = (t: string) => console.log(t);
const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };

const dir = mkdtempSync(join(tmpdir(), "samsara-react-demo-"));
const workDir = join(dir, "workspace");
const store = new LedgerStore(dir);
const kernel = new Kernel(store);

// ── 装配运行时:LLM + 工具注册表 + 工具(注册 = 可逆效应)──
let turn = 0;
const script = () => [
  { toolCalls: [{ id: `c${turn}-calc`, name: "calc", args: { expression: "12*7" } }] },
  { toolCalls: [{ id: `c${turn}-write`, name: "write_file", args: { name: "result.txt", content: "84" } }] },
  "完成:12×7 = 84,结果已写入 result.txt。",
][turn++ % 3]; // 循环剧本:两次任务各走一遍 calc→write→回复
const llm = mockChatPlugin(script);
kernel.install(llm.manifest, llm.module);
const reg = toolRegistryPlugin();
kernel.install(reg.manifest, reg.module);
const calc = calcToolPlugin();
kernel.install(calc.manifest, calc.module);
const fs1 = fsToolPlugin(workDir);
kernel.install(fs1.manifest, fs1.module);

say("══ 1. ReAct 任务:计算 12×7 并写入 result.txt ══");
await kernel.activate("tool-registry@1.0.0");
await kernel.activate("llm-mock@1.0.0");
await kernel.activate("tool-calc@1.0.0");
await kernel.activate("tool-fs@1.0.0");
say(`工具清单: ${kernel.service(TOOL_REGISTRY).list().map((t) => t.name).join(", ")}`);

const r = await runTask(kernel, {
  goal: "计算 12×7 并写入 result.txt", sessionKey: "cli:dm:owner",
  runtimePluginId: "llm-mock@1.0.0", actor: ACTOR,
});
say(`回复: ${r.reply}`);
for (const s of r.steps) say(`  步骤${s.no}: ${s.name} ok=${s.ok} ${s.ms}ms`);
say(`磁盘: result.txt=${existsSync(join(workDir, "result.txt"))} 内容=${JSON.stringify(readFileSync(join(workDir, "result.txt"), "utf-8"))}`);
say(`轨迹: ${r.traceId} | bundle=${r.bundleCas.slice(7, 19)}… | tokens=${r.usage.promptTokens}/${r.usage.completionTokens} | 账本 seq=${store.lastSeq}`);

say("\n══ 2. kill 任务(revertOwner ag_…)——写入被 LIFO 撤销 ══");
const s1 = await kernel.revertOwner({ kind: "agent", id: r.agentId }, ACTOR);
say(`reverted=${s1.reverted.length}, 磁盘: result.txt=${existsSync(join(workDir, "result.txt"))}(kill 即回收——账本留痕,文件不留残)`);

say("\n══ 3. 重跑任务 → 崩溃(仅账本与 CAS 幸存)→ 恢复 + 重绑定 → kill 仍有效 ══");
const r2 = await runTask(kernel, {
  goal: "再算一次并写入", sessionKey: "cli:dm:owner",
  runtimePluginId: "llm-mock@1.0.0", actor: ACTOR,
});
say(`重跑: result.txt=${existsSync(join(workDir, "result.txt"))}`);
const recovered = Kernel.recover(store).kernel;
const fs2 = fsToolPlugin(workDir);
await recovered.rebind("tool-fs@1.0.0", fs2.module); // 重挂逆操作(rebindArgs 驱动)
const s2 = await recovered.revertOwner({ kind: "agent", id: r2.agentId }, ACTOR);
say(`恢复态 kill: reverted=${s2.reverted.length}, result.txt=${existsSync(join(workDir, "result.txt"))}, 链校验=${store.verifyChain().ok}`);

rmSync(dir, { recursive: true, force: true });
say("\n结论:工具调用全部经 effect 通道(三分类/归属/重绑定),任务可 kill、可恢复、全程入账——");
say("M1 出口的 ReAct 回路就位;下一片:WebChat 渠道(把 sessionKey 从 cli: 换成 webchat:)。");
