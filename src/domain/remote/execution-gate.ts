/** Execution Gate */

import type { RemoteOpportunity } from "./remote-opportunity";
import type { RemoteMiningOperationContext } from "../operation/remote-mining-op";
import { hasActiveRemoteMiningOp } from "../operation/remote-mining-op";

// ─── Gate 结果 ──────────────────────────────────────────

/**
 * Execution Gate 检查结果。

 * - PASS: 全部检查通过——可以创建 RemoteMiningOperation
 * - WAIT: 暂时不可执行——条件可能改善（如威胁冷却中、spawn 容量不足）
 * - BLOCK: 阻塞——条件不太可能改善（如 source 丢失、房间被占）
 * - REPLAN: 需要重新规划——Opportunity 数据过期，需重新评估
 * - DUPLICATE: 已有活跃 Operation——幂等性拒绝
 * - NO_BUDGET: 预算不足——无法承担运营成本
 * - NO_DEMAND: 帝国无需求——资源已饱和
 */
export type GateResultType =
  | "pass"
  | "wait"
  | "block"
  | "replan"
  | "duplicate"
  | "no_budget"
  | "no_demand";

/**
 * Execution Gate 检查结果。
 */
export interface GateResult {
  type: GateResultType;
  /** 通过的检查项数量（0-10）。 */
  passedChecks: number;
  /** 失败的检查项（如果有）。 */
  failedCheck: GateCheck | undefined;
  /** 失败原因（人类可读）。 */
  reason: string;
  /** 附加数据（如建议重试 tick）。 */
  retryAfter?: number;
}

/** 全部检查通过的结果。 */
export const GATE_PASS: GateResult = {
  type: "pass",
  passedChecks: 10,
  failedCheck: undefined,
  reason: "all-checks-passed",
};

// ─── 检查项 ────────────────────────────────────────────

/**
 * Execution Gate 的 10 项检查。
 */
export type GateCheck =
  | "source_exists"
  | "source_mineable"
  | "room_accessible"
  | "route_valid"
  | "threat_clear"
  | "yield_reasonable"
  | "empire_demand"
  | "transport_cost"
  | "not_duplicate"
  | "budget_sufficient";

/** 所有检查项。 */
export const ALL_GATE_CHECKS: readonly GateCheck[] = [
  "source_exists",
  "source_mineable",
  "room_accessible",
  "route_valid",
  "threat_clear",
  "yield_reasonable",
  "empire_demand",
  "transport_cost",
  "not_duplicate",
  "budget_sufficient",
] as const;

// ─── Gate 输入 ──────────────────────────────────────────

/**
 * Execution Gate 检查输入。

 * 所有数据由调用方（系统侧薄壳）注入——不访问 Game/Memory。
 */
export interface ExecutionGateInput {
  // ── Opportunity 信息 ──
  opportunity: RemoteOpportunity;

  // ── Source 验证 ──
  /** Source 是否仍存在（intel.sources > 0）。 */
  sourceExists: boolean;
  /** Source 是否仍然可采（intel.status === "normal"）。 */
  sourceMineable: boolean;

  // ── Room 验证 ──
  /** Target Room 是否可进入（!sealedExits || 部分封死）。 */
  roomAccessible: boolean;

  // ── Route 验证 ──
  /** Route 是否有效（pathCost < maxPathCost）。 */
  routeValid: boolean;
  /** 最大允许 pathCost。 */
  maxPathCost: number;
  /** 实际 pathCost。 */
  pathCost: number;

  // ── Threat 验证 ──
  /** Threat 是否允许（dangerUntil 已过期或不存在）。 */
  threatClear: boolean;

  // ── Yield 验证 ──
  /** Net Value 是否 >= investmentThreshold。 */
  yieldReasonable: boolean;
  /** 净价值。 */
  netValue: number;
  /** 投资阈值。 */
  investmentThreshold: number;

  // ── Empire Demand ──
  /** Empire 是否仍需要资源（empireDemand > 0）。 */
  empireDemand: boolean;

  // ── Transport Cost ──
  /** Transport Cost 是否可接受（< maxTransportCost）。 */
  transportAcceptable: boolean;
  /** 运输成本。 */
  transportCost: number;
  /** 最大允许运输成本。 */
  maxTransportCost: number;

  // ── 幂等性 ──
  /** 是否已有活跃的 RemoteMiningOperation（sourceId 相同）。 */
  hasActiveOp: boolean;

  // ── 预算 ──
  /** 剩余预算是否 >= minBudget。 */
  budgetSufficient: boolean;
  /** 剩余预算。 */
  budgetRemaining: number;
  /** 最小预算阈值。 */
  minBudget: number;

