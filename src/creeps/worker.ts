import type { CreepRole, Priority, TickContext } from "../kernel/contracts";
import { ensureHome, flee, getAssignment, getFillTarget, getSource, moveToTarget, shouldFlee, updateMode } from "./helpers";

/**
 * 恢复 Worker — P0 混合角色，用于启动期和灾后恢复。
 *
 * 状态机：acquire（采集）→ work（填充 spawn/extension）
 *
 * 此角色在无专业 creep 存活时启动房间。
 * 直接采集并运送到 spawn/extension，防止能量死锁。
 * 当 harvester 和 hauler 建立后不再孵化 worker。
 */
export const workerRole: CreepRole = {
  name: "worker",
  priority: 0 as Priority,
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
      // 向 spawn/extension 运送能量。
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
        } else if (result === ERR_FULL || result === ERR_NOT_ENOUGH_RESOURCES) {
          // 目标已满或 creep 空 — 切换模式。
          updateMode(creep);
        }
        return;
      }

      // 无填充目标 — 尝试升级控制器作为回退。
      if (snapshot.controller && snapshot.controller.my) {
        const result = creep.upgradeController(snapshot.controller);
        if (result === ERR_NOT_IN_RANGE) {
          moveToTarget(creep, snapshot.controller);
        }
        return;
      }

      // 无事可做 — 在 spawn 附近空闲。
      creep.memory.mode = "idle";
      return;
    }

    // acquire 模式：从 source 采集。
    let source: Source | undefined;
    if (assignment?.sourceId) {
      source = Game.getObjectById(assignment.sourceId) ?? undefined;
      if (source) creep.memory.sourceId = assignment.sourceId as Id<Source>;
    }
    if (!source) {
      source = getSource(creep, snapshot);
    }
    if (source) {
      const result = creep.harvest(source);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(creep, source);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        // source 耗尽 — 短暂等待。
        creep.memory.mode = "idle";
      }
      return;
    }

    creep.memory.mode = "idle";
  },
};
