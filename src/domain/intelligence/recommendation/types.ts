/** A6.6 Recommendation Types — 建议层基础类型定义。 */

// ═══════════════════════════════════════════════════════════
// §1. Recommendation Category — 8 类建议目录
// ═══════════════════════════════════════════════════════════

/**
 * 建议分类 — 严格匹配 A6_6_RECOMMENDATION_CATALOG.md 定义的 8 类。

 * 禁止新增未在 catalog 中定义的类型。
 */
export type RecommendationCategory =
  | "economic"
  | "expansion"
  | "defense"
  | "military"
  | "logistics"
  | "spawn"
  | "recovery"
  | "posture";

/**
 * 紧急度 — 5 级，用于 Lexicographic ranking 第一排序维度。

 * 禁止数值化（不使用 score）。
 */
export type RecommendationUrgency =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "informational";

/**
 * 紧急度排序权重（用于确定性排序比较器，非 "score"）。
 * critical=0 < informational=4 — 值越小优先级越高。
 */
export const URGENCY_ORDER: Readonly<Record<RecommendationUrgency, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
} as const;

// ═══════════════════════════════════════════════════════════
// §2. Evidence Types
// ═══════════════════════════════════════════════════════════

/**
 * 证据来源阶段 — 区分证据来自 A6 链条的哪一层。

 * 不要把不同来源的证据混成一条。
 */
export type EvidenceStage =
  | "OBSERVED"           // A6.1 Experience / Outcome
  | "ATTRIBUTED"         // A6.1 Attribution
  | "INFERRED"           // A6.2 Evaluation Finding
  | "PREDICTED"          // A6.3 Prediction
  | "CALIBRATED"         // A6.4 Calibration / ResolutionResult
  | "RELIABILITY_ASSESSED"; // A6.5 IntelligenceState / ModelReliabilityAssessment

/**
 * EvidenceItem — 单条可追溯证据。

 * 每条证据必须能追溯到 A6.1–A6.5 的具体输出。
 * 禁止无来源的证据。
 */
export interface EvidenceItem {
  /** 证据 ID（确定性：EVI-{stage}-{seq}）。 */
  readonly evidenceId: string;
  /** 来源阶段。 */
  readonly stage: EvidenceStage;
  /** 来源系统名（如 "a61-experience", "a62-evaluation", "a63-prediction"）。 */
  readonly source: string;
  /** 来源数据 ID（如 experienceId, predictionId, resolutionHash, stateHash）。 */
  readonly sourceId: string;
  /** 证据描述。 */
  readonly description: string;
  /** 证据置信度（0-1，来源于上游数据的 confidence）。 */
  readonly confidence: number;
  /** 证据数据摘要（关键值，非完整对象引用）。 */
  readonly data: Readonly<Record<string, number | string | boolean>>;
  /** 采集 tick。 */
  readonly collectedAt: number;
}

/**
 * EvidenceTrace — 完整证据链。

 * 追溯链：
 *   Recommendation → EvidenceItem[] → Prediction/Evaluation/Calibration/Reliability
 *     → Experience → Outcome → Attribution
 */
export interface EvidenceTrace {
  /** 所有证据项。 */
  readonly items: readonly EvidenceItem[];
  /** 证据链是否完整（每个必需阶段都有证据）。 */
  readonly complete: boolean;
  /** 缺失阶段列表。 */
  readonly missingStages: readonly EvidenceStage[];
  /** 证据链最低置信度。 */
  readonly minConfidence: number;
}

// ═══════════════════════════════════════════════════════════
// §3. NO_RECOMMENDATION
// ═══════════════════════════════════════════════════════════

/**
 * 不推荐原因枚举。

 * NO_RECOMMENDATION 是正常且重要的 Intelligence Output，不是异常。
 */
export type NoRecommendationReason =
  | "INSUFFICIENT_EVIDENCE"
  | "LOW_CONFIDENCE"
  | "REGIME_MISMATCH"
  | "UNCALIBRATED_MODEL"
  | "EXPIRED_EVIDENCE"
  | "CONFLICT_UNRESOLVED"
  | "DATA_GAP"
  | "NO_ACTIONABLE_SIGNAL";

/**
 * NO_RECOMMENDATION 哨兵值。
 */
export const NO_RECOMMENDATION = "NO_RECOMMENDATION" as const;

/**
 * NoRecommendation 结果 — 包含原因和上下文。
 */
export interface NoRecommendationResult {
  readonly type: typeof NO_RECOMMENDATION;
  readonly reason: NoRecommendationReason;
  readonly description: string;
  readonly category: RecommendationCategory | "general";
  readonly evaluatedAt: number;
  /** 缺失的证据阶段。 */
  readonly missingStages: readonly EvidenceStage[];
}

