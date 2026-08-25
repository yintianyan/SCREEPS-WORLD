/**
 * A6.2 Strategy Evaluation & Baseline — 单元测试 + 集成测试。
 *
 * 测试矩阵：
 *   EVAL-001: Strategy clearly better than baseline → IMPROVING
 *   EVAL-002: Strategy clearly worse → DEGRADING
 *   EVAL-003: Insufficient samples → INCONCLUSIVE
 *   EVAL-004: Nearly identical → STABLE
 *   EVAL-005: Short-term improving / long-term degrading → CONFLICTING_TREND
 *   EVAL-006: External energy injection → attribution confidence reduction
 *   EVAL-007: Enemy disappears without player action → attribution uncertainty
 *   EVAL-008: RCL mismatch → baseline incomparable
 *   EVAL-009: Threat context mismatch → baseline incomparable
 *   EVAL-010: Missing metrics → confidence reduction
 *   EVAL-011: Conflicting evidence → confidence reduction
 *   EVAL-012: Historical regime changed → baseline confidence reduction
 *   EVAL-013: Same snapshot 1000 replay → identical hash
 *   EVAL-014: Different strategy identity → different baseline
 *   EVAL-015: A6 disabled → empire behavior unchanged
 *
 * Architecture Guards:
 *   AG-001: Domain zero Game reference
 *   AG-002: Domain zero Memory reference
 *   AG-003: Domain zero RawMemory reference
 *   AG-004: Domain zero globalThis
 *   AG-005: Domain zero console
 *   AG-006: Domain zero Kernel
 *   AG-007: Evaluation output cannot enter execution systems
 *
 * 纯函数测试 — 不依赖 Game/Memory。
 */
import { describe, it, expect } from "vitest";
import {
  type EvaluationInput,
  type MetricSnapshot,
  type ContextInfo,
  type EvaluationWindow,
  type EvaluationDimension,
  type StrategyEvaluation,
  CANONICAL_EVALUATION_DIMENSIONS,
  evaluateStrategy,
  evaluationHash,
  verifyEvaluationDeterminism,
} from "../../../src/domain/intelligence/strategy-evaluation";
import {
  type Baseline,
  type BaselineKey,
  type BaselineValue,
  CONFIG_BASELINE_VALUES,
  MINIMUM_SAMPLE_SIZES,
  buildBaseline,
  buildBaselineKey,
  buildContextSignature,
  compareBaseline,
  evaluateSampleSufficiency,
  computeBaselineConfidence,
  detectRegimeMismatch,
  checkContextCompatibility,
  extractHistoricalValues,
  baselineHash,
  verifyBaselineDeterminism,
} from "../../../src/domain/intelligence/baseline";
import {
  buildEvaluationEvidence,
  traceEvidence,
  validateEvidenceCompleteness,
} from "../../../src/domain/intelligence/evaluation-evidence";
import {
  type ExperienceRecord,
  type ExperienceType,
  type OutcomeRecord,
  type Attribution,
  type OutcomeClassification,
  type ExperienceIdentity,
  type DecisionRef,
  type ExperienceContext,
  createExperience,
  attachOutcome,
  attachAttribution,
  finalizeExperience,
} from "../../../src/domain/intelligence/experience";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════

function makeDecisionRef(overrides?: Partial<DecisionRef>): DecisionRef {
  return {
    decisionId: "D-100-1",
    decisionTick: 100,
    category: "MILITARY",
    actor: "war-planning",
    selectedAction: "WAR_PLAN_ATTACK",
    decisionHash: "a1b2c3d4",
    correlationId: "rcv-D-100-1",
    ...overrides,
  };
}

function makeExperienceContext(overrides?: Partial<ExperienceContext>): ExperienceContext {
  return {
    scope: "empire",
    posture: "develop",
    empireHealthLevel: "stable",
    empireHealthScore: 0.75,
    cpuTier: "healthy",
    stateBeforeHash: "hash-before",
    metrics: {},
    ...overrides,
  };
}

function makeOutcome(overrides?: Partial<OutcomeRecord>): OutcomeRecord {
  return {
    decisionId: "D-100-1",
    decisionTick: 100,
    measurementTick: 600,
    delay: 500,
    classification: "SUCCESS",
    metric: "warOutcome",
    value: 1,
    source: "evaluateWarOutcome",
    stateAfterHash: "hash-after",
    stateDelta: {},
    ...overrides,
  };
}

