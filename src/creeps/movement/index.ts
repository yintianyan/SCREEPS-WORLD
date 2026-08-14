/**
 * Movement barrel — 保持消费者导入路径不变（`from "../movement"`）。
 * 实现拆为：traffic.ts（交通热度记录）、stuck-recovery.ts（卡位自愈）、pathfinding.ts（寻路）。
 * 依赖方向（无循环）：traffic → globalCache；stuck-recovery → traffic + assignment-adapter；
 * pathfinding → traffic + stuck-recovery + config + globalCache。
 */

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
  // @internal — 仅供单元测试访问缓存行为，业务代码不直接调用
  getCoreCenter,
} from "./pathfinding";

export { parkIdleCreep, isSafeSpot } from "./parking";

export { registerAnchor, registerMove, movePriorityFor, trafficEnabled } from "./intent";
