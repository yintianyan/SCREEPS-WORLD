/** Adaptive Routing */

import type { Route } from "./route";

// ─── 输入 / 输出 ──────────────────────────────────────────

/**
 * 最近 trip 记录。
 */
export interface TripRecord {
  /** 是否成功。 */
  success: boolean;
  /** 发生 tick。 */
  tick: number;
}

/**
 * 自适应路由结果。
 */
export interface AdaptiveRoutingResult {
  /** 调整后的可靠性评分 (0..1)。 */
  adjustedReliability: number;
  /** 原始可靠性评分。 */
  originalReliability: number;
  /** 调整幅度。 */
  adjustment: number;
  /** 调整原因。 */
  reason: string;
}

// ─── 配置参数 ──────────────────────────────────────────────

/** 连续失败多少次后施加 penalty。 */
const FAILURE_PENALTY_THRESHOLD = 3;

/** 连续成功多少次后施加 bonus。 */
const SUCCESS_BONUS_THRESHOLD = 5;

/** 每次连续失败的 penalty 幅度。 */
const FAILURE_PENALTY = 0.10;

/** 每次连续成功的 bonus 幅度。 */
const SUCCESS_BONUS = 0.05;

/** 最大 penalty（不超过此值）。 */
const MAX_PENALTY = 0.50;

/** 最大 bonus（不超过此值）。 */
const MAX_BONUS = 0.20;

/** 历史窗口大小（只看最近 N 次 trip）。 */
const HISTORY_WINDOW = 20;

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 根据历史 Success/Failure 动态调整 Route 评分。

 * 算法：
 *   1. 从最近 N 次 trip 中计算连续失败数和连续成功数
 *   2. 连续失败 > 3 → 每次额外扣 10%（上限 50%）
 *   3. 连续成功 > 5 → 每次额外加 5%（上限 20%）
 *   4. 窗口内成功率 → confidence multiplier（0.5..1.0）

 * 纯函数。
 */
export function adaptRouteScore(
  route: Route,
  recentTrips: readonly TripRecord[],
  tick: number,
): AdaptiveRoutingResult {
  const original = route.reliability;

  // 取最近 N 次 trip（按时间倒序）
  const window = recentTrips
    .slice(-HISTORY_WINDOW)
    .sort((a, b) => b.tick - a.tick);

  if (window.length === 0) {
    return {
      adjustedReliability: original,
      originalReliability: original,
      adjustment: 0,
      reason: "no trip history",
    };
  }

  // 计算窗口内成功率
  const successes = window.filter(t => t.success).length;
  const windowSuccessRate = successes / window.length;

  // confidence multiplier：成功率越高，confidence 越接近 1
  const confidence = 0.5 + windowSuccessRate * 0.5;

  // 计算连续失败数（从最近一次往回数）
  let consecutiveFailures = 0;
  for (const trip of window) {
    if (!trip.success) consecutiveFailures++;
    else break;
  }

  // 计算连续成功数
  let consecutiveSuccesses = 0;
  for (const trip of window) {
    if (trip.success) consecutiveSuccesses++;
    else break;
  }

  // 计算 penalty
  let penalty = 0;
  let reasonParts: string[] = [];

  if (consecutiveFailures > FAILURE_PENALTY_THRESHOLD) {
    const excessFailures = consecutiveFailures - FAILURE_PENALTY_THRESHOLD;
    penalty = Math.min(MAX_PENALTY, excessFailures * FAILURE_PENALTY);
    reasonParts.push(`${consecutiveFailures} consecutive failures (-${(penalty * 100).toFixed(0)}%)`);
  }

  // 计算 bonus
  let bonus = 0;
  if (consecutiveSuccesses > SUCCESS_BONUS_THRESHOLD) {
    const excessSuccesses = consecutiveSuccesses - SUCCESS_BONUS_THRESHOLD;
    bonus = Math.min(MAX_BONUS, excessSuccesses * SUCCESS_BONUS);
    reasonParts.push(`${consecutiveSuccesses} consecutive successes (+${(bonus * 100).toFixed(0)}%)`);
  }

  // confidence adjustment
  const confidenceAdjustment = (confidence - 1); // 负数表示降低
  if (confidenceAdjustment < 0) {
    reasonParts.push(`window success rate ${windowSuccessRate.toFixed(2)} (confidence ${confidence.toFixed(2)})`);
  }

  // 最终调整
  const adjustment = bonus - penalty + confidenceAdjustment;
  const adjustedReliability = Math.max(0, Math.min(1, original + adjustment));

  if (reasonParts.length === 0) {
    reasonParts.push("stable");
  }

  return {
    adjustedReliability,
    originalReliability: original,
    adjustment,
    reason: reasonParts.join(", "),
  };
}

// ─── 批量自适应 ────────────────────────────────────────────

/**
 * 批量调整多个 Route 的评分。
 * 纯函数。
 */
export function batchAdaptScores(
  routes: readonly Route[],
  tripsByRoute: ReadonlyMap<string, readonly TripRecord[]>,
  tick: number,
): Map<string, AdaptiveRoutingResult> {
  const results = new Map<string, AdaptiveRoutingResult>();
  for (const route of routes) {
    const trips = tripsByRoute.get(route.routeId) ?? [];
    results.set(route.routeId, adaptRouteScore(route, trips, tick));
  }
  return results;
}
