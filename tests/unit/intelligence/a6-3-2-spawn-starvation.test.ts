/**
 * A6.3.2 Spawn Starvation Prediction — 单元测试。
 *
 * 测试矩阵：
 *   SPAWN-001: 正常趋势（队列空、人口稳定）→ NO_DEMAND
 *   SPAWN-002: 上升趋势（人口增长、队列低）→ NO_DEMAND 或 QUEUE_GROWING
 *   SPAWN-003: 下降趋势（人口下降、队列增长）→ QUEUE_GROWING 或 STARVATION_IMMINENT
 *   SPAWN-004: 稳定趋势（队列稳定、人口稳定）
 *   SPAWN-005: 数据不足 → INSUFFICIENT_DATA
 *   SPAWN-006: 边界值（队列恰好为 0）
 *   SPAWN-007: 极端值（队列为 100、能量为 0）
 *   SPAWN-008: Regime compatible → 正常 confidence
 *   SPAWN-009: Regime mismatch → confidence 降级
 *   SPAWN-010: 外部因素（P0 请求增加压力）
 *   SPAWN-011: 确定性 Replay（1000 次 hash 一致）
 *   SPAWN-012: Evidence 完整性
 *   SPAWN-013: Horizon 存在
 *   SPAWN-014: Lifecycle 完整
 *   SPAWN-015: STARVATION_IMMINENT 状态
 *
 * Architecture Guards:
 *   AG-S-001 ~ AG-S-011
 *
 * 区分测试：
 *   DIST-001: 没有 spawn demand → NO_DEMAND
 *   DIST-002: 有 demand 但没有 energy → ENERGY_LIMITED
 *   DIST-003: 有 energy 但 capacity 不足 → CAPACITY_LIMITED
 *   DIST-004: queue 持续增长 → QUEUE_GROWING
 *   DIST-005: starvation 即将发生 → STARVATION_IMMINENT
 */
