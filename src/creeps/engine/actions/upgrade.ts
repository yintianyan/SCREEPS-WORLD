/**
 * Upgrade actions — 升级控制器。
 *
 * 两个变体：
 *   - upgradeController: 无能量门禁（角色自行决定是否升级）
 *   - upgradeControllerGated: 带 energyAvailable >= floor 门禁（防止与孵化竞争）
 *
 * 移动按 range 3 求路（upgradeController 的交互距离）而非 runAction 默认的
 * range 1：controller 常嵌在地形墙中，range1 落点可能只有 controller container
 * 一格且被站桩静态阻挡标 255 — 按 range1 求路无解，upgrader 满载石化；
 * range3 有大把落点（线上实测事故，见 moveToTarget 的 moveRange 参数）。
 */
import { CONFIG } from "../../../config";
import type { ActionCandidate } from "../action-types";
import { moveToTarget } from "../../movement";

/** upgradeController 的交互距离（官方机制：range ≤ 3 可升级）。 */
const UPGRADE_RANGE = 3;

/** 升级控制器（无能量门禁）。 */
export function upgradeController(): ActionCandidate<StructureController> {
  return {
    name: "upgrade:controller",
    resolve: (ac) => {
      const ctrl = ac.snapshot.controller;
      if (!ctrl || !ctrl.my) return undefined;
      return ctrl;
    },
    execute: (ac, ctrl) => {
      if (ac.creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, ctrl, UPGRADE_RANGE);
      }
    },
  };
}

/** 升级控制器（带能量门禁：energyAvailable >= floor）。 */
export function upgradeControllerGated(): ActionCandidate<StructureController> {
  return {
    name: "upgrade:controller-gated",
    resolve: (ac) => {
      const ctrl = ac.snapshot.controller;
      if (!ctrl || !ctrl.my) return undefined;
      if (ac.snapshot.energyAvailable < CONFIG.economy.upgradeEnergyFloor) return undefined;
      return ctrl;
    },
    execute: (ac, ctrl) => {
      if (ac.creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, ctrl, UPGRADE_RANGE);
      }
    },
  };
}
