/**
 * A6.6 Lifecycle Manager — TTL / Supersede / GC 生命周期管理。
 *
 * 职责：
 *   - TTL 过期检测（expired）
 *   - Supersede 链管理（同 category+target 的新建议替代旧建议）
 *   - Regime 变化检测（contextSignature 不匹配 → 失效）
 *   - GC 清理超龄记录
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 *
 * REC-012：历史有界。
 * REC-013：TTL 强制执行。
 */

import type {
  RecommendationCandidate,
  RecommendationRingBuffer,
  RecommendationLifecycle,
} from "./types";
import { RECOMMENDATION_MAX_AGE } from "./types";

// ═══════════════════════════════════════════════════════════
// §1. TTL Expiry
// ═══════════════════════════════════════════════════════════

/**
 * 过期检测 — 标记 TTL 到期的 Recommendation 为 expired。
 *
 * REC-013：过期的 Recommendation 不得继续被视为 active。
 */
export function expireOverdueRecommendations(
  buf: RecommendationRingBuffer,
  currentTick: number,
): number {
  let expired = 0;
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (r.lifecycle !== "valid" && r.lifecycle !== "created") continue;

    if (currentTick > r.validity.expiresTick) {
      buf.records[i] = {
        ...r,
        lifecycle: "expired",
      };
      expired++;
    }
  }
  return expired;
}

/**
 * Regime 变化检测 — contextSignature 不匹配 → 标记 expired。
 *
 * 当帝国 posture 从 peace 变为 war 时，所有基于 peace 的建议应失效。
 */
export function expireByRegimeChange(
  buf: RecommendationRingBuffer,
  currentContextSignature: string,
): number {
  let expired = 0;
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (r.lifecycle !== "valid" && r.lifecycle !== "created") continue;

    if (r.contextSignature !== currentContextSignature) {
      buf.records[i] = {
        ...r,
        lifecycle: "expired",
      };
      expired++;
    }
  }
  return expired;
}

// ═══════════════════════════════════════════════════════════
// §2. Supersede Management
// ═══════════════════════════════════════════════════════════

/**
 * Supersede 处理 — 同 category+target 的新建议替代旧建议。
 *
 * 旧建议标记为 superseded，记录 supersededBy。
 * 新建议记录 supersedes（前驱 ID）。
 *
 * 不删除历史关系。
 */
export function processSupersession(
  buf: RecommendationRingBuffer,
  newRec: RecommendationCandidate,
): RecommendationCandidate {
  // 查找同 category + target 的 active 建议
  const toSupersede: RecommendationCandidate[] = [];
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (r.lifecycle !== "valid" && r.lifecycle !== "created") continue;
    if (r.category === newRec.category && r.target === newRec.target) {
      toSupersede.push(r);
    }
  }

  if (toSupersede.length === 0) {
    return newRec;
  }

  // 按创建时间排序，取最近的作为直接前驱
  toSupersede.sort((a, b) => b.createdAt - a.createdAt);
  const predecessor = toSupersede[0]!;

  // 标记旧建议为 superseded
  for (let i = 0; i < buf.records.length; i++) {
    if (buf.records[i]?.recommendationId === predecessor.recommendationId) {
      buf.records[i] = {
        ...buf.records[i]!,
        lifecycle: "superseded" as RecommendationLifecycle,
        supersededBy: newRec.recommendationId,
      };
      break;
    }
  }

  // 新建议记录前驱
  return {
    ...newRec,
    supersedes: predecessor.recommendationId,
    lifecycle: "valid" as RecommendationLifecycle,
  };
}

/**
 * 将新创建的 Recommendation 从 created 状态转为 valid。
 */
export function validateRecommendation(
  rec: RecommendationCandidate,
): RecommendationCandidate {
  if (rec.lifecycle !== "created") return rec;
  return {
    ...rec,
    lifecycle: "valid" as RecommendationLifecycle,
  };
}

// ═══════════════════════════════════════════════════════════
// §3. GC (Garbage Collection)
// ═══════════════════════════════════════════════════════════

/**
 * GC 清理超龄记录。
 *
 * REC-012：确保历史有界，不会无限增长。
 */
