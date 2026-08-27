/** A6.6 Recommendation Domain — 统一出口。 */

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
