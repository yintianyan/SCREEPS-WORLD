/**
 * Expansion Risk Model — A3.2 Phase 1：五维风险评估。
 *
 * 合同锚点：EXPANSION_ARCHITECTURE §2 G4 可撤离门控 + §5 失败降级表。
 *
 * 定位：评估扩张到候选房的风险，输出五维风险分数和综合风险等级。
 * 五维：Economic / Operational / Distance / Recovery / Defense。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { ExpansionCandidateV2 } from "./candidate";
import type { ExpansionCostEstimate } from "./cost-model";

/** 风险等级。 */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** 风险评估结果。 */
export interface RiskResult {
  /** 候选房名。 */
  roomName: string;
  /** 综合风险分数（0..1，越高越危险）。 */
  score: number;
  /** 风险等级。 */
  level: RiskLevel;
  /** 五维明细。 */
  dimensions: {
    economic: number;
    operational: number;
    distance: number;
    recovery: number;
    defense: number;
  };
  /** 人类可读证据。 */
  evidence: string;
}

/** 风险选项。 */
export interface RiskOptions {
  /** 高风险阈值。 */
  highThreshold: number;
  /** 中风险阈值。 */
  mediumThreshold: number;
  /** 临界风险阈值。 */
  criticalThreshold: number;
  /** 最大可接受成本占帝国储备比例。 */
  maxCostRatio: number;
  /** 最大可接受距离。 */
  maxDistance: number;
  /** 权重。 */
  weights: {
    economic: number;
    operational: number;
    distance: number;
    recovery: number;
    defense: number;
  };
}

export const DEFAULT_RISK_OPTIONS: RiskOptions = {
  highThreshold: 0.6,
  mediumThreshold: 0.35,
  criticalThreshold: 0.8,
  maxCostRatio: 0.3,
  maxDistance: 3,
  weights: {
    economic: 0.25,
    operational: 0.2,
    distance: 0.2,
    recovery: 0.15,
    defense: 0.2,
  },
};

/**
 * 评估扩张风险（纯函数）。
 *
 * 五维：
 * 1. Economic  — 成本占帝国储备比例（越高风险越大）
 * 2. Operational — 情报新鲜度 + 未知信息量（越旧越风险）
 * 3. Distance  — 距离越远越风险（通勤/响应慢）
 * 4. Recovery  — 失败后能否回收资产（距离 + 无 terminal = 难回收）
 * 5. Defense   — 敌塔/敌方 spawn/邻接宿敌
 */
export function evaluateRisk(
  candidate: ExpansionCandidateV2,
  cost: ExpansionCostEstimate,
  empireReserve: number,
  intelAge: number,
  maxIntelAge: number,
  options: RiskOptions = DEFAULT_RISK_OPTIONS,
): RiskResult {
  // ── 1. Economic Risk ──
  // 成本占帝国储备比例
  let economic = 0;
  if (empireReserve > 0) {
    economic = clamp01(cost.totalCost / empireReserve / options.maxCostRatio);
  } else {
    economic = 1; // 无储备 = 最高风险
  }

  // ── 2. Operational Risk ──
  // 情报陈旧度
  const ageRatio = maxIntelAge > 0 ? intelAge / maxIntelAge : 1;
  let operational = clamp01(ageRatio);
  // source 未知 = 风险高
  if (candidate.sourceCount === undefined) operational = Math.max(operational, 0.8);

  // ── 3. Distance Risk ──
  const distance = candidate.distance;
  const distanceRisk = distance <= 1 ? 0.1
    : distance === 2 ? 0.3
    : distance === 3 ? 0.5
    : 0.8;

  // ── 4. Recovery Risk ──
  // 失败后回收资产难度：距离远 + 无 terminal = 难回收
  let recovery = distanceRisk * 0.5;
  // 无 pathCost 数据 = 不确定，加风险
  if (candidate.pathCost === undefined) recovery += 0.2;
  recovery = clamp01(recovery);

  // ── 5. Defense Risk ──
  // 敌塔 / 敌方 spawn / 邻接宿敌
  let defense = 0;
  if ((candidate.controller.isHostileReserved)) defense = 0.8;
  if (candidate.terrain.wallCount > 0) defense = Math.max(defense, 0.3); // 前任工事
  // 出口少 = 易守 = 风险低
  defense = defense * (1 - (4 - candidate.terrain.exitCount) * 0.1);
  defense = clamp01(defense);

  // ── 综合风险 ──
  const w = options.weights;
  const score = clamp01(
    w.economic * economic +
    w.operational * operational +
    w.distance * distanceRisk +
    w.recovery * recovery +
    w.defense * defense,
  );

  const level: RiskLevel =
    score >= options.criticalThreshold ? "CRITICAL"
    : score >= options.highThreshold ? "HIGH"
    : score >= options.mediumThreshold ? "MEDIUM"
    : "LOW";

  const evidence = [
    `economic=${(economic * 100).toFixed(0)}%`,
    `ops=${(operational * 100).toFixed(0)}%`,
    `dist=${(distanceRisk * 100).toFixed(0)}%`,
    `recovery=${(recovery * 100).toFixed(0)}%`,
    `defense=${(defense * 100).toFixed(0)}%`,
    `→ ${level}(${score.toFixed(2)})`,
  ].join(" ");

  return {
    roomName: candidate.roomName,
    score,
    level,
    dimensions: {
      economic,
      operational,
      distance: distanceRisk,
      recovery,
      defense,
    },
    evidence,
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
