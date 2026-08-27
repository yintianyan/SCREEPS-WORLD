/** Execution Operation */

import type { ExpansionPlan } from "./plan";
import type { ExecutionState } from "./execution-state";

/** Operation 类型。 */
export type ExpansionOperationType = "claim" | "colonize";

/** Operation 状态。 */
export type OperationStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "FAILED" | "CANCELLED";

/** 扩张执行 Operation。 */
export interface ExpansionOperation {
  /** 全局唯一 Operation ID。 */
  operationId: string;
  /** 关联的 planId。 */
  planId: string;
  /** Operation 类型。 */
  type: ExpansionOperationType;
  /** 目标房名。 */
  roomName: string;
  /** Sponsor 房名。 */
  sponsorRoom: string;
  /** Operation 状态。 */
  status: OperationStatus;
  /** 执行状态。 */
  executionState: ExecutionState;
  /** 创建 tick。 */
  createdAt: number;
  /** 更新 tick。 */
  updatedAt: number;
  /** 完成条件。 */
  completionCriteria: string[];
  /** 已完成的步骤。 */
  completedSteps: string[];
  /** 当前步骤。 */
  currentStep?: string;
  /** 失败原因。 */
  failReason?: string;
  /** 预留能量。 */
  reservedEnergy: number;
  /** 已消耗能量。 */
  consumedEnergy: number;
}

/** Operation 创建输入。 */
export interface OperationInput {
  plan: ExpansionPlan;
  type: ExpansionOperationType;
  tick: number;
  reservedEnergy: number;
}

/**
 * 从 Plan 创建 Operation（纯函数）。
 */
export function createExpansionOperation(input: OperationInput): ExpansionOperation {
  const { plan, type, tick, reservedEnergy } = input;

  const operationId = `op-${type}-${plan.planId}`;

  // 根据类型设置完成条件
  const completionCriteria = type === "claim"
    ? [
        "claimer reached target room",
        "claimController() succeeded",
        "controller.my === true",
      ]
    : [
        "pioneer reached target room",
        "spawn construction complete",
        "harvester deployed",
        "hauler or distributor deployed",
        "energy loop active",
        "net energy flow positive",
        "economic activation achieved",
        "empire integration complete",
      ];

  return {
    operationId,
    planId: plan.planId,
    type,
    roomName: plan.roomName,
    sponsorRoom: plan.sponsorRoom,
    status: "PENDING",
    executionState: "VALIDATING",
    createdAt: tick,
    updatedAt: tick,
    completionCriteria,
    completedSteps: [],
    currentStep: undefined,
    failReason: undefined,
    reservedEnergy,
    consumedEnergy: 0,
  };
}

/**
 * 更新 Operation 状态（纯函数，不可变）。
 */
export function updateOperation(
  operation: ExpansionOperation,
  updates: Partial<ExpansionOperation>,
  tick: number,
): ExpansionOperation {
  return {
    ...operation,
    ...updates,
    updatedAt: tick,
  };
}

/**
 * 标记步骤完成。
 */
export function completeStep(
  operation: ExpansionOperation,
  step: string,
  tick: number,
): ExpansionOperation {
  return {
    ...operation,
    completedSteps: [...operation.completedSteps, step],
    updatedAt: tick,
  };
}

/**
 * 检查 Operation 是否已完成。
 */
export function isOperationComplete(op: ExpansionOperation): boolean {
  return op.completionCriteria.every(c => op.completedSteps.includes(c));
}

/**
 * 标记 Operation 完成。
 */
export function completeOperation(
  op: ExpansionOperation,
  tick: number,
): ExpansionOperation {
  return {
    ...op,
    status: "COMPLETED",
    executionState: "COMPLETED",
    completedSteps: [...op.completionCriteria],
    updatedAt: tick,
  };
}

/**
 * 标记 Operation 失败。
 */
export function failOperation(
  op: ExpansionOperation,
  reason: string,
  tick: number,
): ExpansionOperation {
  return {
    ...op,
    status: "FAILED",
    failReason: reason,
    updatedAt: tick,
  };
}

/**
 * 标记 Operation 活跃。
 */
export function activateOperation(
  op: ExpansionOperation,
  tick: number,
): ExpansionOperation {
  return {
    ...op,
    status: "ACTIVE",
    updatedAt: tick,
  };
}

/**
 * 从 Claim Operation 创建 Colonize Operation。
 */
export function createColonizeFromClaim(
  claimOp: ExpansionOperation,
  tick: number,
  reservedEnergy: number,
): ExpansionOperation {
  const plan: Pick<ExpansionPlan, "planId" | "roomName" | "sponsorRoom"> = {
    planId: claimOp.planId,
    roomName: claimOp.roomName,
    sponsorRoom: claimOp.sponsorRoom,
  };

  return createExpansionOperation({
    plan: plan as ExpansionPlan,
    type: "colonize",
    tick,
    reservedEnergy,
  });
}
