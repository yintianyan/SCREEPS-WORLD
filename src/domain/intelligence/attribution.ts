/** A6.1 Attribution Model — Domain 层纯函数与类型定义。 */

import type {
  Attribution,
  AttributionEvidence,
  AttributionFactor,
  AttributionMethod,
  ExperienceType,
  OutcomeRecord,
  OutcomeClassification,
  ExperienceContext,
} from "./experience";

// ═══════════════════════════════════════════════════════════
// §1. Attribution Input
// ═══════════════════════════════════════════════════════════

/**
 * Attribution 采集输入 — 从已有系统和 Outcome 中收集的状态。

 * 由 system 层薄壳采集并注入，domain 纯函数不直接读 Game/Memory。
 */
export interface AttributionInput {
  /** Experience 类型（决定归因策略）。 */
  type: ExperienceType;
  /** 关联的 Outcome（已采集）。 */
  outcome: OutcomeRecord;
  /** 决策时的上下文。 */
  context: ExperienceContext;
  /** 当前模型版本。 */
  modelVersion: number;

  // ── War 归因输入（来自 evaluateWarOutcome + war plan）──
  /** 战争目标房间。 */
  warTargetRoom?: string;
  /** 敌方玩家名。 */
  warOpponent?: string;
  /** 我方编队配置。 */
  warOurComposition?: { role: string; count: number; boosted: boolean }[];
  /** 敌方编队配置。 */
  warEnemyComposition?: { role: string; count: number; boosted: boolean }[];
  /** 我方损失数。 */
  warOurLosses?: number;
  /** 敌方损失数。 */
  warEnemyLosses?: number;
  /** 战争 CPU 消耗。 */
  warCpuCost?: number;
  /** 战争持续 tick 数。 */
  warDuration?: number;
  /** 战争止损原因。 */
  warAbortReason?: string;
  /** 编队规模。 */
  warSquadSize?: number;

  // ── Recovery 归因输入 ──
  /** Recovery 成功数。 */
  recoverySucceeded?: number;
  /** Recovery 失败数。 */
  recoveryFailed?: number;
  /** Recovery 终态数。 */
  recoveryTerminal?: number;
  /** 恢复动作类型列表。 */
  recoveryActionTypes?: string[];
  /** 平均恢复时间。 */
  recoveryAvgTime?: number;

  // ── Economic 归因输入 ──
  /** 决策前健康度等级。 */
  healthLevelBefore?: string;
  /** 决策后健康度等级。 */
  healthLevelAfter?: string;
  /** 决策前健康度分数。 */
  healthScoreBefore?: number;
  /** 决策后健康度分数。 */
  healthScoreAfter?: number;
  /** 瓶颈维度。 */
  bottleneckDimension?: string;

  // ── Logistics 归因输入 ──
  /** 物流积压数。 */
  logisticsBacklog?: number;
  /** 物流投递率。 */
  logisticsDeliveryRate?: number;
  /** hauler 缺口。 */
  haulerDeficit?: number;
  /** 物流健康度等级（前）。 */
  logisticsLevelBefore?: string;
  /** 物流健康度等级（后）。 */
  logisticsLevelAfter?: string;

  // ── Spawn 归因输入 ──
  /** 孵化队列长度。 */
  spawnQueueLength?: number;
  /** P0 孵化请求数。 */
  spawnP0Count?: number;
  /** 总人口。 */
  totalPopulation?: number;
  /** 孵化容量。 */
  spawnCapacity?: number;

  // ── Expansion 归因输入 ──
  /** 扩张目标房间。 */
  expansionTargetRoom?: string;
  /** 扩张阶段。 */
  expansionPhase?: string;
  /** 扩张持续时间。 */
  expansionDuration?: number;
  /** 最终殖民地状态。 */
  expansionFinalColonyState?: string;
  /** 达到的 RCL 等级。 */
  expansionRclAchieved?: number;

