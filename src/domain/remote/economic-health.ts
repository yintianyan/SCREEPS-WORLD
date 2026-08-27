/** Remote Economic Health */

import type { RemoteEconomicHealth } from "../operation/remote-mining-op";
import type { ResourceFlowSnapshot } from "./flow-accounting";
import {
  productionRate,
  deliveryRate,
  transportEfficiency,
  isOverproducing,
  isUnderproducing,
} from "./flow-accounting";
import type { EconomicAccountingResult } from "./economic-accounting";
import type { ROIResult } from "./roi";
import type { BudgetStatus } from "./operation-budget";

// ─── 健康度评估输入 ─────────────────────────────────────

/**
 * Economic Health Assessment Input — 健康度评估输入。
 */
export interface RemoteEconomicHealthInput {
  /** 经济核算结果。 */
  accounting: EconomicAccountingResult;
  /** ROI 结果。 */
  roi: ROIResult;
  /** 预算状态。 */
  budget: BudgetStatus;
  /** 资源流快照。 */
  flow: ResourceFlowSnapshot;
  /** 威胁等级（0=安全..3=高危）。 */
  threatLevel: number;
  /** container 最大容量。 */
  containerCapacity: number;
  /** 预期产出速率。 */
  expectedProductionRate: number;
  /** 当前检查点（用于判断 Operation 是否已激活）。 */
  isEconomicallyActive: boolean;
  /** 连续不健康周期计数。 */
  unhealthyStreak: number;
}

// ─── 健康度评估参数 ─────────────────────────────────────

/**
 * Economic Health Config — 健康度评估参数。
 */
export interface EconomicHealthConfig {
  /** HEALTHY 净价值阈值（e/tick）。 */
  healthyNetValueThreshold: number;
  /** DEGRADED 持续周期阈值。 */
  degradedStreakThreshold: number;
  /** UNPROFITABLE 持续周期阈值。 */
  unprofitableStreakThreshold: number;
  /** ROI 达标阈值（0..1）。 */
  roiAchievementThreshold: number;
  /** 运输效率阈值（0..1）。 */
  transportEfficiencyThreshold: number;
}

/**
 * 默认健康度评估参数。
 */
export const DEFAULT_HEALTH_CONFIG: EconomicHealthConfig = {
  healthyNetValueThreshold: 3,
  degradedStreakThreshold: 3,
  unprofitableStreakThreshold: 10,
  roiAchievementThreshold: 0.8,
  transportEfficiencyThreshold: 0.7,
};

// ─── 健康度评估 ──────────────────────────────────────────

/**
 * 健康度评估结果。
 */
export interface HealthAssessmentResult {
  /** 健康度等级。 */
  health: RemoteEconomicHealth;
  /** 健康度变更原因（人类可读）。 */
  reason: string;
  /** 是否比之前恶化。 */
  degraded: boolean;
  /** 是否比之前改善。 */
  improved: boolean;
  /** 建议动作。 */
  recommendedAction: RecommendedAction;
}

/**
 * 建议动作。
 */
export type RecommendedAction =
  | "continue"
  | "monitor"
  | "reduce_hauler"
  | "add_hauler"
  | "suspend"
  | "resume"
  | "cancel"
  | "archive";

/**
 * 评估远矿经济健康度。

 * 优先级（从高到低）：
 * 1. 威胁 CRITICAL (level=3) 或预算耗尽 → SUSPENDED
 * 2. 净价值 ≤ 0 持续超阈值 → UNPROFITABLE
 * 3. 运输效率 < 阈值 或 净价值 < healthyThreshold 持续 → DEGRADED
 * 4. ROI 达标 且 净价值 > 阈值 → HEALTHY
 * 5. 默认 → DEGRADED

 * 纯函数 — 不访问 Game/Memory。
 */
