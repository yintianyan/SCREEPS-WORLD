/** R674 效用仲裁器 — work 模式的「价值 × 老化」任务选择。
 *
 * 背景：动作链是「第一个可执行者胜」，每来一个新需求就要插到链上正确位置，插错就
 * 饿死链尾（R672 feed 车道、builder 常规修路、hauler 的 lab 供料都因此被遮蔽）。
 * 本模块把「排序」换成「调度」：
 *   - 每个候选声明 utility(ac, target)，候选之间按分数可比；
 *   - 连续未被选中的候选按等待 tick 提权（aging），保证有界饥饿；
 *   - 当前任务有承诺窗 + 切换余量（防振荡、省通勤）；
 *   - 完整评分每 decisionInterval 拍一次，其余拍只复核当前任务（CPU 可控）。
 *
 * 只用于 work 模式。acquire 保持链式：取能的安全次序（掉落物→storage→container→采集）
 * 不允许被分数改写。
 */
import { CONFIG } from "../../config";
import { globalCache } from "../../kernel/global-cache";
import type { ActionContext, ActionCandidate } from "./action-types";

/** 参与评分的目标缓存键 — resolve 会写这些字段，批量评分时必须先存后还。
 * 否则落选候选会把赢家的缓存覆盖（buildNearestSite 写 targetId、
 * repair* 写 repairTargetId/urgentRoadId、fillTarget 写 fillTargetId）。 */
const TARGET_CACHE_KEYS = ["targetId", "fillTargetId", "repairTargetId", "urgentRoadId"] as const;

type TargetCache = Partial<Record<(typeof TARGET_CACHE_KEYS)[number], Id<_HasId> | undefined>>;

function saveTargetCaches(creep: Creep): TargetCache {
  const saved: TargetCache = {};
  for (const key of TARGET_CACHE_KEYS) saved[key] = creep.memory[key];
  return saved;
}

function restoreTargetCaches(creep: Creep, saved: TargetCache): void {
  for (const key of TARGET_CACHE_KEYS) creep.memory[key] = saved[key];
}

/** 评分阶段的全局副作用快照：fill 预约是跨 creep 共享的 Set，评分时逐个候选执行
 * getHaulFillTarget/getDistributorFillTarget 会各自占用一个目标；若不在每个候选前
 * 还原，落选候选会偷走赢家/其他 creep 的目标。 */
interface ScoringSideEffects {
  readonly target: TargetCache;
  readonly fillTick: number | undefined;
  readonly fillIds: readonly string[] | undefined;
}

function saveSideEffects(creep: Creep): ScoringSideEffects {
  const g = globalCache();
  return {
    target: saveTargetCaches(creep),
    fillTick: g.fillReservationTick,
    fillIds: g.fillReservations ? [...g.fillReservations] : undefined,
  };
}

function restoreSideEffects(creep: Creep, saved: ScoringSideEffects): void {
  const g = globalCache();
  restoreTargetCaches(creep, saved.target);
  if (saved.fillIds === undefined) {
    delete g.fillReservations;
  } else {
    g.fillReservations = new Set(saved.fillIds);
  }
  if (saved.fillTick === undefined) {
    delete g.fillReservationTick;
  } else {
    g.fillReservationTick = saved.fillTick;
  }
}

/** 稳定的字符串哈希（FNV-1a 32 位）— 同分时按 creep 名 + 候选名散布，
 * 避免同房多个同角色 creep 每拍选中同一候选（现有去羊群手法同源）。 */
function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 给候选附上 utility 函数（不改动原候选对象，便于在角色文件就地声明权重）。 */
export function scored<T>(
  candidate: ActionCandidate<T>,
  utility: (ac: ActionContext, target: T) => number,
): ActionCandidate<T> {
  return { ...candidate, utility };
}

export interface ScoredCandidate {
  readonly candidate: ActionCandidate<any>;
  readonly target: unknown;
  readonly name: string;
  readonly utility: number;
  readonly score: number;
}

export interface UtilityOutcome {
  readonly candidate: ActionCandidate<any>;
  readonly target: unknown;
  /** true = 本次是完整决策；false = 复核既有任务。 */
  readonly decided: boolean;
}

function clampNeglect(n: number): number {
  return Math.min(CONFIG.arbitration.agingCap, Math.max(0, n));
}

