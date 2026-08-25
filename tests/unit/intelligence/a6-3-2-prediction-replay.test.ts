/**
 * A6.3.2 Prediction Models — 确定性回放测试。
 *
 * 测试矩阵：20 scenarios × 1000 replay
 *
 * 验证：
 *   - prediction hash 一致
 *   - evidence hash 一致
 *   - confidence 一致
 *   - horizon 一致
 *   - lifecycle 一致
 *
 * 全部 20 个场景覆盖：
 *   - Energy Shortage: STABLE, IMPROVING, DEGRADING, SHORTAGE_IMMINENT, SHORTAGE_PREDICTED, INSUFFICIENT
 *   - Spawn Starvation: NO_DEMAND, ENERGY_LIMITED, CAPACITY_LIMITED, QUEUE_GROWING, STARVATION_IMMINENT, INSUFFICIENT
 *   - Regime compatible / mismatch
 *   - 外部因素
 *   - 边界值
 */
import { describe, it, expect } from "vitest";
import {
  type EnergyShortageInput,
  predictEnergyShortage,
} from "../../../src/domain/intelligence/prediction/energy-shortage";
import {
  type SpawnStarvationInput,
  predictSpawnStarvation,
} from "../../../src/domain/intelligence/prediction/spawn-starvation";
import {
  type PredictionContext,
  type TimeSeries,
  type Prediction,
  type PredictionResult,
  createTimeSeries,
  pushSample,
  makePredictionContext,
  INSUFFICIENT_DATA,
  isValidPrediction,
  predictionHash,
  verifyPredictionDeterminism,
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
// 20 Scenarios
// ═══════════════════════════════════════════════════════════

interface Scenario {
  name: string;
  energyInput?: EnergyShortageInput;
  spawnInput?: SpawnStarvationInput;
}

const scenarios: Scenario[] = [
  // ── Energy Scenarios (1-10) ──
  {
    name: "E01: stable energy",
    energyInput: {
      netFlowHistory: makeTS([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]),
      reserveHistory: makeTS([5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]),
      currentReserve: 5000,
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "E02: improving energy",
    energyInput: {
      netFlowHistory: makeTS([100, 120, 140, 160, 180, 200, 220, 240, 260, 280]),
      reserveHistory: makeTS([5000, 5200, 5400, 5600, 5800, 6000, 6200, 6400, 6600, 6800]),
      currentReserve: 6800,
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "E03: degrading energy",
    energyInput: {
      netFlowHistory: makeTS([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]),
      reserveHistory: makeTS([5000, 4900, 4800, 4700, 4600, 4500, 4400, 4300, 4200, 4100]),
      currentReserve: 4100,
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "E04: shortage imminent",
    energyInput: {
      netFlowHistory: makeTS([100, 50, 0, -50, -100, -150, -200, -250, -300, -350]),
      reserveHistory: makeTS([1000, 900, 800, 700, 600, 500, 400, 300, 200, 150]),
      currentReserve: 600,
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "E05: shortage predicted (current below threshold)",
    energyInput: {
      netFlowHistory: makeTS([100, 50, 0, -50, -100, -150, -200, -250, -300, -350]),
      reserveHistory: makeTS([1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]),
      currentReserve: 300,
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "E06: insufficient data",
    energyInput: {
      netFlowHistory: makeTS([100]),
      reserveHistory: makeTS([5000]),
      currentReserve: 5000,
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "E07: regime compatible",
    energyInput: {
      netFlowHistory: makeTS([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]),
      reserveHistory: makeTS([5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]),
      currentReserve: 5000,
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext(),
      historicalContext: makeContext(),
    },
  },
  {
    name: "E08: regime mismatch",
    energyInput: {
      netFlowHistory: makeTS([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]),
      reserveHistory: makeTS([5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]),
      currentReserve: 5000,
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext({ posture: "war", watchdogTier: "conserve", threatLevel: "HIGH" }),
      historicalContext: makeContext({ posture: "peace", watchdogTier: "healthy" }),
    },
  },
  {
    name: "E09: external energy inflow",
    energyInput: {
      netFlowHistory: makeTS([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]),
      reserveHistory: makeTS([5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]),
      currentReserve: 5000,
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext(),
      externalEnergyInflow: 500,
    },
  },
  {
    name: "E10: boundary (reserve = threshold)",
    energyInput: {
      netFlowHistory: makeTS([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]),
      reserveHistory: makeTS([1000, 900, 800, 700, 600, 500, 400, 300, 200, 500]),
      currentReserve: 500,
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext(),
    },
  },

  // ── Spawn Scenarios (11-20) ──
  {
    name: "S01: no demand",
    spawnInput: {
      queueDepthHistory: makeTS([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      populationHistory: makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      currentQueueDepth: 0,
      currentEnergy: 1000,
      currentPopulation: 10,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "S02: improving population",
    spawnInput: {
      queueDepthHistory: makeTS([2, 1, 2, 1, 0, 1, 0, 1, 0, 0]),
      populationHistory: makeTS([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
      currentQueueDepth: 0,
      currentEnergy: 1000,
      currentPopulation: 17,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "S03: queue growing",
    spawnInput: {
      queueDepthHistory: makeTS([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      populationHistory: makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      currentQueueDepth: 10,
      currentEnergy: 5000,
      currentPopulation: 10,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "S04: energy limited",
    spawnInput: {
      queueDepthHistory: makeTS([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
      populationHistory: makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      currentQueueDepth: 3,
      currentEnergy: 50,
      currentPopulation: 10,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "S05: capacity limited",
    spawnInput: {
      queueDepthHistory: makeTS([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
      populationHistory: makeTS([18, 18, 18, 18, 18, 18, 18, 18, 18, 18]),
      currentQueueDepth: 3,
      currentEnergy: 5000,
      currentPopulation: 18,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "S06: starvation imminent",
    spawnInput: {
      queueDepthHistory: makeTS([5, 8, 12, 16, 20, 25, 30, 35, 40, 45]),
      populationHistory: makeTS([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
      currentQueueDepth: 45,
      currentEnergy: 0,
      currentPopulation: 1,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "S07: insufficient data",
    spawnInput: {
      queueDepthHistory: makeTS([0]),
      populationHistory: makeTS([10]),
      currentQueueDepth: 0,
      currentEnergy: 1000,
      currentPopulation: 10,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
    },
  },
  {
    name: "S08: regime compatible",
    spawnInput: {
      queueDepthHistory: makeTS([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      populationHistory: makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      currentQueueDepth: 0,
      currentEnergy: 1000,
      currentPopulation: 10,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
      historicalContext: makeContext(),
    },
  },
  {
    name: "S09: regime mismatch",
    spawnInput: {
      queueDepthHistory: makeTS([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      populationHistory: makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      currentQueueDepth: 0,
      currentEnergy: 1000,
      currentPopulation: 10,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext({ posture: "war", watchdogTier: "conserve", threatLevel: "HIGH" }),
      historicalContext: makeContext({ posture: "peace", watchdogTier: "healthy" }),
    },
  },
  {
    name: "S10: P0 request pressure",
    spawnInput: {
      queueDepthHistory: makeTS([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      populationHistory: makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      currentQueueDepth: 5,
      currentEnergy: 1000,
      currentPopulation: 10,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
      p0RequestCount: 2,
    },
  },
];

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

describe("A6.3.2 Prediction Models — Deterministic Replay", () => {
  const REPLAY_ITERATIONS = 1000;

  it("should have exactly 20 scenarios", () => {
    expect(scenarios.length).toBe(20);
  });

  // ── 逐场景确定性验证 ──
  for (const scenario of scenarios) {
    it(`${scenario.name} — ${REPLAY_ITERATIONS} replay produces identical results`, () => {
      // 运行模型
      let result: PredictionResult;
      if (scenario.energyInput) {
        result = predictEnergyShortage(scenario.energyInput);
      } else if (scenario.spawnInput) {
        result = predictSpawnStarvation(scenario.spawnInput!);
      } else {
        throw new Error(`Scenario ${scenario.name} has no input`);
      }

      // 如果是 INSUFFICIENT_DATA → 验证 1000 次都返回 INSUFFICIENT_DATA
      if (result === INSUFFICIENT_DATA) {
        for (let i = 0; i < REPLAY_ITERATIONS; i++) {
          let r: PredictionResult;
          if (scenario.energyInput) {
            r = predictEnergyShortage(scenario.energyInput);
          } else {
            r = predictSpawnStarvation(scenario.spawnInput!);
          }
          expect(r).toBe(INSUFFICIENT_DATA);
        }
        return;
      }

      // 有效 Prediction → 验证 hash + confidence + horizon + lifecycle 一致
      expect(isValidPrediction(result)).toBe(true);
      if (!isValidPrediction(result)) return;

      const firstHash = predictionHash(result);
      const firstConfidence = result.confidence;
      const firstHorizon = result.window.duration;
      const firstStatus = result.status;
      const firstValue = result.value;

      for (let i = 0; i < REPLAY_ITERATIONS; i++) {
        let r: PredictionResult;
        if (scenario.energyInput) {
          r = predictEnergyShortage(scenario.energyInput);
        } else {
          r = predictSpawnStarvation(scenario.spawnInput!);
        }

        expect(isValidPrediction(r)).toBe(true);
        if (!isValidPrediction(r)) continue;

        // Hash 一致
        expect(predictionHash(r)).toBe(firstHash);
        // Confidence 一致
        expect(r.confidence).toBe(firstConfidence);
        // Horizon 一致
        expect(r.window.duration).toBe(firstHorizon);
        // Lifecycle 一致
        expect(r.status).toBe(firstStatus);
        // Value 一致
        expect(r.value).toBe(firstValue);
      }
    });
  }

  // ── 总体确定性验证 ──
  it("all scenarios produce deterministic results across 1000 iterations", () => {
    let allDeterministic = true;
    let failedScenario = "";

    for (const scenario of scenarios) {
      let result: PredictionResult;
      if (scenario.energyInput) {
        result = predictEnergyShortage(scenario.energyInput);
      } else if (scenario.spawnInput) {
        result = predictSpawnStarvation(scenario.spawnInput!);
      } else {
        continue;
      }

      if (result === INSUFFICIENT_DATA) {
        // INSUFFICIENT_DATA 是确定性的
        continue;
      }

      if (!isValidPrediction(result)) {
        allDeterministic = false;
        failedScenario = scenario.name;
        break;
      }

      const verification = verifyPredictionDeterminism(result, REPLAY_ITERATIONS);
      if (!verification.deterministic) {
        allDeterministic = false;
        failedScenario = scenario.name;
        break;
      }
    }

    expect(allDeterministic).toBe(true);
    expect(failedScenario).toBe("");
  });
});
