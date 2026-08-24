/**
 * Empire Economic Health — A2 后半·步 5：帝国级经济健康度判定。
 *
 * 合同锚点：GOAL_POLICY_PLAN §4 五域预算 + ECONOMY §3 三指标 +
 * EMPIRE_SYSTEM_MODEL §1 Empire（聚合重建态势）。
 *
 * 定位：不简单加总各房能量——而是基于 EmpireResourceView 的
 * 生产/消费/储备/需求/恢复/人口信号判定帝国整体经济健康状态。
 * 输出可解释、可测试的枚举 + evidence，供 Expansion Readiness /
 * Empire Budget / Empire Planner Input 消费。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { EmpireResourceView } from "./resource-view";

/**
 * 帝国经济健康状态。
 *
 * - Critical：有困难房 + 帝国净流为负 → 生存优先，冻结一切扩张/调拨
 * - Deficit：帝国净流为负（无困难房但整体入不敷出）→ 收缩，不扩张
 * - Stable：净流 ≥ 0 但储备或自给度偏低 → 维持，谨慎扩张
 * - Growing：净流 > 0 + 储备充足 + 无困难房 + 有核心房 → 可扩张
 * - Healthy：Growing 的强化版：多核心房 + 高自给度 + 充裕风险缓冲 → 强烈可扩张
 */
export type EmpireEconomicHealth =
  | "critical"
  | "deficit"
  | "stable"
  | "growing"
  | "healthy";

/**
 * 健康度评估结果。
 */
export interface EconomicHealthResult {
  health: EmpireEconomicHealth;
  /** 人类可读的证据链（自治可审计前提）。 */
  evidence: string;
  /** 帝国净流（从 View 派生）。 */
  netFlow: number;
  /** 帝国总生产。 */
  totalProduction: number;
  /** 是否有困难房。 */
  hasStruggling: boolean;
  /** 是否有活威胁。 */
  hasLiveThreat: boolean;
  /** 是否有 Imbalance（surplus + deficit 同存）。 */
  hasImbalance: boolean;
}

/**
 * 健康度评估选项。
 */
export interface HealthOptions {
  /** Stable 要求的最低平均风险缓冲（tick）。低于此值从 Growing 降级 Stable。 */
  stableMinRiskBuffer: number;
  /** Growing 要求的最低核心房数。 */
  growingMinCoreRooms: number;
  /** Growing 要求的最低自给度。 */
  growingMinSelfSufficiency: number;
  /** Healthy 要求的最低核心房数。 */
  healthyMinCoreRooms: number;
  /** Healthy 要求的最低自给度。 */
  healthyMinSelfSufficiency: number;
  /** Healthy 要求的最低风险缓冲。 */
  healthyMinRiskBuffer: number;
}

export const DEFAULT_HEALTH_OPTIONS: HealthOptions = {
  stableMinRiskBuffer: 500,
  growingMinCoreRooms: 1,
  growingMinSelfSufficiency: 0.5,
  healthyMinCoreRooms: 2,
  healthyMinSelfSufficiency: 0.7,
  healthyMinRiskBuffer: 1000,
};

/**
 * 判定帝国经济健康度（纯函数）。
 *
 * 判定逻辑（优先级从高到低）：
 * 1. Critical: hasStruggling || (totalProduction === 0) || (netFlow < 0 && minRiskBuffer < 200)
 * 2. Deficit: netFlow < 0（整体入不敷出，但无困难房）
 * 3. Stable: netFlow ≥ 0 但 minRiskBuffer < stableMinRiskBuffer || selfSufficiency < growingMin
 * 4. Growing: netFlow > 0 + coreRooms ≥ 1 + selfSufficiency ≥ growingMin
 * 5. Healthy: netFlow > 0 + coreRooms ≥ healthyMin + selfSufficiency ≥ healthyMin + riskBuffer ≥ healthyMin
 *
 * @param view EmpireResourceView（步 4 产出）
 * @param options 阈值选项
 */
