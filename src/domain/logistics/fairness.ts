/** Fairness Scheduling */

import type { TransportRequestV2 } from "./transport-request";

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * Fairness Scheduling。

 * 算法：
 *   1. 对每个房间计算 weight = 1 / (1 + recentAllocation × fairnessDecay)
 *      近期分配多的房间 weight 降低
 *   2. 每个房间的 Request 按 weight 重新排序
 *   3. 高优先级 Request 仍然优先（priority 先排，同 priority 内按 weight 排）

 * 纯函数。
 */
export function applyFairness(
  requests: readonly TransportRequestV2[],
  recentAllocation: ReadonlyMap<string, number>,
  fairnessDecay: number = 0.9,
): TransportRequestV2[] {
  // 计算每个房的 weight
  const weightByRoom = new Map<string, number>();
  for (const req of requests) {
    const room = req.destination.room;
    if (!weightByRoom.has(room)) {
      const recent = recentAllocation.get(room) ?? 0;
      const weight = 1 / (1 + recent * fairnessDecay);
      weightByRoom.set(room, weight);
    }
  }

  // 排序：priority 升序 → weight 降序
  const sorted = [...requests].sort((a, b) => {
    // 优先级不同 → 按 priority 排
    if (a.priority !== b.priority) return a.priority - b.priority;
    // 同优先级 → 按 weight 排
    const wa = weightByRoom.get(a.destination.room) ?? 1;
    const wb = weightByRoom.get(b.destination.room) ?? 1;
    return wb - wa;
  });

  return sorted;
}

/**
 * 计算每个房间的分配配额。
 * 纯函数。
 */
export function computeFairQuota(
  rooms: readonly string[],
  totalCapacity: number,
  recentAllocation: ReadonlyMap<string, number>,
  fairnessDecay: number = 0.9,
): Map<string, number> {
  const weights = new Map<string, number>();
  let totalWeight = 0;

  for (const room of rooms) {
    const recent = recentAllocation.get(room) ?? 0;
    const weight = 1 / (1 + recent * fairnessDecay);
    weights.set(room, weight);
    totalWeight += weight;
  }

  const quota = new Map<string, number>();
  for (const [room, weight] of weights) {
    quota.set(room, totalWeight > 0 ? Math.floor(totalCapacity * weight / totalWeight) : 0);
  }
  return quota;
}
