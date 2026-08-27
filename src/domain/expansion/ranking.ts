/** Candidate Ranking */

import type { ExpansionCandidateV2 } from "./candidate";

/** 排序后的候选条目（附带排名和理由）。 */
export interface RankedCandidate {
  candidate: ExpansionCandidateV2;
  rank: number;
  /** 排序理由（人类可读）。 */
  reason: string;
}

/** 排序选项。 */
export interface RankingOptions {
  /** 最大候选池大小（超出截断）。 */
  maxPoolSize: number;
  /** 距离权重（排序时与评分加权）。 */
  distanceWeight: number;
  /** source 数权重。 */
  sourceWeight: number;
  /** 新鲜度权重。 */
  freshnessWeight: number;
}

export const DEFAULT_RANKING_OPTIONS: RankingOptions = {
  maxPoolSize: 10,
  distanceWeight: 0.2,
  sourceWeight: 0.3,
  freshnessWeight: 0.1,
};

/**
 * 对已评分候选房进行排序（纯函数）。

 * 排序逻辑：
 * 1. 过滤出 QUALIFIED 候选
 * 2. 按 compositeScore = score × (1 - distWeight×distPenalty) + sourceBonus + freshnessBonus 排序
 * 3. 截断到 maxPoolSize
 */
export function rankCandidates(
  candidates: readonly ExpansionCandidateV2[],
  tick: number,
  options: RankingOptions = DEFAULT_RANKING_OPTIONS,
): RankedCandidate[] {
  const qualified = candidates.filter(c => c.status === "QUALIFIED");

  const ranked = qualified.map(c => {
    // 距离惩罚（远 = 惩罚大）
    const distPenalty = c.distance <= 1 ? 0
      : c.distance === 2 ? 0.2
      : c.distance === 3 ? 0.4
      : 0.6;
    const distanceFactor = 1 - options.distanceWeight * distPenalty;

    // source 奖励
    const sourceCount = c.sourceCount ?? 0;
    const sourceBonus = sourceCount * options.sourceWeight * 0.1;

    // 新鲜度奖励（越新越好，maxAge=10000）
    const age = tick - c.lastSeen;
    const freshnessBonus = options.freshnessWeight * Math.max(0, 1 - age / 10000) * 0.1;

    const compositeScore = c.score * distanceFactor + sourceBonus + freshnessBonus;

    return {
      candidate: c,
      compositeScore,
      reason: `score=${c.score.toFixed(2)} dist=${c.distance} src=${sourceCount} age=${age}t`,
    };
  });

  // 按综合分数降序
  ranked.sort((a, b) => b.compositeScore - a.compositeScore);

  // 截断
  const result: RankedCandidate[] = ranked.slice(0, options.maxPoolSize).map((r, i) => ({
    candidate: r.candidate,
    rank: i + 1,
    reason: `#${i + 1}: ${r.reason}`,
  }));

  return result;
}

/**
 * 获取排名第一的候选（无可行候选返回 undefined）。
 */
export function getTopCandidate(
  candidates: readonly ExpansionCandidateV2[],
  tick: number,
  options: RankingOptions = DEFAULT_RANKING_OPTIONS,
): RankedCandidate | undefined {
  const ranked = rankCandidates(candidates, tick, options);
  return ranked.length > 0 ? ranked[0] : undefined;
}
