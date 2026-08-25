/**
 * A6.3.2 Spawn Starvation Prediction Model — 孵化饥饿预测。
 *
 * 职责：
 *   - 分析 Spawn 队列深度、孵化容量、能量可用性和人口需求趋势
 *   - 预测孵化饥饿何时发生及其严重程度
 *   - 区分 5 种状态：NO_DEMAND / ENERGY_LIMITED / CAPACITY_LIMITED / QUEUE_GROWING / STARVATION_IMMINENT
 *   - 数据不足时返回 INSUFFICIENT_DATA
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 * 所有运行时数据由调用方注入。
 *
 * PRED-001: Shadow-Only — 不执行 Game API，不修改运行时状态。
 * PRED-002: 不进入 tick critical path — 由系统层 P3 cadence 调用。
 * PRED-003: 完全 deterministic — 禁止 Math.random / Date.now / 无序迭代。
 * PRED-004: 每条 Prediction 必须有明确 horizon。
 * PRED-005: 数据不足返回 INSUFFICIENT_DATA，不伪造预测。
 * PRED-006: Evidence 完整可追溯。
 * PRED-007: 使用 ContextSignature + Regime compatibility。
 * PRED-008: 支持生命周期 PREDICTED → CONFIRMED / FAILED / EXPIRED。
 * PRED-009: 不产出 Recommendation。
 * PRED-010: 不自建采样通道，只消费已有 TimeSeries。
 *
 * 禁止简化为 `queueDepth > X => starvation`。
 * 必须综合分析：Demand + Queue + Energy + Spawn Capacity + Trend。
 */

import type {
  Prediction,
  PredictionResult,
  PredictionWindow,
  PredictionMethod,
  PredictionEvidence,
} from "./types";
import {
  INSUFFICIENT_DATA,
  makePredictionId,
} from "./types";
import type { PredictionContext, RegimeCompatibility } from "./context";
import {
  buildPredictionContextSignature,
  checkRegimeCompatibility,
  applyRegimeMultiplier,
} from "./context";
import type { TimeSeries, TimeSeriesPoint } from "./time-series";
import {
  linearRegression,
  allSamples,
  meanValue,
} from "./time-series";
import type { ExperienceRecord } from "../experience";
import {
  buildPredictionEvidence,
  timeSeriesSourceRef,
  experienceSourceRef,
  metricSourceRef,
} from "./evidence-builder";

// ═══════════════════════════════════════════════════════════
// §1. Types
// ═══════════════════════════════════════════════════════════

/**
 * 孵化饥饿预测状态分类。
 *
 * 区分 5 种不同情况：
 *   NO_DEMAND — 没有孵化需求（队列空、人口已满）
 *   ENERGY_LIMITED — 有需求但没有能量孵化
 *   CAPACITY_LIMITED — 有能量但孵化容量不足（spawn 忙/数量不足）
 *   QUEUE_GROWING — 队列持续增长（需求 > 供给）
 *   STARVATION_IMMINENT — 孵化饥饿即将发生
 */
export type SpawnStarvationStatus =
  | "NO_DEMAND"
  | "ENERGY_LIMITED"
  | "CAPACITY_LIMITED"
  | "QUEUE_GROWING"
  | "STARVATION_IMMINENT";

/**
 * Spawn Starvation Prediction 输入。
 *
 * 所有数据由系统层从 globalCache 注入，domain 不直接读 Game/Memory。
 */
export interface SpawnStarvationInput {
  /** Spawn 队列深度历史时间序列（每 100t 采样）。 */
  readonly queueDepthHistory: TimeSeries<number>;
  /** 人口历史时间序列（当前总人口数）。 */
  readonly populationHistory: TimeSeries<number>;
  /** 当前队列深度。 */
  readonly currentQueueDepth: number;
  /** 当前可用能量。 */
  readonly currentEnergy: number;
  /** 当前人口。 */
  readonly currentPopulation: number;
  /** 孵化容量（可用 spawn 数 × 每 spawn 最大 body cost）。 */
  readonly spawnCapacity: number;
  /** 最低孵化能量需求（最小 body cost = 200 for [WORK,CARRY,MOVE]）。 */
  readonly minSpawnEnergy: number;
  /** 当前 tick。 */
  readonly currentTick: number;
  /** 预测上下文。 */
  readonly context: PredictionContext;
  /** 历史上下文（用于 Regime compatibility 检查）。 */
  readonly historicalContext?: PredictionContext;
  /** 相关 Experience 记录。 */
  readonly experiences?: readonly ExperienceRecord[];
  /** 相关 EmpireHealth spawn 维度分数 (0-1)。 */
  readonly spawnHealthScore?: number;
  /** 当前活跃 spawn 数量。 */
  readonly activeSpawnCount?: number;
  /** P0 请求数（高优先级孵化请求）。 */
  readonly p0RequestCount?: number;
}

