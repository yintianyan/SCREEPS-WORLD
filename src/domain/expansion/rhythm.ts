/**
 * 扩张节奏自适应 — 从失败中学习怎么扩张（R7b，docs/architecture/GOAL_POLICY_PLAN_MODEL.md）。
 *
 * 消费 ExpansionOutcome 归因（每次扩张任务收摊追加一条结果到有限 ring），
 * 产出三个有界调节：
 *   1. 连续失败暂停：连续失败 ≥ pauseFailures → 全局扩张暂停 pauseTicks —
 *      「失败→立刻再试」是消耗 GCL 窗口的烧钱循环，暂停是止损不是放弃。
 *   2. stolen 频发收紧目标门禁：窗口内被抢占 ≥ 2 次 → 只选 ≥2 source 的
 *      高价值房（评估器 minSources 消费）— 差房人人抢，好房才有余量。
 *   3. 成功率达标放松黑名单：窗口内成功率 ≥ successRatioRelax →
 *      失败目标冷却 × 0.5（有下界）；窗口内零成功 → × 1.5（有上界）—
 *      门禁随证据走，不随情绪走。
 *
 * 全部输出有界（缩放 0.5–1.5、minSources 1–2、暂停固定时长），
 * 与 tuning-engine 同哲学不同机器：参数边界内调节 + 可回滚（重置 ring 即
 * 回基线）+ 可观测（节奏变化打日志），不复用其角色边界专用机制。
 * 纯函数 — 不访问 Game/Memory，ring 由调用方持久化。
 */

/** 扩张任务最终结果（每任务一条，收摊时追加）。 */
export type ExpansionOutcomeKind = "success" | "stolen" | "timeout" | "lost" | "aborted";

export interface RhythmOptions {
  /** 结果 ring 最大长度（旧条目溢出丢弃）。 */
  ringSize: number;
  /** 连续失败达此数 → 暂停。 */
  pauseFailures: number;
  /** 暂停时长（tick）。 */
  pauseTicks: number;
  /** 默认最低 source 数。 */
  minSourcesBase: number;
  /** stolen 频发时收紧到的最低 source 数。 */
  minSourcesOnStolen: number;
  /** stolen 计数窗口（最近 N 条）。 */
  stolenWindow: number;
  /** stolen 频发阈值（窗口内 ≥ 此数）。 */
  stolenThreshold: number;
  /** 放松/收紧黑名单的观察窗口（最近 N 条）。 */
  relaxWindow: number;
  /** 成功率 ≥ 此比例 → 黑名单 ×0.5。 */
  successRatioRelax: number;
}

export const DEFAULT_RHYTHM_OPTIONS: RhythmOptions = {
  ringSize: 8,
  pauseFailures: 3,
  pauseTicks: 20000,
  minSourcesBase: 1,
  minSourcesOnStolen: 2,
  stolenWindow: 6,
  stolenThreshold: 2,
  relaxWindow: 6,
  successRatioRelax: 2 / 3,
};

export interface RhythmResult {
  /** 连续失败数（含最新一条）。 */
  consecutiveFailures: number;
  /** 失败暂停：>0 表示应暂停该时长。 */
  pauseTicks: number;
  /** 黑名单冷却缩放（0.5–1.5，有界）。 */
  blacklistMultiplier: number;
  /** 目标最低 source 数（stolen 频发 → 2）。 */
  minSources: number;
}

export function evaluateExpansionRhythm(
  outcomes: readonly ExpansionOutcomeKind[],
  options: RhythmOptions = DEFAULT_RHYTHM_OPTIONS,
): RhythmResult {
  const recent = outcomes.slice(-options.ringSize);

  // 连续失败：从最新往回数非 success。
  let consecutiveFailures = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i] === "success") break;
    consecutiveFailures++;
  }

  // stolen 频发 → 收紧目标门禁。
  const stolenWindow = recent.slice(-options.stolenWindow);
  const stolenCount = stolenWindow.filter(o => o === "stolen").length;
  const minSources =
    stolenCount >= options.stolenThreshold ? options.minSourcesOnStolen : options.minSourcesBase;

  // 成功率 → 黑名单缩放。
  const relaxWindow = recent.slice(-options.relaxWindow);
  const successCount = relaxWindow.filter(o => o === "success").length;
  let blacklistMultiplier = 1;
  if (relaxWindow.length >= 3) {
    if (successCount / relaxWindow.length >= options.successRatioRelax) {
      blacklistMultiplier = 0.5;
    } else if (successCount === 0) {
      blacklistMultiplier = 1.5;
    }
  }

  return {
    consecutiveFailures,
    pauseTicks: consecutiveFailures >= options.pauseFailures ? options.pauseTicks : 0,
    blacklistMultiplier,
    minSources,
  };
}

/** 追加一条结果并保持 ring 有界（旧→新）。 */
export function appendOutcome(
  outcomes: readonly ExpansionOutcomeKind[],
  outcome: ExpansionOutcomeKind,
  ringSize: number,
): ExpansionOutcomeKind[] {
  const next = [...outcomes, outcome];
  return next.slice(-ringSize);
}
