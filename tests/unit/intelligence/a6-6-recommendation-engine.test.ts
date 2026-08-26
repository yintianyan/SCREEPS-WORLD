/**
 * A6.6 Recommendation Engine — 单元测试 + 确定性测试 + 安全边界测试。
 *
 * 测试矩阵：
 *   REC-001 ~ REC-014: Guard validation
 *   EVID-001 ~ EVID-006: Evidence builder tests
 *   GEN-001 ~ GEN-010: Generator tests
 *   RANK-001 ~ RANK-005: Ranking determinism tests
 *   CONF-001 ~ CONF-004: Conflict detector tests
 *   LIFE-001 ~ LIFE-006: Lifecycle tests (TTL, Supersede, GC)
 *   SHADOW-001 ~ SHADOW-003: Shadow-only boundary tests
 *   DET-001 ~ DET-003: Determinism tests (1000 replay identical)
 *
 * 纯函数测试 — 不依赖 Game/Memory。
 */
import { describe, it, expect } from "vitest";
import {
  type RecommendationCandidate,
  type EvidenceItem,
  type EvidenceTrace,
  type RecommendationRingBuffer,
  type RecommendationResult,
  type RecommendationConflict,
  NO_RECOMMENDATION,
  createRecommendationRingBuffer,
  RECOMMENDATION_RING_BUFFER_CAPACITY,
  CONFLICT_RING_BUFFER_CAPACITY,
  RECOMMENDATION_MAX_AGE,
  MIN_EVIDENCE_ITEMS,
  MIN_CONFIDENCE_THRESHOLD,
  DEFAULT_TTL,
  URGENCY_ORDER,
  isNoRecommendation,
  isValidRecommendation,
} from "../../../src/domain/intelligence/recommendation/types";
import {
  buildExperienceEvidence,
  buildAttributionEvidence,
  buildEvaluationEvidence,
  buildPredictionEvidence,
  buildCalibrationEvidence,
  buildReliabilityEvidence,
  assembleEvidenceTrace,
  makeEvidenceId,
  getEvidenceByStage,
  evidenceTraceSummary,
} from "../../../src/domain/intelligence/recommendation/evidence-builder";
import {
  generateRecommendations,
  computeRecommendationConfidence,
  evaluateEconomicTrigger,
  evaluateSpawnTrigger,
  evaluateDefenseTrigger,
  evaluateRecoveryTrigger,
  evaluatePostureTrigger,
  evaluateExpansionTrigger,
  evaluateMilitaryTrigger,
  evaluateLogisticsTrigger,
  buildRecommendation,
  type RecommendationGeneratorInput,
} from "../../../src/domain/intelligence/recommendation/generator";
import {
  detectConflicts,
  attachConflictIds,
} from "../../../src/domain/intelligence/recommendation/conflict-detector";
import {
  pushRecommendation,
  pushConflict,
  expireOverdueRecommendations,
  expireByRegimeChange,
  processSupersession,
  validateRecommendation,
  gcRecommendationBuffer,
  getActiveRecommendations,
  getActiveConflicts,
  getRecentRecommendations,
  recommendationStats,
} from "../../../src/domain/intelligence/recommendation/lifecycle";
import {
  rankRecommendations,
  getTopRecommendations,
  compareRecommendations,
  explainRanking,
  verifyRankingDeterminism,
} from "../../../src/domain/intelligence/recommendation/ranking";
import {
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
  validateRecommendation as validateRecGuards,
  validateRecommendationBuffer,
  validateSystemGuards,
  type SystemLike,
} from "../../../src/domain/intelligence/recommendation/guards";
import { recommendationHash } from "../../../src/domain/intelligence/recommendation/hashing";

// ═══════════════════════════════════════════════════════════
// §1. Test Helpers
// ═══════════════════════════════════════════════════════════

let evidenceSeq = 0;
function makeTestEvidence(
  stage: EvidenceItem["stage"],
  confidence: number,
  sourceId: string,
  data: Record<string, number | string | boolean> = {},
): EvidenceItem {
  return {
    evidenceId: makeEvidenceId(stage, evidenceSeq++),
    stage,
    source: `test-${stage}`,
    sourceId,
    description: `Test evidence: ${sourceId}`,
    confidence,
    data,
    collectedAt: 1000,
  };
}

function makeFullTrace(items: EvidenceItem[]): EvidenceTrace {
  return assembleEvidenceTrace(items);
}

