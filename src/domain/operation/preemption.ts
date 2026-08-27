/** Preemption Policy */

import type { OperationContext, OperationPriority } from "./agenda-item";
import { isActive } from "./agenda-item";

/**
 * Operation 抢占分类。
 */
export type PreemptionClass =
  | "critical"      // P0 生存级 — 不可抢占
  | "committed"     // carrier 已在途中 — 不可抢占
  | "preemptable"   // 可抢占（低优先级 + carrier 未孵化/未出发）
  | "conditional";  // 条件可抢占（中等优先级 + carrier 已孵化但未出发）

/**
 * 抢占判定结果。
 */
export interface PreemptionResult {
  /** 被抢占的 Operation ID 列表。 */
  preemptedOps: string[];
  /** 释放的总资源量。 */
  releasedAmount: number;
  /** 抢占后仍不足的量。 */
  shortfall: number;
  /** 抢占理由列表（key = opId）。 */
  reasons: Map<string, string>;
}

/**
 * 判定单个 Operation 的抢占分类。

 * @param op Operation 上下文
 * @param carrierInTransit carrier 是否已在途中（不在 source room）

 * 纯函数 — 不访问 Game/Memory。
 */
export function classifyPreemption(
  op: OperationContext,
  carrierInTransit: boolean,
): PreemptionClass {
  // Critical — 不可抢占
  if (op.priority === 0) return "critical";

  // Committed — carrier 已在途中
  if (op.status === "running" && carrierInTransit) return "committed";

  // Preemptable — 低优先级 + carrier 未孵化或未出发
  if (op.priority >= 2) {
    if (op.status === "planned" || op.status === "ready") return "preemptable";
    if (op.status === "running" && !carrierInTransit) return "preemptable";
    if (op.status === "blocked") return "preemptable";
  }

  // Conditional — 中等优先级 + carrier 已孵化但未出发
  if (op.priority === 1) {
    if (op.status === "planned" || op.status === "ready") return "conditional";
    if (op.status === "blocked") return "conditional";
    if (op.status === "running" && !carrierInTransit) return "conditional";
  }

  // running + carrierInTransit 已在 committed 处理
  // verifying / 其他状态 → committed（不抢占）
  return "committed";
}

/**
 * 判定 Operation 是否可被抢占。
 */
export function isPreemptable(
  op: OperationContext,
  carrierInTransit: boolean,
): boolean {
  const cls = classifyPreemption(op, carrierInTransit);
  return cls === "preemptable";
}

/**
 * 判定 Operation 是否可被条件抢占（只在 Critical Request 出现时）。
 */
export function isConditionallyPreemptable(
  op: OperationContext,
  carrierInTransit: boolean,
): boolean {
  const cls = classifyPreemption(op, carrierInTransit);
  return cls === "conditional";
}

/**
 * 尝试抢占资源以满足高优先级需求。

 * 策略：
 *   1. 先尝试抢占所有 preemptable Operation
 *   2. 如果还不够且是 critical 需求，尝试抢占 conditional Operation
 *   3. 不抢占 critical 和 committed Operation

 * @param operations 活跃 Operation 列表
 * @param neededAmount 需要释放的资源量
 * @param requestingPriority 请求抢占的优先级（0=critical 才触发 conditional 抢占）
 * @param carrierInTransitByOp 每个 Operation 的 carrier 是否在途中（key = opId）
 * @returns 抢占结果

 * 纯函数 — 不访问 Game/Memory。
 */
export function attemptPreemption(
  operations: readonly OperationContext[],
  neededAmount: number,
  requestingPriority: OperationPriority,
  carrierInTransitByOp: ReadonlyMap<string, boolean>,
): PreemptionResult {
  const preemptedOps: string[] = [];
  const reasons = new Map<string, string>();
  let releasedAmount = 0;

  // Step 1: 抢占所有 preemptable Operation
  for (const op of operations) {
    if (releasedAmount >= neededAmount) break;
    if (!isActive(op)) continue;

    const carrierInTransit = carrierInTransitByOp.get(op.id) ?? false;
    if (!isPreemptable(op, carrierInTransit)) continue;

    // 释放该 Operation 的预留量
    const reserved = op.reservedAmount;
    if (reserved <= 0) continue;

    preemptedOps.push(op.id);
    releasedAmount += reserved;
    reasons.set(op.id, `preempted: P${op.priority} op, reserved=${reserved}`);
  }

  // Step 2: 如果不够且请求是 critical，尝试 conditional
  if (releasedAmount < neededAmount && requestingPriority === 0) {
    for (const op of operations) {
      if (releasedAmount >= neededAmount) break;
      if (!isActive(op)) continue;

      const carrierInTransit = carrierInTransitByOp.get(op.id) ?? false;
      if (!isConditionallyPreemptable(op, carrierInTransit)) continue;

      const reserved = op.reservedAmount;
      if (reserved <= 0) continue;

      // 不重复抢占
      if (preemptedOps.includes(op.id)) continue;

      preemptedOps.push(op.id);
      releasedAmount += reserved;
      reasons.set(op.id, `conditionally preempted: P1 op for critical request, reserved=${reserved}`);
    }
  }

  const shortfall = Math.max(0, neededAmount - releasedAmount);

  return {
    preemptedOps,
    releasedAmount,
    shortfall,
    reasons,
  };
}
