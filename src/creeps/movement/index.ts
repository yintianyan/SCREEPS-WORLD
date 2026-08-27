/** Movement barrel — 保持消费者导入路径不变（`from "../movement"`）。 */

export { packPos, recordTraffic } from "./traffic";

export {
  checkAndExecuteYield,
  tryPullBlocker,
  updateStuckTicks,
  clearTarget,
  findSafestExit,
} from "./stuck-recovery";

export {
  moveToTarget,
  moveTowardRoom,
  ensureHome,
  stepToward,
  preloadStructureCache,
  preloadStaticBlockers,
  registerStaticBlocker,
  invalidateCreepPath,
  // @internal — 仅供单元测试访问缓存行为，业务代码不直接调用
  getCoreCenter,
} from "./pathfinding";

export { parkIdleCreep, isSafeSpot } from "./parking";

export { registerAnchor, registerMove, movePriorityFor, trafficEnabled } from "./intent";