// ═══════════════════════════════════════════════════════════
// §4. Recommendation Validity (TTL)
// ═══════════════════════════════════════════════════════════

/**
 * 建议有效期 — TTL 机制。

 * REC-013：每条 Recommendation 必须有 validityWindow。
 */
export interface RecommendationValidity {
  /** 创建 tick。 */
  readonly createdTick: number;
  /** 过期 tick（createdTick + ttl）。 */
  readonly expiresTick: number;
  /** TTL（tick 数）。 */
  readonly ttl: number;
}

/**
 * 各 Category 的默认 TTL（tick）。
 * 来源：A6_6_LIFECYCLE.md §二.2
 */
export const DEFAULT_TTL: Readonly<Record<RecommendationCategory, number>> = {
  economic: 1000,
  expansion: 2000,
  defense: 500,
  military: 1000,
  logistics: 500,
  spawn: 300,
  recovery: 500,
  posture: 2000,
} as const;

// ═══════════════════════════════════════════════════════════
// §5. Recommendation Lifecycle
// ═══════════════════════════════════════════════════════════

/**
 * 建议生命周期状态 — 6 态状态机。

 * 来源：A6_6_LIFECYCLE.md §一

 *     Created ──→ Valid ──→ Expired
 *                  │           ↑
 *                  ├──→ Superseded
 *                  │
 *                  ├──→ Rejected
 *                  │
 *                  └──→ Accepted
 */
export type RecommendationLifecycle =
  | "created"
  | "valid"
  | "expired"
  | "superseded"
  | "rejected"
  | "accepted";

// ═══════════════════════════════════════════════════════════
// §6. Recommendation Conflict
// ═══════════════════════════════════════════════════════════

/**
 * 冲突类型。
 */
export type RecommendationConflictType =
  | "same_target"          // 同一目标冲突
  | "resource_competition" // 不同目标资源竞争
  | "strategic_contradiction"; // 战略矛盾

/**
 * 冲突严重度 — 3 级，用于排序。
 */
export type ConflictSeverity = "high" | "medium" | "low";

/**
 * RecommendationConflict — 两个或多个建议之间的冲突。

 * A6.6 只检测和暴露冲突，不解决冲突。
 * 禁止 resolveConflict / selectHighest。
 */
export interface RecommendationConflict {
  /** 冲突 ID（确定性：CF-{type}-{hash前8位}）。 */
  readonly conflictId: string;
  /** 冲突类型。 */
  readonly type: RecommendationConflictType;
  /** 参与冲突的 Recommendation ID 列表。 */
  readonly participantIds: readonly string[];
  /** 冲突描述。 */
  readonly description: string;
  /** 严重度。 */
  readonly severity: ConflictSeverity;
  /** 检测 tick。 */
  readonly detectedAt: number;
  /** 确定性 hash。 */
  readonly conflictHash: string;
}

// ═══════════════════════════════════════════════════════════
// §7. RecommendationCandidate — A6.6 完整建议
// ═══════════════════════════════════════════════════════════

/**
 * A6.6 RecommendationCandidate — 完整的建议候选。

 * Shadow-Only:
 *   - shadowOnly: true (literal type)
 *   - autoApply: false (literal type)
 *   - 不被任何执行系统读取

 * REC-009: 禁止 recommendationScore 字段。
 * REC-010: 每条必须有可追溯 evidence。
 * REC-011: autoApply 必须 false。
 * REC-013: 必须有 validityWindow (TTL)。
 */
export interface RecommendationCandidate {
  // ── 标识 ──
  /** 建议 ID（确定性：REC-{tick}-{seq}）。 */
  readonly recommendationId: string;

  // ── 分类与目标 ──
  /** 建议分类。 */
  readonly category: RecommendationCategory;
  /** 目标标识（如 roomName, "empire", modelKey）。 */
  readonly target: string;

  // ── 描述 ──
  /** 建议描述。 */
  readonly description: string;
  /** 建议理由（可解释性）。 */
  readonly rationale: string;

  // ── 证据链 ──
  /** 支撑此建议的证据列表。 */
  readonly evidence: readonly EvidenceItem[];
  /** 证据链是否完整。 */
  readonly evidenceComplete: boolean;

  // ── 置信度 ──
  /**
   * 建议置信度。

   * 硬约束：confidence <= min(evidence confidence)。
   * 禁止 confidence > 最低证据置信度。
   */
  readonly confidence: number;

  // ── 排序属性 ──
  /** 紧急度（Lexicographic 第一维度）。 */
  readonly urgency: RecommendationUrgency;
  /** 预期收益（可选，用于排序参考，非 score）。 */
  readonly expectedBenefit: number | null;
  /** 预期成本（可选，用于排序参考，非 score）。 */
  readonly expectedCost: number | null;

