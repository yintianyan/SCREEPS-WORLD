/** 算力容量模型 — 规模规划的 CPU 前馈层（R7a，docs/architecture/GOAL_POLICY_PLAN_MODEL.md 延伸）。 */

export type CapacityTier = "abundant" | "comfortable" | "tight" | "constrained";

export interface CapacityInput {
  /** Game.cpu.limit（不写死 — 官方 limit 随 GCL 变化）。 */
  cpuLimit: number;
  /** Game.cpu.tickLimit（与 limit 取小者为有效上限）。 */
  tickLimit: number;
  bucket: number;
  /** telemetry 的 10 采样平均 CPU（Memory.kernel.stats.cpuAvg10）。 */
  cpuAvg10: number;
  /** telemetry 的 10 采样峰值（供调用方观察，本函数不参与分档）。 */
  cpuMax10: number;
}

export interface CapacityOptions {
  /** avg/limit ≤ 此比例 → abundant（可扩雄心：更多远矿/扩张）。 */
  abundantRatio: number;
  /** 超过此比例 → tight（收缩雄心）。 */
  tightRatio: number;
  /** 超过此比例 → constrained（只保生存与恢复）。 */
  constrainedRatio: number;
  /** 升档滞回窗口：余量需持续满足该 tick 数才升档。 */
  upgradeWindowTicks: number;
}

export const DEFAULT_CAPACITY_OPTIONS: CapacityOptions = {
  abundantRatio: 0.35,
  tightRatio: 0.6,
  constrainedRatio: 0.8,
  upgradeWindowTicks: 300,
};

export interface CapacityState {
  tier: CapacityTier;
  /** 当前档位起始 tick。 */
  since: number;
  /** 升档候选连续满足的 tick 数（调用方持久化，防抖动）。 */
  upgradeTicks: number;
}

export interface CapacityResult extends CapacityState {
  /** 余量 = 1 − avg/limit（0..1）。 */
  headroom: number;
}

const TIER_RANK: Record<CapacityTier, number> = {
  abundant: 0,
  comfortable: 1,
  tight: 2,
  constrained: 3,
};

export function evaluateCapacity(
  input: CapacityInput,
  prev: CapacityState | undefined,
  tick: number,
  options: CapacityOptions = DEFAULT_CAPACITY_OPTIONS,
): CapacityResult {
  const limit = Math.max(1, Math.min(input.cpuLimit, input.tickLimit));
  const usage = Math.min(Math.max(0, input.cpuAvg10), limit);
  const headroom = 1 - usage / limit;

  let target: CapacityTier;
  if (headroom >= 1 - options.abundantRatio) target = "abundant";
  else if (headroom >= 1 - options.tightRatio) target = "comfortable";
  else if (headroom >= 1 - options.constrainedRatio) target = "tight";
  else target = "constrained";

  const prevTier = prev?.tier ?? target;
  const since = prev?.since ?? tick;
  const upgradeTicks = prev?.upgradeTicks ?? 0;

  if (target === prevTier) {
    return { tier: target, since, upgradeTicks: 0, headroom };
  }
  // 升档（abundant ← …）需持续窗口；降档（… → constrained）立即。
  const isUpgrade = TIER_RANK[target] < TIER_RANK[prevTier];
  if (isUpgrade) {
    const next = upgradeTicks + 1;
    if (next < options.upgradeWindowTicks) {
      return { tier: prevTier, since, upgradeTicks: next, headroom };
    }
    return { tier: target, since: tick, upgradeTicks: 0, headroom };
  }
  return { tier: target, since: tick, upgradeTicks: 0, headroom };
}
