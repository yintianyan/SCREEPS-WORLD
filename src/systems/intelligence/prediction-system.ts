/** A6.3 Prediction System — 系统层薄壳。 */
import type { Priority, System, TickContext } from "../../kernel/contracts";
import { globalCache } from "../../kernel/global-cache";
import { systemPhase } from "../../kernel/phase";
import type {
  Prediction,
  PredictionResult,
  PredictionContext,
} from "../../domain/intelligence/prediction";
import {
  isValidPrediction,
  createPredictionRingBuffer,
  pushPrediction,
  expireOverduePredictions,
  gcPredictionBuffer,
  predictionStats,
} from "../../domain/intelligence/prediction";
import {
  predictEnergyShortage,
  type EnergyShortageInput,
} from "../../domain/intelligence/prediction/energy-shortage";
import {
  predictSpawnStarvation,
  type SpawnStarvationInput,
} from "../../domain/intelligence/prediction/spawn-starvation";
import type { TimeSeries, TimeSeriesPoint } from "../../domain/intelligence/prediction/time-series";
import { createTimeSeries, pushSample } from "../../domain/intelligence/prediction/time-series";

// ─── Prediction Cache ─────────────────────────────────────

interface PredictionCache {
  ringBuffer: ReturnType<typeof createPredictionRingBuffer>;
  lastRunTick: number;
}

/** Prediction Ring Buffer 容量。 */
const PREDICTION_RING_BUFFER_CAPACITY = 200;

/** Prediction 最大存活 tick。 */
const PREDICTION_MAX_AGE = 50000;

// ─── 系统定义 ──────────────────────────────────────────────

export const predictionSystem: System = {
  name: "prediction",
  priority: 3 as Priority,
  interval: 500,
  phase: "post",

  run(ctx: TickContext): void {
    const g = globalCache();
    const tick = ctx.tick;

    // ── 1. 初始化缓存（首次运行或 global reset 后）──
    if (!g.__predictionCache) {
      g.__predictionCache = {
        ringBuffer: createPredictionRingBuffer(PREDICTION_RING_BUFFER_CAPACITY),
        lastRunTick: 0,
      };
    }
    const cache = g.__predictionCache as PredictionCache;

    // ── 2. 采集当前上下文 ──
    const context = buildPredictionContext(ctx);
    if (!context) return;

    // ── 3. 运行 Energy Shortage 预测 ──
    const energyInput = buildEnergyShortageInput(g, context, tick);
    if (energyInput) {
      const result: PredictionResult = predictEnergyShortage(energyInput);
      if (isValidPrediction(result)) {
        const prediction = finalizePrediction(result, cache.ringBuffer.seq);
        pushPrediction(cache.ringBuffer, prediction);
      }
    }

    // ── 4. 运行 Spawn Starvation 预测 ──
    const spawnInput = buildSpawnStarvationInput(g, context, tick);
    if (spawnInput) {
      const result: PredictionResult = predictSpawnStarvation(spawnInput);
      if (isValidPrediction(result)) {
        const prediction = finalizePrediction(result, cache.ringBuffer.seq);
        pushPrediction(cache.ringBuffer, prediction);
      }
    }

    // ── 5. 过期预测 lifecycle 管理 ──
    expireOverduePredictions(cache.ringBuffer, tick);

    // ── 6. GC ──
    gcPredictionBuffer(cache.ringBuffer, tick, PREDICTION_MAX_AGE);
    cache.lastRunTick = tick;

    // ── 7. Observability ──
    // P14 修复：cadence 错峰使本系统只在 tick%500===phase 时运行，
    // 绝对 tick%5000===0 要求 tick%500===0，与 phase≠0 不相交 → 永不执行。
    // 改为相位相对判定 (tick-phase)%5000===0。
    const predPhase = systemPhase("prediction", 500);
    if ((tick - predPhase) % 5000 === 0) {
      const stats = predictionStats(cache.ringBuffer);
      console.log(
        `[${tick}] prediction: total=${stats.total}, active=${stats.active}, ` +
        `fulfilled=${stats.fulfilled}, expired=${stats.expired}, ` +
        `fulfillmentRate=${stats.fulfillmentRate.toFixed(3)}`,
      );
    }
  },
};