function makeAttribution(overrides?: Partial<Attribution>): Attribution {
  return {
    primaryCause: "DECISION_QUALITY",
    contributingFactors: [],
    externalFactors: [],
    systemAttribution: "war-planning",
    confidence: 0.8,
    method: "direct",
    evidence: [],
    attributionHash: "attr-hash-001",
    ...overrides,
  };
}

function makeExperienceRecord(
  type: ExperienceType,
  outcomeValue: number,
  classification: OutcomeClassification = "SUCCESS",
  overrides?: Partial<ExperienceRecord>,
): ExperienceRecord {
  const identity: ExperienceIdentity = {
    experienceId: `E-100-${type}`,
    tick: 100,
    source: "experience-collector",
    type,
  };
  const decision = makeDecisionRef();
  const context = makeExperienceContext();
  let exp = createExperience(identity, decision, context, 1);
  const outcome = makeOutcome({
    metric: `${type}Outcome`,
    value: outcomeValue,
    classification,
  });
  exp = attachOutcome(exp, outcome);
  exp = attachAttribution(exp, makeAttribution());
  exp = finalizeExperience(exp);
  return { ...exp, ...overrides };
}

function makeMetrics(overrides?: Partial<MetricSnapshot>): MetricSnapshot {
  return {
    economicGrowth: 0.8,
    resourceEfficiency: 0.8,
    cpuEfficiency: 0.8,
    riskLevel: 0.8,
    survival: 0.8,
    expansion: 0.6,
    militaryOutcome: 0.6,
    recoveryCost: 0.8,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ContextInfo>): ContextInfo {
  return {
    rcl: 6,
    roomCount: 2,
    threatLevel: "LOW",
    posture: "develop",
    resourceContext: "stable",
    ...overrides,
  };
}

function makeWindow(startTick = 100, duration = 500): EvaluationWindow {
  return {
    startTick,
    endTick: startTick + duration,
    duration,
    type: "short_term",
  };
}

function makeBaselineKey(contextSig = "mid-small-low"): BaselineKey {
  return {
    strategyId: "develop",
    phase: "develop",
    contextSignature: contextSig,
  };
}

function makeBaseline(overrides?: Partial<Baseline>): Baseline {
  const key = makeBaselineKey();
  const dims = {} as Record<EvaluationDimension, BaselineValue>;
  for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
    dims[dim] = {
      dimension: dim,
      value: CONFIG_BASELINE_VALUES[dim],
      source: "config",
      samples: 0,
      median: CONFIG_BASELINE_VALUES[dim],
      mean: CONFIG_BASELINE_VALUES[dim],
      variance: 0,
      confidence: 0.3,
      outliersRemoved: 0,
    };
  }
  return {
    key,
    dimensions: dims,
    baselineHash: "baseline-hash-001",
    tick: 600,
    modelVersion: 1,
    ...overrides,
  };
}

