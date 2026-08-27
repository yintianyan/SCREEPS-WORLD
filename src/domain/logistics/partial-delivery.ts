/** Partial Delivery */

import type { TransportRequestV2 } from "./transport-request";
import { createRequest } from "./transport-request";

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 交付 < 需求 → 自动生成 Remaining Demand。

 * 创建新的 TransportRequestV2，amount = original.amount - deliveredAmount。
 * 新 Request 继承原始 Request 的所有属性（resource/source/destination/priority/scope），
 * 但 deadline 可能缩短（剩余时间的 80%）。

 * 纯函数。

 * @param original 原始 Request
 * @param deliveredAmount 已交付量
 * @param tick 当前 tick
 * @returns 新的剩余 Request（amount=0 时返回 undefined）
 */
export function createRemainingRequest(
  original: TransportRequestV2,
  deliveredAmount: number,
  tick: number,
): TransportRequestV2 | undefined {
  const remaining = Math.max(0, original.amount - deliveredAmount);

  // 无剩余 → 不需要新 Request
  if (remaining <= 0) return undefined;

  // 剩余时间
  const remainingTime = Math.max(100, original.deadline - tick);
  // 新 deadline：剩余时间的 80%（加紧迫感）
  const newDeadline = tick + Math.floor(remainingTime * 0.8);

  return createRequest(
    original.resource,
    remaining,
    original.source,
    original.destination,
    original.priority,
    original.scope,
    newDeadline,
    tick,
    `${original.origin}:remaining`,
    original.minBatch,
    original.maxBatch,
    original.routePreference,
  );
}

/**
 * 批量生成剩余需求。
 * 纯函数。
 */
export function batchCreateRemaining(
  requests: readonly { request: TransportRequestV2; deliveredAmount: number }[],
  tick: number,
): TransportRequestV2[] {
  const remaining: TransportRequestV2[] = [];
  for (const { request, deliveredAmount } of requests) {
    const r = createRemainingRequest(request, deliveredAmount, tick);
    if (r) remaining.push(r);
  }
  return remaining;
}

/**
 * 判断是否需要生成剩余需求。
 * 纯函数。
 */
export function needsRemainingRequest(
  originalAmount: number,
  deliveredAmount: number,
): boolean {
  return deliveredAmount < originalAmount;
}
