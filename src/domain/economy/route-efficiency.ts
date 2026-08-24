/**
 * Route Efficiency — A4.0 Phase 2：路由效率评估。
 *
 * 合同锚点：A4.0 Architecture Audit §18.3（Route Efficiency 模型）。
 *
 * 设计意图：
 *   Route Efficiency = Delivered / Cost（交付效率 = 实际交付量 / 运输成本）
 *
 *   用于：
 *   1. 评估 Contract 的经济效率——是否值得维持
 *   2. 多 Producer 竞争时选择效率最高的供应方
 *   3. 触发 Contract 重新谈判（效率持续低于阈值 → 寻找替代 Producer）
 *
 *   理解：
 *   - highEfficiency (> threshold): 路由高效，Contract 值得维持
 *   - lowEfficiency (< threshold): 路由低效，考虑寻找替代方案
 *   - negativeEfficiency: 成本 > 交付量（严重亏损）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { TransportCostBreakdown } from "./transport-cost";
import type { SupplyContract } from "./supply-contract";

// ─── 效率计算 ─────────────────────────────────────────────

/**
 * Route Efficiency 评估结果。
 */
export interface RouteEfficiency {
  /** Contract ID。 */
  contractId: string;
  /** 本周期交付量。 */
  delivered: number;
  /** 运输成本明细。 */
  cost: TransportCostBreakdown;
  /** 效率比率 = delivered / cost.total（≥ 0）。 */
  ratio: number;
  /** 效率等级。 */
  grade: EfficiencyGrade;
  /** 是否值得维持。 */
  shouldMaintain: boolean;
}

/**
 * 效率等级。
 */
export type EfficiencyGrade =
  | "excellent"  // ratio >= 10
  | "good"       // ratio >= 5
  | "fair"       // ratio >= 2
  | "poor"       // ratio >= 1
  | "bad";       // ratio < 1

/**
 * 效率阈值配置。
 */
export interface EfficiencyThresholds {
  /** excellent 等级阈值。 */
  excellent: number;
  /** good 等级阈值。 */
  good: number;
  /** fair 等级阈值。 */
  fair: number;
  /** poor 等级阈值。 */
  poor: number;
  /** 维持阈值——低于此值建议寻找替代方案。 */
  maintainThreshold: number;
}

/**
 * 默认效率阈值。
 */
export const DEFAULT_EFFICIENCY_THRESHOLDS: EfficiencyThresholds = {
  excellent: 10,
  good: 5,
  fair: 2,
  poor: 1,
  maintainThreshold: 2,
};

/**
 * 根据比率判定效率等级。
 * 纯函数。
 */
export function gradeEfficiency(
  ratio: number,
  thresholds: EfficiencyThresholds = DEFAULT_EFFICIENCY_THRESHOLDS,
): EfficiencyGrade {
  if (ratio >= thresholds.excellent) return "excellent";
  if (ratio >= thresholds.good) return "good";
  if (ratio >= thresholds.fair) return "fair";
  if (ratio >= thresholds.poor) return "poor";
  return "bad";
}

/**
 * 计算路由效率。
 *
 * ratio = delivered / cost.total
 *
 * 特殊情况：
 *   - cost.total = 0 → ratio = Infinity（零成本运输，理论上无限高效）
 *   - delivered = 0 → ratio = 0（无交付）
 *
 * 纯函数。
 *
 * @param contract 关联的 Contract
 * @param delivered 本周期实际交付量
 * @param cost 运输成本明细
 * @param thresholds 效率阈值（默认 DEFAULT_EFFICIENCY_THRESHOLDS）
 */
export function evaluateRouteEfficiency(
  contract: SupplyContract,
  delivered: number,
  cost: TransportCostBreakdown,
  thresholds: EfficiencyThresholds = DEFAULT_EFFICIENCY_THRESHOLDS,
): RouteEfficiency {
  const ratio = cost.total > 0
    ? delivered / cost.total
    : (delivered > 0 ? Infinity : 0);

  const grade = gradeEfficiency(ratio, thresholds);
  const shouldMaintain = ratio >= thresholds.maintainThreshold;

  return {
    contractId: contract.id,
    delivered,
    cost,
    ratio,
    grade,
    shouldMaintain,
  };
}

// ─── 批量评估 ─────────────────────────────────────────────

/**
 * Contract + 交付量 + 成本的组合输入。
 */
export interface ContractEfficiencyInput {
  contract: SupplyContract;
  delivered: number;
  cost: TransportCostBreakdown;
}