/**
 * Spawn Starvation 内部分析结果。
 */
interface SpawnAnalysis {
  /** 队列深度回归结果。 */
  readonly queueRegression: { slope: number; intercept: number; r2: number; samples: number } | null;
  /** 人口回归结果。 */
  readonly populationRegression: { slope: number; intercept: number; r2: number; samples: number } | null;
  /** 队列深度均值。 */
  readonly queueMean: number | null;
  /** 人口均值。 */
  readonly populationMean: number | null;
  /** 队列趋势方向。 */
  readonly queueTrend: "up" | "down" | "flat" | null;
  /** 人口趋势方向。 */
  readonly populationTrend: "up" | "down" | "flat" | null;
  /** 预计饥饿发生的 tick（null = 不会发生）。 */
  readonly estimatedStarvationTick: number | null;
  /** 严重程度 (0-1)。 */
  readonly severity: number;
  /** 分析状态。 */
  readonly status: SpawnStarvationStatus;
  /** 能量可用性因子 (0-1)。 */
  readonly energyAvailability: number;
  /** 容量利用率 (0-1+)。 */
  readonly capacityUtilization: number;
  /** 需求压力因子 (0-1+)。 */
  readonly demandPressure: number;
}

// ═══════════════════════════════════════════════════════════
// §2. Model Constants
// ═══════════════════════════════════════════════════════════

/** Spawn Starvation 模型版本。 */
export const SPAWN_STARVATION_MODEL_VERSION = 1;

/** 默认预测窗口（1000 tick）。 */
export const DEFAULT_SPAWN_HORIZON = 1000;

/** 饥饿紧迫阈值（预计在 300 tick 内进入 starvation）。 */
export const STARVATION_IMMINENT_TICKS = 300;

/** 队列趋势阈值。 */
export const QUEUE_TREND_THRESHOLD = 0.001;

/** 人口趋势阈值。 */
export const POPULATION_TREND_THRESHOLD = 0.001;

/** 最小样本数。 */
export const SPAWN_MIN_SAMPLES = 3;

/** 充分样本数。 */
export const SPAWN_SUFFICIENT_SAMPLES = 10;

/** 队列持续增长判定阈值（连续上升趋势）。 */
export const QUEUE_GROWING_SLOPE_THRESHOLD = 0.01;

// ═══════════════════════════════════════════════════════════
// §3. Core Prediction Function
// ═══════════════════════════════════════════════════════════

/**
 * 预测孵化饥饿。
 *
 * 方法：threshold-projection + trend-extrapolation
 *   1. 分析队列深度趋势（上升 = 需求 > 供给）
 *   2. 分析人口趋势（下降 = 死亡 > 补充）
 *   3. 检查能量可用性（currentEnergy < minSpawnEnergy → ENERGY_LIMITED）
 *   4. 检查容量利用率（capacityUtilization > 1 → CAPACITY_LIMITED）
 *   5. 综合判断状态和预测饥饿时间
 *
 * 必须区分：
 *   - 没有 spawn demand（队列空，人口稳定）
 *   - 有 demand 但没有 energy（队列非空，能量不足）
 *   - 有 energy 但 spawn capacity 不足（能量足够但 spawn 全忙）
 *   - queue 持续增长（需求持续超过供给）
 *   - spawn starvation 即将发生
 *
 * PRED-005：数据不足时返回 INSUFFICIENT_DATA。
 * PRED-003：完全确定性。
 */
