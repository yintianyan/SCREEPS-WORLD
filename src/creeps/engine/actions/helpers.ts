/**
 * Action 共享辅助 — 跨领域复用的 execute 层工具函数。
 * 从 role-runner.ts 迁出，消除 actions → role-runner 的循环依赖。
 */
import { moveToTarget } from "../../movement";

/**
 * 错误码 → 副作用处理器的映射。键为 Screeps 错误码常量，值为在 execute 闭包内
 * 自然捕获 ac/target 的无参闭包。`ERR_NOT_IN_RANGE` 由 runAction 自动处理
 * （触发移动），**不应**在此声明。
 */
export type ErrorHandlers = Partial<Record<number, () => void>>;

/**
 * 执行操作并统一处理错误码（统一 30+ action 的错误处理模式）：
 * ERR_NOT_IN_RANGE（-9）自动 moveToTarget；其他错误查 handlers 表执行对应闭包；
 * 未注册的错误码静默忽略（调用方可用返回值判断）。
 * 消除各 action 裸写 `if (result === ERR_xxx)` 分支的六种不一致模式。
 * @returns Screeps 结果码（供调用方自行判断）
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

/** 对目标执行操作；ERR_NOT_IN_RANGE 时移动。返回操作结果码。
 * @deprecated 使用 `runAction` 替代 — 保留为无 handler 调用点的语义别名。 */
export function actOrMove(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  action: () => number,
): number {
  return runAction(creep, target, action);
}
