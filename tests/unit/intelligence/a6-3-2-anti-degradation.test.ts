/**
 * A6.3.2 Anti-Degradation Tests — 反事实测试。
 *
 * 核心验证原则：
 *   "Prediction 的价值不是重新给当前状态贴标签，
 *    而是利用历史序列回答'按照当前趋势，未来会发生什么'。"
 *
 * 两个最关键的反事实测试：
 *   1. 当前状态坏 + 历史趋势改善 → 不得预测未来恶化
 *   2. 当前状态正常 + 历史趋势恶化 → 必须能提前预测问题
 *
 * ANTI-001: 当前能量低，但历史趋势明显改善 → 不得预测未来 shortage
 * ANTI-002: 当前队列 > 0，但 queueTrend = DOWN → 不得判定 QUEUE_GROWING
 * ANTI-003: 当前容量 > 90%，但 populationTrend = DOWN → 不得判定未来 capacity starvation
 * ANTI-004: 当前 demand 很高，但 demandTrend = DOWN → 不得仅凭当前 demand 产生恶化预测
 * ANTI-005: 当前状态正常，但 regression 明确指向未来 shortage → 必须能够产生预测
 * ANTI-006: 当前状态正常，但 regression 指向未来 spawn starvation → 必须能够产生预测
 * ANTI-007: 历史样本不足，但当前 snapshot 已经异常 → 不得伪造未来预测
 * ANTI-008: Regime mismatch → 不得继续使用旧 regime 的高 confidence
 */
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
  type PredictionResult,
  createTimeSeries,
  pushSample,
  makePredictionContext,
  INSUFFICIENT_DATA,
  isValidPrediction,
  isPredictionActive,
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

