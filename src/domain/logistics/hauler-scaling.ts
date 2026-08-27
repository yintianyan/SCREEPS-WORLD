/** Hauler Scaling */

import type { RoomCapacityResult } from "./capacity-planning";

// ─── 决策类型 ──────────────────────────────────────────────

/**
 * Scaling 决策。
 */
export type ScalingDecision =
  | { action: "expand"; count: number; reason: string }
  | { action: "shrink"; count: number; reason: string }
  | { action: "maintain"; reason: string };

// ─── 配置参数 ──────────────────────────────────────────────

/** 缩编阈值：利用率低于此值持续 idleTicks 后缩编。 */
const SHRINK_UTILIZATION_THRESHOLD = 0.5;

/** 扩编时的经济压力上限——高于此值不扩编（能量不够）。 */
const EXPAND_ECONOMY_PRESSURE_LIMIT = 0.8;

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 动态扩缩编决策。

 * 算法：
 *   1. haulerGap > 0 且 spawnAvailable 且 economyPressure < limit → expand
 *   2. utilization < threshold 且 idleTicks > idleThreshold → shrink
 *   3. 否则 → maintain

 * 纯函数。

 * @param capacity 房间运力规划结果
 * @param spawnAvailable spawn 是否有余力
 * @param economyPressure 经济压力 (0..1, 0=健康, 1=危机)
 * @param idleTicks 闲置持续 tick 数
 */
export function decideHaulerScaling(
  capacity: RoomCapacityResult,
  spawnAvailable: boolean,
  economyPressure: number,
  idleTicks: number,
): ScalingDecision {
  // 扩编条件：缺 hauler 且 spawn 有余力且经济允许
  if (capacity.haulerGap > 0 && spawnAvailable && economyPressure < EXPAND_ECONOMY_PRESSURE_LIMIT) {
    return {
      action: "expand",
      count: Math.min(capacity.haulerGap, 2), // 每次最多扩 2 个（防止暴增）
      reason: `gap=${capacity.haulerGap}, utilization=${capacity.utilization.toFixed(2)}`,
    };
  }

  // 缩编条件：利用率低且持续闲置
  if (
    capacity.utilization < SHRINK_UTILIZATION_THRESHOLD &&
    idleTicks > 100 &&
    capacity.requiredHaulers < capacity.requiredHaulers // 不会真缩到低于需求
  ) {
    // 只有当 currentHaulerCount > requiredHaulers 时才缩
    const currentHaulers = capacity.requiredHaulers + Math.max(0, -capacity.haulerGap);
    if (currentHaulers > capacity.requiredHaulers) {
      return {
        action: "shrink",
        count: 1, // 每次最多缩 1 个（防止暴降）
        reason: `utilization=${capacity.utilization.toFixed(2)}, idle=${idleTicks}t`,
      };
    }
  }

  return {
    action: "maintain",
    reason: `gap=${capacity.haulerGap}, utilization=${capacity.utilization.toFixed(2)}`,
  };
}

// ─── 批量决策 ─────────────────────────────────────────────

/**
 * 批量决策多房间。
 * 纯函数。
 */
export function batchDecideScaling(
  capacities: readonly RoomCapacityResult[],
  spawnAvailableByRoom: ReadonlyMap<string, boolean>,
  economyPressureByRoom: ReadonlyMap<string, number>,
  idleTicksByRoom: ReadonlyMap<string, number>,
): Map<string, ScalingDecision> {
  const results = new Map<string, ScalingDecision>();
  for (const cap of capacities) {
    const spawnAvailable = spawnAvailableByRoom.get(cap.room) ?? false;
    const economyPressure = economyPressureByRoom.get(cap.room) ?? 1;
    const idleTicks = idleTicksByRoom.get(cap.room) ?? 0;
    results.set(cap.room, decideHaulerScaling(cap, spawnAvailable, economyPressure, idleTicks));
  }
  return results;
}
