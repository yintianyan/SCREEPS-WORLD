/**
 * War Planning — A5.3 planMilitaryOperation() 核心规划纯函数。
 *
 * 核心链路：
 *   ThreatAssessment + CombatCapability + TerrainContext + PlayerIntel
 *   + EmpireHealth + ResourceView + OperationContext
 *   → WarPlan
 *
 * A5.3 约束：
 * - WarPlan 只是 Plan
 * - 禁止直接修改 Game
 * - 禁止直接修改 Memory
 * - 禁止直接 Spawn
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / 任何 Runtime。
 */

import type { ThreatAssessment } from "../defense/threat-assessment";
import type { TerrainContext } from "../defense/terrain-context";
import type { PlayerIntelRecord } from "../defense/player-intel";
import type { MultiDimensionalConfidence } from "../defense/confidence";
import type { CombatPower } from "../combat/capability";
import type { EmpireHealthResult } from "../strategy/empire-health";

import {
  type OperationType,
  type WarObjective,
  type MilitaryOperation,
  type OperationConstraints,
  type AbortCondition,
  makeOperationId,
  isOffensive,
  canTransition,
} from "./operation";
import {
  type WarPostureResult,
  evaluateWarPosture,
  isOperationAuthorized,
} from "./war-posture";
import {
  type TargetCandidate,
  type TargetSelectionResult,
  selectTarget,
} from "./target-selection";
import {
  type RequiredCapability,
  type CapabilityGap,
  type ForceComposition,
  deriveRequiredCapability,
  computeCapabilityGap,
  deriveForceComposition,
} from "./force-requirement";
import {
  type WarCost,
  estimateWarCost,
  type WarCostInput,
} from "./war-cost";
import {
  type RiskResult,
  assessOperationRisk,
  type RiskInput,
} from "./risk-model";
import {
  type OperationValueResult,
  evaluateOperationValue,
} from "./operation-value";
import {
  type EconomicGuardResult,
  checkEconomicGuard,
  type EconomicGuardInput,
} from "./economic-guard";

// ═══════════════════════════════════════════════════════════
// §1. 输入类型
// ═══════════════════════════════════════════════════════════

export interface WarPlanningInput {
  /** 当前 tick。 */
  tick: number;
  /** 帝国姿态。 */
  empirePosture: "develop" | "expand" | "fortify" | "war";
  /** 帝国健康度。 */
  empireHealth: EmpireHealthResult;
  /** 帝国能量储备。 */
  empireEnergyReserve: number;
  /** CPU tier。 */
  cpuTier: "healthy" | "guarded" | "conserve" | "recovery";
  /** 威胁评估列表。 */
  threatAssessments: readonly { roomName: string; assessment: ThreatAssessment; terrain?: TerrainContext }[];
  /** 玩家情报。 */
  playerIntel?: PlayerIntelRecord;
  /** 置信度（最高威胁房的）。 */
  confidence?: MultiDimensionalConfidence;
  /** 目标候选列表。 */
  targetCandidates: readonly TargetCandidate[];
  /** 我方可用战斗力。 */
  ourPower: CombatPower;
  /** 可用 spawn 数。 */
  spawnCapacity: number;
  /** 活跃远矿数。 */
  activeRemoteCount: number;
  /** 物流可靠性（0-1）。 */
  logisticsReliability: number;
  /** 恢复能力（0-1）。 */
  recoveryCapability: number;
  /** 替换能力（0-1）。 */
  replacementCapacity: number;
  /** 黑名单。 */
  blacklist: Readonly<Record<string, number>>;
  /** 情报新鲜度阈值。 */
  freshnessThreshold: number;
  /** 最大塔数限制。 */
  maxTowers: number;
  /** 最大距离。 */
  maxDistance: number;
  /** 是否有活跃 Operation。 */
  hasActiveOperation: boolean;
  /** 每单位孵化能量。 */
  energyPerCreep: number;
  /** Boost 成本（每单位）。 */
  boostCostPerCreep: number;
  /** 序号（生成 operationId）。 */
  seq: number;
}

