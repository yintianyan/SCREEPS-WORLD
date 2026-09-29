/** 算力容量模型 — 规模规划的 CPU 前馈层。 */

export type CapacityTier = "abundant" | "comfortable" | "tight" | "constrained";

export interface CapacityInput {
  /** Game.cpu.limit（不写死 — 官方 limit 随 GCL 变化）。 */
  cpuLimit: number;
  /** Game.cpu.tickLimit（与 limit 取小者为有效上限）。 */
  tickLimit: number;
  bucket: number;
  /**
   * 每 tick 平均 CPU —— 必须是覆盖窗内每一拍的读数（用 pickCpuUsagePerTick 选）。
   * 不要把 stats.cpuAvg10 直接接进来：它的采样点系统性偏高，见该函数注释。
   */
  cpuUsagePerTick: number;
  /** telemetry 的 10 采样峰值（供调用方观察，本函数不参与分档）。 */
  cpuMax10: number;
}

/** 两份 CPU 均值读数，交给 pickCpuUsagePerTick 裁决用哪一份。 */
export interface CpuUsageMeasurement {
  /** stats.cpuAvg10：最近 10 个采样点的均值。 */
  avg10: number;
  /** stats.cpuRate.total：窗内每拍拍尾都采的均值。窗未建立时 undefined。 */
  rateTotal?: number;
  rateWindowTicks?: number;
  rateUnsampledTicks?: number;
}

/**
 * 采信逐拍均量所需的最小窗长（拍）。
 *
 * 取 100 是为了和它替换掉的读数同量级：`cpuAvg10` 覆盖 10 个采样点 × 10 拍 ≈ 100 拍。
 * 更要紧的是启动期 —— 第 1 拍时 `total = 那一拍的用量 / 1`，把一次冷启动的抖动当均值
 * 喂给档位闸，比偏高读数更糟（档位会随单拍摆动，而驻留计数正是在这种摆动里清零的）。
 */
const MIN_RATE_WINDOW_TICKS = 100;

/**
 * 选喂给分档的「每 tick 平均 CPU」。
 *
 * 优先逐拍均量。cpuAvg10 的 10 个采样点恰好落在遥测+刷段都在跑的重活拍上，
 * 官服实测稳定偏高约 2.6/t（同一帝国：avg10=13.2 vs 逐拍=10.6，unsampledTicks=0），
 * 于是有 47% 余量的帝国被判成 tight，升档滞回只能在边界上被重置回 0 ——
 * tier=tight 已持续约 9300 拍、upgradeTicks 读 0，而真实均值从未接近过门槛。
 *
 * 三种情况退回 avg10（偏高即保守）：窗还没建立（新 Memory／首次采样前）、窗长不足
 * MIN_RATE_WINDOW_TICKS（启动期单拍噪声），或窗内存在漏采的拍 —— 那种 total 少算了
 * 漏掉的消耗，偏低即不安全。
 */
export function pickCpuUsagePerTick(m: CpuUsageMeasurement): number {
  const trustworthy =
    m.rateTotal !== undefined &&
    (m.rateWindowTicks ?? 0) >= MIN_RATE_WINDOW_TICKS &&
    (m.rateUnsampledTicks ?? 0) === 0;
  return trustworthy ? (m.rateTotal as number) : m.avg10;
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
  const usage = Math.min(Math.max(0, input.cpuUsagePerTick), limit);
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
