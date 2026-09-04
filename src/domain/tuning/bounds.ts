/** Tuning Bounds — 可调参数的安全边界/步长/冷却（纯数据，无 Game/Memory）。 */

/** 单个可调参数的安全约束。 */
export interface ParamBounds {
  /** 参数路径，如 "hauler.maxCount"。 */
  param: string;
  /** 绝对下限。 */
  floor: number;
  /** 绝对上限。 */
  ceiling: number;
  /** 单次调整步长（正整数）。 */
  step: number;
  /** 同一参数两次调整之间的最小间隔 tick。 */
  cooldownTicks: number;
  /**
   * 效果显现最小 tick（改进 A/P1，附录 B-P1）：等孵化(~150) + 老 creep 死亡 +
   * 遥测窗口(500) ≈ 1500 = 3 个评估周期，保证效果在 EVAL_WINDOW_SIZE(1000) 内显现。
   * 不变式：verifyDelay ≥ cooldownTicks，否则验证在冷却期内触发、无意义。
   */
  verifyDelay: number;
}

/**
 * 可调参数的安全约束目录。边界依据 [Experience]：
 *   hauler.max 2–8（<2 物流断链，>8 单房 CPU/spawn 窗口不可承受）、
 *   hauler.min 2–4、harvester.max 2–6（<2 单点故障，>6 拥堵 source）、
 *   upgrader.max 1–4（>4 在 20 CPU 下不可承受）、builder.max 1–6（>6 抢占经济能量）。
 * 冷却 1000 tick = 2 次评估间隔（tuning-engine 每 500 tick 评估一次），
 * 确保上次调整的效果先在遥测数据中体现、至少跳过一次评估。
 */
export const TUNING_BOUNDS: Readonly<Record<string, ParamBounds>> = {
  "hauler.maxCount": {
    param: "hauler.maxCount",
    floor: 2,
    ceiling: 8,
    step: 1,
    cooldownTicks: 1000,
    verifyDelay: 1500,
  },
  "hauler.minCount": {
    param: "hauler.minCount",
    floor: 2,
    ceiling: 4,
    step: 1,
    cooldownTicks: 1000,
    verifyDelay: 1500,
  },
  "harvester.maxCount": {
    param: "harvester.maxCount",
    floor: 2,
    ceiling: 6,
    step: 1,
    cooldownTicks: 1000,
    verifyDelay: 1500,
  },
  "upgrader.maxCount": {
    param: "upgrader.maxCount",
    floor: 1,
    ceiling: 4,
    step: 1,
    cooldownTicks: 1000,
    verifyDelay: 1500,
  },
  "builder.maxCount": {
    param: "builder.maxCount",
    floor: 1,
    ceiling: 6,
    step: 1,
    cooldownTicks: 1000,
    verifyDelay: 1500,
  },
};

// ─── 改进 A 冻结机制常量（附录 D.5）──────────────────────────

/**
 * 连续回滚达此阈值即冻结（附录 B-P3）：信号不稳定的参数会无限「上调→回滚」
 * 循环、每次耗 2000 tick 与 Memory 写入；3 次是区分偶发噪声与结构性问题的证据水位。
 */
export const ROLLBACK_FREEZE_THRESHOLD = 3;

/** 冻结时长：10000 tick ≈ 2 个完整振荡周期，信号稳定后自动解冻恢复评估。 */
export const FROZEN_DURATION = 10000;

// ─── Storage 阈值按 RCL 分档（改进 C）─────────────────────────

/** [事实] 官方常量 — storage 最大能量容量。 */
export const STORAGE_CAPACITY = 1_000_000;

/** RCL 分档名称。 */
type RclBucket = "early" | "mid" | "late";

/**
 * Storage 阈值按 RCL 分档（占 STORAGE_CAPACITY 百分比）：
 * early(RCL≤4) 小库存即盈余、可烧库存冲级；mid(RCL5-6) 保持默认值最小化行为变化；
 * late(RCL7-8) 5 万是正常发展储备，25 万才算盈余（贴近 W8N3 实测 32 万，略低留余量）。
 */
const STORAGE_THRESHOLDS_BY_RCL: Readonly<Record<RclBucket, {
  surplusPct: number;
  lowPct: number;
}>> = {
  early: { surplusPct: 0.02, lowPct: 0.002 }, // surplus=2万 / low=2千
  mid:   { surplusPct: 0.05, lowPct: 0.01 },  // surplus=5万 / low=1万（保持当前默认值）
  late:  { surplusPct: 0.25, lowPct: 0.05 },  // surplus=25万 / low=5万
};

/** 按 RCL 返回 storage 盈余/低位阈值（绝对值；surplus 触发上调、low 触发下调）。 */
export function getStorageThresholds(rcl: number): { surplus: number; low: number } {
  const bucket: RclBucket = rcl <= 4 ? "early" : rcl <= 6 ? "mid" : "late";
  const t = STORAGE_THRESHOLDS_BY_RCL[bucket];
  return {
    surplus: t.surplusPct * STORAGE_CAPACITY,
    low: t.lowPct * STORAGE_CAPACITY,
  };
}

// ─── 策略参数边界（empire 级，非 room 级）──────────────────────

/** 策略参数的安全约束。 */
export interface StrategyParamBounds {
  param: string;
  floor: number;
  ceiling: number;
  step: number;
}

/**
 * 姿态参数可调边界。初始值保守取 DEFAULT ± 20%。
 * 边界依据：姿态参数影响帝国级行为，过大偏移可能导致姿态机失效
 * （如 minDwell 过低 → 抖动；expandMinBucket 过低 → CPU 死亡螺旋）。
 */
export const STRATEGY_BOUNDS: Readonly<Record<string, StrategyParamBounds>> = {
  "posture.minDwell": {
    param: "posture.minDwell",
    floor: 500,
    ceiling: 3000,
    step: 200,
  },
  "posture.warPatience": {
    param: "posture.warPatience",
    floor: 2000,
    ceiling: 10000,
    step: 1000,
  },
  "posture.expandMinBucket": {
    param: "posture.expandMinBucket",
    floor: 5000,
    ceiling: 10000,
    step: 500,
  },
  "posture.expandMaxPressure": {
    param: "posture.expandMaxPressure",
    floor: 0.2,
    ceiling: 0.6,
    step: 0.05,
  },
};

/** 将策略参数值钳制在安全边界内。 */
export function clampStrategyParam(param: string, value: number): number {
  const bounds = STRATEGY_BOUNDS[param];
  if (!bounds) return value;
  return Math.max(bounds.floor, Math.min(bounds.ceiling, value));
}

/** 将值钳制在参数的安全边界内。 */
export function clampParam(param: string, value: number): number {
  const bounds = TUNING_BOUNDS[param];
  if (!bounds) return value;
  return Math.max(bounds.floor, Math.min(bounds.ceiling, value));
}

/** 检查参数是否仍在冷却期内。 */
export function isInCooldown(
  param: string,
  lastAdjustedTick: number | undefined,
  currentTick: number,
): boolean {
  if (lastAdjustedTick === undefined) return false;
  const bounds = TUNING_BOUNDS[param];
  if (!bounds) return false;
  return currentTick - lastAdjustedTick < bounds.cooldownTicks;
}
