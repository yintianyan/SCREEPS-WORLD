/** 策略复盘 — 从历史遥测推导姿态参数调整建议的纯函数。 */

import { STRATEGY_BOUNDS, clampStrategyParam } from "../tuning/bounds";

/** 策略复盘输入。 */
export interface StrategyReviewInput {
  /** 姿态历史（tick + posture）。 */
  postureHistory: Array<{ tick: number; posture: string }>;
  /** 净流历史（最近 N 个采样点，旧→新）。 */
  netFlowHistory: number[];
  /** 储备历史。 */
  reserveHistory: number[];
  /** 健康度历史。 */
  healthHistory: Array<{ tick: number; level: string; score: number }>;
  /** No-Progress 检测结果。 */
  noProgress: { detected: boolean; stuckDimensions: string[] };
  /** Thrashing 检测结果。 */
  thrashing: { detected: boolean; type: string; frequency: number };
  /** 当前 tick。 */
  tick: number;
  /** 当前策略 override（用于读 oldValue + 冷却检查）。 */
  currentOverrides?: Record<string, StrategyOverrideEntry>;
  /** CONFIG.posture 默认值（用于读 oldValue 当 override 不存在时）。 */
  defaultPosture: Record<string, number>;
}

/** 单个策略 override 条目。 */
export interface StrategyOverrideEntry {
  /** override 值。 */
  value: number;
  /** 写入 tick（冷却检查用）。 */
  adjustedAt: number;
  /** 建议理由（诊断）。 */
  reason: string;
}

/** 策略复盘结果。 */
export interface StrategyReviewResult {
  /** 建议调整的参数列表。空 = 无建议。 */
  suggestions: StrategyParamSuggestion[];
  /** 复盘总结（人类可读，供日志/事件）。 */
  summary: string;
}

interface StrategyParamSuggestion {
  /** 参数路径，如 "posture.threatWindow"。 */
  param: string;
  /** 建议值。 */
  value: number;
  /** 当前值。 */
  oldValue: number;
  /** 建议理由。 */
  reason: string;
  /** 置信度（0..1）。 */
  confidence: number;
}

/** 策略复盘冷却（同一参数两次建议间的最小间隔 tick）。 */
const STRATEGY_COOLDOWN_TICKS = 5000;

/** 姿态振荡判定窗口（tick）。 */
const POSTURE_OSCILLATION_WINDOW = 1000;
/** 姿态振荡判定阈值（窗口内切换次数）。 */
const POSTURE_OSCILLATION_THRESHOLD = 3;

/** 长期健康判定窗口（采样点数，每 100t 一个采样 → 2000t）。 */
const SUSTAINED_HEALTHY_SAMPLES = 20;

/** 储备趋势上升判定窗口（最近 N 个采样点）。 */
const RESERVE_UPTREND_WINDOW = 10;

/**
 * 评估策略参数调整建议（纯函数，不访问 Game/Memory）。
 *
 * 规则：
 *   1. 姿态振荡 → 建议 minDwell 增加（防抖）
 *   2. No-Progress 且 netFlow 停滞 → 建议 expandMaxPressure 放宽
 *   3. Thrashing（姿态振荡型）→ 建议 warPatience 拉长
 *   4. 长期健康 + 储备上升 → 建议 expandMinBucket 降低（利用余量增长）
 *
 * 每个参数受 STRATEGY_BOUNDS 边界约束 + 冷却检查。
 */
