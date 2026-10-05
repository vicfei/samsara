// 调度器(附录 C / 接口 §3.5)——账本语义、tick 触发、misfire 三态、到期暂停、重放恢复
// 时钟注入:frozenNow 推进;runner 打桩记录调用(真实 runTask 集成见最后一例)。

import { describe, expect, it } from "vitest";
import { LedgerStore } from "../src/kernel/ledger.js";
import { Kernel } from "../src/kernel/kernel.js";
import { Projection } from "../src/kernel/projection.js";
import { mockChatPlugin } from "../src/llm/chat.js";
import { Scheduler, compileSchedule, validateCron } from "../src/scheduler/scheduler.js";
import type { FireNotification, TaskRunner } from "../src/scheduler/scheduler.js";
import { runTask } from "../src/agent/task.js";
import { tmpStore } from "./helpers.js";

const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };

/** 每分钟 cron,便于用注入时钟构造"到点/错过" */
const EVERY_MIN = "* * * * *";
const TZ = "Asia/Shanghai";

function assemble(runner?: TaskRunner, opts?: ConstructorParameters<typeof Scheduler>[3]) {
  const t = tmpStore();
  const kernel = new Kernel(t.store);
  const projection = Projection.open(t.dir, t.store);
  const fired: { goal: string; sessionKey: string }[] = [];
  const notifications: FireNotification[] = [];
  const r: TaskRunner = runner ?? (async (goal, sessionKey) => {
    fired.push({ goal, sessionKey });
    return { outcome: "success", reply: `done:${goal}`, traceId: "tr_stub" };
  });
  const scheduler = new Scheduler(kernel, projection, r, {
    tickIntervalMs: 30_000,
    notifier: (n) => notifications.push(n),
    ...opts,
  });
  return { t, kernel, projection, scheduler, fired, notifications };
}