describe("A6.3.2 Anti-Degradation — Counterfactual Tests", () => {

  // ──────────────────────────────────────────────────────────
  // ANTI-001: 当前能量低，但历史趋势明显改善 → 不得预测未来 shortage
  //
  // 场景：储备从 100 强劲回升到 450（阈值 500）。
  //   当前值 450 < 500 看起来"已短缺"，
  //   但趋势 slope > 0（每 100t 涨 50），
  //   按趋势 100 tick 后储备 = 450 + 50 = 500 就达标了。
  //
  // 预期：status 不应是 SHORTAGE_PREDICTED（那是未来预测），
  //   severity 不应 > 0.5（那是"当前已短缺"的 severity），
  //   应该是 IMPROVING 或 STABLE。
  // ──────────────────────────────────────────────────────────
  it("ANTI-001: current reserve low but trend improving → must not predict future shortage", () => {
    // 储备从 100 → 150 → 200 → 250 → 300 → 350 → 400 → 450 → 480 → 500
    // 净流从 -200 → +50（强劲回升）
    const netFlow = makeTS([-200, -150, -100, -50, 0, 50, 100, 150, 200, 250]);
    const reserve = makeTS([100, 150, 200, 250, 300, 350, 400, 450, 480, 500]);

    const input: EnergyShortageInput = {
      netFlowHistory: netFlow,
      reserveHistory: reserve,
      currentReserve: 450,  // 当前低于阈值 500
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext(),
    };

    const analysis = analyzeEnergyShortage(input);

    // 趋势应该检测到改善
    expect(analysis.reserveTrend).toBe("up");
    expect(analysis.netFlowTrend).toBe("up");

    // 关键断言：不得标记为未来 shortage
    // SHORTAGE_PREDICTED 表示"按当前趋势未来会短缺"——这是错的
    expect(analysis.status).not.toBe("SHORTAGE_PREDICTED");
    expect(analysis.status).not.toBe("SHORTAGE_IMMINENT");

    // severity 不应被当前快照拉高到 0.5+
    expect(analysis.severity).toBeLessThan(0.5);

    // estimatedShortageTick 应为 null（趋势在改善，不会进入 shortage）
    expect(analysis.estimatedShortageTick).toBeNull();
  });

  // ──────────────────────────────────────────────────────────
  // ANTI-002: 当前队列 > 0，但 queueTrend = DOWN → 不得判定 QUEUE_GROWING
  //
  // 场景：队列从 20 逐步降到 2，当前还有 2 个。
  //   "队列 > 0"不等于"队列在增长"。
  //
  // 预期：status 不应是 QUEUE_GROWING。
  // ──────────────────────────────────────────────────────────
  it("ANTI-002: current queue > 0 but queueTrend = DOWN → must not be QUEUE_GROWING", () => {
    const queue = makeTS([20, 18, 15, 12, 10, 8, 6, 5, 3, 2]);
    const pop = makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);

    const input: SpawnStarvationInput = {
      queueDepthHistory: queue,
      populationHistory: pop,
      currentQueueDepth: 2,
      currentEnergy: 5000,
      currentPopulation: 10,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
    };

    const analysis = analyzeSpawnStarvation(input);

    // 趋势应该检测到队列在下降
    expect(analysis.queueTrend).toBe("down");

    // 关键断言：不得标记为 QUEUE_GROWING
    expect(analysis.status).not.toBe("QUEUE_GROWING");
  });

  // ──────────────────────────────────────────────────────────
  // ANTI-003: 当前容量 > 90%，但 populationTrend = DOWN → 不得判定未来 capacity starvation
  //
  // 场景：人口从 20 降到 19，当前 capacityUtilization = 19/20 = 0.95。
  //   "当前容量满"不等于"未来容量不足"——人口在下降，容量压力在缓解。
  //
  // 预期：status 不应是 CAPACITY_LIMITED。
  // ──────────────────────────────────────────────────────────
    it("ANTI-003: current capacity > 90% but populationTrend = DOWN → must not be CAPACITY_LIMITED", () => {
      // 人口趋势下降（从 20 降到 16）+ 当前 capacityUtilization > 0.9
      const queue = makeTS([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
      const pop = makeTS([20, 19.5, 19, 18.5, 18, 17.5, 17, 16.5, 16, 16]);

    const input: SpawnStarvationInput = {
      queueDepthHistory: queue,
      populationHistory: pop,
      currentQueueDepth: 3,
      currentEnergy: 5000,
      currentPopulation: 19,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
    };

    const analysis = analyzeSpawnStarvation(input);

    // 人口趋势下降
    expect(analysis.populationTrend).toBe("down");
    expect(analysis.capacityUtilization).toBeGreaterThan(0.9);

    // 关键断言：不得标记为 CAPACITY_LIMITED（容量压力在缓解）
    expect(analysis.status).not.toBe("CAPACITY_LIMITED");
  });

  // ──────────────────────────────────────────────────────────
  // ANTI-004: 当前 demand 很高，但 demandTrend = DOWN → 不得仅凭当前 demand 产生恶化预测
  //
  // 场景：队列从 15 降到 5，当前 demandPressure 高（5/10 = 0.5），
  //   但 queueTrend = DOWN（需求在减少）。
  //
  // 预期：severity 不应被当前 demandPressure 拉高。
  // ──────────────────────────────────────────────────────────
  it("ANTI-004: current demand high but queueTrend = DOWN → severity must not be inflated", () => {
    const queue = makeTS([15, 13, 11, 9, 7, 6, 5, 5, 5, 5]);
    const pop = makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);

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

    const analysis = analyzeSpawnStarvation(input);

    // 队列趋势下降
    expect(analysis.queueTrend).toBe("down");

    // severity 应该低（趋势在改善，不在恶化）
    expect(analysis.severity).toBeLessThan(0.3);
  });

  // ──────────────────────────────────────────────────────────
  // ANTI-005: 当前状态正常，但 regression 明确指向未来 shortage → 必须能够产生预测
  //
  // 场景：当前储备 2000（阈值 500，看起来安全），
  //   但储备以每 100t -200 的速度下降，
  //   700 tick 后储备 = 2000 - 200*7 = 600，再 200 tick 就到 200 < 500。
  //
  // 预期：必须产出有效 Prediction，status = SHORTAGE_PREDICTED 或 DEGRADING。
  // ──────────────────────────────────────────────────────────
  it("ANTI-005: current state normal but regression points to future shortage → must predict", () => {
    const netFlow = makeTS([200, 100, 0, -100, -200, -300, -400, -500, -600, -700]);
    const reserve = makeTS([5000, 4800, 4600, 4400, 4200, 4000, 3800, 3600, 3400, 3200]);

    const input: EnergyShortageInput = {
      netFlowHistory: netFlow,
      reserveHistory: reserve,
      currentReserve: 2000,  // 看起来安全（>> 500）
      shortageThreshold: 500,
      currentTick: 100900,
      context: makeContext(),
    };

    const result = predictEnergyShortage(input);

    // 必须产出有效 Prediction
    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeEnergyShortage(input);

    // 趋势必须检测到下降
    expect(analysis.reserveTrend).toBe("down");

    // status 必须反映未来风险（不是 STABLE）
    expect(analysis.status).not.toBe("STABLE");
    expect(analysis.status).not.toBe("IMPROVING");

    // 必须有 estimatedShortageTick（外推到何时到达阈值）
    expect(analysis.estimatedShortageTick).not.toBeNull();
    expect(analysis.estimatedShortageTick!).toBeGreaterThan(input.currentTick);
  });

  // ──────────────────────────────────────────────────────────
  // ANTI-006: 当前状态正常，但 regression 指向未来 spawn starvation → 必须能够产生预测
  //
  // 场景：当前队列 5（看起来正常），人口 10（看起来正常），
  //   但队列以每 100t +1 的速度增长（1→2→3→4→5→6→7→8→9→10），
  //   人口以每 100t -0.5 的速度下降。
  //   按趋势，队列很快会超过 spawnCapacity * 2 = 40。
  //
  // 预期：必须产出有效 Prediction。
  // ──────────────────────────────────────────────────────────
  it("ANTI-006: current state normal but regression points to future starvation → must predict", () => {
    const queue = makeTS([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const pop = makeTS([12, 11.5, 11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5]);

    const input: SpawnStarvationInput = {
      queueDepthHistory: queue,
      populationHistory: pop,
      currentQueueDepth: 10,
      currentEnergy: 5000,  // 能量充足
      currentPopulation: 7.5,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
    };

    const result = predictSpawnStarvation(input);

    // 必须产出有效 Prediction
    expect(isValidPrediction(result)).toBe(true);
    if (!isValidPrediction(result)) return;

    const analysis = analyzeSpawnStarvation(input);

    // 趋势必须检测到队列增长
    expect(analysis.queueTrend).toBe("up");

    // status 必须反映未来风险
    expect(analysis.status).not.toBe("NO_DEMAND");
  });

  // ──────────────────────────────────────────────────────────
  // ANTI-007: 历史样本不足，但当前 snapshot 已经异常 → 不得伪造未来预测
  //
  // 场景：只有 2 个样本（不足 3 个最小值），但当前能量 = 0，队列 = 50。
  //   虽然当前状态很糟糕，但数据不足以做趋势外推。
  //
  // 预期：predictSpawnStarvation 返回 INSUFFICIENT_DATA。
  //   analyzeSpawnStarvation 返回零值/默认值，不伪造 severity。
  // ──────────────────────────────────────────────────────────
  it("ANTI-007: insufficient samples but current snapshot abnormal → must not fabricate prediction", () => {
    const queue = makeTS([50]);  // 只有 1 个样本
    const pop = makeTS([5]);

    const input: SpawnStarvationInput = {
      queueDepthHistory: queue,
      populationHistory: pop,
      currentQueueDepth: 50,
      currentEnergy: 0,  // 当前已异常
      currentPopulation: 5,
      spawnCapacity: 20,
      minSpawnEnergy: 200,
      currentTick: 100900,
      context: makeContext(),
    };

    const result = predictSpawnStarvation(input);

    // 不得伪造预测 — 数据不足就是不足
    expect(result).toBe(INSUFFICIENT_DATA);

    // analyze 也不应伪造趋势
    const analysis = analyzeSpawnStarvation(input);
    expect(analysis.sampleCount).toBe(0);
    expect(analysis.queueTrend).toBeNull();
    expect(analysis.populationTrend).toBeNull();
    expect(analysis.estimatedStarvationTick).toBeNull();
  });

  // ──────────────────────────────────────────────────────────
  // ANTI-008: Regime mismatch → 不得继续使用旧 regime 的高 confidence
  //
  // 场景：历史数据在 peace/healthy regime 下采集，
  //   当前 regime 变为 war/conserve（3 个维度不匹配）。
  //
  // 预期：confidence 必须被降低（×0.3）。
  // ──────────────────────────────────────────────────────────
  it("ANTI-008: regime mismatch → confidence must be degraded", () => {
    const netFlow = makeTS([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    const reserve = makeTS([5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]);

    const historicalCtx = makeContext({ posture: "peace", watchdogTier: "healthy", threatLevel: "LOW" });
    const currentCtx = makeContext({ posture: "war", watchdogTier: "conserve", threatLevel: "HIGH" });

    const input: EnergyShortageInput = {
      netFlowHistory: netFlow,
      reserveHistory: reserve,
      currentReserve: 5000,
      shortageThreshold: 500,
      currentTick: 100900,
      context: currentCtx,
      historicalContext: historicalCtx,
    };

    // 先获取同 regime 的 baseline confidence
    const sameRegimeInput: EnergyShortageInput = {
      ...input,
      context: historicalCtx,
      historicalContext: historicalCtx,
    };
    const sameRegimeResult = predictEnergyShortage(sameRegimeInput);
    const mismatchResult = predictEnergyShortage(input);

    if (!isValidPrediction(sameRegimeResult) || !isValidPrediction(mismatchResult)) {
      // 如果同 regime 都不产出，说明数据有问题
      expect(isValidPrediction(sameRegimeResult)).toBe(true);
      return;
    }

    // Regime mismatch 的 confidence 必须显著低于同 regime
    expect(mismatchResult.confidence).toBeLessThan(sameRegimeResult.confidence);

    // 且 evidence 中记录了不兼容
    expect(mismatchResult.evidence.regimeCompatibility.compatible).toBe(false);
    expect(mismatchResult.evidence.regimeCompatibility.confidenceMultiplier).toBeLessThan(1.0);
  });

  // ═════════════════════════════════════════════════════════
  // 核心反事实测试 — 最关键的两条
  // ═════════════════════════════════════════════════════════

  describe("Core Counterfactual: Current State vs Trend", () => {
    // ────────────────────────────────────────────────────────
    // 反事实 1: 把当前状态改坏，但保持历史趋势改善
    //           → 预测是否仍然会认为未来正在恶化？
    //           如果"会"，说明模型被当前快照绑架。
    // ────────────────────────────────────────────────────────
    it("COUNTERFACTUAL-1: current state bad but trend improving → must not predict future worsening", () => {
      // Energy: 储备从 200 强劲回升到 480（每 100t +30）
      // 当前快照：currentReserve = 480（低于阈值 500，看起来"已短缺"）
      // 但趋势：slope > 0，100 tick 后储备 = 480 + 30 = 510 > 500（恢复）
      const netFlow = makeTS([-100, -50, 0, 50, 100, 150, 200, 250, 300, 350]);
      const reserve = makeTS([200, 230, 260, 290, 320, 350, 380, 410, 440, 470]);

      const input: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 480,  // 当前低于阈值
        shortageThreshold: 500,
        currentTick: 100900,
        context: makeContext(),
      };

      const analysis = analyzeEnergyShortage(input);

      // 趋势必须是改善
      expect(analysis.reserveTrend).toBe("up");
      expect(analysis.netFlowTrend).toBe("up");

      // 不得预测未来恶化
      expect(analysis.status).not.toBe("SHORTAGE_PREDICTED");
      expect(analysis.status).not.toBe("SHORTAGE_IMMINENT");
      expect(analysis.status).not.toBe("DEGRADING");

      // severity 不得被当前快照拉高
      expect(analysis.severity).toBeLessThan(0.5);

      // 不得有未来 shortage tick
      expect(analysis.estimatedShortageTick).toBeNull();

      // Spawn: 队列当前有 8 个（看起来有问题），但队列从 20 降到 8
      const queue = makeTS([20, 18, 16, 14, 12, 10, 9, 8, 8, 8]);
      const pop = makeTS([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);

      const spawnInput: SpawnStarvationInput = {
        queueDepthHistory: queue,
        populationHistory: pop,
        currentQueueDepth: 8,  // 当前队列非空
        currentEnergy: 100,    // 当前能量低
        currentPopulation: 10,
        spawnCapacity: 20,
        minSpawnEnergy: 200,
        currentTick: 100900,
        context: makeContext(),
      };

      const spawnAnalysis = analyzeSpawnStarvation(spawnInput);

      // 队列趋势下降
      expect(spawnAnalysis.queueTrend).toBe("down");

      // 不得标 QUEUE_GROWING（队列在缩小，不在增长）
      expect(spawnAnalysis.status).not.toBe("QUEUE_GROWING");

      // severity 不得高（趋势在改善）
      expect(spawnAnalysis.severity).toBeLessThanOrEqual(0.3);
    });

    // ────────────────────────────────────────────────────────
    // 反事实 2: 把当前状态保持正常，但让历史趋势持续恶化
    //           → 模型能否提前预测问题？
    //           如果"能"，才证明 Prediction 层区别于 Runtime State 层。
    // ────────────────────────────────────────────────────────
    it("COUNTERFACTUAL-2: current state normal but trend degrading → must predict future problem", () => {
      // Energy: 当前储备 3000（远高于阈值 500，看起来安全）
      // 但趋势：每 100t -300，储备 5000→4700→4400→...→3000
      // 按趋势，~830 tick 后储备到 500
      const netFlow = makeTS([300, 100, 0, -100, -200, -300, -400, -500, -600, -700]);
      const reserve = makeTS([5000, 4700, 4400, 4100, 3800, 3500, 3200, 3000, 2900, 2800]);

      const input: EnergyShortageInput = {
        netFlowHistory: netFlow,
        reserveHistory: reserve,
        currentReserve: 3000,  // 当前看起来安全
        shortageThreshold: 500,
        currentTick: 100900,
        context: makeContext(),
      };

      const result = predictEnergyShortage(input);
      const analysis = analyzeEnergyShortage(input);

      // 趋势必须是恶化
      expect(analysis.reserveTrend).toBe("down");

      // 必须产出有效预测
      expect(isValidPrediction(result)).toBe(true);
      if (!isValidPrediction(result)) return;

      // status 必须反映未来风险
      expect(analysis.status).not.toBe("STABLE");
      expect(analysis.status).not.toBe("IMPROVING");

      // 必须有未来 shortage tick
      expect(analysis.estimatedShortageTick).not.toBeNull();
      expect(analysis.estimatedShortageTick!).toBeGreaterThan(input.currentTick);

      // Spawn: 当前队列 3（看起来正常），人口 10（正常），能量 5000（充足）
      // 但队列从 0 上升到 3，人口从 12 下降到 10
      const queue = makeTS([0, 0, 1, 1, 2, 2, 3, 3, 3, 3]);
      const pop = makeTS([12, 11.8, 11.5, 11.2, 11, 10.8, 10.5, 10.2, 10, 10]);

      const spawnInput: SpawnStarvationInput = {
        queueDepthHistory: queue,
        populationHistory: pop,
        currentQueueDepth: 3,  // 看起来正常
        currentEnergy: 5000,   // 充足
        currentPopulation: 10,
        spawnCapacity: 20,
        minSpawnEnergy: 200,
        currentTick: 100900,
        context: makeContext(),
      };

      const spawnResult = predictSpawnStarvation(spawnInput);
      const spawnAnalysis = analyzeSpawnStarvation(spawnInput);

      // 趋势必须检测到
      expect(spawnAnalysis.queueTrend).toBe("up");
      expect(spawnAnalysis.populationTrend).toBe("down");

      // 必须产出有效预测
      expect(isValidPrediction(spawnResult)).toBe(true);
      if (!isValidPrediction(spawnResult)) return;

      // status 不得是 NO_DEMAND（有趋势风险）
      expect(spawnAnalysis.status).not.toBe("NO_DEMAND");
    });
  });
});
