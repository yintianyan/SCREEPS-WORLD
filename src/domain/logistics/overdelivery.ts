/** Overdelivery Handling */

import type { TransportRequestV2 } from "./transport-request";

// ─── 结果 ──────────────────────────────────────────────────

/**
 * Overdelivery 处理结果。
 */
export interface OverdeliveryResult {
  /** 超量量。 */
  excess: number;
  /** 调整后的 Request（status → delivered）。 */
  adjusted: TransportRequestV2;
  /** 消息。 */
  message: string;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 处理超量交付。

 * 交付 > 需求时：
 *   1. 不撤销已交付资源（无法撤销）
 *   2. 将 Request 标记为 delivered（已完成）
 *   3. 记录 excess 量供后续 Demand 抵扣

 * 纯函数。
 */
export function handleOverdelivery(
  request: TransportRequestV2,
  deliveredAmount: number,
  tick: number,
): OverdeliveryResult {
  const excess = Math.max(0, deliveredAmount - request.amount);

  const adjusted: TransportRequestV2 = {
    ...request,
    status: "delivered",
    updatedAt: tick,
  };

  const message = excess > 0
    ? `overdelivery: ${deliveredAmount}/${request.amount} delivered, excess=${excess}`
    : `exact delivery: ${deliveredAmount}/${request.amount}`;

  return {
    excess,
    adjusted,
    message,
  };
}

/**
 * 批量处理超量交付。
 * 纯函数。
 */
export function batchHandleOverdelivery(
  inputs: readonly { request: TransportRequestV2; deliveredAmount: number }[],
  tick: number,
): OverdeliveryResult[] {
  return inputs.map(({ request, deliveredAmount }) =>
    handleOverdelivery(request, deliveredAmount, tick),
  );
}

/**
 * 计算 Empire 级总超量。
 * 纯函数。
 */
export function totalExcess(results: readonly OverdeliveryResult[]): number {
  let total = 0;
  for (const r of results) {
    total += r.excess;
  }
  return total;
}
