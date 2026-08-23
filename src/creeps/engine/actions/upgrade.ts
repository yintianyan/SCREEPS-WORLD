/**
 * Upgrade actions — 升级控制器。
 * 两个变体：upgradeController（无门禁）/ upgradeControllerGated（energyAvailable >= floor，防与孵化竞争）。
 * 移动按 range 3 求路（官方交互距离）而非 runAction 默认的 range 1：controller 常嵌地形墙中，
 * range1 落点可能只有 controller container 一格且被站桩静态阻挡标 255 → 求路无解，
 * upgrader 满载石化（线上实测事故，见 moveToTarget 的 moveRange 参数）。
 */
import { CONFIG } from "../../../config";
import type { ActionCandidate } from "../action-types";
import { moveToTarget, registerAnchor } from "../../movement";
import { countedUpgrade } from "./helpers";

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
      if (countedUpgrade(ac.creep, ctrl) === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, ctrl, UPGRADE_RANGE);
      }
    },
  };
}

/** stationaryUpgrade 的复合目标（controller + 供能结构：link 或 container）。 */
interface StationaryUpgradeTarget {
  controller: StructureController;
  source: StructureLink | StructureContainer;
}

/**
 * 站桩升级并同 tick 取能（controller 旁 link/container 的 0 通勤 upgrader 专用）。
 * 关键（[Facts]）：withdraw 与 upgradeController 是独立 intent，可同 tick 执行——站既够 controller
 * （range<=3）又紧邻供能结构（range<=1）处，每 tick「取+升」，消除双模 FSM 取能空转
 * （1 CARRY/15 WORK 仅 ~67% 效率；此前只认 link，container 供能 upgrader 退化仅 ~30-48% 潜力）。
 * 供能优先级：controller link 优先（瞬移供能无需 hauler），无则回退 container。
 * 镜像 stationaryMine：同置 acquire[0] 与 work[0]，绕开「单 tick 只跑一条链」。
 * 触发条件：己方 controller + 在升级范围 + 身边有带能 link/container；不满足回退常规链。
 */
export function stationaryUpgrade(): ActionCandidate<StationaryUpgradeTarget> {
  return {
    name: "upgrade:stationary",
    resolve: (ac) => {
      const ctrl = ac.snapshot.controller;
      if (!ctrl || !ctrl.my) return undefined;
      if (ac.creep.pos.getRangeTo(ctrl.pos) > UPGRADE_RANGE) return undefined;
      // 优先 controller link（瞬移供能、无 hauler 依赖）。
      const link = ac.snapshot.links.find(
        l => l.pos.getRangeTo(ctrl.pos) <= 2 &&
          ac.creep.pos.getRangeTo(l.pos) <= 1 &&
          l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      if (link) return { controller: ctrl, source: link };
      // 回退 controller container（无 link 名额/非主房）。snapshot.controllerContainer 是预算的
      // 「controller 旁 container」，天然近 controller，只需校验紧邻取能 + 有能量。
      const cc = ac.snapshot.controllerContainer;
      if (cc && ac.creep.pos.getRangeTo(cc.pos) <= 1 && cc.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        return { controller: ctrl, source: cc };
      }
      return undefined;
    },
    execute: (ac, t) => {
      // 同 tick 取 + 升：稳态下 carry 恒接近满，升级永不断粮（满 WORK 效率）。返回码无需处理 —
      // carry 满时 withdraw 返回 ERR_FULL（无害 no-op），下一 tick 升级腾出空间即补。
      ac.creep.withdraw(t.source, RESOURCE_ENERGY);
      countedUpgrade(ac.creep, t.controller);
      // 站桩锚定：防被过路 creep 从取能/升级位推离。
      registerAnchor(ac.creep, CONFIG.movement.trafficPriority.anchorStation);
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
      if (countedUpgrade(ac.creep, ctrl) === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, ctrl, UPGRADE_RANGE);
      }
    },
  };
}
