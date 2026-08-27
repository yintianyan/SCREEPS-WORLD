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

/**
 * 合并两个 Transport Plan。
 * 纯函数。
 */
export function mergePlans(a: TransportPlan, b: TransportPlan): TransportPlan {
  return {
    requests: [...a.requests, ...b.requests],
    assignments: [...a.assignments, ...b.assignments],
    routes: [...a.routes, ...b.routes],
    estimatedCost: a.estimatedCost + b.estimatedCost,
    estimatedTime: Math.max(a.estimatedTime, b.estimatedTime),
    risk: Math.max(a.risk, b.risk),
    expectedDelivery: a.expectedDelivery + b.expectedDelivery,
    plannedAt: Math.max(a.plannedAt, b.plannedAt),
    reason: `${a.reason}; ${b.reason}`,
  };
}

/**
 * 计算 Plan 的汇总指标。
 * 纯函数。
 */
export function summarizePlan(plan: TransportPlan): {
  requestCount: number;
  assignmentCount: number;
  routeCount: number;
  totalAmount: number;
  totalAssigned: number;
  avgCost: number;
} {
  const totalAmount = plan.requests.reduce((s, r) => s + r.amount, 0);
  const totalAssigned = plan.assignments.reduce((s, a) => s + a.assignedAmount, 0);
  const avgCost = plan.requests.length > 0 ? plan.estimatedCost / plan.requests.length : 0;
  return {
    requestCount: plan.requests.length,
    assignmentCount: plan.assignments.length,
    routeCount: plan.routes.length,
    totalAmount,
    totalAssigned,
    avgCost,
  };
}
