import type { CreepRole, Priority, TickContext } from "../kernel/contracts";
import { ensureHome, flee, findRichestContainer, getAssignment, getFillTarget, moveToTarget, shouldFlee, updateMode } from "./helpers";

/**
 * Hauler — P1 物流角色。
 *
 * 状态机：acquire（从 container 取出）→ work（运送到 spawn/extension）
 *
 * hauler 从 source container 拾取能量并运送到填充目标。
 * 如果没有 container 有能量，则短暂等待而非扫描整个房间。
 */
export const haulerRole: CreepRole = {
  name: "hauler",
  priority: 1 as Priority,
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

    updateMode(creep);
    const assignment = getAssignment(creep, ctx);

    if (creep.memory.mode === "work") {
      // 向填充目标运送能量。
      let target: AnyOwnedStructure | undefined;
      if (assignment?.targetId) {
        target = Game.getObjectById(assignment.targetId as Id<AnyOwnedStructure>) ?? undefined;
      }
      if (!target) {
        target = getFillTarget(creep, snapshot);
      }
      if (target) {
        const result = creep.transfer(target, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          moveToTarget(creep, target);
        } else if (result === ERR_FULL) {
          updateMode(creep);
        }
        return;
      }

      // spawn/extension 全满 — 尝试 storage。
      if (snapshot.storage) {
        const result = creep.transfer(snapshot.storage, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          moveToTarget(creep, snapshot.storage);
        }
        return;
      }

      // 无处填充 — 尝试升级作为回退。
      if (snapshot.controller && snapshot.controller.my) {
        const result = creep.upgradeController(snapshot.controller);
        if (result === ERR_NOT_IN_RANGE) {
          moveToTarget(creep, snapshot.controller);
        }
        return;
      }

      creep.memory.mode = "idle";
      return;
    }

    // acquire 模式：从 container 取出。
    // 优先使用 assignment 指定的 container。
    let best: StructureContainer | undefined;
    if (assignment?.sourceId) {
      best = Game.getObjectById(assignment.sourceId as unknown as Id<StructureContainer>) ?? undefined;
    }
    if (!best) {
      best = findRichestContainer(snapshot.containers);
    }

    if (best) {
      // X-20：预估 container 可用量，限量 withdraw 避免 ERR_NOT_ENOUGH_RESOURCES。
      const available = best.store.getUsedCapacity(RESOURCE_ENERGY);
      if (available <= 0) {
        creep.memory.mode = "idle";
        return;
      }
      const carryFree = creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      const result = creep.withdraw(best, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(creep, best);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        // container 空 — 等待。
        creep.memory.mode = "idle";
      }
      return;
    }

    // 无 container 或 container 空 — 回退到 storage（RCL4+）。
    if (snapshot.storage && snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      // X-20：预估 storage 可用量，限量 withdraw。
      const available = snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      const result = creep.withdraw(snapshot.storage, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(creep, snapshot.storage);
      }
      return;
    }

    // 无能量来源 — 短暂空闲。hauler 没有 WORK 部件，不能
    // 尝试采集（会返回 ERR_NO_BODYPART 并卡住）。等待
    // harvester 重新填充 container。
    creep.memory.mode = "idle";
  },
};