export function reviewStrategy(input: StrategyReviewInput): StrategyReviewResult {
  const suggestions: StrategyParamSuggestion[] = [];
  const reasons: string[] = [];

  // ── 1. 姿态振荡检测 ──
  const recentPostures = input.postureHistory.filter(
    p => input.tick - p.tick <= POSTURE_OSCILLATION_WINDOW,
  );
  let postureSwitches = 0;
  for (let i = 1; i < recentPostures.length; i++) {
    if (recentPostures[i]!.posture !== recentPostures[i - 1]!.posture) {
      postureSwitches++;
    }
  }
  if (postureSwitches > POSTURE_OSCILLATION_THRESHOLD) {
    const param = "posture.minDwell";
    const oldVal = getCurrentValue(param, input);
    const newVal = clampStrategyParam(param, oldVal + 200);
    if (newVal !== oldVal && !isInStrategyCooldown(param, input, input.tick)) {
      suggestions.push({
        param,
        value: newVal,
        oldValue: oldVal,
        reason: `Posture oscillation: ${postureSwitches} switches in ${POSTURE_OSCILLATION_WINDOW}t → raise minDwell`,
        confidence: 0.7,
      });
      reasons.push(`posture_oscillation(${postureSwitches})`);
    }
  }

  // ── 2. No-Progress 稳态 ──
  if (input.noProgress.detected && input.noProgress.stuckDimensions.includes("netFlow")) {
    const param = "posture.expandMaxPressure";
    const oldVal = getCurrentValue(param, input);
    const newVal = clampStrategyParam(param, oldVal + 0.05);
    if (newVal !== oldVal && !isInStrategyCooldown(param, input, input.tick)) {
      suggestions.push({
        param,
        value: newVal,
        oldValue: oldVal,
        reason: `No-Progress on netFlow → relax expansion pressure gate`,
        confidence: 0.6,
      });
      reasons.push("no_progress_netFlow");
    }
  }

  // ── 3. Thrashing（姿态振荡型）──
  if (input.thrashing.detected && input.thrashing.type === "posture_oscillation") {
    const param = "posture.warPatience";
    const oldVal = getCurrentValue(param, input);
    const newVal = clampStrategyParam(param, oldVal + 1000);
    if (newVal !== oldVal && !isInStrategyCooldown(param, input, input.tick)) {
      suggestions.push({
        param,
        value: newVal,
        oldValue: oldVal,
        reason: `Thrashing(posture_oscillation) freq=${input.thrashing.frequency}/1000t → extend warPatience`,
        confidence: 0.65,
      });
      reasons.push("thrashing_posture");
    }
  }

  // ── 4. 长期健康 + 储备上升 → 降低扩张门槛 ──
  const recentHealth = input.healthHistory.slice(-SUSTAINED_HEALTHY_SAMPLES);
  const allHealthy =
    recentHealth.length >= SUSTAINED_HEALTHY_SAMPLES &&
    recentHealth.every(h => h.level === "healthy");
  const reserveUptrend = isReserveUptrend(input.reserveHistory);
  if (allHealthy && reserveUptrend) {
    const param = "posture.expandMinBucket";
    const oldVal = getCurrentValue(param, input);
    const newVal = clampStrategyParam(param, oldVal - 500);
    if (newVal !== oldVal && !isInStrategyCooldown(param, input, input.tick)) {
      suggestions.push({
        param,
        value: newVal,
        oldValue: oldVal,
        reason: `Sustained healthy(${SUSTAINED_HEALTHY_SAMPLES} samples) + reserve uptrend → lower expansion bucket gate`,
        confidence: 0.55,
      });
      reasons.push("sustained_healthy_growth");
    }
  }

  const summary = reasons.length > 0
    ? `strategy-review: ${reasons.join(", ")} → ${suggestions.length} suggestion(s)`
    : "strategy-review: no suggestions (stable)";

  return { suggestions, summary };
}

/** 读取参数当前值：优先 override，其次 CONFIG 默认。 */
function getCurrentValue(param: string, input: StrategyReviewInput): number {
  const override = input.currentOverrides?.[param];
  if (override !== undefined) return override.value;
  const key = param.replace("posture.", "");
  return input.defaultPosture[key] ?? 0;
}

/** 检查策略参数是否在冷却期内。 */
function isInStrategyCooldown(
  param: string,
  input: StrategyReviewInput,
  currentTick: number,
): boolean {
  const entry = input.currentOverrides?.[param];
  if (!entry) return false;
  return currentTick - entry.adjustedAt < STRATEGY_COOLDOWN_TICKS;
}

/** 判断储备趋势是否上升（最近 N 个采样点线性回归斜率 > 0）。 */
function isReserveUptrend(history: number[]): boolean {
  const recent = history.slice(-RESERVE_UPTREND_WINDOW);
  if (recent.length < RESERVE_UPTREND_WINDOW) return false;
  const slope = linearSlope(recent);
  return slope > 0;
}

/** 简单线性回归斜率。 */
function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i]! - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
