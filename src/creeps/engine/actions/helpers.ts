/**
 * Action 共享辅助 — 跨领域复用的 execute 层工具函数。
 *
 * 从 role-runner.ts 迁出，消除 actions → role-runner 的循环依赖。
 * role-runner 属于引擎层（生命周期调度），runAction 属于 execute 层（行为执行辅助）。
 */
import { moveToTarget } from "../../movement";

/**
 * 错误码 → 副作用处理器的映射。
 *
 * 键为 Screeps 错误码常量（如 `ERR_FULL`、`ERR_INVALID_TARGET`），
 * 值为无参闭包 — 在 execute 闭包内自然捕获 `ac` 和 `target`。
 *
 * `ERR_NOT_IN_RANGE` 由 `runAction` 自动处理（触发移动），**不应**在此声明。
 */
export type ErrorHandlers = Partial<Record<number, () => void>>;

/**
 * 执行操作并统一处理错误码。
 *
 * 统一了 30+ action 的错误处理模式：
 *   - `ERR_NOT_IN_RANGE`（-9）：自动触发 `moveToTarget`，无需声明。
 *   - 其他错误码：查 `handlers` 表，有则执行对应闭包。
 *   - 未注册的错误码：静默忽略（调用方可通过返回值自行判断）。
 *
 * 每个 action 的 `execute` 只需声明它关心哪些错误码及对应副作用，
 * 不再裸写 `if (result === ERR_xxx)` 分支 — 消除六种不一致模式的根源。
 *
 * @returns Screeps 结果码（供调用方自行判断）
 *
 * @example
 * // transfer 满了 → 清缓存 + 切 mode
 * runAction(ac.creep, t, () => ac.creep.transfer(t, RESOURCE_ENERGY), {
 *   [ERR_FULL]: () => {
 *     ac.creep.memory.fillTargetId = undefined;
 *     updateMode(ac.creep);
 *   },
 * });
 *
 * @example
 * // build 目标消失 → 清 targetId
 * runAction(ac.creep, site, () => ac.creep.build(site), {
 *   [ERR_INVALID_TARGET]: () => { ac.creep.memory.targetId = undefined; },
 * });
 *
 * @example
 * // 无额外错误处理（等价于 actOrMove）
 * runAction(ac.creep, t, () => ac.creep.withdraw(t, RESOURCE_ENERGY));
 */
export function runAction(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  action: () => number,
  handlers?: ErrorHandlers,
): number {
  const result = action();
  if (result === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, target);
  } else if (handlers) {
    const handler = handlers[result];
    if (handler) handler();
  }
  return result;
}

/**
 * 对目标执行操作；ERR_NOT_IN_RANGE 时移动。返回操作结果码。
 *
 * @deprecated 使用 `runAction` 替代 — 它支持声明式错误处理。
 * 此函数保留为 `runAction(creep, target, action)` 的语义别名，
 * 已有无 handler 调用点无需修改。
 */
export function actOrMove(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  action: () => number,
): number {
  return runAction(creep, target, action);
}
