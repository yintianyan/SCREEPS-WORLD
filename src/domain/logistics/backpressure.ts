/**
 * Backpressure — A4.3 Phase 5：背压机制。
 *
 * 合同锚点：A4.3 Architecture Audit §2.1 #12（无 Backpressure）、§10 #25。
 *
 * 设计意图：
 *   Logistics Capacity 不足时向 Resource Planner 反馈。
 *   反馈通道：
 *   1. reduce-production: 远矿 harvester 限采
 *   2. increase-haulers: spawn 额外 hauler
 *   3. reduce-demand: 降低非关键消费（builder/upgrader）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { RoomCapacityResult } from "./capacity-planning";

// ─── 信号 ──────────────────────────────────────────────────

/**
 * Backpressure 信号。
 */
export interface BackpressureSignal {
  /** 房间名。 */
  room: string;
  /** 运力缺口（正=不足）。 */
  capacityGap: number;
  /** 积压量。 */
  backlog: number;
  /** 建议动作。 */
  action: "reduce-production" | "increase-haulers" | "reduce-demand" | "none";
  /** 原因。 */
  reason: string;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 评估 Backpressure。
 *
 * 算法：
 *   1. capacityGap > 0 且 backlog > threshold → increase-haulers
 *   2. capacityGap > 0 且 backlog > threshold 且 spawn 无余力 → reduce-production
 *   3. capacityGap > 0 且 utilization < 0.3 → reduce-demand
 *   4. 否则 → none
 *
 * 纯函数。
 */
export function evaluateBackpressure(
  capacity: RoomCapacityResult,
  backlog: number,
  tick: number,
  backlogThreshold: number = 2000,
): BackpressureSignal {
  const { room, haulerGap, utilization } = capacity;

  if (haulerGap <= 0 && backlog <= 0) {
    return {
      room,
      capacityGap: 0,
      backlog,
      action: "none",
      reason: "capacity sufficient",
    };
  }

  // 运力不足 + 积压严重 → 增加 hauler
  if (haulerGap > 0 && backlog > backlogThreshold) {
    return {
      room,
      capacityGap: haulerGap,
      backlog,
      action: "increase-haulers",
      reason: `gap=${haulerGap}, backlog=${backlog} > ${backlogThreshold}`,
    };
  }

  // 运力严重不足 → 降低生产
  if (haulerGap > 0 && utilization > 0.9) {
    return {
      room,
      capacityGap: haulerGap,
      backlog,
      action: "reduce-production",
      reason: `gap=${haulerGap}, utilization=${utilization.toFixed(2)} (overloaded)`,
    };
  }

  // 利用率极低 → 降低消费
  if (utilization < 0.3) {
    return {
      room,
      capacityGap: haulerGap,
      backlog,
      action: "reduce-demand",
      reason: `utilization=${utilization.toFixed(2)} (underutilized)`,
    };
  }

  return {
    room,
    capacityGap: haulerGap,
    backlog,
    action: "none",
    reason: `gap=${haulerGap}, utilization=${utilization.toFixed(2)}`,
  };
}

/**
 * 批量评估多房间 Backpressure。
 * 纯函数。
 */
export function batchEvaluateBackpressure(
  capacities: readonly RoomCapacityResult[],
  backlogByRoom: ReadonlyMap<string, number>,
  tick: number,
  backlogThreshold?: number,
): BackpressureSignal[] {
  return capacities.map(cap => {
    const backlog = backlogByRoom.get(cap.room) ?? 0;
    return evaluateBackpressure(cap, backlog, tick, backlogThreshold);
  });
}
