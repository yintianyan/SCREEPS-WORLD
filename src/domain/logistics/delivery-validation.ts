/** Delivery Validation */

import type { TransportAssignment } from "./transport-assignment";

// ─── 验证结果 ──────────────────────────────────────────────

/**
 * Delivery 验证结果。
 */
export interface DeliveryValidationResult {
  /** 是否验证通过（actualReceived ≥ expectedAmount）。 */
  verified: boolean;
  /** 实际收到量。 */
  actualReceived: number;
  /** 期望收到量。 */
  expectedAmount: number;
  /** 短缺量（expected - actual，正=不足）。 */
  shortfall: number;
  /** 超量交付（actual - expected，正=超量）。 */
  overdelivery: number;
  /** 诊断消息。 */
  message: string;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 验证 Destination 实际收到量。

 * 验证逻辑：
 *   1. actualReceived = destinationAfter - destinationBefore - otherContributions
 *   2. actualReceived ≥ expectedAmount → verified
 *   3. actualReceived < expectedAmount → partial (shortfall > 0)
 *   4. actualReceived > expectedAmount → overdelivery

 * 纯函数 — 不访问 Game/Memory。

 * @param assignment 运输分配（含 expectedAmount = assignedAmount）
 * @param destinationBefore 目标在运输前的资源量
 * @param destinationAfter 目标在运输后的资源量
 * @param otherContributions 其他来源的贡献量（非本 Assignment 的）
 */
export function validateDelivery(
  assignment: TransportAssignment,
  destinationBefore: number,
  destinationAfter: number,
  otherContributions: number,
): DeliveryValidationResult {
  const expectedAmount = assignment.assignedAmount;

  // 实际收到量 = 后 - 前 - 其他来源
  const actualReceived = Math.max(0, destinationAfter - destinationBefore - otherContributions);

  const shortfall = Math.max(0, expectedAmount - actualReceived);
  const overdelivery = Math.max(0, actualReceived - expectedAmount);
  const verified = actualReceived >= expectedAmount;

  let message: string;
  if (verified) {
    message = `verified: ${actualReceived}/${expectedAmount} received`;
    if (overdelivery > 0) {
      message += `, overdelivery=${overdelivery}`;
    }
  } else if (actualReceived > 0) {
    message = `partial: ${actualReceived}/${expectedAmount} received, shortfall=${shortfall}`;
  } else {
    message = `failed: 0/${expectedAmount} received`;
  }

  return {
    verified,
    actualReceived,
    expectedAmount,
    shortfall,
    overdelivery,
    message,
  };
}

/**
 * 验证是否完全交付。
 * 纯函数。
 */
export function isFullyDelivered(result: DeliveryValidationResult): boolean {
  return result.verified && result.overdelivery === 0;
}

/**
 * 验证是否部分交付。
 * 纯函数。
 */
export function isPartialDelivery(result: DeliveryValidationResult): boolean {
  return !result.verified && result.actualReceived > 0;
}

/**
 * 验证是否零交付。
 * 纯函数。
 */
export function isZeroDelivery(result: DeliveryValidationResult): boolean {
  return result.actualReceived === 0;
}

// ─── 批量验证 ─────────────────────────────────────────────

/**
 * 批量验证多个 Assignment 的交付。
 * 输入为 Assignment + 前后快照对的列表。
 * 纯函数。
 */
export function batchValidateDeliveries(
  inputs: readonly {
    assignment: TransportAssignment;
    destinationBefore: number;
    destinationAfter: number;
    otherContributions: number;
  }[],
): Map<string, DeliveryValidationResult> {
  const results = new Map<string, DeliveryValidationResult>();
  for (const input of inputs) {
    const result = validateDelivery(
      input.assignment,
      input.destinationBefore,
      input.destinationAfter,
      input.otherContributions,
    );
    results.set(input.assignment.assignmentId, result);
  }
  return results;
}
