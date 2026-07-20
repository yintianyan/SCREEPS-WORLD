import { getWallTargetHits } from "../config";
import type { Priority, RoomSnapshot, System, TickContext } from "../kernel/contracts";
import { findCriticalRepair } from "../creeps/helpers";

/**
 * Tower 防御系统 — P0 系统，负责所有 Tower 操作和安全模式。
 *
 * 职责：
 *   - 检测敌对 creep 并调度 Tower 攻击（三塔协同同一目标）
 *   - 无敌人时执行紧急维修（关键结构低于 50% 血量）
 *   - 无紧急维修时维护 wall/rampart 到 RCL 分级目标血量
 *   - 无 Tower 且有敌人时激活安全模式
 *
 * 优先级：P0（防御是生存关键 — 永不被冷却）。
 */
export const towerDefenseSystem: System = {
  name: "tower-defense",
  priority: 0 as Priority,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      if (snapshot.towers.length === 0) {
        // 无 Tower — 考虑安全模式。
        if (snapshot.hostileCreeps.length > 0) {
          const controller = snapshot.controller;
          if (
            controller?.my &&
            !controller.safeMode &&
            !controller.safeModeCooldown &&
            controller.safeModeAvailable > 0
          ) {
            controller.activateSafeMode();
          }
        }
        continue;
      }

      // 有 Tower — G-DF-06：攻击敌人 > 紧急维修 > wall/rampart 维护。
      if (snapshot.hostileCreeps.length > 0) {
        // R7-02：所有 tower 协同攻击同一目标（以第一个可用 tower 为参考选最近敌人）。
        const firstTower = snapshot.towers.find(t => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
        if (firstTower) {
          const target = firstTower.pos.findClosestByRange(snapshot.hostileCreeps as Creep[]);
          if (target) {
            for (const tower of snapshot.towers) {
              if (tower.store.getUsedCapacity(RESOURCE_ENERGY) === 0) continue;
              tower.attack(target);
            }
          }
        }
        continue;
      }

      // 无敌人 — 维修逻辑。
      // G-DF-08：wall/rampart 目标血量按 RCL 分级。
      const wallTarget = getWallTargetHits(snapshot.rcl);
      // 预选 wall/rampart 维护目标（所有 tower 共用，避免重复查找）。
      let wallRepairTarget = findWallRepairTarget(snapshot, wallTarget);

      for (const tower of snapshot.towers) {
        // G-DF-07：能量 < 50 时不维修（保留攻击能量）；能量 = 0 时跳过。
        if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < 50) continue;

        // R3-07：维修优先级 spawn/extension → tower → container → wall/rampart。
        const repairTarget = findCriticalRepair(snapshot);
        if (repairTarget) {
          tower.repair(repairTarget);
          continue;
        }

        // G-DF-08：wall/rampart 维护（最低优先级）。
        if (wallRepairTarget) {
          tower.repair(wallRepairTarget);
        }
      }
    }
  },
};

/**
 * 找到需要维修的 wall/rampart（血量低于目标值）。
 * 选择血量最低的优先维修，避免一个 wall 满了其他还没修。
 * 约束 G-DF-08：目标血量按 RCL 分级。
 */
function findWallRepairTarget(
  snapshot: RoomSnapshot,
  targetHits: number,
): StructureWall | StructureRampart | undefined {
  let best: StructureWall | StructureRampart | undefined;
  let bestHits = Infinity;
  for (const wall of snapshot.walls) {
    if (wall.hits < targetHits && wall.hits < bestHits) {
      bestHits = wall.hits;
      best = wall;
    }
  }
  for (const rampart of snapshot.ramparts) {
    if (rampart.hits < targetHits && rampart.hits < bestHits) {
      bestHits = rampart.hits;
      best = rampart;
    }
  }
  return best;
}