  // ── Defense 归因输入 ──
  /** 威胁等级（前）。 */
  threatLevelBefore?: string;
  /** 威胁等级（后）。 */
  threatLevelAfter?: string;
  /** 敌人在场数。 */
  hostilesInRoom?: number;
  /** 结构损毁数。 */
  structuresDestroyed?: number;
  /** Tower 数量。 */
  towerCount?: number;

  // ── 通用归因输入 ──
  /** CPU 档位。 */
  cpuTier?: string;
  /** 帝国姿态。 */
  posture?: string;
}

// ═══════════════════════════════════════════════════════════
// §2. Attribution Collection Functions (pure)
// ═══════════════════════════════════════════════════════════

/**
 * 采集 Attribution — 根据 Experience 类型分发到不同的归因策略。

 * 第一阶段只做 Direct + Correlation 归因。
 * 纯函数 — 不引用 Game/Memory。
 */
export function collectAttribution(input: AttributionInput): Attribution {
  switch (input.type) {
    case "war":
      return collectWarAttribution(input);
    case "recovery":
      return collectRecoveryAttribution(input);
    case "economic":
      return collectEconomicAttribution(input);
    case "logistics":
      return collectLogisticsAttribution(input);
    case "spawn":
      return collectSpawnAttribution(input);
    case "expansion":
      return collectExpansionAttribution(input);
    case "defense":
      return collectDefenseAttribution(input);
    default:
      return collectUnknownAttribution(input);
  }
}

// ═══════════════════════════════════════════════════════════
// §3. War Attribution (Direct method, high confidence)
// ═══════════════════════════════════════════════════════════

/**
 * War 归因 — Direct 方法，置信度高（0.8+）。

 * 归因规则：
 *   胜 + 损失 < 30% → forceComposition 有效
 *   胜 + 损失 > 50% → forceComposition 勉强
 *   负 + 敌方 boosted → intel 不足（未预判 boost）
 *   负 + 经济不支 → economicGuard 失败
 *   unknown → intel 过期
 */
