import { CONFIG } from "../config";
import type { CreepRole, Priority, TickContext } from "../kernel/contracts";
import { ensureHome, flee, findRichestContainer, getSource, moveToTarget, shouldFlee, updateMode } from "./helpers";

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

    // 遵守能量下限 — 不与孵化填充竞争（紧急情况除外）。
    if (!isEmergency && snapshot.energyAvailable < CONFIG.economy.upgradeEnergyFloor) {
      creep.memory.mode = "idle";
      return;
    }

    updateMode(creep);

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

    // acquire 模式：从 source 采集或从 container 取出。
    // 优先使用 container（让 harvester 专注于采集）。
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
