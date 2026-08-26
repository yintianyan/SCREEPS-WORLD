/**
 * A6.5 Reliability Assessment — 反事实测试 (REL-C1 ~ REL-C15)
 *
 * 合同锚点：A6_5_ACCEPTANCE.md §四 (D3 正确性)
 *
 * 覆盖场景：
 *   CF-1:  Regime Profile 存在且充足
 *   CF-2:  Regime Profile 不存在 → Fallback
 *   CF-3:  样本不足 → INSUFFICIENT_FOR_REGIME
 *   CF-4:  Drift DEGRADING 检测
 *   CF-5:  Drift IMPROVING 检测
 *   CF-6:  样本不足 → drift 不检测
 *   CF-7:  逻辑冲突（互斥预测对）
 *   CF-8:  因果链（不误报冲突）
 *   CF-9:  Temporal 不一致
 *   CF-10: Regime 冲突
 *   CF-11: 全面恶化
 *   CF-12: 冷启动
 *   CF-13: 部分数据
 *   CF-14: Profile Aging
 *   CF-15: 守卫违规检测
 *
 * 纯函数测试 — 不引用 Game/Memory。
 */

import { describe, expect, it } from "vitest";
import { computeIntelligenceState } from "../../../src/domain/intelligence/reliability/compute-state";
import type { IntelligenceStateInput } from "../../../src/domain/intelligence/reliability/compute-state";
import type { IntelligenceState } from "../../../src/domain/intelligence/reliability/types";
import {
  validateIntelligenceState,
  validateIntelligenceSystem,
  guardRelReadOnly,
  guardRelNoStrategyMutation,
  guardRelNoNewSampler,
  guardRelNoConflictResolution,
  guardRelNoReliabilityScore,
  guardRelDeterminism,
  guardRelEvidenceTraceability,
} from "../../../src/domain/intelligence/reliability/guards";
import { intelligenceStateSystem } from "../../../src/systems/intelligence/intelligence-state-system";
import type { Prediction } from "../../../src/domain/intelligence/prediction/types";
import type { PredictionContext } from "../../../src/domain/intelligence/prediction/context";
import { makePredictionContext, buildPredictionContextSignature } from "../../../src/domain/intelligence/prediction/context";
import type { ResolutionResult, ModelCalibrationProfile, ModelFailureStats } from "../../../src/domain/intelligence/calibration/types";
import { MIN_SAMPLES_FOR_PROFILE } from "../../../src/domain/intelligence/calibration/types";
import { MIN_SAMPLES_FOR_REGIME_PROFILE } from "../../../src/domain/intelligence/reliability/types";

// ═══════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════

const BASE_TICK = 100000;

const BASE_CONTEXT: PredictionContext = makePredictionContext({
  posture: "develop",
  watchdogTier: "healthy",
  roomCount: 3,
  maxRcl: 7,
  threatLevel: "LOW",
});

/**
 * 创建最小可用 Prediction。
 */
function makePrediction(overrides: Partial<Prediction> = {}): Prediction {
  const ctx = overrides.context ?? BASE_CONTEXT;
  const sig = buildPredictionContextSignature(ctx);
  return {
    id: overrides.id ?? "P-test-0",
    generatedAt: overrides.generatedAt ?? BASE_TICK,
    target: overrides.target ?? "energy-shortage",
    window: overrides.window ?? { startTick: BASE_TICK, endTick: BASE_TICK + 1000, duration: 1000 },
    value: overrides.value ?? 0.5,
    confidence: overrides.confidence ?? 0.7,
    method: overrides.method ?? "trend-extrapolation",
    evidence: overrides.evidence ?? {
      sources: ["test"],
      modelParams: {},
      sampleRange: { oldestTick: BASE_TICK - 100, newestTick: BASE_TICK, count: 10 },
      regimeCompatibility: { compatible: true, mismatchedDimensions: [], confidenceMultiplier: 1.0 },
    },
    modelVersion: overrides.modelVersion ?? 1,
    status: overrides.status ?? "active",
    contextSignature: overrides.contextSignature ?? sig,
    context: ctx,
  };
}

