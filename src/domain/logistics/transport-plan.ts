/** Transport Plan */

import type { TransportRequestV2 } from "./transport-request";
import type { TransportAssignment } from "./transport-assignment";
import type { Route } from "./route";

// ─── Transport Plan 模型 ───────────────────────────────────

/**
 * Transport Plan — 运输计划。
 */
export interface TransportPlan {
  /** 本周期 Transport Requests。 */
  requests: TransportRequestV2[];
  /** 推荐 Assignments（由系统侧执行）。 */
  assignments: TransportAssignment[];
  /** 推荐 Routes。 */
  routes: Route[];
  /** 预估总成本。 */
  estimatedCost: number;
  /** 预估总运输时间（tick）。 */
  estimatedTime: number;
  /** 风险评估 (0..1, 0=无风险)。 */
  risk: number;
  /** 预期交付量。 */
  expectedDelivery: number;
  /** 规划 tick。 */
  plannedAt: number;
  /** 规划原因。 */
  reason: string;
}

// ─── 创建 ──────────────────────────────────────────────────

/**
 * 创建空 Transport Plan。
 * 纯函数。
 */
export function createEmptyPlan(tick: number, reason: string): TransportPlan {
  return {
    requests: [],
    assignments: [],
    routes: [],
    estimatedCost: 0,
    estimatedTime: 0,
    risk: 0,
    expectedDelivery: 0,
    plannedAt: tick,
    reason,
  };
}
