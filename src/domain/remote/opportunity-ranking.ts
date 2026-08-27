/** Opportunity Ranking */

import type { RemoteOpportunity } from "./remote-opportunity";
import type { ValueGrade } from "./remote-value";

// ─── 排序结果 ────────────────────────────────────────────

/**
 * 排序评分明细。
 */
export interface OpportunityScore {
  /** Opportunity ID。 */
  id: string;
  /** 目标房。 */
  targetRoom: string;
  /** 总分（0..100）。 */
  totalScore: number;
  /** 排名（1-based）。 */
  rank: number;

  // ── 维度得分 ──
  /** 经济价值得分（0..40）。 */
  valueScore: number;
  /** 距离得分（0..25）。 */
  distanceScore: number;
  /** 风险得分（0..20）。 */
  riskScore: number;
  /** 可靠性得分（0..15）。 */
  reliabilityScore: number;

  // ── 排序依据说明 ──
  /** 价值等级。 */
  valueGrade: ValueGrade;
  /** 净价值（能量/tick）。 */
  netValue: number;
  /** 线性距离。 */
  linearDistance: number;
  /** 风险等级。 */
  riskLevel: number;
  /** 是否有 InvaderCore。 */
  hasInvaderCore: boolean;
  /** 是否值得投资。 */
  worthInvesting: boolean;
  /** 排序原因摘要。 */
  reason: string;
}

// ─── 排序参数 ─────────────────────────────────────────────

/**
 * 排序参数。
 */
export interface RankingConfig {
  /** 经济价值维度权重（总分中占比）。 */
  valueWeight: number;
  /** 距离维度权重。 */
  distanceWeight: number;
  /** 风险维度权重。 */
  riskWeight: number;
  /** 可靠性维度权重。 */
  reliabilityWeight: number;
  /** 距离评分的参考最大值（超过此值距离得分=0）。 */
  maxReferenceDistance: number;
  /** 距离评分的参考最小值（此值以内距离得分满分）。 */
  minReferenceDistance: number;
}

/**
 * 默认排序参数。

 * 权重分配（总分 100）：
 * - valueWeight = 40（经济价值最重要）
 * - distanceWeight = 25（距离影响运输成本和响应速度）
 * - riskWeight = 20（风险影响稳定性）
 * - reliabilityWeight = 15（情报可靠性影响决策信心）
 */
export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  valueWeight: 40,
  distanceWeight: 25,
  riskWeight: 20,
  reliabilityWeight: 15,
  maxReferenceDistance: 5,
  minReferenceDistance: 1,
};

// ─── 维度评分 ────────────────────────────────────────────

/**
 * 计算经济价值得分（0..valueWeight）。

 * 评分映射：
 * - premium (netValue >= 15) → 满分
 * - profitable (>= 8) → 75%
 * - marginal (>= 3) → 50%
 * - unprofitable (< 3) → 10%

 * 纯函数。
 */
export function scoreValue(
  opp: RemoteOpportunity,
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): number {
  const grade = opp.valueGrade;
  const weight = config.valueWeight;
  switch (grade) {
    case "premium": return weight;
    case "profitable": return weight * 0.75;
    case "marginal": return weight * 0.5;
    case "unprofitable": return weight * 0.1;
  }
}

/**
 * 计算距离得分（0..distanceWeight）。

 * 评分公式：线性映射 [minDistance, maxDistance] → [weight, 0]
 * distance <= minDistance → 满分
 * distance >= maxDistance → 0

 * 纯函数。
 */
export function scoreDistance(
  opp: RemoteOpportunity,
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): number {
  const dist = opp.sourceSnapshot.linearDistance;
  const { minReferenceDistance: minDist, maxReferenceDistance: maxDist, distanceWeight: weight } = config;
  if (dist <= minDist) return weight;
  if (dist >= maxDist) return 0;
  const ratio = (maxDist - dist) / (maxDist - minDist);
  return Math.round(weight * ratio);
}

/**
 * 计算风险得分（0..riskWeight）。

 * 评分映射：
 * - riskLevel 0 (安全) → 满分
 * - riskLevel 1 (低风险) → 75%
 * - riskLevel 2 (中风险) → 50%
 * - riskLevel 3 (高危) → 10%
 * - hasInvaderCore → 额外减半

 * 纯函数。
 */
export function scoreRisk(
  opp: RemoteOpportunity,
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): number {
  const level = opp.sourceSnapshot.riskLevel;
  const weight = config.riskWeight;
  let score: number;
  switch (level) {
    case 0: score = weight; break;
    case 1: score = weight * 0.75; break;
    case 2: score = weight * 0.5; break;
    default: score = weight * 0.1; break;
  }
  if (opp.sourceSnapshot.hasInvaderCore) score *= 0.5;
  return Math.round(score);
}

