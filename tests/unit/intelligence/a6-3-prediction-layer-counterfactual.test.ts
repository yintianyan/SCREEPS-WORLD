/** A6.3 Prediction Layer — C1-C7 统一反事实退化审计。 */
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
  type PredictionResult,
  createTimeSeries,
  pushSample,
  makePredictionContext,
  INSUFFICIENT_DATA,
  isValidPrediction,
} from "../../../src/domain/intelligence/prediction";

// ═══════════════════════════════════════════════════════════
// Helpers
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

function makeTS(values: number[], startTick = 100000, interval = 100): TimeSeries<number> {
  const ts = createTimeSeries<number>(100);
  for (let i = 0; i < values.length; i++) {
    pushSample(ts, startTick + i * interval, values[i]!);
  }
  return ts;
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

describe("A6.3 Prediction Layer — C1-C7 Counterfactual Audit", () => {

  // ═════════════════════════════════════════════════════════
  // C1: 当前坏 + 趋势改善 → 不得预测未来恶化
  // ═════════════════════════════════════════════════════════
  describe("C1: Current bad + trend improving → no future worsening", () => {
    it("Energy: reserve low but trend up → IMPROVING, not SHORTAGE_PREDICTED", () => {
      const netFlow = makeTS([-200, -150, -100, -50, 0, 50, 100, 150, 200, 250]);
      const reserve = makeTS([100, 150, 200, 250, 300, 350, 400, 450, 480, 500]);

      const input: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 450,
        shortageThreshold: 500,
        currentTick: 100900,
        context: makeContext(),
      };

      const analysis = analyzeEnergyShortage(input);
      expect(analysis.reserveTrend).toBe("up");
      expect(analysis.status).not.toBe("SHORTAGE_PREDICTED");
      expect(analysis.status).not.toBe("SHORTAGE_IMMINENT");
      expect(analysis.severity).toBeLessThan(0.5);
    });

    it("Spawn: queue > 0 but trend down → not QUEUE_GROWING, low severity", () => {
      const queue = makeTS([20, 18, 16, 14, 12, 10, 9, 8, 8, 8]);
      const pop = makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);

      const input: SpawnStarvationInput = {
        queueDepthHistory: queue,
        populationHistory: pop,
        currentQueueDepth: 8,
        currentEnergy: 100,
        currentPopulation: 10,
        spawnCapacity: 20,
        minSpawnEnergy: 200,
        currentTick: 100900,
        context: makeContext(),
      };

      const analysis = analyzeSpawnStarvation(input);
      expect(analysis.queueTrend).toBe("down");
      expect(analysis.status).not.toBe("QUEUE_GROWING");
      expect(analysis.severity).toBeLessThanOrEqual(0.3);
    });
  });

  // ═════════════════════════════════════════════════════════
  // C2: 当前正常 + 趋势恶化 → 必须提前预测
  // ═════════════════════════════════════════════════════════
  describe("C2: Current normal + trend degrading → must predict", () => {
    it("Energy: reserve safe but trend down → must produce Prediction", () => {
      const netFlow = makeTS([300, 100, 0, -100, -200, -300, -400, -500, -600, -700]);
      const reserve = makeTS([5000, 4700, 4400, 4100, 3800, 3500, 3200, 3000, 2900, 2800]);

      const input: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 3000,
        shortageThreshold: 500,
        currentTick: 100900,
        context: makeContext(),
      };

      const result = predictEnergyShortage(input);
      const analysis = analyzeEnergyShortage(input);

      expect(isValidPrediction(result)).toBe(true);
      expect(analysis.reserveTrend).toBe("down");
      expect(analysis.status).not.toBe("STABLE");
      expect(analysis.estimatedShortageTick).not.toBeNull();
    });

    it("Spawn: queue small but trend up → must produce Prediction", () => {
      const queue = makeTS([0, 0, 1, 1, 2, 2, 3, 3, 3, 3]);
      const pop = makeTS([12, 11.8, 11.5, 11.2, 11, 10.8, 10.5, 10.2, 10, 10]);

      const input: SpawnStarvationInput = {
        queueDepthHistory: queue,
        populationHistory: pop,
        currentQueueDepth: 3,
        currentEnergy: 5000,
        currentPopulation: 10,
        spawnCapacity: 20,
        minSpawnEnergy: 200,
        currentTick: 100900,
        context: makeContext(),
      };

      const result = predictSpawnStarvation(input);
      const analysis = analyzeSpawnStarvation(input);

      expect(isValidPrediction(result)).toBe(true);
      expect(analysis.queueTrend).toBe("up");
      expect(analysis.status).not.toBe("NO_DEMAND");
    });
  });

  // ═════════════════════════════════════════════════════════
  // C3: 当前异常 + 无有效趋势 → 不得伪造预测
  // 这是 estimateShortageTick() 暴露的根本问题！
  // ═════════════════════════════════════════════════════════
  describe("C3: Current abnormal + no valid trend → must not fabricate", () => {
    it("Energy: current reserve = 0 but no regression → must not fabricate shortage tick", () => {
      // 3 个样本但值完全相同 → slope ≈ 0, R² ≈ 0
      // 当前 reserve = 0（确实已短缺），但无趋势数据可外推
      const netFlow = makeTS([0, 0, 0]);
      const reserve = makeTS([0, 0, 0]);

      const input: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 0,
        shortageThreshold: 500,
        currentTick: 100900,
        context: makeContext(),
      };

      const analysis = analyzeEnergyShortage(input);

      // 无有效趋势
      expect(analysis.reserveTrend).toBe("flat"); // slope ≈ 0

      // 不得伪造未来 shortage tick
      // 当前 reserve = 0 是 CURRENT_FACT，但不能伪造"预测未来会 shortage"
      expect(analysis.estimatedShortageTick).toBeNull();
    });

    it("Spawn: current energy = 0 + queue = 50 but no trend → must not fabricate", () => {
      // 3 个相同样本 → 无趋势
      const queue = makeTS([50, 50, 50]);
      const pop = makeTS([5, 5, 5]);

      const input: SpawnStarvationInput = {
        queueDepthHistory: queue,
        populationHistory: pop,
        currentQueueDepth: 50,
        currentEnergy: 0,
        currentPopulation: 5,
        spawnCapacity: 20,
        minSpawnEnergy: 200,
        currentTick: 100900,
        context: makeContext(),
      };

      const analysis = analyzeSpawnStarvation(input);

      // 趋势 flat
      expect(analysis.queueTrend).toBe("flat");
      expect(analysis.populationTrend).toBe("flat");

      // 当前确实异常但不得伪造未来饥饿 tick
      expect(analysis.estimatedStarvationTick).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════
  // C4: 趋势存在但 R² 不足 → confidence 必须下降
  // 重点检查：r2Factor = 0.3 + 0.7 * minR2
  //   R² = 0 → r2Factor = 0.3（仍然 > 0 → 仍然产出预测）
  //   R² = 0.5 → r2Factor = 0.65
  //   R² = 1.0 → r2Factor = 1.0
  // 问题：R² 极低时是否应该完全拒绝产出？
  // ═════════════════════════════════════════════════════════
  describe("C4: Trend exists but R² insufficient → confidence must drop", () => {
    it("Energy: R² very low (noisy data) → confidence must be low", () => {
      // 噪声数据：值随机波动，R² 会很低
      // 但有 10 个样本（超过 SUFFICIENT_SAMPLES）→ sampleFactor 高
      // 如果 R² 很低但 confidence 仍然高 → 退化
      const netFlow = makeTS([100, -200, 150, -100, 200, -150, 100, -200, 150, -100]);
      const reserve = makeTS([1000, 800, 1200, 900, 1100, 850, 1050, 900, 1150, 950]);

      const input: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 950,
        shortageThreshold: 500,
        currentTick: 100900,
        context: makeContext(),
      };

      const result = predictEnergyShortage(input);

      // 即使产出预测，confidence 必须低（R² 极低）
      if (isValidPrediction(result)) {
        // R² 因子 = 0.3 + 0.7 * minR2
        // 如果 minR2 ≈ 0 → r2Factor ≈ 0.3
        // sampleFactor ≈ 0.3 + 0.7 * (10/50) = 0.44
        // confidence ≈ 0.44 * 0.3 = 0.132
        // 但如果 confidence > 0.3 → 说明 R² 没有充分降低 confidence
        expect(result.confidence).toBeLessThan(0.3);
      }
    });

    it("Spawn: R² very low (noisy data) → confidence must be low", () => {
      // 噪声队列数据
      const queue = makeTS([5, 2, 8, 1, 6, 3, 7, 2, 5, 4]);
      const pop = makeTS([10, 8, 12, 9, 11, 8, 10, 9, 11, 10]);

      const input: SpawnStarvationInput = {
        queueDepthHistory: queue,
        populationHistory: pop,
        currentQueueDepth: 4,
        currentEnergy: 5000,
        currentPopulation: 10,
        spawnCapacity: 20,
        minSpawnEnergy: 200,
        currentTick: 100900,
        context: makeContext(),
      };

      const result = predictSpawnStarvation(input);

      if (isValidPrediction(result)) {
        expect(result.confidence).toBeLessThan(0.3);
      }
    });
  });

  // ═════════════════════════════════════════════════════════
  // C5: Regime 改变 → prediction 必须降权/失效
  // ═════════════════════════════════════════════════════════
  describe("C5: Regime change → must degrade confidence", () => {
    it("Energy: peace→war regime → confidence degraded", () => {
      const netFlow = makeTS([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
      const reserve = makeTS([5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]);

      const historicalCtx = makeContext({ posture: "peace", watchdogTier: "healthy", threatLevel: "LOW" });
      const currentCtx = makeContext({ posture: "war", watchdogTier: "conserve", threatLevel: "HIGH" });

      const sameRegimeInput: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 5000,
        shortageThreshold: 500,
        currentTick: 100900,
        context: historicalCtx,
        historicalContext: historicalCtx,
      };

      const mismatchInput: EnergyShortageInput = {
        ...sameRegimeInput,
        context: currentCtx,
        historicalContext: historicalCtx,
      };

      const sameResult = predictEnergyShortage(sameRegimeInput);
      const mismatchResult = predictEnergyShortage(mismatchInput);

      if (isValidPrediction(sameResult) && isValidPrediction(mismatchResult)) {
        expect(mismatchResult.confidence).toBeLessThan(sameResult.confidence);
        expect(mismatchResult.evidence.regimeCompatibility.compatible).toBe(false);
      }
    });
  });

  // ═════════════════════════════════════════════════════════
  // C6: 历史数据不足 → INSUFFICIENT_DATA
  // ═════════════════════════════════════════════════════════
  describe("C6: Insufficient data → INSUFFICIENT_DATA", () => {
    it("Energy: < 3 samples → INSUFFICIENT_DATA", () => {
      const netFlow = makeTS([100]);
      const reserve = makeTS([5000]);

      const input: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 5000,
        shortageThreshold: 500,
        currentTick: 100900,
        context: makeContext(),
      };

      expect(predictEnergyShortage(input)).toBe(INSUFFICIENT_DATA);
    });

    it("Spawn: < 3 samples → INSUFFICIENT_DATA", () => {
      const queue = makeTS([5]);
      const pop = makeTS([10]);

      const input: SpawnStarvationInput = {
        queueDepthHistory: queue,
        populationHistory: pop,
        currentQueueDepth: 5,
        currentEnergy: 5000,
        currentPopulation: 10,
        spawnCapacity: 20,
        minSpawnEnergy: 200,
        currentTick: 100900,
        context: makeContext(),
      };

      expect(predictSpawnStarvation(input)).toBe(INSUFFICIENT_DATA);
    });
  });

  // ═════════════════════════════════════════════════════════
  // C7: 输入完全相同 → deterministic replay
  // ═════════════════════════════════════════════════════════
  describe("C7: Same input → deterministic replay", () => {
    it("Energy: 100 iterations → same result", () => {
      const netFlow = makeTS([300, 100, 0, -100, -200, -300, -400, -500, -600, -700]);
      const reserve = makeTS([5000, 4700, 4400, 4100, 3800, 3500, 3200, 3000, 2900, 2800]);

      const input: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 3000,
        shortageThreshold: 500,
        currentTick: 100900,
        context: makeContext(),
      };

      const results: PredictionResult[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(predictEnergyShortage(input));
      }

      // 所有结果必须相同
      const first = results[0]!;
      for (let i = 1; i < 100; i++) {
        expect(results[i]).toEqual(first);
      }
    });

    it("Spawn: 100 iterations → same result", () => {
      const queue = makeTS([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const pop = makeTS([12, 11.5, 11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5]);

      const input: SpawnStarvationInput = {
        queueDepthHistory: queue,
        populationHistory: pop,
        currentQueueDepth: 10,
        currentEnergy: 5000,
        currentPopulation: 7.5,
        spawnCapacity: 20,
        minSpawnEnergy: 200,
        currentTick: 100900,
        context: makeContext(),
      };

      const results: PredictionResult[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(predictSpawnStarvation(input));
      }

      const first = results[0]!;
      for (let i = 1; i < 100; i++) {
        expect(results[i]).toEqual(first);
      }
    });
  });

  // ═════════════════════════════════════════════════════════
  // C8: 噪声数据（R² 极低但 slope 碰巧超阈值）→ 不得误判趋势方向
  // 这是最隐蔽的退化：数据完全随机，但 slope 碰巧 > threshold
  // → deriveTrend 不看 R²，直接判定 "up" 或 "down"
  // → 可能误导 status 和 severity
  // ═════════════════════════════════════════════════════════
  describe("C8: Noisy data with coincidental slope → must not misjudge trend", () => {
    it("Energy: noisy reserve data → trend should be flat or low-confidence", () => {
      // 噪声数据：值在 900-1100 之间随机波动
      // slope 可能为正或负，但 R² 极低
      const netFlow = makeTS([50, -30, 80, -60, 40, -20, 70, -50, 30, -10]);
      const reserve = makeTS([1000, 970, 1050, 990, 1030, 1010, 1080, 1030, 1060, 1050]);

      const input: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 1050,
        shortageThreshold: 500,
        currentTick: 100900,
        context: makeContext(),
      };

      const analysis = analyzeEnergyShortage(input);
      const result = predictEnergyShortage(input);

      // 即使 trend 判定为 "up" 或 "down"，R² 低 → confidence 必须低
      if (isValidPrediction(result)) {
        // R² 因子必须显著降低 confidence
        // 如果 confidence > 0.2 → 说明 R² 不足没有充分限制 confidence
        expect(result.confidence).toBeLessThan(0.2);
      }

      // 更重要：不得因为噪声 slope 就标 SHORTAGE_PREDICTED 或 DEGRADING
      // 如果 R² 极低，即使 slope < 0 也不应产生高 severity
      if (analysis.status === "DEGRADING" || analysis.status === "SHORTAGE_PREDICTED") {
        // severity 必须低（R² 不足 → 外推不可信）
        expect(analysis.severity).toBeLessThan(0.3);
      }
    });

    it("Spawn: noisy queue data → trend should not trigger QUEUE_GROWING", () => {
      // 噪声队列数据
      const queue = makeTS([3, 7, 2, 6, 1, 5, 2, 4, 1, 3]);
      const pop = makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);

      const input: SpawnStarvationInput = {
        queueDepthHistory: queue,
        populationHistory: pop,
        currentQueueDepth: 3,
        currentEnergy: 5000,
        currentPopulation: 10,
        spawnCapacity: 20,
        minSpawnEnergy: 200,
        currentTick: 100900,
        context: makeContext(),
      };

      const analysis = analyzeSpawnStarvation(input);
      const result = predictSpawnStarvation(input);

      // 如果被判定为 QUEUE_GROWING，confidence 必须低
      if (analysis.status === "QUEUE_GROWING") {
        if (isValidPrediction(result)) {
          expect(result.confidence).toBeLessThan(0.2);
        }
      }
    });
  });

  // ═════════════════════════════════════════════════════════
  // C9: 变化幅度极小（slope 刚过阈值但实际无意义）→ 不得放大成严重预测
  // 场景：储备在 499-501 之间微小波动，阈值 500
  //   slope 碰巧为 -0.002（刚过 threshold 0.01... 实际没过）
  //   但如果 threshold 设置不当 → 误判
  // ═════════════════════════════════════════════════════════
  describe("C9: Minimal slope magnitude → must not amplify", () => {
    it("Energy: slope barely negative but reserve stable → low severity", () => {
      // 储备在 1000-998 之间微波动 → slope 极小
      // 不会触发 SHORTAGE，但可能触发 DEGRADING
      const netFlow = makeTS([-1, 1, -1, 1, -1, 1, -1, 1, -1, 1]);
      const reserve = makeTS([1000, 999, 1000, 999, 1000, 999, 1000, 999, 1000, 999]);

      const input: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 999,
        shortageThreshold: 500,
        currentTick: 100900,
        context: makeContext(),
      };

      const analysis = analyzeEnergyShortage(input);

      // 不应标 SHORTAGE（储备远高于阈值）
      expect(analysis.status).not.toBe("SHORTAGE_PREDICTED");
      expect(analysis.status).not.toBe("SHORTAGE_IMMINENT");

      // severity 必须极低（趋势几乎不存在）
      expect(analysis.severity).toBeLessThan(0.2);
    });

    it("Spawn: queue barely changing → low severity", () => {
      // 队列在 2-3 之间微波动
      const queue = makeTS([2, 3, 2, 3, 2, 3, 2, 3, 2, 3]);
      const pop = makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);

      const input: SpawnStarvationInput = {
        queueDepthHistory: queue,
        populationHistory: pop,
        currentQueueDepth: 3,
        currentEnergy: 5000,
        currentPopulation: 10,
        spawnCapacity: 20,
        minSpawnEnergy: 200,
        currentTick: 100900,
        context: makeContext(),
      };

      const analysis = analyzeSpawnStarvation(input);

      // severity 必须极低
      expect(analysis.severity).toBeLessThan(0.2);
    });
  });
});
