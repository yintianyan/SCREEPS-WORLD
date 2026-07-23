/**
 * Movement barrel — 保持消费者导入路径不变（`from "../movement"`）。
 *
 * 实际实现拆分为三个子模块（Phase 6 重构）：
 *   - traffic.ts         — 交通热度记录（recordTraffic, packPos）
 *   - stuck-recovery.ts  — 卡位检测、yield/pull、目标清除、安全出口
 *   - pathfinding.ts     — 结构缓存、路径持久化、走廊共享、跨房间缓存、moveToTarget
 *
 * 依赖方向（无循环）：
 *   traffic → globalCache
 *   stuck-recovery → traffic + support/assignment-adapter
 *   pathfinding → traffic + stuck-recovery + config + globalCache
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
} from "./pathfinding";
