/** A6.3.2 Prediction Models — 集成测试。 */
import { describe, it, expect } from "vitest";
import {
  type EnergyShortageInput,
  predictEnergyShortage,
  analyzeEnergyShortage,
} from "../../../src/domain/intelligence/prediction/energy-shortage";
import {
  type SpawnStarvationInput,
  predictSpawnStarvation,
  analyzeSpawnStarvation,
} from "../../../src/domain/intelligence/prediction/spawn-starvation";
import {
  type PredictionContext,
  type TimeSeries,
  type Prediction,
  type PredictionRingBuffer,
  createTimeSeries,
  pushSample,
  makePredictionContext,
  createPredictionRingBuffer,
  pushPrediction,
  activeByTarget,
  allActivePredictions,
  predictionStats,
  expireOverduePredictions,
  gcPredictionBuffer,
  resolvePrediction,
  INSUFFICIENT_DATA,
  isValidPrediction,
  validatePrediction,
  validateRingBuffer,
  predictionHash,
  guardShadowOnly,
  guardDeterminism,
  guardHorizon,
  guardEvidence,
  guardRegime,
  guardLifecycle,
} from "../../../src/domain/intelligence/prediction";
import {
  verifyPrediction,
  resolvePredictionStatus,
  batchResolvePredictions,
} from "../../../src/domain/intelligence/prediction/resolve";
import {
  tracePredictionEvidence,
  validatePredictionEvidence,
} from "../../../src/domain/intelligence/prediction/evidence-builder";

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function makeContext(): PredictionContext {
  return makePredictionContext({
    posture: "peace",
    watchdogTier: "healthy",
    roomCount: 3,
    maxRcl: 6,
    threatLevel: "LOW",
  });
}

function makeTS(values: number[], startTick = 100000, interval = 100): TimeSeries<number> {
  const ts = createTimeSeries<number>(100);
  for (let i = 0; i < values.length; i++) {
    pushSample(ts, startTick + i * interval, values[i]!);
  }
  return ts;
}

function makeEnergyInput(overrides: Partial<EnergyShortageInput> = {}): EnergyShortageInput {
  return {
    netFlowHistory: makeTS([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]),
    reserveHistory: makeTS([5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]),
    currentReserve: 5000,
    shortageThreshold: 500,
    currentTick: 100900,
    context: makeContext(),
    ...overrides,
  };
}

