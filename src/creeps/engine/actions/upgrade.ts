/**
 * Upgrade actions — 升级控制器。
 *
 * 两个变体：
 *   - upgradeController: 无能量门禁（角色自行决定是否升级）
 *   - upgradeControllerGated: 带 energyAvailable >= floor 门禁（防止与孵化竞争）
 */
import { CONFIG } from "../../../config";
import type { ActionCandidate } from "../action-types";
import { actOrMove } from "./helpers";

/** 升级控制器（无能量门禁）。 */
export function upgradeController(): ActionCandidate {
  return {
    name: "upgrade:controller",
    resolve: (ac) => {
      const ctrl = ac.snapshot.controller;
      if (!ctrl || !ctrl.my) return undefined;
      return ctrl;
    },
    execute: (ac, target) => {
      const ctrl = target as StructureController;
      actOrMove(ac.creep, ctrl, () => ac.creep.upgradeController(ctrl));
    },
  };
}

/** 升级控制器（带能量门禁：energyAvailable >= floor）。 */
export function upgradeControllerGated(): ActionCandidate {
  return {
    name: "upgrade:controller-gated",
    resolve: (ac) => {
      const ctrl = ac.snapshot.controller;
      if (!ctrl || !ctrl.my) return undefined;
      if (ac.snapshot.energyAvailable < CONFIG.economy.upgradeEnergyFloor) return undefined;
      return ctrl;
    },
    execute: (ac, target) => {
      const ctrl = target as StructureController;
      actOrMove(ac.creep, ctrl, () => ac.creep.upgradeController(ctrl));
    },
  };
}
