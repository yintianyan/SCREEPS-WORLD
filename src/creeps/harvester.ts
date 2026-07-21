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
      // 老玩家核心策略：harvester 优先倒入身边 link 或 container（1 步距离）。
      // link 优先于 container：link 系统可瞬时传输到 controller/storage link，
      // 消除 hauler 长途往返。container 仅在无 link 或 link 满时使用。

      // 1. 最高优先：身边 link（range <= 2）— 瞬时传输到 controller/storage。
      if (snapshot.links.length > 0) {
        const link = creep.pos.findClosestByRange(snapshot.links as StructureLink[]);
        if (link && creep.pos.getRangeTo(link) <= 2 && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          const result = creep.transfer(link, RESOURCE_ENERGY);
          if (result === ERR_NOT_IN_RANGE) {
            moveToTarget(creep, link);
          }
          return;
        }
      }

      // 1.5 回退：身边 container（range <= 2）— 站桩 miner 模式。
      if (snapshot.containers.length > 0) {
        const nearby = creep.pos.findClosestByRange(snapshot.containers as StructureContainer[]);
        if (nearby && creep.pos.getRangeTo(nearby) <= 2 && nearby.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          const result = creep.transfer(nearby, RESOURCE_ENERGY);
          if (result === ERR_NOT_IN_RANGE) {
            moveToTarget(creep, nearby);
          }
          return;
        }
      }

      // 1.5 紧急恢复：身边有 container 在建 site（range <= 3）时优先建造它。
      // source container 被毁后 harvester 与其 site 往往就挨着 source，直接 mine→build 0 通勤，
      // 远比长途送能到 spawn 再等 builder 来得快，是经济塌方时最快的自愈路径。
      if (snapshot.myConstructionSites.length > 0) {
        const containerSite = creep.pos.findClosestByRange(
          snapshot.myConstructionSites.filter(s => s.structureType === STRUCTURE_CONTAINER) as ConstructionSite[],
        );
        if (containerSite && creep.pos.getRangeTo(containerSite) <= 3) {
          const result = creep.build(containerSite);
          if (result === ERR_NOT_IN_RANGE) {
            moveToTarget(creep, containerSite);
          }
          return;
        }
      }

      // 2. 无身边 container（早期未建好）— 直接送 spawn/extension/tower。
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

      // 3. spawn/extension 全满 — 尝试任意有空位的 container。
      if (snapshot.containers.length > 0) {
        const best = findEmptiestContainer(snapshot.containers);
        if (best && best.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          const result = creep.transfer(best, RESOURCE_ENERGY);
          if (result === ERR_NOT_IN_RANGE) {
            moveToTarget(creep, best);
          }
          return;
        }
      }

      // 4. 早期优化：全满时帮忙建造附近的 site（加速 container 建设）。
      if (snapshot.myConstructionSites.length > 0) {
        const site = creep.pos.findClosestByRange(snapshot.myConstructionSites as ConstructionSite[]);
        if (site) {
          const result = creep.build(site);
          if (result === ERR_NOT_IN_RANGE) {
            moveToTarget(creep, site);
          }
          return;
        }
      }

      // 5. 全部已满且无建造目标 — 升级控制器作为回退。
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
    // 始终通过 getSource() 选择 source — 内部处理拥挤检测和重分配。
    // assignment 的 sourceId 仅在首次（memory 无 sourceId）时作为初始建议写入。
    if (!creep.memory.sourceId && assignment?.sourceId) {
      creep.memory.sourceId = assignment.sourceId as Id<Source>;
    }
    const source = getSource(creep, snapshot);
    if (source) {
      const result = creep.harvest(source);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(creep, source);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        // source 暂时耗尽 — 等待。
        creep.memory.mode = "idle";
      }
      // 注：harvest() 不返回 ERR_FULL — 满载时 updateMode 已将模式切为 work。
      return;
    }

    creep.memory.mode = "idle";
  },
};
