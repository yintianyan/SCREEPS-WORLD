/** A6.6 Conflict Detector — Recommendation 间冲突检测。 */

import type { RecommendationCandidate, RecommendationConflict, ConflictSeverity, RecommendationConflictType } from "./types";
import { conflictHash } from "./hashing";

// ═══════════════════════════════════════════════════════════
// §1. Conflict Detection
// ═══════════════════════════════════════════════════════════

/**
 * 检测 Recommendations 之间的冲突。

 * 检测逻辑：
 *   1. same_target: 同一 target 的多条同 category 建议 → 冲突
 *   2. resource_competition: 不同 category 但可能竞争资源 → 冲突
 *   3. strategic_contradiction: Posture 与 Military 冲突 → 冲突

 * 不解决冲突，只检测和标记。
 */
export function detectConflicts(
  recommendations: readonly RecommendationCandidate[],
  currentTick: number,
): RecommendationConflict[] {
  const conflicts: RecommendationConflict[] = [];

  // 过滤出 valid 的 recommendation
  const valid = recommendations.filter(r => r.lifecycle === "valid" || r.lifecycle === "created");
  if (valid.length < 2) return conflicts;

  // ── 1. same_target 冲突 ──
  // 按 target 分组，同 target 同 category 的多条建议冲突
  const byTargetCategory = new Map<string, RecommendationCandidate[]>();
  for (const r of valid) {
    const key = `${r.target}:${r.category}`;
    const group = byTargetCategory.get(key) ?? [];
    group.push(r);
    byTargetCategory.set(key, group);
  }

  for (const [key, group] of byTargetCategory) {
    if (group.length < 2) continue;

    const [target, category] = key.split(":");
    const participantIds = group
      .map(r => r.recommendationId)
      .sort((a, b) => a.localeCompare(b));

    const description = `Same target "${target}" category "${category}": ${participantIds.length} conflicting recommendations`;
    const hash = conflictHash("same_target", participantIds, description);

    conflicts.push({
      conflictId: `CF-same_target-${hash.slice(0, 8)}`,
      type: "same_target" as RecommendationConflictType,
      participantIds,
      description,
      severity: determineSameTargetSeverity(group),
      detectedAt: currentTick,
      conflictHash: hash,
    });
  }

  // ── 2. resource_competition 冲突 ──
  // economic + expansion 可能竞争能量资源
  // recovery + military 可能竞争 spawn 容量
  const byTarget = new Map<string, RecommendationCandidate[]>();
  for (const r of valid) {
    const group = byTarget.get(r.target) ?? [];
    group.push(r);
    byTarget.set(r.target, group);
  }

  for (const [target, group] of byTarget) {
    if (group.length < 2) continue;

    // 检查是否存在资源竞争的 category 对
    const categories = new Set(group.map(r => r.category));
    const hasResourceConflict =
      (categories.has("economic") && categories.has("expansion")) ||
      (categories.has("recovery") && categories.has("military")) ||
      (categories.has("spawn") && categories.has("military"));

    if (!hasResourceConflict) continue;

    // 排除已经在 same_target 中检测到的
    const sameCat = group.every(r => r.category === group[0]!.category);
    if (sameCat) continue;

    const participantIds = group
      .map(r => r.recommendationId)
      .sort((a, b) => a.localeCompare(b));

    const description = `Resource competition at "${target}": categories [${[...categories].sort().join(", ")}]`;
    const hash = conflictHash("resource_competition", participantIds, description);

    conflicts.push({
      conflictId: `CF-resource_competition-${hash.slice(0, 8)}`,
      type: "resource_competition" as RecommendationConflictType,
      participantIds,
      description,
      severity: "medium" as ConflictSeverity,
      detectedAt: currentTick,
      conflictHash: hash,
    });
  }

  // ── 3. strategic_contradiction 冲突 ──
  // posture (develop) + military (aggressive) → 战略矛盾
  // posture (fortify) + expansion → 战略矛盾
  const postureRecs = valid.filter(r => r.category === "posture");
  const militaryRecs = valid.filter(r => r.category === "military");
  const expansionRecs = valid.filter(r => r.category === "expansion");

  if (postureRecs.length > 0 && militaryRecs.length > 0) {
    const participantIds = [...postureRecs, ...militaryRecs]
      .map(r => r.recommendationId)
      .sort((a, b) => a.localeCompare(b));

    const description = `Strategic contradiction: posture vs military`;
    const hash = conflictHash("strategic_contradiction", participantIds, description);

    conflicts.push({
      conflictId: `CF-strategic_contradiction-${hash.slice(0, 8)}`,
      type: "strategic_contradiction" as RecommendationConflictType,
      participantIds,
      description,
      severity: "high" as ConflictSeverity,
      detectedAt: currentTick,
      conflictHash: hash,
    });
  }

  if (postureRecs.length > 0 && expansionRecs.length > 0) {
    const participantIds = [...postureRecs, ...expansionRecs]
      .map(r => r.recommendationId)
      .sort((a, b) => a.localeCompare(b));

    const description = `Strategic contradiction: posture vs expansion`;
    const hash = conflictHash("strategic_contradiction", participantIds, description);

    conflicts.push({
      conflictId: `CF-strategic_contradiction-${hash.slice(0, 8)}`,
      type: "strategic_contradiction" as RecommendationConflictType,
      participantIds,
      description,
      severity: "medium" as ConflictSeverity,
      detectedAt: currentTick,
      conflictHash: hash,
    });
  }

  return conflicts;
}

/**
 * 确定同目标冲突的严重度。
 */
function determineSameTargetSeverity(
  group: readonly RecommendationCandidate[],
): ConflictSeverity {
  // 如果有 critical urgency 的建议 → high
  if (group.some(r => r.urgency === "critical")) {
    return "high";
  }
  // 如果有 high urgency 的建议 → medium
  if (group.some(r => r.urgency === "high")) {
    return "medium";
  }
  return "low";
}

/**
 * 将冲突 ID 关联到 Recommendation。

 * 返回新的 Recommendation 数组（不修改输入）。
 */
export function attachConflictIds(
  recommendations: readonly RecommendationCandidate[],
  conflicts: readonly RecommendationConflict[],
): RecommendationCandidate[] {
  if (conflicts.length === 0) return [...recommendations];

  // 构建 recommendationId → conflictIds 映射
  const conflictMap = new Map<string, string[]>();
  for (const c of conflicts) {
    for (const recId of c.participantIds) {
      const existing = conflictMap.get(recId) ?? [];
      existing.push(c.conflictId);
      conflictMap.set(recId, existing);
    }
  }

  return recommendations.map(r => {
    const cids = conflictMap.get(r.recommendationId);
    if (!cids || cids.length === 0) return r;
    return {
      ...r,
      conflictIds: [...r.conflictIds, ...cids].sort((a, b) => a.localeCompare(b)),
    };
  });
}
