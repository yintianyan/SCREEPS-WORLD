/**
 * Attacker — P2 跨房远征攻击者（R3 战时闭环的进攻执行端，R4 波次集结）。
 *
 * 职责：仅 war 姿态时由 war-planner 孵化；跨房行军至 war 目标房（remoteTarget），
 * 先清剿敌方守军 creep，随后拆高值建筑（spawn/tower > storage > extension），
 * 低血时标记回收撤出战区（spawn-manager recyclePass 归航回收残值）。
 *
 * R4 波次集结（hold 钩子）：warPlan.phase === "build" 时不在目标房作战 —
 *   - 在 home：停驻待命（parkIdleCreep），等 war-planner 判定满编转 advance；
 *   - 在外：归建（fleeToHome 向 home 移动），advance 相位下整波推进。
 * 这是「整波集结」替代「散兵逐个送」的执行端：hold 在 ensureHome 导航
 * 之前接管本 tick，堵住 ensureHome 把集结中的攻击者直送目标的添油路径。
 *
 * 策略声明：
 *   combat: true — 豁免 role-runner flee 检测（职责就是接敌）
 *   acquire/work 相同候选：攻击敌 creep > 攻击敌结构（无 CARRY，mode 振荡不影响行为）
 *   remoteTarget = war 目标房 — ensureHome 在非 remoteHauler 角色下两种 mode 都导航到目标房
 *
 * 约束遵守：敌 creep 走 per-tick per-room 共享缓存（getHostilesCached），敌结构走同型
 * 共享缓存（getHostileStructuresCached）— 角色不做逐只全房 find。
 */
import type { Priority, TickContext } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget, parkIdleCreep } from "../movement";
import { fleeToHome } from "../support";
import { getHostilesCached } from "../support/targeting";
import { globalCache } from "../../kernel/global-cache";
import { CONFIG } from "../../config";

/** 低血撤退：标记回收 → role-runner 下 tick 短路 idle → spawn-manager recyclePass 归航。 */
export function markRetreat(creep: Creep): boolean {
  if (creep.hits < creep.hitsMax * CONFIG.war.retreatRatio) {
    creep.memory.recycle = true;
    return true;
  }
  return false;
}

/** 敌方结构价值分档 — 拆高值建筑优先（防守方先失 spawn/tower 即失去反制能力）。 */
function structureValueTier(t: StructureConstant): number {
  switch (t) {
    case STRUCTURE_SPAWN:
    case STRUCTURE_TOWER:
      return 4;
    case STRUCTURE_STORAGE:
      return 3;
    case STRUCTURE_EXTENSION:
      return 2;
    default:
      return 1;
  }
}

/** 目标房内敌结构列表（per-tick per-room 共享缓存，与 remote-hauler 同型模式）。 */
function getHostileStructuresCached(room: Room): AnyStructure[] {
  const g = globalCache() as { __warStructures?: Record<string, { tick: number; list: AnyStructure[] }> };
  if (!g.__warStructures) g.__warStructures = {};
  const cached = g.__warStructures[room.name];
  if (cached && cached.tick === Game.time) return cached.list;
  const list = room.find(FIND_HOSTILE_STRUCTURES);
  g.__warStructures[room.name] = { tick: Game.time, list };
  return list;
}

export function attackEnemies(): ActionCandidate<Creep> {
  return {
    name: "attacker:attack-creeps",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      const hostiles = getHostilesCached(ac.creep.room);
      if (hostiles.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(hostiles) ?? hostiles[0];
    },
    execute: (ac, target) => {
      const result = ac.creep.attack(target);
      if (result === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, target);
    },
  };
}

export function attackStructures(): ActionCandidate<AnyStructure> {
  return {
    name: "attacker:attack-structures",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      const structs = getHostileStructuresCached(ac.creep.room);
      if (structs.length === 0) return undefined;
      let best: AnyStructure | undefined;
      let bestScore = -Infinity;
      for (const s of structs) {
        // 同价值档内优先拆受伤者（集火残血加速摧毁），距离只在同档内决胜。
        const score = structureValueTier(s.structureType) * 1000
          + s.hitsMax - s.hits
          - ac.creep.pos.getRangeTo(s);
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      return best;
    },
    execute: (ac, target) => {
      const result = ac.creep.attack(target);
      if (result === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, target);
    },
  };
}

/**
 * 战备集结（R4 hold 钩子，导出供单测直接调用）。
 *
 * 决策矩阵：
 *   - 无 warPlan / 已 advance / 计划目标与己不一致 → 不接管（false，正常管线）；
 *   - build 阶段 + 低血 → 标记回收并接管（归航由 spawn-manager 处理）；
 *   - build 阶段 + 在 home → 停驻待命（parkIdleCreep）；
 *   - build 阶段 + 在外（目标房/过境房）→ 归建（fleeToHome 向 home 移动）。
 *
 * 返回 true 表示本 tick 已处理（role-runner 跳过导航与攻击候选）。
 */
export function attackerHold(creep: Creep, ctx: TickContext): boolean {
  const plan = Memory.kernel?.warPlan;
  if (!plan || plan.phase === "advance") return false;
  if (plan.targetRoom !== creep.memory.remoteTarget) return false;

  if (markRetreat(creep)) return true;
  if (creep.room.name !== creep.memory.home) {
    fleeToHome(creep);
    return true;
  }
  const snapshot = creep.memory.home ? ctx.getSnapshot(creep.memory.home) : undefined;
  if (snapshot) parkIdleCreep(creep, snapshot);
  return true;
}

const policy: RolePolicy = {
  combat: true,
  hold: attackerHold,
  acquire: [attackEnemies(), attackStructures()],
  work: [attackEnemies(), attackStructures()],
};

export const attackerRole = defineRole("attacker", 2 as Priority, policy);