export function predictSpawnStarvation(input: SpawnStarvationInput): PredictionResult {
  // ── 数据充分性检查 ──
  const queueSamples = allSamples(input.queueDepthHistory);
  const populationSamples = allSamples(input.populationHistory);

  if (queueSamples.length < SPAWN_MIN_SAMPLES || populationSamples.length < SPAWN_MIN_SAMPLES) {
    return INSUFFICIENT_DATA;
  }

  // ── 分析时间序列 ──
  const analysis = analyzeSpawnTimeSeries(input, queueSamples, populationSamples);

  // ── 如果无法分析趋势 ──
  if (!analysis.queueRegression && !analysis.populationRegression) {
    return INSUFFICIENT_DATA;
  }

  // ── 计算预测窗口 ──
  const horizon = computeSpawnHorizon(analysis, input.currentTick);
  if (horizon === null) {
    return INSUFFICIENT_DATA;
  }

  // ── 计算 confidence ──
  const baseConfidence = computeSpawnConfidence(analysis, queueSamples, populationSamples, input);

  // ── Regime compatibility ──
  const historicalCtx = input.historicalContext ?? input.context;
  const regimeCompat = checkRegimeCompatibility(historicalCtx, input.context);
  const adjustedConfidence = applyRegimeMultiplier(baseConfidence, regimeCompat);

  // ── 如果 confidence = 0 → 不产出 ──
  if (adjustedConfidence <= 0) {
    return INSUFFICIENT_DATA;
  }

  // ── 计算预测值 ──
  // value = 预测窗口结束时的队列深度
  // 高值 = 饥饿越严重
  const predictedValue = computePredictedQueueDepth(analysis, input, horizon);

  // ── 构建 Evidence ──
  const evidence = buildSpawnEvidence(input, analysis, queueSamples, populationSamples, regimeCompat);

  // ── 构建 Prediction ──
  const contextSignature = buildPredictionContextSignature(input.context);
  const predictionId = makePredictionId(input.currentTick, 0);

  const window: PredictionWindow = {
    startTick: input.currentTick,
    endTick: input.currentTick + horizon,
    duration: horizon,
  };

  const prediction: Prediction = {
    id: predictionId,
    generatedAt: input.currentTick,
    target: "spawn-starvation",
    window,
    value: Number(predictedValue.toFixed(3)),
    confidence: adjustedConfidence,
    method: "threshold-projection" as PredictionMethod,
    evidence,
    modelVersion: SPAWN_STARVATION_MODEL_VERSION,
    status: "active",
    contextSignature,
    context: input.context,
  };

  return prediction;
}

// ═══════════════════════════════════════════════════════════
// §4. Analysis Functions
// ═══════════════════════════════════════════════════════════

/**
 * 分析孵化时间序列。
 *
 * 综合分析 Demand + Queue + Energy + Spawn Capacity + Trend。
 */
function analyzeSpawnTimeSeries(
  input: SpawnStarvationInput,
  queueSamples: TimeSeriesPoint<number>[],
  populationSamples: TimeSeriesPoint<number>[],
): SpawnAnalysis {
  const queueRegression = linearRegression(input.queueDepthHistory);
  const populationRegression = linearRegression(input.populationHistory);
  const queueMean = meanValue(input.queueDepthHistory);
  const populationMean = meanValue(input.populationHistory);

  // 趋势方向
  const queueTrend = deriveTrend(queueRegression, QUEUE_TREND_THRESHOLD);
  const populationTrend = deriveTrend(populationRegression, POPULATION_TREND_THRESHOLD);

  // 能量可用性
  const energyAvailability = computeEnergyAvailability(input.currentEnergy, input.minSpawnEnergy);

  // 容量利用率
  const capacityUtilization = computeCapacityUtilization(input.currentPopulation, input.spawnCapacity);

  // 需求压力
  const demandPressure = computeDemandPressure(input.currentQueueDepth, input.p0RequestCount);

  // 预计饥饿时间
  const estimatedStarvationTick = estimateStarvationTick(
    queueRegression,
    populationRegression,
    input,
  );

  // 严重程度
  const severity = computeSpawnSeverity(
    input,
    analysis_partial(queueTrend, populationTrend, estimatedStarvationTick, energyAvailability, capacityUtilization, demandPressure),
  );

  // 状态判定
  const status = determineSpawnStatus(
    queueTrend,
    populationTrend,
    estimatedStarvationTick,
    input,
    energyAvailability,
    capacityUtilization,
    demandPressure,
  );

  return {
    queueRegression,
    populationRegression,
    queueMean,
    populationMean,
    queueTrend,
    populationTrend,
    estimatedStarvationTick,
    severity,
    status,
    energyAvailability,
    capacityUtilization,
    demandPressure,
  };
}

