import type { Priority, System, TickContext } from "../kernel/contracts";
import { findCriticalRepair } from "../creeps/helpers";

/**
 * Tower 防御系统 — P0 系统，负责所有 Tower 操作和安全模式。
 *
 * 职责：
 *   - 检测敌对 creep 并调度 Tower 攻击
 *   - 无敌人时执行紧急维修（关键结构低于 50% 血量）
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

      // 有 Tower — 优先攻击敌人。
      if (snapshot.hostileCreeps.length > 0) {
        for (const tower of snapshot.towers) {
          if (tower.store.getUsedCapacity(RESOURCE_ENERGY) === 0) continue;
          const target = tower.pos.findClosestByRange(snapshot.hostileCreeps as Creep[]);
          if (target) {
            tower.attack(target);
          }
        }
        continue;
      }

      // 无敌人 — 紧急维修关键结构（仅低于 50% 血量时）。
      for (const tower of snapshot.towers) {
        if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < 50) continue;

        const repairTarget = findCriticalRepair(snapshot);
        if (repairTarget) {
          tower.repair(repairTarget);
        }
      }
    }
  },
};
