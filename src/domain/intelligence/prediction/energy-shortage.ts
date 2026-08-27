/** A6.3.2 Energy Shortage Prediction Model — 能量短缺预测。 */

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
 * 能量短缺预测状态分类。

 * 描述能量趋势的定性判断：
 *   STABLE — 净流在 0 附近，储备稳定
 *   IMPROVING — 净流上升，储备增加
 *   DEGRADING — 净流下降，储备减少但未到 shortage
 *   SHORTAGE_IMMINENT — 按当前趋势将在短期内进入 shortage
 *   SHORTAGE_PREDICTED — 按当前趋势将在预测窗口内进入 shortage
 */
export type EnergyShortageStatus =
  | "STABLE"
  | "IMPROVING"
  | "DEGRADING"
  | "SHORTAGE_IMMINENT"
  | "SHORTAGE_PREDICTED";

/**
 * Energy Shortage Prediction 输入。

 * 所有数据由系统层从 globalCache 注入，domain 不直接读 Game/Memory。
 */
export interface EnergyShortageInput {
  /** 净能量流历史时间序列（income - expense per 100t）。 */
  readonly netFlowHistory: TimeSeries<number>;
  /** 能量储备历史时间序列（storage + spawn + extensions 总和）。 */
  readonly reserveHistory: TimeSeries<number>;
  /** 当前能量储备快照值。 */
  readonly currentReserve: number;
  /** 能量短缺阈值（储备低于此值视为 shortage）。 */
  readonly shortageThreshold: number;
  /** 当前 tick（由系统层注入 Game.time）。 */
  readonly currentTick: number;
  /** 预测上下文（用于 ContextSignature + Regime compatibility）。 */
  readonly context: PredictionContext;
  /** 历史 ContextSignature（用于 Regime compatibility 检查）。如果无历史则与 context 相同。 */
  readonly historicalContext?: PredictionContext;
  /** 相关 Experience 记录（可选，用于 Evidence 追溯）。 */
  readonly experiences?: readonly ExperienceRecord[];
  /** 相关 EmpireHealth 能量维度分数（可选，0-1）。 */
  readonly energyHealthScore?: number;
  /** 外部能量注入量（可选，如市场购买/远矿运入）。 */
  readonly externalEnergyInflow?: number;
}

/**
 * Energy Shortage Prediction 内部分析结果。
 */
interface EnergyAnalysis {
  /** 净流回归结果。 */
  readonly netFlowRegression: { slope: number; intercept: number; r2: number; samples: number } | null;
  /** 储备回归结果。 */
  readonly reserveRegression: { slope: number; intercept: number; r2: number; samples: number } | null;
  /** 净流均值。 */
  readonly netFlowMean: number | null;
  /** 储备均值。 */
  readonly reserveMean: number | null;
  /** 当前净流趋势方向。 */
  readonly netFlowTrend: "up" | "down" | "flat" | null;
  /** 储备趋势方向。 */
  readonly reserveTrend: "up" | "down" | "flat" | null;
  /** 预计到达 shortage 的 tick 数（null = 不会到达）。 */
  readonly estimatedShortageTick: number | null;
  /** 短缺严重程度 (0-1)。 */
  readonly severity: number;
  /** 分析状态。 */
  readonly status: EnergyShortageStatus;
}

// ═══════════════════════════════════════════════════════════
// §2. Model Constants
// ═══════════════════════════════════════════════════════════

/** Energy Shortage 模型版本。 */
export const ENERGY_SHORTAGE_MODEL_VERSION = 1;

/** 默认预测窗口（1000 tick）。 */
export const DEFAULT_ENERGY_HORIZON = 1000;

/** 短缺紧迫阈值（预计在 200 tick 内进入 shortage）。 */
export const SHORTAGE_IMMINENT_TICKS = 200;

/** 净流趋势阈值（斜率绝对值小于此值视为 flat）。 */
export const NET_FLOW_TREND_THRESHOLD = 0.001;

/** 储备趋势阈值。 */
export const RESERVE_TREND_THRESHOLD = 0.01;

