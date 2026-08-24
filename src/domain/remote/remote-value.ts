/**
 * Remote Resource Value — A4.0 Phase 3：远矿净价值评估。
 *
 * 合同锚点：A4.0 Architecture Audit §18.3（Remote Source 是评估层，不是执行层）。
 *
 * 设计意图：
 *   计算远矿资源的净价值 = 预期产出 - 运输成本 - 风险成本 - 基建成本。
 *
 *   这不是 remote-mining-manager 的 scoreRemoteCandidate() 的替代——
 *   scoreRemoteCandidate 评估的是「是否值得开新远矿」（运营决策），
 *   remote-value 评估的是「这个远矿资源的长期经济价值是多少」（经济评估）。
 *
 *   两者的关系：
 *   - scoreRemoteCandidate 的 netScore ≈ throughput - upkeep（瞬时运营净收益）
 *   - remote-value 的 netValue = expectedYield - transportCost - riskCost - infraCost
 *     （长期经济价值，考虑风险和基建摊销）
 *
 *   remote-value 的输出供 remote-opportunity.ts 用于 Opportunity 排序。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { RemoteSource } from "./remote-source";

// ─── 价值评估结果 ─────────────────────────────────────────

/**
 * Remote Resource Value — 净价值评估明细。
 */
export interface RemoteResourceValue {
  /** Remote Source ID。 */
  sourceId: string;
  /** 目标房名。 */
  targetRoom: string;

  /** 预期产出价值（能量/tick）。 */
  expectedYield: number;
  /** 运输成本（能量/tick）。 */
  transportCost: number;
  /** 风险成本（能量/tick）。 */
  riskCost: number;
  /** 基建成本（能量/tick）。 */
  infrastructureCost: number;

  /** 净价值 = expectedYield - transportCost - riskCost - infrastructureCost。 */
  netValue: number;
  /** 价值等级。 */
  grade: ValueGrade;
  /** 是否值得投资（netValue > investmentThreshold）。 */
  worthInvesting: boolean;
}

/**
 * 价值等级。
 */
export type ValueGrade =
  | "premium"    // netValue >= 15
  | "profitable" // netValue >= 8
  | "marginal"   // netValue >= 3
  | "unprofitable"; // netValue < 3

// ─── 评估参数 ─────────────────────────────────────────────

/**
 * 价值评估参数。
 */
export interface ValueAssessmentConfig {
  /** 运输成本权重（每单位 pathCost 的能量/tick 成本）。 */
  transportWeight: number;
  /** 风险成本基数（能量/tick）。 */
  riskBaseCost: number;
  /** 每级风险的额外成本（能量/tick per riskLevel）。 */
  riskPerLevel: number;
  /** InvaderCore 额外风险成本（能量/tick）。 */
  invaderCorePenalty: number;
  /** 基建成本（道路维护 + container 摊销，能量/tick）。 */
  baseInfrastructureCost: number;
  /** 无路时的额外基建成本（能量/tick）。 */
  noRoadPenalty: number;
  /** 投资阈值——netValue 超过此值才值得投资。 */
  investmentThreshold: number;
  /** 价值等级阈值。 */
  premiumThreshold: number;
  /** profitable 等级阈值。 */
  profitableThreshold: number;
  /** marginal 等级阈值。 */
  marginalThreshold: number;
}

/**
 * 默认价值评估参数。
 *
 * 参数校准依据（与 targeting.ts 的经济模型对齐）：
 * - SOURCE_INCOME = 10 e/tick (reserved), 5 (unreserved)
 * - HARVESTER_UPKEEP = 0.4, HAULER_UPKEEP = 0.4, RESERVER_UPKEEP = 2.2
 * - DEFENDER_UPKEEP = 0.35, ROAD_UPKEEP_PER_PATHCOST = 0.002
 *
 * 运输成本权重 = 0.003（略高于 ROAD_UPKEEP_PER_PATHCOST，含 hauler 燃料）
 * 风险成本基数 = 0.5（低风险的固定成本）
 * 每级风险 = 1.0（riskLevel 0→3 对应 0.5→3.5 e/tick）
 * InvaderCore 惩罚 = 5.0（大额惩罚，接近全额产出）
 * 基建成本 = 0.5（container 摊销 + 道路基础维护）
 * 无路惩罚 = 1.0（无路时额外运输成本）
 */
