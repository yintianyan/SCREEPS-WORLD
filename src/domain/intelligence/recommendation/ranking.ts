/**
 * A6.6 Ranking — 5-level Lexicographic ranking。
 *
 * 禁止 weighted average / single score / 万能 score。
 *
 * 排序维度（按优先级）：
 *   1. validity / safety（valid > expired > superseded > rejected）
 *   2. urgency（critical > high > medium > low > informational）
 *   3. confidence（高 → 低）
 *   4. evidence quality（evidence 数量多 → 少）
 *   5. deterministic tie-breaker（recommendationId 字典序）
 *
 * 确定性：相同输入 → 相同排序。
 * 禁止 Math.random / Date.now / 非确定遍历。
 */

import type {
  RecommendationCandidate,
  RecommendationLifecycle,
} from "./types";
import { URGENCY_ORDER } from "./types";

// ═══════════════════════════════════════════════════════════
// §1. Lifecycle Priority
// ═══════════════════════════════════════════════════════════

/**
 * 生命周期优先级 — 用于第一排序维度。
 *
 * valid(0) > created(1) > accepted(2) > expired(3) > superseded(4) > rejected(5)
 * 值越小优先级越高。
 */
const LIFECYCLE_ORDER: Readonly<Record<RecommendationLifecycle, number>> = {
  valid: 0,
  created: 1,
  accepted: 2,
  expired: 3,
  superseded: 4,
  rejected: 5,
} as const;

// ═══════════════════════════════════════════════════════════
// §2. Lexicographic Comparator
// ═══════════════════════════════════════════════════════════

/**
 * 5-level Lexicographic 比较器。
 *
 * 返回负数: a 优先于 b
 * 返回正数: b 优先于 a
 * 返回 0: 两者等价（此时 recommendationId 作为确定性 tie-breaker）
 *
 * 确定性保证：
 *   - 不使用 Math.random / Date.now
 *   - 所有比较基于 stable 字段
 *   - 最后的 tie-breaker 是字符串比较（localeCompare）
 */
export function compareRecommendations(
  a: RecommendationCandidate,
  b: RecommendationCandidate,
): number {
  // ── 1. validity / safety ──
  const lifecycleA = LIFECYCLE_ORDER[a.lifecycle] ?? 99;
  const lifecycleB = LIFECYCLE_ORDER[b.lifecycle] ?? 99;
  if (lifecycleA !== lifecycleB) {
    return lifecycleA - lifecycleB;
  }

  // ── 2. urgency ──
  const urgencyA = URGENCY_ORDER[a.urgency] ?? 99;
  const urgencyB = URGENCY_ORDER[b.urgency] ?? 99;
  if (urgencyA !== urgencyB) {
    return urgencyA - urgencyB;
  }

  // ── 3. confidence（高 → 低，即 b - a）──
  // 使用 toFixed(3) 消除浮点误差
  const confA = Number(a.confidence.toFixed(3));
  const confB = Number(b.confidence.toFixed(3));
  if (confA !== confB) {
    return confB - confA; // 降序
  }

  // ── 4. evidence quality（数量多 → 少）──
  const evidenceA = a.evidence.length;
  const evidenceB = b.evidence.length;
  if (evidenceA !== evidenceB) {
    return evidenceB - evidenceA; // 降序
  }

  // ── 5. deterministic tie-breaker ──
  return a.recommendationId.localeCompare(b.recommendationId);
}

/**
 * 对 Recommendations 排序（确定性 Lexicographic）。
 *
 * 返回新数组（不修改输入）。
 */
export function rankRecommendations(
  recommendations: readonly RecommendationCandidate[],
): RecommendationCandidate[] {
  // 先复制一份，然后排序
  const sorted = [...recommendations].sort(compareRecommendations);
  return sorted;
}

/**
 * 获取排名前 N 的 Recommendations。
 */
export function getTopRecommendations(
  recommendations: readonly RecommendationCandidate[],
  limit: number,
): RecommendationCandidate[] {
  const sorted = rankRecommendations(recommendations);
  return sorted.slice(0, Math.max(0, limit));
}

/**
 * 解释为什么 Recommendation A 排在 B 前面。
 *
 * 可观测性辅助函数。
 */
export function explainRanking(
  a: RecommendationCandidate,
  b: RecommendationCandidate,
): string {
  const reasons: string[] = [];

  // 1. validity
  const lifecycleA = LIFECYCLE_ORDER[a.lifecycle] ?? 99;
  const lifecycleB = LIFECYCLE_ORDER[b.lifecycle] ?? 99;
  if (lifecycleA < lifecycleB) {
    reasons.push(`${a.lifecycle} > ${b.lifecycle} (validity)`);
    return reasons.join("; ");
  }

  // 2. urgency
  const urgencyA = URGENCY_ORDER[a.urgency] ?? 99;
  const urgencyB = URGENCY_ORDER[b.urgency] ?? 99;
  if (urgencyA < urgencyB) {
    reasons.push(`${a.urgency} > ${b.urgency} (urgency)`);
    return reasons.join("; ");
  }

  // 3. confidence
  const confA = Number(a.confidence.toFixed(3));
  const confB = Number(b.confidence.toFixed(3));
  if (confA > confB) {
    reasons.push(`confidence ${confA.toFixed(3)} > ${confB.toFixed(3)}`);
    return reasons.join("; ");
  }

  // 4. evidence
  if (a.evidence.length > b.evidence.length) {
    reasons.push(`evidence ${a.evidence.length} > ${b.evidence.length}`);
    return reasons.join("; ");
  }

  // 5. tie-breaker
  reasons.push(`ID tie-breaker: ${a.recommendationId} vs ${b.recommendationId}`);
  return reasons.join("; ");
}

/**
 * 验证排序确定性：对同一输入排序 N 次，检查结果完全一致。
 */
export function verifyRankingDeterminism(
  recommendations: readonly RecommendationCandidate[],
  iterations = 1000,
): { deterministic: boolean; firstDivergenceAt?: number } {
  const firstResult = rankRecommendations(recommendations)
    .map(r => r.recommendationId)
    .join(",");

  for (let i = 1; i < iterations; i++) {
    const result = rankRecommendations(recommendations)
      .map(r => r.recommendationId)
      .join(",");
    if (result !== firstResult) {
      return { deterministic: false, firstDivergenceAt: i };
    }
  }

  return { deterministic: true };
}