/**
 * 辅助：构建部分分析结果（用于 severity 计算）。
 */
function analysis_partial(
  queueTrend: "up" | "down" | "flat" | null,
  populationTrend: "up" | "down" | "flat" | null,
  estimatedStarvationTick: number | null,
  energyAvailability: number,
  capacityUtilization: number,
  demandPressure: number,
) {
  return { queueTrend, populationTrend, estimatedStarvationTick, energyAvailability, capacityUtilization, demandPressure };
}

/**
 * 从回归结果推导趋势方向。
 */
function deriveTrend(
  reg: { slope: number; r2: number } | null,
  threshold: number,
): "up" | "down" | "flat" | null {
  if (!reg) return null;
  if (reg.slope > threshold) return "up";
  if (reg.slope < -threshold) return "down";
  return "flat";
}

/**
 * 计算能量可用性因子 (0-1)。
 *
 * currentEnergy >= minSpawnEnergy → 1.0
 * currentEnergy = 0 → 0.0
 */
function computeEnergyAvailability(currentEnergy: number, minSpawnEnergy: number): number {
  if (minSpawnEnergy <= 0) return 1;
  if (currentEnergy <= 0) return 0;
  const ratio = currentEnergy / minSpawnEnergy;
  return Number(Math.min(1, Math.max(0, ratio)).toFixed(3));
}

/**
 * 计算容量利用率 (0-1+)。
 *
 * population / spawnCapacity：
 *   < 0.8 → 利用率低
 *   0.8-1.0 → 接近满载
 *   > 1.0 → 超载
 */
function computeCapacityUtilization(currentPopulation: number, spawnCapacity: number): number {
  if (spawnCapacity <= 0) return 1; // 无容量 → 满载
  return Number((currentPopulation / spawnCapacity).toFixed(3));
}

/**
 * 计算需求压力因子 (0-1+)。
 *
 * queueDepth + p0Count 综合：
 *   queueDepth = 0 → 0
 *   queueDepth > 0 + p0Count > 0 → 高压力
 */
function computeDemandPressure(currentQueueDepth: number, p0RequestCount?: number): number {
  const queuePressure = Math.min(1, currentQueueDepth / 10);
  const p0Pressure = p0RequestCount !== undefined ? Math.min(1, p0RequestCount / 3) : 0;
  // 取最大值 — P0 更紧急
  return Number(Math.max(queuePressure, p0Pressure).toFixed(3));
}

/**
 * 估计孵化饥饿何时发生。
 *
 * 饥饿条件：
 *   1. 队列持续增长（需求 > 供给）
 *   2. 人口持续下降（死亡 > 补充）
 *   3. 能量不足以孵化
 *
 * 综合判断：如果队列在增长且（人口下降或能量不足），外推何时到达临界。
 */
