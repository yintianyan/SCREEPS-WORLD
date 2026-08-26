/**
 * UOEM Core — Operation Interval Model.
 *
 * STEP 1.2：不可变生命周期时间模型。
 * 纯 Domain 层：不引用 Game / Memory / RawMemory / CPU。
 *
 * openedAt = Operation 创建 tick（consume Plan 时铸造，永不修改）
 * closedAt = terminal tick（只设置一次）
 *
 * duration = closedAt - openedAt（不读取 expansion.startedAt）
 */

/**
 * Operation Interval — 不可变生命周期锚点。
 *
 * openedAt immutable：readonly 保证编译期不可赋值。
 * closedAt optional：undefined = Operation 未终态。
 */
export interface OperationInterval {
  /** Operation 创建 tick（immutable，永不修改）。 */
  readonly openedAt: number;
  /** Operation 终态 tick（只在 terminal 时设置，undefined = 未终态）。 */
  readonly closedAt?: number;
}

/**
 * 开启 Interval — 纯函数。
 *
 * @param openedAt Operation 创建 tick
 * @returns 新的 OperationInterval，closedAt 为 undefined
 */
export function openInterval(openedAt: number): OperationInterval {
  return { openedAt };
}

/**
 * 关闭 Interval — 纯函数，返回新对象。
 *
 * 不修改原 interval（不可变）。
 * 如果 interval 已有 closedAt，返回原对象（幂等）。
 *
 * @param interval 待关闭的 interval
 * @param closedAt terminal 发生 tick
 * @returns 新 interval 或原 interval（幂等）
 */
export function closeInterval(interval: OperationInterval, closedAt: number): OperationInterval {
  if (interval.closedAt !== undefined) return interval; // 幂等：已关闭
  return { openedAt: interval.openedAt, closedAt };
}

/**
 * 计算 Operation duration — 纯函数。
 *
 * duration = closedAt - openedAt
 *
 * 如果 interval 未 closed（closedAt 为 undefined），返回 undefined。
 * 不猜测，不使用当前 tick 替代 closedAt。
 *
 * 绝对禁止从 Memory.kernel.expansion.startedAt 推导 duration。
 */
export function computeDuration(interval: OperationInterval): number | undefined {
  if (interval.closedAt === undefined) return undefined;
  return interval.closedAt - interval.openedAt;
}

/**
 * 计算 Operation 当前经过的时间（如果未终态）。
 *
 * 如果已 closed，返回 duration。
 * 如果未 closed，返回 currentTick - openedAt（用于实时监控，不用于 outcome）。
 *
 * @param interval Operation Interval
 * @param currentTick 当前 tick
 * @returns duration（已 closed）或 elapsed（未 closed）
 */
export function computeElapsedOrDuration(interval: OperationInterval, currentTick: number): number {
  if (interval.closedAt !== undefined) {
    return interval.closedAt - interval.openedAt;
  }
  return currentTick - interval.openedAt;
}

/**
 * 验证 Interval 合法性 — 纯函数。
 *
 * openedAt 必须 >= 0。
 * closedAt 如果存在，必须 >= openedAt。
 */
export function isValidInterval(interval: OperationInterval): boolean {
  if (!Number.isFinite(interval.openedAt) || interval.openedAt < 0) return false;
  if (interval.closedAt !== undefined) {
    if (!Number.isFinite(interval.closedAt)) return false;
    if (interval.closedAt < interval.openedAt) return false;
  }
  return true;
}