/**
 * 创建最小可用 ResolutionResult。
 */
function makeResolution(overrides: Partial<ResolutionResult> = {}): ResolutionResult {
  const ctx = overrides.resolutionContextSignature ?? buildPredictionContextSignature(BASE_CONTEXT);
  return {
    predictionId: overrides.predictionId ?? "P-test-0",
    resolution: overrides.resolution ?? "CORRECT",
    resolvedTick: overrides.resolvedTick ?? BASE_TICK + 100,
    predictedValue: overrides.predictedValue ?? 0.5,
    actualValue: overrides.actualValue ?? 0.6,
    absoluteError: overrides.absoluteError ?? 0.1,
    relativeError: overrides.relativeError ?? 0.2,
    directionCorrect: overrides.directionCorrect ?? true,
    withinHorizon: overrides.withinHorizon ?? true,
    resolutionContextSignature: ctx,
    regimeChanged: overrides.regimeChanged ?? false,
    regimeMismatchedDimensions: overrides.regimeMismatchedDimensions ?? [],
    hasExternalInterference: overrides.hasExternalInterference ?? false,
    externalFactorSources: overrides.externalFactorSources ?? [],
    reason: overrides.reason ?? "test",
    resolutionHash: overrides.resolutionHash ?? "test-hash-00000000",
  };
}

/**
 * 创建最小可用 ModelCalibrationProfile。
 */
function makeProfile(overrides: Partial<ModelCalibrationProfile> = {}): ModelCalibrationProfile {
  return {
    modelKey: overrides.modelKey ?? "energy-shortage-trend-extrapolation-1",
    target: overrides.target ?? "energy-shortage",
    method: overrides.method ?? "trend-extrapolation",
    modelVersion: overrides.modelVersion ?? 1,
    statisticsTick: overrides.statisticsTick ?? BASE_TICK,
    totalResolutions: overrides.totalResolutions ?? MIN_SAMPLES_FOR_PROFILE,
    calibratableCount: overrides.calibratableCount ?? MIN_SAMPLES_FOR_PROFILE,
    regimeChangedCount: overrides.regimeChangedCount ?? 0,
    externalInterferenceCount: overrides.externalInterferenceCount ?? 0,
    insufficientObservationCount: overrides.insufficientObservationCount ?? 0,
    buckets: overrides.buckets ?? [],
    calibrationVerdict: overrides.calibrationVerdict ?? "WELL_CALIBRATED",
    ece: overrides.ece ?? 0.05,
    brierScore: overrides.brierScore ?? 0.15,
    falsePositiveRate: overrides.falsePositiveRate ?? 0.1,
    falseNegativeRate: overrides.falseNegativeRate ?? 0.1,
    profileHash: overrides.profileHash ?? "profile-hash-00000000",
  };
}

/**
 * 构建 IntelligenceStateInput。
 */
function makeInput(overrides: Partial<IntelligenceStateInput> = {}): IntelligenceStateInput {
  return {
    predictions: overrides.predictions ?? [],
    resolutions: overrides.resolutions ?? [],
    profiles: overrides.profiles ?? [],
    failureStats: overrides.failureStats ?? [],
    currentContext: overrides.currentContext ?? BASE_CONTEXT,
    currentTick: overrides.currentTick ?? BASE_TICK,
  };
}

/**
 * 生成 N 条同模型的 calibratable ResolutionResult。
 *
 * target/method/modelVersion 须与 makeModelKey 的参数一致，
 * modelKey = `${target}-${method}-${modelVersion}`。
 */
