/**
 * Confidence Model — A5.2 多维度置信度聚合。
 *
 * 设计原则：
 * - 禁止只有一个 confidence 数字覆盖所有不确定性
 * - 必须区分 factConfidence / combatConfidence / intentConfidence /
 *   terrainConfidence / intelConfidence / overallConfidence
 * - aggregateConfidence() 禁止简单 average，必须明确权重和冲突处理
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / 任何 Runtime。
 */

import type { IntelConfidence, PlayerIntelRecord } from "./player-intel";
import type { TerrainContext } from "./terrain-context";
import { CONFIDENCE_VALUE } from "./player-intel";

// ═══════════════════════════════════════════════════════════
// §1. 多维度置信度
// ═══════════════════════════════════════════════════════════

/**
 * 多维度置信度——不压缩为单一数字。
 *
 * 每个维度独立评估不确定性来源：
 * - factConfidence: 引擎事实（nuke 落点、body 解析）的置信度
 * - combatConfidence: G2 CombatCapability 解析的置信度
 * - intentConfidence: G1 ThreatIntent 推断的置信度
 * - terrainConfidence: G3 TerrainContext 的置信度
 * - intelConfidence: G5 PlayerIntel 的聚合置信度
 */
export interface MultiDimensionalConfidence {
  /** 引擎事实置信度（nuke/body 可见性等引擎层 facts）。 */
  factConfidence: number;      // 0-1
  /** 战斗能力解析置信度（body 是否完整可见、boost 是否识别）。 */
  combatConfidence: number;    // 0-1
  /** 意图推断置信度（基于证据链强度）。 */
  intentConfidence: number;    // 0-1
  /** 地形上下文置信度（是否有视野、地形数据是否完整）。 */
  terrainConfidence: number;   // 0-1
  /** 玩家情报置信度（PlayerIntel 聚合后的置信度）。 */
  intelConfidence: number;     // 0-1
  /** 聚合后的总体置信度。 */
  overallConfidence: number;   // 0-1
}

// ═══════════════════════════════════════════════════════════
// §2. 各维度置信度计算
// ═══════════════════════════════════════════════════════════

/**
 * 计算引擎事实置信度。
 *
 * 引擎事实（如 nuke 落点、hostile body 可见性）由引擎保证，
 * 通常为 1.0。但如果 body 未完全可见（如部分 creep 在视野边缘），
 * 则降低。
 */
export function computeFactConfidence(
  hasNuke: boolean,
  allBodiesVisible: boolean,
  hostileCount: number,
): number {
  // nuke 是引擎事实，置信度 1.0
  if (hasNuke) return 1.0;

  // 无敌方单位时没有 fact 需要评估
  if (hostileCount === 0) return 1.0;

  // body 完全可见 = fact
  if (allBodiesVisible) return 0.95;

  // 部分可见
  return 0.5;
}

/**
 * 计算战斗能力解析置信度。
 *
 * 基于 body 解析的完整性：
 * - body 全部可见且 boost 已识别 → 0.9
 * - body 可见但 boost 未识别 → 0.7
 * - body 部分不可见 → 0.4
 */
export function computeCombatConfidence(
  allBodiesVisible: boolean,
  boostIdentified: boolean,
): number {
  if (!allBodiesVisible) return 0.4;
  if (!boostIdentified) return 0.7;
  return 0.9;
}

/**
 * 计算意图推断置信度。
 *
 * 直接使用 IntentAssessment.confidence。
 */
export function computeIntentConfidence(intentConfidence: number): number {
  return Math.max(0, Math.min(1, intentConfidence));
}

/**
 * 计算地形上下文置信度。
 *
 * 基于 TerrainContext 的视野和数据完整性：
 * - 有视野且地形数据完整 → 0.9
 * - 有视野但部分数据缺失 → 0.6
 * - 无视野 → 0.3（UNKNOWN 地形）
 */
export function computeTerrainConfidence(terrain: TerrainContext): number {
  if (terrain.terrainType === "UNKNOWN") return 0.3;
  if (terrain.walkability === "UNKNOWN") return 0.3;

  // 有视野但部分特征可能不完整
  let confidence = 0.9;

  // chokepoint/corridor 识别不完整时降低
  if (terrain.chokepoints.length === 0 && terrain.walkability === "RESTRICTED") {
    confidence -= 0.1; // 可能是识别不够而非真的没有
  }

  // tower 位置未知时降低
  if (terrain.towerCoverage === "UNKNOWN") {
    confidence -= 0.15;
  }

  return Math.max(0.3, confidence);
}