export function gcRecommendationBuffer(
  buf: RecommendationRingBuffer,
  currentTick: number,
  maxAge: number = RECOMMENDATION_MAX_AGE,
): { cleaned: number; conflictsCleaned: number } {
  let cleaned = 0;

  // 清理超龄的 records
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (currentTick - r.createdAt > maxAge) {
      buf.records[i] = undefined;
      cleaned++;
      if (buf.count > 0) buf.count--;
    }
  }

  // 清理超龄的 conflicts
  let conflictsCleaned = 0;
  for (let i = 0; i < buf.conflicts.length; i++) {
    const c = buf.conflicts[i];
    if (!c) continue;
    if (currentTick - c.detectedAt > maxAge) {
      buf.conflicts[i] = undefined;
      conflictsCleaned++;
      if (buf.conflictCount > 0) buf.conflictCount--;
    }
  }

  return { cleaned, conflictsCleaned };
}

// ═══════════════════════════════════════════════════════════
// §4. Ring Buffer Operations
// ═══════════════════════════════════════════════════════════

/**
 * 向 Ring Buffer 写入一条 Recommendation（环形覆盖最旧数据）。
 */
export function pushRecommendation(
  buf: RecommendationRingBuffer,
  rec: RecommendationCandidate,
): void {
  buf.records[buf.cursor] = rec;
  buf.cursor = (buf.cursor + 1) % buf.capacity;
  buf.totalWritten++;
  if (buf.count < buf.capacity) buf.count++;
}

/**
 * 向 Ring Buffer 写入一条 Conflict（环形覆盖最旧数据）。
 */
export function pushConflict(
  buf: RecommendationRingBuffer,
  conflict: RecommendationConflict,
): void {
  buf.conflicts[buf.conflictCursor] = conflict;
  buf.conflictCursor = (buf.conflictCursor + 1) % buf.conflictCapacity;
  if (buf.conflictCount < buf.conflictCapacity) buf.conflictCount++;
}

/**
 * 获取所有 active (valid/created) 的 Recommendations。
 */
export function getActiveRecommendations(
  buf: RecommendationRingBuffer,
): RecommendationCandidate[] {
  const result: RecommendationCandidate[] = [];
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (r.lifecycle === "valid" || r.lifecycle === "created") {
      result.push(r);
    }
  }
  // 按 recommendationId 排序确保确定性
  result.sort((a, b) => a.recommendationId.localeCompare(b.recommendationId));
  return result;
}

/**
 * 获取最近的 N 条 Recommendation（不限 lifecycle）。
 */
export function getRecentRecommendations(
  buf: RecommendationRingBuffer,
  limit: number,
): RecommendationCandidate[] {
  const result: RecommendationCandidate[] = [];
  const start = (buf.cursor - 1 + buf.capacity) % buf.capacity;
  for (let i = 0; i < buf.count && i < limit; i++) {
    const idx = (start - i + buf.capacity) % buf.capacity;
    const r = buf.records[idx];
    if (r) result.push(r);
  }
  return result;
}

/**
 * 获取所有活跃冲突。
 */
export function getActiveConflicts(
  buf: RecommendationRingBuffer,
): RecommendationConflict[] {
  const result: RecommendationConflict[] = [];
  for (let i = 0; i < buf.conflicts.length; i++) {
    const c = buf.conflicts[i];
    if (c) result.push(c);
  }
  result.sort((a, b) => a.conflictId.localeCompare(b.conflictId));
  return result;
}

/**
 * 统计 Ring Buffer 中的 Recommendation 分布。
 */
export function recommendationStats(buf: RecommendationRingBuffer): {
  total: number;
  active: number;
  expired: number;
  superseded: number;
  rejected: number;
  accepted: number;
  conflicts: number;
} {
  let active = 0;
  let expired = 0;
  let superseded = 0;
  let rejected = 0;
  let accepted = 0;

  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    switch (r.lifecycle) {
      case "valid":
      case "created":
        active++;
        break;
      case "expired":
        expired++;
        break;
      case "superseded":
        superseded++;
        break;
      case "rejected":
        rejected++;
        break;
      case "accepted":
        accepted++;
        break;
    }
  }

  return {
    total: buf.count,
    active,
    expired,
    superseded,
    rejected,
    accepted,
    conflicts: buf.conflictCount,
  };
}

// 导入 RecommendationConflict 类型用于 pushConflict
import type { RecommendationConflict } from "./types";
