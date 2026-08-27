/** Death Recovery */

import type { TransportAssignment } from "./transport-assignment";
import type { TransportRequestV2 } from "./transport-request";
import type { CargoLossEvent } from "./cargo-loss";
import type { TransportAccounting } from "./transport-accounting";
import { recordLost } from "./transport-accounting";
import { remainingAmount } from "./transport-request";

// ─── Death Recovery Plan ──────────────────────────────────

/**
 * Death Recovery 全链计划。
 */
export interface DeathRecoveryPlan {
  /** 步骤 1: 标记 Assignment 失败。 */
  failAssignmentId: string | undefined;
  /** 步骤 2: Cargo Reconciliation（cargo loss 计入 accounting）。 */
  cargoLoss: CargoLossEvent | undefined;
  /** 步骤 3: Demand Recalculation（remaining 重新计算）。 */
  remainingDemand: number;
  /** 步骤 4: New Assignment（如有替代 hauler）。 */
  replacementNeeded: boolean;
  /** 步骤 5: Replacement Spawn Request（如需新 hauler）。 */
  spawnRequestNeeded: boolean;
  /** 诊断消息。 */
  message: string;
}

// ─── 输入 ──────────────────────────────────────────────────

/**
 * Death Recovery 输入。
 */
export interface DeathRecoveryInput {
  /** 死亡 creep 名称。 */
  creepName: string;
  /** 死亡 creep 的角色。 */
  role: string;
  /** 关联的 Assignment（如有）。 */
  assignment: TransportAssignment | undefined;
  /** 关联的 Request（如有）。 */
  request: TransportRequestV2 | undefined;
  /** 当前 Transport Accounting（如有）。 */
  accounting: TransportAccounting | undefined;
  /** 死亡时 cargo 数量。 */
  cargoAmount: number;
  /** 死亡房间。 */
  deathRoom: string;
  /** 死亡位置。 */
  deathPos: { x: number; y: number };
  /** 是否可回收（tombstone）。 */
  recoverable: boolean;
  /** 当前 tick。 */
  tick: number;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 规划 Hauler 死亡恢复全链。

 * 链路：
 *   1. Assignment Failure → 标记 Assignment 为 failed
 *   2. Cargo Reconciliation → cargo loss 计入 accounting
 *   3. Demand Recalculation → 重新计算 remaining demand
 *   4. New Assignment → 是否需要替代 hauler
 *   5. Replacement Spawn → 是否需要 spawn 新 hauler

 * 纯函数 — 不访问 Game/Memory。
 */
export function planDeathRecovery(input: DeathRecoveryInput): DeathRecoveryPlan {
  const {
    creepName,
    role,
    assignment,
    request,
    accounting,
    cargoAmount,
    deathRoom,
    deathPos,
    recoverable,
    tick,
  } = input;

  // 步骤 1: 标记 Assignment 失败
  const failAssignmentId = assignment?.assignmentId;

  // 步骤 2: Cargo Reconciliation
  let cargoLoss: CargoLossEvent | undefined;
  let updatedAccounting = accounting;

  if (cargoAmount > 0 && assignment) {
    cargoLoss = {
      creepName,
      assignmentId: assignment.assignmentId,
      resourceType: assignment.resource,
      cargoAmount,
      deathRoom,
      deathPos,
      tick,
      recoverable,
    };
    if (updatedAccounting) {
      updatedAccounting = recordLost(updatedAccounting, cargoAmount);
    }
  }

  // 步骤 3: Demand Recalculation
  let remainingDemand = 0;
  if (request && updatedAccounting) {
    remainingDemand = remainingAmount(request, updatedAccounting.delivered);
  } else if (request) {
    remainingDemand = request.amount;
  } else if (assignment) {
    remainingDemand = Math.max(0, assignment.assignedAmount - assignment.deliveredAmount - assignment.lostAmount);
  }

  // 步骤 4: New Assignment
  const replacementNeeded = remainingDemand > 0;

  // 步骤 5: Replacement Spawn
  // 需要 spawn 新 hauler 的条件：有剩余需求 + 无可用替代 hauler
  // 简化判断：有剩余需求就需要 spawn（系统侧薄壳检查 spawn 余力）
  const spawnRequestNeeded = replacementNeeded;

  // 诊断消息
  const parts: string[] = [];
  parts.push(`creep ${creepName} (${role}) died in ${deathRoom}`);
  if (cargoLoss) {
    parts.push(`cargo loss: ${cargoAmount} ${assignment?.resource ?? "energy"}`);
  }
  if (remainingDemand > 0) {
    parts.push(`remaining demand: ${remainingDemand}`);
  }
  if (replacementNeeded) {
    parts.push("replacement needed");
  }
  const message = parts.join(", ");

  return {
    failAssignmentId,
    cargoLoss,
    remainingDemand,
    replacementNeeded,
    spawnRequestNeeded,
    message,
  };
}

/**
 * 批量规划多个死亡恢复。
 * 纯函数。
 */
export function batchPlanDeathRecovery(
  inputs: readonly DeathRecoveryInput[],
): DeathRecoveryPlan[] {
  return inputs.map(planDeathRecovery);
}
