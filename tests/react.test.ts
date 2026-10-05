// ReAct 多轮回路(主文档 §5.1 五步):工具调用经 effect 通道、轨迹逐步入 bundle、
// 步数预算/中断信号、效应归属 agent(kill 即回滚)、崩溃恢复 + 重绑定后回滚。

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../src/kernel/kernel.js";
import { mockChatPlugin } from "../src/llm/chat.js";
import type { MockTurn } from "../src/llm/chat.js";
import { calcToolPlugin, fsToolPlugin, toolRegistryPlugin } from "../src/agent/tools.js";
import { runTask } from "../src/agent/task.js";
import { tmpStore } from "./helpers.js";

const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };

/** 装配标准运行时:mock LLM + 工具注册表 + calc/fs 工具;返回 kernel 与工作目录 */
function assemble(script: MockTurn[] | ((req: never) => MockTurn)) {
  const t = tmpStore();
  const workDir = mkdtempSync(join(tmpdir(), "samsara-react-"));
  const kernel = new Kernel(t.store);
  const llm = mockChatPlugin(script as never);
  kernel.install(llm.manifest, llm.module);
  const reg = toolRegistryPlugin();
  kernel.install(reg.manifest, reg.module);
  const calc = calcToolPlugin();
  kernel.install(calc.manifest, calc.module);
  const fs = fsToolPlugin(workDir);
  kernel.install(fs.manifest, fs.module);
  return { kernel, workDir, ...t };
}

async function bootAll(kernel: Kernel) {
  await kernel.activate("tool-registry@1.0.0"); // 注册表先就绪,工具随后反应式接入
  await kernel.activate("llm-mock@1.0.0");
  await kernel.activate("tool-calc@1.0.0");
  await kernel.activate("tool-fs@1.0.0");
}

const CALC_THEN_WRITE: MockTurn[] = [
  { toolCalls: [{ id: "c1", name: "calc", args: { expression: "12*7" } }] },
  { toolCalls: [{ id: "c2", name: "write_file", args: { name: "result.txt", content: "84" } }] },
  "已完成:12×7=84,结果写入 result.txt。",
];

