/**
 * home mineral 停采闩锁（Phase C）。
 *
 * 契约 §9 决策 4：home mineral 总库存 ≥10K 且无 ticket 时停采；<5K 或有新 ticket 时恢复。
 * 回差避免在单阈值附近反复启停；ticket 优先保证有真实下游需求时不被库存闸饿死。
 */

/** 停采线：库存达到此值时关闭采矿（无 ticket 时）。 */
export const HOME_MINERAL_STOP_STOCK = 10000;

/** 恢复线：关闭后库存必须跌破此值才恢复（回差）。 */
export const HOME_MINERAL_RESUME_STOCK = 5000;

/**
 * 计算下一 tick 是否允许采矿。纯函数。
 *
 * - 有 ticket（lab/factory/援助/买盘）→ 始终允许；
 * - 已开启：库存 < stopStock 时继续，达到 stopStock 关闭；
 * - 已关闭：库存 < resumeStock 才恢复。
 *
 * @param previous 上一 tick 状态；undefined = 首次运行（按 resumeStock 冷启动）。
 */
export function nextHomeMineralMiningActive(
  previous: boolean | undefined,
  stock: number,
  hasDemand: boolean,
  stopStock: number = HOME_MINERAL_STOP_STOCK,
  resumeStock: number = HOME_MINERAL_RESUME_STOCK,
): boolean {
  if (hasDemand) return true;
  if (previous === true) return stock < stopStock;
  return stock < resumeStock;
}
