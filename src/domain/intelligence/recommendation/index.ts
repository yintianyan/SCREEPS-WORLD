/**
 * A6.6 Recommendation Domain — 统一出口。
 *
 * 分层结构：
 *   types.ts              — RecommendationCandidate, EvidenceItem, NoRecommendation 等
 *   evidence-builder.ts   — 从 A6.1-A6.5 数据构建 EvidenceItem[]
 *   generator.ts          — 规则匹配 + Recommendation 生成
 *   conflict-detector.ts — Recommendation 间冲突检测
 *   lifecycle.ts          — TTL / Supersede / GC 生命周期管理
 *   ranking.ts            — Lexicographic ranking（确定性排序）
 *   hashing.ts            — 确定性 hash（复用 A6.3 stableStringify + FNV-1a）
 *   guards.ts             — REC-001~014 守卫验证函数
 *
 * 纯函数律：本模块不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 */

// ── Types ──
export type {
  RecommendationCategory,
  RecommendationUrgency,
  EvidenceStage,
  EvidenceItem,
  EvidenceTrace,
  NoRecommendationReason,
  NoRecommendationResult,
  RecommendationValidity,
  RecommendationLifecycle,
  RecommendationConflictType,
  ConflictSeverity,
  RecommendationConflict,
  RecommendationCandidate,
  RecommendationResult,
  RecommendationRingBuffer,
} from "./types";

export {
  URGENCY_ORDER,
  NO_RECOMMENDATION,
  DEFAULT_TTL,
  RECOMMENDATION_RING_BUFFER_CAPACITY,
  CONFLICT_RING_BUFFER_CAPACITY,
  RECOMMENDATION_MAX_AGE,
  MIN_EVIDENCE_ITEMS,
  MIN_CONFIDENCE_THRESHOLD,
  RECOMMENDATION_MODEL_VERSION,
  RECOMMENDATION_INTERVAL,
  MAX_EVIDENCE_ITEMS,
  MAX_ACTIVE_RECOMMENDATIONS,
  createRecommendationRingBuffer,
  isValidRecommendation,
  isNoRecommendation,
} from "./types";

// ── Evidence Builder ──
export type {
  RecommendationGeneratorInput,
  // TriggerResult is internal
} from "./generator";

export {
  makeEvidenceId,
  buildExperienceEvidence,
  buildAttributionEvidence,
  buildEvaluationEvidence,
  buildPredictionEvidence,
  buildCalibrationEvidence,
  buildReliabilityEvidence,
  assembleEvidenceTrace,
  getEvidenceByStage,
  evidenceTraceSummary,
} from "./evidence-builder";

// ── Generator ──
export {
  computeRecommendationConfidence,
  evaluateEconomicTrigger,
  evaluateSpawnTrigger,
  evaluateDefenseTrigger,
  evaluateLogisticsTrigger,
  evaluateRecoveryTrigger,
  evaluatePostureTrigger,
  evaluateExpansionTrigger,
  evaluateMilitaryTrigger,
  buildRecommendation,
  generateRecommendations,
} from "./generator";

// ── Conflict Detector ──
export {
  detectConflicts,
  attachConflictIds,
} from "./conflict-detector";

// ── Lifecycle ──
export {
  expireOverdueRecommendations,
  expireByRegimeChange,
  processSupersession,
  validateRecommendation as validateRecommendationLifecycle,
  gcRecommendationBuffer,
  pushRecommendation,
  pushConflict,
  getActiveRecommendations,
  getRecentRecommendations,
  getActiveConflicts,
  recommendationStats,
} from "./lifecycle";

// ── Ranking ──
export {
  compareRecommendations,
  rankRecommendations,
  getTopRecommendations,
  explainRanking,
  verifyRankingDeterminism,
} from "./ranking";

// ── Hashing ──
export {
  recommendationHash,
  conflictHash,
  verifyRecommendationDeterminism,
  stableStringify,
  fnv1a32Hex,
} from "./hashing";

// ── Guards ──
export type {
  GuardResult,
} from "./guards";

export {
  guardRec001BoundedCache,
  guardRec002DomainPurity,
  guardRec003NoGameApi,
  guardRec004NoRuntimeMutation,
  guardRec005Determinism,
  guardRec006NoExecutionLeak,
  guardRec007NoStrategyMutation,
  guardRec008NoDecisionAuthority,
  guardRec009NoUniversalScore,
  guardRec010EvidenceTraceability,
  guardRec011NoAutoApply,
  guardRec012NoUnboundedHistory,
  guardRec013TTLEnforcement,
  guardRec014Deterministic,
  validateRecommendation,
  validateRecommendationBuffer,
  validateSystemGuards,
} from "./guards";