/**
 * 计算可靠性得分（0..reliabilityWeight）。

 * 评分依据：情报是否新鲜（使用 createdAt 距当前 tick 的差值）。
 * 但由于 Opportunity 在创建时冻结了快照，这里用 expectedYield 和 sourceCount
 * 的完整性作为可靠性代理指标：
 * - sourceCount > 0 且 expectedYield > 0 → 满分（情报完整）
 * - sourceCount = 0 或 expectedYield = 0 → 50%（情报不完整）

 * 纯函数。
 */
export function scoreReliability(
  opp: RemoteOpportunity,
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): number {
  const weight = config.reliabilityWeight;
  const hasSources = opp.sourceSnapshot.sourceCount > 0;
  const hasYield = opp.sourceSnapshot.expectedYield > 0;
  if (hasSources && hasYield) return weight;
  if (hasSources || hasYield) return Math.round(weight * 0.5);
  return 0;
}

// ─── 总评分 ──────────────────────────────────────────────

/**
 * 计算 Opportunity 的总评分。
 * 纯函数。
 */
export function scoreOpportunity(
  opp: RemoteOpportunity,
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): OpportunityScore {
  const valueScore = scoreValue(opp, config);
  const distanceScore = scoreDistance(opp, config);
  const riskScore = scoreRisk(opp, config);
  const reliabilityScore = scoreReliability(opp, config);
  const totalScore = valueScore + distanceScore + riskScore + reliabilityScore;

  const reason = buildReason(opp, totalScore, valueScore, distanceScore, riskScore, reliabilityScore);

  return {
    id: opp.id,
    targetRoom: opp.targetRoom,
    totalScore,
    rank: 0, // 由 rankOpportunities 填充
    valueScore,
    distanceScore,
    riskScore,
    reliabilityScore,
    valueGrade: opp.valueGrade,
    netValue: opp.value.netValue,
    linearDistance: opp.sourceSnapshot.linearDistance,
    riskLevel: opp.sourceSnapshot.riskLevel,
    hasInvaderCore: opp.sourceSnapshot.hasInvaderCore,
    worthInvesting: opp.value.worthInvesting,
    reason,
  };
}

/**
 * 生成排序原因摘要。
 * 纯函数。
 */
function buildReason(
  opp: RemoteOpportunity,
  total: number,
  value: number,
  distance: number,
  risk: number,
  reliability: number,
): string {
  const parts: string[] = [];
  parts.push(`value=${opp.valueGrade}(${value})`);
  parts.push(`dist=${opp.sourceSnapshot.linearDistance}(${distance})`);
  parts.push(`risk=${opp.sourceSnapshot.riskLevel}(${risk})`);
  parts.push(`rel(${reliability})`);
  if (opp.sourceSnapshot.hasInvaderCore) parts.push("invaderCore!");
  return parts.join(" ") + ` = ${total}`;
}

// ─── 排序 ────────────────────────────────────────────────

/**
 * 对 Opportunities 进行排序，返回带排名的评分列表。

 * 排序规则：
 * 1. 按总评分降序
 * 2. 同分按 netValue 降序
 * 3. 仍同分按距离升序
 * 4. 最终按 targetRoom 字母序（确定性）

 * 纯函数。

 * @param opps 待排序的 Opportunities
 * @param config 排序参数
 * @returns 按排名升序排列的评分列表
 */
export function rankOpportunities(
  opps: readonly RemoteOpportunity[],
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): OpportunityScore[] {
  const scores = opps.map(opp => scoreOpportunity(opp, config));

  scores.sort((a, b) => {
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
    if (a.netValue !== b.netValue) return b.netValue - a.netValue;
    if (a.linearDistance !== b.linearDistance) return a.linearDistance - b.linearDistance;
    return a.targetRoom.localeCompare(b.targetRoom);
  });

  scores.forEach((score, index) => {
    score.rank = index + 1;
  });

  return scores;
}

// ─── Top-N 选择 ──────────────────────────────────────────

/**
 * 选择排名前 N 的 Opportunities。
 * 纯函数。
 */
export function topOpportunities(
  opps: readonly RemoteOpportunity[],
  n: number,
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): OpportunityScore[] {
  return rankOpportunities(opps, config).slice(0, n);
}

/**
 * 选择最佳 Opportunity（排名第一）。
 * 纯函数。
 */
export function bestOpportunity(
  opps: readonly RemoteOpportunity[],
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): OpportunityScore | undefined {
  const ranked = rankOpportunities(opps, config);
  return ranked.length > 0 ? ranked[0] : undefined;
}

// ─── 过滤 + 排序 ─────────────────────────────────────────

/**
 * 过滤出值得投资的 Opportunities 并排序。
 * 纯函数。
 */
export function rankWorthInvesting(
  opps: readonly RemoteOpportunity[],
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): OpportunityScore[] {
  const worthIt = opps.filter(o => o.value.worthInvesting);
  return rankOpportunities(worthIt, config);
}