// ─── 上下文构建 ─────────────────────────────────────────

function buildPredictionContext(ctx: TickContext): PredictionContext | undefined {
  const g = globalCache();
  const health = g.empireHealth;
  if (!health) return undefined;

  // 从 Memory 读取姿态
  const strategy = (globalThis as { Memory?: { kernel?: { strategy?: { posture?: string } } } }).Memory?.kernel?.strategy;
  const posture = strategy?.posture ?? "develop";

  // 看门狗档位
  const watchdogTier = ctx.budget.tier;

  // 房间数量和最高 RCL
  const roomCount = countOwnedRooms();
  const maxRcl = getMaxRcl();

  // 威胁等级
  const threatLevel = health.bottleneck === "threat" ? "HIGH" : "LOW";

  return {
    posture,
    watchdogTier,
    roomCount,
    maxRcl,
    threatLevel,
  };
}

// ─── Energy Shortage 输入构建 ─────────────────────────────

function buildEnergyShortageInput(
  g: ReturnType<typeof globalCache>,
  context: PredictionContext,
  tick: number,
): EnergyShortageInput | undefined {
  const health = g.empireHealth;
  if (!health) return undefined;

  // 净流历史（number[] → 转换为 TimeSeries<number>）
  const netFlowArr = g.__netFlowHistory;
  if (!netFlowArr || netFlowArr.length < 3) return undefined;
  const netFlowHistory = numberArrayToTimeSeries(netFlowArr, tick);

  // 储备历史（number[] → 转换为 TimeSeries<number>）
  const reserveArr = g.__reserveHistory;
  if (!reserveArr || reserveArr.length < 3) return undefined;
  const reserveHistory = numberArrayToTimeSeries(reserveArr, tick);

  // 当前储备（从 health 推导）
  const currentReserve = deriveCurrentReserve(g);

  // 短缺阈值（储备低于此值视为 shortage）
  const shortageThreshold = deriveShortageThreshold(g);

  // 外部能量注入
  const externalEnergyInflow = deriveExternalEnergyInflow(g);

  return {
    netFlowHistory,
    reserveHistory,
    currentReserve,
    shortageThreshold,
    currentTick: tick,
    context,
    historicalContext: context,
    externalEnergyInflow,
    energyHealthScore: health.score,
  };
}

// ─── Spawn Starvation 输入构建 ────────────────────────────

function buildSpawnStarvationInput(
  g: ReturnType<typeof globalCache>,
  context: PredictionContext,
  tick: number,
): SpawnStarvationInput | undefined {
  const health = g.empireHealth;
  if (!health) return undefined;

  // Spawn 队列深度历史（已是 TimeSeries<number>）
  const queueDepthHistory = g.__spawnQueueDepthHistory;
  if (!queueDepthHistory) return undefined;

  // 人口历史（number[] → 转换为 TimeSeries<number>）
  const popArr = g.__populationHistory;
  if (!popArr || popArr.length < 3) return undefined;
  const populationHistory = numberArrayToTimeSeries(popArr, tick);

  // 当前队列深度（从 spawn-manager 推导，简化为 0）
  const currentQueueDepth = deriveSpawnQueueDepth(g);

  // 当前可用能量
  const currentEnergy = deriveCurrentEnergy(g);

  // 当前人口
  const currentPopulation = deriveCurrentPopulation(g);

  // 孵化容量
  const spawnCapacity = deriveSpawnCapacity(g);

  // 最低孵化能量
  const minSpawnEnergy = 200;

  // spawn 维度分数
  const spawnDim = health.dimensions.find(d => d.name === "spawn");

  return {
    queueDepthHistory: queueDepthHistory as unknown as TimeSeries<number>,
    populationHistory,
    currentQueueDepth,
    currentEnergy,
    currentPopulation,
    spawnCapacity,
    minSpawnEnergy,
    currentTick: tick,
    context,
    historicalContext: context,
    spawnHealthScore: spawnDim?.score,
  };
}

