/**
 * A6.1 Intelligence Domain — 统一出口。
 *
 * 分层结构：
 *   experience.ts  — Experience 模型 + Ring Buffer + 构建函数
 *   outcome.ts     — Outcome 采集（消费已有系统）
 *   attribution.ts — Attribution 归因（Evidence-based）
 *
 * 纯函数律：本模块不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 */

// ── Experience ──
export type {
  ExperienceType,
  ExperienceLifecycle,
  OutcomeClassification,
  AttributionMethod,
  AttributionFactor,
  ExperienceIdentity,
  DecisionRef,
  ExperienceContext,
  OutcomeRecord,
  StateDelta,
  AttributionEvidence,
  Attribution,
  ExperienceRecord,
  ExperienceRingBuffer,
} from "./experience";

export {
  createExperienceRingBuffer,
  pushExperience,
  getRecentExperiences,
  getUnattributed,
  getPendingOutcomes,
  makeExperienceId,
  buildDecisionRef,
  createExperience,
  attachOutcome,
  attachAttribution,
  finalizeExperience,
  expireExperience,
  unresolveExperience,
  MEASUREMENT_DELAYS,
  isDecisionReadyForOutcome,
  categoryToExperienceType,
  gcExperienceBuffer,
  experienceStats,
} from "./experience";

// ── Outcome ──
export type {
  OutcomeCollectionInput,
} from "./outcome";

export {
  collectOutcome,
  computeOutcomeConfidence,
} from "./outcome";

// ── Attribution ──
export type {
  AttributionInput,
} from "./attribution";

export {
  collectAttribution,
  computeAttributionConfidence,
  attributionHash,
  verifyAttributionDeterminism,
} from "./attribution";

// ── A6.2 Strategy Evaluation ──
export type {
  EvaluationDimension,
  EvidenceType,
  EvaluationVerdict,
  EvaluationWindow,
  WindowType,
  DimensionScore as EvaluationDimensionScore,
  TrendDirection,
  StrategyScore,
  EvaluationFinding,
  RecommendationCandidate,
  StrategyEvaluation,
  EvaluationInput,
  MetricSnapshot,
  ContextInfo,
} from "./strategy-evaluation";

export {
  CANONICAL_EVALUATION_DIMENSIONS,
  evaluateStrategy,
  evaluationHash,
  verifyEvaluationDeterminism,
} from "./strategy-evaluation";

// ── A6.2 Baseline ──
export type {
  BaselineSource,
  BaselineKey,
  BaselineValue,
  Baseline,
  BaselineComparison,
  SampleSufficiency,
  RegimeMismatch,
} from "./baseline";

export {
  CONFIG_BASELINE_VALUES,
  MINIMUM_SAMPLE_SIZES,
  buildContextSignature,
  buildBaselineKey,
  buildBaseline,
  compareBaseline,
  evaluateSampleSufficiency,
  computeBaselineConfidence,
  detectRegimeMismatch,
  checkContextCompatibility,
  extractHistoricalValues,
  baselineHash,
  verifyBaselineDeterminism,
} from "./baseline";

// ── A6.2 Evaluation Evidence ──
export type {
  EvaluationEvidence,
  EvidenceChain,
  EvidenceChainNode,
  EvidenceCompleteness,
} from "./evaluation-evidence";

export {
  buildEvaluationEvidence,
  traceEvidence,
  validateEvidenceCompleteness,
} from "./evaluation-evidence";