export const DEFAULT_VALUE_CONFIG: ValueAssessmentConfig = {
  transportWeight: 0.003,
  riskBaseCost: 0.5,
  riskPerLevel: 1.0,
  invaderCorePenalty: 5.0,
  baseInfrastructureCost: 0.5,
  noRoadPenalty: 1.0,
  investmentThreshold: 3,
  premiumThreshold: 15,
  profitableThreshold: 8,
  marginalThreshold: 3,
};

// ─── 成本计算 ────────────────────────────────────────────

/**
 * 计算运输成本（能量/tick）。
 * transportCost = pathCost × transportWeight + (hasRoad ? 0 : noRoadPenalty)
 * 纯函数。
 */
export function computeTransportCost(
  source: RemoteSource,
  config: ValueAssessmentConfig = DEFAULT_VALUE_CONFIG,
): number {
  const baseTransport = source.pathCost * config.transportWeight;
  const roadPenalty = source.hasRoad ? 0 : config.noRoadPenalty;
  return baseTransport + roadPenalty;
}

/**
 * 计算风险成本（能量/tick）。
 * riskCost = riskBaseCost + riskLevel × riskPerLevel + (hasInvaderCore ? invaderCorePenalty : 0)
 * 纯函数。
 */
export function computeRiskCost(
  source: RemoteSource,
  config: ValueAssessmentConfig = DEFAULT_VALUE_CONFIG,
): number {
  const baseRisk = config.riskBaseCost + source.riskLevel * config.riskPerLevel;
  const invaderPenalty = source.hasInvaderCore ? config.invaderCorePenalty : 0;
  return baseRisk + invaderPenalty;
}

/**
 * 计算基建成本（能量/tick）。
 * infrastructureCost = baseInfrastructureCost
 * 纯函数。
 */
export function computeInfrastructureCost(
  _source: RemoteSource,
  config: ValueAssessmentConfig = DEFAULT_VALUE_CONFIG,
): number {
  return config.baseInfrastructureCost;
}

// ─── 净价值评估 ───────────────────────────────────────────

/**
 * 评估 Remote Source 的净价值。
 *
 * netValue = expectedYield - transportCost - riskCost - infrastructureCost
 *
 * 纯函数 — 不访问 Game/Memory。
 *
 * @param source Remote Source
 * @param config 评估参数
 */
export function assessRemoteValue(
  source: RemoteSource,
  config: ValueAssessmentConfig = DEFAULT_VALUE_CONFIG,
): RemoteResourceValue {
  const expectedYield = source.expectedYield;
  const transportCost = computeTransportCost(source, config);
  const riskCost = computeRiskCost(source, config);
  const infrastructureCost = computeInfrastructureCost(source, config);

  const netValue = expectedYield - transportCost - riskCost - infrastructureCost;
  const grade = gradeValue(netValue, config);
  const worthInvesting = netValue >= config.investmentThreshold;

  return {
    sourceId: source.id,
    targetRoom: source.targetRoom,
    expectedYield,
    transportCost,
    riskCost,
    infrastructureCost,
    netValue,
    grade,
    worthInvesting,
  };
}

/**
 * 根据净价值判定等级。
 * 纯函数。
 */
export function gradeValue(
  netValue: number,
  config: ValueAssessmentConfig = DEFAULT_VALUE_CONFIG,
): ValueGrade {
  if (netValue >= config.premiumThreshold) return "premium";
  if (netValue >= config.profitableThreshold) return "profitable";
  if (netValue >= config.marginalThreshold) return "marginal";
  return "unprofitable";
}

// ─── 批量评估 ────────────────────────────────────────────

/**
 * 批量评估多个 Remote Sources 的净价值。
 * 返回按 netValue 降序排列的列表。
 * 纯函数。
 */
export function batchAssessValues(
  sources: readonly RemoteSource[],
  config: ValueAssessmentConfig = DEFAULT_VALUE_CONFIG,
): RemoteResourceValue[] {
  const values = sources.map(s => assessRemoteValue(s, config));
  values.sort((a, b) => b.netValue - a.netValue);
  return values;
}

/**
 * 过滤出值得投资的 Remote Sources。
 * 纯函数。
 */
export function filterWorthInvesting(
  sources: readonly RemoteSource[],
  config: ValueAssessmentConfig = DEFAULT_VALUE_CONFIG,
): RemoteResourceValue[] {
  return batchAssessValues(sources, config).filter(v => v.worthInvesting);
}
