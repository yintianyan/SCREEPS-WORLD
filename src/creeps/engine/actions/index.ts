/**
 * Actions barrel — 统一重导出所有领域 action 工厂。
 *
 * 角色文件只需 `from "../engine/actions"` 即可导入所有 action，
 * 无需感知内部分文件结构。
 */
export { harvestSource, stationaryMine, harvestMineral } from "./harvest";
export { pickupDroppedEnergy, pickupNearbyDroppedEnergy, lootRemains } from "./pickup";
export {
  withdrawRichestContainer,
  withdrawClosestContainer,
  withdrawRichestNonSourceContainer,
  withdrawClosestNonSourceContainer,
  withdrawControllerContainer,
  withdrawControllerLink,
  withdrawStorage,
  withdrawStorageLink,
  withdrawStorageCapped,
  withdrawCapped,
} from "./withdraw";
export {
  dumpToNearbyLink,
  dumpToNearbyContainer,
  dumpMineralsToNearbyContainer,
  buildNearbyContainerSite,
} from "./dump";
export {
  fillTarget,
  haulFillTarget,
  distributorFillTarget,
  fillEmptiestContainer,
  fillStorage,
} from "./fill";
export { buildAssignmentSite, buildNearestSite } from "./build";
export type { BuildAssignmentOptions } from "./build";
export {
  repairCritical,
  repairContainerDecay,
  repairNearbyContainer,
  repairRoads,
  repairUrgentRoads,
  repairFortifications,
  repairFreshRampart,
} from "./repair";
export { stationaryUpgrade, upgradeController, upgradeControllerGated } from "./upgrade";
export {
  haulMineralsToStorage,
  supplyLabs,
  stockTerminalEnergy,
  stockFactoryEnergy,
  withdrawTerminalEnergy,
} from "./industry";
