/**
 * Upgrader — P2 升级角色。
 *
 * 策略声明：
 *   gate:    能量地板门禁（仅阻止 acquire，不阻止 work）；紧急防降级覆盖
 *   acquire: 身边掉落能量 > controller link > controller container > storage(动态限量) > 最满非物流 container > harvest
 *   work:    升级控制器
 *
 * 站桩升级核心：upgrader 站在 controller 旁，从 link/container 取能 + 升级，0 通勤。
 * P1-1: storage 取能上限按水位动态缩放 — 高水位时放开上限加速消化库存，
 * 低水位时收紧防止 storage 突降触发 economyPressure 连锁降级。
 */
import { CONFIG } from "../../config";
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import {
  harvestSource,
  pickupNearbyDroppedEnergy,
  stationaryUpgrade,
  upgradeController,
  withdrawControllerContainer,
  withdrawControllerLink,
  withdrawRichestNonSourceContainer,
  withdrawStorageCapped,
} from "../engine/actions";
import { defineRole } from "../engine/role-runner";
import { moveToTarget, registerAnchor } from "../movement";

/** upgrader 视为「已在站桩位」的最大距离（controller container/controller 周边）。 */
const STATION_RANGE = 3;

/**
 * 空闲归站 — 不在站桩位附近时移动过去待命。
 *
 * 根因：acquire 链全部落空（controller container 存在但空、无 link、storage
 * 低水位、gate 拦截直采）时，role-runner 置 idle 且 upgrader 被 parking 排除
 * （parking.ts 明文豁免站桩角色）→ 刚孵化的 upgrader 石化在 spawn 出口挡路。
 * 「站桩角色的 idle 是守在 controller 旁」这个前提只有 creep 已经在站桩位才成立。
 *
 * 该动作作为 acquire 链兜底：已在站桩位 → resolve undefined（正常 idle 等补给）；
 * 不在 → 移动过去。到位后 hauler 一填 container 立即取能开工，零通勤延迟。
 */
function moveToStation(): ActionCandidate<StructureContainer | StructureController | StructureLink> {
  return {
    name: "move:controller-station",
    resolve: (ac) => resolveStationAnchor(ac),
    execute: (ac, anchor) => {
      moveToTarget(ac.creep, anchor);
    },
  };
}

/** 解析站桩锚点；已在站桩位或无锚点时返回 undefined。 */
function resolveStationAnchor(ac: ActionContext): StructureContainer | StructureController | StructureLink | undefined {
  const ctrl = ac.snapshot.controller;
  // 站桩锚点真相源（优先级）：controller link > controller container > controller 本体。
  //   - controller link 优先：link 网络瞬移供能、无 hauler 依赖，是最优站桩取能位；
  //     归站到 link range1 后（若 ≤3 到 controller），stationaryUpgrade 的 link 分支
  //     直接接管，消除旧实现"归站奔 container、贴 link 靠 withdraw 走位副作用"的绕路。
  //   - 无 link 则 controller container（真正的取能位），再无则 controller 本体。
  const ctrlLink = ctrl?.my
    ? ac.snapshot.links.find(l => l.pos.getRangeTo(ctrl.pos) <= 2)
    : undefined;
  const anchor = ctrlLink ?? ac.snapshot.controllerContainer ?? (ctrl?.my ? ctrl : undefined);
  if (!anchor) return undefined;
  if (ac.creep.pos.getRangeTo(anchor.pos) <= STATION_RANGE) {
    // 已在站桩位（含等补给的 idle 期）— 登记交通锚，防被过路 creep 推离取能位。
    // 幂等副作用：本 tick 若又登记了移动意图，解算器以意图为准。
    registerAnchor(ac.creep, CONFIG.movement.trafficPriority.anchorStation);
    return undefined;
  }
  return anchor;
}

/** gate 拦截路径的归站副作用 — 不在站桩位时移动过去（与 builderGate 的副作用先例一致）。 */
function nudgeToStation(ac: ActionContext): void {
  const anchor = resolveStationAnchor(ac);
  if (anchor) moveToTarget(ac.creep, anchor);
}

/**
 * 能量地板门禁 — 仅阻止 acquire 模式取能，不阻止已满载的 upgrader 交付。
 * 紧急状态（ticksToDowngrade < threshold）时豁免。
 *
 * 关键修复：门禁只在 upgrader 需要直接采集时才阻止。
 * 如果 controller container / 任何 container 有能量，upgrader 不与 spawn 竞争，
 * 不应被 energyAvailable 地板阻止。
 */
