import { CONFIG, getWallTargetHits } from "../config";
import type { Priority, RoomSnapshot, System, TickContext } from "../kernel/contracts";
import { EventKind, recordEvent } from "../kernel/event-log";
import { findCriticalRepair } from "../creeps/support";
import { selectTowerTarget, type TowerThreat } from "../domain/defense/tower-target";
import { assessEngagement, type TowerSummary } from "../domain/defense/tower-engagement";
import { buildFortificationContext, classifyFortification, resolveUnderSiege, type FortificationContext } from "../domain/defense/fortification";
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
          tryActivateSafeMode(snapshot);
        }
        // M11 舰队伤亡熔断（无塔房是重灾区：拓荒房/塔未建成期无火力反制，
        // 收割型小队可以零风险屠戮编队）— 判据与有塔分支同口径。
        if (snapshot.threatCreeps.length > 0 && fleetLossFuseTripped(snapshot.roomName)) {
          tryActivateSafeMode(snapshot);
        }
        continue;
      }

      // 有 Tower — G-DF-06：攻击敌人 > 紧急维修 > wall/rampart 维护。
      if (snapshot.threatCreeps.length > 0) {
        // 所有 tower 集火同一目标 —— 奶妈优先、最脆优先、近距优先。
        const firstTower = snapshot.towers.find(t => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
        const breachingCore = isCoreBreached(snapshot);
        let fired = false;
        if (firstTower) {
          const target = selectFocusTarget(firstTower, snapshot.threatCreeps as Creep[]);
          if (target) {
            // 交战盈亏判定：全塔合计伤害（含距离衰减）必须超过敌方编队
            // 合计治疗量才开火，否则每发炮弹都被 HEAL 奶回、白耗能量
            // （heal-tank 骗塔战术）。敌人突入核心区时无条件开火。
            const towerSummaries: TowerSummary[] = snapshot.towers.map(t => ({
              energy: t.store.getUsedCapacity(RESOURCE_ENERGY),
              rangeToTarget: t.pos.getRangeTo(target.pos),
            }));
            const totalHealParts = (snapshot.threatCreeps as Creep[]).reduce(
              (sum, c) => sum + c.body.filter(p => p.type === HEAL).length,
              0,
            );
            const decision = assessEngagement(towerSummaries, {
              totalHealParts,
              breachingCore,
            });
            if (decision.engage) {
              let firedCount = 0;
              for (const tower of snapshot.towers) {
                if (tower.store.getUsedCapacity(RESOURCE_ENERGY) === 0) continue;
                tower.attack(target);
                firedCount++;
              }
              fired = firedCount > 0;
              // 战斗黑匣子（M9）：记录齐射弹道 — 每 tick 每房至多一条
              // （全塔集火同一目标），战斗期连成弹道序列供事后复盘杀伤链。
              if (fired) {
                recordEvent(EventKind.TowerVolley, snapshot.roomName, [
                  firedCount,
                  target.pos.x,
                  target.pos.y,
                  target.body.filter(p => p.type === HEAL).length,
                  Math.floor(target.hits / 100),
                ]);
              }
            }
          }
        }

        // 最后防线：敌人已突入核心区，但所有塔打不出火力
        //（能量耗尽 / 被奶穿打不动）— 塔防线事实失效，激活 safe mode。
        // 官方定位 safe mode 为「defense tactic of last resort」，
        // 此前它只在「无塔」分支触发，塔被打空时反而没有兜底。
        if (!fired && breachingCore) {
          tryActivateSafeMode(snapshot);
        }

        // M11 舰队伤亡熔断：塔防线只保建筑不保舰队 — 收割型小队专杀
        // 外围 creep 不碰 spawn，近核触发条件永不满足。窗口内战损
        // （非自然死亡，黑匣子计数）达阈值且威胁仍在场 = 舰队正被屠戮，
        // safe mode 使敌方攻击全部无效化，是止住团灭的最后手段。
        // 阈值保守（3 只 ≈ 舰队四分之一）— safe mode 是消耗品。
        if (fleetLossFuseTripped(snapshot.roomName)) {
          tryActivateSafeMode(snapshot);
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

      // G-DF-08：wall/rampart 目标血量按角色分层 + RCL 分级；受袭姿态升档。
      // R3：帝国 war 姿态 → 全局备战（与 repair.ts 同口径，见 fortification.resolveUnderSiege）。
      const roomMemForSiege = Memory.rooms[snapshot.roomName];
      const underSiege = resolveUnderSiege(
        Memory.kernel?.strategy?.posture,
        roomMemForSiege?.lastHostileAt,
        Game.time,
        CONFIG.defense.siegeMemoryTicks,
      );
      // 分层分类上下文（与 repairFortifications 同口径）：
      // 周界全额 / 核心折扣 / container 仅地板 — 塔安全网不为低值盾浪费弹药。
      const fortCtx = buildFortificationContext(snapshot, roomMemForSiege?.minCut?.positions);
      // 预选 wall/rampart 维护目标（所有 tower 共用，避免重复查找）。
      let wallRepairTarget = findWallRepairTarget(snapshot, snapshot.rcl, underSiege, fortCtx);
      // 关键维修目标预计算值，提升到 tower 循环外避免重复调用。
      const repairTarget = snapshot.criticalRepairTarget ?? findCriticalRepair(snapshot);

      // 房间状态门禁：wall 维护只在经济平稳时执行。
      // recovery/bootstrap 期间保留 tower 能量应对突发，不浪费在墙上。
      const roomMem = Memory.rooms[snapshot.roomName];
      const colonyState = roomMem?.colonyState ?? "normal";
      const wallMaintenanceAllowed = colonyState === "normal";

      for (const tower of snapshot.towers) {
        // G-DF-07：能量 < 50 时不维修（保留攻击能量）；能量 = 0 时跳过。
        if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < 50) continue;

        // R3-07：维修优先级 spawn/extension → tower → container → wall/rampart。
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
 * P1-3：从 Kernel.buildSnapshots 预构建的 globalCache.repairRooms 读取，
 * 不再独立全量扫描 Game.creeps。
 */
function hasRepairCreep(roomName: string): boolean {
  return globalCache().repairRooms?.has(roomName) === true;
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
 * 激活 safe mode（带完整前置校验）。
 * 触发场景：① 无塔且核心被突破；② 有塔但全部打不出火力且核心被突破。
 * safe mode 是最后防线 — 校验 controller 归属 / 未激活 / 无冷却 / 有可用次数。
 */
function tryActivateSafeMode(snapshot: RoomSnapshot): void {
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

/**
 * M11 舰队伤亡熔断判据 — 窗口内本房战损（非自然死亡，黑匣子计数）达阈值。
 * 调用方保证威胁在场才检查；计数存 heap（global reset 丢失可接受 —
 * 威胁持续在场时计数快速重建）。
 */
function fleetLossFuseTripped(roomName: string): boolean {
  const fuse = CONFIG.defense.fleetLossFuse;
  const losses = (globalCache().recentCombatDeaths ?? []).filter(
    d => d.r === roomName && Game.time - d.t <= fuse.windowTicks,
  ).length;
  return losses >= fuse.deaths;
}

/**
 * 找到需要维修的 wall/rampart（血量低于自身档位目标值）。
 * 选择血量最低的优先维修，避免一个 wall 满了其他还没修。
 * 约束 G-DF-08：目标血量按角色分层（perimeter/core/utility）+ RCL 分级。
 */
function findWallRepairTarget(
  snapshot: RoomSnapshot,
  rcl: number,
  underSiege: boolean,
  fortCtx: FortificationContext,
): StructureWall | StructureRampart | undefined {
  let best: StructureWall | StructureRampart | undefined;
  let bestHits = Infinity;
  for (const wall of snapshot.walls) {
    const target = getWallTargetHits(rcl, underSiege, classifyFortification(wall.pos.x, wall.pos.y, true, fortCtx));
    if (wall.hits < target && wall.hits < bestHits) {
      bestHits = wall.hits;
      best = wall;
    }
  }
  for (const rampart of snapshot.ramparts) {
    const target = getWallTargetHits(rcl, underSiege, classifyFortification(rampart.pos.x, rampart.pos.y, false, fortCtx));
    if (rampart.hits < target && rampart.hits < bestHits) {
      bestHits = rampart.hits;
      best = rampart;
    }
  }
  return best;
}
