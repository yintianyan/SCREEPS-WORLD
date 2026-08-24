/**
 * Operation Metrics — A3.0 操作可观测性指标
 *（Observability 合同）。
 *
 * 统计当前所有 Operation 的运行时指标，
 * 供 dashboard / log / 诊断消费。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { OperationContext } from "./agenda-item";
import { isActive, isTerminalStatus } from "./agenda-item";

/** 操作运行时指标快照。 */
export interface OperationMetrics {
  /** 采样 tick。 */
  tick: number;
  /** 活跃 Operation 总数。 */
  activeCount: number;
  /** 终态 Operation 总数（待归档）。 */
  terminalCount: number;
  /** 各状态计数。 */
  byStatus: Record<string, number>;
  /** 总请求量。 */
  totalRequested: number;
  /** 总送达量。 */
  totalDelivered: number;
  /** 总预留量。 */
  totalReserved: number;
  /** 总重试次数。 */
  totalRetries: number;
  /** 平均送达率（0..1）。 */
  fulfillmentRate: number;
  /** 超时 Operation 数。 */
  expiredCount: number;
  /** 失败 Operation 数。 */
  failedCount: number;
  /** 取消 Operation 数。 */
  cancelledCount: number;
  /** 完成率（completed / total）。 */
  completionRate: number;
}

/**
 * 计算 Operation 指标快照。
 *
 * 纯函数 — 不访问 Game/Memory。
 */
export function computeOperationMetrics(
  operations: readonly OperationContext[],
  tick: number,
): OperationMetrics {
  let activeCount = 0;
  let terminalCount = 0;
  let totalRequested = 0;
  let totalDelivered = 0;
  let totalReserved = 0;
  let totalRetries = 0;
  let expiredCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let completedCount = 0;
  const byStatus: Record<string, number> = {};

  for (const op of operations) {
    byStatus[op.status] = (byStatus[op.status] ?? 0) + 1;

    if (isActive(op)) {
      activeCount++;
    } else {
      terminalCount++;
    }

    totalRequested += op.requestedAmount;
    totalDelivered += op.deliveredAmount;
    totalReserved += op.reservedAmount;
    totalRetries += op.retries;

    switch (op.status) {
      case "expired": expiredCount++; break;
      case "failed": failedCount++; break;
      case "cancelled": cancelledCount++; break;
      case "completed": completedCount++; break;
    }
  }

  const totalCount = operations.length;

  return {
    tick,
    activeCount,
    terminalCount,
    byStatus,
    totalRequested,
    totalDelivered,
    totalReserved,
    totalRetries,
    fulfillmentRate: totalRequested > 0 ? totalDelivered / totalRequested : 0,
    expiredCount,
    failedCount,
    cancelledCount,
    completionRate: totalCount > 0 ? completedCount / totalCount : 0,
  };
}

/**
 * 格式化指标为人类可读摘要（供控制台输出）。
 */
export function formatOperationMetrics(m: OperationMetrics): string {
  const lines = [
    "Agenda Manager",
    "---------------------",
    `Active: ${m.activeCount}  Terminal: ${m.terminalCount}`,
    `Requested: ${m.totalRequested.toLocaleString()}  Delivered: ${m.totalDelivered.toLocaleString()}  Fulfillment: ${(m.fulfillmentRate * 100).toFixed(1)}%`,
    `Completed: ${((m.completionRate) * 100).toFixed(1)}%  Expired: ${m.expiredCount}  Failed: ${m.failedCount}  Cancelled: ${m.cancelledCount}`,
    `Retries: ${m.totalRetries}`,
  ];
  return lines.join("\n");
}
