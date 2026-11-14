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
  /**
   * `stats.cpuRate.at`：这份读数的采样拍。
   * 与 `tick` 配对使用 —— Memory 跨部署存活，旧窗口必须能被识别出来。
   */
  rateAt?: number;
  /** 当前拍。提供时启用新鲜度校验；缺省保持旧行为（仅校验窗长/漏采）。 */
  tick?: number;
}

/**
 * 逐拍均量的最大可接受年龄（拍）。
 *
 * telemetry 每 10 拍推进一次窗口，50 = 5 个采样周期：足以容忍一次调度错峰/短时跳过，
 * 又远小于容量闸的 300 拍升档窗口 —— 读到 50 拍前的窗口仍能代表当下，再旧就必须退回
 * 偏高的 avg10（保守侧）。
 */
export const MAX_RATE_AGE_TICKS = 50;

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
 * 四种情况退回 avg10（偏高即保守）：
 * - 窗还没建立（新 Memory／首次采样前）；
 * - 窗长不足 MIN_RATE_WINDOW_TICKS（启动期单拍噪声）；
 * - 窗内存在漏采的拍 —— 那种 total 少算了漏掉的消耗，偏低即不安全；
 * - 调用方给了 `tick`，但读数缺失采样时刻或已超过 MAX_RATE_AGE_TICKS。
 *   最后一条是「新鲜度」修复：旧实现把 cpuRate 埋在每 100 拍一次的 Memory 体积采样里，
 *   消费侧可能拿着上个部署甚至上个窗口的读数做当前决策。
 */
export function pickCpuUsagePerTick(m: CpuUsageMeasurement): number {
  const isFresh =
    m.tick === undefined || (m.rateAt !== undefined && m.tick - m.rateAt <= MAX_RATE_AGE_TICKS);
  const trustworthy =
    m.rateTotal !== undefined &&
    (m.rateWindowTicks ?? 0) >= MIN_RATE_WINDOW_TICKS &&
    (m.rateUnsampledTicks ?? 0) === 0 &&
    isFresh;
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
  /** 距上次评估经过的拍数（默认 1）。调用方若按 cadence 抽样评估，必须传真实间隔，
   * 否则 `upgradeWindowTicks` 的单位会从“拍”变成“评估次数”——R613 实测：
   * empire-strategy 每 5 拍评估一次，300 的窗口被拉成 1,500 拍（历史 G6 长期红的机制）。 */
  elapsedTicks = 1,
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
    const next = upgradeTicks + Math.max(1, elapsedTicks);
    if (next < options.upgradeWindowTicks) {
      return { tier: prevTier, since, upgradeTicks: next, headroom };
    }
    return { tier: target, since: tick, upgradeTicks: 0, headroom };
  }
  return { tier: target, since: tick, upgradeTicks: 0, headroom };
}
