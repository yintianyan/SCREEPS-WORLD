/**
 * Tuning Bounds — 每个可调参数的安全边界、步长和冷却时间。
 *
 * 设计原则：
 *   - 硬边界（floor/ceiling）是绝对安全限制，覆盖值永远不能超出。
 *   - 步长（step）控制单次调整幅度——保守起见统一为 1。
 *   - 冷却（cooldownTicks）防止同一参数频繁调整导致振荡。
 *   - 信号阈值定义在各自的评估函数中，这里只管参数的数值边界。
 *
 * 纯数据模块 — 不依赖 Game/Memory，可独立测试。
 */

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
}

/**
 * 所有可调参数的安全约束目录。
 *
 * 边界设定依据 [Experience]：
 *   hauler.maxCount:  2–8  — 低于 2 无法维持基本物流；高于 8 在单房下 CPU 和 spawn 窗口不可承受。
 *   hauler.minCount:  1–4  — 低于 1 物流断链；高于 4 浪费孵化能量。
 *   harvester.maxCount: 2–6 — 低于 2 单点故障；高于 6 拥堵 source。
 *   upgrader.maxCount: 1–4  — 低于 1 无法保级；高于 4 在 20CPU 下不可承受。
 *   builder.maxCount:  1–6  — 低于 1 无法建造；高于 6 抢占经济能量。
 *
 * 冷却时间 1000 tick（= 2 次评估间隔）：
 *   tuning-engine 每 500 tick 运行一次，1000 tick 冷却确保至少跳过一次评估，
 *   让上次调整的效果有时间在遥测数据中体现。
 */
export const TUNING_BOUNDS: Readonly<Record<string, ParamBounds>> = {
  "hauler.maxCount": {
    param: "hauler.maxCount",
    floor: 2,
    ceiling: 8,
    step: 1,
    cooldownTicks: 1000,
  },
  "hauler.minCount": {
    param: "hauler.minCount",
    floor: 1,
    ceiling: 4,
    step: 1,
    cooldownTicks: 1000,
  },
  "harvester.maxCount": {
    param: "harvester.maxCount",
    floor: 2,
    ceiling: 6,
    step: 1,
    cooldownTicks: 1000,
  },
  "upgrader.maxCount": {
    param: "upgrader.maxCount",
    floor: 1,
    ceiling: 4,
    step: 1,
    cooldownTicks: 1000,
  },
  "builder.maxCount": {
    param: "builder.maxCount",
    floor: 1,
    ceiling: 6,
    step: 1,
    cooldownTicks: 1000,
  },
};

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