// ─── Prediction ID 分配 ───────────────────────────────────

/**
 * 为 Prediction 分配唯一 ID。
 * Domain 纯函数生成时 seq=0，由 System 层在此处补填。
 */
function finalizePrediction(prediction: Prediction, seq: number): Prediction {
  // 如果 Domain 已分配了非零 ID，保持原样
  if (prediction.id !== "P-0-0") {
    return prediction;
  }
  // System 层分配带 seq 的 ID
  const tick = prediction.generatedAt;
  const newId = `P-${tick}-${seq}`;
  return { ...prediction, id: newId };
}

// ─── 辅助函数 ──────────────────────────────────────────────

function countOwnedRooms(): number {
  const game = (globalThis as { Game?: { rooms?: Record<string, { controller?: { my: boolean } }> } }).Game;
  if (!game?.rooms) return 1;
  let count = 0;
  for (const room of Object.values(game.rooms)) {
    if (room.controller?.my) count++;
  }
  return Math.max(1, count);
}

function getMaxRcl(): number {
  const game = (globalThis as { Game?: { rooms?: Record<string, { controller?: { my: boolean; level: number } }> } }).Game;
  if (!game?.rooms) return 1;
  let max = 1;
  for (const room of Object.values(game.rooms)) {
    if (room.controller?.my && room.controller.level > max) {
      max = room.controller.level;
    }
  }
  return max;
}

function deriveCurrentReserve(g: ReturnType<typeof globalCache>): number {
  // 从储备历史序列的最后一个值推导
  const history = g.__reserveHistory;
  if (!history || history.length === 0) return 0;
  return history[history.length - 1]!;
}

function deriveShortageThreshold(g: ReturnType<typeof globalCache>): number {
  // 储备低于此值视为 shortage
  // 简化：基于房间数 × 每房基础需求 (5000)
  const roomCount = countOwnedRooms();
  return roomCount * 5000;
}

function deriveExternalEnergyInflow(g: ReturnType<typeof globalCache>): number | undefined {
  // 从 market 交易或 terminal 转入推导
  // 简化：检查 surplusCompounds 是否有 energy
  return undefined;
}

function deriveSpawnQueueDepth(g: ReturnType<typeof globalCache>): number {
  // 从 spawn-manager 缓存推导
  // 简化：返回 0（实际值由 spawn-manager 产出）
  return 0;
}

function deriveCurrentEnergy(g: ReturnType<typeof globalCache>): number {
  // 从 empireHealth 推导
  const health = g.empireHealth;
  if (!health) return 0;
  return Math.round(health.score * 10000);
}

function deriveCurrentPopulation(g: ReturnType<typeof globalCache>): number {
  // 从 populationHistory 最后一个值推导
  const history = g.__populationHistory;
  if (!history || history.length === 0) return 0;
  return history[history.length - 1]!;
}

/**
 * 将 number[]（empire-health-system 维护的原始数组）转换为 TimeSeries<number>。
 * empire-health-system 每 100t push 一个值，所以 tick = baseTick - (len - 1 - i) * 100。
 */
function numberArrayToTimeSeries(arr: number[], currentTick: number): TimeSeries<number> {
  const ts = createTimeSeries<number>(arr.length);
  const len = arr.length;
  const baseTick = currentTick - (len - 1) * 100;
  for (let i = 0; i < len; i++) {
    pushSample(ts, baseTick + i * 100, arr[i]!);
  }
  return ts;
}

function deriveSpawnCapacity(g: ReturnType<typeof globalCache>): number {
  // 从 owned rooms 推导 spawn 数量
  const roomCount = countOwnedRooms();
  return roomCount * 300; // 每个 spawn 最大 body cost ~300
}
