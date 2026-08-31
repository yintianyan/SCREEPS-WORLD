import { CONFIG, getWallTargetHits } from "../config";
import type { Priority, RoomSnapshot, System, TickContext } from "../kernel/contracts";
import { EventKind, recordEvent } from "../kernel/event-log";
import { findCriticalRepair } from "../creeps/support";
import { selectTowerTarget, type TowerThreat } from "../domain/defense/tower-target";
import { assessEngagement, type TowerSummary } from "../domain/defense/tower-engagement";
import { buildFortificationContext, classifyFortification, resolveUnderSiege, type FortificationContext } from "../domain/defense/fortification";
import { globalCache, bumpEnergyCounter } from "../kernel/global-cache";

/** P3 L1 核算：塔动作耗能按 intent 计（attack/heal/repair 每次 TOWER_ENERGY_COST）。
 * 不可用库存差值实测 — 引擎资源结算在 tick 末，同 tick 差值恒 0（官服实证）。 */
function countedTowerAction(
  roomName: string,
  tower: StructureTower,
  action: () => number,
): number {
  const result = action();
  if (result === OK) bumpEnergyCounter(roomName, "towerSpent", TOWER_ENERGY_COST);
  return result;
}

/**
 * Tower 防御系统 — P0 系统，负责所有 Tower 操作和安全模式（防御是生存关键 — 永不被冷却）。

 * 优先序：攻击敌人 > 停火期应急维修 > 紧急维修（关键结构 < 50%）；再无事则
 * 维护 wall/rampart 到 RCL 分级目标血量。
 * safe mode 是消耗性保底：无塔房核心被突破 / 有塔房核心结构正被拆毁 /
 * 塔全空且攻击者突入 / 舰队伤亡熔断 — 四条真实损失证据链，缺一不动用。
 */
