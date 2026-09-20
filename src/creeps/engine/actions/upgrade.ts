/** Upgrade actions — 升级控制器。 */
import { CONFIG } from "../../../config";
import type { ActionCandidate } from "../action-types";
import { moveToTarget, registerAnchor } from "../../movement";
import { countedIntent } from "./helpers";

/** upgradeController 的交互距离（官方机制：range ≤ 3 可升级）。 */
const UPGRADE_RANGE = 3;

/**
 * 升一次控制器，否则向控制器靠拢。
 *
 * 射程预判：射程外的 upgradeController 必被引擎拒绝（引擎先做射程检查），但注定失败
 * 的签发已经付过钱 —— 实测 3 房发育世界里 upgrade 空签发 1.44/tick（同期成功签发仅
 * 0.03/tick），按 0.21 CPU/签发 ≈ 0.30 CPU/tick。提前拦截与原行为等价：两条路径
 * 都以同样参数调用 moveToTarget，只是不再为空签发买单。
 * 保留返回码兜底：跨房 getRangeTo 的取值不作保证，引擎若仍拒就照旧走移动。
 */
function upgradeOrApproach(creep: Creep, ctrl: StructureController): void {
  if (creep.pos.getRangeTo(ctrl.pos) > UPGRADE_RANGE) {
    moveToTarget(creep, ctrl, UPGRADE_RANGE);
    return;
  }
  if (countedIntent("upgrade", () => creep.upgradeController(ctrl)) === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, ctrl, UPGRADE_RANGE);
  }
}

/** 升级控制器（无能量门禁）。 */
export function upgradeController(): ActionCandidate<StructureController> {
  return {
    name: "upgrade:controller",
    resolve: ac => {
      const ctrl = ac.snapshot.controller;
      if (!ctrl || !ctrl.my) return undefined;
      return ctrl;
    },
    execute: (ac, ctrl) => upgradeOrApproach(ac.creep, ctrl),
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
    resolve: ac => {
      const ctrl = ac.snapshot.controller;
      if (!ctrl || !ctrl.my) return undefined;
      if (ac.creep.pos.getRangeTo(ctrl.pos) > UPGRADE_RANGE) return undefined;
      // 优先 controller link（瞬移供能、无 hauler 依赖）。
      const link = ac.snapshot.links.find(
        l =>
          l.pos.getRangeTo(ctrl.pos) <= 2 &&
          ac.creep.pos.getRangeTo(l.pos) <= 1 &&
          l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      if (link) return { controller: ctrl, source: link };
      // 回退 controller container（无 link 名额/非主房）。snapshot.controllerContainer 是预算的
      // 「controller 旁 container」，天然近 controller，只需校验紧邻取能 + 有能量。
      const cc = ac.snapshot.controllerContainer;
      if (
        cc &&
        ac.creep.pos.getRangeTo(cc.pos) <= 1 &&
        cc.store.getUsedCapacity(RESOURCE_ENERGY) > 0
      ) {
        return { controller: ctrl, source: cc };
      }
      return undefined;
    },
    execute: (ac, t) => {
      // 同 tick 取 + 升：稳态下 carry 恒接近满，升级永不断粮（满 WORK 效率）。返回码无需处理 —
      // carry 满时 withdraw 返回 ERR_FULL（无害 no-op），下一 tick 升级腾出空间即补。
      countedIntent("withdraw", () => ac.creep.withdraw(t.source, RESOURCE_ENERGY));
      countedIntent("upgrade", () => ac.creep.upgradeController(t.controller));
      // 站桩锚定：防被过路 creep 从取能/升级位推离。
      registerAnchor(ac.creep, CONFIG.movement.trafficPriority.anchorStation);
    },
  };
}

/** 升级控制器（带能量门禁：energyAvailable >= floor）。 */
export function upgradeControllerGated(): ActionCandidate<StructureController> {
  return {
    name: "upgrade:controller-gated",
    resolve: ac => {
      const ctrl = ac.snapshot.controller;
      if (!ctrl || !ctrl.my) return undefined;
      if (ac.snapshot.energyAvailable < CONFIG.economy.upgradeEnergyFloor) return undefined;
      return ctrl;
    },
    execute: (ac, ctrl) => upgradeOrApproach(ac.creep, ctrl),
  };
}
