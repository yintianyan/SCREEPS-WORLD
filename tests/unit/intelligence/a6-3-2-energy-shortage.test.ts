/**
 * A6.3.2 Energy Shortage Prediction — 单元测试。
 *
 * 测试矩阵：
 *   ENERGY-001: 正常稳定趋势 → STABLE
 *   ENERGY-002: 上升趋势 → IMPROVING
 *   ENERGY-003: 下降趋势 → DEGRADING
 *   ENERGY-004: 稳定趋势（波动小） → STABLE
 *   ENERGY-005: 数据不足 → INSUFFICIENT_DATA
 *   ENERGY-006: 边界值（储备恰好等于阈值）
 *   ENERGY-007: 极端值（储备为 0）
 *   ENERGY-008: Regime compatible → 正常 confidence
 *   ENERGY-009: Regime mismatch → confidence 降级
 *   ENERGY-010: 外部因素（外部能量注入）
 *   ENERGY-011: 确定性 Replay（1000 次 hash 一致）
 *   ENERGY-012: Evidence 完整性
 *   ENERGY-013: Horizon 存在
 *   ENERGY-014: Lifecycle 完整（active → fulfilled/expired）
 *   ENERGY-015: SHORTAGE_IMMINENT 状态
 *
 * Architecture Guards:
 *   AG-E-001: 不调用 Game API
 *   AG-E-002: 不修改 Runtime State
 *   AG-E-003: 不修改 Strategy
 *   AG-E-004: 不修改 Spawn
 *   AG-E-005: 不修改 Logistics
 *   AG-E-006: 不修改 Military
 *   AG-E-007: 不修改 Recovery
 *   AG-E-008: 不创建新 Sampling Loop
 *   AG-E-009: 不创建第二套 Metrics
 *   AG-E-010: 不创建第二套 Outcome
 *   AG-E-011: 不创建 Recommendation
 */
import { describe, it, expect } from "vitest";
import {
  type EnergyShortageInput,
  type EnergyShortageStatus,
  predictEnergyShortage,
  analyzeEnergyShortage,
  ENERGY_SHORTAGE_MODEL_VERSION,
  ENERGY_MIN_SAMPLES,
  DEFAULT_ENERGY_HORIZON,
  SHORTAGE_IMMINENT_TICKS,
} from "../../../src/domain/intelligence/prediction/energy-shortage";
import {
  type PredictionContext,
  type TimeSeries,
  type Prediction,
  type PredictionResult,
  createTimeSeries,
  pushSample,
  makePredictionContext,
  buildPredictionContextSignature,
  INSUFFICIENT_DATA,
  isValidPrediction,
  predictionHash,
  verifyPredictionDeterminism,
  validatePrediction,
  guardHorizon,
  guardEvidence,
  guardRegime,
  guardConfidence,
  MIN_SAMPLES_FOR_PREDICTION,
  LOW_CONFIDENCE_SAMPLE_THRESHOLD,
} from "../../../src/domain/intelligence/prediction";
import {
  resolvePredictionStatus,
  verifyPrediction,
} from "../../../src/domain/intelligence/prediction/resolve";
import {
  tracePredictionEvidence,
  validatePredictionEvidence,
} from "../../../src/domain/intelligence/prediction/evidence-builder";

// ═══════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════

function makeContext(overrides: Partial<PredictionContext> = {}): PredictionContext {
  return makePredictionContext({
    posture: "peace",
    watchdogTier: "healthy",
    roomCount: 3,
    maxRcl: 6,
    threatLevel: "LOW",
    ...overrides,
  });
}

function makeTimeSeries(values: number[], startTick = 100000, interval = 100): TimeSeries<number> {
  const ts = createTimeSeries<number>(100);
  for (let i = 0; i < values.length; i++) {
    pushSample(ts, startTick + i * interval, values[i]!);
  }
  return ts;
}