// ═══════════════════════════════════════════════════════════
// §2. WarPlan 输出
// ═══════════════════════════════════════════════════════════

export interface WarPlan {
  /** 操作。 */
  operation: MilitaryOperation;
  /** 姿态。 */
  posture: WarPostureResult;
  /** 目标选择结果。 */
  targetSelection: TargetSelectionResult;
  /** 需求能力。 */
  requiredCapabilities: RequiredCapability;
  /** 可用能力。 */
  availableCapabilities: RequiredCapability;
  /** 能力差距。 */
  capabilityGaps: CapabilityGap;
  /** 编队需求。 */
  forceRequirement: ForceComposition;
  /** 战争成本。 */
  warCost: WarCost;
  /** 物流需求。 */
  logisticsRequirement: {
    energy: number;
    boost: number;
    transport: number;
    replacement: number;
  };
  /** Spawn 需求。 */
  spawnRequirement: {
    role: string;
    count: number;
    priority: number;
    home: string;
  }[];
  /** 风险。 */
  risk: RiskResult;
  /** 期望价值。 */
  expectedValue: OperationValueResult;
  /** 经济护栏。 */
  economicGuard: EconomicGuardResult;
  /** 止损条件。 */
  abortConditions: string[];
  /** 置信度。 */
  confidence: number;
  /** 证据。 */
  evidence: string[];
  /** WarPlan Hash（确定性）。 */
  hash: string;
}

// ═══════════════════════════════════════════════════════════
// §3. 核心：从威胁推导 OperationType
// ═══════════════════════════════════════════════════════════

/**
 * 从威胁评估推导军事行动类型。
 *
 * ThreatIntent 回答「敌人想干什么？」
 * OperationType 回答「我们准备干什么？」
 *
 * 例如：
 * - REMOTE_MINING_ATTACK → DEFEND_REMOTE / ESCORT / PAUSE_REMOTE / RETREAT
 * - SIEGE → DEFEND / BREAK_SIEGE
 * - FULL_ASSAULT → DEFEND / ASSAULT
 */
function deriveOperationType(
  threat: ThreatAssessment,
  isRemoteRoom: boolean,
): { type: OperationType; objective: WarObjective } {
  const intent = threat.estimatedIntent.intent;

  // 远矿房威胁
  if (isRemoteRoom) {
    switch (intent) {
      case "REMOTE_MINING_ATTACK":
      case "HARASSMENT":
        return { type: "ESCORT", objective: "ESCORT_OPERATION" };
      case "SCOUTING":
        return { type: "ESCORT", objective: "ESCORT_OPERATION" };
      case "SIEGE":
      case "FULL_ASSAULT":
        return { type: "RETREAT", objective: "RETREAT_AND_PRESERVE_FORCE" };
      default:
        return { type: "ESCORT", objective: "DEFEND_REMOTE" };
    }
  }

  // 核心房威胁
  switch (intent) {
    case "NUCLEAR":
      return { type: "DEFEND", objective: "DEFEND_CORE" };
    case "FULL_ASSAULT":
      return { type: "DEFEND", objective: "DEFEND_CORE" };
    case "SIEGE":
      return { type: "DEFEND", objective: "BREAK_SIEGE" };
    case "CONTROLLER_ATTACK":
      return { type: "DEFEND", objective: "DEFEND_CORE" };
    case "ECONOMIC_ATTACK":
      return { type: "DEFEND", objective: "DEFEND_CORE" };
    case "CLAIM":
      return { type: "DEFEND", objective: "DEFEND_CORE" };
    case "HARASSMENT":
      return { type: "DEFEND", objective: "DEFEND_CORE" };
    case "REMOTE_MINING_ATTACK":
      return { type: "ESCORT", objective: "DEFEND_REMOTE" };
    case "SCOUTING":
      return { type: "DEFEND", objective: "DEFEND_CORE" };
    default:
      return { type: "DEFEND", objective: "DEFEND_CORE" };
  }
}

