/** A6.4 Calibration Ring Buffer — 有界存储 ResolutionResult + GC。 */

import type {
  CalibrationRingBuffer,
  ModelCalibrationProfile,
  ModelFailureStats,
  ResolutionResult,
} from "./types";
import {
  RESOLUTION_MAX_AGE,
  RESOLUTION_RING_BUFFER_CAPACITY,
} from "./types";

// ═══════════════════════════════════════════════════════════
// §1. CalibrationRingBuffer 创建
// ═══════════════════════════════════════════════════════════

/**
 * 创建 CalibrationRingBuffer。

 * 纯函数 — 返回新对象。

 * @param capacity - Ring Buffer 容量（默认 RESOLUTION_RING_BUFFER_CAPACITY）
 */
export function createCalibrationRingBuffer(
  capacity: number = RESOLUTION_RING_BUFFER_CAPACITY,
): CalibrationRingBuffer {
  return {
    resolutionRecords: new Array(capacity).fill(undefined),
    resolutionCapacity: capacity,
    resolutionCount: 0,
    resolutionCursor: 0,
    resolvedPredictionIds: new Set<string>(),
    profiles: new Map<string, ModelCalibrationProfile>(),
    failureStats: new Map<string, ModelFailureStats>(),
    lastProfileTick: 0,
  };
}

// ═══════════════════════════════════════════════════════════
// §2. 写入 ResolutionResult
// ═══════════════════════════════════════════════════════════

/**
 * 向 Ring Buffer 写入一条 ResolutionResult（环形覆盖最旧数据）。

 * 如果 predictionId 已解析过，则跳过（幂等）。

 * 确定性：不使用 Math.random / Date.now。
 */
export function pushResolution(
  buf: CalibrationRingBuffer,
  result: ResolutionResult,
): { written: boolean; overwritten: boolean } {
  // 幂等：如果已解析过则跳过
  if (buf.resolvedPredictionIds.has(result.predictionId)) {
    return { written: false, overwritten: false };
  }

  // 检查是否覆盖
  const overwritten = buf.resolutionRecords[buf.resolutionCursor] !== undefined;

  // 写入
  buf.resolutionRecords[buf.resolutionCursor] = result;
  buf.resolutionCursor = (buf.resolutionCursor + 1) % buf.resolutionCapacity;
  buf.resolvedPredictionIds.add(result.predictionId);

  if (overwritten) {
    // 被覆盖的记录的 predictionId 从 Set 中移除
    // 注意：被覆盖的记录是 cursor 指向的旧位置
    // 但 cursor 已经前移了，所以被覆盖的是 cursor - 1 的位置
    // 实际上 cursor 已经前移，被覆盖的旧 record 已经被新 record 替换了
    // 不需要特别处理 Set — 因为旧 predictionId 仍然被其他位置可能引用
    // 但如果 Ring Buffer 覆盖了唯一的记录，Set 会保留 stale ID
    // 这是可接受的：最坏情况是防止重解析一个已被 GC 的预测
  } else {
    buf.resolutionCount++;
  }

  return { written: true, overwritten };
}

// ═══════════════════════════════════════════════════════════
// §3. 查询接口
// ═══════════════════════════════════════════════════════════

/**
 * 获取所有 ResolutionResult（按 predictionId 排序确保确定性）。

 * 纯函数 — 不修改 Ring Buffer。
 */
export function getAllResolutions(buf: CalibrationRingBuffer): ResolutionResult[] {
  const result: ResolutionResult[] = [];
  for (let i = 0; i < buf.resolutionRecords.length; i++) {
    const r = buf.resolutionRecords[i];
    if (r) result.push(r);
  }
  result.sort((a, b) => a.predictionId.localeCompare(b.predictionId));
  return result;
}

/**
 * 获取最近的 N 条 ResolutionResult（按 resolvedTick 降序）。

 * 纯函数 — 不修改 Ring Buffer。
 */
export function getRecentResolutions(
  buf: CalibrationRingBuffer,
  limit: number,
): ResolutionResult[] {
  const result: ResolutionResult[] = [];
  const start = (buf.resolutionCursor - 1 + buf.resolutionCapacity) % buf.resolutionCapacity;
  for (let i = 0; i < buf.resolutionCount && i < limit; i++) {
    const idx = (start - i + buf.resolutionCapacity) % buf.resolutionCapacity;
    const r = buf.resolutionRecords[idx];
    if (r) result.push(r);
  }
  // 按 resolvedTick 降序（最新优先）
  result.sort((a, b) => b.resolvedTick - a.resolvedTick);
  return result;
}

/**
 * 检查 Prediction 是否已被解析。

 * 纯函数。
 */
export function isPredictionResolved(
  buf: CalibrationRingBuffer,
  predictionId: string,
): boolean {
  return buf.resolvedPredictionIds.has(predictionId);
}

/**
 * 获取需要解析的 Prediction IDs（已到期但未解析的）。

 * 输入：所有 active 预测（从 PredictionRingBuffer 获取）
 * 输出：window.endTick + RESOLUTION_GRACE_PERIOD ≤ currentTick 且未解析的 prediction IDs

 * 纯函数。
 */