function makeResolutionsForModel(
  target: Prediction["target"],
  method: Prediction["method"],
  modelVersion: number,
  predictionIdBase: string,
  count: number,
  signature: string,
  startTick: number = BASE_TICK,
): { predictions: Prediction[]; resolutions: ResolutionResult[] } {
  const predictions: Prediction[] = [];
  const resolutions: ResolutionResult[] = [];

  for (let i = 0; i < count; i++) {
    const pid = `${predictionIdBase}-${i}`;
    const pred = makePrediction({
      id: pid,
      target,
      method,
      modelVersion,
      status: "fulfilled",
      window: { startTick: startTick - 2000, endTick: startTick - 1000, duration: 1000 },
      generatedAt: startTick - 2000,
    });
    predictions.push(pred);

    resolutions.push(makeResolution({
      predictionId: pid,
      resolvedTick: startTick - 1000 + i,
      resolutionContextSignature: signature,
      resolution: i % 5 === 0 ? "INCORRECT" : "CORRECT",
      resolutionHash: `hash-${target}-${method}-${modelVersion}-${i}`,
    }));
  }

  return { predictions, resolutions };
}

// ═══════════════════════════════════════════════════════════
// CF-1: Regime Profile 存在且充足
// ═══════════════════════════════════════════════════════════

describe("CF-1: Regime Profile 存在且充足", () => {
  it("当 Regime 样本 >= MIN_SAMPLES_FOR_REGIME_PROFILE 时 regimeMatched=true, profileSource=REGIME", () => {
    const sig = buildPredictionContextSignature(BASE_CONTEXT);
    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-cf1",
      MIN_SAMPLES_FOR_REGIME_PROFILE,
      sig,
    );

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      calibratableCount: MIN_SAMPLES_FOR_REGIME_PROFILE,
    });

    const state = computeIntelligenceState(makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    }));

    expect(state.regimeFit.currentRegimeMatched).toBe(true);
    const fit = state.regimeFit.modelRegimeFit[0]!;
    expect(fit.profileSource).toBe("REGIME");
    expect(fit.regimeMatched).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-2: Regime Profile 不存在 → Fallback
// ═══════════════════════════════════════════════════════════

describe("CF-2: Regime Profile 不存在 → Fallback", () => {
  it("当 Regime 样本不足但全局充足时 profileSource=FALLBACK_GLOBAL", () => {
    // 全局有足够样本，但 Regime 签名不匹配
    const otherContext = makePredictionContext({
      posture: "war",
      watchdogTier: "guarded",
      roomCount: 3,
      maxRcl: 7,
      threatLevel: "HIGH",
    });
    const otherSig = buildPredictionContextSignature(otherContext);

    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-cf2",
      MIN_SAMPLES_FOR_PROFILE,
      otherSig,
    );

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      calibratableCount: MIN_SAMPLES_FOR_PROFILE,
    });

    const state = computeIntelligenceState(makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    }));

    const fit = state.regimeFit.modelRegimeFit[0]!;
    expect(fit.profileSource).toBe("FALLBACK_GLOBAL");
    expect(fit.regimeMatched).toBe(false);
    expect(state.regimeFit.currentRegimeMatched).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-3: 样本不足 → INSUFFICIENT_FOR_REGIME
// ═══════════════════════════════════════════════════════════

describe("CF-3: 样本不足 → INSUFFICIENT_FOR_REGIME", () => {
  it("当 Regime 样本 > 0 但不足时 sampleSufficiency=INSUFFICIENT_FOR_REGIME", () => {
    const sig = buildPredictionContextSignature(BASE_CONTEXT);
    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-cf3",
      10, // < MIN_SAMPLES_FOR_REGIME_PROFILE but > 0
      sig,
    );

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      calibratableCount: 10,
    });

    const state = computeIntelligenceState(makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    }));

    const m = state.modelReliability[0]!;
    expect(m.regimeSampleCount).toBe(10);
    expect(m.sampleSufficiency).toBe("INSUFFICIENT_FOR_REGIME");
  });

  it("当无任何样本时 sampleSufficiency=INSUFFICIENT_DATA", () => {
    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      calibratableCount: 0,
    });

    const state = computeIntelligenceState(makeInput({
      profiles: [profile],
    }));

    const m = state.modelReliability[0]!;
    expect(m.sampleSufficiency).toBe("INSUFFICIENT_DATA");
    expect(m.profileSource).toBe("NONE");
  });
});

