// M1 第一片:任务回路 + ReplayBundle 采集(RM2/M1 出口标准的最小形态)
// 断言:agent.spawn/terminate 入账、bundle 含消息全文且可从 CAS 回读、
// 失败任务同样留完整轨迹、提供者缺失时任务被准入闸拒绝(无半截条目)。

import { describe, expect, it } from "vitest";
import { Kernel } from "../src/kernel/kernel.js";
import { mockChatPlugin } from "../src/llm/chat.js";
import { runTask } from "../src/agent/task.js";
import { tmpStore } from "./helpers.js";

const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };

describe("M1 任务回路(单轮)", () => {
  it("成功任务:回复 + agent 条目 + bundle/trace 入 CAS 可回读", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const { manifest, module } = mockChatPlugin(["这是周报草稿的回复。"]);
    kernel.install(manifest, module);
    await kernel.activate("llm-mock@1.0.0");

    const r = await runTask(kernel, { goal: "写一句周报", sessionKey: "cli:dm:owner", runtimePluginId: "llm-mock@1.0.0", actor: ACTOR });
    expect(r.outcome).toBe("success");
    expect(r.reply).toBe("这是周报草稿的回复。");

    const kinds = t.store.all.map((e) => e.kind);
    expect(kinds).toContain("agent.spawn");
    expect(kinds).toContain("agent.terminate");
    const terminate = t.store.all.find((e) => e.kind === "agent.terminate")!;
    expect((terminate.payload as { outcome: string }).outcome).toBe("success");
    expect((terminate.payload as { replay_bundle_cas: string }).replay_bundle_cas).toBe(r.bundleCas);

    // ReplayBundle 回读:消息全文 + 环境指纹(K.5 组成)
    const bundle = JSON.parse(t.store.readCas(r.bundleCas));
    expect(bundle.schema).toBe("samsara-bundle/0");
    expect(bundle.messages).toEqual([
      { role: "user", content: "写一句周报" },
      { role: "assistant", content: "这是周报草稿的回复。" },
    ]);
    expect(bundle.env.channel).toBe("cli");
    expect(bundle.model).toBe("mock-1");

    const trace = JSON.parse(t.store.readCas(r.traceCas));
    expect(trace.replay_bundle_cas).toBe(r.bundleCas);
    expect(trace.outcome).toBe("success");
    expect(t.store.verifyChain().ok).toBe(true);
    t.cleanup();
  });

  it("失败任务:outcome=failure 留完整轨迹,不抛出到调用方之外", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const { manifest, module } = mockChatPlugin(() => { throw new Error("模型网关超时"); });
    kernel.install(manifest, module);
    await kernel.activate("llm-mock@1.0.0");

    const r = await runTask(kernel, { goal: "会失败的任务", sessionKey: "cli:dm:owner", runtimePluginId: "llm-mock@1.0.0", actor: ACTOR });
    expect(r.outcome).toBe("failure");
    expect(r.error).toContain("模型网关超时");
    const terminate = t.store.all.find((e) => e.kind === "agent.terminate")!;
    expect((terminate.payload as { outcome: string }).outcome).toBe("failure");
    const bundle = JSON.parse(t.store.readCas(r.bundleCas));
    expect(bundle.messages).toHaveLength(1); // 只有入站,无 assistant 输出
    expect(t.store.verifyChain().ok).toBe(true);
    t.cleanup();
  });

  it("提供者未激活 → 准入闸拒绝(DEPS_MISSING),账本零污染", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    await expect(runTask(kernel, { goal: "无提供者", sessionKey: "cli:dm:owner", runtimePluginId: "llm-mock@1.0.0", actor: ACTOR }))
      .rejects.toThrow(/DEPS_MISSING/);
    expect(t.store.all.filter((e) => e.kind.startsWith("agent."))).toHaveLength(0); // 无半截条目
    t.cleanup();
  });

  it("崩溃恢复后:agent 条目重放无损,bundle 经 CAS 引用仍可读", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const { manifest, module } = mockChatPlugin(["恢复测试回复"]);
    kernel.install(manifest, module);
    await kernel.activate("llm-mock@1.0.0");
    const r = await runTask(kernel, { goal: "恢复前任务", sessionKey: "cli:dm:owner", runtimePluginId: "llm-mock@1.0.0", actor: ACTOR });

    const recovered = Kernel.recover(t.store).kernel; // "崩溃":仅账本与 CAS 幸存
    const terminate = recovered.store.all.find((e) => e.kind === "agent.terminate")!;
    expect((terminate.payload as { trace_id: string }).trace_id).toBe(r.traceId);
    const bundle = JSON.parse(recovered.store.readCas(r.bundleCas)); // CAS 引用跨崩溃有效
    expect(bundle.messages[0]!.content).toBe("恢复前任务");
    t.cleanup();
  });
});