function makeTestRecommendation(overrides: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  const tick = 1000;
  const seq = 0;
  const validity = {
    createdTick: tick,
    expiresTick: tick + DEFAULT_TTL.economic,
    ttl: DEFAULT_TTL.economic,
  };
  const base: RecommendationCandidate = {
    recommendationId: `REC-${tick}-${seq}`,
    category: "economic",
    target: "empire",
    description: "Test recommendation",
    rationale: "Test rationale",
    evidence: [makeTestEvidence("OBSERVED", 0.8, "exp-001")],
    evidenceComplete: true,
    confidence: 0.7,
    urgency: "medium",
    expectedBenefit: null,
    expectedCost: null,
    validity,
    contextSignature: "test-sig",
    lifecycle: "created",
    supersededBy: null,
    supersedes: null,
    conflictIds: [],
    shadowOnly: true,
    autoApply: false,
    modelVersion: 1,
    createdAt: tick,
    recommendationHash: "test-hash",
  };
  return { ...base, ...overrides };
}

// ═══════════════════════════════════════════════════════════
// §2. Guard Tests (REC-001 ~ REC-014)
// ═══════════════════════════════════════════════════════════

describe("A6.6 Guards — REC-001 ~ REC-014", () => {
  const validSystem: SystemLike = { name: "recommendation-engine" };
  const invalidSystem: SystemLike = { name: "wrong-system" };

  it("REC-001: valid system name passes", () => {
    const result = guardRec001BoundedCache(validSystem);
    expect(result.passed).toBe(true);
  });

  it("REC-001: invalid system name fails", () => {
    const result = guardRec001BoundedCache(invalidSystem);
    expect(result.passed).toBe(false);
  });

  it("REC-002: clean source passes domain purity", () => {
    const clean = "function foo() { return 42; }";
    expect(guardRec002DomainPurity(clean).passed).toBe(true);
  });

  it("REC-002: source with Game. fails", () => {
    const dirty = "const x = Game.rooms;";
    expect(guardRec002DomainPurity(dirty).passed).toBe(false);
  });

  it("REC-002: source with Memory. fails", () => {
    const dirty = "Memory.foo = 1;";
    expect(guardRec002DomainPurity(dirty).passed).toBe(false);
  });

  it("REC-003: clean source passes Game API check", () => {
    const clean = "function foo() { return 42; }";
    expect(guardRec003NoGameApi(clean).passed).toBe(true);
  });

  it("REC-003: source with spawnCreep fails", () => {
    expect(guardRec003NoGameApi("spawn.spawnCreep(body)").passed).toBe(false);
  });

  it("REC-004: valid system passes runtime mutation check", () => {
    expect(guardRec004NoRuntimeMutation(validSystem).passed).toBe(true);
  });

  it("REC-005: clean source passes determinism check", () => {
    expect(guardRec005Determinism("function foo() {}").passed).toBe(true);
  });

  it("REC-005: Math.random fails", () => {
    expect(guardRec005Determinism("Math.random()").passed).toBe(false);
  });

  it("REC-005: Date.now fails", () => {
    expect(guardRec005Determinism("Date.now()").passed).toBe(false);
  });

  it("REC-006: valid recommendation passes execution leak check", () => {
    const rec = makeTestRecommendation();
    expect(guardRec006NoExecutionLeak(rec).passed).toBe(true);
  });

  it("REC-008: recommendation without forbidden fields passes", () => {
    const rec = makeTestRecommendation();
    expect(guardRec008NoDecisionAuthority(rec).passed).toBe(true);
  });

  it("REC-009: recommendation without score fields passes", () => {
    const rec = makeTestRecommendation();
    expect(guardRec009NoUniversalScore(rec).passed).toBe(true);
  });

  it("REC-010: recommendation with evidence passes traceability", () => {
    const rec = makeTestRecommendation();
    expect(guardRec010EvidenceTraceability(rec).passed).toBe(true);
  });

  it("REC-010: recommendation without evidence fails", () => {
    const rec = makeTestRecommendation({ evidence: [] });
    expect(guardRec010EvidenceTraceability(rec).passed).toBe(false);
  });

  it("REC-011: autoApply=false passes", () => {
    const rec = makeTestRecommendation();
    expect(guardRec011NoAutoApply(rec).passed).toBe(true);
  });

  it("REC-012: bounded buffer passes", () => {
    const buf = createRecommendationRingBuffer(10, 5);
    expect(guardRec012NoUnboundedHistory(buf).passed).toBe(true);
  });

  it("REC-013: valid TTL passes", () => {
    const rec = makeTestRecommendation();
    expect(guardRec013TTLEnforcement(rec).passed).toBe(true);
  });

  it("REC-014: deterministic ID format passes", () => {
    const rec = makeTestRecommendation();
    expect(guardRec014Deterministic(rec).passed).toBe(true);
  });

  it("REC-014: non-deterministic ID format fails", () => {
    const rec = makeTestRecommendation({ recommendationId: "random-uuid-123" });
    expect(guardRec014Deterministic(rec).passed).toBe(false);
  });

  it("validateRecommendation: all guards pass for valid rec", () => {
    const rec = makeTestRecommendation();
    const results = validateRecGuards(rec);
    const failures = results.filter(r => !r.passed);
    expect(failures.length).toBe(0);
  });

  it("validateSystemGuards: valid system passes", () => {
    const results = validateSystemGuards(validSystem);
    const failures = results.filter(r => !r.passed);
    expect(failures.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// §3. Evidence Builder Tests
// ═══════════════════════════════════════════════════════════

describe("A6.6 Evidence Builder", () => {
  it("EVID-001: empty experiences → empty evidence", () => {
    const items = buildExperienceEvidence([], 10);
    expect(items.length).toBe(0);
  });

  it("EVID-002: makeEvidenceId produces deterministic ID", () => {
    const id1 = makeEvidenceId("OBSERVED", 0);
    const id2 = makeEvidenceId("OBSERVED", 0);
    expect(id1).toBe(id2);
    expect(id1).toBe("EVI-OBSERVED-0");
  });

  it("EVID-003: assembleEvidenceTrace computes minConfidence correctly", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.9, "a"),
      makeTestEvidence("INFERRED", 0.3, "b"),
      makeTestEvidence("PREDICTED", 0.6, "c"),
    ];
    const trace = assembleEvidenceTrace(items);
    expect(trace.minConfidence).toBe(0.3);
    expect(trace.complete).toBe(true);
  });

  it("EVID-004: trace with only CALIBRATED is incomplete (missing OBSERVED+INFERRED)", () => {
    const items = [makeTestEvidence("CALIBRATED", 0.5, "a")];
    const trace = assembleEvidenceTrace(items);
    expect(trace.complete).toBe(false);
    expect(trace.missingStages).toContain("OBSERVED");
    expect(trace.missingStages).toContain("INFERRED");
  });

  it("EVID-005: empty trace has minConfidence=0", () => {
    const trace = assembleEvidenceTrace([]);
    expect(trace.minConfidence).toBe(0);
    expect(trace.complete).toBe(false);
  });

  it("EVID-006: getEvidenceByStage filters correctly", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.9, "a"),
      makeTestEvidence("INFERRED", 0.3, "b"),
      makeTestEvidence("OBSERVED", 0.8, "c"),
    ];
    const trace = assembleEvidenceTrace(items);
    const observed = getEvidenceByStage(trace, "OBSERVED");
    expect(observed.length).toBe(2);
    const inferred = getEvidenceByStage(trace, "INFERRED");
    expect(inferred.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════
// §4. Generator Tests
// ═══════════════════════════════════════════════════════════

describe("A6.6 Generator", () => {
  it("GEN-001: insufficient evidence → NO_RECOMMENDATION", () => {
    const input: RecommendationGeneratorInput = {
      trace: assembleEvidenceTrace([]),
      contextSignature: "sig",
      dataSufficient: true,
      regimeCompatible: true,
      currentTick: 1000,
      seq: 0,
    };
    const results = generateRecommendations(input);
    expect(results.length).toBe(1);
    expect(isNoRecommendation(results[0]!)).toBe(true);
  });

  it("GEN-002: incomplete evidence → NO_RECOMMENDATION (INSUFFICIENT_EVIDENCE)", () => {
    const items = [makeTestEvidence("CALIBRATED", 0.5, "a")];
    const input: RecommendationGeneratorInput = {
      trace: assembleEvidenceTrace(items),
      contextSignature: "sig",
      dataSufficient: true,
      regimeCompatible: true,
      currentTick: 1000,
      seq: 0,
    };
    const results = generateRecommendations(input);
    expect(results.length).toBe(1);
    expect(isNoRecommendation(results[0]!)).toBe(true);
    if (isNoRecommendation(results[0]!)) {
      expect(results[0]!.reason).toBe("INSUFFICIENT_EVIDENCE");
    }
  });

  it("GEN-003: low confidence evidence → NO_RECOMMENDATION (LOW_CONFIDENCE)", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.01, "a"),
      makeTestEvidence("INFERRED", 0.01, "b"),
    ];
    const input: RecommendationGeneratorInput = {
      trace: assembleEvidenceTrace(items),
      contextSignature: "sig",
      dataSufficient: true,
      regimeCompatible: true,
      currentTick: 1000,
      seq: 0,
    };
    const results = generateRecommendations(input);
    expect(results.length).toBe(1);
    expect(isNoRecommendation(results[0]!)).toBe(true);
    if (isNoRecommendation(results[0]!)) {
      expect(results[0]!.reason).toBe("LOW_CONFIDENCE");
    }
  });

  it("GEN-004: regime mismatch → NO_RECOMMENDATION (REGIME_MISMATCH)", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.8, "a"),
      makeTestEvidence("INFERRED", 0.8, "b"),
    ];
    const input: RecommendationGeneratorInput = {
      trace: assembleEvidenceTrace(items),
      contextSignature: "sig",
      dataSufficient: true,
      regimeCompatible: false,
      currentTick: 1000,
      seq: 0,
    };
    const results = generateRecommendations(input);
    expect(results.length).toBe(1);
    expect(isNoRecommendation(results[0]!)).toBe(true);
    if (isNoRecommendation(results[0]!)) {
      expect(results[0]!.reason).toBe("REGIME_MISMATCH");
    }
  });

  it("GEN-005: valid evidence with no actionable signal → NO_RECOMMENDATION (NO_ACTIONABLE_SIGNAL)", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.8, "a", { experienceType: "unknown", outcome: "SUCCESS" }),
      makeTestEvidence("INFERRED", 0.8, "b", { dimension: "unknown" }),
    ];
    const input: RecommendationGeneratorInput = {
      trace: assembleEvidenceTrace(items),
      contextSignature: "sig",
      dataSufficient: true,
      regimeCompatible: true,
      currentTick: 1000,
      seq: 0,
    };
    const results = generateRecommendations(input);
    expect(results.length).toBe(1);
    expect(isNoRecommendation(results[0]!)).toBe(true);
    if (isNoRecommendation(results[0]!)) {
      expect(results[0]!.reason).toBe("NO_ACTIONABLE_SIGNAL");
    }
  });

  it("GEN-006: economic trigger with energy-shortage prediction → recommendation", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.8, "a", { experienceType: "economic", outcome: "FAILURE" }),
      makeTestEvidence("INFERRED", 0.7, "b", { dimension: "economicGrowth" }),
      makeTestEvidence("PREDICTED", 0.6, "c", { target: "energy-shortage", value: 0.8 }),
    ];
    const input: RecommendationGeneratorInput = {
      trace: assembleEvidenceTrace(items),
      contextSignature: "sig",
      dataSufficient: true,
      regimeCompatible: true,
      currentTick: 1000,
      seq: 0,
    };
    const results = generateRecommendations(input);
    const validRecs = results.filter(isValidRecommendation);
    expect(validRecs.length).toBeGreaterThan(0);
    const economic = validRecs.find(r => r.category === "economic");
    expect(economic).toBeDefined();
  });

  it("GEN-007: spawn starvation prediction → critical urgency", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.8, "a", { experienceType: "spawn", outcome: "SUCCESS" }),
      makeTestEvidence("INFERRED", 0.7, "b", { dimension: "spawnHealth" }),
      makeTestEvidence("PREDICTED", 0.7, "c", { target: "spawn-starvation", value: 0.9 }),
    ];
    const input: RecommendationGeneratorInput = {
      trace: assembleEvidenceTrace(items),
      contextSignature: "sig",
      dataSufficient: true,
      regimeCompatible: true,
      currentTick: 1000,
      seq: 0,
    };
    const results = generateRecommendations(input);
    const validRecs = results.filter(isValidRecommendation);
    const spawn = validRecs.find(r => r.category === "spawn");
    expect(spawn).toBeDefined();
    if (spawn) {
      expect(spawn.urgency).toBe("critical");
    }
  });

  it("GEN-008: defense failure → high urgency recommendation", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.8, "a", { experienceType: "defense", outcome: "FAILURE" }),
      makeTestEvidence("INFERRED", 0.7, "b", { dimension: "defenseStrength" }),
    ];
    const input: RecommendationGeneratorInput = {
      trace: assembleEvidenceTrace(items),
      contextSignature: "sig",
      dataSufficient: true,
      regimeCompatible: true,
      currentTick: 1000,
      seq: 0,
    };
    const results = generateRecommendations(input);
    const validRecs = results.filter(isValidRecommendation);
    const defense = validRecs.find(r => r.category === "defense");
    expect(defense).toBeDefined();
    if (defense) {
      expect(defense.urgency).toBe("high");
    }
  });

  it("GEN-009: recovery failure → critical urgency", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.8, "a", { experienceType: "recovery", outcome: "FAILURE" }),
      makeTestEvidence("INFERRED", 0.7, "b", { dimension: "recoverySpeed" }),
    ];
    const input: RecommendationGeneratorInput = {
      trace: assembleEvidenceTrace(items),
      contextSignature: "sig",
      dataSufficient: true,
      regimeCompatible: true,
      currentTick: 1000,
      seq: 0,
    };
    const results = generateRecommendations(input);
    const validRecs = results.filter(isValidRecommendation);
    const recovery = validRecs.find(r => r.category === "recovery");
    expect(recovery).toBeDefined();
    if (recovery) {
      expect(recovery.urgency).toBe("critical");
    }
  });

  it("GEN-010: generated recommendation has shadowOnly=true and autoApply=false", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.8, "a", { experienceType: "economic", outcome: "FAILURE" }),
      makeTestEvidence("INFERRED", 0.7, "b", { dimension: "economicGrowth" }),
    ];
    const input: RecommendationGeneratorInput = {
      trace: assembleEvidenceTrace(items),
      contextSignature: "sig",
      dataSufficient: true,
      regimeCompatible: true,
      currentTick: 1000,
      seq: 0,
    };
    const results = generateRecommendations(input);
    for (const r of results) {
      if (isValidRecommendation(r)) {
        expect(r.shadowOnly).toBe(true);
        expect(r.autoApply).toBe(false);
      }
    }
  });

  it("GEN-confidence: confidence <= min(evidence confidence)", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.5, "a"),
      makeTestEvidence("INFERRED", 0.9, "b"),
    ];
    const trace = assembleEvidenceTrace(items);
    const conf = computeRecommendationConfidence(trace, true, true);
    expect(conf).toBeLessThanOrEqual(0.5);
  });

  it("GEN-confidence: incomplete evidence reduces confidence", () => {
    // 只有 CALIBRATED 阶段 → 缺少 OBSERVED 和 INFERRED → incomplete
    const items = [
      makeTestEvidence("CALIBRATED", 0.8, "a"),
    ];
    const trace = assembleEvidenceTrace(items);
    expect(trace.complete).toBe(false);
    const conf = computeRecommendationConfidence(trace, true, true);
    // incomplete → confidence * 0.7
    expect(conf).toBeCloseTo(0.8 * 0.7, 3);
  });

  it("GEN-confidence: dataSufficient=false reduces confidence by 0.5", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.8, "a"),
      makeTestEvidence("INFERRED", 0.8, "b"),
    ];
    const trace = assembleEvidenceTrace(items);
    const conf = computeRecommendationConfidence(trace, false, true);
    // complete trace, dataSufficient=false → 0.8 * 0.5
    expect(conf).toBeCloseTo(0.4, 3);
  });
});

