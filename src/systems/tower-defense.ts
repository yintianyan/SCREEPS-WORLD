import { CONFIG, getWallTargetHits } from "../config";
import type { Priority, RoomSnapshot, System, TickContext } from "../kernel/contracts";
import { findCriticalRepair } from "../creeps/support";
import { selectTowerTarget, type TowerThreat } from "../domain/defense/tower-target";
import { globalCache } from "../kernel/global-cache";

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
        // 无 Tower — 收紧 safe mode：仅当威胁 creep 靠近核心区（spawn，无 spawn 时退到 controller）
        // 至 safeModeTriggerRange 内才激活，避免无害过境 scout 误烧珍贵的 safe mode。
        if (snapshot.threatCreeps.length > 0 && isCoreBreached(snapshot)) {
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
      if (snapshot.threatCreeps.length > 0) {
        // R7-02 / P1-3：所有 tower 集火同一目标 —— 奶妈优先、最脆优先、近距优先。
        const firstTower = snapshot.towers.find(t => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
        if (firstTower) {
          const target = selectFocusTarget(firstTower, snapshot.threatCreeps as Creep[]);
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
      // A3/B3：维修权移交 creep —— 塔修 1 次 10 能量且有距离衰减，creep 修是
      // 1 energy/100 hits/WORK。本房存在 builder/worker 时塔只保留开火职责，
      // 省下的能量是真实的防御弹药；无维修 creep 时保留塔修作为灾后安全网。
      if (hasRepairCreep(snapshot.roomName)) {
        continue;
      }

      // G-DF-08：wall/rampart 目标血量按 RCL 分级。
      const wallTarget = getWallTargetHits(snapshot.rcl);
      // 预选 wall/rampart 维护目标（所有 tower 共用，避免重复查找）。
      let wallRepairTarget = findWallRepairTarget(snapshot, wallTarget);

      // 房间状态门禁：wall 维护只在经济平稳时执行。
      // recovery/bootstrap 期间保留 tower 能量应对突发，不浪费在墙上。
      const roomMem = Memory.rooms[snapshot.roomName];
      const colonyState = roomMem?.colonyState ?? "normal";
      const wallMaintenanceAllowed = colonyState === "normal";

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
        // 门禁：colonyState 必须 normal + tower 能量 > 70%（保留应急储备）。
        if (wallRepairTarget && wallMaintenanceAllowed) {
          const towerEnergyRatio = tower.store.getUsedCapacity(RESOURCE_ENERGY) / tower.store.getCapacity(RESOURCE_ENERGY);
          if (towerEnergyRatio > 0.7) {
            tower.repair(wallRepairTarget);
          }
        }
      }
    }
  },
};

/**
 * 本房是否存在可承担维修的 creep（builder 或 worker）。
 * A3：存在时塔让出全部非战斗维修，只保留开火职责。
 * 每 tick 全局最多遍历一次 Game.creeps（globalCache 缓存），
 * 不破坏「Kernel 单次遍历」的扫描纪律。
 */
function hasRepairCreep(roomName: string): boolean {
  const g = globalCache() as any;
  if (g.__repairCreepTick !== Game.time || !g.__repairCreep) {
    const map: Record<string, boolean> = {};
    for (const creep of Object.values(Game.creeps)) {
      const role = creep.memory.role;
      if (role === "builder" || role === "worker") {
        map[creep.memory.home ?? creep.room.name] = true;
      }
    }
    g.__repairCreep = map;
    g.__repairCreepTick = Game.time;
  }
  return (g.__repairCreep as Record<string, boolean>)[roomName] === true;
}

/**
 * 为全塔集火选择目标（P1-3）。
 * 用纯函数 selectTowerTarget 按「奶妈优先 / 最脆优先 / 近距优先」排序；
 * 异常或选不出时回退到 findClosestByRange，保证防御不因选择逻辑失效而停火。
 */
function selectFocusTarget(referenceTower: StructureTower, threats: readonly Creep[]): Creep | undefined {
  const summaries: TowerThreat[] = threats.map(c => ({
    id: c.id as string,
    healParts: c.body.filter(p => p.type === HEAL).length,
    hits: c.hits,
    hitsMax: c.hitsMax,
    rangeToTower: referenceTower.pos.getRangeTo(c.pos),
  }));
  const targetId = selectTowerTarget(summaries);
  const target = targetId ? Game.getObjectById<Creep>(targetId as Id<Creep>) : undefined;
  // 回退：目标已消失或无法解析时退回最近目标。
  return target ?? referenceTower.pos.findClosestByRange(threats as Creep[]) ?? undefined;
}

/**
 * 核心区是否被威胁 creep 突破（无塔时的 safe mode 触发判据）。
 * 任一威胁 creep 距 spawn（无 spawn 时退到 controller）range <= safeModeTriggerRange 即视为突破。
 * 避免仅因房间边缘出现威胁就误烧 safe mode。
 */
function isCoreBreached(snapshot: RoomSnapshot): boolean {
  const anchor = snapshot.spawns[0] ?? snapshot.controller;
  if (!anchor) return true; // 既无 spawn 也无 controller — 无参考点，保守视为突破。
  const range = CONFIG.defense.safeModeTriggerRange;
  return snapshot.threatCreeps.some(c => c.pos.getRangeTo(anchor.pos) <= range);
}

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
