// 车道队列(M3-S2,接口 §2.1/GAP9)——有界 lane 的会话分发:
//   lane 数 = min(CPU 核数, lane_count_max=8);sessionKey → lane = 稳定 hash mod N;
//   同 sessionKey 严格按序(同一 lane 的 FIFO),并行只发生在会话之间——
//   竞态在结构上不存在(§4.2),无需运行时锁。
// lane 是进程内逻辑角色(§2.1:可分布式部署属 G 阶段二议题)。

import { createHash } from "node:crypto";
import { cpus } from "node:os";

// spec-constants: lane_count_max(接口 §2.1:min(CPU 核数, 8))
export const LANE_COUNT_MAX = 8;

export interface LaneStats {
  laneCount: number;
  queued: number;   // 排队中(含执行前)
  active: number;   // 执行中
}

interface LaneState {
  queue: Promise<unknown>;      // 尾链:同 lane 串行的实现
  queued: number;
  active: number;
}

export class LaneQueue {
  private readonly lanes: LaneState[] = [];

  constructor(laneCount = Math.min(cpus().length, LANE_COUNT_MAX)) {
    for (let i = 0; i < Math.max(1, laneCount); i++) this.lanes.push({ queue: Promise.resolve(), queued: 0, active: 0 });
  }

  get laneCount(): number { return this.lanes.length; }

  /** sessionKey → lane(sha256 稳定映射:跨进程/跨重启同 key 同 lane) */
  laneOf(sessionKey: string): number {
    const h = createHash("sha256").update(sessionKey).digest();
    return ((h[0]! << 8) | h[1]!) % this.lanes.length;
  }

  /** 入车道:同 sessionKey(即同 lane)严格按序;不同 lane 并行。失败不阻塞后续(尾链吞错)。 */
  enqueue<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
    const lane = this.lanes[this.laneOf(sessionKey)]!;
    lane.queued += 1;
    const run = lane.queue.then(async () => {
      lane.queued -= 1;
      lane.active += 1;
      try {
        return await fn();
      } finally {
        lane.active -= 1;
      }
    });
    lane.queue = run.catch(() => undefined); // 尾链:失败不断链
    return run;
  }

  stats(): LaneStats {
    return {
      laneCount: this.lanes.length,
      queued: this.lanes.reduce((n, l) => n + l.queued, 0),
      active: this.lanes.reduce((n, l) => n + l.active, 0),
    };
  }
}