function estimateStarvationTick(
  queueReg: { slope: number; intercept: number; r2: number } | null,
  popReg: { slope: number; intercept: number; r2: number } | null,
  input: SpawnStarvationInput,
): number | null {
  // 如果当前已经饥饿（BOUNDARY_OVERRIDE：能量不足 + 队列非空）
  // 但只有在趋势也在恶化时才认为这是趋势确认的饥饿
  // 如果趋势在改善（队列下降、人口上升），不返回 currentTick
  // — 让外推逻辑判断未来是否真的会饥饿
  if (input.currentEnergy < input.minSpawnEnergy && input.currentQueueDepth > 0) {
    // 无趋势数据 → 无法判断未来，只能报告当前事实
    if (!queueReg && !popReg) {
      return input.currentTick;
    }
    // 队列在增长或人口在下降 → 趋势确认当前饥饿
    const queueGrowing = queueReg && queueReg.slope > QUEUE_GROWING_SLOPE_THRESHOLD;
    const popDeclining = popReg && popReg.slope < -POPULATION_TREND_THRESHOLD;
    if (queueGrowing || popDeclining) {
      return input.currentTick;
    }
    // 趋势平稳或改善 → 不伪造未来饥饿预测
    // fall through to normal logic
  }

  // 队列在增长？
  if (!queueReg || queueReg.slope <= QUEUE_GROWING_SLOPE_THRESHOLD) {
    // 队列不在增长 → 不会因队列导致饥饿
    // 但检查人口下降
    if (popReg && popReg.slope < -POPULATION_TREND_THRESHOLD) {
      // 人口在下降 → 外推何时人口降到 0
      if (Math.abs(popReg.slope) < 1e-10) return null;
      const zeroPopTick = (0 - popReg.intercept) / popReg.slope;
      const roundedTick = Math.round(zeroPopTick);
      if (roundedTick > input.currentTick && roundedTick - input.currentTick <= 5000) {
        return roundedTick;
      }
    }
    return null;
  }

  // 队列在增长 → 外推何时队列达到临界值
  // 临界值 = spawnCapacity * 2（队列深度达到容量的 2 倍）
  const criticalQueueDepth = Math.max(10, input.spawnCapacity * 2);
  if (Math.abs(queueReg.slope) < 1e-10) return null;

  const criticalTick = (criticalQueueDepth - queueReg.intercept) / queueReg.slope;
  const roundedTick = Math.round(criticalTick);

  if (roundedTick <= input.currentTick) {
    return input.currentTick;
  }

  // 限制在合理范围
  if (roundedTick - input.currentTick > 5000) {
    return null;
  }

  return roundedTick;
}

/**
 * 计算孵化饥饿严重程度 (0-1)。
 *
 * 严重程度基于趋势外推结果：
 *   - 有 estimatedStarvationTick → 按时间距离分级
 *   - 无 estimatedStarvationTick → 按趋势方向 + 当前因子综合评估
 */
function computeSpawnSeverity(
  input: SpawnStarvationInput,
  partial: ReturnType<typeof analysis_partial>,
): number {
  // 预计会饥饿 — 基于趋势外推结果
  if (partial.estimatedStarvationTick !== null && partial.estimatedStarvationTick > input.currentTick) {
    const ticksToStarvation = partial.estimatedStarvationTick - input.currentTick;
    if (ticksToStarvation <= STARVATION_IMMINENT_TICKS) {
      const ratio = 1 - ticksToStarvation / STARVATION_IMMINENT_TICKS;
      return Number((0.5 + ratio * 0.3).toFixed(3));
    }
    if (ticksToStarvation <= DEFAULT_SPAWN_HORIZON) {
      const ratio = 1 - (ticksToStarvation - STARVATION_IMMINENT_TICKS) / (DEFAULT_SPAWN_HORIZON - STARVATION_IMMINENT_TICKS);
      return Number((0.2 + ratio * 0.3).toFixed(3));
    }
    return 0.1;
  }

  // BOUNDARY_OVERRIDE：当前已饥饿（能量不足 + 队列非空）且趋势不在改善
  // 只有当队列趋势上升或人口趋势下降时，当前饥饿才是趋势确认的恶化信号
  if (input.currentEnergy < input.minSpawnEnergy && input.currentQueueDepth > 0) {
    if (partial.queueTrend === "up" || partial.populationTrend === "down") {
      return 0.9;
    }
    // 趋势平稳或改善 → 当前能量低但不在恶化
    return 0.3;
  }

  // 无外推结果 — 按趋势方向 + 当前因子综合评估
  // 队列趋势上升 + 需求压力高 → 需求增长超过供给
  if (partial.queueTrend === "up" && partial.demandPressure > 0.5) {
    return Number((0.2 + partial.demandPressure * 0.2).toFixed(3));
  }

  // 人口趋势下降 + 能量不足 → 供给能力恶化
  if (partial.populationTrend === "down" && partial.energyAvailability < 0.5) {
    return Number((0.15 + (1 - partial.energyAvailability) * 0.2).toFixed(3));
  }

  // 人口趋势下降（死亡 > 补充）
  if (partial.populationTrend === "down") {
    return 0.1;
  }

  // 趋势平稳或改善 → 低严重度
  return 0;
}

