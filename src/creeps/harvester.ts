import type { CreepRole, Priority, TickContext } from "../kernel/contracts";
import { ensureHome, flee, findEmptiestContainer, getAssignment, getFillTarget, getSource, moveToTarget, shouldFlee, updateMode } from "./helpers";

/**
 * Harvester — P1 角色，固定 source 分配。
 *
 * 状态机：acquire（从固定 source 采集）→ work（运送到 spawn/extension）
 *
 * 与遗留 harvester 不同，此角色：
 *   - 使用 memory 中存储的固定 source（无需每 tick findClosestByPath）
 *   - 从 RoomSnapshot 读取填充目标
 *   - 使用带卡位检测的 moveTo
 *   - 所有结构满时回退到升级控制器
 */
export const harvesterRole: CreepRole = {
  name: "harvester",
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
      // 运送能量。
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
          // 目标已满 — 尝试下一个或回退。
          updateMode(creep);
        }
        return;
      }

      // 所有结构已满 — 尝试 container（X-21：预检查 freeCapacity）。
      if (snapshot.containers.length > 0) {
        const best = findEmptiestContainer(snapshot.containers);
        // X-21：预估 container 可用空间，为 0 则跳过进入下一个交付目标。
        if (best && best.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          const result = creep.transfer(best, RESOURCE_ENERGY);
          if (result === ERR_NOT_IN_RANGE) {
            moveToTarget(creep, best);
          }
          return;
        }
      }

      // 全部已满 — 升级控制器作为回退。
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

    // acquire 模式：从固定 source 采集。
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
        // source 暂时耗尽 — 等待。
        creep.memory.mode = "idle";
      }
      return;
    }

    creep.memory.mode = "idle";
  },
};
