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
  /**
   * 改进 A（P1，附录 B-P1）：效果显现最小 tick — 调整后需等待此 tick 数
   * 才验证效果。人口类参数需等 creep 孵化(~150 tick) + 老 creep 死亡
   * (CREEP_LIFE_TIME 部分) + 效果在遥测窗口显现(500 tick) = 1500 tick
   * = 3 个评估周期，确保效果在 EVAL_WINDOW_SIZE(1000 tick) 窗口内充分显现。
   *
   * verifyDelay 必须 ≥ cooldownTicks，否则验证 pass 在冷却期内触发，
   * evaluator 的 isInCooldown 会拦截反向调整，但验证本身无意义（效果未显现）。
   * 当前所有参数 verifyDelay 统一 1500（无立即生效类参数）。
   */
  verifyDelay: number;
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
    verifyDelay: 1500,
  },
  "hauler.minCount": {
    param: "hauler.minCount",
    floor: 1,
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
 * 连续回滚次数达到此阈值时冻结参数。
 * 设计依据（附录 B-P3）：信号不稳定的参数会无限「上调→回滚」循环，
 * 每次消耗 2000 tick 与 Memory 写入。3 次是「不是偶发噪声而是结构性
 * 信号问题」的合理证据水位。
 */
export const ROLLBACK_FREEZE_THRESHOLD = 3;

/**
 * 参数冻结持续时间（tick）。
 * 10000 tick ≈ 2 个完整振荡周期，让信号稳定后自动解冻。
 * 到期后参数从评估排除名单移除，恢复正常评估。
 */
export const FROZEN_DURATION = 10000;

// ─── Storage 阈值按 RCL 分档（改进 C）─────────────────────────

/** [事实] 官方常量 — storage 最大能量容量。 */
export const STORAGE_CAPACITY = 1_000_000;

/** RCL 分档名称。 */
type RclBucket = "early" | "mid" | "late";

/**
 * Storage 阈值按 RCL 分档（占 STORAGE_CAPACITY 百分比）。
 *
 * 设计依据：
 *   - early (RCL≤4): storage 刚解锁或未解锁，小库存即视为「盈余」可烧库存冲级
 *   - mid   (RCL5-6): 保持原默认值（surplus=5万 / low=1万），最小化行为变化
 *   - late  (RCL7-8): 高 RCL 房 5 万库存是「正常发展储备」，
 *                     需 25 万才视为「盈余」（贴近 W8N3 实测 32 万，略低留余量）
 */
const STORAGE_THRESHOLDS_BY_RCL: Readonly<Record<RclBucket, {
  surplusPct: number;
  lowPct: number;
}>> = {
  early: { surplusPct: 0.02, lowPct: 0.002 }, // surplus=2万 / low=2千
  mid:   { surplusPct: 0.05, lowPct: 0.01 },  // surplus=5万 / low=1万（保持当前默认值）
  late:  { surplusPct: 0.25, lowPct: 0.05 },  // surplus=25万 / low=5万
};

/**
 * 按 RCL 返回 storage 盈余/低位阈值（绝对值）。
 *
 * @param rcl 房间控制器等级
 * @returns `{ surplus, low }` — surplus 触发上调阈值，low 触发下调阈值
 */
export function getStorageThresholds(rcl: number): { surplus: number; low: number } {
  const bucket: RclBucket = rcl <= 4 ? "early" : rcl <= 6 ? "mid" : "late";
  const t = STORAGE_THRESHOLDS_BY_RCL[bucket];
  return {
    surplus: t.surplusPct * STORAGE_CAPACITY,
    low: t.lowPct * STORAGE_CAPACITY,
  };
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
