/** A6.6 Recommendation Hashing — 确定性哈希工具。 */

import { stableStringify, fnv1a32Hex } from "../prediction/hashing";
import type { RecommendationCandidate } from "./types";

export { stableStringify, fnv1a32Hex };

/**
 * 为 RecommendationCandidate 生成稳定的 Hash。

 * 算法：stableStringify(recommendation 关键字段) → FNV-1a 32-bit → hex。

 * 确定性保证：
 *   - 不使用 Math.random / Date.now
 *   - evidence 按 evidenceId 排序
 *   - 字段按 alphabetical 排序
 *   - 浮点结果 toFixed(3)
 */
export function recommendationHash(rec: Omit<RecommendationCandidate, "recommendationHash">): string {
  const payload = stableStringify({
    autoApply: rec.autoApply,
    category: rec.category,
    confidence: Number(rec.confidence.toFixed(3)),
    conflictIds: rec.conflictIds,
    contextSignature: rec.contextSignature,
    createdAt: rec.createdAt,
    description: rec.description,
    evidence: rec.evidence
      .map(e => ({
        collectedAt: e.collectedAt,
        confidence: Number(e.confidence.toFixed(3)),
        description: e.description,
        evidenceId: e.evidenceId,
        source: e.source,
        sourceId: e.sourceId,
        stage: e.stage,
      }))
      .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
    evidenceComplete: rec.evidenceComplete,
    expectedBenefit: rec.expectedBenefit,
    expectedCost: rec.expectedCost,
    modelVersion: rec.modelVersion,
    rationale: rec.rationale,
    shadowOnly: rec.shadowOnly,
    target: rec.target,
    urgency: rec.urgency,
    validity: rec.validity,
  });
  return fnv1a32Hex(payload);
}

/**
 * 为冲突生成确定性 hash。
 */
export function conflictHash(
  type: string,
  participantIds: readonly string[],
  description: string,
): string {
  const sortedIds = [...participantIds].sort();
  const payload = stableStringify({ type, participantIds: sortedIds, description });
  return fnv1a32Hex(payload);
}

/**
 * 验证 Recommendation 确定性：同一输入连续 N 次，检查 hash 一致。

 * REC-014：禁止 Math.random / Date.now。
 */
export function verifyRecommendationDeterminism(
  rec: Omit<RecommendationCandidate, "recommendationHash">,
  iterations = 1000,
): { deterministic: boolean; firstDivergenceAt?: number } {
  const firstHash = recommendationHash(rec);
  for (let i = 1; i < iterations; i++) {
    const h = recommendationHash(rec);
    if (h !== firstHash) {
      return { deterministic: false, firstDivergenceAt: i };
    }
  }
  return { deterministic: true };
}