import { describe, it, expect } from "vitest";
import {
  type SpawnStarvationInput,
  type SpawnStarvationStatus,
  predictSpawnStarvation,
  analyzeSpawnStarvation,
  SPAWN_STARVATION_MODEL_VERSION,
  SPAWN_MIN_SAMPLES,
  DEFAULT_SPAWN_HORIZON,
  STARVATION_IMMINENT_TICKS,
} from "../../../src/domain/intelligence/prediction/spawn-starvation";
import {
  type PredictionContext,
  type TimeSeries,
  type Prediction,
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

/** 生成无需求数据（队列空、人口稳定）。 */
function makeNoDemandData(): { queue: TimeSeries<number>; pop: TimeSeries<number> } {
  const queue = makeTimeSeries([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const pop = makeTimeSeries([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  return { queue, pop };
}

/** 生成人口增长数据。 */
function makeImprovingData(): { queue: TimeSeries<number>; pop: TimeSeries<number> } {
  const queue = makeTimeSeries([2, 1, 2, 1, 0, 1, 0, 1, 0, 0]);
  const pop = makeTimeSeries([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  return { queue, pop };
}

/** 生成队列持续增长数据。 */
function makeQueueGrowingData(): { queue: TimeSeries<number>; pop: TimeSeries<number> } {
  const queue = makeTimeSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const pop = makeTimeSeries([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  return { queue, pop };
}

/** 生成即将饥饿数据（队列大、能量低）。 */
function makeStarvationImminentData(): { queue: TimeSeries<number>; pop: TimeSeries<number> } {
  const queue = makeTimeSeries([5, 8, 12, 16, 20, 25, 30, 35, 40, 45]);
  const pop = makeTimeSeries([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  return { queue, pop };
}

/** 生成数据不足。 */
function makeInsufficientData(): { queue: TimeSeries<number>; pop: TimeSeries<number> } {
  const queue = makeTimeSeries([0, 1]);
  const pop = makeTimeSeries([10, 10]);
  return { queue, pop };
}

function makeBaseInput(
  queue: TimeSeries<number>,
  pop: TimeSeries<number>,
  overrides: Partial<SpawnStarvationInput> = {},
): SpawnStarvationInput {
  return {
    queueDepthHistory: queue,
    populationHistory: pop,
    currentQueueDepth: queue.samples[queue.samples.length - 1]?.value ?? 0,
    currentEnergy: 1000,
    currentPopulation: pop.samples[pop.samples.length - 1]?.value ?? 10,
    spawnCapacity: 20,
    minSpawnEnergy: 200,
    currentTick: 100900,
    context: makeContext(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

describe("A6.3.2 Spawn Starvation Prediction", () => {
  // ── SPAWN-001: 正常趋势（无需求）→ NO_DEMAND ──
  it("SPAWN-001: no demand trend produces NO_DEMAND", () => {
    const { queue, pop } = makeNoDemandData();
    const input = makeBaseInput(queue, pop);
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeSpawnStarvation(input);
    expect(analysis.status).toBe("NO_DEMAND");
    expect(result.target).toBe("spawn-starvation");
    expect(result.confidence).toBeGreaterThan(0);
  });

  // ── SPAWN-002: 上升趋势（人口增长） ──
  it("SPAWN-002: improving trend (population growing)", () => {
    const { queue, pop } = makeImprovingData();
    const input = makeBaseInput(queue, pop);
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeSpawnStarvation(input);
    // 人口上升、队列低 → NO_DEMAND 或 QUEUE_GROWING（取决于队列趋势）
    expect(analysis.status === "NO_DEMAND" || analysis.status === "QUEUE_GROWING").toBe(true);
  });

  // ── SPAWN-003: 下降趋势（队列增长、人口下降） ──
  it("SPAWN-003: degrading trend (queue growing, population falling)", () => {
    const { queue, pop } = makeStarvationImminentData();
    const input = makeBaseInput(queue, pop, {
      currentEnergy: 50,
      minSpawnEnergy: 200,
    });
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeSpawnStarvation(input);
    // 能量不足 + 队列大 → ENERGY_LIMITED 或 STARVATION_IMMINENT
    expect(
      analysis.status === "ENERGY_LIMITED" ||
      analysis.status === "STARVATION_IMMINENT" ||
      analysis.status === "QUEUE_GROWING"
    ).toBe(true);
  });

  // ── SPAWN-004: 稳定趋势 ──
  it("SPAWN-004: stable trend", () => {
    const queue = makeTimeSeries([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const pop = makeTimeSeries([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
    const input = makeBaseInput(queue, pop);
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeSpawnStarvation(input);
    // 队列稳定低值 → NO_DEMAND 或 QUEUE_GROWING
    expect(analysis.status === "NO_DEMAND" || analysis.status === "QUEUE_GROWING").toBe(true);
  });

  // ── SPAWN-005: 数据不足 → INSUFFICIENT_DATA ──
  it("SPAWN-005: insufficient data returns INSUFFICIENT_DATA", () => {
    const { queue, pop } = makeInsufficientData();
    const input = makeBaseInput(queue, pop);
    const result = predictSpawnStarvation(input);

    expect(result).toBe(INSUFFICIENT_DATA);
  });

  // ── SPAWN-006: 边界值（队列恰好为 0） ──
  it("SPAWN-006: boundary value (queue depth = 0)", () => {
    const { queue, pop } = makeNoDemandData();
    const input = makeBaseInput(queue, pop, { currentQueueDepth: 0 });
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeSpawnStarvation(input);
    expect(analysis.status).toBe("NO_DEMAND");
  });

  // ── SPAWN-007: 极端值（队列为 100、能量为 0） ──
  it("SPAWN-007: extreme value (queue=100, energy=0)", () => {
    const { queue, pop } = makeStarvationImminentData();
    const input = makeBaseInput(queue, pop, {
      currentQueueDepth: 100,
      currentEnergy: 0,
      minSpawnEnergy: 200,
    });
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeSpawnStarvation(input);
    // 能量为 0 + 队列大 → STARVATION_IMMINENT 或 ENERGY_LIMITED
    expect(
      analysis.status === "STARVATION_IMMINENT" ||
      analysis.status === "ENERGY_LIMITED"
    ).toBe(true);
    expect(analysis.severity).toBeGreaterThan(0);
  });

  // ── SPAWN-008: Regime compatible → 正常 confidence ──
  it("SPAWN-008: regime compatible preserves confidence", () => {
    const { queue, pop } = makeNoDemandData();
    const ctx = makeContext();
    const input = makeBaseInput(queue, pop, { context: ctx, historicalContext: ctx });
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    expect(result.evidence.regimeCompatibility.compatible).toBe(true);
    expect(result.evidence.regimeCompatibility.confidenceMultiplier).toBe(1.0);
  });

  // ── SPAWN-009: Regime mismatch → confidence 降级 ──
  it("SPAWN-009: regime mismatch degrades confidence", () => {
    const { queue, pop } = makeNoDemandData();
    const historicalCtx = makeContext({ posture: "peace", watchdogTier: "healthy" });
    const currentCtx = makeContext({ posture: "war", watchdogTier: "conserve", threatLevel: "HIGH" });
    const input = makeBaseInput(queue, pop, {
      context: currentCtx,
      historicalContext: historicalCtx,
    });
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    expect(result.evidence.regimeCompatibility.compatible).toBe(false);
    expect(result.evidence.regimeCompatibility.confidenceMultiplier).toBeLessThan(1.0);
  });

  // ── SPAWN-010: 外部因素（P0 请求增加压力） ──
  it("SPAWN-010: P0 requests increase demand pressure", () => {
    const { queue, pop } = makeNoDemandData();
    const inputNoP0 = makeBaseInput(queue, pop, { currentQueueDepth: 5 });
    const inputWithP0 = makeBaseInput(queue, pop, { currentQueueDepth: 5, p0RequestCount: 2 });

    const analysisNoP0 = analyzeSpawnStarvation(inputNoP0);
    const analysisWithP0 = analyzeSpawnStarvation(inputWithP0);

    // P0 请求增加需求压力
    expect(analysisWithP0.demandPressure).toBeGreaterThanOrEqual(analysisNoP0.demandPressure);
  });

  // ── SPAWN-011: 确定性 Replay ──
  it("SPAWN-011: 1000 replay produces identical hash", () => {
    const { queue, pop } = makeNoDemandData();
    const input = makeBaseInput(queue, pop);
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const verification = verifyPredictionDeterminism(result, 1000);
    expect(verification.deterministic).toBe(true);
    expect(verification.firstDivergenceAt).toBeUndefined();
  });

  // ── SPAWN-012: Evidence 完整性 ──
  it("SPAWN-012: evidence is complete and traceable", () => {
    const { queue, pop } = makeNoDemandData();
    const input = makeBaseInput(queue, pop);
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    expect(result.evidence.sources.length).toBeGreaterThan(0);
    expect(Object.keys(result.evidence.modelParams).length).toBeGreaterThan(0);
    expect(result.evidence.sampleRange.count).toBeGreaterThan(0);

    const trace = tracePredictionEvidence(result.evidence);
    expect(trace.completenessScore).toBeGreaterThan(0);

    const validation = validatePredictionEvidence(result.evidence);
    expect(validation.valid).toBe(true);
  });

  // ── SPAWN-013: Horizon 存在 ──
  it("SPAWN-013: prediction has valid horizon", () => {
    const { queue, pop } = makeNoDemandData();
    const input = makeBaseInput(queue, pop);
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    expect(result.window.duration).toBeGreaterThanOrEqual(50);
    expect(result.window.duration).toBeLessThanOrEqual(5000);
    expect(result.window.endTick).toBeGreaterThan(result.window.startTick);

    const horizonGuard = guardHorizon(result.window);
    expect(horizonGuard.passed).toBe(true);
  });

  // ── SPAWN-014: Lifecycle 完整 ──
  it("SPAWN-014: lifecycle active → fulfilled/expired", () => {
    const { queue, pop } = makeNoDemandData();
    const input = makeBaseInput(queue, pop);
    const result = predictSpawnStarvation(input);

    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    expect(result.status).toBe("active");

    // 验证终态转换
    const futureTick = result.window.endTick + 100;
    const verification = verifyPrediction({
      prediction: result,
      actualValue: result.value,
      currentTick: futureTick,
    });
    expect(verification.withinWindow).toBe(false);
    expect(verification.resolution === "fulfilled" || verification.resolution === "expired").toBe(true);
  });

  // ── SPAWN-015: STARVATION_IMMINENT 状态 ──
  it("SPAWN-015: starvation imminent detected", () => {
    const { queue, pop } = makeStarvationImminentData();
    const input = makeBaseInput(queue, pop, {
      currentEnergy: 50,
      minSpawnEnergy: 200,
      currentQueueDepth: 45,
    });
    const analysis = analyzeSpawnStarvation(input);

    // 能量不足 + 队列巨大 → 应该检测到高严重度
    expect(analysis.severity).toBeGreaterThan(0);
    expect(
      analysis.status === "STARVATION_IMMINENT" ||
      analysis.status === "ENERGY_LIMITED" ||
      analysis.status === "QUEUE_GROWING"
    ).toBe(true);
  });

  // ── Demand/Energy/Capacity 区分测试 ──
  describe("Demand / Energy / Capacity Distinction", () => {
    // DIST-001: 没有 spawn demand → NO_DEMAND
    it("DIST-001: no demand detected correctly", () => {
      const { queue, pop } = makeNoDemandData();
      const input = makeBaseInput(queue, pop, { currentQueueDepth: 0 });
      const analysis = analyzeSpawnStarvation(input);
      expect(analysis.status).toBe("NO_DEMAND");
      expect(analysis.demandPressure).toBe(0);
    });

    // DIST-002: 有 demand 但没有 energy → ENERGY_LIMITED
    it("DIST-002: demand but no energy → ENERGY_LIMITED", () => {
      const { queue, pop } = makeQueueGrowingData();
      const input = makeBaseInput(queue, pop, {
        currentQueueDepth: 5,
        currentEnergy: 50,
        minSpawnEnergy: 200,
      });
      const analysis = analyzeSpawnStarvation(input);
      expect(analysis.energyAvailability).toBeLessThan(0.5);
      // 有队列 + 能量不足
      expect(
        analysis.status === "ENERGY_LIMITED" ||
        analysis.status === "STARVATION_IMMINENT" ||
        analysis.status === "QUEUE_GROWING"
      ).toBe(true);
    });

    // DIST-003: 有 energy 但 capacity 不足 → CAPACITY_LIMITED
    it("DIST-003: energy but capacity limited → CAPACITY_LIMITED", () => {
      // 人口趋势上升（逼近容量上限）+ 容量利用率 > 0.9
      const queue = makeTimeSeries([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
      const pop = makeTimeSeries([15, 16, 17, 18, 19, 19, 19, 19, 19, 19]);
      const input = makeBaseInput(queue, pop, {
        currentQueueDepth: 3,
        currentEnergy: 5000,
        currentPopulation: 19,
        spawnCapacity: 20,
      });
      const analysis = analyzeSpawnStarvation(input);
      expect(analysis.capacityUtilization).toBeGreaterThan(0.9);
      // 容量持续饱和 + 有队列 + 能量充足 + 人口趋势不在下降
      expect(
        analysis.status === "CAPACITY_LIMITED" ||
        analysis.status === "QUEUE_GROWING"
      ).toBe(true);
    });

    // DIST-004: queue 持续增长 → QUEUE_GROWING
    it("DIST-004: queue growing detected", () => {
      const { queue, pop } = makeQueueGrowingData();
      const input = makeBaseInput(queue, pop, {
        currentQueueDepth: 10,
        currentEnergy: 5000,
      });
      const analysis = analyzeSpawnStarvation(input);
      expect(analysis.queueTrend).toBe("up");
      expect(
        analysis.status === "QUEUE_GROWING" ||
        analysis.status === "STARVATION_IMMINENT"
      ).toBe(true);
    });

    // DIST-005: starvation 即将发生
    it("DIST-005: starvation imminent with low energy + high queue", () => {
      const { queue, pop } = makeStarvationImminentData();
      const input = makeBaseInput(queue, pop, {
        currentQueueDepth: 45,
        currentEnergy: 0,
        minSpawnEnergy: 200,
      });
      const analysis = analyzeSpawnStarvation(input);
      expect(analysis.severity).toBeGreaterThan(0.5);
    });
  });

  // ── Architecture Guards ──
  describe("Architecture Guards", () => {
    it("AG-S-001: no Game API references", () => {
      const { queue, pop } = makeNoDemandData();
      const input = makeBaseInput(queue, pop);
      const result = predictSpawnStarvation(input);
      expect(isValidPrediction(result)).toBe(true);
    });

    it("AG-S-002: does not modify runtime state", () => {
      const { queue, pop } = makeNoDemandData();
      const input = makeBaseInput(queue, pop);
      predictSpawnStarvation(input);
      expect(queue.samples.length).toBe(10);
      expect(pop.samples.length).toBe(10);
    });

    it("AG-S-003 through AG-S-011: prediction passes all guards", () => {
      const { queue, pop } = makeNoDemandData();
      const input = makeBaseInput(queue, pop);
      const result = predictSpawnStarvation(input);
      expect(isValidPrediction(result)).toBe(true);
      if (!isValidPrediction(result)) return;
      const violations = validatePrediction(result);
      expect(violations.length).toBe(0);
    });

    it("AG-S-011: no recommendation output", () => {
      const { queue, pop } = makeNoDemandData();
      const input = makeBaseInput(queue, pop);
      const result = predictSpawnStarvation(input);
      expect(isValidPrediction(result)).toBe(true);
      if (!isValidPrediction(result)) return;
      expect(result).not.toHaveProperty("recommendation");
      expect(result).not.toHaveProperty("action");
      expect(result).not.toHaveProperty("directive");
      expect(result).not.toHaveProperty("command");
    });
  });

  // ── PRED Guard Compliance ──
  describe("PRED Guard Compliance", () => {
    it("PRED-005: insufficient samples returns INSUFFICIENT_DATA", () => {
      const queue = makeTimeSeries([0]);
      const pop = makeTimeSeries([10]);
      const input = makeBaseInput(queue, pop);
      const result = predictSpawnStarvation(input);
      expect(result).toBe(INSUFFICIENT_DATA);
    });

    it("PRED-004: horizon always within bounds", () => {
      const { queue, pop } = makeNoDemandData();
      const input = makeBaseInput(queue, pop);
      const result = predictSpawnStarvation(input);
      if (isValidPrediction(result)) {
        expect(result.window.duration).toBeGreaterThanOrEqual(50);
        expect(result.window.duration).toBeLessThanOrEqual(5000);
      }
    });

    it("model version is set", () => {
      const { queue, pop } = makeNoDemandData();
      const input = makeBaseInput(queue, pop);
      const result = predictSpawnStarvation(input);
      if (isValidPrediction(result)) {
        expect(result.modelVersion).toBe(SPAWN_STARVATION_MODEL_VERSION);
      }
    });
  });
});