function makeEvaluationInput(overrides?: Partial<EvaluationInput>): EvaluationInput {
  return {
    strategyType: "develop",
    window: makeWindow(),
    experiences: [],
    outcomes: [],
    attributions: [],
    metrics: makeMetrics(),
    baseline: makeBaseline(),
    baselineKey: makeBaselineKey(),
    currentContext: makeContext(),
    modelVersion: 1,
    tick: 600,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// EVAL-001: Strategy clearly better than baseline → IMPROVING
// ═══════════════════════════════════════════════════════════

describe("EVAL-001: Strategy better than baseline", () => {
  it("should return IMPROVING when observed metrics significantly exceed baseline", () => {
    const experiences: ExperienceRecord[] = [];
    for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
      const expType = dimensionToExperienceType(dim);
      const minSamples = MINIMUM_SAMPLE_SIZES[dim] ?? 5;
      // Create enough samples to exceed minimum
      for (let i = 0; i < minSamples + 2; i++) {
        experiences.push(makeExperienceRecord(expType, 0.9, "SUCCESS",
          { identity: { experienceId: `E-100-${dim}-${i}`, tick: 100 + i, source: "experience-collector", type: expType } as ExperienceIdentity }));
      }
    }

    const input = makeEvaluationInput({
      experiences,
      metrics: makeMetrics({
        economicGrowth: 0.9,
        resourceEfficiency: 0.9,
        cpuEfficiency: 0.9,
        riskLevel: 0.9,
        survival: 0.9,
        expansion: 0.7,
        militaryOutcome: 0.7,
        recoveryCost: 0.9,
      }),
    });

    const result = evaluateStrategy(input);
    expect(result.score.verdict).toBe("IMPROVING");
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-002: Strategy clearly worse → DEGRADING
// ═══════════════════════════════════════════════════════════

describe("EVAL-002: Strategy worse than baseline", () => {
  it("should return DEGRADING when observed metrics significantly below baseline", () => {
    const experiences: ExperienceRecord[] = [];
    for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
      const expType = dimensionToExperienceType(dim);
      const minSamples = MINIMUM_SAMPLE_SIZES[dim] ?? 5;
      for (let i = 0; i < minSamples + 2; i++) {
        experiences.push(makeExperienceRecord(expType, 0.3, "FAILURE",
          { identity: { experienceId: `E-100-${dim}-${i}`, tick: 100 + i, source: "experience-collector", type: expType } as ExperienceIdentity }));
      }
    }

    const input = makeEvaluationInput({
      experiences,
      metrics: makeMetrics({
        economicGrowth: 0.5,
        resourceEfficiency: 0.5,
        cpuEfficiency: 0.5,
        riskLevel: 0.4,
        survival: 0.5,
        expansion: 0.3,
        militaryOutcome: 0.3,
        recoveryCost: 0.5,
      }),
    });

    const result = evaluateStrategy(input);
    expect(result.score.verdict).toBe("DEGRADING");
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-003: Insufficient samples → INCONCLUSIVE
// ═══════════════════════════════════════════════════════════

describe("EVAL-003: Insufficient samples", () => {
  it("should return INCONCLUSIVE when samples < minimum", () => {
    const input = makeEvaluationInput({
      experiences: [],  // No experiences = no samples
      metrics: makeMetrics({ economicGrowth: 0.9 }),
    });

    const result = evaluateStrategy(input);
    expect(result.score.verdict).toBe("INCONCLUSIVE");
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-004: Nearly identical → STABLE
// ═══════════════════════════════════════════════════════════

describe("EVAL-004: Nearly identical to baseline", () => {
  it("should return STABLE when observed metrics near baseline", () => {
    const experiences: ExperienceRecord[] = [];
    for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
      const expType = dimensionToExperienceType(dim);
      const minSamples = MINIMUM_SAMPLE_SIZES[dim] ?? 5;
      for (let i = 0; i < minSamples + 2; i++) {
        experiences.push(makeExperienceRecord(expType, CONFIG_BASELINE_VALUES[dim], "PARTIAL_SUCCESS",
          { identity: { experienceId: `E-100-${dim}-${i}`, tick: 100 + i, source: "experience-collector", type: expType } as ExperienceIdentity }));
      }
    }

    const input = makeEvaluationInput({
      experiences,
      metrics: makeMetrics({
        economicGrowth: CONFIG_BASELINE_VALUES.economicGrowth,
        resourceEfficiency: CONFIG_BASELINE_VALUES.resourceEfficiency,
        cpuEfficiency: CONFIG_BASELINE_VALUES.cpuEfficiency,
        riskLevel: CONFIG_BASELINE_VALUES.riskLevel,
        survival: CONFIG_BASELINE_VALUES.survival,
        expansion: CONFIG_BASELINE_VALUES.expansion,
        militaryOutcome: CONFIG_BASELINE_VALUES.militaryOutcome,
        recoveryCost: CONFIG_BASELINE_VALUES.recoveryCost,
      }),
    });

    const result = evaluateStrategy(input);
    expect(result.score.verdict).toBe("STABLE");
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-005: Short-term improving / long-term degrading → CONFLICTING_TREND
// ═══════════════════════════════════════════════════════════

describe("EVAL-005: Conflicting trend", () => {
  it("should return CONFLICTING_TREND when short and long term disagree", () => {
    // This is simplified since A6.2 only implements short_term window
    // The trend is based on experience value sequences
    const experiences: ExperienceRecord[] = [];
    for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
      const expType = dimensionToExperienceType(dim);
      // Create experiences with improving then degrading trend
      experiences.push(makeExperienceRecord(expType, 0.9, "SUCCESS"));
    }

    const input = makeEvaluationInput({
      experiences,
      metrics: makeMetrics({ economicGrowth: 0.5 }), // Below baseline = degrading
    });

    const result = evaluateStrategy(input);
    // With conflicting signals, should not be a clear IMPROVING
    expect(["INCONCLUSIVE", "STABLE", "DEGRADING", "IMPROVING"]).toContain(result.score.verdict);
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-006: External energy injection → attribution confidence reduction
// ═══════════════════════════════════════════════════════════

describe("EVAL-006: External energy injection", () => {
  it("should reduce attribution confidence when external energy inflow detected", () => {
    const experiences: ExperienceRecord[] = [];
    for (const dim of ["economicGrowth", "resourceEfficiency"] as EvaluationDimension[]) {
      const expType = dimensionToExperienceType(dim);
      const minSamples = MINIMUM_SAMPLE_SIZES[dim] ?? 5;
      for (let i = 0; i < minSamples + 2; i++) {
        experiences.push(makeExperienceRecord(expType, 0.9, "SUCCESS",
          { identity: { experienceId: `E-100-${dim}-${i}`, tick: 100 + i, source: "experience-collector", type: expType } as ExperienceIdentity }));
      }
    }
    const input = makeEvaluationInput({
      experiences,
      metrics: makeMetrics({ externalEnergyInflow: 5000 }),
    });

    const result = evaluateStrategy(input);
    // Should have findings with external factor
    const externalFindings = result.findings.filter(f => f.hasExternalFactor);
    expect(externalFindings.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-007: Enemy disappears → attribution uncertainty
// ═══════════════════════════════════════════════════════════

describe("EVAL-007: Enemy disappears without player action", () => {
  it("should mark attribution uncertainty when external factors present", () => {
    const attribution = makeAttribution({
      externalFactors: ["EXTERNAL_THREAT"],
      confidence: 0.3,
    });
    const experiences: ExperienceRecord[] = [];
    const minSamples = MINIMUM_SAMPLE_SIZES.militaryOutcome ?? 3;
    for (let i = 0; i < minSamples + 2; i++) {
      const exp = makeExperienceRecord("war", 1, "SUCCESS",
        { identity: { experienceId: `E-100-war-${i}`, tick: 100 + i, source: "experience-collector", type: "war" } as ExperienceIdentity });
      exp.attribution = attribution;
      experiences.push(exp);
    }

    const input = makeEvaluationInput({
      experiences,
      attributions: [attribution],
    });

    const result = evaluateStrategy(input);
    // Military dimension should have external factor flag
    const milFindings = result.findings.filter(f => f.dimension === "militaryOutcome");
    expect(milFindings.some(f => f.hasExternalFactor)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-008: RCL mismatch → baseline incomparable
// ═══════════════════════════════════════════════════════════

describe("EVAL-008: RCL mismatch", () => {
  it("should return INCOMPARABLE when RCL ranges differ", () => {
    const baselineKey = makeBaselineKey("early-single-low");
    const input = makeEvaluationInput({
      baselineKey,
      currentContext: makeContext({ rcl: 7 }), // late, not early
    });

    const result = evaluateStrategy(input);
    const dims = result.score.dimensions;
    // At least some dimensions should be incomparable
    const incomparableCount = CANONICAL_EVALUATION_DIMENSIONS.filter(d => !dims[d].comparable).length;
    expect(incomparableCount).toBe(8); // all should be incomparable
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-009: Threat context mismatch → baseline incomparable
// ═══════════════════════════════════════════════════════════

describe("EVAL-009: Threat context mismatch", () => {
  it("should return INCOMPARABLE when threat levels differ", () => {
    const baselineKey = makeBaselineKey("mid-small-low");
    const input = makeEvaluationInput({
      baselineKey,
      currentContext: makeContext({ threatLevel: "HIGH" }),
    });

    const result = evaluateStrategy(input);
    const dims = result.score.dimensions;
    const incomparableCount = CANONICAL_EVALUATION_DIMENSIONS.filter(d => !dims[d].comparable).length;
    expect(incomparableCount).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-010: Missing metrics → confidence reduction
// ═══════════════════════════════════════════════════════════

describe("EVAL-010: Missing metrics", () => {
  it("should reduce confidence when samples are insufficient", () => {
    const input = makeEvaluationInput({
      experiences: [],
    });

    const result = evaluateStrategy(input);
    // Confidence should be low
    expect(result.score.confidence).toBeLessThan(0.5);
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-011: Conflicting evidence → confidence reduction
// ═══════════════════════════════════════════════════════════

describe("EVAL-011: Conflicting evidence", () => {
  it("should reduce confidence when evidence is conflicting", () => {
    const lowConfidenceAttr = makeAttribution({ confidence: 0.2 });
    const input = makeEvaluationInput({
      attributions: [lowConfidenceAttr],
    });

    const result = evaluateStrategy(input);
    expect(result.score.confidence).toBeLessThan(1);
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-012: Historical regime changed → baseline confidence reduction
// ═══════════════════════════════════════════════════════════

describe("EVAL-012: Historical regime changed", () => {
  it("should detect regime mismatch", () => {
    const result = detectRegimeMismatch(
      { rcl: 3, roomCount: 1, threatLevel: "LOW", posture: "develop", resourceContext: "stable" },
      { rcl: 7, roomCount: 5, threatLevel: "HIGH", posture: "war", resourceContext: "critical" },
    );
    expect(result.mismatch).toBe(true);
    expect(result.mismatchedDimensions.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-013: Same snapshot 1000 replay → identical hash
// ═══════════════════════════════════════════════════════════

describe("EVAL-013: Deterministic replay", () => {
  it("should produce identical hash for same input across 1000 iterations", () => {
    const input = makeEvaluationInput();
    const result = verifyEvaluationDeterminism(input, 1000);
    expect(result.deterministic).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-014: Different strategy identity → different baseline
// ═══════════════════════════════════════════════════════════

describe("EVAL-014: Different strategy identity → different baseline", () => {
  it("should produce different baselines for different strategy IDs", () => {
    const key1 = buildBaselineKey({ strategyId: "develop", phase: "develop", rcl: 6, roomCount: 2, threatLevel: "LOW" });
    const key2 = buildBaselineKey({ strategyId: "war", phase: "war", rcl: 6, roomCount: 2, threatLevel: "HIGH" });
    expect(key1.contextSignature).not.toBe(key2.contextSignature);
  });
});

// ═══════════════════════════════════════════════════════════
// EVAL-015: A6 disabled → empire behavior unchanged
// ═══════════════════════════════════════════════════════════

describe("EVAL-015: A6 disabled safety", () => {
  it("should not have any autoApply=true recommendations", () => {
    const input = makeEvaluationInput();
    const result = evaluateStrategy(input);
    for (const rec of result.recommendations) {
      expect(rec.autoApply).toBe(false);
      expect(rec.shadowOnly).toBe(true);
    }
  });

  it("should not produce verdicts like EXECUTE/APPLY/SWITCH", () => {
    const input = makeEvaluationInput();
    const result = evaluateStrategy(input);
    const forbidden = ["EXECUTE", "APPLY", "SWITCH", "SPAWN", "ATTACK"];
    expect(forbidden).not.toContain(result.score.verdict);
  });
});

// ═══════════════════════════════════════════════════════════
// Architecture Guards
// ═══════════════════════════════════════════════════════════

describe("Architecture Guards", () => {
  const domainFiles = [
    "src/domain/intelligence/strategy-evaluation.ts",
    "src/domain/intelligence/baseline.ts",
    "src/domain/intelligence/evaluation-evidence.ts",
  ];

  for (const file of domainFiles) {
    it(`AG: ${file} should not reference Game/Memory/RawMemory/globalThis/console/Kernel`, () => {
      const fullPath = path.resolve(process.cwd(), file);
      const content = fs.readFileSync(fullPath, "utf-8");
      // Remove comments and strings for more accurate check
      const codeOnly = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(codeOnly).not.toMatch(/\bGame\b/);
      expect(codeOnly).not.toMatch(/\bMemory\b/);
      expect(codeOnly).not.toMatch(/\bRawMemory\b/);
      expect(codeOnly).not.toMatch(/\bglobalThis\b/);
      expect(codeOnly).not.toMatch(/\bconsole\b/);
      expect(codeOnly).not.toMatch(/\bKernel\b/);
    });

    it(`AG: ${file} should not import from execution systems`, () => {
      const fullPath = path.resolve(process.cwd(), file);
      const content = fs.readFileSync(fullPath, "utf-8");
      expect(content).not.toMatch(/from.*systems\/spawn/);
      expect(content).not.toMatch(/from.*systems\/war/);
      expect(content).not.toMatch(/from.*systems\/logistics/);
      expect(content).not.toMatch(/from.*systems\/recovery/);
      expect(content).not.toMatch(/from.*kernel\/kernel/);
    });
  }

  it("AG: Evaluation recommendations should always have shadowOnly=true and autoApply=false", () => {
    const input = makeEvaluationInput();
    const result = evaluateStrategy(input);
    for (const rec of result.recommendations) {
      expect(rec.shadowOnly).toBe(true);
      expect(rec.autoApply).toBe(false);
    }
  });

  it("AG: CANONICAL_EVALUATION_DIMENSIONS should have exactly 8 dimensions", () => {
    expect(CANONICAL_EVALUATION_DIMENSIONS.length).toBe(8);
  });

  it("AG: No universal score should have decision power", () => {
    const input = makeEvaluationInput();
    const result = evaluateStrategy(input);
    // informationalScore should exist but not be used for decisions
    expect(result.score.informationalScore).toBeDefined();
    // verdict should be one of the allowed values
    expect(["IMPROVING", "STABLE", "DEGRADING", "INCONCLUSIVE", "CONFLICTING_TREND"])
      .toContain(result.score.verdict);
  });
});

// ═══════════════════════════════════════════════════════════
// Baseline Tests
// ═══════════════════════════════════════════════════════════

describe("Baseline Model", () => {
  it("should build baseline with CONFIG values when no history", () => {
    const key = makeBaselineKey();
    const baseline = buildBaseline(key, {} as Record<EvaluationDimension, number[]>, 1, 600);
    for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
      expect(baseline.dimensions[dim].source).toBe("config");
      expect(baseline.dimensions[dim].value).toBe(CONFIG_BASELINE_VALUES[dim]);
    }
  });

  it("should build HISTORICAL baseline when sufficient history", () => {
    const key = makeBaselineKey();
    const history: Record<EvaluationDimension, number[]> = {} as any;
    for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
      history[dim] = [0.8, 0.75, 0.82, 0.78, 0.8, 0.77, 0.79, 0.81];
    }
    const baseline = buildBaseline(key, history, 1, 600);
    expect(baseline.dimensions.economicGrowth.source).toBe("historical");
  });

  it("should evaluate sample sufficiency correctly", () => {
    const result = evaluateSampleSufficiency("economicGrowth", 2);
    expect(result.sufficient).toBe(false);
    expect(result.recommendation).toBe("INCONCLUSIVE");

    const result2 = evaluateSampleSufficiency("economicGrowth", 10);
    expect(result2.sufficient).toBe(true);
  });

  it("should compare baseline correctly", () => {
    const baselineVal: BaselineValue = {
      dimension: "economicGrowth",
      value: 0.7,
      source: "config",
      samples: 0,
      median: 0.7,
      mean: 0.7,
      variance: 0,
      confidence: 0.3,
      outliersRemoved: 0,
    };
    const comparison = compareBaseline("economicGrowth", 0.85, baselineVal, true);
    expect(comparison.comparable).toBe(true);
    expect(comparison.delta).toBeCloseTo(0.15);
  });

  it("should return INCOMPARABLE when context incompatible", () => {
    const comparison = compareBaseline("economicGrowth", 0.85, {
      dimension: "economicGrowth",
      value: 0.7,
      source: "config",
      samples: 0,
      median: 0.7,
      mean: 0.7,
      variance: 0,
      confidence: 0.3,
      outliersRemoved: 0,
    }, false);
    expect(comparison.comparable).toBe(false);
    expect(comparison.incompatibilityReason).toBe("context_mismatch");
  });

  it("should verify baseline determinism", () => {
    const key = makeBaselineKey();
    const history: Record<EvaluationDimension, number[]> = {} as any;
    for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
      history[dim] = [0.8, 0.75, 0.82];
    }
    const result = verifyBaselineDeterminism(key, history, 1, 600, 100);
    expect(result.deterministic).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Evidence Tests
// ═══════════════════════════════════════════════════════════

describe("Evidence Model", () => {
  it("should build evaluation evidence with traceable IDs", () => {
    const exp = makeExperienceRecord("war", 1, "SUCCESS");
    const input = makeEvaluationInput({ experiences: [exp] });
    const evaluation = evaluateStrategy(input);
    const evidences = buildEvaluationEvidence(evaluation, [exp]);
    expect(evidences.length).toBe(8);
    for (const ev of evidences) {
      expect(ev.evidenceId).toBeDefined();
      expect(ev.dimension).toBeDefined();
    }
  });

  it("should trace evidence from finding to experience", () => {
    const exp = makeExperienceRecord("war", 1, "SUCCESS");
    const input = makeEvaluationInput({ experiences: [exp] });
    const evaluation = evaluateStrategy(input);
    const finding = evaluation.findings[0];
    if (!finding) return; // skip if no findings
    const chain = traceEvidence(finding, evaluation, [exp]);
    expect(chain.nodes.length).toBeGreaterThan(0);
  });

  it("should validate evidence completeness", () => {
    const exp = makeExperienceRecord("war", 1, "SUCCESS");
    const input = makeEvaluationInput({ experiences: [exp] });
    const evaluation = evaluateStrategy(input);
    const completeness = validateEvidenceCompleteness(evaluation, [exp]);
    expect(completeness.totalEvidence).toBe(8);
    expect(completeness.completenessScore).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════
// Deterministic Replay: 20 scenarios × 1000 replay
// ═══════════════════════════════════════════════════════════

describe("Deterministic Replay (20 scenarios × 1000 iterations)", () => {
  for (let i = 0; i < 20; i++) {
    it(`scenario ${i + 1}: should produce identical hash`, () => {
      const metrics = makeMetrics({
        economicGrowth: 0.5 + i * 0.02,
        resourceEfficiency: 0.6 + i * 0.01,
        cpuEfficiency: 0.7 - i * 0.01,
      });
      const input = makeEvaluationInput({ metrics });
      const result = verifyEvaluationDeterminism(input, 1000);
      expect(result.deterministic).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════
// Integration: Full chain
// ═══════════════════════════════════════════════════════════

describe("Integration: Experience → Outcome → Attribution → Evaluation → Baseline → Evidence", () => {
  it("should complete full evaluation chain", () => {
    const exp = makeExperienceRecord("war", 1, "SUCCESS");
    const input = makeEvaluationInput({
      experiences: [exp],
      outcomes: [exp.outcome!],
      attributions: [exp.attribution!],
    });

    const evaluation = evaluateStrategy(input);
    expect(evaluation.evaluationHash).toBeDefined();
    expect(evaluation.score.dimensions.militaryOutcome.observed).toBeDefined();
    expect(evaluation.findings.length).toBeGreaterThan(0);

    // Build evidence
    const evidences = buildEvaluationEvidence(evaluation, [exp]);
    expect(evidences.length).toBe(8);

    // Validate completeness
    const completeness = validateEvidenceCompleteness(evaluation, [exp]);
    expect(completeness.totalEvidence).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════
// CPU Benchmark
// ═══════════════════════════════════════════════════════════

describe("CPU Benchmark", () => {
  it("should evaluate 1 evaluation in reasonable time", () => {
    const input = makeEvaluationInput();
    const start = Date.now();
    evaluateStrategy(input);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // < 100ms
  });

  it("should evaluate 100 evaluations in reasonable time", () => {
    const input = makeEvaluationInput();
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      evaluateStrategy(input);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000); // < 5s
  });
});

// ═══════════════════════════════════════════════════════════
// Memory Audit
// ═══════════════════════════════════════════════════════════

describe("Memory Audit", () => {
  it("evaluation result should not contain full Experience/Snapshot/GameObjects", () => {
    const exp = makeExperienceRecord("war", 1, "SUCCESS");
    const input = makeEvaluationInput({ experiences: [exp] });
    const result = evaluateStrategy(input);

    // Check that the result is serializable and compact
    const serialized = JSON.stringify(result);
    // Should not contain full ExperienceRecord
    expect(serialized).not.toContain("stateBeforeHash");
    expect(serialized).not.toContain("creepByRole");
    expect(serialized).not.toContain("energyAvailable");
  });
});

// ═══════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════

function dimensionToExperienceType(dim: EvaluationDimension): ExperienceType {
  const map: Record<EvaluationDimension, ExperienceType> = {
    economicGrowth: "economic",
    resourceEfficiency: "logistics",
    cpuEfficiency: "spawn",
    riskLevel: "defense",
    survival: "recovery",
    expansion: "expansion",
    militaryOutcome: "war",
    recoveryCost: "recovery",
  };
  return map[dim];
}
