/** A6.1 Outcome Model — Domain 层纯函数与类型定义。 */

// ═══════════════════════════════════════════════════════════
// §1. Outcome Types (re-exported from experience.ts for convenience)
// ═══════════════════════════════════════════════════════════

export type {
  OutcomeRecord,
  OutcomeClassification,
  StateDelta,
} from "./experience";

import type { OutcomeRecord, OutcomeClassification, StateDelta } from "./experience";
import type { ExperienceType } from "./experience";

// ═══════════════════════════════════════════════════════════
// §2. Outcome Collection Input
// ═══════════════════════════════════════════════════════════

/**
 * Outcome 采集输入 — 从已有系统收集的运行时状态。

 * 由 system 层薄壳采集并注入，domain 纯函数不直接读 Game/Memory。
 */
export interface OutcomeCollectionInput {
  /** 决策 ID。 */
  decisionId: string;
  /** 决策发生 tick。 */
  decisionTick: number;
  /** 当前 tick。 */
  currentTick: number;
  /** Experience 类型（决定从哪个系统采集）。 */
  type: ExperienceType;
  /** 决策前状态 hash。 */
  stateBeforeHash: string;
  /** 当前状态 hash。 */
  stateAfterHash: string;

  // ── 从已有系统采集的状态 ──

  // War 相关（evaluateWarOutcome 产出）
  /** 战争结果（来自 evaluateWarOutcome）。 */
  warOutcome?: "success" | "failure" | "unknown";
  /** 战争已孵化数。 */
  warSpawned?: number;
  /** 战争止损原因。 */
  warAbortReason?: string;

  // Empire Health 相关
  /** 决策前健康度等级。 */
  healthLevelBefore?: string;
  /** 决策后健康度等级。 */
  healthLevelAfter?: string;
  /** 决策前健康度分数。 */
  healthScoreBefore?: number;
  /** 决策后健康度分数。 */
  healthScoreAfter?: number;

  // Recovery 相关
  /** Recovery 成功数。 */
  recoverySucceeded?: number;
  /** Recovery 失败数。 */
  recoveryFailed?: number;
  /** Recovery 终态数。 */
  recoveryTerminal?: number;
  /** 平均恢复时间。 */
  recoveryAvgTime?: number;

  // Logistics 相关
  /** 物流健康度等级。 */
  logisticsLevelBefore?: string;
  /** 物流健康度等级（后）。 */
  logisticsLevelAfter?: string;
  /** 物流积压数。 */
  logisticsBacklog?: number;
  /** 物流投递率。 */
  logisticsDeliveryRate?: number;

  // Spawn 相关
  /** 孵化队列长度。 */
  spawnQueueLength?: number;
  /** P0 孵化请求数。 */
  spawnP0Count?: number;
  /** 总人口。 */
  totalPopulation?: number;

  // Expansion 相关
  /** 扩张结果（来自 ExpansionOutcome 事件）。 */
  expansionOutcome?: number; // phase + outcome 编码
  /** 扩张持续时间。 */
  expansionDuration?: number;

  // 威胁相关
  /** 威胁等级变化。 */
  threatLevelBefore?: string;
  /** 威胁等级变化（后）。 */
  threatLevelAfter?: string;
  /** 敌人在场数。 */
  hostilesInRoom?: number;

  // 事件相关
  /** 关联事件 tick 范围内的事件数。 */
  eventCount?: number;
  /** Creep 死亡数。 */
  creepDeaths?: number;
  /** 结构损毁数。 */
  structuresDestroyed?: number;
}

// ═══════════════════════════════════════════════════════════
// §3. Outcome Collection Functions (pure)
// ═══════════════════════════════════════════════════════════

/**
 * 从已有系统采集 Outcome。

 * 根据 Experience 类型分发到不同的采集函数。
 * 只消费已有系统产出，不重新评估。

 * 纯函数 — 不引用 Game/Memory。
 */
export function collectOutcome(
  input: OutcomeCollectionInput,
): OutcomeRecord | undefined {
  switch (input.type) {
    case "war":
      return collectWarOutcome(input);
    case "recovery":
      return collectRecoveryOutcome(input);
    case "economic":
      return collectEconomicOutcome(input);
    case "logistics":
      return collectLogisticsOutcome(input);
    case "spawn":
      return collectSpawnOutcome(input);
    case "expansion":
      return collectExpansionOutcome(input);
    case "defense":
      return collectDefenseOutcome(input);
    default:
      return undefined;
  }
}

/**
 * War Outcome — 消费 evaluateWarOutcome。

 * 归因基础：warOutcome (success/failure/unknown) + warSpawned + warAbortReason
 */