export function assessEconomicHealth(
  input: RemoteEconomicHealthInput,
  config: EconomicHealthConfig = DEFAULT_HEALTH_CONFIG,
): HealthAssessmentResult {
  const { accounting, roi, budget, flow, threatLevel } = input;
  const netValue = accounting.netValue;
  const efficiency = transportEfficiency(flow);

  // 1. 威胁 CRITICAL 或预算耗尽 → SUSPENDED
  if (threatLevel >= 3 || budget.exhausted) {
    return {
      health: "suspended",
      reason: threatLevel >= 3
        ? `threat-critical-level-${threatLevel}`
        : `budget-exhausted-remaining-${budget.remaining}`,
      degraded: true,
      improved: false,
      recommendedAction: "suspend",
    };
  }

  // 2. 净价值 ≤ 0 持续超阈值 → UNPROFITABLE
  if (netValue <= 0 && input.unhealthyStreak >= config.unprofitableStreakThreshold) {
    return {
      health: "unprofitable",
      reason: `netValue-${netValue.toFixed(1)}-streak-${input.unhealthyStreak}`,
      degraded: true,
      improved: false,
      recommendedAction: "suspend",
    };
  }

  // 3. 运输效率低 或 净价值低于阈值持续 → DEGRADED
  if (
    (efficiency < config.transportEfficiencyThreshold && input.isEconomicallyActive) ||
    (netValue < config.healthyNetValueThreshold && netValue > 0 &&
      input.unhealthyStreak >= config.degradedStreakThreshold)
  ) {
    return {
      health: "degraded",
      reason: efficiency < config.transportEfficiencyThreshold
        ? `transport-efficiency-${efficiency.toFixed(2)}-below-${config.transportEfficiencyThreshold}`
        : `netValue-${netValue.toFixed(1)}-below-${config.healthyNetValueThreshold}`,
      degraded: true,
      improved: false,
      recommendedAction: isOverproducing(flow, input.containerCapacity)
        ? "add_hauler"
        : "monitor",
    };
  }

  // 4. ROI 达标 + 净价值 > 阈值 → HEALTHY
  if (
    netValue >= config.healthyNetValueThreshold &&
    roi.meetsExpectation &&
    input.isEconomicallyActive
  ) {
    return {
      health: "healthy",
      reason: `netValue-${netValue.toFixed(1)}-roi-${roi.actualROI.toFixed(2)}`,
      degraded: false,
      improved: true,
      recommendedAction: "continue",
    };
  }

  // 5. 默认 → DEGRADED（未激活或刚启动）
  if (!input.isEconomicallyActive) {
    return {
      health: "degraded",
      reason: "not-yet-economically-active",
      degraded: false,
      improved: false,
      recommendedAction: "monitor",
    };
  }

  // 净价值 > 0 但不够好，或 ROI 未达标
  return {
    health: "degraded",
    reason: `netValue-${netValue.toFixed(1)}-roi-achievement-${roi.roiAchievement.toFixed(2)}`,
    degraded: false,
    improved: false,
    recommendedAction: "monitor",
  };
}

// ─── 恢复检测 ──────────────────────────────────────────

/**
 * 判定 SUSPENDED Operation 是否可以恢复。

 * 恢复条件：
 * - 威胁已消除（threatLevel < 2）
 * - 预算有剩余或已补充
 * - 净价值回正

 * 纯函数。
 */
export function canResume(
  input: RemoteEconomicHealthInput,
  config: EconomicHealthConfig = DEFAULT_HEALTH_CONFIG,
): boolean {
  if (input.threatLevel >= 2) return false;
  if (input.budget.exhausted) return false;
  if (input.accounting.netValue <= 0) return false;
  return true;
}

/**
 * 判定 Operation 是否应永久归档（FAILED）。

 * FAILED 条件：
 * - 房间永久丢失（source 不存在）
 * - source 耗尽（expectedYield = 0）
 * - 连续 UNPROFITABLE 超过最大周期

 * 纯函数。
 */
export function shouldArchive(
  input: RemoteEconomicHealthInput,
  maxUnprofitableStreak: number,
): boolean {
  if (input.expectedProductionRate <= 0) return true;
  if (input.unhealthyStreak >= maxUnprofitableStreak) return true;
  return false;
}

// ─── 健康度转换 ──────────────────────────────────────────

/**
 * 健康度转换规则。
 * HEALTHY → DEGRADED → UNPROFITABLE → SUSPENDED → FAILED
 * 恢复方向：FAILED 不可恢复，SUSPENDED → DEGRADED → HEALTHY
 */
const HEALTH_TRANSITIONS: Record<RemoteEconomicHealth, RemoteEconomicHealth[]> = {
  healthy: ["degraded", "unprofitable", "suspended", "failed"],
  degraded: ["healthy", "unprofitable", "suspended", "failed"],
  unprofitable: ["degraded", "suspended", "failed"],
  suspended: ["unprofitable", "degraded", "healthy", "failed"],
  failed: [], // 终态
};

/**
 * 判定健康度转换是否合法。
 * 纯函数。
 */
export function isValidHealthTransition(
  from: RemoteEconomicHealth,
  to: RemoteEconomicHealth,
): boolean {
  return HEALTH_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 判定健康度是否为终态。
 * 纯函数。
 */
export function isTerminalHealth(health: RemoteEconomicHealth): boolean {
  return health === "failed";
}

/**
 * 判定健康度是否允许继续运营。
 * 纯函数。
 */
export function isOperationalHealth(health: RemoteEconomicHealth): boolean {
  return health === "healthy" || health === "degraded";
}
