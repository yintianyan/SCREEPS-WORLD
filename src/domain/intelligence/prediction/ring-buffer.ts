/**
 * A6.3.1 PredictionRingBuffer — 预测结果环形缓冲。
 *
 * 职责：
 *   - 存储 Prediction 对象（固定长度环形覆盖）
 *   - 提供按 target / status 查询的接口
 *   - GC 清理过期预测
 *   - 追踪预测应验/失效（resolve）
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 * 所有运行时数据由调用方注入。
 *
 * Deterministic Replay：
 *   同一 Prediction 输入 → 相同的 Ring Buffer 状态。
 *   禁止 Math.random() / Date.now() / 无序迭代 / 浮点误差。
 *
 * Shadow-Only（PRED-001）：
 *   Ring Buffer 只做存储和查询，不执行 Game API。
 *
 * PRED-008：只负责记录 lifecycle，不执行 recommendation。
 */

import type { Prediction, PredictionStatus, PredictionTarget } from "./types";
import { isPredictionExpired } from "./types";

// ═══════════════════════════════════════════════════════════
// §1. PredictionRingBuffer
// ═══════════════════════════════════════════════════════════

/**
 * PredictionRingBuffer — 固定长度环形缓冲。
 *
 * 同构于 ExperienceRingBuffer / EvaluationRingBuffer。
 * 容量固定，超出时环形覆盖最旧数据。
 */
export interface PredictionRingBuffer {
  /** 底层数组。 */
  records: (Prediction | undefined)[];
  /** 容量。 */
  capacity: number;
  /** 当前条数。 */
  count: number;
  /** 总写入数（含覆盖）。 */
  totalWritten: number;
  /** 写入游标（环形覆盖位置）。 */
  cursor: number;
  /** 全局序列号（用于生成 Prediction ID）。 */
  seq: number;
}

/**
 * 创建 PredictionRingBuffer。
 *
 * 纯函数 — 返回新对象。
 */
export function createPredictionRingBuffer(capacity: number): PredictionRingBuffer {
  return {
    records: new Array(capacity).fill(undefined),
    capacity,
    count: 0,
    totalWritten: 0,
    cursor: 0,
    seq: 0,
  };
}

/**
 * 向 Ring Buffer 写入一条 Prediction（环形覆盖最旧数据）。
 *
 * 确定性：不使用 Math.random / Date.now。
 */
export function pushPrediction(buf: PredictionRingBuffer, prediction: Prediction): void {
  buf.records[buf.cursor] = prediction;
  buf.cursor = (buf.cursor + 1) % buf.capacity;
  buf.totalWritten++;
  if (buf.count < buf.capacity) buf.count++;
  buf.seq++;
}

// ═══════════════════════════════════════════════════════════
// §2. Query Interface
// ═══════════════════════════════════════════════════════════

/**
 * 获取最近的 N 条 Prediction（按 generatedAt 降序）。
 *
 * 确定性：遍历后排序，保证遍历顺序一致。
 */
export function getRecentPredictions(
  buf: PredictionRingBuffer,
  limit: number,
): Prediction[] {
  const result: Prediction[] = [];
  const start = (buf.cursor - 1 + buf.capacity) % buf.capacity;
  for (let i = 0; i < buf.count && i < limit; i++) {
    const idx = (start - i + buf.capacity) % buf.capacity;
    const r = buf.records[idx];
    if (r) result.push(r);
  }
  // 按 generatedAt 降序（最新优先）
  result.sort((a, b) => b.generatedAt - a.generatedAt);
  return result;
}

/**
 * 按 target 查询活跃预测。
 *
 * 返回所有 status="active" 且 target 匹配的 Prediction。
 * 确定性：遍历后排序（按 generatedAt 降序）。
 */
export function activeByTarget(
  buf: PredictionRingBuffer,
  target: PredictionTarget,
): Prediction[] {
  const result: Prediction[] = [];
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (r.status === "active" && r.target === target) {
      result.push(r);
    }
  }
  result.sort((a, b) => b.generatedAt - a.generatedAt);
  return result;
}

/**
 * 查询所有活跃预测。
 *
 * 确定性：遍历后排序（按 generatedAt 降序）。
 */