/**
 * 确定孵化饥饿状态。
 *
 * 必须区分 5 种情况。
 *
 * 关键原则：状态判定基于趋势外推结果，不是当前快照贴标签。
 * - ENERGY_LIMITED 需要能量趋势在下降或持续不足（不是只看当前值）
 * - CAPACITY_LIMITED 需要容量趋势在恶化或持续饱和
 * - QUEUE_GROWING 必须有 queueTrend === "up"（队列真正在增长）
 */
function determineSpawnStatus(
  queueTrend: "up" | "down" | "flat" | null,
  populationTrend: "up" | "down" | "flat" | null,
  estimatedStarvationTick: number | null,
  input: SpawnStarvationInput,
  energyAvailability: number,
  capacityUtilization: number,
  demandPressure: number,
): SpawnStarvationStatus {
  // 饥饿即将发生 — 基于趋势外推结果
  if (estimatedStarvationTick !== null && estimatedStarvationTick > input.currentTick) {
    const ticksToStarvation = estimatedStarvationTick - input.currentTick;
    if (ticksToStarvation <= STARVATION_IMMINENT_TICKS) {
      return "STARVATION_IMMINENT";
    }
  }

  // 当前已饥饿（边界覆盖：能量不足 + 队列非空 = 无法孵化）
  if (input.currentEnergy < input.minSpawnEnergy && input.currentQueueDepth > 0) {
    return "STARVATION_IMMINENT";
  }

  // 队列真正在增长（趋势向上 + 当前有队列）
  if (queueTrend === "up" && input.currentQueueDepth > 0) {
    return "QUEUE_GROWING";
  }

  // 能量受限 — 需要趋势佐证：能量持续不足（当前低 + 趋势不在改善）
  if (input.currentQueueDepth > 0 && energyAvailability < 0.5 && populationTrend !== "up") {
    return "ENERGY_LIMITED";
  }

  // 容量受限 — 需要趋势佐证：容量持续饱和（当前高 + 人口趋势不在下降）
  if (input.currentQueueDepth > 0 && energyAvailability >= 0.5 && capacityUtilization > 0.9 && populationTrend !== "down") {
    return "CAPACITY_LIMITED";
  }

  // 没有需求 — 队列空且无 P0 压力
  if (input.currentQueueDepth === 0 && demandPressure === 0) {
    return "NO_DEMAND";
  }

  // 队列有但趋势平稳/下降 → 仍在处理中，不是 GROWING
  if (input.currentQueueDepth > 0 && queueTrend !== "up") {
    // 趋势平稳或下降 → 供给在消化需求
    if (energyAvailability < 0.5) {
      return "ENERGY_LIMITED";
    }
    return "NO_DEMAND";
  }

  return "NO_DEMAND";
}

// ═══════════════════════════════════════════════════════════
// §5. Confidence Calculation
// ═══════════════════════════════════════════════════════════

/**
 * 计算基础置信度。
 *
 * 因素：
 *   - 样本数
 *   - R² 拟合度
 *   - 数据一致性（队列和人口趋势是否一致）
 */
function computeSpawnConfidence(
  analysis: SpawnAnalysis,
  queueSamples: TimeSeriesPoint<number>[],
  populationSamples: TimeSeriesPoint<number>[],
  input: SpawnStarvationInput,
): number {
  const sampleCount = Math.min(queueSamples.length, populationSamples.length);

  // 样本因子
  let sampleFactor: number;
  if (sampleCount < SPAWN_MIN_SAMPLES) {
    return 0;
  }
  if (sampleCount < SPAWN_SUFFICIENT_SAMPLES) {
    sampleFactor = 0.3 * (sampleCount / SPAWN_SUFFICIENT_SAMPLES);
  } else {
    sampleFactor = Math.min(1, 0.3 + 0.7 * (sampleCount / 50));
  }

  // R² 因子
  const queueR2 = analysis.queueRegression?.r2 ?? 0;
  const popR2 = analysis.populationRegression?.r2 ?? 0;
  const minR2 = Math.min(queueR2, popR2);
  const r2Factor = 0.3 + 0.7 * minR2;

  // 状态明确性因子 — NO_DEMAND 状态置信度更高（明确无需求）
  const statusClarity = analysis.status === "NO_DEMAND" ? 1.0 : 0.9;

  const confidence = sampleFactor * r2Factor * statusClarity;
  return Number(Math.min(0.95, Math.max(0, confidence)).toFixed(3));
}