function upgraderGate(ac: ActionContext): boolean {
  const controller = ac.snapshot.controller;
  const isEmergency =
    controller != null &&
    controller.my &&
    controller.ticksToDowngrade < CONFIG.economy.controllerDowngradeThreshold;

  if (isEmergency) return true; // 紧急：不阻止

  // RCL8 满级后升级零收益（controller.progress=0）：无降级风险时停烧。
  // 存量 upgrader 直接 idle（不取能不升级），demand 已停孵，自然老死后退出；
  // 能量让给 storage/spawn/link hub。降级风险（isEmergency）时上面已放行保级。
  if (ac.snapshot.rcl >= 8) return false;

  // 仅阻止 acquire 模式。
  if (ac.creep.memory.mode !== "acquire") return true;

  // 如果有替代能量源（非 source container / link 有能量），upgrader 不与 spawn 竞争，放行。
  // P0-3：仅检查非 source container — upgrader 不再从 source container 取能，
  // 若只有 source container 有能量，upgrader 会落到 harvestSource 与 spawn 竞争。
  // 注意：storage 不在此列 — storage 低于 floor 时正是要保护它不被 upgrader 抽干。
  const hasNonSourceContainerEnergy = ac.snapshot.containers.some(
    c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
      !ac.snapshot.sources.some(s => c.pos.getRangeTo(s.pos) <= 1),
  );
  const hasLinkEnergy = ac.snapshot.links.some(
    l => l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
  );
  if (hasNonSourceContainerEnergy || hasLinkEnergy) return true;

  // 无替代能量源 — upgrader 只能直接采集，此时用能量地板门禁防止与孵化竞争。
  const hasStorage = ac.snapshot.storage !== undefined;
  const belowFloor = ac.snapshot.rcl >= 4 && hasStorage
    ? ac.snapshot.storage!.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.economy.upgradeEnergyFloorStorage
    : ac.snapshot.energyAvailable < Math.min(CONFIG.economy.upgradeEnergyFloor, Math.floor(ac.snapshot.energyCapacityAvailable * 0.4));

  if (belowFloor) {
    // 门禁拦截前先归站：gate 返回 false 会直接 idle（不走 acquire 链的归站兜底），
    // 刚孵化的 upgrader 会石化在 spawn 出口挡路。移动到站桩位再 idle —
    // 能量恢复后零通勤开工，等待期间也不占用核心区交通格。
    nudgeToStation(ac);
    return false;
  }
  return true;
}

/**
 * 动态计算 storage 取能上限 — 水位权限表（绝对能量刻度）。
 *
 * U-2 修复：原比例制三档（>50%/>15% 折合 50 万/15 万能量）在发展期房间
 * 永远落在最低档 — 与 distributorTiers 的历史教训同型（比例刻度系统性错误）。
 * 现改用与 distributorTiers/upgrade 调度同一参照系的绝对阈值：
 *   ≥ sprintStorage(50k)：carry 满载（库存盈余快速消化）
 *   ≥ sustainedStorage(10k)：perTickWithdrawLimit(500)
 *   ≥ upgradeEnergyFloorStorage(1k)：200（低水位节流）
 *   <  upgradeEnergyFloorStorage(1k)：0 — U-1 floor 下沉：
 *      withdrawStorageCapped 的 resolve 对 limit≤0 返回 undefined（D-0 同手法），
 *      彻底封死「gate 因 container 有能量放行 → storage 被抽穿地板」的旁路。
 */
function dynamicStorageLimit(ac: ActionContext): number {
  const st = ac.snapshot.storage;
  if (!st) return CONFIG.economy.upgrade.perTickWithdrawLimit;
  const energy = st.store.getUsedCapacity(RESOURCE_ENERGY);
  const cfg = CONFIG.economy;
  if (energy < cfg.upgradeEnergyFloorStorage) return 0;
  if (energy >= cfg.upgrade.sprintStorage) return ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
  if (energy >= cfg.upgrade.sustainedStorage) return cfg.upgrade.perTickWithdrawLimit;
  return 200;
}

/**
 * 升级动作的锚定包装 — 站桩升级中（range≤3 免通勤）登记交通锚，
 * 防止被过路 creep 从取能位/升级位推开；仍需通勤时不锚（移动意图优先）。
 */
function upgradeAnchored(): ActionCandidate<StructureController> {
  const inner = upgradeController();
  return {
    name: inner.name,
    resolve: inner.resolve,
    execute: (ac, ctrl) => {
      if (ac.creep.pos.getRangeTo(ctrl.pos) <= STATION_RANGE) {
        registerAnchor(ac.creep, CONFIG.movement.trafficPriority.anchorStation);
      }
      inner.execute(ac, ctrl);
    },
  };
}

const policy: RolePolicy = {
  gate: upgraderGate,

  acquire: [
    // 0. 站桩同 tick 取+升 — 贴 controller link 且够到 controller 时，withdraw+upgrade
    //    同 tick 执行，让 WORK 满效（消除小 CARRY 的取能空耗 tick）。镜像 stationaryMine，
    //    同置 acquire[0]/work[0] 绕开单链限制；不满足条件回退下方常规取能链。
    stationaryUpgrade(),
    // 1. 拾取身边的掉落能量（range<=2，不离开站桩位）。
    pickupNearbyDroppedEnergy(2),
    // 2. controller 旁 link（0 通勤，link 瞬移供能）。
    withdrawControllerLink(),
    // 3. controller 旁 container（0 通勤）。
    withdrawControllerContainer(),
    // 4. storage（动态限量取能 — 按 storage 水位缩放，防止突降触发 economyPressure 连锁降级）。
    // P1-1: 高水位(>50%)时放开到 carry 满载；低水位(<15%)时收紧到 200，中间用固定值。
    withdrawStorageCapped(dynamicStorageLimit),
    // 5. 最满非物流 container（不抢 hauler 的物流源）。
    withdrawRichestNonSourceContainer(),
    // 6. 兜底：所有 container 无能量时直接采集。
    harvestSource(),
    // 7. 归站兜底：取能全部落空（container 空、source 占满等）时移动到
    //    controller 站桩位待命，而不是石化在 spawn 出口挡路。
    moveToStation(),
  ],

  work: [
    // 站桩同 tick 取+升优先（与 acquire[0] 同）；不满足条件回退常规升级（含通勤）。
    stationaryUpgrade(),
    upgradeAnchored(),
  ],
};

export const upgraderRole = defineRole("upgrader", 2 as Priority, policy);
