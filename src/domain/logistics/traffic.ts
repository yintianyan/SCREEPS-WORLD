/** Traffic Detection */

// ─── 输入 / 输出 ──────────────────────────────────────────

/**
 * Traffic 检测结果。
 */
export interface TrafficResult {
  /** 拥堵评分 (0..1, 0=畅通, 1=严重拥堵)。 */
  penalty: number;
  /** 是否拥堵。 */
  congested: boolean;
  /** 拥堵程度。 */
  level: TrafficLevel;
  /** 诊断消息。 */
  message: string;
}

/**
 * 拥堵程度。
 */
export type TrafficLevel =
  | "clear"       // 0 haulers or under capacity
  | "light"       // at capacity
  | "moderate"    // 1.5× capacity
  | "heavy"       // 2× capacity
  | "severe";     // 3×+ capacity

// ─── 配置参数 ──────────────────────────────────────────────

/**
 * 每路由容量——同一路由上同时能容纳多少 hauler 而不拥堵。
 * 经验值：1 hop ≈ 50 tiles，1 hauler 占 1 tile，所以每 hop 容纳 ~50 hauler。
 * 实际中远低于此值（交叉路口、swamp 等），保守取 10/hop。
 */
const HAULER_CAPACITY_PER_HOP = 10;

/**
 * 惩罚系数。每超出 1 个 hauler 的惩罚量。
 */
const PENALTY_PER_EXCESS = 0.05;

/**
 * 最大惩罚。
 */
const MAX_PENALTY = 1.0;

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 计算交通惩罚。

 * @param routeId 路由 ID
 * @param activeHaulerCount 当前在该路由上的 hauler 数量
 * @param routeCapacity 路由容量（可用 hops × HAULER_CAPACITY_PER_HOP 计算）

 * 纯函数。
 */
export function computeTrafficPenalty(
  routeId: string,
  activeHaulerCount: number,
  routeCapacity: number,
): TrafficResult {
  const capacity = Math.max(1, routeCapacity);
  const count = Math.max(0, activeHaulerCount);

  if (count <= 0) {
    return {
      penalty: 0,
      congested: false,
      level: "clear",
      message: `route ${routeId}: no traffic`,
    };
  }

  // 计算拥堵程度
  const ratio = count / capacity;
  let level: TrafficLevel;
  let penalty: number;

  if (ratio <= 1.0) {
    level = "clear";
    penalty = 0;
  } else if (ratio <= 1.5) {
    level = "light";
    penalty = (ratio - 1.0) * PENALTY_PER_EXCESS * 10;
  } else if (ratio <= 2.0) {
    level = "moderate";
    penalty = 0.15 + (ratio - 1.5) * PENALTY_PER_EXCESS * 10;
  } else if (ratio <= 3.0) {
    level = "heavy";
    penalty = 0.30 + (ratio - 2.0) * PENALTY_PER_EXCESS * 10;
  } else {
    level = "severe";
    penalty = Math.min(MAX_PENALTY, 0.50 + (ratio - 3.0) * PENALTY_PER_EXCESS * 10);
  }

  penalty = Math.min(MAX_PENALTY, penalty);
  const congested = level !== "clear";

  return {
    penalty,
    congested,
    level,
    message: `route ${routeId}: ${count}/${capacity} haulers, ${level} (penalty=${penalty.toFixed(3)})`,
  };
}

/**
 * 根据 hops 计算路由容量。
 * 纯函数。
 */
export function computeRouteCapacity(hops: number): number {
  return Math.max(1, hops * HAULER_CAPACITY_PER_HOP);
}

// ─── 批量计算 ─────────────────────────────────────────────

/**
 * 批量计算多路由的交通惩罚。
 * 纯函数。
 */
export function batchComputeTraffic(
  routes: readonly { routeId: string; hops: number }[],
  haulerCountByRoute: ReadonlyMap<string, number>,
): Map<string, TrafficResult> {
  const results = new Map<string, TrafficResult>();
  for (const route of routes) {
    const haulerCount = haulerCountByRoute.get(route.routeId) ?? 0;
    const capacity = computeRouteCapacity(route.hops);
    results.set(route.routeId, computeTrafficPenalty(route.routeId, haulerCount, capacity));
  }
  return results;
}

/**
 * 判断是否需要因交通拥堵而限制新 hauler 分配。
 * 纯函数。
 */
export function shouldThrottleHaulers(
  result: TrafficResult,
): boolean {
  return result.level === "heavy" || result.level === "severe";
}