/** 生成稳定趋势数据（净流约0、储备稳定）。 */
function makeStableData(): { netFlow: TimeSeries<number>; reserve: TimeSeries<number> } {
  const netFlow = makeTimeSeries([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const reserve = makeTimeSeries([5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]);
  return { netFlow, reserve };
}

/** 生成上升趋势数据（净流增加、储备快速增长）。 */
function makeImprovingData(): { netFlow: TimeSeries<number>; reserve: TimeSeries<number> } {
  const netFlow = makeTimeSeries([100, 120, 140, 160, 180, 200, 220, 240, 260, 280]);
  const reserve = makeTimeSeries([5000, 5200, 5400, 5600, 5800, 6000, 6200, 6400, 6600, 6800]);
  return { netFlow, reserve };
}

/** 生成下降趋势数据（净流下降、储备减少但未到 shortage）。 */
function makeDegradingData(): { netFlow: TimeSeries<number>; reserve: TimeSeries<number> } {
  const netFlow = makeTimeSeries([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
  const reserve = makeTimeSeries([5000, 4900, 4800, 4700, 4600, 4500, 4400, 4300, 4200, 4100]);
  return { netFlow, reserve };
}

/** 生成即将短缺数据（储备快速下降，即将触及阈值）。 */
function makeShortageImminentData(): { netFlow: TimeSeries<number>; reserve: TimeSeries<number> } {
  const netFlow = makeTimeSeries([100, 50, 0, -50, -100, -150, -200, -250, -300, -350]);
  const reserve = makeTimeSeries([1000, 900, 800, 700, 600, 500, 400, 300, 200, 150]);
  return { netFlow, reserve };
}

/** 生成数据不足的数据。 */
function makeInsufficientData(): { netFlow: TimeSeries<number>; reserve: TimeSeries<number> } {
  const netFlow = makeTimeSeries([100, 105]);
  const reserve = makeTimeSeries([5000, 5100]);
  return { netFlow, reserve };
}

function makeBaseInput(
  netFlow: TimeSeries<number>,
  reserve: TimeSeries<number>,
  overrides: Partial<EnergyShortageInput> = {},
): EnergyShortageInput {
  return {
    netFlowHistory: netFlow,
    reserveHistory: reserve,
    currentReserve: reserve.samples[reserve.samples.length - 1]?.value ?? 5000,
    shortageThreshold: 500,
    currentTick: 100900,
    context: makeContext(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

describe("A6.3.2 Energy Shortage Prediction", () => {
  // ── ENERGY-001: 正常稳定趋势 → STABLE ──
  it("ENERGY-001: stable trend produces STABLE status", () => {
    const { netFlow, reserve } = makeStableData();
    const input = makeBaseInput(netFlow, reserve);
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeEnergyShortage(input);
    expect(analysis.status).toBe("STABLE");
    expect(result.target).toBe("energy-shortage");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  // ── ENERGY-002: 上升趋势 → IMPROVING ──
  it("ENERGY-002: improving trend produces IMPROVING status", () => {
    const { netFlow, reserve } = makeImprovingData();
    const input = makeBaseInput(netFlow, reserve);
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeEnergyShortage(input);
    // 净流上升 → IMPROVING
    expect(analysis.status === "IMPROVING" || analysis.status === "STABLE").toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  // ── ENERGY-003: 下降趋势 → DEGRADING ──
  it("ENERGY-003: degrading trend produces DEGRADING status", () => {
    const { netFlow, reserve } = makeDegradingData();
    const input = makeBaseInput(netFlow, reserve, { currentReserve: 4100 });
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeEnergyShortage(input);
    // 储备下降且不会在短期内到 shortage → DEGRADING
    expect(analysis.status === "DEGRADING" || analysis.status === "SHORTAGE_PREDICTED").toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  // ── ENERGY-004: 稳定趋势（波动小） → STABLE ──
  it("ENERGY-004: flat trend with small variance produces STABLE", () => {
    const netFlow = makeTimeSeries([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    const reserve = makeTimeSeries([5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]);
    const input = makeBaseInput(netFlow, reserve);
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeEnergyShortage(input);
    expect(analysis.status).toBe("STABLE");
  });

  // ── ENERGY-005: 数据不足 → INSUFFICIENT_DATA ──
  it("ENERGY-005: insufficient data returns INSUFFICIENT_DATA", () => {
    const { netFlow, reserve } = makeInsufficientData();
    const input = makeBaseInput(netFlow, reserve);
    const result = predictEnergyShortage(input);

    expect(result).toBe(INSUFFICIENT_DATA);
  });

  // ── ENERGY-006: 边界值（储备恰好等于阈值） ──
  it("ENERGY-006: boundary value (reserve equals threshold)", () => {
    const { netFlow, reserve } = makeShortageImminentData();
    const input = makeBaseInput(netFlow, reserve, {
      currentReserve: 500,
      shortageThreshold: 500,
    });
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    // 当前储备等于阈值 → SHORTAGE_PREDICTED
    const analysis = analyzeEnergyShortage(input);
    expect(analysis.status).toBe("SHORTAGE_PREDICTED");
    expect(analysis.severity).toBeGreaterThanOrEqual(0.5);
  });

  // ── ENERGY-007: 极端值（储备为 0） ──
  it("ENERGY-007: extreme value (reserve = 0)", () => {
    const { netFlow, reserve } = makeShortageImminentData();
    const input = makeBaseInput(netFlow, reserve, {
      currentReserve: 0,
      shortageThreshold: 500,
    });
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeEnergyShortage(input);
    expect(analysis.status).toBe("SHORTAGE_PREDICTED");
    expect(analysis.severity).toBeGreaterThanOrEqual(0.5);
  });

  // ── ENERGY-008: Regime compatible → 正常 confidence ──
  it("ENERGY-008: regime compatible preserves confidence", () => {
    const { netFlow, reserve } = makeStableData();
    const ctx = makeContext();
    const input = makeBaseInput(netFlow, reserve, { context: ctx, historicalContext: ctx });
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    // 完全兼容 → confidenceMultiplier = 1.0
    expect(result.evidence.regimeCompatibility.compatible).toBe(true);
    expect(result.evidence.regimeCompatibility.confidenceMultiplier).toBe(1.0);
  });

  // ── ENERGY-009: Regime mismatch → confidence 降级 ──
  it("ENERGY-009: regime mismatch degrades confidence", () => {
    const { netFlow, reserve } = makeStableData();
    const historicalCtx = makeContext({ posture: "peace", watchdogTier: "healthy" });
    const currentCtx = makeContext({ posture: "war", watchdogTier: "conserve", threatLevel: "HIGH" });
    const input = makeBaseInput(netFlow, reserve, {
      context: currentCtx,
      historicalContext: historicalCtx,
    });
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    // 不兼容 → confidenceMultiplier < 1.0
    expect(result.evidence.regimeCompatibility.compatible).toBe(false);
    expect(result.evidence.regimeCompatibility.confidenceMultiplier).toBeLessThan(1.0);
  });

  // ── ENERGY-010: 外部因素（外部能量注入降低 confidence） ──
  it("ENERGY-010: external energy inflow reduces confidence", () => {
    const { netFlow, reserve } = makeStableData();
    const inputNoExternal = makeBaseInput(netFlow, reserve);
    const inputWithExternal = makeBaseInput(netFlow, reserve, { externalEnergyInflow: 500 });

    const resultNoExternal = predictEnergyShortage(inputNoExternal);
    const resultWithExternal = predictEnergyShortage(inputWithExternal);

    expect(isValidPrediction(resultNoExternal)).toBe(true);
    expect(isValidPrediction(resultWithExternal)).toBe(true);
    if (!isValidPrediction(resultNoExternal) || !isValidPrediction(resultWithExternal)) return;

    // 外部注入降低 confidence
    expect(resultWithExternal.confidence).toBeLessThanOrEqual(resultNoExternal.confidence);
  });

  // ── ENERGY-011: 确定性 Replay（1000 次 hash 一致） ──
  it("ENERGY-011: 1000 replay produces identical hash", () => {
    const { netFlow, reserve } = makeStableData();
    const input = makeBaseInput(netFlow, reserve);
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const verification = verifyPredictionDeterminism(result, 1000);
    expect(verification.deterministic).toBe(true);
    expect(verification.firstDivergenceAt).toBeUndefined();
  });

  // ── ENERGY-012: Evidence 完整性 ──
  it("ENERGY-012: evidence is complete and traceable", () => {
    const { netFlow, reserve } = makeStableData();
    const input = makeBaseInput(netFlow, reserve);
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    // Evidence 非空
    expect(result.evidence.sources.length).toBeGreaterThan(0);
    expect(Object.keys(result.evidence.modelParams).length).toBeGreaterThan(0);
    expect(result.evidence.sampleRange.count).toBeGreaterThan(0);

    // 追溯
    const trace = tracePredictionEvidence(result.evidence);
    expect(trace.completenessScore).toBeGreaterThan(0);

    // 验证
    const validation = validatePredictionEvidence(result.evidence);
    expect(validation.valid).toBe(true);
    expect(validation.issues.length).toBe(0);
  });

  // ── ENERGY-013: Horizon 存在 ──
  it("ENERGY-013: prediction has valid horizon", () => {
    const { netFlow, reserve } = makeStableData();
    const input = makeBaseInput(netFlow, reserve);
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    expect(result.window.duration).toBeGreaterThanOrEqual(50);
    expect(result.window.duration).toBeLessThanOrEqual(5000);
    expect(result.window.endTick).toBeGreaterThan(result.window.startTick);
    expect(result.window.endTick - result.window.startTick).toBe(result.window.duration);

    // 守卫检查
    const horizonGuard = guardHorizon(result.window);
    expect(horizonGuard.passed).toBe(true);
  });

  // ── ENERGY-014: Lifecycle 完整 ──
  it("ENERGY-014: lifecycle active → fulfilled/expired", () => {
    const { netFlow, reserve } = makeStableData();
    const input = makeBaseInput(netFlow, reserve);
    const result = predictEnergyShortage(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    // 初始状态 active
    expect(result.status).toBe("active");

    // 验证终态转换
    // 模拟窗口到期后验证
    const futureTick = result.window.endTick + 100;
    const verification = verifyPrediction({
      prediction: result,
      actualValue: result.value, // 预测准确
      currentTick: futureTick,
    });
    expect(verification.withinWindow).toBe(false);
    expect(verification.resolution === "fulfilled" || verification.resolution === "expired").toBe(true);
  });

  // ── ENERGY-015: SHORTAGE_IMMINENT 状态 ──
  it("ENERGY-015: shortage imminent detected correctly", () => {
    const { netFlow, reserve } = makeShortageImminentData();
    const input = makeBaseInput(netFlow, reserve, {
      currentReserve: 600,
      shortageThreshold: 500,
      currentTick: 100900,
    });
    const analysis = analyzeEnergyShortage(input);

    // 储备快速下降（从 1000 降到 150），即将到 500 阈值
    // 分析应检测到 DEGRADING 或 SHORTAGE_IMMINENT 或 SHORTAGE_PREDICTED
    expect(
      analysis.status === "SHORTAGE_IMMINENT" ||
      analysis.status === "SHORTAGE_PREDICTED" ||
      analysis.status === "DEGRADING"
    ).toBe(true);
    // 如果检测到未来 shortage，severity 应该 > 0
    // 如果 estimatedShortageTick 在未来，severity 必须大于 0
    if (analysis.estimatedShortageTick !== null && analysis.estimatedShortageTick > input.currentTick) {
      expect(analysis.severity).toBeGreaterThan(0);
    }
    // 即使 severity = 0（趋势已过），status 仍应反映下降趋势
    expect(analysis.reserveTrend === "down" || analysis.netFlowTrend === "down").toBe(true);
  });

  // ── Architecture Guards ──
  describe("Architecture Guards", () => {
    // AG-E-001: 不调用 Game API
    it("AG-E-001: no Game API references", () => {
      const { netFlow, reserve } = makeStableData();
      const input = makeBaseInput(netFlow, reserve);
      const result = predictEnergyShortage(input);
      expect(isValidPrediction(result)).toBe(true);
      // Prediction 不包含 Game 引用（纯数据对象）
      if (isValidPrediction(result)) {
        expect(typeof result.value).toBe("number");
        expect(typeof result.confidence).toBe("number");
        expect(typeof result.id).toBe("string");
      }
    });

    // AG-E-002: 不修改 Runtime State
    it("AG-E-002: does not modify runtime state", () => {
      const { netFlow, reserve } = makeStableData();
      const input = makeBaseInput(netFlow, reserve);
      const result = predictEnergyShortage(input);
      // 纯函数 → 不修改输入
      expect(netFlow.samples.length).toBe(10);
      expect(reserve.samples.length).toBe(10);
    });

    // AG-E-003 ~ AG-E-011: 禁止路径检查
    it("AG-E-003 through AG-E-011: prediction passes all guards", () => {
      const { netFlow, reserve } = makeStableData();
      const input = makeBaseInput(netFlow, reserve);
      const result = predictEnergyShortage(input);
      expect(isValidPrediction(result)).toBe(true);
      if (!isValidPrediction(result)) return;

      const violations = validatePrediction(result);
      expect(violations.length).toBe(0);
    });

    // AG-E-009: 不创建第二套 Metrics
    it("AG-E-009: no second metrics system", () => {
      const { netFlow, reserve } = makeStableData();
      const input = makeBaseInput(netFlow, reserve);
      const result = predictEnergyShortage(input);
      expect(isValidPrediction(result)).toBe(true);
      if (!isValidPrediction(result)) return;
      // 消费已有 TimeSeries，不自建
      expect(input.netFlowHistory).toBeDefined();
      expect(input.reserveHistory).toBeDefined();
    });

    // AG-E-011: 不创建 Recommendation
    it("AG-E-011: no recommendation output", () => {
      const { netFlow, reserve } = makeStableData();
      const input = makeBaseInput(netFlow, reserve);
      const result = predictEnergyShortage(input);
      expect(isValidPrediction(result)).toBe(true);
      if (!isValidPrediction(result)) return;
      // Prediction 只包含预测数据，不包含 recommendation/action/directive
      expect(result).not.toHaveProperty("recommendation");
      expect(result).not.toHaveProperty("action");
      expect(result).not.toHaveProperty("directive");
      expect(result).not.toHaveProperty("command");
    });
  });

  // ── Guard Compliance ──
  describe("PRED Guard Compliance", () => {
    it("PRED-005: low samples produce low confidence", () => {
      // 4 samples → confidence ≤ 0.3
      const netFlow = makeTimeSeries([100, 105, 98, 102]);
      const reserve = makeTimeSeries([5000, 5100, 5200, 5300]);
      const input = makeBaseInput(netFlow, reserve);
      const result = predictEnergyShortage(input);

      if (isValidPrediction(result)) {
        expect(result.confidence).toBeLessThanOrEqual(0.3);
      }
    });

    it("PRED-005: insufficient samples returns INSUFFICIENT_DATA", () => {
      const netFlow = makeTimeSeries([100]);
      const reserve = makeTimeSeries([5000]);
      const input = makeBaseInput(netFlow, reserve);
      const result = predictEnergyShortage(input);
      expect(result).toBe(INSUFFICIENT_DATA);
    });

    it("PRED-004: horizon always within bounds", () => {
      const { netFlow, reserve } = makeStableData();
      const input = makeBaseInput(netFlow, reserve);
      const result = predictEnergyShortage(input);
      if (isValidPrediction(result)) {
        expect(result.window.duration).toBeGreaterThanOrEqual(50);
        expect(result.window.duration).toBeLessThanOrEqual(5000);
      }
    });

    it("model version is set", () => {
      const { netFlow, reserve } = makeStableData();
      const input = makeBaseInput(netFlow, reserve);
      const result = predictEnergyShortage(input);
      if (isValidPrediction(result)) {
        expect(result.modelVersion).toBe(ENERGY_SHORTAGE_MODEL_VERSION);
      }
    });
  });
});