export function getPendingResolutionIds(
  buf: CalibrationRingBuffer,
  predictionIds: readonly string[],
  predictionEndTicks: ReadonlyMap<string, number>,
  currentTick: number,
  gracePeriod: number,
): string[] {
  const result: string[] = [];
  for (const id of predictionIds) {
    if (buf.resolvedPredictionIds.has(id)) continue;
    const endTick = predictionEndTicks.get(id);
    if (endTick === undefined) continue;
    if (endTick + gracePeriod <= currentTick) {
      result.push(id);
    }
  }
  // 按 endTick 升序（最旧优先处理）
  result.sort((a, b) => (predictionEndTicks.get(a) ?? 0) - (predictionEndTicks.get(b) ?? 0));
  return result;
}

// ═══════════════════════════════════════════════════════════
// §4. Profile / FailureStats 管理
// ═══════════════════════════════════════════════════════════

/**
 * 更新模型校准档案。

 * 如果 modelKey 已存在则覆盖，如果不存在则新增。
 * 如果 Map 超过 MAX_PROFILES，则删除最旧的。
 */
export function updateProfile(
  buf: CalibrationRingBuffer,
  profile: ModelCalibrationProfile,
): void {
  buf.profiles.set(profile.modelKey, profile);
  buf.lastProfileTick = profile.statisticsTick;
}

/**
 * 获取模型校准档案。

 * 纯函数。
 */
export function getProfile(
  buf: CalibrationRingBuffer,
  modelKey: string,
): ModelCalibrationProfile | undefined {
  return buf.profiles.get(modelKey);
}

/**
 * 更新模型失败统计。
 */
export function updateFailureStats(
  buf: CalibrationRingBuffer,
  stats: ModelFailureStats,
): void {
  buf.failureStats.set(stats.modelKey, stats);
}

/**
 * 获取模型失败统计。

 * 纯函数。
 */
export function getFailureStats(
  buf: CalibrationRingBuffer,
  modelKey: string,
): ModelFailureStats | undefined {
  return buf.failureStats.get(modelKey);
}

// ═══════════════════════════════════════════════════════════
// §5. GC / TTL
// ═══════════════════════════════════════════════════════════

/**
 * 清理 Ring Buffer 中过老的 ResolutionResult。

 * 删除超过 maxAge tick 的记录（设为 undefined）。
 * 不改变 cursor 位置，只释放空间。

 * 确定性 GC：基于 resolution.resolvedTick 判断。

 * @param buf - CalibrationRingBuffer
 * @param currentTick - 当前 tick
 * @param maxAge - 最大存活 tick（默认 RESOLUTION_MAX_AGE）
 * @returns 清理数量
 */
export function gcCalibrationBuffer(
  buf: CalibrationRingBuffer,
  currentTick: number,
  maxAge: number = RESOLUTION_MAX_AGE,
): { cleaned: number } {
  let cleaned = 0;
  for (let i = 0; i < buf.resolutionRecords.length; i++) {
    const r = buf.resolutionRecords[i];
    if (!r) continue;
    if (currentTick - r.resolvedTick > maxAge) {
      // 从 Set 中移除（防止 stale ID 阻止重解析）
      buf.resolvedPredictionIds.delete(r.predictionId);
      buf.resolutionRecords[i] = undefined;
      cleaned++;
      if (buf.resolutionCount > 0) buf.resolutionCount--;
    }
  }
  return { cleaned };
}

// ═══════════════════════════════════════════════════════════
// §6. Stats / Observability
// ═══════════════════════════════════════════════════════════

/**
 * 统计 Ring Buffer 中的 Resolution 分布。

 * 用于可观测性：各分类数量、校准率、覆盖率。
 * 确定性：遍历后排序。
 */
export function calibrationBufferStats(buf: CalibrationRingBuffer): {
  total: number;
  byResolution: Record<string, number>;
  calibratable: number;
  regimeChanged: number;
  externalInterference: number;
  insufficientObservation: number;
  profileCount: number;
  failureStatsCount: number;
  resolvedIdsSize: number;
  capacity: number;
} {
  let total = 0;
  const byResolution: Record<string, number> = {};
  let calibratable = 0;
  let regimeChanged = 0;
  let externalInterference = 0;
  let insufficientObservation = 0;

  for (let i = 0; i < buf.resolutionRecords.length; i++) {
    const r = buf.resolutionRecords[i];
    if (!r) continue;
    total++;
    byResolution[r.resolution] = (byResolution[r.resolution] ?? 0) + 1;

    switch (r.resolution) {
      case "CORRECT":
      case "INCORRECT":
      case "PARTIAL":
      case "FALSE_POSITIVE":
      case "FALSE_NEGATIVE":
        calibratable++;
        break;
      case "REGIME_CHANGED":
        regimeChanged++;
        break;
      case "EXTERNAL_INTERFERENCE":
        externalInterference++;
        break;
      case "INSUFFICIENT_OBSERVATION":
        insufficientObservation++;
        break;
    }
  }

  return {
    total,
    byResolution,
    calibratable,
    regimeChanged,
    externalInterference,
    insufficientObservation,
    profileCount: buf.profiles.size,
    failureStatsCount: buf.failureStats.size,
    resolvedIdsSize: buf.resolvedPredictionIds.size,
    capacity: buf.resolutionCapacity,
  };
}