// ═══════════════════════════════════════════════════════════
// §4. 从威胁推导目标候选
// ═══════════════════════════════════════════════════════════

/**
 * 从威胁评估推导 Operation 的目标。
 * 防御性 Operation 目标是被威胁的房间本身。
 * 进攻性 Operation 目标从候选列表选择。
 */
function deriveTarget(
  threat: { roomName: string; assessment: ThreatAssessment },
  candidates: readonly TargetCandidate[],
  opType: OperationType,
  input: WarPlanningInput,
): TargetSelectionResult {
  if (!isOffensive(opType)) {
    // 防御性 Operation：目标是受威胁房
    const target: TargetCandidate = {
      roomName: threat.roomName,
      occupied: true,
      owner: undefined,
      towers: undefined,
      distance: 0,
      intelAge: 0,
      blacklisted: false,
      isRemote: false,
      isCore: true,
    };
    return {
      selected: target,
      selectedScore: { valueScore: 80, threatScore: threat.assessment.score.total, distanceScore: 100, defenseScore: 50, intelScore: 50, logisticsScore: 100, strategicImpactScore: 80, total: 80 },
      rejectedAlternatives: [],
      allScores: [],
      evidence: [`defensive target=${threat.roomName}`],
    };
  }

  // 进攻性 Operation：从候选选择
  return selectTarget(
    candidates,
    opType,
    input.maxDistance,
    input.freshnessThreshold,
    input.maxTowers,
    input.blacklist,
    input.tick,
  );
}

// ═══════════════════════════════════════════════════════════
// §5. 主函数：planMilitaryOperation
// ═══════════════════════════════════════════════════════════

