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
import type { ActionContext, RolePolicy } from "../engine/action-types";
import {
  harvestSource,
  pickupNearbyDroppedEnergy,
  upgradeController,
  withdrawControllerContainer,
  withdrawControllerLink,
  withdrawRichestNonSourceContainer,
  withdrawStorageCapped,
} from "../engine/actions";
import { defineRole } from "../engine/role-runner";

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

  return !belowFloor; // belowFloor → 返回 false → idle
}

/**
 * P1-1: 动态计算 storage 取能上限 — 按 storage 水位缩放。
 *
 * - 高水位 (>50%)：放开到 carry 满载（库存盈余应被快速消化）
 * - 中水位 (15%-50%)：用固定配置值（平衡消化速度与突降风险）
 * - 低水位 (<15%)：收紧到 200（保护 storage 触发 economyPressure 连锁降级）
 */
function dynamicStorageLimit(ac: ActionContext): number {
  const st = ac.snapshot.storage;
  if (!st) return CONFIG.economy.upgrade.perTickWithdrawLimit;
  const energy = st.store.getUsedCapacity(RESOURCE_ENERGY);
  const capacity = st.store.getCapacity(RESOURCE_ENERGY);
  if (capacity === 0) return CONFIG.economy.upgrade.perTickWithdrawLimit;
  const ratio = energy / capacity;
  if (ratio > 0.5) return ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
  if (ratio > 0.15) return CONFIG.economy.upgrade.perTickWithdrawLimit;
  return 200;
}

const policy: RolePolicy = {
  gate: upgraderGate,

  acquire: [
    // 0. 拾取身边的掉落能量（range<=2，不离开站桩位）。
    pickupNearbyDroppedEnergy(2),
    // 1. controller 旁 link（0 通勤，link 瞬移供能）。
    withdrawControllerLink(),
    // 2. controller 旁 container（0 通勤）。
    withdrawControllerContainer(),
    // 3. storage（动态限量取能 — 按 storage 水位缩放，防止突降触发 economyPressure 连锁降级）。
    // P1-1: 高水位(>50%)时放开到 carry 满载；低水位(<15%)时收紧到 200，中间用固定值。
    withdrawStorageCapped(dynamicStorageLimit),
    // 4. 最满非物流 container（不抢 hauler 的物流源）。
    withdrawRichestNonSourceContainer(),
    // 5. 兜底：所有 container 无能量时直接采集。
    harvestSource(),
  ],

  work: [
    upgradeController(),
  ],
};

export const upgraderRole = defineRole("upgrader", 2 as Priority, policy);