describe("ReAct 多轮回路", () => {
  it("两步工具回路:calc → write_file → 回复;轨迹/bundle/效应归属齐全", async () => {
    const t = assemble(CALC_THEN_WRITE);
    await bootAll(t.kernel);
    const r = await runTask(t.kernel, {
      goal: "计算 12×7 并写入 result.txt", sessionKey: "cli:dm:owner",
      runtimePluginId: "llm-mock@1.0.0", actor: ACTOR,
    });

    expect(r.outcome).toBe("success");
    expect(r.reply).toContain("84");
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0]).toMatchObject({ name: "calc", ok: true });
    expect(r.steps[1]).toMatchObject({ name: "write_file", ok: true });
    expect(existsSync(join(t.workDir, "result.txt"))).toBe(true);
    expect(readFileSync(join(t.workDir, "result.txt"), "utf-8")).toBe("84");

    // bundle:逐步 args/results 完整(K.5 重放保真)
    const bundle = JSON.parse(t.store.readCas(r.bundleCas));
    expect(bundle.steps[0]).toMatchObject({ name: "calc", args: { expression: "12*7" }, result: "84", ok: true });
    expect(bundle.steps[1]).toMatchObject({ name: "write_file", args: { name: "result.txt", content: "84" } });
    // 消息序列:user → assistant(toolCalls×2)→ tool×2 → assistant
    expect(bundle.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);

    // 效应归属 agent:kill 任务即撤销文件(GAP1/§5.4 回收语义)
    const s = await t.kernel.revertOwner({ kind: "agent", id: r.agentId }, ACTOR);
    expect(s.reverted).toHaveLength(1);
    expect(existsSync(join(t.workDir, "result.txt"))).toBe(false);
    expect(t.store.verifyChain().ok).toBe(true);
    rmSync(t.workDir, { recursive: true, force: true });
    t.cleanup();
  });

  it("工具不存在 → 步骤 ok=false,循环继续至最终回复(失败不熔断,交模型决策)", async () => {
    const t = assemble([
      { toolCalls: [{ id: "c1", name: "no_such_tool", args: {} }] },
      "该工具不可用,我直接回答:42。",
    ]);
    await bootAll(t.kernel);
    const r = await runTask(t.kernel, {
      goal: "调用不存在的工具", sessionKey: "cli:dm:owner",
      runtimePluginId: "llm-mock@1.0.0", actor: ACTOR,
    });
    expect(r.outcome).toBe("success");
    expect(r.steps[0]).toMatchObject({ name: "no_such_tool", ok: false });
    expect(r.reply).toContain("42");
    t.cleanup(); rmSync(t.workDir, { recursive: true, force: true });
  });

  it("步数预算耗尽 → outcome=aborted(放弃),已做步骤照常入轨迹", async () => {
    let n = 0;
    const t = assemble(() => ({
      toolCalls: [{ id: `c${++n}`, name: "calc", args: { expression: "1+1" } }],
    }));
    await bootAll(t.kernel);
    const r = await runTask(t.kernel, {
      goal: "无限调用工具", sessionKey: "cli:dm:owner",
      runtimePluginId: "llm-mock@1.0.0", actor: ACTOR, maxSteps: 3,
    });
    expect(r.outcome).toBe("aborted");
    expect(r.error).toContain("步数预算耗尽");
    expect(r.steps).toHaveLength(3);
    expect(t.store.verifyChain().ok).toBe(true);
    t.cleanup(); rmSync(t.workDir, { recursive: true, force: true });
  });

  it("中断信号(AbortSignal)→ 下一轮头部生效,已执行动作留痕不回滚(§5.1 第 5 步)", async () => {
    const ac = new AbortController();
    const t = assemble(() => {
      ac.abort(); // 在首个 complete 解析时触发:本轮工具照常执行,下一轮头部检出中断
      return { toolCalls: [{ id: "c1", name: "calc", args: { expression: "1+1" } }] };
    });
    await bootAll(t.kernel);
    const r = await runTask(t.kernel, {
      goal: "会被中断的任务", sessionKey: "cli:dm:owner",
      runtimePluginId: "llm-mock@1.0.0", actor: ACTOR,
      signal: ac.signal,
    });
    expect(r.outcome).toBe("aborted");
    expect(r.steps).toHaveLength(1); // 中断前已执行的一步留痕
    const terminate = t.store.all.find((e) => e.kind === "agent.terminate")!;
    expect((terminate.payload as { outcome: string }).outcome).toBe("aborted");
    expect(t.store.verifyChain().ok).toBe(true);
    t.cleanup(); rmSync(t.workDir, { recursive: true, force: true });
  });

  it("工具注册 = 可逆效应:dispose 工具插件即从注册表注销(§3.2.2 原生示例)", async () => {
    const t = assemble(["好的。"]);
    await bootAll(t.kernel);
    const reg = t.kernel.service(await import("../src/agent/tools.js").then((m) => m.TOOL_REGISTRY));
    expect(reg.list().map((x) => x.name)).toContain("calc");
    await t.kernel.dispose("tool-calc@1.0.0");
    expect(reg.list().map((x) => x.name)).not.toContain("calc");
    t.cleanup(); rmSync(t.workDir, { recursive: true, force: true });
  });

  it("崩溃恢复 + fs 工具重绑定 → kill 任务仍可撤销文件", async () => {
    const t = assemble(CALC_THEN_WRITE);
    await bootAll(t.kernel);
    const r = await runTask(t.kernel, {
      goal: "计算并写入", sessionKey: "cli:dm:owner",
      runtimePluginId: "llm-mock@1.0.0", actor: ACTOR,
    });
    expect(existsSync(join(t.workDir, "result.txt"))).toBe(true);

    // 崩溃:仅账本与 CAS 幸存 → 恢复 + 重绑 fs 工具(注册表/LLM 随需重激活)
    const recovered = Kernel.recover(t.store).kernel;
    const fs2 = fsToolPlugin(t.workDir);
    await recovered.rebind("tool-fs@1.0.0", fs2.module);
    const s = await recovered.revertOwner({ kind: "agent", id: r.agentId }, ACTOR);
    expect(s.reverted).toHaveLength(1);
    expect(existsSync(join(t.workDir, "result.txt"))).toBe(false);
    t.cleanup(); rmSync(t.workDir, { recursive: true, force: true });
  });
});