/** 最小样本数（低于此值返回 INSUFFICIENT_DATA）。 */
export const ENERGY_MIN_SAMPLES = 3;

/** 充分样本数（达到此值 confidence 可到 0.7+）。 */
export const ENERGY_SUFFICIENT_SAMPLES = 10;

// ═══════════════════════════════════════════════════════════
// §3. Core Prediction Function
// ═══════════════════════════════════════════════════════════

/**
 * 预测能量短缺。

 * 方法：trend-extrapolation
 *   1. 对净流历史做线性回归 → 趋势方向
 *   2. 对储备历史做线性回归 → 趋势方向
 *   3. 如果储备在下降，外推何时到达 shortageThreshold
 *   4. 计算短缺 severity 和 confidence
 *   5. 检查 Regime compatibility → 调整 confidence

 * PRED-005：数据不足时返回 INSUFFICIENT_DATA。
 * PRED-003：完全确定性。

 * 纯函数 — 不引用 Game/Memory。
 */
export function predictEnergyShortage(input: EnergyShortageInput): PredictionResult {
  // ── 数据充分性检查 ──
  const netFlowSamples = allSamples(input.netFlowHistory);
  const reserveSamples = allSamples(input.reserveHistory);

  if (netFlowSamples.length < ENERGY_MIN_SAMPLES || reserveSamples.length < ENERGY_MIN_SAMPLES) {
    return INSUFFICIENT_DATA;
  }

  // ── 分析时间序列 ──
  const analysis = analyzeEnergyTimeSeries(input, netFlowSamples, reserveSamples);

  // ── 如果无法分析趋势 ──
  if (!analysis.netFlowRegression && !analysis.reserveRegression) {
    return INSUFFICIENT_DATA;
  }

  // ── 计算预测窗口 ──
  const horizon = computeEnergyHorizon(analysis, input.currentTick);
  if (horizon === null) {
    // 无法确定 horizon → 不产出
    return INSUFFICIENT_DATA;
  }

  // ── 计算 confidence ──
  const baseConfidence = computeEnergyConfidence(analysis, netFlowSamples, reserveSamples, input.externalEnergyInflow);

  // ── Regime compatibility ──
  const historicalCtx = input.historicalContext ?? input.context;
  const regimeCompat = checkRegimeCompatibility(historicalCtx, input.context);
  const adjustedConfidence = applyRegimeMultiplier(baseConfidence, regimeCompat);

  // ── 如果 confidence = 0 → 不产出 ──
  if (adjustedConfidence <= 0) {
    return INSUFFICIENT_DATA;
  }

  // ── 计算预测值 ──
  // value = 预测窗口结束时的储备值（如果 < shortageThreshold 则为 shortage severity）
  const predictedValue = computePredictedReserve(analysis, input, horizon);

  // ── 构建 Evidence ──
  const evidence = buildEnergyEvidence(input, analysis, netFlowSamples, reserveSamples, regimeCompat);

  // ── 构建 Prediction ──
  const contextSignature = buildPredictionContextSignature(input.context);
  const predictionId = makePredictionId(input.currentTick, 0); // seq 由 Ring Buffer 分配

  const window: PredictionWindow = {
    startTick: input.currentTick,
    endTick: input.currentTick + horizon,
    duration: horizon,
  };

  const prediction: Prediction = {
    id: predictionId,
    generatedAt: input.currentTick,
    target: "energy-shortage",
    window,
    value: Number(predictedValue.toFixed(3)),
    confidence: adjustedConfidence,
    method: "trend-extrapolation" as PredictionMethod,
    evidence,
    modelVersion: ENERGY_SHORTAGE_MODEL_VERSION,
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
 * 分析能量时间序列。

 * 纯函数 — 确定性。
 */
function analyzeEnergyTimeSeries(
  input: EnergyShortageInput,
  netFlowSamples: TimeSeriesPoint<number>[],
  reserveSamples: TimeSeriesPoint<number>[],
): EnergyAnalysis {
  const netFlowRegression = linearRegression(input.netFlowHistory);
  const reserveRegression = linearRegression(input.reserveHistory);
  const netFlowMean = meanValue(input.netFlowHistory);
  const reserveMean = meanValue(input.reserveHistory);

  // 趋势方向
  const netFlowTrend = deriveTrend(netFlowRegression, NET_FLOW_TREND_THRESHOLD);
  const reserveTrend = deriveTrend(reserveRegression, RESERVE_TREND_THRESHOLD);

  // 预计何时进入 shortage
  const estimatedShortageTick = estimateShortageTick(
    reserveRegression,
    input.currentReserve,
    input.shortageThreshold,
    input.currentTick,
  );

  // 计算严重程度
  const severity = computeSeverity(
    input.currentReserve,
    input.shortageThreshold,
    estimatedShortageTick,
    input.currentTick,
    reserveTrend,
  );

  // 确定状态
  const status = determineEnergyStatus(
    netFlowTrend,
    reserveTrend,
    estimatedShortageTick,
    input.currentTick,
    input.currentReserve,
    input.shortageThreshold,
  );

  return {
    netFlowRegression,
    reserveRegression,
    netFlowMean,
    reserveMean,
    netFlowTrend,
    reserveTrend,
    estimatedShortageTick,
    severity,
    status,
  };
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
 * 估计何时进入 shortage。

 * 基于储备回归斜率外推。
 * 如果斜率 ≥ 0（储备不下降）→ null（不会进入 shortage）。

 * 注意：当前 reserve <= threshold 是 CURRENT_FACT，不是未来预测。
 * 只有当趋势也在下降（或无趋势数据）时，才认为当前已进入 shortage。
 * 如果趋势在改善（slope > 0），即使当前低于阈值，也不会外推出未来 shortage。
 */
function estimateShortageTick(
  reserveReg: { slope: number; intercept: number; r2: number } | null,
  currentReserve: number,
  shortageThreshold: number,
  currentTick: number,
): number | null {
  // 无回归数据 → 无法做趋势外推
  if (!reserveReg) {
    // 只能报告当前事实，不能预测未来
    return null;
  }

  // 储备在上升或不下降 → 不会进入 shortage
  if (reserveReg.slope >= 0) {
    return null;
  }

  // 外推：reserve(t) = slope * t + intercept
  // 求解 reserve(t) = shortageThreshold → t = (shortageThreshold - intercept) / slope
  // slope < 0 所以 t > currentTick
  if (Math.abs(reserveReg.slope) < 1e-10) return null;

  const shortageTick = (shortageThreshold - reserveReg.intercept) / reserveReg.slope;
  const roundedTick = Math.round(shortageTick);

  // 如果预计的 shortage tick 已过去 → 当前就在 shortage（趋势外推确认）
  if (roundedTick <= currentTick) {
    return currentTick;
  }

  return roundedTick;
}

/**
 * 计算短缺严重程度 (0-1)。

 * severity 基于趋势外推结果，不是当前快照：
 *   - 有 estimatedShortageTick → 按时间距离分级
 *   - 无 estimatedShortageTick（趋势不在恶化）→ severity = 0
 *   - 当前已低于阈值且趋势也在下降 → BOUNDARY_OVERRIDE，severity 加重

 * 禁止：currentReserve <= threshold 直接产生高 severity 而无视趋势。
 */
function computeSeverity(
  currentReserve: number,
  shortageThreshold: number,
  estimatedShortageTick: number | null,
  currentTick: number,
  reserveTrend: "up" | "down" | "flat" | null,
): number {
  // 如果预测会进入 shortage — 基于趋势外推结果
  if (estimatedShortageTick !== null && estimatedShortageTick > currentTick) {
    const ticksToShortage = estimatedShortageTick - currentTick;
    // 越接近 shortage 越严重
    if (ticksToShortage <= SHORTAGE_IMMINENT_TICKS) {
      // 200 tick 内 → 0.5-0.8
      const ratio = 1 - ticksToShortage / SHORTAGE_IMMINENT_TICKS;
      return Number((0.5 + ratio * 0.3).toFixed(3));
    }
    // 200-1000 tick → 0.2-0.5
    if (ticksToShortage <= DEFAULT_ENERGY_HORIZON) {
      const ratio = 1 - (ticksToShortage - SHORTAGE_IMMINENT_TICKS) / (DEFAULT_ENERGY_HORIZON - SHORTAGE_IMMINENT_TICKS);
      return Number((0.2 + ratio * 0.3).toFixed(3));
    }
    // 1000+ tick → 低严重度
    return 0.1;
  }

  // BOUNDARY_OVERRIDE：当前已低于阈值且趋势也在下降
  // 这是趋势外推确认的当前事实，不是纯快照判断
  if (currentReserve <= shortageThreshold && reserveTrend === "down") {
    if (shortageThreshold <= 0) return 1;
    const ratio = 1 - currentReserve / shortageThreshold;
    return Number(Math.min(1, Math.max(0.5, 0.5 + ratio * 0.5)).toFixed(3));
  }

  // 当前低于阈值但趋势在改善或平稳 → 不会进入未来 shortage
  // severity = 0（当前事实由 status 的 BOUNDARY_OVERRIDE 路径处理）
  return 0;
}

/**
 * 确定能量短缺状态。

 * 判定优先级：
 *   1. PROJECTED：estimatedShortageTick > currentTick → SHORTAGE_IMMINENT / SHORTAGE_PREDICTED
 *   2. TREND：reserveTrend / netFlowTrend → DEGRADING / IMPROVING
 *   3. BOUNDARY_OVERRIDE：当前已低于阈值且趋势也在下降 → SHORTAGE_PREDICTED
 *   4. BOUNDARY_OVERRIDE：当前已低于阈值但趋势在改善/平稳 → IMPROVING / STABLE

 * 禁止：currentReserve <= threshold 直接返回 SHORTAGE_PREDICTED 而无视趋势。
 */
function determineEnergyStatus(
  netFlowTrend: "up" | "down" | "flat" | null,
  reserveTrend: "up" | "down" | "flat" | null,
  estimatedShortageTick: number | null,
  currentTick: number,
  currentReserve: number,
  shortageThreshold: number,
): EnergyShortageStatus {
  // PROJECTED：趋势外推指向未来 shortage
  if (estimatedShortageTick !== null && estimatedShortageTick > currentTick) {
    const ticksToShortage = estimatedShortageTick - currentTick;
    if (ticksToShortage <= SHORTAGE_IMMINENT_TICKS) {
      return "SHORTAGE_IMMINENT";
    }
    if (ticksToShortage <= DEFAULT_ENERGY_HORIZON) {
      return "SHORTAGE_PREDICTED";
    }
  }

  // TREND：趋势判断
  if (reserveTrend === "down" || netFlowTrend === "down") {
    // BOUNDARY_OVERRIDE：当前已低于阈值且趋势在下降 → 确认 shortage
    if (currentReserve <= shortageThreshold) {
      return "SHORTAGE_PREDICTED";
    }
    return "DEGRADING";
  }

  if (reserveTrend === "up" || netFlowTrend === "up") {
    return "IMPROVING";
  }

  // 趋势平稳
  // BOUNDARY_OVERRIDE：当前已低于阈值但趋势平稳 → 仍在 shortage 但不在恶化
  if (currentReserve <= shortageThreshold) {
    return "SHORTAGE_PREDICTED";
  }

  return "STABLE";
}

// ═══════════════════════════════════════════════════════════
// §5. Confidence Calculation
// ═══════════════════════════════════════════════════════════

/**
 * 计算基础置信度（不含 Regime 调整）。

 * 因素：
 *   - 样本数（越多越高）
 *   - R² 拟合度（越高越高）
 *   - 外部能量注入（有则降低）
 */
function computeEnergyConfidence(
  analysis: EnergyAnalysis,
  netFlowSamples: TimeSeriesPoint<number>[],
  reserveSamples: TimeSeriesPoint<number>[],
  externalInflow?: number,
): number {
  const sampleCount = Math.min(netFlowSamples.length, reserveSamples.length);

  // 样本因子
  let sampleFactor: number;
  if (sampleCount < ENERGY_MIN_SAMPLES) {
    return 0;
  }
  if (sampleCount < ENERGY_SUFFICIENT_SAMPLES) {
    sampleFactor = 0.3 * (sampleCount / ENERGY_SUFFICIENT_SAMPLES);
  } else {
    sampleFactor = Math.min(1, 0.3 + 0.7 * (sampleCount / 50));
  }

  // R² 因子（取两个回归的最小 R²）
  const netFlowR2 = analysis.netFlowRegression?.r2 ?? 0;
  const reserveR2 = analysis.reserveRegression?.r2 ?? 0;
  const minR2 = Math.min(netFlowR2, reserveR2);
  const r2Factor = 0.3 + 0.7 * minR2;

  // 外部注入因子
  const externalFactor = externalInflow !== undefined && externalInflow > 0 ? 0.7 : 1.0;

  const confidence = sampleFactor * r2Factor * externalFactor;
  return Number(Math.min(0.95, Math.max(0, confidence)).toFixed(3));
}

// ═══════════════════════════════════════════════════════════
// §6. Horizon & Value Computation
// ═══════════════════════════════════════════════════════════

/**
 * 计算预测窗口。

 * - SHORTAGE_IMMINENT → 200 tick
 * - SHORTAGE_PREDICTED → 1000 tick
 * - DEGRADING → 1000 tick（观察趋势）
 * - STABLE / IMPROVING → 1000 tick（基线观察）
 */
function computeEnergyHorizon(
  analysis: EnergyAnalysis,
  currentTick: number,
): number | null {
  switch (analysis.status) {
    case "SHORTAGE_PREDICTED":
      if (analysis.estimatedShortageTick !== null) {
        // 窗口 = 到 shortage 的时间 + 100 tick 余量
        const ticks = analysis.estimatedShortageTick - currentTick + 100;
        return Math.max(50, Math.min(5000, ticks));
      }
      return DEFAULT_ENERGY_HORIZON;
    case "SHORTAGE_IMMINENT":
      return Math.max(50, SHORTAGE_IMMINENT_TICKS);
    case "DEGRADING":
      return DEFAULT_ENERGY_HORIZON;
    case "STABLE":
      return DEFAULT_ENERGY_HORIZON;
    case "IMPROVING":
      return DEFAULT_ENERGY_HORIZON;
    default:
      return null;
  }
}

/**
 * 计算预测值。

 * value 的含义：
 *   - 预测窗口结束时的储备值
 *   - 如果 < shortageThreshold → 表示短缺程度
 *   - 如果 ≥ shortageThreshold → 表示安全储备水平
 */
function computePredictedReserve(
  analysis: EnergyAnalysis,
  input: EnergyShortageInput,
  horizon: number,
): number {
  const targetTick = input.currentTick + horizon;

  // 用储备回归外推
  if (analysis.reserveRegression) {
    const predicted = analysis.reserveRegression.slope * targetTick + analysis.reserveRegression.intercept;
    // 如果预测值为负 → 0（储备不可能为负）
    return Math.max(0, predicted);
  }

  // 无回归 → 用当前储备 + 净流均值 * horizon
  if (analysis.netFlowMean !== null) {
    const predicted = input.currentReserve + analysis.netFlowMean * (horizon / 100);
    return Math.max(0, predicted);
  }

  // 无法预测 → 返回当前值
  return input.currentReserve;
}

// ═══════════════════════════════════════════════════════════
// §7. Evidence Builder
// ═══════════════════════════════════════════════════════════

/**
 * 为 Energy Shortage Prediction 构建证据链。
 */
function buildEnergyEvidence(
  input: EnergyShortageInput,
  analysis: EnergyAnalysis,
  netFlowSamples: TimeSeriesPoint<number>[],
  reserveSamples: TimeSeriesPoint<number>[],
  regimeCompat: RegimeCompatibility,
): PredictionEvidence {
  const sources: string[] = [];

  // TimeSeries 源
  sources.push(timeSeriesSourceRef("netFlowHistory", input.netFlowHistory));
  sources.push(timeSeriesSourceRef("reserveHistory", input.reserveHistory));

  // Metric 源
  sources.push(metricSourceRef("currentReserve", input.currentReserve));
  sources.push(metricSourceRef("shortageThreshold", input.shortageThreshold));
  if (analysis.netFlowMean !== null) {
    sources.push(metricSourceRef("netFlowMean", analysis.netFlowMean));
  }
  if (analysis.reserveMean !== null) {
    sources.push(metricSourceRef("reserveMean", analysis.reserveMean));
  }
  if (analysis.estimatedShortageTick !== null) {
    sources.push(metricSourceRef("estimatedShortageTick", analysis.estimatedShortageTick));
  }
  sources.push(metricSourceRef("severity", analysis.severity));
  if (input.energyHealthScore !== undefined) {
    sources.push(metricSourceRef("energyHealthScore", input.energyHealthScore));
  }
  if (input.externalEnergyInflow !== undefined && input.externalEnergyInflow > 0) {
    sources.push(metricSourceRef("externalEnergyInflow", input.externalEnergyInflow));
  }

  // Experience 源（如果提供）
  if (input.experiences) {
    for (const exp of input.experiences) {
      if (exp.identity.type === "economic" || exp.identity.type === "recovery") {
        sources.push(experienceSourceRef(exp));
      }
    }
  }

  // 模型参数
  const modelParams: Record<string, number | string> = {
    modelVersion: ENERGY_SHORTAGE_MODEL_VERSION,
    method: "trend-extrapolation",
    netFlowSlope: analysis.netFlowRegression?.slope ?? 0,
    reserveSlope: analysis.reserveRegression?.slope ?? 0,
    netFlowR2: analysis.netFlowRegression?.r2 ?? 0,
    reserveR2: analysis.reserveRegression?.r2 ?? 0,
    status: analysis.status,
    sampleCount: Math.min(netFlowSamples.length, reserveSamples.length),
  };

  // 采样范围
  const oldestTick = Math.min(
    netFlowSamples.length > 0 ? netFlowSamples[0]!.tick : input.currentTick,
    reserveSamples.length > 0 ? reserveSamples[0]!.tick : input.currentTick,
  );
  const newestTick = Math.max(
    netFlowSamples.length > 0 ? netFlowSamples[netFlowSamples.length - 1]!.tick : input.currentTick,
    reserveSamples.length > 0 ? reserveSamples[reserveSamples.length - 1]!.tick : input.currentTick,
  );

  return buildPredictionEvidence({
    sources,
    modelParams,
    sampleRange: {
      oldestTick,
      newestTick,
      count: Math.min(netFlowSamples.length, reserveSamples.length),
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
 * 获取 Energy Shortage Prediction 的分析摘要。

 * 用于可观测性 — 不产出 Prediction，只返回分析结果。
 * 纯函数。
 */
export function analyzeEnergyShortage(input: EnergyShortageInput): {
  status: EnergyShortageStatus;
  severity: number;
  netFlowTrend: "up" | "down" | "flat" | null;
  reserveTrend: "up" | "down" | "flat" | null;
  estimatedShortageTick: number | null;
  netFlowMean: number | null;
  reserveMean: number | null;
  sampleCount: number;
} {
  const netFlowSamples = allSamples(input.netFlowHistory);
  const reserveSamples = allSamples(input.reserveHistory);

  if (netFlowSamples.length < ENERGY_MIN_SAMPLES || reserveSamples.length < ENERGY_MIN_SAMPLES) {
    return {
      status: "STABLE",
      severity: 0,
      netFlowTrend: null,
      reserveTrend: null,
      estimatedShortageTick: null,
      netFlowMean: null,
      reserveMean: null,
      sampleCount: 0,
    };
  }

  const analysis = analyzeEnergyTimeSeries(input, netFlowSamples, reserveSamples);

  return {
    status: analysis.status,
    severity: analysis.severity,
    netFlowTrend: analysis.netFlowTrend,
    reserveTrend: analysis.reserveTrend,
    estimatedShortageTick: analysis.estimatedShortageTick,
    netFlowMean: analysis.netFlowMean,
    reserveMean: analysis.reserveMean,
    sampleCount: Math.min(netFlowSamples.length, reserveSamples.length),
  };
}
