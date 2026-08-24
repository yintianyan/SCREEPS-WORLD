/**
 * Transfer Verification — A3.0 跨房调拨验证纯函数
 *（PLANNING_ARCHITECTURE §3 验证阶段）。
 *
 * 验证逻辑：
 *   1. 记录 Operation 开始时 target 房间的 storage 能量快照
 *   2. Carrier 报告到达后，比较当前 storage 能量与快照
 *   3. 增量 ≥ expectedDelta → 验证通过
 *   4. 增量 < expectedDelta → 部分满足（继续调度或超时取消）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { OperationContext } from "./agenda-item";

/** 验证结果。 */
export interface VerificationResult {
  /** 是否验证通过。 */
  verified: boolean;
  /** 实际增量。 */
  actualDelta: number;
  /** 期望增量。 */
  expectedDelta: number;
  /** 剩余未送达量。 */
  remaining: number;
  /** 诊断消息。 */
  message: string;
}

/**
 * 计算期望增量 = requestedAmount - deliveredAmount。
 */
export function computeExpectedDelta(op: OperationContext): number {
  return Math.max(0, op.requestedAmount - op.deliveredAmount);
}

/**
 * 验证调拨送达 — 比较 target 房间 storage 增量。
 *
 * @param op 当前操作上下文
 * @param currentStorageEnergy target 房间当前 storage 能量
 * @param baselineEnergy Operation 开始时的 storage 能量快照
 * @param tick 当前 tick
 *
 * 纯函数 — 不访问 Game/Memory。
 */
export function verifyTransfer(
  op: OperationContext,
  currentStorageEnergy: number,
  baselineEnergy: number,
  tick: number,
): VerificationResult {
  const expectedDelta = computeExpectedDelta(op);
  const actualDelta = Math.max(0, currentStorageEnergy - baselineEnergy);
  const remaining = Math.max(0, expectedDelta - actualDelta);

  if (actualDelta >= expectedDelta) {
    return {
      verified: true,
      actualDelta,
      expectedDelta,
      remaining: 0,
      message: `verified: ${actualDelta}/${expectedDelta} delivered`,
    };
  }

  if (actualDelta > 0) {
    return {
      verified: false,
      actualDelta,
      expectedDelta,
      remaining,
      message: `partial: ${actualDelta}/${expectedDelta} delivered, ${remaining} remaining`,
    };
  }

  // actualDelta = 0 — Carrier 可能尚未到达或 target 被消耗
  // 给予宽限：deadline 前继续等待
  if (tick > op.deadline) {
    return {
      verified: false,
      actualDelta: 0,
      expectedDelta,
      remaining: expectedDelta,
      message: `timeout: 0/${expectedDelta} delivered at tick ${tick}`,
    };
  }

  return {
    verified: false,
    actualDelta: 0,
    expectedDelta,
    remaining: expectedDelta,
    message: `pending: 0/${expectedDelta} delivered, waiting for carrier`,
  };
}

/**
 * 判断是否应该放弃验证（超时 + 零增量）。
 */
export function shouldAbortVerification(
  op: OperationContext,
  tick: number,
): boolean {
  if (op.status !== "verifying") return false;
  return tick > op.deadline && op.deliveredAmount === 0;
}

/**
 * 判断是否应该部分满足后收尾（增量 > 0 但未达目标 + 超时）。
 */
export function shouldPartialComplete(
  op: OperationContext,
  tick: number,
): boolean {
  if (op.status !== "verifying") return false;
  return tick > op.deadline && op.deliveredAmount > 0 && op.deliveredAmount < op.requestedAmount;
}
