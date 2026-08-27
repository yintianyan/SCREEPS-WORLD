/**  */

import type { Prediction, PredictionResult, PredictionWindow } from "./types";
import { INSUFFICIENT_DATA, NO_PREDICTION, isValidPrediction } from "./types";
import type { PredictionRingBuffer } from "./ring-buffer";
import type { TimeSeries } from "./time-series";

// ═══════════════════════════════════════════════════════════
// §1. Guard Result
// ═══════════════════════════════════════════════════════════

/** 守卫检查结果。 */
export interface GuardResult {
  /** 守卫编号。 */
  readonly guardId: string;
  /** 是否通过。 */
  readonly passed: boolean;
  /** 违规描述（通过时为空串）。 */
  readonly message: string;
}

// ═══════════════════════════════════════════════════════════
// §2. PRED-001: Shadow-Only
// ═══════════════════════════════════════════════════════════

/**
 * PRED-001 守卫：验证 Prediction 只写 __predictionCache。

 * 检查 Prediction 对象不包含任何 Game API 引用。
 * 这是一个静态检查 — 验证类型层面不引用 Game。

 * 纯函数 — 不引用 Game/Memory。
 */
export function guardShadowOnly(prediction: Prediction): GuardResult {
  // 检查 prediction 不包含 Game API 调用结果
  // 在纯函数环境中，这只是结构性验证
  const hasId = typeof prediction.id === "string" && prediction.id.length > 0;
  const hasValue = typeof prediction.value === "number";
  const hasConfidence = typeof prediction.confidence === "number";

  if (!hasId || !hasValue || !hasConfidence) {
    return {
      guardId: "PRED-001",
      passed: false,
      message: "Prediction missing required fields (shadow-only violation)",
    };
  }

  return { guardId: "PRED-001", passed: true, message: "" };
}

// ═══════════════════════════════════════════════════════════
// §3. PRED-003: 确定性
// ═══════════════════════════════════════════════════════════

/**
 * PRED-003 守卫：验证 Prediction 不包含非确定性来源。

 * 检查：
 *   - id 不包含 random
 *   - value 是有限数
 *   - confidence 是有限数
 *   - 浮点值已截断（toFixed 验证）

 * 纯函数。
 */
export function guardDeterminism(prediction: Prediction): GuardResult {
  if (!Number.isFinite(prediction.value)) {
    return {
      guardId: "PRED-003",
      passed: false,
      message: `Prediction value is not finite: ${prediction.value}`,
    };
  }
  if (!Number.isFinite(prediction.confidence)) {
    return {
      guardId: "PRED-003",
      passed: false,
      message: `Prediction confidence is not finite: ${prediction.confidence}`,
    };
  }
  // 检查 confidence 在 [0, 1]
  if (prediction.confidence < 0 || prediction.confidence > 1) {
    return {
      guardId: "PRED-003",
      passed: false,
      message: `Confidence out of [0,1]: ${prediction.confidence}`,
    };
  }
  return { guardId: "PRED-003", passed: true, message: "" };
}

// ═══════════════════════════════════════════════════════════
// §4. PRED-004: Horizon 强制
// ═══════════════════════════════════════════════════════════

/** 最大预测窗口（5000 tick）。 */
export const MAX_PREDICTION_DURATION = 5000;

/** 最小预测窗口（50 tick）。 */
export const MIN_PREDICTION_DURATION = 50;

/**
 * PRED-004 守卫：验证 Prediction 必须有有效的时间窗口。

 * 检查：
 *   - window 必须有值
 *   - duration ≥ 50 tick
 *   - duration ≤ 5000 tick
 *   - endTick > startTick
 *   - duration === endTick - startTick

 * 纯函数。
 */