/** 完整评分：resolve 全部候选、算分、稳定排序。导出仅为测试与观测。 */
export function scoreCandidates(
  ac: ActionContext,
  candidates: readonly ActionCandidate<any>[],
  state: CreepMemory["utility"],
): ScoredCandidate[] {
  const tick = Game.time;
  const saved = saveSideEffects(ac.creep);
  const scoredList: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    // 每个候选独立评估：先还原到决策前的缓存/预约状态，避免前一个候选写的目标缓存
    // 或 fill 预约改变后一个候选的 resolve 结果（它们共享 repairTargetId/targetId 与
    // 全房 fillReservations）。
    restoreSideEffects(ac.creep, saved);
    const target = candidate.resolve(ac);
    if (target === undefined) continue;
    const base = candidate.utility?.(ac, target) ?? 1;
    if (!(base > 0)) continue;
    const neglect = state?.neglect?.[candidate.name] ?? 0;
    const aging = 1 + clampNeglect(neglect) / CONFIG.arbitration.agingDivisor;
    const sticky =
      state?.task === candidate.name && tick - state.since < CONFIG.arbitration.dwellTicks
        ? CONFIG.arbitration.stickyBonus
        : 1;
    scoredList.push({
      candidate,
      target,
      name: candidate.name,
      utility: base,
      score: base * aging * sticky,
    });
  }
  restoreSideEffects(ac.creep, saved);
  scoredList.sort(
    (a, b) =>
      b.score - a.score ||
      b.utility - a.utility ||
      stableHash(ac.creep.name + a.name) - stableHash(ac.creep.name + b.name),
  );
  return scoredList;
}

/**
 * 执行一次 work 模式的仲裁。返回 undefined = 本拍没有可执行候选（调用方回退到链式兜底）。
 * 状态写入 creep.memory.utility；negotiation 细节见 CONFIG.arbitration。
 */
export function runUtilityArbitration(
  ac: ActionContext,
  candidates: readonly ActionCandidate<any>[],
  intervalOverride?: number,
): UtilityOutcome | undefined {
  if (!CONFIG.arbitration.enabled) return undefined;
  const tick = Game.time;
  const state = ac.creep.memory.utility;
  const interval = intervalOverride ?? CONFIG.arbitration.decisionInterval;

  // 1) 决策间隔内：只复核当前任务，避免每拍全量扫描。
  if (state?.task && tick - state.lastAt < interval) {
    const current = candidates.find(c => c.name === state.task);
    if (current) {
      const target = current.resolve(ac);
      if (target !== undefined) {
        current.execute(ac, target);
        return { candidate: current, target, decided: false };
      }
    }
    // 当前任务失效 → 落入完整重评。
  }

  // 2) 完整评分。
  const scoredList = scoreCandidates(ac, candidates, state);
  if (scoredList.length === 0) {
    if (state) {
      state.task = "";
      state.lastAt = tick;
    }
    return undefined;
  }

  // 3) 选择：先满足硬性公平（等待达上限的候选无条件插队），再走切换余量。
  // 硬性公平是「有界饥饿」的最终保证：无论 base utility 相差多大，任何可执行
  // 任务最多等 agingCap 拍就会被服务一次（之后的排序再交回分数）。
  let chosen = scoredList[0]!;
  const starved = scoredList.find(
    s => s.name !== state?.task && (state?.neglect?.[s.name] ?? 0) >= CONFIG.arbitration.agingCap,
  );
  if (starved) {
    chosen = starved;
  } else if (state?.task) {
    const current = scoredList.find(s => s.name === state.task);
    if (current && current.name !== chosen.name) {
      if (chosen.score <= current.score * CONFIG.arbitration.switchMargin) chosen = current;
    }
  }

  // 4) 更新老化：只保留本拍仍可执行的候选（不可执行 = 不需要等待，清零防陈旧提权）；
  //    落选者按本决策覆盖的 tick 数累计，选中者清零。
  const neglect: Record<string, number> = {};
  for (const entry of scoredList) {
    neglect[entry.name] =
      entry.name === chosen.name ? 0 : clampNeglect((state?.neglect?.[entry.name] ?? 0) + interval);
  }
  const sameTask = state?.task === chosen.name;
  const next = {
    task: chosen.name,
    since: sameTask ? (state?.since ?? tick) : tick,
    lastAt: tick,
    neglect,
  };
  ac.creep.memory.utility = next;

  // 5) 重新 resolve 选中候选：评分阶段的目标缓存已还原，这一步把赢家的缓存正确落盘。
  const target = chosen.candidate.resolve(ac);
  if (target === undefined) {
    next.task = "";
    return undefined;
  }
  chosen.candidate.execute(ac, target);
  return { candidate: chosen.candidate, target, decided: true };
}