// ═══════════════════════════════════════════════════════════
// CF-4: Drift DEGRADING 检测
// ═══════════════════════════════════════════════════════════

describe("CF-4: Drift DEGRADING 检测", () => {
  it("当 recentEce > overallEce × 1.5 时 driftDirection=DEGRADING", () => {
    const sig = buildPredictionContextSignature(BASE_CONTEXT);
    // 生成 100 条 resolutions，大部分 CORRECT → overall ECE 低
    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-cf4",
      100,
      sig,
    );

    // 但最近 30 条大部分 INCORRECT → recent ECE 高
    for (let i = 70; i < 100; i++) {
      resolutions[i] = makeResolution({
        predictionId: `P-cf4-${i}`,
        resolvedTick: BASE_TICK + i,
        resolutionContextSignature: sig,
        resolution: "INCORRECT",
        resolutionHash: `hash-cf4-${i}`,
      });
    }

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      ece: 0.05, // 低 overall ECE
      calibratableCount: 100,
    });

    const state = computeIntelligenceState(makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    }));

    const m = state.modelReliability[0]!;
    expect(m.driftDetected).toBe(true);
    expect(m.driftDirection).toBe("DEGRADING");
    expect(m.recentEce).not.toBeNull();
    expect(m.recentEce!).toBeGreaterThan(m.overallEce);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-5: Drift IMPROVING 检测
// ═══════════════════════════════════════════════════════════

describe("CF-5: Drift IMPROVING 检测", () => {
  it("当 recentEce < overallEce × 0.5 时 driftDirection=IMPROVING", () => {
    const sig = buildPredictionContextSignature(BASE_CONTEXT);
    // 生成 200 条 resolutions：前 100 条 INCORRECT，后 100 条 CORRECT。
    // 所有 prediction confidence=1.0：
    //   CORRECT → calibrationError = |1.0 - 1.0| = 0 → recentEce = 0
    //   INCORRECT → calibrationError = |1.0 - 0.0| = 1.0
    // Rolling Window (100) = 后 100 条全 CORRECT → recentEce = 0
    // overallEce = 0.5 → ratio = 0 / 0.5 = 0 < 0.5 → IMPROVING
    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-cf5",
      200,
      sig,
    );

    // 设 confidence = 1.0
    for (const p of predictions) {
      (p as { confidence: number }).confidence = 1.0;
    }

    // 前 100 条 INCORRECT
    for (let i = 0; i < 100; i++) {
      resolutions[i] = makeResolution({
        predictionId: `P-cf5-${i}`,
        resolvedTick: BASE_TICK + i,
        resolutionContextSignature: sig,
        resolution: "INCORRECT",
        resolutionHash: `hash-cf5-${i}`,
      });
    }

    // 后 100 条 CORRECT（recent window = 最后 100 条 → 全 CORRECT → recentEce=0）
    for (let i = 100; i < 200; i++) {
      resolutions[i] = makeResolution({
        predictionId: `P-cf5-${i}`,
        resolvedTick: BASE_TICK + i,
        resolutionContextSignature: sig,
        resolution: "CORRECT",
        resolutionHash: `hash-cf5-${i}`,
      });
    }

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      ece: 0.5, // 高 overall ECE
      calibratableCount: 200,
    });

    const state = computeIntelligenceState(makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    }));

    const m = state.modelReliability[0]!;
    expect(m.driftDetected).toBe(true);
    expect(m.driftDirection).toBe("IMPROVING");
    expect(m.recentEce!).toBeLessThan(m.overallEce);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-6: 样本不足 → drift 不检测
