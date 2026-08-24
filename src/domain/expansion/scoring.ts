/**
 * Candidate Evaluation (7-Factor) — A3.2 Phase 1：蓝图七因子评分。
 *
 * 合同锚点：EXPANSION_ARCHITECTURE §1.2 七因子评分公式。
 *
 * score = w1·sourceValue      // 2/3 source 价值
 *       + w2·mineralValue     // 矿物密度 × 帝国矿种缺口权重
 *       + w3·distanceScore    // 距最近自有房跳数
 *       + w4·neighborSafety   // 周边归属分布
 *       − w5·rivalProximity   // 宿敌距离
 *       + w6·defensibility    // 出口数/地形/塔位
 *       + w7·layoutFitness    // 模板适配
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { ExpansionCandidateV2, CandidateScoreBreakdown } from "./candidate";

/** 评分选项（权重从 CONFIG 读取，初值 SPECULATION）。 */
export interface ScoringOptions {
  w1: number; // sourceValue 权重
  w2: number; // mineralValue 权重
  w3: number; // distanceScore 权重
  w4: number; // neighborSafety 权重
  w5: number; // rivalProximity 权重（减项）
  w6: number; // defensibility 权重
  w7: number; // layoutFitness 权重
  /** 合格阈值（≥ 此值 → QUALIFIED）。 */
  qualificationThreshold: number;
  /** 2/3 source 房的基准价值。 */
  twoSourceValue: number;
  /** 1 source 房的基准价值。 */
  oneSourceValue: number;
  /** 直接邻居的距离分数。 */
  distance1Score: number;
  /** 2 跳的距离分数。 */
  distance2Score: number;
  /** 3 跳的距离分数。 */
  distance3Score: number;
  /** 3 跳以上的距离分数。 */
  distanceFarScore: number;
}

export const DEFAULT_SCORING_OPTIONS: ScoringOptions = {
  w1: 0.25,
  w2: 0.10,
  w3: 0.15,
  w4: 0.15,
  w5: 0.15,
  w6: 0.10,
  w7: 0.10,
  qualificationThreshold: 0.5,
  twoSourceValue: 1.0,
  oneSourceValue: 0.5,
  distance1Score: 1.0,
  distance2Score: 0.6,
  distance3Score: 0.3,
  distanceFarScore: 0.1,
};

/** 评分输入。 */
export interface ScoringInput {
  /** 候选房。 */
  candidate: ExpansionCandidateV2;
  /** 帝国矿种缺口权重映射（矿种 → 0..1 缺口权重）。 */
  mineralGapWeights?: Readonly<Record<string, number>>;
  /** 宿敌活动房名集合（rivalProximity 判定）。 */
  rivalRooms?: ReadonlySet<string>;
  /** 周边邻接房的 owner 分布（roomName → owner | undefined）。 */
  neighborOwners?: Readonly<Record<string, string | undefined>>;
  /** layoutFitness 预检结果（0..1，未检为 undefined → 取保守 0.5）。 */
  layoutFitnessScore?: number;
}

/**
 * 计算七因子评分（纯函数）。
 *
 * 各因子归一化到 [0,1] 后线性加权，总分 [0,1]。
 */