// ═══════════════════════════════════════════════════════════
// §6. Horizon & Value Computation
// ═══════════════════════════════════════════════════════════

/**
 * 计算预测窗口。
 */
function computeSpawnHorizon(
  analysis: SpawnAnalysis,
  currentTick: number,
): number | null {
  switch (analysis.status) {
    case "STARVATION_IMMINENT":
      if (analysis.estimatedStarvationTick !== null) {
        const ticks = analysis.estimatedStarvationTick - currentTick + 100;
        return Math.max(50, Math.min(5000, ticks));
      }
      return Math.max(50, STARVATION_IMMINENT_TICKS);
    case "QUEUE_GROWING":
      return DEFAULT_SPAWN_HORIZON;
    case "ENERGY_LIMITED":
      return DEFAULT_SPAWN_HORIZON;
    case "CAPACITY_LIMITED":
      return DEFAULT_SPAWN_HORIZON;
    case "NO_DEMAND":
      return DEFAULT_SPAWN_HORIZON;
    default:
      return null;
  }
}

/**
 * 计算预测值。
 *
 * value = 预测窗口结束时的队列深度。
 * 高值 = 饥饿越严重。
 */
function computePredictedQueueDepth(
  analysis: SpawnAnalysis,
  input: SpawnStarvationInput,
  horizon: number,
): number {
  const targetTick = input.currentTick + horizon;

  // 用队列回归外推
  if (analysis.queueRegression) {
    const predicted = analysis.queueRegression.slope * targetTick + analysis.queueRegression.intercept;
    return Math.max(0, predicted);
  }

  // 无回归 → 用当前队列深度 + 均值趋势
  if (analysis.queueMean !== null) {
    // 如果队列趋势上升，预测值增加
    const trendAdjustment = analysis.queueTrend === "up"
      ? analysis.queueMean * (horizon / 100) * 0.5
      : 0;
    return Math.max(0, input.currentQueueDepth + trendAdjustment);
  }

  return input.currentQueueDepth;
}

// ═══════════════════════════════════════════════════════════
// §7. Evidence Builder
// ═══════════════════════════════════════════════════════════

/**
 * 为 Spawn Starvation Prediction 构建证据链。
 */