  // ── 时间 ──
  /** 当前 tick。 */
  tick: number;
}

// ─── 检查执行 ──────────────────────────────────────────

/**
 * 执行 Execution Gate 的全部 10 项检查。

 * 逐项检查，遇到第一个失败项即返回（短路）。
 * 全部通过返回 GATE_PASS。

 * 纯函数 — 不访问 Game/Memory。
 */
export function checkExecutionGate(input: ExecutionGateInput): GateResult {
  const { tick } = input;

  // 1. Source 是否仍存在
  if (!input.sourceExists) {
    return {
      type: "block",
      passedChecks: 0,
      failedCheck: "source_exists",
      reason: "source-no-longer-exists",
    };
  }

  // 2. Source 是否仍然可采
  if (!input.sourceMineable) {
    return {
      type: "block",
      passedChecks: 1,
      failedCheck: "source_mineable",
      reason: "source-not-mineable",
    };
  }

  // 3. Target Room 是否可进入
  if (!input.roomAccessible) {
    return {
      type: "block",
      passedChecks: 2,
      failedCheck: "room_accessible",
      reason: "room-not-accessible-sealed-exits",
    };
  }

  // 4. Route 是否有效
  if (!input.routeValid) {
    return {
      type: "block",
      passedChecks: 3,
      failedCheck: "route_valid",
      reason: `route-invalid-pathCost-${input.pathCost}-exceeds-${input.maxPathCost}`,
    };
  }

  // 5. Threat 是否允许
  if (!input.threatClear) {
    return {
      type: "wait",
      passedChecks: 4,
      failedCheck: "threat_clear",
      reason: "threat-active-waiting-for-clearance",
      retryAfter: tick + 100, // 建议下次检查 tick
    };
  }

  // 6. Expected Yield 是否仍然合理
  if (!input.yieldReasonable) {
    return {
      type: "replan",
      passedChecks: 5,
      failedCheck: "yield_reasonable",
      reason: `netValue-${input.netValue.toFixed(1)}-below-threshold-${input.investmentThreshold}`,
    };
  }

  // 7. Empire 是否仍需要资源
  if (!input.empireDemand) {
    return {
      type: "no_demand",
      passedChecks: 6,
      failedCheck: "empire_demand",
      reason: "empire-resource-saturated-no-demand",
      retryAfter: tick + 500, // 资源饱和可定期重检
    };
  }

  // 8. Transport Cost 是否仍可接受
  if (!input.transportAcceptable) {
    return {
      type: "replan",
      passedChecks: 7,
      failedCheck: "transport_cost",
      reason: `transportCost-${input.transportCost.toFixed(1)}-exceeds-${input.maxTransportCost}`,
    };
  }

  // 9. Operation 是否重复
  if (input.hasActiveOp) {
    return {
      type: "duplicate",
      passedChecks: 8,
      failedCheck: "not_duplicate",
      reason: "active-operation-already-exists-for-source",
    };
  }

  // 10. Budget 是否足够
  if (!input.budgetSufficient) {
    return {
      type: "no_budget",
      passedChecks: 9,
      failedCheck: "budget_sufficient",
      reason: `budget-remaining-${input.budgetRemaining}-below-min-${input.minBudget}`,
    };
  }

  // 全部通过
  return GATE_PASS;
}

// ─── 辅助函数 ──────────────────────────────────────────

/**
 * 判定 Gate 结果是否为可通过（type === "pass"）。
 * 纯函数。
 */
export function isGatePassed(result: GateResult): boolean {
  return result.type === "pass";
}

/**
 * 判定 Gate 结果是否为暂时等待（可重试）。
 * 纯函数。
 */
export function isGateWaitable(result: GateResult): boolean {
  return result.type === "wait" || result.type === "no_demand" || result.type === "no_budget";
}

/**
 * 判定 Gate 结果是否为永久拒绝（不可重试）。
 * 纯函数。
 */
export function isGatePermanentFailure(result: GateResult): boolean {
  return result.type === "block" || result.type === "replan" || result.type === "duplicate";
}

/**
 * 判定 Gate 结果是否需要重新规划（Opportunity 过期/条件变化）。
 * 纯函数。
 */
export function isGateReplan(result: GateResult): boolean {
  return result.type === "replan";
}

/**
 * 从已有 RemoteMiningOperation 列表构建幂等性检查输入。
 * 辅助函数——封装 hasActiveRemoteMiningOp 调用。
 * 纯函数。
 */
export function checkDuplicate(
  ops: readonly RemoteMiningOperationContext[],
  homeRoom: string,
  targetRoom: string,
): boolean {
  return hasActiveRemoteMiningOp(ops, homeRoom, targetRoom);
}