export function planMilitaryOperation(input: WarPlanningInput): WarPlan | undefined {
  const evidence: string[] = [];

  // 1. 评估 WarPosture（唯一进攻授权）
  const posture = evaluateWarPosture({
    empirePosture: input.empirePosture,
    tick: input.tick,
    empireHealth: input.empireHealth.level,
    empireEnergyReserve: input.empireEnergyReserve,
    threatAssessments: input.threatAssessments.map(t => ({ roomName: t.roomName, assessment: t.assessment })),
    playerIntel: input.playerIntel,
    confidence: input.confidence,
    cpuTier: input.cpuTier,
    activeRemoteCount: input.activeRemoteCount,
    spawnCapacity: input.spawnCapacity,
    hasActiveOperation: input.hasActiveOperation,
  });
  evidence.push(...posture.reasons);

  // 2. 找最高威胁
  if (input.threatAssessments.length === 0) {
    evidence.push("no threats → no operation needed");
    return undefined;
  }

  const maxThreatEntry = input.threatAssessments.reduce((max, t) => {
    const rank = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[t.assessment.level] ?? 0;
    const maxRank = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[max.assessment.level] ?? 0;
    return rank > maxRank ? t : max;
  }, input.threatAssessments[0]!);

  // 3. 推导 OperationType + Objective
  const isRemote = maxThreatEntry.assessment.estimatedIntent.intent === "REMOTE_MINING_ATTACK"
    || maxThreatEntry.assessment.estimatedIntent.intent === "SCOUTING";
  const { type: opType, objective } = deriveOperationType(maxThreatEntry.assessment, isRemote);

  // 4. 检查 WarPosture 是否授权此 OperationType
  const authorized = isOperationAuthorized(posture.posture, opType);
  if (!authorized) {
    evidence.push(`operationType=${opType} not authorized by posture=${posture.posture}`);
    // 非授权时不产生 WarPlan，但记录原因
    return undefined;
  }

  // 5. 目标选择
  const targetSelection = deriveTarget(maxThreatEntry, input.targetCandidates, opType, input);
  if (!targetSelection.selected) {
    evidence.push("no valid target → no operation");
    return undefined;
  }
  evidence.push(...targetSelection.evidence);

  // 6. 能力需求推导
  const enemyPower = maxThreatEntry.assessment.enemyCombatPower;
  const enemyTowers = targetSelection.selected.towers ?? 0;
  const requiredCaps = deriveRequiredCapability(opType, enemyPower, enemyTowers);

  // 7. 可用能力（从 ourPower 推导）
  const availableCaps: RequiredCapability = {
    attack: input.ourPower.burstDamage,
    rangedAttack: input.ourPower.burstDamage * 0.5,
    heal: input.ourPower.healOutput,
    effectiveHP: input.ourPower.effectiveHP,
    dismantle: input.ourPower.dismantlePower,
    mobility: input.ourPower.mobility,
    claim: 0,
    support: 0,
  };

  // 8. 能力差距
  const intelConfidence = input.confidence?.overallConfidence ?? 0.5;
  const capabilityGaps = computeCapabilityGap(requiredCaps, availableCaps, intelConfidence);
  evidence.push(...capabilityGaps.evidence);

  // 9. 编队需求
  const forceReq = deriveForceComposition(opType, requiredCaps);
  evidence.push(...forceReq.evidence);

  // 10. 战争成本
  const expectedLossRate = 1 - Math.min(1, input.ourPower.powerScore / Math.max(1, enemyPower.powerScore));
  const warCostInput: WarCostInput = {
    squadSize: forceReq.total,
    energyPerCreep: input.energyPerCreep,
    needsBoost: enemyPower.boosted,
    boostCostPerCreep: input.boostCostPerCreep,
    expectedLossRate: Math.min(0.8, expectedLossRate),
    transportDistance: targetSelection.selected.distance,
    expectedDuration: 500,
    opportunityCostPerTick: 10,
    cpuPerTick: 2,
    recoveryRatio: 0.3,
  };
  const warCost = estimateWarCost(warCostInput);
  evidence.push(`warCost.total=${warCost.total}`);

  // 11. 风险评估
  const terrain = maxThreatEntry.terrain;
  const riskInput: RiskInput = {
    enemyPower,
    ourPower: input.ourPower,
    terrain: terrain ?? {
      roomName: maxThreatEntry.roomName,
      terrainType: "UNKNOWN",
      walkability: "UNKNOWN",
      openTileRatio: 0,
      wallDensity: 0,
      chokepoints: [],
      corridors: [],
      rampartCoverage: "UNKNOWN",
      towerCoverage: "UNKNOWN",
      coreExposure: 0.5,
      retreatQuality: "UNKNOWN",
      mobilityModifier: 1,
      tick: input.tick,
    },
    targetSafeModeAvailable: 0,
    reinforcementETA: 100,
    logisticsReliability: input.logisticsReliability,
    recoveryCapability: input.recoveryCapability,
    confidence: input.confidence,
  };
  const risk = assessOperationRisk(riskInput);
  evidence.push(`risk=${risk.level}(${risk.score})`);

  // 12. 经济护栏
  const econGuard = checkEconomicGuard({
    empireEnergyReserve: input.empireEnergyReserve,
    empireHealth: input.empireHealth.level,
    spawnCapacity: input.spawnCapacity,
    replacementCapacity: input.replacementCapacity,
    logisticsReliability: input.logisticsReliability,
    recoveryCapacity: input.recoveryCapability,
    warCost: warCost.total,
    isDefensive: !isOffensive(opType),
  });
  evidence.push(`economicGuard=${econGuard.passed ? "PASS" : "FAIL"}:${econGuard.recommendation}`);

  // 13. 期望价值
  const successRate = Math.min(0.95, Math.max(0.05,
    input.ourPower.powerScore / Math.max(1, enemyPower.powerScore) * (1 - risk.score * 0.5),
  ));
  const expectedValue = evaluateOperationValue({
    targetStrategicValue: targetSelection.selectedScore?.strategicImpactScore ?? 50,
    targetEconomicValue: 1000,
    expectedSuccessRate: successRate,
    warCost,
    risk,
    confidence: intelConfidence,
    isDefensive: !isOffensive(opType),
  });
  evidence.push(`netValue=${expectedValue.netValue} → ${expectedValue.recommendation}`);

  // 14. 止损条件
  const abortConditions: AbortCondition[] = [
    "ENEMY_CAPABILITY_INCREASED",
    "INTEL_STALE",
    "LOGISTICS_COLLAPSED",
    "REINFORCEMENT_TIMEOUT",
    "EXPECTED_VALUE_NEGATIVE",
    "CASUALTY_EXCEEDED",
  ];

  // 15. 构建 Operation
  const operationId = makeOperationId(input.tick, input.seq);
  const operation: MilitaryOperation = {
    operationId,
    type: opType,
    objective,
    target: {
      roomName: targetSelection.selected.roomName,
      targetType: "room",
      valueScore: targetSelection.selectedScore?.valueScore ?? 50,
      evidence: targetSelection.evidence,
    },
    posture: posture.posture,
    priority: {
      score: Math.min(100, maxThreatEntry.assessment.score.total + (isOffensive(opType) ? 10 : 20)),
      factor: isOffensive(opType) ? "OFFENSIVE" : "DEFENSIVE",
      evidence: [`threatScore=${maxThreatEntry.assessment.score.total}`],
    },
    risk: risk.level,
    status: "PLANNED",
    constraints: {
      maxCpuPerTick: 5,
      maxEnergyBudget: warCost.total,
      maxDuration: 5000,
      minIntelConfidence: 0.3,
      allowBoost: enemyPower.boosted,
      allowNuke: false,
      abortConditions,
    },
    createdTick: input.tick,
    expiresTick: input.tick + 5000,
    confidence: intelConfidence,
    reason: posture.reasons.join("; "),
    evidence: [...evidence],
  };

  // 16. 物流需求
  const logisticsRequirement = {
    energy: warCost.spawnEnergyCost + warCost.transportCost,
    boost: warCost.boostCost,
    transport: warCost.transportCost,
    replacement: warCost.replacementCost,
  };

  // 17. Spawn 需求（标准格式，供 spawn-manager 消费）
  const spawnRequirement: WarPlan["spawnRequirement"] = [];
  if (forceReq.attacker > 0) {
    spawnRequirement.push({ role: "attacker", count: forceReq.attacker, priority: 2, home: targetSelection.selected.roomName });
  }
  if (forceReq.healer > 0) {
    spawnRequirement.push({ role: "healer", count: forceReq.healer, priority: 2, home: targetSelection.selected.roomName });
  }
  if (forceReq.tank > 0) {
    spawnRequirement.push({ role: "attacker", count: forceReq.tank, priority: 2, home: targetSelection.selected.roomName });
  }
  if (forceReq.dismantler > 0) {
    spawnRequirement.push({ role: "attacker", count: forceReq.dismantler, priority: 2, home: targetSelection.selected.roomName });
  }

  // 18. 构建 WarPlan
  const plan: WarPlan = {
    operation,
    posture,
    targetSelection,
    requiredCapabilities: requiredCaps,
    availableCapabilities: availableCaps,
    capabilityGaps,
    forceRequirement: forceReq,
    warCost,
    logisticsRequirement,
    spawnRequirement,
    risk,
    expectedValue,
    economicGuard: econGuard,
    abortConditions,
    confidence: intelConfidence,
    evidence,
    hash: "",
  };

  // 19. 计算 WarPlan Hash
  plan.hash = warPlanHash(plan);

  return plan;
}

// ═══════════════════════════════════════════════════════════
// §6. WarPlan Hash（确定性）
// ═══════════════════════════════════════════════════════════

export function warPlanHash(plan: WarPlan): string {
  const payload = JSON.stringify({
    op: plan.operation.operationId,
    type: plan.operation.type,
    target: plan.operation.target.roomName,
    posture: plan.posture.posture,
    risk: plan.risk.level,
    netValue: plan.expectedValue.netValue,
    recommendation: plan.expectedValue.recommendation,
    gap: plan.capabilityGaps.totalGapRatio,
    confidence: plan.confidence,
    econGuard: plan.economicGuard.passed,
  });
  return fnv1a32Hex(payload);
}

function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
