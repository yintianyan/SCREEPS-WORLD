/**
 * Target Selection — A5.3 多目标评分与选择纯函数。
 *
 * 不能只选择最近敌人。必须考虑：
 * - targetValue
 * - threat
 * - objective
 * - terrain
 * - defense
 * - intelConfidence
 * - distance
 * - logisticsCost
 * - strategicImpact
 *
 * 输出 SelectedTarget + RejectedAlternatives（进入 DecisionTrace）。
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / 任何 Runtime。
 */

import type { ThreatAssessment } from "../defense/threat-assessment";
import type { TerrainContext } from "../defense/terrain-context";
import type { MultiDimensionalConfidence } from "../defense/confidence";

// ═══════════════════════════════════════════════════════════
// §1. 类型定义
// ═══════════════════════════════════════════════════════════

/** 目标价值维度。 */
export interface TargetValueBreakdown {
  /** 资源价值（energy/mineral）。 */
  resourceValue: number;
  /** 经济影响（摧毁后对敌方经济的打击）。 */
  economicImpact: number;
  /** 战略价值（位置/通道意义）。 */
  strategicValue: number;
  /** 房间价值（RCL/设施等级）。 */
  roomValue: number;
  /** 未来价值（扩张潜力）。 */
  futureValue: number;
  /** 我方重建成本（如果目标是我方损失后夺回）。 */
  replacementCost: number;
  /** 物流成本（到达目标的运输开销）。 */
  logisticsCost: number;
  /** 军事成本（攻击所需的军事投入）。 */
  militaryCost: number;
  /** 总价值。 */
  total: number;
}

export interface TargetCandidate {
  /** 房间名。 */
  roomName: string;
  /** 是否已被占用。 */
  occupied: boolean;
  /** 房间 owner（有主房）。 */
  owner?: string;
  /** 塔数。 */
  towers?: number;
  /** RCL。 */
  rcl?: number;
  /** 通勤距离（房数）。 */
  distance: number;
  /** 情报新鲜度（tick 距上次观察）。 */
  intelAge: number;
  /** 威胁评估（如果有）。 */
  threatAssessment?: ThreatAssessment;
  /** 地形上下文（如果有）。 */
  terrainContext?: TerrainContext;
  /** 置信度（如果有）。 */
  confidence?: MultiDimensionalConfidence;
  /** 是否在黑名单中。 */
  blacklisted: boolean;
  /** 是否是远矿房。 */
  isRemote: boolean;
  /** 是否是核心房。 */
  isCore: boolean;
}

export interface TargetSelectionResult {
  /** 选中的目标。 */
  selected: TargetCandidate | undefined;
  /** 选中的目标评分。 */
  selectedScore: TargetScore | undefined;
  /** 被拒绝的候选。 */
  rejectedAlternatives: { roomName: string; score: number; reason: string }[];
  /** 所有候选的评分（用于 DecisionTrace）。 */
  allScores: { roomName: string; score: number; breakdown: TargetScore }[];
  /** 证据。 */
  evidence: string[];
}

export interface TargetScore {
  /** 目标价值评分（0-100）。 */
  valueScore: number;
  /** 威胁评分（0-100，越高越值得响应）。 */
  threatScore: number;
  /** 距离评分（0-100，越近越好）。 */
  distanceScore: number;
  /** 防御评分（0-100，越低越容易打）。 */
  defenseScore: number;
  /** 情报置信度评分（0-100）。 */
  intelScore: number;
  /** 物流评分（0-100，越高越容易补给）。 */
  logisticsScore: number;
  /** 战略影响评分（0-100）。 */
  strategicImpactScore: number;
  /** 总分。 */
  total: number;
}

// ═══════════════════════════════════════════════════════════
// §2. 目标评分纯函数
// ═══════════════════════════════════════════════════════════

