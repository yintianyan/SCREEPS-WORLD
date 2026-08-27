/** Route Suspension / Recovery */

import type { Route, RouteStatus } from "./route";

// ─── 配置参数 ──────────────────────────────────────────────

/**
 * Route Suspension 参数。
 */
export interface SuspensionConfig {
  /** 连续 N 次评估 ratio < maintainThreshold → suspend。 */
  suspendAfter: number;
  /** 连续 M 次评估 ratio ≥ maintainThreshold → resume。 */
  resumeAfter: number;
  /** 维持阈值——低于此值建议寻找替代方案。 */
  maintainThreshold: number;
}

/**
 * 默认暂停参数。
 */
export const DEFAULT_SUSPENSION_CONFIG: SuspensionConfig = {
  suspendAfter: 5,
  resumeAfter: 3,
  maintainThreshold: 2.0,
};

// ─── 评估结果 ──────────────────────────────────────────────

/**
 * Route Suspension 评估结果。
 */
export interface SuspensionEvaluation {
  /** 建议的动作。 */
  action: "suspend" | "resume" | "maintain";
  /** 原因。 */
  reason: string;
  /** 建议的新状态。 */
  newStatus: RouteStatus;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 评估路由是否应该暂停或恢复。

 * 输入：路由的效率历史（最近 N 次评估的 ratio 值）。

 * 算法：
 *   1. 如果路由已 suspended：
 *      - 连续 resumeAfter 次 ratio ≥ maintainThreshold → resume
 *   2. 如果路由已 active：
 *      - 连续 suspendAfter 次 ratio < maintainThreshold → suspend
 *   3. 否则维持现状

 * 纯函数。

 * @param route 当前路由
 * @param efficiencyHistory 效率历史（最近 N 次评估的 ratio 值，按时间正序）
 * @param config 暂停参数
 */
export function evaluateRouteSuspension(
  route: Route,
  efficiencyHistory: readonly number[],
  config: SuspensionConfig = DEFAULT_SUSPENSION_CONFIG,
): SuspensionEvaluation {
  const status = route.status;

  // 终态路由不评估
  if (status === "failed") {
    return {
      action: "maintain",
      reason: "route is terminal (failed)",
      newStatus: "failed",
    };
  }

  // 已暂停 → 检查恢复条件
  if (status === "suspended") {
    const consecutiveGood = countConsecutiveAbove(
      efficiencyHistory,
      config.maintainThreshold,
    );
    if (consecutiveGood >= config.resumeAfter) {
      return {
        action: "resume",
        reason: `${consecutiveGood} consecutive evaluations above threshold ${config.maintainThreshold}`,
        newStatus: "active",
      };
    }
    return {
      action: "maintain",
      reason: `suspended, ${consecutiveGood}/${config.resumeAfter} good evaluations`,
      newStatus: "suspended",
    };
  }

  // 已 blocked → 不自动暂停/恢复
  if (status === "blocked") {
    return {
      action: "maintain",
      reason: "route is blocked",
      newStatus: "blocked",
    };
  }

  // active / congested / degraded → 检查暂停条件
  const consecutiveBad = countConsecutiveBelow(
    efficiencyHistory,
    config.maintainThreshold,
  );
  if (consecutiveBad >= config.suspendAfter) {
    return {
      action: "suspend",
      reason: `${consecutiveBad} consecutive evaluations below threshold ${config.maintainThreshold}`,
      newStatus: "suspended",
    };
  }

  return {
    action: "maintain",
    reason: `${consecutiveBad} consecutive below threshold (need ${config.suspendAfter})`,
    newStatus: status,
  };
}

// ─── 批量评估 ─────────────────────────────────────────────

/**
 * 批量评估多路由的暂停/恢复。
 * 纯函数。
 */
export function batchEvaluateSuspension(
  routes: readonly Route[],
  efficiencyHistoryByRoute: ReadonlyMap<string, readonly number[]>,
  config: SuspensionConfig = DEFAULT_SUSPENSION_CONFIG,
): Map<string, SuspensionEvaluation> {
  const results = new Map<string, SuspensionEvaluation>();
  for (const route of routes) {
    const history = efficiencyHistoryByRoute.get(route.routeId) ?? [];
    results.set(route.routeId, evaluateRouteSuspension(route, history, config));
  }
  return results;
}

// ─── 内部工具 ──────────────────────────────────────────────

/**
 * 从历史末尾开始数连续低于阈值的次数。
 */
function countConsecutiveBelow(
  history: readonly number[],
  threshold: number,
): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]! < threshold) count++;
    else break;
  }
  return count;
}

/**
 * 从历史末尾开始数连续高于阈值的次数。
 */
function countConsecutiveAbove(
  history: readonly number[],
  threshold: number,
): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]! >= threshold) count++;
    else break;
  }
  return count;
}
