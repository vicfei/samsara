// 车道队列(M3-S2,接口 §2.1/GAP9):同 key 串行证明 / 跨 key 并行 / 映射稳定 / 有界性。

import { describe, expect, it } from "vitest";
import { LaneQueue, LANE_COUNT_MAX } from "../src/kernel/lanes";
import { cpus } from "node:os";

describe("LaneQueue(§2.1 车道语义)", () => {
  it("有界 lane:min(CPU, 8),至少 1", () => {
    expect(new LaneQueue().laneCount).toBe(Math.min(cpus().length, LANE_COUNT_MAX));
    expect(new LaneQueue(0).laneCount).toBe(1);
    expect(new LaneQueue(100).laneCount).toBe(100); // 显式指定尊重(测试注入)
    expect(LANE_COUNT_MAX).toBe(8);
  });

  it("同 lane 串行证明(GAP9 verify 准则):同 sessionKey 的并发任务严格按入队顺序执行,零重叠", async () => {
    const q = new LaneQueue(4);
    const order: number[] = [];
    let active = 0;
    let maxOverlap = 0;
    const mk = (i: number) => q.enqueue("webchat:dm:alice", async () => {
      active += 1;
      maxOverlap = Math.max(maxOverlap, active);
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 20)); // 随机时长放大乱序窗口
      order.push(i);
      active -= 1;
      return i;
    });
    const rs = await Promise.all([mk(1), mk(2), mk(3), mk(4), mk(5)]);
    expect(order).toEqual([1, 2, 3, 4, 5]);   // FIFO 严格保序
    expect(maxOverlap).toBe(1);                // 零重叠(串行证明)
    expect(rs).toEqual([1, 2, 3, 4, 5]);       // 结果如实返回
  });

  it("跨 key 并行:不同 sessionKey(异 lane 时)可并发;失败不断链", async () => {
    const q = new LaneQueue(8);
    // 找两个必然异 lane 的 key(8 lane,穷举前几个)
    const keys: string[] = [];
    outer: for (let i = 0; i < 64 && keys.length < 2; i++) {
      const k = `s:${i}`;
      if (!keys.some((e) => q.laneOf(e) === q.laneOf(k))) keys.push(k);
    }
    expect(keys).toHaveLength(2);
    let active = 0;
    let maxOverlap = 0;
    const gate: Promise<void>[] = [];
    const run = q.enqueue(keys[0]!, async () => {
      active += 1; maxOverlap = Math.max(maxOverlap, active);
      await new Promise((r) => setTimeout(r, 40));
      active -= 1;
    });
    const run2 = q.enqueue(keys[1]!, async () => {
      active += 1; maxOverlap = Math.max(maxOverlap, active);
      await new Promise((r) => setTimeout(r, 40));
      active -= 1;
    });
    void gate;
    await Promise.all([run, run2]);
    expect(maxOverlap).toBe(2); // 真并行

    // 失败不断链:同 lane 前任务抛错,后续照常执行
    const err = q.enqueue("k", async () => { throw new Error("boom"); });
    await expect(err).rejects.toThrow("boom");
    await expect(q.enqueue("k", async () => "next")).resolves.toBe("next");
  });

  it("映射稳定:同 key 跨实例/多次调用同 lane;stats 如实", async () => {
    const q1 = new LaneQueue(8);
    const q2 = new LaneQueue(8);
    for (const k of ["wechat:dm:a", "webchat:dm:browser", "job:job_x"]) {
      expect(q1.laneOf(k)).toBe(q2.laneOf(k));
      expect(q1.laneOf(k)).toBe(q1.laneOf(k));
    }
    expect(q1.stats()).toEqual({ laneCount: 8, queued: 0, active: 0 });
    const p = q1.enqueue("x", () => new Promise<string>((r) => setTimeout(() => r("done"), 30)));
    expect(q1.stats().queued).toBe(1);
    expect(await p).toBe("done");
    expect(q1.stats()).toEqual({ laneCount: 8, queued: 0, active: 0 });
  });
});