export function allActivePredictions(buf: PredictionRingBuffer): Prediction[] {
  const result: Prediction[] = [];
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (r.status === "active") {
      result.push(r);
    }
  }
  result.sort((a, b) => b.generatedAt - a.generatedAt);
  return result;
}

/**
 * 按 target 查询所有预测（不限 status）。
 *
 * 确定性：遍历后排序（按 generatedAt 降序）。
 */
export function byTarget(
  buf: PredictionRingBuffer,
  target: PredictionTarget,
): Prediction[] {
  const result: Prediction[] = [];
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (r.target === target) {
      result.push(r);
    }
  }
  result.sort((a, b) => b.generatedAt - a.generatedAt);
  return result;
}

// ═══════════════════════════════════════════════════════════
// §3. Lifecycle Resolution
// ═══════════════════════════════════════════════════════════

/**
 * 标记预测的终态（fulfilled / expired / invalidated）。
 *
 * PRED-008：只负责记录 lifecycle，不执行 recommendation。
 * 返回是否成功更新（如果 Prediction 不存在或已终态则返回 false）。
 *
 * 确定性：基于 prediction.id 匹配。
 */
export function resolvePrediction(
  buf: PredictionRingBuffer,
  predictionId: string,
  status: PredictionStatus,
): boolean {
  // 只允许终态转换
  if (status !== "fulfilled" && status !== "expired" && status !== "invalidated") {
    return false;
  }

  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (r.id === predictionId && r.status === "active") {
      buf.records[i] = { ...r, status };
      return true;
    }
  }
  return false;
}

/**
 * 批量处理已到期的 active 预测。
 *
 * 将 window.endTick < currentTick 的 active 预测标记为 "expired"。
 * PRED-008：lifecycle 管理，不执行 recommendation。
 *
 * 返回过期数量。
 */
export function expireOverduePredictions(
  buf: PredictionRingBuffer,
  currentTick: number,
): { expired: number } {
  let expired = 0;
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (r.status === "active" && isPredictionExpired(r, currentTick)) {
      buf.records[i] = { ...r, status: "expired" as PredictionStatus };
      expired++;
    }
  }
  return { expired };
}

// ═══════════════════════════════════════════════════════════
// §4. GC / TTL
// ═══════════════════════════════════════════════════════════

/**
 * 清理 Ring Buffer 中过老的记录。
 *
 * 删除超过 maxAge tick 的记录（设为 undefined）。
 * 不改变 cursor 位置，只释放空间。
 *
 * 确定性 GC：基于 prediction.generatedAt 判断。
 */
export function gcPredictionBuffer(
  buf: PredictionRingBuffer,
  currentTick: number,
  maxAge: number,
): { cleaned: number } {
  let cleaned = 0;
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (currentTick - r.generatedAt > maxAge) {
      buf.records[i] = undefined;
      cleaned++;
      if (buf.count > 0) buf.count--;
    }
  }
  return { cleaned };
}

// ═══════════════════════════════════════════════════════════
// §5. Stats / Observability
// ═══════════════════════════════════════════════════════════

/**
 * 统计 Ring Buffer 中的 Prediction 分布。
 *
 * 用于可观测性：各目标数量、活跃率、应验率。
 * 确定性：遍历后排序。
 */
export function predictionStats(buf: PredictionRingBuffer): {
  total: number;
  byTarget: Record<string, number>;
  byStatus: Record<string, number>;
  active: number;
  fulfilled: number;
  expired: number;
  invalidated: number;
  fulfillmentRate: number;
} {
  let total = 0;
  const byTarget: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let active = 0;
  let fulfilled = 0;
  let expired = 0;
  let invalidated = 0;

  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    total++;
    byTarget[r.target] = (byTarget[r.target] ?? 0) + 1;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    switch (r.status) {
      case "active": active++; break;
      case "fulfilled": fulfilled++; break;
      case "expired": expired++; break;
      case "invalidated": invalidated++; break;
    }
  }

  const resolved = fulfilled + expired + invalidated;
  const fulfillmentRate = resolved > 0
    ? Number((fulfilled / resolved).toFixed(3))
    : 0;

  return { total, byTarget, byStatus, active, fulfilled, expired, invalidated, fulfillmentRate };
}