  // ── 生命周期 ──
  /** 有效期。 */
  readonly validity: RecommendationValidity;
  /** 上下文签名（Regime 变化检测）。 */
  readonly contextSignature: string;
  /** 生命周期状态。 */
  lifecycle: RecommendationLifecycle;
  /** 被替代时的前驱 ID（supersede 链）。 */
  supersededBy: string | null;
  /** 被替代时的前驱 ID（反向链）。 */
  supersedes: string | null;

  // ── 冲突 ──
  /** 关联的冲突 ID 列表。 */
  readonly conflictIds: readonly string[];

  // ── Shadow-Only 标记（literal type，编译时强制）──
  readonly shadowOnly: true;
  readonly autoApply: false;

  // ── 元数据 ──
  /** 模型版本。 */
  readonly modelVersion: number;
  /** 创建 tick。 */
  readonly createdAt: number;
  /** 确定性 hash。 */
  readonly recommendationHash: string;
}

// ═══════════════════════════════════════════════════════════
// §8. Recommendation Result Type
// ═══════════════════════════════════════════════════════════

/**
 * 建议结果类型 — 要么是有效的 RecommendationCandidate，要么是 NoRecommendationResult。

 * 调用方必须检查是否为 NO_RECOMMENDATION。
 */
export type RecommendationResult =
  | RecommendationCandidate
  | NoRecommendationResult;

/**
 * 检查结果是否为有效 Recommendation（非 NO_RECOMMENDATION）。
 */
export function isValidRecommendation(
  result: RecommendationResult,
): result is RecommendationCandidate {
  return (result as RecommendationCandidate).recommendationId !== undefined;
}

/**
 * 检查结果是否为 NO_RECOMMENDATION。
 */
export function isNoRecommendation(
  result: RecommendationResult,
): result is NoRecommendationResult {
  return "type" in result && result.type === NO_RECOMMENDATION;
}

// ═══════════════════════════════════════════════════════════
// §9. Recommendation Ring Buffer — 有界缓存
// ═══════════════════════════════════════════════════════════

/**
 * Recommendation Ring Buffer — 固定长度环形缓冲。

 * REC-001：A6.6 唯一可写的 cache 结构。
 * REC-012：历史有界，不会无限增长。
 */
export interface RecommendationRingBuffer {
  /** 底层数组。 */
  records: (RecommendationCandidate | undefined)[];
  /** 容量。 */
  capacity: number;
  /** 当前条数。 */
  count: number;
  /** 总写入数（含覆盖）。 */
  totalWritten: number;
  /** 写入游标。 */
  cursor: number;
  /** 自增序列号（生成 recommendationId）。 */
  seq: number;
  /** 冲突记录。 */
  conflicts: (RecommendationConflict | undefined)[];
  /** 冲突容量。 */
  conflictCapacity: number;
  /** 冲突条数。 */
  conflictCount: number;
  /** 冲突写入游标。 */
  conflictCursor: number;
}

/**
 * 创建 Recommendation Ring Buffer。
 */
export function createRecommendationRingBuffer(
  capacity: number,
  conflictCapacity: number,
): RecommendationRingBuffer {
  return {
    records: new Array(capacity).fill(undefined),
    capacity,
    count: 0,
    totalWritten: 0,
    cursor: 0,
    seq: 0,
    conflicts: new Array(conflictCapacity).fill(undefined),
    conflictCapacity,
    conflictCount: 0,
    conflictCursor: 0,
  };
}

// ═══════════════════════════════════════════════════════════
// §10. 常量
// ═══════════════════════════════════════════════════════════

/** Recommendation Ring Buffer 容量。 */
export const RECOMMENDATION_RING_BUFFER_CAPACITY = 100;

/** 冲突记录容量。 */
export const CONFLICT_RING_BUFFER_CAPACITY = 30;

/** Recommendation 最大存活 tick。 */
export const RECOMMENDATION_MAX_AGE = 50000;

/** 最小证据数（低于此值产出 NO_RECOMMENDATION）。 */
export const MIN_EVIDENCE_ITEMS = 1;

/** 最低置信度阈值（低于此值产出 NO_RECOMMENDATION）。 */
export const MIN_CONFIDENCE_THRESHOLD = 0.1;

/** A6.6 模型版本。 */
export const RECOMMENDATION_MODEL_VERSION = 1;

/** A6.6 System 执行间隔（tick）。 */
export const RECOMMENDATION_INTERVAL = 500;

/** 最大 Evidence Items 数（防止单条建议 evidence 过多）。 */
export const MAX_EVIDENCE_ITEMS = 20;

/** 最大活跃建议数（valid 状态，超出时 GC 最旧的）。 */
export const MAX_ACTIVE_RECOMMENDATIONS = 50;