function collectWarAttribution(input: AttributionInput): Attribution {
  const evidence: AttributionEvidence[] = [];
  const classification = input.outcome.classification;
  const ourLosses = input.warOurLosses ?? 0;
  const enemyLosses = input.warEnemyLosses ?? 0;
  const squadSize = input.warSquadSize ?? 1;
  const lossRatio = squadSize > 0 ? ourLosses / squadSize : 0;
  const enemyBoosted = input.warEnemyComposition?.some(e => e.boosted) ?? false;
  const ourBoosted = input.warOurComposition?.some(e => e.boosted) ?? false;
  const abortReason = input.warAbortReason;

  let primaryCause: AttributionFactor = "UNKNOWN";
  let method: AttributionMethod = "direct";
  let confidence = 0.5;

  // Evidence: loss ratio
  evidence.push({
    metric: "lossRatio",
    actual: Number(lossRatio.toFixed(3)),
    threshold: 0.3,
    suggestsFactor: lossRatio > 0.5 ? "COMBAT_OUTCOME" : "DECISION_QUALITY",
    strength: lossRatio > 0.5 ? 0.8 : 0.4,
  });

  // Evidence: enemy boost
  if (enemyBoosted) {
    evidence.push({
      metric: "enemyBoosted",
      actual: true,
      threshold: false,
      suggestsFactor: "INTEL_QUALITY",
      strength: 0.8,
    });
  }

  // Evidence: our boost
  if (!ourBoosted && classification === "FAILURE") {
    evidence.push({
      metric: "ourNotBoosted",
      actual: true,
      threshold: false,
      suggestsFactor: "RESOURCE_AVAILABILITY",
      strength: 0.6,
    });
  }

  // Evidence: abort reason
  if (abortReason) {
    evidence.push({
      metric: "warAbortReason",
      actual: abortReason,
      threshold: "none",
      suggestsFactor: abortReason.includes("economic") || abortReason.includes("budget")
        ? "ECONOMIC_GUARD"
        : "EXTERNAL_THREAT",
      strength: 0.7,
    });
  }

  // Evidence: duration
  if (input.warDuration !== undefined) {
    evidence.push({
      metric: "warDuration",
      actual: input.warDuration,
      threshold: 500,
      suggestsFactor: input.warDuration > 2000 ? "TIMING" : "EXECUTION_QUALITY",
      strength: 0.5,
    });
  }

  // Determine primary cause based on outcome + evidence
  if (abortReason) {
    if (abortReason.includes("economic") || abortReason.includes("budget")) {
      primaryCause = "ECONOMIC_GUARD";
      confidence = 0.8;
    } else {
      primaryCause = "EXTERNAL_THREAT";
      confidence = 0.7;
    }
  } else if (classification === "SUCCESS") {
    if (lossRatio < 0.3) {
      primaryCause = "DECISION_QUALITY";
      confidence = 0.9;
    } else {
      primaryCause = "COMBAT_OUTCOME";
      confidence = 0.7;
    }
  } else if (classification === "FAILURE") {
    if (enemyBoosted) {
      primaryCause = "INTEL_QUALITY";
      confidence = 0.8;
    } else if (lossRatio > 0.5) {
      primaryCause = "COMBAT_OUTCOME";
      confidence = 0.8;
    } else {
      primaryCause = "EXECUTION_QUALITY";
      confidence = 0.7;
    }
  } else if (classification === "ABORTED") {
    primaryCause = "ECONOMIC_GUARD";
    confidence = 0.7;
  } else {
    // UNKNOWN
    primaryCause = "INTEL_QUALITY";
    confidence = 0.5;
    method = "unknown";
  }

  const contributingFactors = evidence
    .map(e => e.suggestsFactor)
    .filter(f => f !== primaryCause);

  const externalFactors = abortReason
    ? (["EXTERNAL_THREAT"] as AttributionFactor[])
    : [];

  const hash = attributionHash(input.type, primaryCause, evidence, input.modelVersion);

  return {
    primaryCause,
    contributingFactors: deduplicateFactors(contributingFactors),
    externalFactors,
    systemAttribution: "war-planning",
    confidence,
    method,
    evidence,
    attributionHash: hash,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Recovery Attribution (Direct method, high confidence)
// ═══════════════════════════════════════════════════════════

/**
 * Recovery 归因 — Direct 方法，置信度高（0.7+）。

 * 归因规则：
 *   成功率高 → DECISION_QUALITY（恢复策略正确）
 *   成功率低 + 多次失败 → EXECUTION_QUALITY（执行不足）
 *   成功率低 + 时间长 → RESOURCE_AVAILABILITY（资源不足）
 */
function collectRecoveryAttribution(input: AttributionInput): Attribution {
  const evidence: AttributionEvidence[] = [];
  const succeeded = input.recoverySucceeded ?? 0;
  const failed = input.recoveryFailed ?? 0;
  const total = succeeded + failed;
  const successRate = total > 0 ? succeeded / total : 0;
  const avgTime = input.recoveryAvgTime ?? 0;

  let primaryCause: AttributionFactor = "UNKNOWN";
  let confidence = 0.5;

  // Evidence: success rate
  evidence.push({
    metric: "recoverySuccessRate",
    actual: Number(successRate.toFixed(3)),
    threshold: 0.8,
    suggestsFactor: successRate >= 0.8 ? "DECISION_QUALITY" : "EXECUTION_QUALITY",
    strength: 0.7,
  });

  // Evidence: failure count
  if (failed > 0) {
    evidence.push({
      metric: "recoveryFailedCount",
      actual: failed,
      threshold: 0,
      suggestsFactor: "EXECUTION_QUALITY",
      strength: Math.min(0.9, 0.3 + failed * 0.2),
    });
  }

  // Evidence: avg time
  if (avgTime > 0) {
    evidence.push({
      metric: "recoveryAvgTime",
      actual: avgTime,
      threshold: 200,
      suggestsFactor: avgTime > 200 ? "RESOURCE_AVAILABILITY" : "DECISION_QUALITY",
      strength: 0.5,
    });
  }

  // Evidence: health delta
  const healthDelta = (input.healthScoreAfter ?? 0) - (input.healthScoreBefore ?? 0);
  if (healthDelta !== 0) {
    evidence.push({
      metric: "healthScoreDelta",
      actual: Number(healthDelta.toFixed(3)),
      threshold: 0,
      suggestsFactor: healthDelta > 0 ? "DECISION_QUALITY" : "EXECUTION_QUALITY",
      strength: 0.6,
    });
  }

  // Determine primary cause
  if (successRate >= 0.8) {
    primaryCause = "DECISION_QUALITY";
    confidence = 0.8;
  } else if (successRate >= 0.4) {
    primaryCause = "EXECUTION_QUALITY";
    confidence = 0.7;
  } else if (avgTime > 200) {
    primaryCause = "RESOURCE_AVAILABILITY";
    confidence = 0.6;
  } else {
    primaryCause = "EXECUTION_QUALITY";
    confidence = 0.7;
  }

  const contributingFactors = evidence
    .map(e => e.suggestsFactor)
    .filter(f => f !== primaryCause);

  const hash = attributionHash(input.type, primaryCause, evidence, input.modelVersion);

  return {
    primaryCause,
    contributingFactors: deduplicateFactors(contributingFactors),
    externalFactors: [],
    systemAttribution: "recovery-execution",
    confidence,
    method: "direct",
    evidence,
    attributionHash: hash,
  };
}

// ═══════════════════════════════════════════════════════════
// §5. Economic Attribution (Expert method, low confidence)
// ═══════════════════════════════════════════════════════════

/**
 * Economic 归因 — Expert 方法，低置信度（0.3-0.5）。

 * 经济归因困难：多系统耦合，无法单独归因。
 * 使用 CONFIG 规则归因，标注低置信度。
 */
function collectEconomicAttribution(input: AttributionInput): Attribution {
  const evidence: AttributionEvidence[] = [];
  const healthDelta = (input.healthScoreAfter ?? 0) - (input.healthScoreBefore ?? 0);
  const bottleneck = input.bottleneckDimension ?? "unknown";

  let primaryCause: AttributionFactor = "UNKNOWN";
  let confidence = 0.3;

  // Evidence: health delta
  evidence.push({
    metric: "healthScoreDelta",
    actual: Number(healthDelta.toFixed(3)),
    threshold: 0,
    suggestsFactor: healthDelta > 0 ? "DECISION_QUALITY" : "UNKNOWN",
    strength: 0.4,
  });

  // Evidence: bottleneck
  if (bottleneck !== "unknown") {
    evidence.push({
      metric: "bottleneckDimension",
      actual: bottleneck,
      threshold: "none",
      suggestsFactor: mapBottleneckToFactor(bottleneck),
      strength: 0.5,
    });
  }

  // Evidence: CPU tier
  if (input.cpuTier) {
    evidence.push({
      metric: "cpuTier",
      actual: input.cpuTier,
      threshold: "healthy",
      suggestsFactor: input.cpuTier === "recovery" ? "RESOURCE_AVAILABILITY" : "UNKNOWN",
      strength: 0.3,
    });
  }

  // Determine primary cause using expert rules
  if (healthDelta > 0.1) {
    primaryCause = "DECISION_QUALITY";
    confidence = 0.4;
  } else if (healthDelta < -0.1) {
    primaryCause = mapBottleneckToFactor(bottleneck);
    confidence = 0.35;
  } else {
    primaryCause = "UNKNOWN";
    confidence = 0.3;
  }

  // Economic attribution is inherently low confidence
  confidence = Math.min(confidence, 0.5);

  const contributingFactors = evidence
    .map(e => e.suggestsFactor)
    .filter(f => f !== primaryCause);

  const hash = attributionHash(input.type, primaryCause, evidence, input.modelVersion);

  return {
    primaryCause,
    contributingFactors: deduplicateFactors(contributingFactors),
    externalFactors: [],
    systemAttribution: "empire-health",
    confidence,
    method: "expert",
    evidence,
    attributionHash: hash,
  };
}

// ═══════════════════════════════════════════════════════════
// §6. Logistics Attribution (Correlation method, medium confidence)
// ═══════════════════════════════════════════════════════════

/**
 * Logistics 归因 — Correlation 方法，中等置信度（0.5+）。
 */
function collectLogisticsAttribution(input: AttributionInput): Attribution {
  const evidence: AttributionEvidence[] = [];
  const backlog = input.logisticsBacklog ?? 0;
  const deliveryRate = input.logisticsDeliveryRate ?? 1;
  const haulerDeficit = input.haulerDeficit ?? 0;

  let primaryCause: AttributionFactor = "UNKNOWN";
  let confidence = 0.5;

  // Evidence: backlog
  evidence.push({
    metric: "logisticsBacklog",
    actual: backlog,
    threshold: 0,
    suggestsFactor: backlog > 5 ? "LOGISTICS_QUALITY" : "DECISION_QUALITY",
    strength: Math.min(0.8, 0.3 + backlog * 0.1),
  });

  // Evidence: delivery rate
  evidence.push({
    metric: "deliveryRate",
    actual: Number(deliveryRate.toFixed(3)),
    threshold: 0.9,
    suggestsFactor: deliveryRate < 0.9 ? "EXECUTION_QUALITY" : "DECISION_QUALITY",
    strength: deliveryRate < 0.9 ? 0.7 : 0.4,
  });

  // Evidence: hauler deficit
  if (haulerDeficit > 0) {
    evidence.push({
      metric: "haulerDeficit",
      actual: haulerDeficit,
      threshold: 0,
      suggestsFactor: "RESOURCE_AVAILABILITY",
      strength: Math.min(0.8, 0.3 + haulerDeficit * 0.1),
    });
  }

  // Determine primary cause
  if (haulerDeficit > 0) {
    primaryCause = "RESOURCE_AVAILABILITY";
    confidence = 0.6;
  } else if (backlog > 5) {
    primaryCause = "LOGISTICS_QUALITY";
    confidence = 0.6;
  } else if (deliveryRate < 0.9) {
    primaryCause = "EXECUTION_QUALITY";
    confidence = 0.5;
  } else {
    primaryCause = "DECISION_QUALITY";
    confidence = 0.5;
  }

  const contributingFactors = evidence
    .map(e => e.suggestsFactor)
    .filter(f => f !== primaryCause);

  const hash = attributionHash(input.type, primaryCause, evidence, input.modelVersion);

  return {
    primaryCause,
    contributingFactors: deduplicateFactors(contributingFactors),
    externalFactors: [],
    systemAttribution: "logistics-planner",
    confidence,
    method: "correlation",
    evidence,
    attributionHash: hash,
  };
}

// ═══════════════════════════════════════════════════════════
// §7. Spawn Attribution (Direct method, high confidence)
// ═══════════════════════════════════════════════════════════

/**
 * Spawn 归因 — Direct 方法，置信度高（0.7+）。
 */
function collectSpawnAttribution(input: AttributionInput): Attribution {
  const evidence: AttributionEvidence[] = [];
  const queueLength = input.spawnQueueLength ?? 0;
  const p0Count = input.spawnP0Count ?? 0;
  const capacity = input.spawnCapacity ?? 0;
  const population = input.totalPopulation ?? 0;

  let primaryCause: AttributionFactor = "UNKNOWN";
  let confidence = 0.5;

  // Evidence: queue length
  evidence.push({
    metric: "spawnQueueLength",
    actual: queueLength,
    threshold: 0,
    suggestsFactor: queueLength > 0 ? "RESOURCE_AVAILABILITY" : "DECISION_QUALITY",
    strength: Math.min(0.8, 0.3 + queueLength * 0.05),
  });

  // Evidence: P0 count
  if (p0Count > 0) {
    evidence.push({
      metric: "p0Count",
      actual: p0Count,
      threshold: 0,
      suggestsFactor: "RESOURCE_AVAILABILITY",
      strength: 0.8,
    });
  }

  // Evidence: capacity utilization
  if (capacity > 0) {
    const utilization = population / capacity;
    evidence.push({
      metric: "capacityUtilization",
      actual: Number(utilization.toFixed(3)),
      threshold: 0.8,
      suggestsFactor: utilization < 0.8 ? "RESOURCE_AVAILABILITY" : "DECISION_QUALITY",
      strength: 0.5,
    });
  }

  // Determine primary cause
  if (p0Count > 0) {
    primaryCause = "RESOURCE_AVAILABILITY";
    confidence = 0.8;
  } else if (queueLength > 5) {
    primaryCause = "RESOURCE_AVAILABILITY";
    confidence = 0.7;
  } else if (queueLength === 0) {
    primaryCause = "DECISION_QUALITY";
    confidence = 0.8;
  } else {
    primaryCause = "EXECUTION_QUALITY";
    confidence = 0.7;
  }

  const contributingFactors = evidence
    .map(e => e.suggestsFactor)
    .filter(f => f !== primaryCause);

  const hash = attributionHash(input.type, primaryCause, evidence, input.modelVersion);

  return {
    primaryCause,
    contributingFactors: deduplicateFactors(contributingFactors),
    externalFactors: [],
    systemAttribution: "spawn-manager",
    confidence,
    method: "direct",
    evidence,
    attributionHash: hash,
  };
}

// ═══════════════════════════════════════════════════════════
// §8. Expansion Attribution (Direct method, medium confidence)
// ═══════════════════════════════════════════════════════════

/**
 * Expansion 归因 — Direct 方法，中等置信度（0.6+）。
 */
function collectExpansionAttribution(input: AttributionInput): Attribution {
  const evidence: AttributionEvidence[] = [];
  const classification = input.outcome.classification;
  const duration = input.expansionDuration ?? 0;
  const rclAchieved = input.expansionRclAchieved ?? 0;
  const finalState = input.expansionFinalColonyState ?? "unknown";

  let primaryCause: AttributionFactor = "UNKNOWN";
  let confidence = 0.5;

  // Evidence: duration
  evidence.push({
    metric: "expansionDuration",
    actual: duration,
    threshold: 2000,
    suggestsFactor: duration > 5000 ? "TIMING" : "DECISION_QUALITY",
    strength: duration > 5000 ? 0.7 : 0.4,
  });

  // Evidence: RCL achieved
  if (rclAchieved > 0) {
    evidence.push({
      metric: "rclAchieved",
      actual: rclAchieved,
      threshold: 3,
      suggestsFactor: rclAchieved >= 3 ? "DECISION_QUALITY" : "TIMING",
      strength: 0.6,
    });
  }

  // Evidence: final colony state
  evidence.push({
    metric: "finalColonyState",
    actual: finalState,
    threshold: "normal",
    suggestsFactor: finalState === "normal" ? "DECISION_QUALITY" : "TIMING",
    strength: finalState === "normal" ? 0.6 : 0.7,
  });

  // Evidence: threat level after
  if (input.threatLevelAfter) {
    evidence.push({
      metric: "threatLevelAfter",
      actual: input.threatLevelAfter,
      threshold: "LOW",
      suggestsFactor: input.threatLevelAfter === "HIGH" || input.threatLevelAfter === "CRITICAL"
        ? "EXTERNAL_THREAT"
        : "DECISION_QUALITY",
      strength: 0.5,
    });
  }

  // Determine primary cause
  if (classification === "SUCCESS") {
    primaryCause = "DECISION_QUALITY";
    confidence = 0.7;
  } else if (classification === "FAILURE") {
    if (input.threatLevelAfter === "HIGH" || input.threatLevelAfter === "CRITICAL") {
      primaryCause = "EXTERNAL_THREAT";
      confidence = 0.7;
    } else if (duration > 5000) {
      primaryCause = "TIMING";
      confidence = 0.6;
    } else {
      primaryCause = "EXECUTION_QUALITY";
      confidence = 0.6;
    }
  } else if (classification === "EXPIRED") {
    primaryCause = "TIMING";
    confidence = 0.6;
  } else {
    primaryCause = "UNKNOWN";
    confidence = 0.5;
  }

  const contributingFactors = evidence
    .map(e => e.suggestsFactor)
    .filter(f => f !== primaryCause);

  const hash = attributionHash(input.type, primaryCause, evidence, input.modelVersion);

  return {
    primaryCause,
    contributingFactors: deduplicateFactors(contributingFactors),
    externalFactors: [],
    systemAttribution: "expansion-manager",
    confidence,
    method: "direct",
    evidence,
    attributionHash: hash,
  };
}

// ═══════════════════════════════════════════════════════════
// §9. Defense Attribution (Correlation method, medium confidence)
// ═══════════════════════════════════════════════════════════

/**
 * Defense 归因 — Correlation 方法，中等置信度（0.5+）。
 */
function collectDefenseAttribution(input: AttributionInput): Attribution {
  const evidence: AttributionEvidence[] = [];
  const classification = input.outcome.classification;
  const structuresDestroyed = input.structuresDestroyed ?? 0;
  const towerCount = input.towerCount ?? 0;
  const hostiles = input.hostilesInRoom ?? 0;

  let primaryCause: AttributionFactor = "UNKNOWN";
  let confidence = 0.5;

  // Evidence: structures destroyed
  evidence.push({
    metric: "structuresDestroyed",
    actual: structuresDestroyed,
    threshold: 0,
    suggestsFactor: structuresDestroyed > 0 ? "INFRASTRUCTURE" : "DECISION_QUALITY",
    strength: structuresDestroyed > 0 ? 0.8 : 0.4,
  });

  // Evidence: tower count
  if (towerCount > 0) {
    evidence.push({
      metric: "towerCount",
      actual: towerCount,
      threshold: 1,
      suggestsFactor: towerCount >= 2 ? "INFRASTRUCTURE" : "RESOURCE_AVAILABILITY",
      strength: 0.5,
    });
  }

  // Evidence: hostiles
  evidence.push({
    metric: "hostilesInRoom",
    actual: hostiles,
    threshold: 0,
    suggestsFactor: hostiles > 3 ? "EXTERNAL_THREAT" : "DECISION_QUALITY",
    strength: Math.min(0.8, 0.3 + hostiles * 0.1),
  });

  // Determine primary cause
  if (classification === "SUCCESS" && structuresDestroyed === 0) {
    primaryCause = "DECISION_QUALITY";
    confidence = 0.6;
  } else if (structuresDestroyed > 0) {
    primaryCause = "INFRASTRUCTURE";
    confidence = 0.6;
  } else if (hostiles > 3) {
    primaryCause = "EXTERNAL_THREAT";
    confidence = 0.5;
  } else if (towerCount < 2) {
    primaryCause = "RESOURCE_AVAILABILITY";
    confidence = 0.5;
  } else {
    primaryCause = "UNKNOWN";
    confidence = 0.4;
  }

  const contributingFactors = evidence
    .map(e => e.suggestsFactor)
    .filter(f => f !== primaryCause);

  const hash = attributionHash(input.type, primaryCause, evidence, input.modelVersion);

  return {
    primaryCause,
    contributingFactors: deduplicateFactors(contributingFactors),
    externalFactors: ["EXTERNAL_THREAT"] as AttributionFactor[],
    systemAttribution: "defense-planner",
    confidence,
    method: "correlation",
    evidence,
    attributionHash: hash,
  };
}

// ═══════════════════════════════════════════════════════════
// §10. Unknown Attribution (fallback)
// ═══════════════════════════════════════════════════════════

function collectUnknownAttribution(input: AttributionInput): Attribution {
  const evidence: AttributionEvidence[] = [];
  const hash = attributionHash(input.type, "UNKNOWN", evidence, input.modelVersion);

  return {
    primaryCause: "UNKNOWN",
    contributingFactors: [],
    externalFactors: [],
    systemAttribution: "unknown",
    confidence: 0.1,
    method: "unknown",
    evidence,
    attributionHash: hash,
  };
}

// ═══════════════════════════════════════════════════════════
// §11. Attribution Confidence Calculation
// ═══════════════════════════════════════════════════════════

/**
 * 计算归因置信度 — 基于样本数 + 方差 + 测量延迟。

 * 样本越多 → 置信度越高
 * 方差越低 → 置信度越高
 * 延迟越长 → 置信度越低（中间发生太多事）
 */
export function computeAttributionConfidence(
  samples: number,
  variance: number,
  measurementDelay: number,
): number {
  const sampleFactor = Math.min(1, samples / 10);
  const varianceFactor = 1 - Math.min(1, variance / 100);
  const delayFactor = Math.max(0.3, 1 - measurementDelay / 5000);

  return Number((sampleFactor * varianceFactor * delayFactor).toFixed(3));
}

// ═══════════════════════════════════════════════════════════
// §12. Attribution Hash — 确定性验证
// ═══════════════════════════════════════════════════════════

/**
 * 为 Attribution 生成稳定的 Hash。

 * 算法：stableStringify(type + primaryCause + evidence + modelVersion) → FNV-1a 32-bit → hex。

 * 确定性保证：
 *   - 不使用 Math.random / Date.now
 *   - JSON.stringify 对相同对象结构产生相同字符串
 *   - evidence 数组顺序固定（按构建顺序）
 */
export function attributionHash(
  type: ExperienceType,
  primaryCause: AttributionFactor,
  evidence: readonly AttributionEvidence[],
  modelVersion: number,
): string {
  const payload = stableStringify({
    type,
    primaryCause,
    evidence: evidence.map(e => ({
      metric: e.metric,
      actual: e.actual,
      threshold: e.threshold,
      suggestsFactor: e.suggestsFactor,
      strength: Number(e.strength.toFixed(3)),
    })),
    modelVersion,
  });
  return fnv1a32Hex(payload);
}

// ═══════════════════════════════════════════════════════════
// §13. Attribution Verification
// ═══════════════════════════════════════════════════════════

/**
 * 验证 Attribution 确定性：同一输入连续 N 次，检查 hash 一致。
 */
export function verifyAttributionDeterminism(
  input: AttributionInput,
  iterations = 1000,
): { deterministic: boolean; hashes: string[]; firstDivergenceAt?: number } {
  const hashes: string[] = [];
  let firstDivergenceAt: number | undefined;

  for (let i = 0; i < iterations; i++) {
    const attr = collectAttribution(input);
    hashes.push(attr.attributionHash);
    if (i > 0 && hashes[i] !== hashes[0] && firstDivergenceAt === undefined) {
      firstDivergenceAt = i;
    }
  }

  return {
    deterministic: firstDivergenceAt === undefined,
    hashes,
    firstDivergenceAt,
  };
}

// ═══════════════════════════════════════════════════════════
// §14. Helper Functions
// ═══════════════════════════════════════════════════════════

/**
 * 将瓶颈维度映射到 AttributionFactor。
 */
function mapBottleneckToFactor(bottleneck: string): AttributionFactor {
  switch (bottleneck) {
    case "spawn":
    case "population":
      return "RESOURCE_AVAILABILITY";
    case "logistics":
    case "hauler":
      return "LOGISTICS_QUALITY";
    case "economy":
    case "energy":
      return "ECONOMIC_GUARD";
    case "military":
    case "defense":
      return "EXTERNAL_THREAT";
    case "construction":
    case "layout":
      return "INFRASTRUCTURE";
    case "intel":
      return "INTEL_QUALITY";
    default:
      return "UNKNOWN";
  }
}

/**
 * 去重 AttributionFactor 数组，保持顺序。
 */
function deduplicateFactors(factors: AttributionFactor[]): AttributionFactor[] {
  const seen = new Set<AttributionFactor>();
  const result: AttributionFactor[] = [];
  for (const f of factors) {
    if (!seen.has(f)) {
      seen.add(f);
      result.push(f);
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════
// §15. 内部工具函数（与 decision-trace.ts 保持相同算法，确保确定性一致）
// ═══════════════════════════════════════════════════════════

/**
 * 稳定 JSON 序列化：按 key 排序，确保相同对象产生相同字符串。
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(k => {
    const v = (obj as Record<string, unknown>)[k];
    return JSON.stringify(k) + ":" + stableStringify(v);
  });
  return "{" + pairs.join(",") + "}";
}

/**
 * FNV-1a 32-bit Hash → 8 字符 hex。
 */
function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}