function collectWarOutcome(input: OutcomeCollectionInput): OutcomeRecord | undefined {
  if (input.warOutcome === undefined) return undefined;

  const classification = mapWarOutcomeToClassification(
    input.warOutcome,
    input.warAbortReason,
  );

  // 量化值：success=1, failure=-1, unknown=0
  const value = input.warOutcome === "success" ? 1 : input.warOutcome === "failure" ? -1 : 0;

  return {
    decisionId: input.decisionId,
    decisionTick: input.decisionTick,
    measurementTick: input.currentTick,
    delay: input.currentTick - input.decisionTick,
    classification,
    metric: "warOutcome",
    value,
    source: "evaluateWarOutcome",
    stateAfterHash: input.stateAfterHash,
    stateDelta: {
      threatDelta: input.hostilesInRoom,
    },
  };
}

/**
 * Recovery Outcome — 消费 recoveryStats。
 */
function collectRecoveryOutcome(input: OutcomeCollectionInput): OutcomeRecord | undefined {
  if (input.recoverySucceeded === undefined && input.recoveryFailed === undefined) {
    return undefined;
  }

  const succeeded = input.recoverySucceeded ?? 0;
  const failed = input.recoveryFailed ?? 0;
  const total = succeeded + failed;

  if (total === 0) return undefined;

  const successRate = succeeded / total;
  const classification: OutcomeClassification =
    successRate >= 0.8 ? "SUCCESS"
    : successRate >= 0.4 ? "PARTIAL_SUCCESS"
    : successRate > 0 ? "FAILURE"
    : "UNKNOWN";

  return {
    decisionId: input.decisionId,
    decisionTick: input.decisionTick,
    measurementTick: input.currentTick,
    delay: input.currentTick - input.decisionTick,
    classification,
    metric: "recoverySuccessRate",
    value: Number(successRate.toFixed(3)),
    source: "recoveryStats",
    stateAfterHash: input.stateAfterHash,
    stateDelta: {
      recoveryDelta: succeeded - failed,
      healthDelta: (input.healthScoreAfter ?? 0) - (input.healthScoreBefore ?? 0),
    },
  };
}

/**
 * Economic Outcome — 消费 empireHealth delta。

 * 经济归因困难（多系统耦合），低置信度。
 */
function collectEconomicOutcome(input: OutcomeCollectionInput): OutcomeRecord | undefined {
  if (input.healthScoreBefore === undefined || input.healthScoreAfter === undefined) {
    return undefined;
  }

  const delta = input.healthScoreAfter - input.healthScoreBefore;
  const classification: OutcomeClassification =
    delta > 0.05 ? "SUCCESS"
    : delta > 0 ? "PARTIAL_SUCCESS"
    : delta < -0.05 ? "FAILURE"
    : "UNKNOWN";

  return {
    decisionId: input.decisionId,
    decisionTick: input.decisionTick,
    measurementTick: input.currentTick,
    delay: input.currentTick - input.decisionTick,
    classification,
    metric: "healthScoreDelta",
    value: Number(delta.toFixed(3)),
    source: "empireHealth",
    stateAfterHash: input.stateAfterHash,
    stateDelta: {
      healthDelta: delta,
    },
  };
}

/**
 * Logistics Outcome — 消费 logisticsHealth。
 */
function collectLogisticsOutcome(input: OutcomeCollectionInput): OutcomeRecord | undefined {
  if (input.logisticsLevelBefore === undefined || input.logisticsLevelAfter === undefined) {
    return undefined;
  }

  const levelOrder: Record<string, number> = {
    healthy: 3, stable: 2, degraded: 1, critical: 0,
  };
  const before = levelOrder[input.logisticsLevelBefore] ?? 2;
  const after = levelOrder[input.logisticsLevelAfter] ?? 2;
  const delta = after - before;

  const classification: OutcomeClassification =
    delta > 0 ? "SUCCESS"
    : delta === 0 ? "PARTIAL_SUCCESS"
    : "FAILURE";

  return {
    decisionId: input.decisionId,
    decisionTick: input.decisionTick,
    measurementTick: input.currentTick,
    delay: input.currentTick - input.decisionTick,
    classification,
    metric: "logisticsLevelDelta",
    value: delta,
    source: "logisticsHealth",
    stateAfterHash: input.stateAfterHash,
    stateDelta: {
      energyDelta: undefined, // 由调用方填充
    },
  };
}

/**
 * Spawn Outcome — 消费 spawn queue stats + 人口变化。
 */
function collectSpawnOutcome(input: OutcomeCollectionInput): OutcomeRecord | undefined {
  if (input.spawnQueueLength === undefined) {
    return undefined;
  }

  // 如果队列从有到无 = 成功清空
  // 如果队列从有到更多 = 失败/恶化
  // 如果 P0 从 >0 到 0 = 成功恢复
  const p0Cleared = (input.spawnP0Count ?? 0) === 0;
  const queueDrained = input.spawnQueueLength === 0;

  const classification: OutcomeClassification =
    queueDrained && p0Cleared ? "SUCCESS"
    : queueDrained ? "PARTIAL_SUCCESS"
    : input.spawnP0Count !== undefined && input.spawnP0Count > 0 ? "FAILURE"
    : "UNKNOWN";

  return {
    decisionId: input.decisionId,
    decisionTick: input.decisionTick,
    measurementTick: input.currentTick,
    delay: input.currentTick - input.decisionTick,
    classification,
    metric: "spawnQueueLength",
    value: input.spawnQueueLength,
    source: "spawnQueueStats",
    stateAfterHash: input.stateAfterHash,
    stateDelta: {
      populationDelta: input.totalPopulation,
    },
  };
}

