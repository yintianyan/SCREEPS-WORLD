/**
 * Empire Logistics Dashboard — A4.3 Phase 6：全链路可观测性。
 *
 * 合同锚点：A4.3 Architecture Audit §10 #34。
 *
 * 设计意图：
 *   全链路可观测性仪表盘，汇总 Transport Requests / Assignments / Haulers /
 *   Capacity / Utilization / Routes / Cost / Reliability / Backlog / Delivery Rate /
 *   Loss / Starvation / Bottleneck / Health。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { TransportRequestV2 } from "./transport-request";
import type { TransportAssignment } from "./transport-assignment";
import type { Route } from "./route";
import type { TransportAccounting } from "./transport-accounting";
import { summarizeAccounting } from "./transport-accounting";
import type { BottleneckResult } from "./bottleneck";
import type { LogisticsHealthResult } from "./logistics-health";

// ─── Dashboard 模型 ───────────────────────────────────────

/**
 * Empire Logistics Dashboard — 全链路可观测性。
 */
export interface LogisticsDashboard {
  /** 采样 tick。 */
  tick: number;
  // Transport Requests
  totalRequests: number;
  requestsByStatus: Record<string, number>;
  // Transport Assignments
  totalAssignments: number;
  assignmentsByStatus: Record<string, number>;
  // Haulers
  totalHaulers: number;
  totalCarriers: number;
  totalCapacity: number;
  utilizedCapacity: number;
  utilization: number;
  // Routes
  totalRoutes: number;
  routesByStatus: Record<string, number>;
  avgReliability: number;
  // Cost
  totalCost: number;
  totalDelivered: number;
  avgROI: number;
  // Backlog
  backlogRequests: number;
  backlogAmount: number;
  // Delivery
  deliveryRate: number;
  lossRate: number;
  avgLatency: number;
  // Starvation
  starvingRooms: string[];
  // Bottleneck
  bottlenecks: BottleneckResult[];
  // Health
  health: LogisticsHealthResult;
}

// ─── 构建 Dashboard ────────────────────────────────────────

/**
 * 构建 Empire Logistics Dashboard。
 *
 * 纯函数。
 */
export function buildDashboard(
  requests: readonly TransportRequestV2[],
  assignments: readonly TransportAssignment[],
  routes: readonly Route[],
  accounting: readonly TransportAccounting[],
  haulers: readonly { capacity: number; idle: boolean }[],
  bottlenecks: readonly BottleneckResult[],
  health: LogisticsHealthResult,
  tick: number,
): LogisticsDashboard {
  // Requests by status
  const requestsByStatus: Record<string, number> = {};
  for (const r of requests) {
    requestsByStatus[r.status] = (requestsByStatus[r.status] ?? 0) + 1;
  }

  // Assignments by status
  const assignmentsByStatus: Record<string, number> = {};
  for (const a of assignments) {
    assignmentsByStatus[a.status] = (assignmentsByStatus[a.status] ?? 0) + 1;
  }

  // Routes by status
  const routesByStatus: Record<string, number> = {};
  for (const r of routes) {
    routesByStatus[r.status] = (routesByStatus[r.status] ?? 0) + 1;
  }

  // Hauler stats
  const totalCapacity = haulers.reduce((s, h) => s + h.capacity, 0);
  const utilizedCapacity = haulers.filter(h => !h.idle).reduce((s, h) => s + h.capacity, 0);

  // Route reliability
  const avgReliability = routes.length > 0
    ? routes.reduce((s, r) => s + r.reliability, 0) / routes.length
    : 1;

  // Accounting summary
  const accSummary = summarizeAccounting(accounting);

  // Backlog
  const activeRequests = requests.filter(r =>
    r.status !== "delivered" && r.status !== "failed" && r.status !== "cancelled",
  );
  const backlogAmount = activeRequests.reduce((s, r) => s + r.amount, 0);

  // Starving rooms
  const starvingRooms = bottlenecks
    .filter(b => b.severity > 0.7)
    .map(b => b.room);

  // Avg ROI
  const avgROI = accSummary.totalCost > 0
    ? accSummary.totalDelivered / accSummary.totalCost
    : 0;

  return {
    tick,
    totalRequests: requests.length,
    requestsByStatus,
    totalAssignments: assignments.length,
    assignmentsByStatus,
    totalHaulers: haulers.filter(h => !h.idle).length,
    totalCarriers: haulers.length,
    totalCapacity,
    utilizedCapacity,
    utilization: totalCapacity > 0 ? utilizedCapacity / totalCapacity : 0,
    totalRoutes: routes.length,
    routesByStatus,
    avgReliability,
    totalCost: accSummary.totalCost,
    totalDelivered: accSummary.totalDelivered,
    avgROI,
    backlogRequests: activeRequests.length,
    backlogAmount,
    deliveryRate: accSummary.avgDeliveryRate,
    lossRate: accSummary.avgLossRate,
    avgLatency: health.avgLatency,
    starvingRooms,
    bottlenecks: [...bottlenecks],
    health,
  };
}

/**
 * 格式化 Dashboard 为人类可读摘要（供控制台输出）。
 * 纯函数。
 */
export function formatDashboard(d: LogisticsDashboard): string {
  const lines = [
    "Logistics Dashboard",
    "===================",
    `Tick: ${d.tick}  Health: ${d.health.level} (${d.health.score.toFixed(2)})`,
    "",
    "Requests:",
    `  Total: ${d.totalRequests}  Active: ${d.backlogRequests}  Backlog: ${d.backlogAmount}`,
    `  By Status: ${JSON.stringify(d.requestsByStatus)}`,
    "",
    "Assignments:",
    `  Total: ${d.totalAssignments}`,
    `  By Status: ${JSON.stringify(d.assignmentsByStatus)}`,
    "",
    "Haulers:",
    `  Active: ${d.totalHaulers}  Total: ${d.totalCarriers}`,
    `  Capacity: ${d.utilizedCapacity}/${d.totalCapacity} (${(d.utilization * 100).toFixed(1)}%)`,
    "",
    "Routes:",
    `  Total: ${d.totalRoutes}  Avg Reliability: ${(d.avgReliability * 100).toFixed(1)}%`,
    `  By Status: ${JSON.stringify(d.routesByStatus)}`,
    "",
    "Delivery:",
    `  Rate: ${(d.deliveryRate * 100).toFixed(1)}%  Loss: ${(d.lossRate * 100).toFixed(1)}%`,
    `  Delivered: ${d.totalDelivered}  Cost: ${d.totalCost}  ROI: ${d.avgROI.toFixed(2)}`,
    "",
    "Issues:",
    `  Starving: ${d.starvingRooms.join(", ") || "none"}`,
    `  Bottlenecks: ${d.bottlenecks.length}`,
  ];
  return lines.join("\n");
}