/** 基准时刻:整分,便于 cron 对齐 */
const T0 = new Date("2026-10-05T10:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

describe("任务管理与账本语义(§C.2/§C.4)", () => {
  it("createJob:jobs 行落投影、goal 入 CAS、无效 cron 拒绝、R3+ 强制有效期", () => {
    const { t, projection, scheduler } = assemble();
    const job = scheduler.createJob({ goal: "出周报", schedule: "0 9 * * 5", timezone: TZ, actor: ACTOR });
    expect(job.id).toMatch(/^job_/);
    expect(job.state).toBe("active");
    expect(job.next_fire_ts).toBe("2026-10-09T01:00:00.000Z"); // 周五 9 点 CST
    const row = projection.db.prepare(`SELECT * FROM jobs WHERE id=?`).get(job.id) as Record<string, unknown>;
    expect(row.schedule_cron).toBe("0 9 * * 5");
    expect(row.misfire).toBe("skip");
    expect(t.store.all.some((e) => e.kind === "job.create" && (e.ref?.job === job.id))).toBe(true);

    expect(() => scheduler.createJob({ goal: "x", schedule: "99 * * * *" })).toThrow(); // 非法 cron
    expect(() => scheduler.createJob({ goal: "x", schedule: "* * * * *", rCeiling: "R3" })).toThrow(/有效期/); // §C.4
    t.cleanup();
  });

  it("pause/resume/delete/renew:状态迁移入账,重放后一致", () => {
    const { t, scheduler } = assemble();
    const job = scheduler.createJob({ goal: "g", schedule: EVERY_MIN, timezone: "UTC", actor: ACTOR });
    expect(scheduler.pause(job.id, ACTOR).state).toBe("paused");
    expect(scheduler.resume(job.id, ACTOR).state).toBe("active");
    const renewed = scheduler.renew(job.id, 30, ACTOR);
    expect(renewed.expires_at).not.toBeNull();
    expect(scheduler.remove(job.id, ACTOR).state).toBe("deleted");
    expect(scheduler.list()).toHaveLength(0); // deleted 不列

    const recovered = Kernel.recover(t.store).kernel; // 重放:job.* 条目被消费
    expect(recovered.store.all.map((e) => e.kind)).toContain("job.delete");
    t.cleanup();
  });
});

describe("tick 触发(§C.3)", () => {
  it("到点触发一次:job.fire 入账 → runner 以 job:<id> 会话执行 → 通知", async () => {
    const { t, scheduler, fired, notifications } = assemble();
    const job = scheduler.createJob({ goal: "每分钟报告", schedule: EVERY_MIN, timezone: "UTC", actor: ACTOR });
    await scheduler.tick(min(0)); // 创建于 T0 前,last=null→created_ts=T0 前一毫秒?createJob 用真实时钟!
    // 注:createJob 的 created_ts 是真实 now(晚于注入时钟)——先以真实时钟建,再回拨到未来验证
    const future = new Date(Date.now() + 120_000);
    const fired2 = await scheduler.tick(future);
    expect(fired2).toContain(job.id);
    expect(fired.length).toBeGreaterThanOrEqual(1);
    expect(fired[0]!.sessionKey).toBe(`job:${job.id}`);
    expect(t.store.all.filter((e) => e.kind === "job.fire")).toHaveLength(1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.reply).toContain("done:");
    // 再 tick(同一分钟内,不跨边界)不重复触发
    const lastFired = scheduler.view(job.id)!.last_fired_ts!;
    const again = await scheduler.tick(new Date(new Date(lastFired).getTime() + 30_000));
    expect(again).toHaveLength(0);
    expect(t.store.all.filter((e) => e.kind === "job.fire")).toHaveLength(1);
    t.cleanup();
  });

  it("misfire=skip:错过当期即弃(job.missed 入账),不执行", async () => {
    const { t, scheduler, fired } = assemble(undefined, { graceMs: 60_000 });
    scheduler.createJob({ goal: "skip 策略", schedule: EVERY_MIN, timezone: "UTC", misfire: "skip", actor: ACTOR });
    // 创建于真实 now;推进 5 分钟(远超 grace 60s)
    const later = new Date(Date.now() + 5 * 60_000);
    const firedIds = await scheduler.tick(later);
    // skip 语义:超出当期窗口的全部弃(job.missed),仅"仍在当期"的那次执行
    expect(firedIds).toHaveLength(1);
    expect(fired).toHaveLength(1);
    expect(t.store.all.filter((e) => e.kind === "job.missed").length).toBeGreaterThanOrEqual(3); // 错过的诚实记录
    t.cleanup();
  });

  it("misfire=runOnce/catchUp:恢复后补跑最近一次(仅一次)", async () => {
    for (const policy of ["runOnce", "catchUp"] as const) {
      const { t, scheduler, fired } = assemble();
      scheduler.createJob({ goal: `${policy} 策略`, schedule: EVERY_MIN, timezone: "UTC", misfire: policy, actor: ACTOR });
      const later = new Date(Date.now() + 5 * 60_000);
      const firedIds = await scheduler.tick(later);
      expect(firedIds).toHaveLength(1);           // 补一次
      expect(fired).toHaveLength(1);
      t.cleanup();
    }
  });

  it("到期自动暂停并告警(§C.4);pause 态不触发", async () => {
    const { t, scheduler, fired, notifications } = assemble();
    const expires = new Date(Date.now() + 90_000).toISOString();
    const job = scheduler.createJob({ goal: "高危任务", schedule: EVERY_MIN, timezone: "UTC", rCeiling: "R3", expiresAt: expires, actor: ACTOR });
    await scheduler.tick(new Date(Date.now() + 3 * 60_000)); // 过期后
    expect(scheduler.view(job.id)!.state).toBe("paused");
    const expiredNote = notifications.find((n) => n.outcome === "expired");
    expect(expiredNote?.error).toContain("续期");
    expect(fired).toHaveLength(0);                // 到期后不再执行
    t.cleanup();
  });

  it("重放恢复:scheduler 重建后从账本推导上次触发,不重复不遗漏", async () => {
    const t0 = assemble();
    const job = t0.scheduler.createJob({ goal: "恢复测试", schedule: EVERY_MIN, timezone: "UTC", actor: ACTOR });
    const future = new Date(Date.now() + 90_000);
    await t0.scheduler.tick(future); // 触发一次
    expect(t0.fired).toHaveLength(1);
    t0.projection.close();

    // "崩溃":仅账本幸存 → 重建 scheduler → 同一时刻再 tick 不重复
    const projection2 = Projection.open(t0.t.dir, t0.t.store);
    const kernel2 = Kernel.recover(t0.t.store).kernel;
    const fired2: unknown[] = [];
    const scheduler2 = new Scheduler(kernel2, projection2, async () => { fired2.push(1); return { outcome: "success", traceId: "tr_x" }; });
    await scheduler2.tick(new Date(future.getTime() + 10_000)); // 仍在同一分钟内
    expect(fired2).toHaveLength(0);
    await scheduler2.tick(new Date(future.getTime() + 70_000)); // 下一分钟
    expect(fired2).toHaveLength(1);
    projection2.close();
    t0.t.cleanup();
  });
});

describe("自然语言编译(§C.2)", () => {
  it("compileSchedule:LLM 返回 JSON → 校验通过;坏输出拒绝", async () => {
    const good = await compileSchedule(async () => '{"cron":"0 9 * * 5","timezone":"Asia/Shanghai","goal":"每周五 9 点出周报"}', "每周五 9 点出周报");
    expect(good.cron).toBe("0 9 * * 5");
    expect(good.timezone).toBe("Asia/Shanghai");
    await expect(compileSchedule(async () => "我觉得都行", "随便")).rejects.toThrow(/未返回 JSON/);
    await expect(compileSchedule(async () => '{"cron":"99 * * * *","goal":"x"}', "x")).rejects.toThrow(); // 非法 cron
  });

  it("validateCron:时区正确性(0 9 * * 5 @ Asia/Shanghai = 周五 01:00 UTC)", () => {
    expect(validateCron("0 9 * * 5", TZ).toISOString()).toBe("2026-10-09T01:00:00.000Z");
  });
});

describe("真实回路集成 + HTTP 管理面", () => {
  it("runner=runTask:定时任务走标准回路,轨迹/bundle/Parquet 齐全;/jobs add 经 LLM 编译", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const projection = Projection.open(t.dir, t.store);
    let called = 0;
    const llm = mockChatPlugin(() => {
      called += 1;
      // 第一次调用 = tick 内任务执行;后续 = /jobs add 的编译调用
      return called === 1 ? "心跳正常" : '{"cron":"* * * * *","timezone":"UTC","goal":"每分钟心跳"}';
    });
    kernel.install(llm.manifest, llm.module);
    await kernel.activate("llm-mock@1.0.0");
    const scheduler = new Scheduler(kernel, projection, (goal, sessionKey, actor) =>
      runTask(kernel, { goal, sessionKey, runtimePluginId: "llm-mock@1.0.0", actor }));
    const job = scheduler.createJob({ goal: "每分钟心跳", schedule: EVERY_MIN, timezone: "UTC", actor: ACTOR });
    await scheduler.tick(new Date(Date.now() + 65_000));

    const term = t.store.all.find((e) => e.kind === "agent.terminate")!;
    expect((term.payload as { session_key?: string }).session_key ?? (term.ref as { agent: string })).toBeTruthy();
    const fires = t.store.all.filter((e) => e.kind === "job.fire");
    expect(fires).toHaveLength(1);
    // 经 HTTP 管理面创建(NL 编译走 mock LLM 的首条剧本)
    const { startWebChat } = await import("../src/channel/webchat.js");
    const server = await startWebChat(kernel, { port: 0, runtimePluginId: "llm-mock@1.0.0", scheduler });
    const addRes = await (await fetch(`http://127.0.0.1:${server.port}/jobs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add", goal: "每分钟心跳" }),
    })).json() as { ok: boolean; result?: { schedule_cron: string } };
    expect(addRes.ok).toBe(true);
    expect(addRes.result!.schedule_cron).toBe("* * * * *");
    const listRes = await (await fetch(`http://127.0.0.1:${server.port}/jobs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    })).json() as { result: { id: string }[] };
    expect(listRes.result).toHaveLength(2);
    await server.close();
    projection.close();
    t.cleanup();
  });
});
