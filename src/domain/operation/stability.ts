/** Plan Stability Policy */

import type { OperationContext } from "./agenda-item";
import { isActive } from "./agenda-item";
import type { NetworkSnapshot } from "./network-snapshot";

/** Operation Hysteresis：创建后至少保持的 tick 数。 */
const OPERATION_HYSTERESIS_TICKS = 200;

/** Minimum Commitment：carrier 孵化后至少完成的运输次数。 */
const MINIMUM_COMMITMENT_RUNS = 1;

/** Rebalance Threshold：变化量低于此比例不触发 rebalance。 */
const REBALANCE_THRESHOLD = 0.1;

/** Rebalance Cooldown：两次 rebalance 之间最少间隔 tick 数。 */
const REBALANCE_COOLDOWN_TICKS = 200;

/**
 * 判定 Operation 是否处于 hysteresis 保护期（创建后 N tick 内不可取消）。

 * 纯函数。
 */
export function isInHysteresis(op: OperationContext, tick: number): boolean {
  return tick - op.createdAt < OPERATION_HYSTERESIS_TICKS;
}

/**
 * 判定 Operation 是否已满足 minimum commitment（carrier 至少完成一次运输）。

 * @param op Operation 上下文
 * @param carrierHasRun carrier 是否已完成至少一次运输
 */
export function hasMinimumCommitment(
  op: OperationContext,
  carrierHasRun: boolean,
): boolean {
  if (op.deliveredAmount > 0) return true;
  if (carrierHasRun) return true;
  return false;
}

/**
 * 判定是否应该取消某 Operation（综合 hysteresis + commitment）。

 * 纯函数。
 */
export function shouldCancelOperation(
  op: OperationContext,
  tick: number,
  carrierHasRun: boolean,
): boolean {
  if (!isActive(op)) return false;

  // Hysteresis 保护期
  if (isInHysteresis(op, tick)) return false;

  // Minimum Commitment
  if (op.carrierName && !hasMinimumCommitment(op, carrierHasRun)) return false;

  return true;
}

/**
 * 判定是否应该触发 rebalance。

 * 四防线之三：Rebalance Threshold + Cooldown

 * @param current 当前快照
 * @param previous 上次快照
 * @param lastRebalanceTick 上次 rebalance tick
 * @param tick 当前 tick

 * 纯函数。
 */
export function shouldRebalance(
  current: NetworkSnapshot,
  previous: NetworkSnapshot | undefined,
  lastRebalanceTick: number,
  tick: number,
): boolean {
  // 第一次 — 必须规划
  if (!previous) return true;

  // Cooldown：两次 rebalance 之间最少间隔
  if (tick - lastRebalanceTick < REBALANCE_COOLDOWN_TICKS) return false;

  // Threshold：变化量低于阈值不触发
  const supplyDelta = Math.abs(current.totalSupply - previous.totalSupply);
  const demandDelta = Math.abs(current.totalRemaining - previous.totalRemaining);

  const supplyPct = previous.totalSupply > 0 ? supplyDelta / previous.totalSupply : 0;
  const demandPct = previous.totalRemaining > 0 ? demandDelta / previous.totalRemaining : 0;

  if (supplyPct < REBALANCE_THRESHOLD && demandPct < REBALANCE_THRESHOLD) return false;

  // 供需缺口方向反转
  if (Math.sign(current.gap) !== Math.sign(previous.gap) && current.gap !== 0) return true;

  // Operation 数量变化超过 2
  if (Math.abs(current.activeOperationCount - previous.activeOperationCount) > 2) return true;

  return supplyPct >= REBALANCE_THRESHOLD || demandPct >= REBALANCE_THRESHOLD;
}

/**
 * 计算防抖参数（供系统侧查询）。
 */
export function getStabilityParams(): {
  hysteresisTicks: number;
  minimumCommitmentRuns: number;
  rebalanceThreshold: number;
  rebalanceCooldown: number;
} {
  return {
    hysteresisTicks: OPERATION_HYSTERESIS_TICKS,
    minimumCommitmentRuns: MINIMUM_COMMITMENT_RUNS,
    rebalanceThreshold: REBALANCE_THRESHOLD,
    rebalanceCooldown: REBALANCE_COOLDOWN_TICKS,
  };
}
