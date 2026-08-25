/**
 * Emergency Logistics — A4.3 Phase 5：紧急物流。
 *
 * 合同锚点：A4.3 Architecture Audit §10 #29。
 *
 * 设计意图：
 *   提高 Priority 但不绕过 Resource Network。
 *   紧急时将 Request 优先级提升到 P0，但不创建新的独立运输链。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

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
