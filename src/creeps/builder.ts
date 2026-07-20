import { CONFIG } from "../config";
import type { CreepRole, Priority, RoomSnapshot, TickContext } from "../kernel/contracts";
import { ensureHome, flee, findCriticalRepair, findRichestContainer, getAssignment, getFillTarget, getSource, moveToTarget, releaseAssignment, shouldFlee, updateMode } from "./helpers";

/**
 * Builder — P2 建造角色。
 *
 * 状态机：acquire（采集/取出）→ work（建造 site）
 *
 * 无建造目标时的回退链：
 *   1. 填充 spawn/extension
 *   2. 关键修复（spawn/extension/container 生命值低于 50%）
 *   3. 升级控制器
 *   4. 空闲
 *
 * 在 Recovery/Conserve 状态下，builder 释放任务并回退到填充/空闲。
 */
export const builderRole: CreepRole = {
  name: "builder",
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

    updateMode(creep);
    const assignment = getAssignment(creep, ctx);

    if (creep.memory.mode === "work") {
      // 优先建造 assignment 指定的 site。
      if (assignment?.targetId) {
        const site = Game.getObjectById(assignment.targetId as Id<ConstructionSite>);
        if (site) {
          const result = creep.build(site);
          if (result === ERR_NOT_IN_RANGE) {
            moveToTarget(creep, site);
          } else if (result === ERR_INVALID_TARGET) {
            releaseAssignment(creep);
          }
          return;
        }
      }

      // 尝试建造最近的建造 site。
      if (snapshot.myConstructionSites.length > 0) {
        const site = findClosestSite(creep, snapshot.myConstructionSites);
        if (site) {
          const result = creep.build(site);
          if (result === ERR_NOT_IN_RANGE) {
            moveToTarget(creep, site);
          } else if (result === ERR_INVALID_TARGET) {
            // site 不再有效 — 清除并尝试下一个。
            creep.memory.targetId = undefined;
          }
          return;
        }
      }

      // 无建造目标 — 回退链。
      return fallbackBuilder(creep, snapshot);
    }

    // acquire 模式：获取能量。
    return acquireEnergy(creep, snapshot);
  },
};

/** 使用引擎原生 findClosestByRange 替代手动迭代，性能更优。 */
function findClosestSite(creep: Creep, sites: readonly ConstructionSite[]): ConstructionSite | undefined {
  return creep.pos.findClosestByRange(sites as ConstructionSite[]) ?? undefined;
}

function fallbackBuilder(creep: Creep, snapshot: RoomSnapshot): void {
  // 1. 填充 spawn/extension。
  const fillTarget = getFillTarget(creep, snapshot);
  if (fillTarget) {
    const result = creep.transfer(fillTarget, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      moveToTarget(creep, fillTarget);
    }
    return;
  }

  // 2. 关键修复。
  const criticalStructure = findCriticalRepair(snapshot);
  if (criticalStructure) {
    const result = creep.repair(criticalStructure);
    if (result === ERR_NOT_IN_RANGE) {
      moveToTarget(creep, criticalStructure);
    }
    return;
  }

  // 3. 升级控制器。
  if (snapshot.controller && snapshot.controller.my && snapshot.energyAvailable >= CONFIG.economy.upgradeEnergyFloor) {
    const result = creep.upgradeController(snapshot.controller);
    if (result === ERR_NOT_IN_RANGE) {
      moveToTarget(creep, snapshot.controller);
    }
    return;
  }

  // 4. 空闲。
  creep.memory.mode = "idle";
}

function acquireEnergy(
  creep: Creep,
  snapshot: RoomSnapshot,
): void {
  // 优先 container。
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
}
