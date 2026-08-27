/** Creep 工具函数 barrel — 统一重导出，保持消费者导入路径不变。 */
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
