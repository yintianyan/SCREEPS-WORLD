/**
 * Economic Safety Margin — A2 后半·步 9：经济安全边际联动模型。
 *
 * 合同锚点：ECONOMY §3 riskBuffer（风险缓冲）+ GOAL_POLICY_PLAN §4 预算 +
 * EXPANSION §2 G1–G5 门控。
 *
 * 定位：不止看库存——storage 很高但 production 很低 / population 很低 /
 * critical requests 很多时，Expansion Readiness 必须下降。
 * Safety Margin 是一个 0..1 的综合安全分数，由多个维度加权计算，
 * 供 Expansion Readiness 和 Empire Budget 消费作为调整因子。
 *
 * 设计意图：防止「库存高但产能低」的假富裕误判。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { EmpireResourceView } from "./resource-view";
import type { EmpireEconomicHealth } from "./economic-health";

/**
 * 安全边际评估结果。
 */
export interface SafetyMarginResult {
  /** 综合安全分数（0..1，越高越安全）。 */
  score: number;
  /** 人类可读的证据。 */
  evidence: string;
  // ── 各维度子分数（0..1）──
  /** 产能安全：netFlow > 0 且 production > 0。 */
  productionSafety: number;
  /** 储备安全：minRiskBuffer 足够。 */
  reserveSafety: number;
  /** 健康安全：无困难房 + 无活威胁。 */
  healthSafety: number;
  /** 自给安全：empireSelfSufficiency 足够。 */
  selfSufficiencySafety: number;
  /** 人口安全（从 View 间接判定——struggling 房越多越不安全）。 */
  populationSafety: number;
}

/**
 * 安全边际选项。
 */
export interface SafetyMarginOptions {
  /** 储备安全满分要求的风险缓冲（tick）。 */
  reserveFullMark: number;
  /** 储备安全及格线（tick）。低于此值为 0。 */
  reservePassMark: number;
  /** 产能安全满分要求的净流（能量/tick）。 */
  productionFullMark: number;
  /** 自给安全满分要求的自给度。 */
  selfSufficiencyFullMark: number;
  // ── 权重（总和 = 1.0）──
  weightProduction: number;
  weightReserve: number;
  weightHealth: number;
  weightSelfSufficiency: number;
  weightPopulation: number;
}

export const DEFAULT_SAFETY_MARGIN_OPTIONS: SafetyMarginOptions = {
  reserveFullMark: 1000,
  reservePassMark: 200,
  productionFullMark: 10,
  selfSufficiencyFullMark: 0.7,
  weightProduction: 0.3,
  weightReserve: 0.2,
  weightHealth: 0.25,
  weightSelfSufficiency: 0.15,
  weightPopulation: 0.1,
};

/**
 * 线性插值安全分数。
 * 低于 passMark → 0；高于 fullMark → 1；中间线性插值。
 */
function lerpScore(value: number, passMark: number, fullMark: number): number {
  if (value <= passMark) return 0;
  if (value >= fullMark) return 1;
  return (value - passMark) / (fullMark - passMark);
}

/**
 * 计算经济安全边际（纯函数）。
 *
 * 五维子分数：
 * 1. Production Safety：净流 > 0 → 基础分；netFlow ≥ fullMark → 满分
 * 2. Reserve Safety：minRiskBuffer ≥ fullMark → 满分；≤ passMark → 0
 * 3. Health Safety：无困难房 + 无活威胁 → 1；有困难房 → 0；有活威胁 → 0.3
 * 4. Self-Sufficiency Safety：empireSelfSufficiency ≥ fullMark → 满分
 * 5. Population Safety：strugglingRooms = 0 → 1；= roomCount → 0
 *
 * 综合 = Σ(子分数 × 权重)
 *
 * @param view EmpireResourceView
 * @param health EmpireEconomicHealth
 * @param options 选项
 */
export function evaluateSafetyMargin(
  view: EmpireResourceView,
  health: EmpireEconomicHealth,
  options: SafetyMarginOptions = DEFAULT_SAFETY_MARGIN_OPTIONS,
): SafetyMarginResult {
  // ── 1. Production Safety ──
  // 净流 ≤ 0 → 0；净流 ≥ fullMark → 1；中间线性
  const productionSafety = view.totalNetFlow <= 0
    ? 0
    : lerpScore(view.totalNetFlow, 0, options.productionFullMark);

  // ── 2. Reserve Safety ──
  const reserveSafety = lerpScore(
    view.minRiskBuffer,
    options.reservePassMark,
    options.reserveFullMark,
  );

  // ── 3. Health Safety ──
  let healthSafety = 1;
  if (view.hasStruggling) {
    healthSafety = 0;
  } else if (view.hasLiveThreat) {
    healthSafety = 0.3;
  }

  // ── 4. Self-Sufficiency Safety ──
  const selfSufficiencySafety = lerpScore(
    view.empireSelfSufficiency,
    0,
    options.selfSufficiencyFullMark,
  );

  // ── 5. Population Safety ──
  // struggling 房占比越低越安全
  const populationSafety = view.roomCount > 0
    ? 1 - (view.strugglingRooms / view.roomCount)
    : 0;

  // ── 综合 ──
  const score =
    productionSafety * options.weightProduction +
    reserveSafety * options.weightReserve +
    healthSafety * options.weightHealth +
    selfSufficiencySafety * options.weightSelfSufficiency +
    populationSafety * options.weightPopulation;

  const evidence =
    `prod=${productionSafety.toFixed(2)} reserve=${reserveSafety.toFixed(2)}` +
    ` health=${healthSafety.toFixed(2)} selfSuff=${selfSufficiencySafety.toFixed(2)}` +
    ` pop=${populationSafety.toFixed(2)} → score=${score.toFixed(3)}`;

  return {
    score: Math.max(0, Math.min(1, score)),
    evidence,
    productionSafety,
    reserveSafety,
    healthSafety,
    selfSufficiencySafety,
    populationSafety,
  };
}
