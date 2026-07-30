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
import { moveToTarget, registerAnchor } from "../../movement";

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

/** stationaryUpgrade 的复合目标（controller + 供能结构：link 或 container）。 */
interface StationaryUpgradeTarget {
  controller: StructureController;
  source: StructureLink | StructureContainer;
}

/**
 * 站桩升级并同 tick 取能（controller 旁供能结构——link 或 container——的 0 通勤 upgrader 专用）。
 *
 * 关键：withdraw 与 upgradeController 是两个独立 intent，可在同一 tick 执行。
 * 只要 upgrader 站在既够到 controller（range<=3 升级）又紧邻供能结构（range<=1 取能）
 * 的位置，每 tick 即可「取 + 升」，让 WORK 满效运转，消除 acquire/work 双模 FSM
 * 「取能 tick 不升级」的产能损失 —— 小 CARRY body 尤甚（1 CARRY = 50 容量，
 * 15 WORK 约 4 tick 抽干，每 5 tick 空耗 1 tick 取能 → 仅 ~67% 效率、10/tick；
 * 同 tick 取+升后恢复满效 15/tick）。container 供能同理（此前本动作只认 link，
 * container 供能的 upgrader 退化成分离取/升，实测仅发挥 ~30-48% 潜力）。
 *
 * 供能优先级：controller link 优先（link 网络瞬移供能，无需 hauler 往返），
 * 无 link 时回退 controller container（RCL5 尚无 link 名额、或非主房只有 container）。
 *
 * 镜像 harvester.stationaryMine：同置于 upgrader 的 acquire[0] 与 work[0]，
 * 绕开「单 tick 只跑一条链」的限制，无论 FSM 处于哪个 mode 都取+升同 tick。
 *
 * 触发条件：controller 己方、creep 已在升级范围内（range<=3，本动作不通勤，
 * 通勤由 moveToStation 兜底）、且身边（range<=1）有带能量的 controller link 或 container。
 * 任一不满足 resolve=undefined，回退常规链（withdraw / upgrade）。
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
      // 回退 controller container（无 link 名额/非主房）。snapshot.controllerContainer
      // 是预算的「controller 旁 container」（room-snapshot 从 containers 中筛出），
      // 天然满足近 controller，只需校验 creep 紧邻取能 + 有能量。
      const cc = ac.snapshot.controllerContainer;
      if (cc && ac.creep.pos.getRangeTo(cc.pos) <= 1 && cc.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        return { controller: ctrl, source: cc };
      }
      return undefined;
    },
    execute: (ac, t) => {
      // 同 tick 取 + 升：withdraw 补充 carry，upgradeController 消耗 carry。
      // 稳态下 carry 恒接近满，升级永不断粮（满 WORK 效率）。返回码无需处理 —
      // carry 满时 withdraw 返回 ERR_FULL（无害 no-op），下一 tick 升级腾出空间即补。
      ac.creep.withdraw(t.source, RESOURCE_ENERGY);
      ac.creep.upgradeController(t.controller);
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
      if (ac.creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, ctrl, UPGRADE_RANGE);
      }
    },
  };
}
