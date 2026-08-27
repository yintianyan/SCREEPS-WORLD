/** Emergency Logistics */

import type { TransportRequestV2 } from "./transport-request";

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 将 Request 提升为紧急级别。
 * priority → 0, deadline 缩短。
 * 纯函数 — 返回新对象。
 */
export function escalateToEmergency(
  request: TransportRequestV2,
  tick: number,
  emergencyDeadlineTicks: number = 500,
): TransportRequestV2 {
  return {
    ...request,
    priority: 0,
    deadline: Math.min(request.deadline, tick + emergencyDeadlineTicks),
    minBatch: Math.max(1, Math.floor(request.minBatch / 2)), // 紧急时降低最小批量
    updatedAt: tick,
  };
}

/**
 * 判断 Request 是否为紧急。
 * 纯函数。
 */
export function isEmergency(request: TransportRequestV2): boolean {
  return request.priority === 0;
}

/**
 * 批量提升紧急级别。
 * 纯函数。
 */
export function batchEscalateToEmergency(
  requests: readonly TransportRequestV2[],
  tick: number,
  emergencyDeadlineTicks?: number,
): TransportRequestV2[] {
  return requests.map(r => escalateToEmergency(r, tick, emergencyDeadlineTicks));
}
