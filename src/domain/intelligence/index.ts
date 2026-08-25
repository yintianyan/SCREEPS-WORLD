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