/**
 * 计算玩家情报置信度。
 *
 * 从 PlayerIntelRecord.aggregatedConfidence 映射到 0-1 数值。
 */
export function computeIntelConfidence(
  playerIntel?: PlayerIntelRecord,
): number {
  if (!playerIntel) return 0.0; // 无情报

  const value = CONFIDENCE_VALUE[playerIntel.aggregatedConfidence];

  // 冲突情报降低置信度
  if (playerIntel.hasConflict) {
    return value * 0.7;
  }

  return value;
}

// ═══════════════════════════════════════════════════════════
// §3. Confidence 聚合
// ═══════════════════════════════════════════════════════════

/**
 * Confidence 聚合权重。
 *
 * 不同维度的权重不同：
 * - factConfidence: 最高权重（引擎事实最可靠）
 * - combatConfidence: 高权重（body 解析是直接观察）
 * - intentConfidence: 中等权重（推断有不确定性）
 * - terrainConfidence: 中等权重（地形是上下文）
 * - intelConfidence: 最低权重（玩家情报是间接信息）
 *
 * ⚠ 禁止简单 average——必须用加权聚合 + 冲突处理。
 */
export const CONFIDENCE_WEIGHTS = {
  fact: 0.30,
  combat: 0.25,
  intent: 0.20,
  terrain: 0.15,
  intel: 0.10,
} as const;

/**
 * 聚合多维度置信度。
 *
 * 算法：
 * 1. 对每个维度应用对应权重
 * 2. 检查维度间的冲突（如 fact 高但 intent 低 → 可能意图推断错误）
 * 3. 冲突时降低 overallConfidence
 * 4. 返回完整的 MultiDimensionalConfidence
 */
export function aggregateConfidence(
  factConfidence: number,
  combatConfidence: number,
  intentConfidence: number,
  terrainConfidence: number,
  intelConfidence: number,
): MultiDimensionalConfidence {
  // 加权求和
  const weighted =
    factConfidence * CONFIDENCE_WEIGHTS.fact +
    combatConfidence * CONFIDENCE_WEIGHTS.combat +
    intentConfidence * CONFIDENCE_WEIGHTS.intent +
    terrainConfidence * CONFIDENCE_WEIGHTS.terrain +
    intelConfidence * CONFIDENCE_WEIGHTS.intel;

  // 冲突检测：fact 高但 intent 低 → 推断可能有误
  let conflictPenalty = 0;
  if (factConfidence > 0.8 && intentConfidence < 0.4) {
    // 引擎事实明确但意图推断置信度低 → 可能需要更多观察
    conflictPenalty = 0.1;
  }

  // 冲突检测：combat 高但 intel 低 → 情报不足影响判断
  if (combatConfidence > 0.8 && intelConfidence < 0.2) {
    // 能看到 body 但没有玩家历史情报 → 不确定性增加
    conflictPenalty = Math.max(conflictPenalty, 0.05);
  }

  const overallConfidence = Math.max(0, Math.min(1, weighted - conflictPenalty));

  return {
    factConfidence: Math.round(factConfidence * 100) / 100,
    combatConfidence: Math.round(combatConfidence * 100) / 100,
    intentConfidence: Math.round(intentConfidence * 100) / 100,
    terrainConfidence: Math.round(terrainConfidence * 100) / 100,
    intelConfidence: Math.round(intelConfidence * 100) / 100,
    overallConfidence: Math.round(overallConfidence * 100) / 100,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. 便捷函数
// ═══════════════════════════════════════════════════════════

/**
 * 从 overallConfidence 映射到 ThreatConfidence（A5.1 兼容）。
 *
 * A5.1 的 ThreatConfidence 有 4 个等级：fact / stale / inferred / unknown。
 * A5.2 扩展为 6 维，但需要向后兼容 A5.1 的 ThreatAssessment.confidence 字段。
 */
export function toThreatConfidence(
  overall: number,
): "fact" | "stale" | "inferred" | "unknown" {
  if (overall >= 0.8) return "fact";
  if (overall >= 0.5) return "inferred";
  if (overall >= 0.2) return "stale";
  return "unknown";
}
