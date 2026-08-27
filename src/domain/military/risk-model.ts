/** Risk Model */

import type { CombatPower } from "../combat/capability";
import type { TerrainContext } from "../defense/terrain-context";
import type { MultiDimensionalConfidence } from "../defense/confidence";

// ═══════════════════════════════════════════════════════════
// §1. 类型定义
// ═══════════════════════════════════════════════════════════

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskInput {
  /** 敌方战斗力估计。 */
  enemyPower: CombatPower;
  /** 我方可用战斗力。 */
  ourPower: CombatPower;
  /** 地形上下文（目标房）。 */
  terrain: TerrainContext;
  /** 目标房 safe mode 可用次数。 */
  targetSafeModeAvailable: number;
  /** 增援 ETA（tick）。 */
  reinforcementETA: number;
  /** 物流可靠性（0-1）。 */
  logisticsReliability: number;
  /** 恢复能力（0-1，0=无恢复能力）。 */
  recoveryCapability: number;
  /** 多维度置信度。 */
  confidence?: MultiDimensionalConfidence;
}

export interface RiskResult {
  level: RiskLevel;
  /** 风险分数（0-1，越高越危险）。 */
  score: number;
  /** 各维度拆解。 */
  breakdown: {
    capabilityGap: number;
    terrainRisk: number;
    towerRisk: number;
    safeModeRisk: number;
    reinforcementRisk: number;
    retreatRisk: number;
    intelRisk: number;
    logisticsRisk: number;
    recoveryRisk: number;
  };
  /** 证据。 */
  evidence: string[];
}

// ═══════════════════════════════════════════════════════════
// §2. 评估纯函数
// ═══════════════════════════════════════════════════════════

export function assessOperationRisk(input: RiskInput): RiskResult {
  const evidence: string[] = [];

  // 1. Capability Gap — 敌我战力比
  const enemyScore = input.enemyPower.powerScore;
  const ourScore = input.ourPower.powerScore;
  const ratio = ourScore > 0 ? enemyScore / ourScore : 99;
  const capabilityGap = Math.min(1, Math.max(0, (ratio - 0.5) / 2));
  evidence.push(`enemy=${enemyScore.toFixed(0)} vs our=${ourScore.toFixed(0)} ratio=${ratio.toFixed(2)}`);

  // 2. Terrain Risk — 地形不利增加风险
  const terrainRisk = computeTerrainRisk(input.terrain);
  evidence.push(`terrain=${input.terrain.terrainType} risk=${terrainRisk.toFixed(2)}`);

  // 3. Tower Risk — 敌方塔覆盖
  const towerRisk = computeTowerRisk(input.terrain);
  evidence.push(`towerCoverage=${input.terrain.towerCoverage} risk=${towerRisk.toFixed(2)}`);

  // 4. SafeMode Risk — 敌方有 safe mode
  const safeModeRisk = input.targetSafeModeAvailable > 0 ? 0.5 : 0;
  evidence.push(`safeMode=${input.targetSafeModeAvailable} risk=${safeModeRisk.toFixed(2)}`);

  // 5. Reinforcement Risk — 增援慢增加风险
  const reinforcementRisk = input.reinforcementETA > 200 ? 0.6
    : input.reinforcementETA > 100 ? 0.3
      : input.reinforcementETA > 50 ? 0.15
        : 0;
  evidence.push(`reinforcementETA=${input.reinforcementETA} risk=${reinforcementRisk.toFixed(2)}`);

  // 6. Retreat Risk — 撤退质量差增加风险
  const retreatRiskMap: Record<string, number> = {
    VERY_GOOD: 0, GOOD: 0.15, POOR: 0.4, CRITICAL: 0.7, UNKNOWN: 0.3,
  };
  const retreatRisk = retreatRiskMap[input.terrain.retreatQuality] ?? 0.3;
  evidence.push(`retreatQuality=${input.terrain.retreatQuality} risk=${retreatRisk.toFixed(2)}`);

  // 7. Intel Risk — 情报不足增加风险
  const overallConfidence = input.confidence?.overallConfidence ?? 0.5;
  const intelRisk = 1 - overallConfidence;
  evidence.push(`intelConfidence=${overallConfidence.toFixed(2)} risk=${intelRisk.toFixed(2)}`);

  // 8. Logistics Risk — 物流不可靠
  const logisticsRisk = 1 - input.logisticsReliability;
  evidence.push(`logisticsReliability=${input.logisticsReliability.toFixed(2)} risk=${logisticsRisk.toFixed(2)}`);

  // 9. Recovery Risk — 恢复能力不足
  const recoveryRisk = 1 - input.recoveryCapability;
  evidence.push(`recoveryCapability=${input.recoveryCapability.toFixed(2)} risk=${recoveryRisk.toFixed(2)}`);

  // 加权汇总
  const weights = {
    capabilityGap: 0.25,
    terrainRisk: 0.10,
    towerRisk: 0.10,
    safeModeRisk: 0.08,
    reinforcementRisk: 0.10,
    retreatRisk: 0.10,
    intelRisk: 0.12,
    logisticsRisk: 0.08,
    recoveryRisk: 0.07,
  };

  const score =
    capabilityGap * weights.capabilityGap +
    terrainRisk * weights.terrainRisk +
    towerRisk * weights.towerRisk +
    safeModeRisk * weights.safeModeRisk +
    reinforcementRisk * weights.reinforcementRisk +
    retreatRisk * weights.retreatRisk +
    intelRisk * weights.intelRisk +
    logisticsRisk * weights.logisticsRisk +
    recoveryRisk * weights.recoveryRisk;

  const level: RiskLevel = score >= 0.7 ? "CRITICAL"
    : score >= 0.45 ? "HIGH"
      : score >= 0.2 ? "MEDIUM"
        : "LOW";

  return {
    level,
    score: Math.round(score * 100) / 100,
    breakdown: {
      capabilityGap: Math.round(capabilityGap * 100) / 100,
      terrainRisk: Math.round(terrainRisk * 100) / 100,
      towerRisk: Math.round(towerRisk * 100) / 100,
      safeModeRisk: Math.round(safeModeRisk * 100) / 100,
      reinforcementRisk: Math.round(reinforcementRisk * 100) / 100,
      retreatRisk: Math.round(retreatRisk * 100) / 100,
      intelRisk: Math.round(intelRisk * 100) / 100,
      logisticsRisk: Math.round(logisticsRisk * 100) / 100,
      recoveryRisk: Math.round(recoveryRisk * 100) / 100,
    },
    evidence,
  };
}

function computeTerrainRisk(terrain: TerrainContext): number {
  // 敌方有利地形增加风险
  switch (terrain.terrainType) {
    case "FORTIFIED": return 0.8;   // 敌方有 rampart
    case "CORE_DEFENSE": return 0.7; // 敌方塔密集
    case "CHOKEPOINT": return 0.5;  // 瓶颈难突破
    case "CONFINED": return 0.4;
    case "CORRIDOR": return 0.3;
    case "OPEN": return 0.2;
    case "OPEN_FIELD": return 0.1;  // 开阔地对我有利
    case "UNKNOWN": return 0.5;     // 未知取中等
    default: return 0.5;
  }
}

function computeTowerRisk(terrain: TerrainContext): number {
  switch (terrain.towerCoverage) {
    case "NONE": return 0;
    case "LOW": return 0.2;
    case "MEDIUM": return 0.4;
    case "HIGH": return 0.65;
    case "CRITICAL": return 0.85;
    case "UNKNOWN": return 0.5;
    default: return 0.5;
  }
}