// ═══════════════════════════════════════════════════════════
// §5. Ranking Tests
// ═══════════════════════════════════════════════════════════

describe("A6.6 Ranking", () => {
  it("RANK-001: critical urgency ranks before high", () => {
    const a = makeTestRecommendation({ recommendationId: "REC-1000-0", urgency: "critical" });
    const b = makeTestRecommendation({ recommendationId: "REC-1000-1", urgency: "high" });
    expect(compareRecommendations(a, b)).toBeLessThan(0);
  });

  it("RANK-002: higher confidence ranks before lower (same urgency)", () => {
    const a = makeTestRecommendation({ recommendationId: "REC-1000-0", urgency: "medium", confidence: 0.9 });
    const b = makeTestRecommendation({ recommendationId: "REC-1000-1", urgency: "medium", confidence: 0.3 });
    expect(compareRecommendations(a, b)).toBeLessThan(0);
  });

  it("RANK-003: same urgency+confidence → more evidence ranks first", () => {
    const a = makeTestRecommendation({
      recommendationId: "REC-1000-0",
      urgency: "medium",
      confidence: 0.5,
      evidence: [makeTestEvidence("OBSERVED", 0.5, "a"), makeTestEvidence("INFERRED", 0.5, "b")],
    });
    const b = makeTestRecommendation({
      recommendationId: "REC-1000-1",
      urgency: "medium",
      confidence: 0.5,
      evidence: [makeTestEvidence("OBSERVED", 0.5, "a")],
    });
    expect(compareRecommendations(a, b)).toBeLessThan(0);
  });

  it("RANK-004: all-equal → recommendationId as tie-breaker", () => {
    const a = makeTestRecommendation({ recommendationId: "REC-1000-0" });
    const b = makeTestRecommendation({ recommendationId: "REC-1000-1" });
    expect(compareRecommendations(a, b)).toBeLessThan(0);
  });

  it("RANK-DET-001: 1000 replay produces identical ranking", () => {
    const recs = [
      makeTestRecommendation({ recommendationId: "REC-1000-3", urgency: "low" }),
      makeTestRecommendation({ recommendationId: "REC-1000-1", urgency: "high" }),
      makeTestRecommendation({ recommendationId: "REC-1000-2", urgency: "medium" }),
      makeTestRecommendation({ recommendationId: "REC-1000-0", urgency: "critical" }),
    ];
    const result = verifyRankingDeterminism(recs, 1000);
    expect(result.deterministic).toBe(true);
  });

  it("RANK-DET-002: getTopRecommendations returns correct count", () => {
    const recs = [
      makeTestRecommendation({ recommendationId: "REC-1000-3", urgency: "low" }),
      makeTestRecommendation({ recommendationId: "REC-1000-1", urgency: "high" }),
      makeTestRecommendation({ recommendationId: "REC-1000-2", urgency: "medium" }),
      makeTestRecommendation({ recommendationId: "REC-1000-0", urgency: "critical" }),
    ];
    const top = getTopRecommendations(recs, 2);
    expect(top.length).toBe(2);
    expect(top[0]!.urgency).toBe("critical");
    expect(top[1]!.urgency).toBe("high");
  });

  it("RANK-explain: explainRanking returns a string", () => {
    const a = makeTestRecommendation({ recommendationId: "REC-1000-0", urgency: "critical" });
    const b = makeTestRecommendation({ recommendationId: "REC-1000-1", urgency: "low" });
    const explanation = explainRanking(a, b);
    expect(typeof explanation).toBe("string");
    expect(explanation.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// §6. Conflict Detector Tests
// ═══════════════════════════════════════════════════════════

describe("A6.6 Conflict Detector", () => {
  it("CONF-001: no conflicts with single recommendation", () => {
    const recs = [makeTestRecommendation({ recommendationId: "REC-1000-0" })];
    const conflicts = detectConflicts(recs, 1000);
    expect(conflicts.length).toBe(0);
  });

  it("CONF-002: same target+category → same_target conflict", () => {
    const recs = [
      makeTestRecommendation({ recommendationId: "REC-1000-0", lifecycle: "valid" }),
      makeTestRecommendation({ recommendationId: "REC-1000-1", lifecycle: "valid" }),
    ];
    const conflicts = detectConflicts(recs, 1000);
    const sameTarget = conflicts.find(c => c.type === "same_target");
    expect(sameTarget).toBeDefined();
  });

  it("CONF-003: posture + military → strategic_contradiction", () => {
    const recs = [
      makeTestRecommendation({ recommendationId: "REC-1000-0", category: "posture", lifecycle: "valid" }),
      makeTestRecommendation({ recommendationId: "REC-1000-1", category: "military", lifecycle: "valid" }),
    ];
    const conflicts = detectConflicts(recs, 1000);
    const strategic = conflicts.find(c => c.type === "strategic_contradiction");
    expect(strategic).toBeDefined();
    expect(strategic!.severity).toBe("high");
  });

  it("CONF-004: attachConflictIds updates recommendations", () => {
    const recs = [
      makeTestRecommendation({ recommendationId: "REC-1000-0", lifecycle: "valid" }),
      makeTestRecommendation({ recommendationId: "REC-1000-1", lifecycle: "valid" }),
    ];
    const conflicts = detectConflicts(recs, 1000);
    const updated = attachConflictIds(recs, conflicts);
    // At least some recommendations should have conflict IDs
    const withConflicts = updated.filter(r => r.conflictIds.length > 0);
    expect(withConflicts.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// §7. Lifecycle Tests
// ═══════════════════════════════════════════════════════════

describe("A6.6 Lifecycle", () => {
  it("LIFE-001: TTL expiry marks recommendations as expired", () => {
    const buf = createRecommendationRingBuffer(10, 5);
    const rec = makeTestRecommendation({
      validity: { createdTick: 1000, expiresTick: 1100, ttl: 100 },
      lifecycle: "valid",
    });
    pushRecommendation(buf, rec);
    const expired = expireOverdueRecommendations(buf, 1200);
    expect(expired).toBe(1);
    const active = getActiveRecommendations(buf);
    expect(active.length).toBe(0);
  });

  it("LIFE-002: regime change expires recommendations", () => {
    const buf = createRecommendationRingBuffer(10, 5);
    const rec = makeTestRecommendation({
      contextSignature: "peace",
      lifecycle: "valid",
    });
    pushRecommendation(buf, rec);
    const expired = expireByRegimeChange(buf, "war");
    expect(expired).toBe(1);
  });

  it("LIFE-003: supersession marks old as superseded", () => {
    const buf = createRecommendationRingBuffer(10, 5);
    const old = makeTestRecommendation({
      recommendationId: "REC-1000-0",
      lifecycle: "valid",
    });
    pushRecommendation(buf, old);
    const newRec = makeTestRecommendation({
      recommendationId: "REC-1100-0",
      createdAt: 1100,
    });
    const result = processSupersession(buf, newRec);
    expect(result.supersedes).toBe("REC-1000-0");
    // Old should be superseded
    const oldRec = buf.records.find(r => r?.recommendationId === "REC-1000-0");
    expect(oldRec?.lifecycle).toBe("superseded");
    expect(oldRec?.supersededBy).toBe("REC-1100-0");
  });

  it("LIFE-004: validateRecommendation transitions created→valid", () => {
    const rec = makeTestRecommendation({ lifecycle: "created" });
    const validated = validateRecommendation(rec);
    expect(validated.lifecycle).toBe("valid");
  });

  it("LIFE-005: GC cleans old records", () => {
    const buf = createRecommendationRingBuffer(10, 5);
    const rec = makeTestRecommendation({ createdAt: 1000 });
    pushRecommendation(buf, rec);
    const result = gcRecommendationBuffer(buf, 1000 + RECOMMENDATION_MAX_AGE + 1, RECOMMENDATION_MAX_AGE);
    expect(result.cleaned).toBe(1);
    expect(buf.count).toBe(0);
  });

  it("LIFE-006: ring buffer wraps around (overwrite oldest)", () => {
    const buf = createRecommendationRingBuffer(2, 2);
    const rec1 = makeTestRecommendation({ recommendationId: "REC-1000-0" });
    const rec2 = makeTestRecommendation({ recommendationId: "REC-1000-1" });
    const rec3 = makeTestRecommendation({ recommendationId: "REC-1000-2" });
    pushRecommendation(buf, rec1);
    pushRecommendation(buf, rec2);
    pushRecommendation(buf, rec3);
    // Capacity is 2, so count should be 2
    expect(buf.count).toBe(2);
    expect(buf.totalWritten).toBe(3);
    // rec1 should have been overwritten
    const ids = buf.records.filter(r => r).map(r => r!.recommendationId);
    expect(ids).not.toContain("REC-1000-0");
    expect(ids).toContain("REC-1000-1");
    expect(ids).toContain("REC-1000-2");
  });

  it("LIFE-007: getRecentRecommendations returns latest N", () => {
    const buf = createRecommendationRingBuffer(10, 5);
    for (let i = 0; i < 5; i++) {
      pushRecommendation(buf, makeTestRecommendation({ recommendationId: `REC-1000-${i}` }));
    }
    const recent = getRecentRecommendations(buf, 3);
    expect(recent.length).toBe(3);
    // Most recent first
    expect(recent[0]!.recommendationId).toBe("REC-1000-4");
  });

  it("LIFE-008: recommendationStats computes correctly", () => {
    const buf = createRecommendationRingBuffer(10, 5);
    pushRecommendation(buf, makeTestRecommendation({ recommendationId: "REC-1000-0", lifecycle: "valid" }));
    pushRecommendation(buf, makeTestRecommendation({ recommendationId: "REC-1000-1", lifecycle: "expired" }));
    pushRecommendation(buf, makeTestRecommendation({ recommendationId: "REC-1000-2", lifecycle: "superseded" }));
    const stats = recommendationStats(buf);
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(1);
    expect(stats.expired).toBe(1);
    expect(stats.superseded).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════
// §8. Shadow-Only Boundary Tests
// ═══════════════════════════════════════════════════════════

describe("A6.6 Shadow-Only Boundary", () => {
  it("SHADOW-001: RecommendationCandidate type enforces shadowOnly=true at compile time", () => {
    const rec = makeTestRecommendation();
    // Type system enforces shadowOnly: true (literal type)
    expect(rec.shadowOnly).toBe(true);
  });

  it("SHADOW-002: RecommendationCandidate type enforces autoApply=false at compile time", () => {
    const rec = makeTestRecommendation();
    // Type system enforces autoApply: false (literal type)
    expect(rec.autoApply).toBe(false);
  });

  it("SHADOW-003: RecommendationCandidate has no executeAction field", () => {
    const rec = makeTestRecommendation();
    const recObj = rec as unknown as Record<string, unknown>;
    expect("executeAction" in recObj).toBe(false);
    expect("applyStrategy" in recObj).toBe(false);
    expect("resolveConflict" in recObj).toBe(false);
  });

  it("SHADOW-004: RecommendationCandidate has no recommendationScore field", () => {
    const rec = makeTestRecommendation();
    const recObj = rec as unknown as Record<string, unknown>;
    expect("recommendationScore" in recObj).toBe(false);
    expect("overallScore" in recObj).toBe(false);
    expect("globalScore" in recObj).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// §9. Determinism Tests
// ═══════════════════════════════════════════════════════════

describe("A6.6 Determinism", () => {
  it("DET-001: recommendationHash is deterministic for same input", () => {
    // Use fixed evidence (no evidenceSeq side-effect) to ensure identical inputs
    const fixedEvidence: EvidenceItem = {
      evidenceId: "EVI-OBSERVED-0",
      stage: "OBSERVED",
      source: "test",
      sourceId: "exp-001",
      description: "Test evidence",
      confidence: 0.8,
      data: {},
      collectedAt: 1000,
    };
    const rec1 = makeTestRecommendation({ recommendationId: "REC-1000-0", evidence: [fixedEvidence] });
    const rec2 = makeTestRecommendation({ recommendationId: "REC-1000-0", evidence: [fixedEvidence] });
    const { recommendationHash: _h, ...r1 } = rec1;
    const { recommendationHash: _h2, ...r2 } = rec2;
    expect(recommendationHash(r1)).toBe(recommendationHash(r2));
  });

  it("DET-002: different input → different hash", () => {
    const rec1 = makeTestRecommendation({ recommendationId: "REC-1000-0", confidence: 0.5 });
    const rec2 = makeTestRecommendation({ recommendationId: "REC-1000-0", confidence: 0.9 });
    const { recommendationHash: _h, ...r1 } = rec1;
    const { recommendationHash: _h2, ...r2 } = rec2;
    expect(recommendationHash(r1)).not.toBe(recommendationHash(r2));
  });

  it("DET-003: generateRecommendations is deterministic — 1000 replay identical", () => {
    const items = [
      makeTestEvidence("OBSERVED", 0.8, "a", { experienceType: "economic", outcome: "FAILURE" }),
      makeTestEvidence("INFERRED", 0.7, "b", { dimension: "economicGrowth" }),
    ];
    const input: RecommendationGeneratorInput = {
      trace: assembleEvidenceTrace(items),
      contextSignature: "sig",
      dataSufficient: true,
      regimeCompatible: true,
      currentTick: 1000,
      seq: 0,
    };

    const firstResult = generateRecommendations(input);
    const firstJson = JSON.stringify(firstResult.map(r => {
      if (isValidRecommendation(r)) {
        return { id: r.recommendationId, hash: r.recommendationHash, category: r.category };
      }
      return { type: r.type, reason: r.reason };
    }));

    for (let i = 1; i < 1000; i++) {
      const result = generateRecommendations(input);
      const json = JSON.stringify(result.map(r => {
        if (isValidRecommendation(r)) {
          return { id: r.recommendationId, hash: r.recommendationHash, category: r.category };
        }
        return { type: r.type, reason: r.reason };
      }));
      expect(json).toBe(firstJson);
    }
  });

  it("DET-004: ranking is deterministic — 1000 replay identical", () => {
    const recs = [
      makeTestRecommendation({ recommendationId: "REC-1000-3", urgency: "low", confidence: 0.2 }),
      makeTestRecommendation({ recommendationId: "REC-1000-1", urgency: "high", confidence: 0.8 }),
      makeTestRecommendation({ recommendationId: "REC-1000-2", urgency: "medium", confidence: 0.5 }),
      makeTestRecommendation({ recommendationId: "REC-1000-0", urgency: "critical", confidence: 0.9 }),
      makeTestRecommendation({ recommendationId: "REC-1000-4", urgency: "low", confidence: 0.1 }),
    ];
    const firstResult = rankRecommendations(recs).map(r => r.recommendationId).join(",");
    for (let i = 1; i < 1000; i++) {
      const result = rankRecommendations(recs).map(r => r.recommendationId).join(",");
      expect(result).toBe(firstResult);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// §10. Buffer Bounded Memory Tests
// ═══════════════════════════════════════════════════════════

describe("A6.6 Bounded Memory", () => {
  it("BUF-001: ring buffer capacity is enforced", () => {
    const cap = 5;
    const buf = createRecommendationRingBuffer(cap, 3);
    for (let i = 0; i < 20; i++) {
      pushRecommendation(buf, makeTestRecommendation({ recommendationId: `REC-1000-${i}` }));
    }
    expect(buf.count).toBe(cap);
    expect(buf.records.length).toBe(cap);
    expect(buf.totalWritten).toBe(20);
  });

  it("BUF-002: conflict ring buffer capacity is enforced", () => {
    const cap = 3;
    const buf = createRecommendationRingBuffer(10, cap);
    for (let i = 0; i < 20; i++) {
      pushConflict(buf, {
        conflictId: `CF-test-${i}`,
        type: "same_target",
        participantIds: [`REC-1000-${i}`],
        description: `Test conflict ${i}`,
        severity: "low",
        detectedAt: 1000,
        conflictHash: `hash-${i}`,
      });
    }
    expect(buf.conflictCount).toBe(cap);
    expect(buf.conflicts.length).toBe(cap);
  });

  it("BUF-003: validateRecommendationBuffer passes for valid buffer", () => {
    const buf = createRecommendationRingBuffer(10, 5);
    const rec = makeTestRecommendation({ lifecycle: "valid" });
    pushRecommendation(buf, rec);
    const violations = validateRecommendationBuffer(buf);
    expect(violations.filter(v => !v.passed).length).toBe(0);
  });

  it("BUF-004: getActiveConflicts returns sorted by conflictId", () => {
    const buf = createRecommendationRingBuffer(10, 10);
    pushConflict(buf, { conflictId: "CF-zzz", type: "same_target", participantIds: [], description: "", severity: "low", detectedAt: 1, conflictHash: "h1" });
    pushConflict(buf, { conflictId: "CF-aaa", type: "same_target", participantIds: [], description: "", severity: "low", detectedAt: 1, conflictHash: "h2" });
    const conflicts = getActiveConflicts(buf);
    expect(conflicts[0]!.conflictId).toBe("CF-aaa");
    expect(conflicts[1]!.conflictId).toBe("CF-zzz");
  });
});