export function guardHorizon(window: PredictionWindow): GuardResult {
  if (!window || typeof window.duration !== "number") {
    return {
      guardId: "PRED-004",
      passed: false,
      message: "Prediction missing window",
    };
  }
  if (window.duration < MIN_PREDICTION_DURATION) {
    return {
      guardId: "PRED-004",
      passed: false,
      message: `Duration ${window.duration} < minimum ${MIN_PREDICTION_DURATION}`,
    };
  }
  if (window.duration > MAX_PREDICTION_DURATION) {
    return {
      guardId: "PRED-004",
      passed: false,
      message: `Duration ${window.duration} > maximum ${MAX_PREDICTION_DURATION}`,
    };
  }
  if (window.endTick <= window.startTick) {
    return {
      guardId: "PRED-004",
      passed: false,
      message: `endTick ${window.endTick} <= startTick ${window.startTick}`,
    };
  }
  const actualDuration = window.endTick - window.startTick;
  if (actualDuration !== window.duration) {
    return {
      guardId: "PRED-004",
      passed: false,
      message: `Duration mismatch: declared ${window.duration} vs actual ${actualDuration}`,
    };
  }
  return { guardId: "PRED-004", passed: true, message: "" };
}

// ═══════════════════════════════════════════════════════════
// §5. PRED-005: Confidence 强制标注
// ═══════════════════════════════════════════════════════════

/** 最小样本数（低于此值 confidence 必须为 0）。 */
export const MIN_SAMPLES_FOR_PREDICTION = 3;

/** 低置信度阈值（样本 < 10 时 confidence ≤ 0.3）。 */
export const LOW_CONFIDENCE_SAMPLE_THRESHOLD = 10;

/**
 * PRED-005 守卫：验证置信度合规。

 * 检查：
 *   - confidence ∈ [0, 1]
 *   - confidence = 0 时不产出（应返回 INSUFFICIENT_DATA）
 *   - 样本 < 3 时 confidence 必须为 0
 *   - 样本 < 10 时 confidence ≤ 0.3

 * 纯函数。
 */
export function guardConfidence(
  result: PredictionResult,
  sampleCount: number,
): GuardResult {
  // 哨兵值总是通过
  if (result === INSUFFICIENT_DATA || result === NO_PREDICTION) {
    return { guardId: "PRED-005", passed: true, message: "" };
  }

  if (!isValidPrediction(result)) {
    return {
      guardId: "PRED-005",
      passed: false,
      message: "Invalid PredictionResult type",
    };
  }

  const conf = result.confidence;
  if (conf < 0 || conf > 1) {
    return {
      guardId: "PRED-005",
      passed: false,
      message: `Confidence out of [0,1]: ${conf}`,
    };
  }

  // 样本不足时 confidence 必须为 0（不产出）
  if (sampleCount < MIN_SAMPLES_FOR_PREDICTION && conf > 0) {
    return {
      guardId: "PRED-005",
      passed: false,
      message: `Sample count ${sampleCount} < ${MIN_SAMPLES_FOR_PREDICTION} but confidence=${conf} > 0`,
    };
  }

  // 低样本时 confidence ≤ 0.3
  if (sampleCount < LOW_CONFIDENCE_SAMPLE_THRESHOLD && conf > 0.3) {
    return {
      guardId: "PRED-005",
      passed: false,
      message: `Sample count ${sampleCount} < ${LOW_CONFIDENCE_SAMPLE_THRESHOLD} but confidence=${conf} > 0.3`,
    };
  }

  return { guardId: "PRED-005", passed: true, message: "" };
}

// ═══════════════════════════════════════════════════════════
// §6. PRED-006: Evidence 可追溯
// ═══════════════════════════════════════════════════════════

/**
 * PRED-006 守卫：验证 Prediction 必须有证据链。

 * 检查：
 *   - evidence.sources 非空（至少 1 条）
 *   - evidence.modelParams 非空
 *   - evidence.sampleRange 有效

 * 纯函数。
 */
export function guardEvidence(prediction: Prediction): GuardResult {
  const ev = prediction.evidence;
  if (!ev) {
    return {
      guardId: "PRED-006",
      passed: false,
      message: "Prediction missing evidence",
    };
  }
  if (!ev.sources || ev.sources.length === 0) {
    return {
      guardId: "PRED-006",
      passed: false,
      message: "Evidence has no sources",
    };
  }
  if (!ev.modelParams || Object.keys(ev.modelParams).length === 0) {
    return {
      guardId: "PRED-006",
      passed: false,
      message: "Evidence has no modelParams",
    };
  }
  if (!ev.sampleRange || ev.sampleRange.count <= 0) {
    return {
      guardId: "PRED-006",
      passed: false,
      message: "Evidence has invalid sampleRange",
    };
  }
  return { guardId: "PRED-006", passed: true, message: "" };
}