function buildSpawnEvidence(
  input: SpawnStarvationInput,
  analysis: SpawnAnalysis,
  queueSamples: TimeSeriesPoint<number>[],
  populationSamples: TimeSeriesPoint<number>[],
  regimeCompat: RegimeCompatibility,
): PredictionEvidence {
  const sources: string[] = [];

  // TimeSeries 源
  sources.push(timeSeriesSourceRef("queueDepthHistory", input.queueDepthHistory));
  sources.push(timeSeriesSourceRef("populationHistory", input.populationHistory));

  // Metric 源
  sources.push(metricSourceRef("currentQueueDepth", input.currentQueueDepth));
  sources.push(metricSourceRef("currentEnergy", input.currentEnergy));
  sources.push(metricSourceRef("currentPopulation", input.currentPopulation));
  sources.push(metricSourceRef("spawnCapacity", input.spawnCapacity));
  sources.push(metricSourceRef("minSpawnEnergy", input.minSpawnEnergy));
  if (analysis.queueMean !== null) {
    sources.push(metricSourceRef("queueMean", analysis.queueMean));
  }
  if (analysis.populationMean !== null) {
    sources.push(metricSourceRef("populationMean", analysis.populationMean));
  }
  if (analysis.estimatedStarvationTick !== null) {
    sources.push(metricSourceRef("estimatedStarvationTick", analysis.estimatedStarvationTick));
  }
  sources.push(metricSourceRef("severity", analysis.severity));
  sources.push(metricSourceRef("energyAvailability", analysis.energyAvailability));
  sources.push(metricSourceRef("capacityUtilization", analysis.capacityUtilization));
  sources.push(metricSourceRef("demandPressure", analysis.demandPressure));
  if (input.spawnHealthScore !== undefined) {
    sources.push(metricSourceRef("spawnHealthScore", input.spawnHealthScore));
  }
  if (input.activeSpawnCount !== undefined) {
    sources.push(metricSourceRef("activeSpawnCount", input.activeSpawnCount));
  }
  if (input.p0RequestCount !== undefined) {
    sources.push(metricSourceRef("p0RequestCount", input.p0RequestCount));
  }

  // Experience 源
  if (input.experiences) {
    for (const exp of input.experiences) {
      if (exp.identity.type === "spawn" || exp.identity.type === "recovery") {
        sources.push(experienceSourceRef(exp));
      }
    }
  }

  // 模型参数
  const modelParams: Record<string, number | string> = {
    modelVersion: SPAWN_STARVATION_MODEL_VERSION,
    method: "threshold-projection",
    queueSlope: analysis.queueRegression?.slope ?? 0,
    populationSlope: analysis.populationRegression?.slope ?? 0,
    queueR2: analysis.queueRegression?.r2 ?? 0,
    populationR2: analysis.populationRegression?.r2 ?? 0,
    status: analysis.status,
    sampleCount: Math.min(queueSamples.length, populationSamples.length),
  };

  // 采样范围
  const oldestTick = Math.min(
    queueSamples.length > 0 ? queueSamples[0]!.tick : input.currentTick,
    populationSamples.length > 0 ? populationSamples[0]!.tick : input.currentTick,
  );
  const newestTick = Math.max(
    queueSamples.length > 0 ? queueSamples[queueSamples.length - 1]!.tick : input.currentTick,
    populationSamples.length > 0 ? populationSamples[populationSamples.length - 1]!.tick : input.currentTick,
  );

  return buildPredictionEvidence({
    sources,
    modelParams,
    sampleRange: {
      oldestTick,
      newestTick,
      count: Math.min(queueSamples.length, populationSamples.length),
    },
    regimeCompatibility: {
      compatible: regimeCompat.compatible,
      mismatchedDimensions: regimeCompat.mismatchedDimensions,
      confidenceMultiplier: regimeCompat.confidenceMultiplier,
    },
  });
}

// ═══════════════════════════════════════════════════════════
// §8. Utility Exports
// ═══════════════════════════════════════════════════════════

/**
 * 获取 Spawn Starvation Prediction 的分析摘要。
 *
 * 用于可观测性 — 不产出 Prediction，只返回分析结果。
 * 纯函数。
 */
export function analyzeSpawnStarvation(input: SpawnStarvationInput): {
  status: SpawnStarvationStatus;
  severity: number;
  queueTrend: "up" | "down" | "flat" | null;
  populationTrend: "up" | "down" | "flat" | null;
  estimatedStarvationTick: number | null;
  energyAvailability: number;
  capacityUtilization: number;
  demandPressure: number;
  queueMean: number | null;
  populationMean: number | null;
  sampleCount: number;
} {
  const queueSamples = allSamples(input.queueDepthHistory);
  const populationSamples = allSamples(input.populationHistory);

  if (queueSamples.length < SPAWN_MIN_SAMPLES || populationSamples.length < SPAWN_MIN_SAMPLES) {
    return {
      status: "NO_DEMAND",
      severity: 0,
      queueTrend: null,
      populationTrend: null,
      estimatedStarvationTick: null,
      energyAvailability: 0,
      capacityUtilization: 0,
      demandPressure: 0,
      queueMean: null,
      populationMean: null,
      sampleCount: 0,
    };
  }

  const analysis = analyzeSpawnTimeSeries(input, queueSamples, populationSamples);

  return {
    status: analysis.status,
    severity: analysis.severity,
    queueTrend: analysis.queueTrend,
    populationTrend: analysis.populationTrend,
    estimatedStarvationTick: analysis.estimatedStarvationTick,
    energyAvailability: analysis.energyAvailability,
    capacityUtilization: analysis.capacityUtilization,
    demandPressure: analysis.demandPressure,
    queueMean: analysis.queueMean,
    populationMean: analysis.populationMean,
    sampleCount: Math.min(queueSamples.length, populationSamples.length),
  };
}