export function scoreCandidate(
  input: ScoringInput,
  options: ScoringOptions = DEFAULT_SCORING_OPTIONS,
): { candidate: ExpansionCandidateV2; breakdown: CandidateScoreBreakdown } {
  const { candidate, mineralGapWeights, rivalRooms, neighborOwners, layoutFitnessScore } = input;

  // ── 1. sourceValue ──
  const sourceCount = candidate.sourceCount ?? 0;
  const sourceValue = sourceCount >= 2
    ? options.twoSourceValue
    : sourceCount >= 1
    ? options.oneSourceValue
    : 0;

  // ── 2. mineralValue ──
  // 矿物密度 × 帝国矿种缺口权重
  let mineralValue = 0;
  if (candidate.mineral && mineralGapWeights) {
    const gapWeight = mineralGapWeights[candidate.mineral] ?? 0;
    mineralValue = gapWeight; // 0..1
  }

  // ── 3. distanceScore ──
  const distance = candidate.distance;
  const distanceScore = distance <= 1
    ? options.distance1Score
    : distance === 2
    ? options.distance2Score
    : distance === 3
    ? options.distance3Score
    : options.distanceFarScore;

  // ── 4. neighborSafety ──
  // 周边邻接房的 owner 分布：全中立/无主 → 1，有宿敌 → 低
  let neighborSafety = 1.0;
  if (neighborOwners) {
    let hostileCount = 0;
    let totalChecked = 0;
    for (const owner of Object.values(neighborOwners)) {
      totalChecked++;
      if (owner !== undefined && owner !== "" && rivalRooms?.has(owner)) {
        hostileCount++;
      }
    }
    if (totalChecked > 0) {
      neighborSafety = 1.0 - (hostileCount / totalChecked);
    }
  }

  // ── 5. rivalProximity（减项）──
  // 宿敌活动房距离候选的跳数（这里简化：邻接即 1，2 跳即 0.5，远即 0.1）
  let rivalProximity = 0;
  if (rivalRooms && rivalRooms.size > 0) {
    // 检查候选的邻接房是否包含宿敌活动房
    for (const neighbor of candidate.neighborRooms) {
      if (rivalRooms.has(neighbor)) {
        rivalProximity = 1.0; // 直接邻接 = 最近
        break;
      }
    }
    if (rivalProximity === 0) {
      // 检查邻接的邻接（通过 neighborOwners 的 keys 间接判断）
      if (neighborOwners) {
        for (const roomName of Object.keys(neighborOwners)) {
          if (rivalRooms.has(roomName)) {
            rivalProximity = 0.5; // 2 跳
            break;
          }
        }
      }
    }
    if (rivalProximity === 0) rivalProximity = 0.1; // 远
  }

  // ── 6. defensibility ──
  // 出口数越少越易守：4 出口 = 0.5，3 = 0.625，2 = 0.75，1 = 0.875，0 = 1.0
  const exitCount = candidate.terrain.exitCount;
  const defensibility = exitCount <= 0 ? 1.0 : Math.max(0, 1.0 - exitCount * 0.25);

  // ── 7. layoutFitness ──
  // 模板适配校验结果（未检为 undefined → 取保守 0.5）
  const layoutFitness = layoutFitnessScore ?? 0.5;

  // ── 加权总分 ──
  const total = clamp01(
    options.w1 * sourceValue +
    options.w2 * mineralValue +
    options.w3 * distanceScore +
    options.w4 * neighborSafety +
    options.w5 * rivalProximity + // 正值，但在公式中是减项
    options.w6 * defensibility +
    options.w7 * layoutFitness,
  );

  // 注意：公式中 rivalProximity 是减项，但在归一化时我们将其作为
  // "负面影响"处理：score = sum(positive) - w5 * rivalProximity
  // 但为了保持 [0,1] 范围，我们改为：
  // score = sum(w_i * factor_i for positive) - w5 * rivalProximity
  // 重新计算：
  const adjustedTotal = clamp01(
    options.w1 * sourceValue +
    options.w2 * mineralValue +
    options.w3 * distanceScore +
    options.w4 * neighborSafety +
    options.w6 * defensibility +
    options.w7 * layoutFitness -
    options.w5 * rivalProximity,
  );

  const breakdown: CandidateScoreBreakdown = {
    sourceValue,
    mineralValue,
    distanceScore,
    neighborSafety,
    rivalProximity,
    defensibility,
    layoutFitness,
    total: adjustedTotal,
  };

  // 更新候选
  const updatedCandidate: ExpansionCandidateV2 = {
    ...candidate,
    score: adjustedTotal,
    scoreBreakdown: breakdown,
    status: adjustedTotal >= options.qualificationThreshold ? "QUALIFIED" : "REJECTED",
    evaluatedAt: input.candidate.discoveredAt, // 使用调用方传入的 tick
  };

  return { candidate: updatedCandidate, breakdown };
}

/**
 * 批量评分候选房。
 */
export function scoreCandidates(
  candidates: readonly ExpansionCandidateV2[],
  inputs: {
    mineralGapWeights?: Readonly<Record<string, number>>;
    rivalRooms?: ReadonlySet<string>;
    neighborOwners?: Readonly<Record<string, string | undefined>>;
    layoutFitnessScores?: Readonly<Record<string, number>>;
  },
  tick: number,
  options: ScoringOptions = DEFAULT_SCORING_OPTIONS,
): ExpansionCandidateV2[] {
  return candidates.map(c => {
    const result = scoreCandidate(
      {
        candidate: c,
        mineralGapWeights: inputs.mineralGapWeights,
        rivalRooms: inputs.rivalRooms,
        neighborOwners: inputs.neighborOwners,
        layoutFitnessScore: inputs.layoutFitnessScores?.[c.roomName],
      },
      options,
    );
    // 覆盖 evaluatedAt 为实际 tick
    return {
      ...result.candidate,
      evaluatedAt: tick,
    };
  });
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