export function evaluateEconomicHealth(
  view: EmpireResourceView,
  options: HealthOptions = DEFAULT_HEALTH_OPTIONS,
): EconomicHealthResult {
  const {
    totalNetFlow: netFlow,
    totalProduction,
    minRiskBuffer,
    hasStruggling,
    hasLiveThreat,
    hasImbalance,
    empireSelfSufficiency: selfSufficiency,
    coreRooms,
    strugglingRooms,
  } = view;

  // ── 1. Critical：生存危机 ──
  if (totalProduction === 0 && view.roomCount === 0) {
    return {
      health: "critical",
      evidence: "no rooms",
      netFlow,
      totalProduction,
      hasStruggling,
      hasLiveThreat,
      hasImbalance,
    };
  }
  if (hasStruggling) {
    return {
      health: "critical",
      evidence: `struggling rooms: ${strugglingRooms}`,
      netFlow,
      totalProduction,
      hasStruggling,
      hasLiveThreat,
      hasImbalance,
    };
  }
  if (netFlow < 0 && minRiskBuffer < 200) {
    return {
      health: "critical",
      evidence: `netFlow=${netFlow.toFixed(1)} riskBuffer=${minRiskBuffer.toFixed(0)}<200`,
      netFlow,
      totalProduction,
      hasStruggling,
      hasLiveThreat,
      hasImbalance,
    };
  }

  // ── 2. Deficit：整体入不敷出 ──
  if (netFlow < 0) {
    return {
      health: "deficit",
      evidence: `netFlow=${netFlow.toFixed(1)}<0`,
      netFlow,
      totalProduction,
      hasStruggling,
      hasLiveThreat,
      hasImbalance,
    };
  }

  // ── 3. Stable：收支平衡但储备/自给度不足 ──
  if (
    minRiskBuffer < options.stableMinRiskBuffer ||
    selfSufficiency < options.growingMinSelfSufficiency
  ) {
    return {
      health: "stable",
      evidence: `riskBuffer=${minRiskBuffer.toFixed(0)}<${options.stableMinRiskBuffer} or selfSuff=${selfSufficiency.toFixed(2)}<${options.growingMinSelfSufficiency}`,
      netFlow,
      totalProduction,
      hasStruggling,
      hasLiveThreat,
      hasImbalance,
    };
  }

  // ── 4. Growing：净流为正 + 有核心房 + 自给度达标 ──
  if (
    coreRooms >= options.growingMinCoreRooms &&
    selfSufficiency >= options.growingMinSelfSufficiency
  ) {
    // ── 5. Healthy：Growing 强化版 ──
    if (
      coreRooms >= options.healthyMinCoreRooms &&
      selfSufficiency >= options.healthyMinSelfSufficiency &&
      minRiskBuffer >= options.healthyMinRiskBuffer
    ) {
      return {
        health: "healthy",
        evidence: `core=${coreRooms} selfSuff=${selfSufficiency.toFixed(2)} riskBuf=${minRiskBuffer.toFixed(0)}`,
        netFlow,
        totalProduction,
        hasStruggling,
        hasLiveThreat,
        hasImbalance,
      };
    }
    return {
      health: "growing",
      evidence: `core=${coreRooms} selfSuff=${selfSufficiency.toFixed(2)}`,
      netFlow,
      totalProduction,
      hasStruggling,
      hasLiveThreat,
      hasImbalance,
    };
  }

  // ── 兜底：净流为正但不满足 Growing 条件 ──
  return {
    health: "stable",
    evidence: `netFlow=${netFlow.toFixed(1)} but core=${coreRooms} or selfSuff=${selfSufficiency.toFixed(2)} insufficient`,
    netFlow,
    totalProduction,
    hasStruggling,
    hasLiveThreat,
    hasImbalance,
  };
}