// ═══════════════════════════════════════════════════════════

describe("CF-6: 样本不足 → drift 不检测", () => {
  it("当 calibratable resolutions < 30 时 drift 不检测", () => {
    const sig = buildPredictionContextSignature(BASE_CONTEXT);
    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-cf6",
      10, // < ROLLING_WINDOW_MIN_CALIBRATABLE (30)
      sig,
    );

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      ece: 0.3,
      calibratableCount: 10,
    });

    const state = computeIntelligenceState(makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    }));

    const m = state.modelReliability[0]!;
    expect(m.driftDetected).toBe(false);
    expect(m.driftDirection).toBe("UNKNOWN");
    expect(m.recentEce).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// CF-7: 逻辑冲突（互斥预测对）
// ═══════════════════════════════════════════════════════════

describe("CF-7: 逻辑冲突", () => {
  it("energy-shortage + expansion-readiness 都 active 且高置信度 → 1 条 logical conflict", () => {
    const predA = makePrediction({
      id: "P-cf7-a",
      target: "energy-shortage",
      confidence: 0.8,
    });
    const predB = makePrediction({
      id: "P-cf7-b",
      target: "expansion-readiness",
      confidence: 0.8,
    });

    const state = computeIntelligenceState(makeInput({
      predictions: [predA, predB],
    }));

    const logical = state.predictionConflicts.filter(c => c.type === "logical");
    expect(logical.length).toBe(1);
    expect(logical[0]!.severity).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-8: 因果链（不误报冲突）
// ═══════════════════════════════════════════════════════════

describe("CF-8: 因果链（不误报冲突）", () => {
  it("无互斥关系的预测不产生冲突", () => {
    const predA = makePrediction({
      id: "P-cf8-a",
      target: "energy-shortage",
      confidence: 0.8,
    });
    const predB = makePrediction({
      id: "P-cf8-b",
      target: "spawn-starvation",
      confidence: 0.8,
    });

    const state = computeIntelligenceState(makeInput({
      predictions: [predA, predB],
    }));

    expect(state.predictionConflicts.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-9: Temporal 不一致
// ═══════════════════════════════════════════════════════════

describe("CF-9: Temporal 不一致", () => {
  it("同一 target 两条 active 预测 value 差异 > 30% → temporal conflict", () => {
    const predA = makePrediction({
      id: "P-cf9-a",
      target: "energy-shortage",
      value: 0.9,
      confidence: 0.7,
    });
    const predB = makePrediction({
      id: "P-cf9-b",
      target: "energy-shortage",
      value: 0.1,
      confidence: 0.7,
    });

    const state = computeIntelligenceState(makeInput({
      predictions: [predA, predB],
    }));

    const temporal = state.predictionConflicts.filter(c => c.type === "temporal");
    expect(temporal.length).toBe(1);
    expect(temporal[0]!.severity).toBeGreaterThan(0.3);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-10: Regime 冲突
// ═══════════════════════════════════════════════════════════

describe("CF-10: Regime 冲突", () => {
  it("预测的 context 与当前 context 不兼容 → regime conflict", () => {
    const warContext = makePredictionContext({
      posture: "war",
      watchdogTier: "recovery",
      roomCount: 1,
      maxRcl: 3,
      threatLevel: "HIGH",
    });
    const warSig = buildPredictionContextSignature(warContext);

    const pred = makePrediction({
      id: "P-cf10",
      target: "energy-shortage",
      confidence: 0.7,
      context: warContext,
      contextSignature: warSig,
    });

    const state = computeIntelligenceState(makeInput({
      predictions: [pred],
    }));

    const regime = state.predictionConflicts.filter(c => c.type === "regime");
    expect(regime.length).toBe(1);
    expect(regime[0]!.severity).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-11: 全面恶化
// ═══════════════════════════════════════════════════════════

describe("CF-11: 全面恶化", () => {
  it("多维度恶化时 uncertainty 正确标注", () => {
    const sig = buildPredictionContextSignature(BASE_CONTEXT);
    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-cf11",
      5, // 不足
      sig,
    );

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      ece: 0.5,
      calibratableCount: 5,
    });

    const state = computeIntelligenceState(makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    }));

    expect(state.uncertainty.sources.length).toBeGreaterThan(0);
    expect(state.uncertainty.dominantSource).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// CF-12: 冷启动
// ═══════════════════════════════════════════════════════════

describe("CF-12: 冷启动", () => {
  it("无任何数据时 calibrationHealth=COLD_START, dataSufficiency.sufficient=false", () => {
    const state = computeIntelligenceState(makeInput());

    expect(state.calibrationHealth.status).toBe("COLD_START");
    expect(state.dataSufficiency.sufficient).toBe(false);
    expect(state.dataSufficiency.totalResolutions).toBe(0);
    expect(state.dataSufficiency.modelsWithSufficientData).toBe(0);
    expect(state.knowledgeFreshness.overallFreshness).toBe("COLD_START");
    expect(state.predictionCoverage.implementedModels).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-13: 部分数据
// ═══════════════════════════════════════════════════════════

describe("CF-13: 部分数据", () => {
  it("部分模型有数据但不足时 modelsWithSufficientData=0", () => {
    const sig = buildPredictionContextSignature(BASE_CONTEXT);
    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-cf13",
      50, // < MIN_SAMPLES_FOR_PROFILE (100)
      sig,
    );

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      calibratableCount: 50,
    });

    const state = computeIntelligenceState(makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    }));

    expect(state.dataSufficiency.sufficient).toBe(false);
    expect(state.dataSufficiency.modelsWithSufficientData).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-14: Profile Aging
// ═══════════════════════════════════════════════════════════

describe("CF-14: Profile Aging", () => {
  it("Profile statisticsTick 距当前 tick > 15000 时 profileStale=true", () => {
    const staleProfile = makeProfile({
      statisticsTick: BASE_TICK - 20000, // 20000 ticks ago
    });

    const state = computeIntelligenceState(makeInput({
      profiles: [staleProfile],
      currentTick: BASE_TICK,
    }));

    expect(state.calibrationHealth.profileStale).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// CF-15: 守卫违规检测
// ═══════════════════════════════════════════════════════════

describe("CF-15: 守卫违规检测", () => {
  it("REL-012: IntelligenceState 不含 reliabilityScore", () => {
    const state = computeIntelligenceState(makeInput());
    const result = guardRelNoReliabilityScore(state);
    expect(result.passed).toBe(true);
  });

  it("REL-010: IntelligenceState 有 stateHash 和 traceable hashes", () => {
    const sig = buildPredictionContextSignature(BASE_CONTEXT);
    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-cf15",
      MIN_SAMPLES_FOR_REGIME_PROFILE,
      sig,
    );

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      calibratableCount: MIN_SAMPLES_FOR_REGIME_PROFILE,
    });

    const state = computeIntelligenceState(makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    }));

    const result = guardRelEvidenceTraceability(state);
    expect(result.passed).toBe(true);
  });

  it("REL-005: 100× replay stateHash 一致", () => {
    const sig = buildPredictionContextSignature(BASE_CONTEXT);
    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-cf15-det",
      50,
      sig,
    );

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      calibratableCount: 50,
    });

    const input = makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    });

    const firstState = computeIntelligenceState(input);
    const result = guardRelDeterminism(() => computeIntelligenceState(input).stateHash, 100);
    expect(result.passed).toBe(true);
    expect(firstState.stateHash.length).toBeGreaterThan(0);
  });

  it("REL-001: intelligence-state-system 不写入 globalCache", () => {
    const result = guardRelReadOnly(intelligenceStateSystem);
    expect(result.passed).toBe(true);
  });

  it("REL-009: intelligence-state-system 不修改 Strategy", () => {
    const result = guardRelNoStrategyMutation(intelligenceStateSystem);
    expect(result.passed).toBe(true);
  });

  it("REL-007: intelligence-state-system 不新建采样通道", () => {
    const result = guardRelNoNewSampler(intelligenceStateSystem);
    expect(result.passed).toBe(true);
  });

  it("REL-011: intelligence-state-system 不解决冲突", () => {
    const result = guardRelNoConflictResolution(intelligenceStateSystem);
    expect(result.passed).toBe(true);
  });

  it("validateIntelligenceSystem: 全量系统守卫通过", () => {
    const violations = validateIntelligenceSystem(intelligenceStateSystem);
    expect(violations.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// D2: 确定性回放
// ═══════════════════════════════════════════════════════════

describe("D2: 确定性回放", () => {
  it("100× replay → 100% 相同 stateHash", () => {
    const sig = buildPredictionContextSignature(BASE_CONTEXT);
    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-d2",
      50,
      sig,
    );

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      calibratableCount: 50,
    });

    const input = makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    });

    const firstHash = computeIntelligenceState(input).stateHash;
    for (let i = 0; i < 100; i++) {
      const h = computeIntelligenceState(input).stateHash;
      expect(h).toBe(firstHash);
    }
  });

  it("PredictionConflict 顺序一致", () => {
    const predA = makePrediction({ id: "P-d2-a", target: "energy-shortage", confidence: 0.8 });
    const predB = makePrediction({ id: "P-d2-b", target: "expansion-readiness", confidence: 0.8 });

    const input = makeInput({ predictions: [predA, predB] });

    const first = computeIntelligenceState(input);
    for (let i = 0; i < 50; i++) {
      const s = computeIntelligenceState(input);
      expect(s.predictionConflicts.length).toBe(first.predictionConflicts.length);
      if (first.predictionConflicts.length > 0 && s.predictionConflicts.length > 0) {
        expect(s.predictionConflicts[0]!.conflictHash).toBe(first.predictionConflicts[0]!.conflictHash);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════
// D4: 有界性
// ═══════════════════════════════════════════════════════════

describe("D4: 有界性", () => {
  it("IntelligenceState JSON.stringify 大小 <= 2048 bytes", () => {
    const sig = buildPredictionContextSignature(BASE_CONTEXT);
    const { predictions, resolutions } = makeResolutionsForModel(
      "energy-shortage",
      "trend-extrapolation",
      1,
      "P-d4",
      50,
      sig,
    );

    const profile = makeProfile({
      modelKey: "energy-shortage-trend-extrapolation-1",
      calibratableCount: 50,
    });

    const state = computeIntelligenceState(makeInput({
      predictions,
      resolutions,
      profiles: [profile],
    }));

    const size = JSON.stringify(state).length;
    expect(size).toBeLessThanOrEqual(2048);
  });

  it("modelReliability.length <= 10", () => {
    const state = computeIntelligenceState(makeInput());
    expect(state.modelReliability.length).toBeLessThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════
// D6: 退化防护
// ═══════════════════════════════════════════════════════════

describe("D6: 退化防护", () => {
  it("IntelligenceState 不含 reliabilityScore 字段", () => {
    const state = computeIntelligenceState(makeInput());
    const json = JSON.stringify(state);
    expect(json).not.toContain("reliabilityScore");
  });

  it("IntelligenceState 不含 intelligenceScore 字段", () => {
    const state = computeIntelligenceState(makeInput());
    const json = JSON.stringify(state);
    expect(json).not.toContain("intelligenceScore");
  });

  it("IntelligenceState 不含 overallScore 字段", () => {
    const state = computeIntelligenceState(makeInput());
    const json = JSON.stringify(state);
    expect(json).not.toContain("overallScore");
  });
});
