import { CONFIG } from "../config";
import type { CreepRole, Priority, TickContext } from "../kernel/contracts";
import { ensureHome, flee, findRichestContainer, getAssignment, getSource, moveToTarget, shouldFlee, updateMode } from "./helpers";

/**
 * Upgrader — P2 角色，用于控制器升级。
 *
 * 状态机：acquire（从 source 采集）→ work（升级控制器）
 *
 * 遵守能量下限：房间能量低于下限时，upgrader 空闲以避免与
 * 孵化填充竞争。在 Recovery/Conserve 状态下 upgrader 停止。
 */
export const upgraderRole: CreepRole = {
  name: "upgrader",
  priority: 2 as Priority,
  run(creep: Creep, ctx: TickContext): void {
    if (!ensureHome(creep)) {
      creep.memory.mode = "idle";
      return;
    }

    const snapshot = ctx.getSnapshot(creep.memory.home!);
    if (!snapshot) return;

    // 躲避敌对单位。
    if (shouldFlee(snapshot)) {
      creep.memory.mode = "flee";
      flee(creep, snapshot);
      return;
    }

    // 紧急：防止控制器降级 — 即使低于能量下限也强制升级。
    const controller = snapshot.controller;
    const isEmergency =
      controller != null &&
      controller.my &&
      controller.ticksToDowngrade < CONFIG.economy.controllerDowngradeThreshold;

    // U-02：遵守能量下限 — 不与孵化填充竞争（紧急情况除外）。
    // RCL1-3 基于 energyAvailable；RCL4+ 有 storage 时基于 storage 能量。
    const hasStorage = snapshot.storage !== undefined;
    const belowFloor = snapshot.rcl >= 4 && hasStorage
      ? snapshot.storage!.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.economy.upgradeEnergyFloorStorage
      : snapshot.energyAvailable < CONFIG.economy.upgradeEnergyFloor;

    updateMode(creep);

    // 修复：belowFloor 仅阻止 acquire（从房间取能），不阻止已满载的 upgrader 交付。
    // 原实现在 updateMode 之前 return，导致满载 upgrader 永久 idle。
    if (!isEmergency && belowFloor && creep.memory.mode === "acquire") {
      creep.memory.mode = "idle";
      return;
    }

    const assignment = getAssignment(creep, ctx);

    if (creep.memory.mode === "work") {
      if (controller && controller.my) {
        const result = creep.upgradeController(controller);
        if (result === ERR_NOT_IN_RANGE) {
          moveToTarget(creep, controller);
        }
        return;
      }
      creep.memory.mode = "idle";
      return;
    }

    // acquire 模式：站桩升级核心 — 优先从 controller 旁 link 取能（link 瞬移供能，0 通勤）。
    // link 系统将 source link 的能量瞬移到 controller link，upgrader 直接 withdraw。
    if (snapshot.links.length > 0 && snapshot.controller) {
      const ctrlLink = snapshot.links.find(
        l => l.pos.getRangeTo(snapshot.controller!) <= 2 && l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      if (ctrlLink) {
        const result = creep.withdraw(ctrlLink, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          moveToTarget(creep, ctrlLink);
        }
        return;
      }
    }

    // 回退：从 controller 旁 container 取能（0 通勤）。
    // 这是老玩家的标准操作：upgrader 站在 controller 与 container 之间，
    // withdraw + upgrade 循环，几乎 100% 时间都在升级，不再长途跋涉回 spawn 区取能。
    if (
      snapshot.controllerContainer &&
      snapshot.controllerContainer.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      const result = creep.withdraw(snapshot.controllerContainer, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(creep, snapshot.controllerContainer);
      }
      return;
    }

    // R4-04：无 controller container 时，优先从 storage 取能量。
    if (snapshot.storage && snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      const result = creep.withdraw(snapshot.storage, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(creep, snapshot.storage);
      }
      return;
    }

    // 回退到 container（让 harvester 专注于采集）。
    if (snapshot.containers.length > 0) {
      const best = findRichestContainer(snapshot.containers);
      if (best) {
        const result = creep.withdraw(best, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          moveToTarget(creep, best);
        }
        return;
      }
    }

    // 回退到直接采集。
    const source = getSource(creep, snapshot);
    if (source) {
      const result = creep.harvest(source);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(creep, source);
      }
      return;
    }

    creep.memory.mode = "idle";
  },
};
