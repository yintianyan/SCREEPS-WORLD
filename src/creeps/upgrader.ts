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

  const hasStorage = ac.snapshot.storage !== undefined;
  const belowFloor = ac.snapshot.rcl >= 4 && hasStorage
    ? ac.snapshot.storage!.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.economy.upgradeEnergyFloorStorage
    : ac.snapshot.energyAvailable < CONFIG.economy.upgradeEnergyFloor;

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
    // 4. 最满 container。
    withdrawRichestContainer(),
    // 5. 直接采集。
    harvestSource(),
  ],

  work: [
    upgradeController(),
  ],
};

export const upgraderRole = defineRole("upgrader", 2 as Priority, policy);