/**
 * Expansion Outcome — 消费 ExpansionOutcome 事件。
 */
function collectExpansionOutcome(input: OutcomeCollectionInput): OutcomeRecord | undefined {
  if (input.expansionOutcome === undefined) {
    return undefined;
  }

  // ExpansionOutcome 事件 d = [phase, outcome, duration]
  // outcome: 0 = success, 1 = failure, 2 = timeout, other = unknown
  const outcomeCode = input.expansionOutcome % 10; // 简化：取个位
  const classification: OutcomeClassification =
    outcomeCode === 0 ? "SUCCESS"
    : outcomeCode === 1 ? "FAILURE"
    : outcomeCode === 2 ? "EXPIRED"
    : "UNKNOWN";

  return {
    decisionId: input.decisionId,
    decisionTick: input.decisionTick,
    measurementTick: input.currentTick,
    delay: input.currentTick - input.decisionTick,
    classification,
    metric: "expansionOutcome",
    value: input.expansionOutcome,
    source: "expansionManager",
    stateAfterHash: input.stateAfterHash,
    stateDelta: {},
  };
}

/**
 * Defense Outcome — 消费 threatAssessments + 结构损毁事件。
 */
function collectDefenseOutcome(input: OutcomeCollectionInput): OutcomeRecord | undefined {
  if (input.threatLevelBefore === undefined && input.threatLevelAfter === undefined) {
    return undefined;
  }

  const threatOrder: Record<string, number> = {
    NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
  };
  const before = threatOrder[input.threatLevelBefore ?? "NONE"] ?? 0;
  const after = threatOrder[input.threatLevelAfter ?? "NONE"] ?? 0;
  const delta = after - before;

  // 威胁降低 = 防御成功
  // 结构被毁 = 防御失败（即使威胁降低）
  const structuresDestroyed = input.structuresDestroyed ?? 0;
  const classification: OutcomeClassification =
    structuresDestroyed > 0 ? "PARTIAL_SUCCESS"
    : delta < 0 ? "SUCCESS"
    : delta === 0 ? "PARTIAL_SUCCESS"
    : "FAILURE";

  return {
    decisionId: input.decisionId,
    decisionTick: input.decisionTick,
    measurementTick: input.currentTick,
    delay: input.currentTick - input.decisionTick,
    classification,
    metric: "threatLevelDelta",
    value: delta,
    source: "threatAssessment",
    stateAfterHash: input.stateAfterHash,
    stateDelta: {
      threatDelta: input.hostilesInRoom,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Helper Functions
// ═══════════════════════════════════════════════════════════

/**
 * 将 WarOutcome (success/failure/unknown) + abortReason 映射到 OutcomeClassification。

 * 区分正常结束和止损中止。
 */
function mapWarOutcomeToClassification(
  outcome: "success" | "failure" | "unknown",
  abortReason: string | undefined,
): OutcomeClassification {
  // 有止损原因 → ABORTED
  if (abortReason !== undefined && abortReason !== "") {
    if (outcome === "success") return "SUCCESS";
    if (outcome === "unknown") return "ABORTED";
    return "FAILURE";
  }

  switch (outcome) {
    case "success": return "SUCCESS";
    case "failure": return "FAILURE";
    case "unknown": return "UNKNOWN";
  }
}

/**
 * 计算结果置信度。

 * 基于测量延迟和结果来源可靠性。
 * 延迟越长 → 置信度越低（中间发生太多事）。
 */
export function computeOutcomeConfidence(
  delay: number,
  maxDelay: number,
  source: string,
): number {
  // 延迟因子：延迟越长置信越低
  const delayFactor = Math.max(0.3, 1 - delay / Math.max(1, maxDelay));

  // 来源可靠性
  const sourceReliability: Record<string, number> = {
    evaluateWarOutcome: 0.9,    // 战后核验，高可靠
    recoveryStats: 0.8,         // 恢复统计，高可靠
    empireHealth: 0.7,         // 健康度变化，中等
    logisticsHealth: 0.7,      // 物流健康度，中等
    spawnQueueStats: 0.8,       // 孵化队列，高可靠
    expansionManager: 0.6,     // 扩张结果，中等
    threatAssessment: 0.6,     // 威胁评估，中等
  };
  const reliability = sourceReliability[source] ?? 0.5;

  return Number((delayFactor * reliability).toFixed(3));
}