export function scoreTarget(
  candidate: TargetCandidate,
  objective: string,
  maxDistance: number,
): TargetScore {
  // 价值评分
  const resourceValue = candidate.towers ? 20 : 40; // 有塔房资源多
  const economicImpact = candidate.rcl && candidate.rcl >= 6 ? 60
    : candidate.rcl && candidate.rcl >= 3 ? 30 : 10;
  const strategicValue = candidate.isCore ? 80 : candidate.isRemote ? 30 : 50;
  const roomValue = (candidate.rcl ?? 0) * 10;
  const futureValue = candidate.isRemote ? 10 : 20;
  const replacementCost = (candidate.rcl ?? 0) * 5;
  const logisticsCost = candidate.distance * 5;
  const militaryCost = (candidate.towers ?? 0) * 15;
  const valueScore = Math.max(0, Math.min(100,
    resourceValue * 0.1 + economicImpact * 0.2 + strategicValue * 0.25
    + roomValue * 0.15 + futureValue * 0.05 - logisticsCost * 0.1 - militaryCost * 0.15,
  ));

  // 威胁评分
  const threatScore = candidate.threatAssessment
    ? candidate.threatAssessment.score.total
    : 0;

  // 距离评分
  const distanceScore = Math.max(0, 100 - (candidate.distance / Math.max(1, maxDistance)) * 100);

  // 防御评分
  const towers = candidate.towers ?? 0;
  const defenseScore = Math.max(0, 100 - towers * 25);

  // 情报置信度
  const overallConfidence = candidate.confidence?.overallConfidence ?? 0.3;
  const intelAgeFactor = Math.max(0, 1 - candidate.intelAge / 5000);
  const intelScore = overallConfidence * 50 + intelAgeFactor * 50;

  // 物流评分
  const logisticsScore = Math.max(0, 100 - candidate.distance * 10);

  // 战略影响
  const strategicImpactScore = Math.min(100,
    economicImpact * 0.4 + strategicValue * 0.4 + (candidate.isCore ? 20 : 0),
  );

  // 总分加权
  const weights = {
    valueScore: 0.20,
    threatScore: 0.15,
    distanceScore: 0.20,
    defenseScore: 0.15,
    intelScore: 0.10,
    logisticsScore: 0.10,
    strategicImpactScore: 0.10,
  };

  const total = Math.round(
    valueScore * weights.valueScore +
    threatScore * weights.threatScore +
    distanceScore * weights.distanceScore +
    defenseScore * weights.defenseScore +
    intelScore * weights.intelScore +
    logisticsScore * weights.logisticsScore +
    strategicImpactScore * weights.strategicImpactScore,
  );

  return {
    valueScore: Math.round(valueScore),
    threatScore: Math.round(threatScore),
    distanceScore: Math.round(distanceScore),
    defenseScore: Math.round(defenseScore),
    intelScore: Math.round(intelScore),
    logisticsScore: Math.round(logisticsScore),
    strategicImpactScore: Math.round(strategicImpactScore),
    total,
  };
}

// ═══════════════════════════════════════════════════════════
// §3. 目标选择纯函数
// ═══════════════════════════════════════════════════════════

export function selectTarget(
  candidates: readonly TargetCandidate[],
  objective: string,
  maxDistance: number,
  freshnessThreshold: number,
  maxTowers: number,
  blacklist: Readonly<Record<string, number>>,
  currentTick: number,
): TargetSelectionResult {
  const evidence: string[] = [];
  const rejectedAlternatives: { roomName: string; score: number; reason: string }[] = [];
  const allScores: { roomName: string; score: number; breakdown: TargetScore }[] = [];

  let best: TargetCandidate | undefined;
  let bestScore: TargetScore | undefined;

  for (const c of candidates) {
    // 硬过滤
    if (c.occupied) {
      rejectedAlternatives.push({ roomName: c.roomName, score: 0, reason: "occupied" });
      continue;
    }
    if (c.blacklisted || (blacklist[c.roomName] ?? 0) > currentTick) {
      rejectedAlternatives.push({ roomName: c.roomName, score: 0, reason: "blacklisted" });
      continue;
    }
    if (c.intelAge > freshnessThreshold) {
      rejectedAlternatives.push({ roomName: c.roomName, score: 0, reason: `intel stale (${c.intelAge} > ${freshnessThreshold})` });
      continue;
    }
    if ((c.towers ?? 0) >= maxTowers) {
      rejectedAlternatives.push({ roomName: c.roomName, score: 0, reason: `towers=${c.towers} >= ${maxTowers}` });
      continue;
    }
    if (!c.owner) {
      // 无主房只对 CLAIM/RESERVE 有意义
      if (objective !== "CAPTURE_CONTROLLER" && objective !== "SECURE_ROOM") {
        rejectedAlternatives.push({ roomName: c.roomName, score: 0, reason: "no owner (not claim target)" });
        continue;
      }
    }

    const score = scoreTarget(c, objective, maxDistance);
    allScores.push({ roomName: c.roomName, score: score.total, breakdown: score });

    if (!bestScore || score.total > bestScore.total) {
      best = c;
      bestScore = score;
    }
  }

  if (best && bestScore) {
    evidence.push(`selected=${best.roomName} score=${bestScore.total}`);
    evidence.push(`value=${bestScore.valueScore} threat=${bestScore.threatScore} distance=${bestScore.distanceScore} defense=${bestScore.defenseScore} intel=${bestScore.intelScore}`);
  } else {
    evidence.push("no valid target found");
  }

  return {
    selected: best,
    selectedScore: bestScore,
    rejectedAlternatives,
    allScores,
    evidence,
  };
}