export const towerDefenseSystem: System = {
  name: "tower-defense",
  priority: 0 as Priority,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      if (snapshot.towers.length === 0) {
        // 无 Tower — 收紧 safe mode：仅当威胁 creep 靠近核心区（spawn，无 spawn 退到
        // controller）至 safeModeTriggerRange 内才激活，避免无害过境 scout 误烧 safe mode。
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
            // （heal-tank 骗塔战术）— 核心区被突入也不例外（守线交给
            // 停火期应急维修 + safe mode 保底判据，见下方 isCoreBeingDestroyed）。
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
            // A5.1：威胁意图集成 — SIEGE intent 意味着敌方有足够治疗扛塔伤，
            // 且未突入核心区。此时开火 = 白耗能量（每发都被 HEAL 奶回）。
            // 塔应停火蓄能，等敌方近身或撤退。这是对 assessEngagement 的
            // intent 维度增强，不替换其净伤判定——两者互补：
            // - assessEngagement：数学净伤判定（damage > heal）
            // - SIEGE override：战术意图判定（敌方在房外蹲坑消耗塔能量）
            let shouldEngage = decision.engage;
            if (shouldEngage && !breachingCore) {
              const threatAssessment = globalCache().threatAssessments?.get(snapshot.roomName);
              if (threatAssessment?.estimatedIntent.intent === "SIEGE") {
                shouldEngage = false;
              }
            }
            if (shouldEngage) {
              let firedCount = 0;
              for (const tower of snapshot.towers) {
                if (tower.store.getUsedCapacity(RESOURCE_ENERGY) === 0) continue;
                countedTowerAction(snapshot.roomName, tower, () => tower.attack(target));
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

        // 停火期应急维修：盈亏判定/SIEGE 选择不开火时，塔的本 tick 动作转入维修 —
        // 引擎会对无动作的塔自动射击最近敌对 creep（每发 10 能量打进奶盾白耗），
        // 显式维修既抑制无效自动射击，又同步修复被啃的防御工事。
        // 优先级：关键结构（<50%）> 核心 wall/rampart（受袭升档目标血量）。
        if (!fired) {
          const threatRepairTarget = snapshot.criticalRepairTarget ?? findCriticalRepair(snapshot);
          const threatFortCtx = buildFortificationContext(snapshot, Memory.rooms[snapshot.roomName]?.minCut?.positions);
          const threatWallTarget = findWallRepairTarget(snapshot, snapshot.rcl, true, threatFortCtx);
          if (threatRepairTarget || threatWallTarget) {
            for (const tower of snapshot.towers) {
              if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < TOWER_ENERGY_COST) continue;
              if (threatRepairTarget) {
                countedTowerAction(snapshot.roomName, tower, () => tower.repair(threatRepairTarget));
              } else {
                countedTowerAction(snapshot.roomName, tower, () => tower.repair(threatWallTarget!));
              }
            }
          }
        }

        // 最后防线收紧：safe mode 是消耗性保底（烧一次少一次），不因「打不出火力 +
        // 近核」轻动用 — 奶量压制型入侵者会自行撤离，rampart + 停火期维修足以守线。
        // 仅当出现不可逆损失证据才动用（isCoreBeingDestroyed）；纯消耗战转事件上报。
        if (!fired && breachingCore) {
          if (isCoreBeingDestroyed(snapshot)) {
            tryActivateSafeMode(snapshot);
          } else {
            reportThreatUnhandled(snapshot);
          }
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

      // 无害敌对（侦察兵等无战斗部件单位）在场 — 塔本 tick 不接维修任务。
      // 引擎会对最近的敌对 creep 自动开火（10 能量一枪点掉 MOVE 侦察兵）；
      // 显式 repair 会占用塔的本 tick 动作、抑制引擎自动攻击 —
      // 「满能量塔对贴身侦察兵不开火」的根因正是维修分支抢走了塔的动作。
      if (snapshot.hostileCreeps.length > 0) {
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

        // ：维修优先级 spawn/extension → tower → container → wall/rampart。
        if (repairTarget) {
          countedTowerAction(snapshot.roomName, tower, () => tower.repair(repairTarget));
          continue;
        }

        // G-DF-08：wall/rampart 维护（最低优先级）。
        // 门禁：colonyState 必须 normal + tower 能量 > 70%（保留应急储备）。
        if (wallRepairTarget && wallMaintenanceAllowed) {
          const towerEnergyRatio = tower.store.getUsedCapacity(RESOURCE_ENERGY) / tower.store.getCapacity(RESOURCE_ENERGY);
          if (towerEnergyRatio > 0.7) {
            countedTowerAction(snapshot.roomName, tower, () => tower.repair(wallRepairTarget));
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

/** 威胁是否具备破坏能力（攻击 / 远程 / dismantle；纯 HEAL 侦察不构成拆毁威胁）。 */
function hasOffensiveParts(creep: Creep): boolean {
  return creep.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK);
}

/** 攻击方式的最大射程：rangedAttack = 3，attack / dismantle = 1 — 3 覆盖全部。 */
const MAX_ATTACK_RANGE = 3;

/**
 * 核心结构正在被拆毁 — 有塔分支动用 safe mode 保底的判据。
 * ① 任一核心结构（spawn/storage/terminal/tower）已受损且带攻击部件的威胁贴身；
 * ② 塔全空（防线能量耗尽）且带攻击部件的威胁突入核心区。
 * 纯接近 + 奶量压制（打不出火力）不构成动用理由 — 那是消耗战，不是失守：
 * safe mode 烧一次少一次，留给真正守不住的时刻。
 */
function isCoreBeingDestroyed(snapshot: RoomSnapshot): boolean {
  const threats = snapshot.threatCreeps as Creep[];
  const attackerNear = (pos: RoomPosition) =>
    threats.some(t => hasOffensiveParts(t) && t.pos.getRangeTo(pos) <= MAX_ATTACK_RANGE);
  const core = [...snapshot.spawns, snapshot.storage, snapshot.terminal, ...snapshot.towers];
  if (core.some(s => s !== undefined && s.hits < s.hitsMax && attackerNear(s.pos))) return true;
  if (snapshot.towers.every(t => t.store.getUsedCapacity(RESOURCE_ENERGY) === 0)) {
    const anchor = snapshot.spawns[0] ?? snapshot.controller;
    if (anchor && threats.some(t => hasOffensiveParts(t) && t.pos.getRangeTo(anchor.pos) <= CONFIG.defense.safeModeTriggerRange)) {
      return true;
    }
  }
  return false;
}

/**
 * 消耗战上报：核心被突破、塔打不出火力、但未达保底判据 — 威胁悬而未决，
 * 必须可观测（守线策略是长时间对峙，静默会被误读为防御失灵）。
 * 同房 200t 心跳重报，防环形缓冲被刷屏。
 */
function reportThreatUnhandled(snapshot: RoomSnapshot): void {
  const g = globalCache();
  const at = g.threatUnhandledAt ?? (g.threatUnhandledAt = {});
  const last = at[snapshot.roomName];
  if (last !== undefined && Game.time - last < 200) return;
  at[snapshot.roomName] = Game.time;
  const totalHeal = (snapshot.threatCreeps as Creep[]).reduce(
    (sum, c) => sum + c.body.filter(p => p.type === HEAL).length,
    0,
  );
  recordEvent(EventKind.ThreatUnhandled, snapshot.roomName, [snapshot.threatCreeps.length, totalHeal]);
}

/**
 * 激活 safe mode（带完整前置校验）。
 * 触发场景：① 无塔且核心被突破；② 有塔且核心结构正被拆毁 / 塔全空被突入；
 * ③ 舰队伤亡熔断。safe mode 是最后防线 — 校验 controller 归属 / 未激活 /
 * 无冷却 / 有可用次数。
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
