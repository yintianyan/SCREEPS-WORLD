/**
 * Creep 工具函数 barrel — 统一重导出，保持消费者导入路径不变。
 * 依赖方向（无循环）：movement → assignment-adapter；lifecycle → movement + assignment-adapter；
 * targeting 独立（仅依赖 contracts + global-cache）。
 */
export {
  packPos,
  recordTraffic,
  moveTowardRoom,
  ensureHome,
  moveToTarget,
  clearTarget,
  findSafestExit,
} from "../movement";

export {
  getSource,
  getFillTarget,
  getHaulFillTarget,
  getDistributorFillTarget,
  pickHaulFillTargetInRange,
  findRichestContainer,
  findClosestContainerWithEnergy,
  findEmptiestContainer,
  findCriticalRepair,
} from "./targeting";
export type { FillTarget } from "./targeting";

export {
  getAssignment,
  releaseAssignment,
} from "./assignment-adapter";

export {
  updateMode,
  shouldFlee,
  shouldFleeForeignRoom,
  flee,
  fleeToHome,
  shelterAtCore,
} from "../engine/lifecycle";