/**
 * 批量评估多个 Contract 的路由效率。
 * 返回按 ratio 降序排列的列表（效率最高的在前）。
 * 纯函数。
 */
export function batchEvaluateEfficiency(
  inputs: readonly ContractEfficiencyInput[],
  thresholds: EfficiencyThresholds = DEFAULT_EFFICIENCY_THRESHOLDS,
): RouteEfficiency[] {
  const results = inputs.map(({ contract, delivered, cost }) =>
    evaluateRouteEfficiency(contract, delivered, cost, thresholds),
  );
  // Infinity 排在最后——用 isFinite 区分
  results.sort((a, b) => {
    if (a.ratio === Infinity && b.ratio === Infinity) return 0;
    if (a.ratio === Infinity) return -1;
    if (b.ratio === Infinity) return 1;
    return b.ratio - a.ratio;
  });
  return results;
}

// ─── Contract 建议 ────────────────────────────────────────

/**
 * 效率评估建议。
 */
export interface EfficiencyRecommendation {
  /** Contract ID。 */
  contractId: string;
  /** 当前等级。 */
  grade: EfficiencyGrade;
  /** 建议动作。 */
  action: EfficiencyAction;
  /** 原因。 */
  reason: string;
}

/**
 * 效率建议动作。
 */
export type EfficiencyAction =
  | "maintain"      // 维持现状
  | "investigate"   // 调查低效原因
  | "renegotiate"   // 重新谈判（寻找替代 Producer）
  | "cancel";       // 取消 Contract

/**
 * 根据路由效率生成建议。
 * 纯函数。
 */
export function recommendAction(
  efficiency: RouteEfficiency,
  contract: SupplyContract,
  thresholds: EfficiencyThresholds = DEFAULT_EFFICIENCY_THRESHOLDS,
): EfficiencyRecommendation {
  // 终态 Contract 不建议任何动作
  if (contract.status === "completed" || contract.status === "cancelled") {
    return {
      contractId: contract.id,
      grade: efficiency.grade,
      action: "maintain",
      reason: "contract is terminal",
    };
  }

  if (efficiency.grade === "bad") {
    return {
      contractId: contract.id,
      grade: efficiency.grade,
      action: "cancel",
      reason: `ratio ${efficiency.ratio.toFixed(2)} < poor threshold ${thresholds.poor}`,
    };
  }

  if (efficiency.grade === "poor") {
    return {
      contractId: contract.id,
      grade: efficiency.grade,
      action: "renegotiate",
      reason: `ratio ${efficiency.ratio.toFixed(2)} below maintain threshold ${thresholds.maintainThreshold}`,
    };
  }

  if (efficiency.grade === "fair" && contract.consecutiveShortfall > 2) {
    return {
      contractId: contract.id,
      grade: efficiency.grade,
      action: "investigate",
      reason: `fair efficiency with ${contract.consecutiveShortfall} consecutive shortfalls`,
    };
  }

  return {
    contractId: contract.id,
    grade: efficiency.grade,
    action: "maintain",
    reason: "healthy",
  };
}

// ─── 最优 Producer 选择 ───────────────────────────────────

/**
 * Producer 候选评估输入。
 */
export interface ProducerCandidate {
  /** Producer 房名。 */
  room: string;
  /** 预期交付量。 */
  expectedDelivered: number;
  /** 运输成本。 */
  cost: TransportCostBreakdown;
}

/**
 * 从多个候选 Producer 中选择效率最高的。
 * 返回最优候选 + 其效率评估。
 * 纯函数。
 */
export function selectBestProducer(
  candidates: readonly ProducerCandidate[],
  contract: SupplyContract,
  thresholds: EfficiencyThresholds = DEFAULT_EFFICIENCY_THRESHOLDS,
): { best: ProducerCandidate; efficiency: RouteEfficiency } | undefined {
  if (candidates.length === 0) return undefined;

  let best: ProducerCandidate | undefined;
  let bestRatio = -1;

  for (const candidate of candidates) {
    const ratio = candidate.cost.total > 0
      ? candidate.expectedDelivered / candidate.cost.total
      : (candidate.expectedDelivered > 0 ? Infinity : 0);

    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }

  if (!best) return undefined;

  const efficiency = evaluateRouteEfficiency(
    contract,
    best.expectedDelivered,
    best.cost,
    thresholds,
  );

  return { best, efficiency };
}
