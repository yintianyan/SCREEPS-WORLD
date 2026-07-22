/**
 * Upgrader — P2 升级角色。
 *
 * 策略声明：
 *   gate:    能量地板门禁（仅阻止 acquire，不阻止 work）；紧急防降级覆盖
 *   acquire: controller link > controller container > storage > 最满 container > harvest
 *   work:    升级控制器
 *
 * 站桩升级核心：upgrader 站在 controller 旁，从 link/container 取能 + 升级，0 通勤。
 */
import { CONFIG } from "../config";
import type { Priority } from "../kernel/contracts";
import type { ActionContext, RolePolicy } from "./action-types";
import {
  harvestSource,
  pickupDroppedEnergy,
  upgradeController,
  withdrawControllerContainer,
  withdrawControllerLink,
  withdrawRichestContainer,
  withdrawStorage,
} from "./actions";
import { defineRole } from "./role-runner";

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

  // 仅阻止 acquire 模式。
  if (ac.creep.memory.mode !== "acquire") return true;

  // 如果有替代能量源（container/link 有能量），upgrader 不与 spawn 竞争，放行。
  // 注意：storage 不在此列 — storage 低于 floor 时正是要保护它不被 upgrader 抽干。
  const hasContainerEnergy = ac.snapshot.containers.some(
    c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
  );
  const hasLinkEnergy = ac.snapshot.links.some(
    l => l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
  );
  if (hasContainerEnergy || hasLinkEnergy) return true;

  // 无替代能量源 — upgrader 只能直接采集，此时用能量地板门禁防止与孵化竞争。
  const hasStorage = ac.snapshot.storage !== undefined;
  const belowFloor = ac.snapshot.rcl >= 4 && hasStorage
    ? ac.snapshot.storage!.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.economy.upgradeEnergyFloorStorage
    : ac.snapshot.energyAvailable < Math.min(CONFIG.economy.upgradeEnergyFloor, Math.floor(ac.snapshot.energyCapacityAvailable * 0.4));

  return !belowFloor; // belowFloor → 返回 false → idle
}

const policy: RolePolicy = {
  gate: upgraderGate,

  acquire: [
    // 1. controller 旁 link（0 通勤，link 瞬移供能）。
    withdrawControllerLink(),
    // 2. controller 旁 container（0 通勤）。
    withdrawControllerContainer(),
    // 3. storage（RCL4+）。
    withdrawStorage(),
    // 4. 最满 container（含 source container — 主能量池）。
    withdrawRichestContainer(),
    // 5. 拾取地上掉落能量（衰减资源，优先于采集）。
    pickupDroppedEnergy(),
    // 6. 兜底：所有 container 无能量时直接采集。
    harvestSource(),
  ],

  work: [
    upgradeController(),
  ],
};

export const upgraderRole = defineRole("upgrader", 2 as Priority, policy);