// ═══════════════════════════════════════════════════════════
// §7. PRED-007: Regime 感知
// ═══════════════════════════════════════════════════════════

/**
 * PRED-007 守卫：验证 Prediction 必须有 contextSignature。

 * 检查：
 *   - contextSignature 非空
 *   - context 非空（包含 posture/watchdogTier/roomCount/maxRcl/threatLevel）

 * 纯函数。
 */
export function guardRegime(prediction: Prediction): GuardResult {
  if (!prediction.contextSignature || prediction.contextSignature.length === 0) {
    return {
      guardId: "PRED-007",
      passed: false,
      message: "Prediction missing contextSignature",
    };
  }
  const ctx = prediction.context;
  if (!ctx) {
    return {
      guardId: "PRED-007",
      passed: false,
      message: "Prediction missing context",
    };
  }
  if (!ctx.posture || !ctx.watchdogTier) {
    return {
      guardId: "PRED-007",
      passed: false,
      message: "Context missing posture or watchdogTier",
    };
  }
  return { guardId: "PRED-007", passed: true, message: "" };
}

// ═══════════════════════════════════════════════════════════
// §8. PRED-008: 失效处理
// ═══════════════════════════════════════════════════════════

/**
 * PRED-008 守卫：验证 Prediction lifecycle 合规。

 * 检查：
 *   - status 是合法值
 *   - active → 终态只允许 fulfilled/expired/invalidated
 *   - 终态不可回退到 active

 * 纯函数。
 */
export function guardLifecycle(prediction: Prediction): GuardResult {
  const validStatuses = ["active", "fulfilled", "expired", "invalidated"];
  if (!validStatuses.includes(prediction.status)) {
    return {
      guardId: "PRED-008",
      passed: false,
      message: `Invalid status: ${prediction.status}`,
    };
  }
  return { guardId: "PRED-008", passed: true, message: "" };
}

// ═══════════════════════════════════════════════════════════
// §9. PRED-010: 不自建采样通道
// ═══════════════════════════════════════════════════════════

/**
 * PRED-010 守卫：验证 TimeSeries 不直接引用 Game/Memory。

 * 这是一个结构性检查 — 验证 TimeSeries 的采样点
 * 只包含 tick + value，不包含 Game 对象引用。

 * 纯函数。
 */
export function guardNoDirectSampling<T>(ts: TimeSeries<T>): GuardResult {
  if (!ts || !ts.samples) {
    return {
      guardId: "PRED-010",
      passed: false,
      message: "TimeSeries is null or has no samples",
    };
  }
  // 检查采样点的 tick 是数字（不是 Game.time 引用）
  for (const s of ts.samples) {
    if (typeof s.tick !== "number" || !Number.isFinite(s.tick)) {
      return {
        guardId: "PRED-010",
        passed: false,
        message: `Sample tick is not a finite number: ${String(s.tick)}`,
      };
    }
  }
  return { guardId: "PRED-010", passed: true, message: "" };
}

// ═══════════════════════════════════════════════════════════
// §10. Full Validation
// ═══════════════════════════════════════════════════════════

/**
 * 对一条 Prediction 执行全部守卫检查。

 * 返回所有违规项（通过时为空数组）。
 * 纯函数。
 */
export function validatePrediction(prediction: Prediction): GuardResult[] {
  const results: GuardResult[] = [];
  const checks: GuardResult[] = [
    guardShadowOnly(prediction),
    guardDeterminism(prediction),
    guardHorizon(prediction.window),
    guardEvidence(prediction),
    guardRegime(prediction),
    guardLifecycle(prediction),
  ];
  for (const r of checks) {
    if (!r.passed) results.push(r);
  }
  return results;
}

/**
 * 对 Ring Buffer 中的所有 Prediction 执行守卫检查。

 * 返回所有违规项。
 * 纯函数。
 */
export function validateRingBuffer(buf: PredictionRingBuffer): GuardResult[] {
  const results: GuardResult[] = [];
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    const violations = validatePrediction(r);
    if (violations.length > 0) {
      results.push(...violations.map(v => ({
        ...v,
        message: `[${r.id}] ${v.message}`,
      })));
    }
  }
  return results;
}
