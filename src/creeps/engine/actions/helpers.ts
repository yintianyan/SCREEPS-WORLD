/**
 * Action 共享辅助 — 跨领域复用的 execute 层工具函数。
 *
 * 从 role-runner.ts 迁出，消除 actions → role-runner 的循环依赖。
 * role-runner 属于引擎层（生命周期调度），actOrMove 属于 execute 层（行为执行辅助）。
 */
import { moveToTarget } from "../../movement";

/** 对目标执行操作；ERR_NOT_IN_RANGE 时移动。返回操作结果码。 */
export function actOrMove(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  action: () => number,
): number {
  const result = action();
  if (result === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, target);
  }
  return result;
}
