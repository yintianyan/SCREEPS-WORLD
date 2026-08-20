/**
 * Deal 调度器纯函数 — terminal/lab/factory 市场改造阶段 2。
 *
 * 问题：旧实现用 continue 链硬编码优先级（卖能量→卖矿→卖battery→买危机能量→
 * 买缺口→买power→买G），卖出永远先于买入 — 当 terminal 冷却被卖出占用时，
 * 买入被永久挤出（每轮只有 1 个 deal 窗口）。
 *
 * 改造：收集所有候选 deal（卖出 + 买入）为 DealCandidate，按 priority 降序排序，
 * 取最高优先级的执行。卖出 priority ≤ 50，买入 priority 可达 100（生存级）。
 *
 * 纯函数层：不访问 Game/Memory，可 Vitest 测试。
 */

/** Deal 候选类型。 */
export type DealCandidateType =
  | "sell-energy"
  | "sell-mineral"
  | "sell-battery"
  | "sell-compound"
  | "sell-commodity"
  | "buy-crisis-energy"
  | "buy-deficit"
  | "buy-power"
  | "buy-ghodium";

/** 单个 deal 候选 — 带 priority 的可执行 deal 描述。 */
export interface DealCandidate {
  /** 候选类型。 */
  type: DealCandidateType;
  /** 优先级（0-100，越高越先执行）。 */
  priority: number;
  /**
   * 执行函数 — 调用方在选中此候选后调用。
   * 返回 true 表示成交（terminal 冷却被消耗）。
   */
  execute: () => boolean;
}

/** 卖出类候选的 priority 上限 — 日常贸易不挤掉紧急采购。 */
export const SELL_PRIORITY_CAP = 50;

/** 危机能量买入的 priority — 生存级，优先于一切卖出。 */
export const CRISIS_ENERGY_PRIORITY = 80;

/** 需求表驱动的缺口买入基础 priority（会被 demand.priority 覆盖）。 */
export const DEFICIT_PRIORITY_BASE = 20;

/** Power 买入 priority — GPL 投资，排位低于日常贸易。 */
export const POWER_PRIORITY = 15;

/** Ghodium 买入 priority — 威慑备弹，最低。 */
export const GHODIUM_PRIORITY = 10;

/**
 * 从候选列表中选出最高优先级的 deal。
 * priority 相同时保持插入顺序（稳定排序）。
 * 返回 undefined = 无可执行候选。
 */
export function pickBestCandidate(
  candidates: readonly DealCandidate[],
): DealCandidate | undefined {
  if (candidates.length === 0) return undefined;
  let best: DealCandidate | undefined;
  for (const c of candidates) {
    if (!best || c.priority > best.priority) {
      best = c;
    }
  }
  return best;
}

/**
 * 按 priority 降序逐个尝试执行候选，直到一个成功（返回 true）或全部尝试完毕。
 *
 * 这解决了 continue 链的核心问题：旧实现中如果前一个函数返回 false（未成交），
 * 下一个函数有机会执行。新的 priority 竞争模式保留了这一语义 —
 * priority 最高的先试，如果没成交（如无卖单/无现货），fallback 到下一个。
 *
 * @param candidates 候选列表（会被按 priority 降序排列）。
 * @returns 是否有候选成功成交。
 */
export function executeBestCandidate(
  candidates: DealCandidate[],
): boolean {
  if (candidates.length === 0) return false;
  // 按 priority 降序排序（稳定排序保持插入顺序）。
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
  for (const c of sorted) {
    if (c.execute()) return true;
  }
  return false;
}
