/**
 * Creep 工具函数 barrel — 统一从子模块重导出，保持消费者导入路径不变。
 *
 * 子模块按职责分离（plan §5.7）：
 *   - movement.ts          — 移动、位置、卡位检测、出口查找
 *   - targeting.ts         — 目标扫描与选择（source/fill/haul/repair）
 *   - assignment-adapter.ts — 任务分配适配层（Game/Memory ↔ 领域纯函数）
 *   - lifecycle.ts         — 模式转换、逃跑、防御
 *
 * 依赖方向（无循环）：
 *   movement → assignment-adapter
 *   lifecycle → movement + assignment-adapter
 *   targeting → （独立，仅依赖 contracts + global-cache）
 */
export {
  packPos,
  recordTraffic,
  moveTowardRoom,
  ensureHome,
  moveToTarget,
  clearTarget,
  findSafestExit,
} from "./movement";

export {
  getSource,
  getFillTarget,
  getHaulFillTarget,
  findRichestContainer,
  findClosestContainerWithEnergy,
  findEmptiestContainer,
  findCriticalRepair,
} from "./targeting";

export {
  getAssignment,
  releaseAssignment,
} from "./assignment-adapter";

export {
  updateMode,
  shouldFlee,
  flee,
} from "./lifecycle";