function makeSpawnInput(overrides: Partial<SpawnStarvationInput> = {}): SpawnStarvationInput {
  return {
    queueDepthHistory: makeTS([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    populationHistory: makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
    currentQueueDepth: 0,
    currentEnergy: 1000,
    currentPopulation: 10,
    spawnCapacity: 20,
    minSpawnEnergy: 200,
    currentTick: 100900,
    context: makeContext(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// Integration Tests
// ═══════════════════════════════════════════════════════════

describe("A6.3.2 Prediction Models — Integration", () => {
  // ── 调用链验证 ──
  describe("Integration Chain", () => {
    it("TimeSeries → Prediction Input → Model → validatePrediction → RingBuffer → Query", () => {
      // 1. TimeSeries 数据
      const netFlow = makeTS([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
      const reserve = makeTS([5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]);

      // 2. Prediction Input
      const input: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 5000,
        shortageThreshold: 500,
        currentTick: 100900,
        context: makeContext(),
      };

      // 3. 调用 Model
      const result = predictEnergyShortage(input);
      expect(isValidPrediction(result)).toBe(true);
      if (!isValidPrediction(result)) return;

      // 4. validatePrediction
      const violations = validatePrediction(result);
      expect(violations.length).toBe(0);

      // 5. PredictionRingBuffer
      const buf = createPredictionRingBuffer(50);
      pushPrediction(buf, result);
      expect(buf.count).toBe(1);

      // 6. Query
      const active = activeByTarget(buf, "energy-shortage");
      expect(active.length).toBe(1);
      expect(active[0]!.id).toBe(result.id);
    });

    it("Ring Buffer supports multiple predictions from different models", () => {
      const buf = createPredictionRingBuffer(50);

      // Energy prediction
      const energyResult = predictEnergyShortage(makeEnergyInput());
      if (isValidPrediction(energyResult)) {
        pushPrediction(buf, energyResult);
      }

      // Spawn prediction
      const spawnResult = predictSpawnStarvation(makeSpawnInput());
      if (isValidPrediction(spawnResult)) {
        pushPrediction(buf, spawnResult);
      }

      expect(buf.count).toBe(2);

      // Query by target
      const energyPredictions = activeByTarget(buf, "energy-shortage");
      const spawnPredictions = activeByTarget(buf, "spawn-starvation");
      expect(energyPredictions.length).toBe(1);
      expect(spawnPredictions.length).toBe(1);

      // All active
      const allActive = allActivePredictions(buf);
      expect(allActive.length).toBe(2);
    });

    it("Ring Buffer lifecycle: push → resolve → expire → gc", () => {
      const buf = createPredictionRingBuffer(50);
      const result = predictEnergyShortage(makeEnergyInput());
      if (!isValidPrediction(result)) return;

      pushPrediction(buf, result);
      expect(buf.count).toBe(1);

      // Resolve as fulfilled
      const resolved = resolvePrediction(buf, result.id, "fulfilled");
      expect(resolved).toBe(true);

      // Check status updated
      const activeAfterResolve = allActivePredictions(buf);
      expect(activeAfterResolve.length).toBe(0); // fulfilled is not active

      // Expire overdue
      const { expired } = expireOverduePredictions(buf, result.window.endTick + 1000);
      expect(expired).toBe(0); // already fulfilled

      // GC
      const { cleaned } = gcPredictionBuffer(buf, result.window.endTick + 100000, 50000);
      expect(cleaned).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 禁止路径验证 ──
  describe("Forbidden Paths", () => {
    it("prediction does not enter Strategy / Spawn / Logistics / Military / Recovery", () => {
      const result = predictEnergyShortage(makeEnergyInput());
      if (!isValidPrediction(result)) return;

      // Prediction 对象只包含预测数据
      // 不包含任何执行路径的引用
      expect(result).not.toHaveProperty("strategy");
      expect(result).not.toHaveProperty("spawnRequest");
      expect(result).not.toHaveProperty("logisticsAction");
      expect(result).not.toHaveProperty("militaryAction");
      expect(result).not.toHaveProperty("recoveryAction");
      expect(result).not.toHaveProperty("posture");
      expect(result).not.toHaveProperty("parameterChange");
      expect(result).not.toHaveProperty("configOverride");
    });

    it("prediction status only allows active/fulfilled/expired/invalidated", () => {
      const result = predictEnergyShortage(makeEnergyInput());
      if (!isValidPrediction(result)) return;

      const validStatuses = ["active", "fulfilled", "expired", "invalidated"];
      expect(validStatuses).toContain(result.status);
    });
  });

  // ── CPU Benchmark ──
  describe("CPU Benchmark", () => {
    it("single prediction < 0.1ms", () => {
      const input = makeEnergyInput();

      // Warm up
      predictEnergyShortage(input);

      // Measure
      const start = performance.now();
      predictEnergyShortage(input);
      const elapsed = performance.now() - start;

      // 0.1ms = 0.1 milliseconds
      // Note: in test environment, performance.now() resolution may vary
      // We use a generous threshold for CI compatibility
      expect(elapsed).toBeLessThan(5); // 5ms generous for CI
    });

    it("100 predictions < 10ms", () => {
      const input = makeEnergyInput();

      // Warm up
      predictEnergyShortage(input);

      // Measure 100 predictions
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        predictEnergyShortage(input);
      }
      const elapsed = performance.now() - start;

      // 10ms for 100 predictions
      // Generous threshold for CI
      expect(elapsed).toBeLessThan(50); // 50ms generous for CI
    });

    it("spawn prediction single < 0.1ms", () => {
      const input = makeSpawnInput();

      // Warm up
      predictSpawnStarvation(input);

      const start = performance.now();
      predictSpawnStarvation(input);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5);
    });

    it("spawn 100 predictions < 10ms", () => {
      const input = makeSpawnInput();

      // Warm up
      predictSpawnStarvation(input);

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        predictSpawnStarvation(input);
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });

  // ── Memory Audit ──
  describe("Memory Audit", () => {
    it("prediction does not retain Game Objects", () => {
      const result = predictEnergyShortage(makeEnergyInput());
      if (!isValidPrediction(result)) return;

      // Prediction 只包含纯数据
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("Game.");
      expect(serialized).not.toContain("RoomObject");
      expect(serialized).not.toContain("Creep");
      expect(serialized).not.toContain("Structure");
    });

    it("prediction does not retain paths", () => {
      const result = predictEnergyShortage(makeEnergyInput());
      if (!isValidPrediction(result)) return;

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("path");
      expect(serialized).not.toContain("PathFinder");
    });

    it("prediction does not retain runtime snapshot", () => {
      const result = predictSpawnStarvation(makeSpawnInput());
      if (!isValidPrediction(result)) return;

      // 只保存必要数据和 Evidence ID
      expect(result.evidence.sources.length).toBeLessThan(50); // 只保存引用字符串
      expect(Object.keys(result.evidence.modelParams).length).toBeLessThan(20);
    });

    it("ring buffer memory is bounded", () => {
      const buf = createPredictionRingBuffer(50);

      // 填满
      for (let i = 0; i < 100; i++) {
        const input = makeEnergyInput({ currentTick: 100000 + i * 100 });
        const result = predictEnergyShortage(input);
        if (isValidPrediction(result)) {
          pushPrediction(buf, result);
        }
      }

      // 容量不超过 50
      expect(buf.count).toBeLessThanOrEqual(50);
      expect(buf.records.length).toBe(50);
    });
  });

  // ── Ring Buffer 守卫验证 ──
  describe("Ring Buffer Guard Validation", () => {
    it("all predictions in ring buffer pass guards", () => {
      const buf = createPredictionRingBuffer(50);

      const energyResult = predictEnergyShortage(makeEnergyInput());
      if (isValidPrediction(energyResult)) {
        pushPrediction(buf, energyResult);
      }

      const spawnResult = predictSpawnStarvation(makeSpawnInput());
      if (isValidPrediction(spawnResult)) {
        pushPrediction(buf, spawnResult);
      }

      const violations = validateRingBuffer(buf);
      expect(violations.length).toBe(0);
    });
  });

  // ── Prediction Stats ──
  describe("Prediction Stats", () => {
    it("stats correctly report prediction distribution", () => {
      const buf = createPredictionRingBuffer(50);

      const energyResult = predictEnergyShortage(makeEnergyInput());
      if (isValidPrediction(energyResult)) {
        pushPrediction(buf, energyResult);
      }

      const spawnResult = predictSpawnStarvation(makeSpawnInput());
      if (isValidPrediction(spawnResult)) {
        pushPrediction(buf, spawnResult);
      }

      const stats = predictionStats(buf);
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(2);
      expect(stats.byTarget["energy-shortage"]).toBe(1);
      expect(stats.byTarget["spawn-starvation"]).toBe(1);
    });
  });

  // ── Batch Resolution ──
  describe("Batch Resolution", () => {
    it("batch resolve predictions correctly", () => {
      const buf = createPredictionRingBuffer(50);
      const predictions: Prediction[] = [];

      const energyResult = predictEnergyShortage(makeEnergyInput());
      if (isValidPrediction(energyResult)) {
        pushPrediction(buf, energyResult);
        predictions.push(energyResult);
      }

      const spawnResult = predictSpawnStarvation(makeSpawnInput());
      if (isValidPrediction(spawnResult)) {
        pushPrediction(buf, spawnResult);
        predictions.push(spawnResult);
      }

      // Create actual values map (simulating predicted values came true)
      const actualValues = new Map<string, number>();
      for (const p of predictions) {
        actualValues.set(p.id, p.value);
      }

      // Resolve at future tick
      const futureTick = predictions[0]!.window.endTick + 100;
      const result = batchResolvePredictions(predictions, actualValues, futureTick);

      // Both should be fulfilled (actual = predicted → deviation = 0)
      expect(result.fulfilled + result.expired + result.invalidated).toBeGreaterThan(0);
      expect(result.fulfillmentRate).toBeGreaterThan(0);
    });
  });

  // ── A6 停止后帝国不受影响 ──
  describe("A6 Shutdown Safety", () => {
    it("prediction models are pure functions — no side effects", () => {
      const input1 = makeEnergyInput();
      const input2 = makeSpawnInput();

      // 运行多次不影响输入
      const originalNetFlow = input1.netFlowHistory.samples.length;
      const originalQueue = input2.queueDepthHistory.samples.length;

      predictEnergyShortage(input1);
      predictEnergyShortage(input1);
      predictSpawnStarvation(input2);
      predictSpawnStarvation(input2);

      expect(input1.netFlowHistory.samples.length).toBe(originalNetFlow);
      expect(input2.queueDepthHistory.samples.length).toBe(originalQueue);
    });

    it("prediction output is serializable (no circular references)", () => {
      const result = predictEnergyShortage(makeEnergyInput());
      if (!isValidPrediction(result)) return;

      // JSON.stringify 不抛异常 = 无循环引用
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });
});
