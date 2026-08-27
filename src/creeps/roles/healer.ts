/** Healer */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { attackerHold, markRetreat } from "./attacker";
import { globalCache } from "../../kernel/global-cache";

/** A5.4.1 战术指令接口（与 domain/tactical/role-intent.ts RoleActionIntent 对齐）。 */
interface TacticalIntent {
  moveDirective: string;
  combatDirective: string;
  targetId?: string;
}

/**
 * A5.4.1 从 globalCache 读取当前 creep 的战术指令。

 * 角色层不导入 systems 层（R3 架构守卫），直接从 globalCache 读取
 * tactical-runtime-system 写入的 RoleActionIntent。
 * 无指令时返回 null → 角色回退到 Legacy 行为。
 */
function readTacticalIntent(creepName: string): TacticalIntent | null {
  const g = globalCache() as Record<string, unknown> & {
    tacticalRoleIntents?: Map<string, TacticalIntent>;
  };
  return g.tacticalRoleIntents?.get(creepName) ?? null;
}

/** 目标房内己方 combat creep（attacker）— 跟随/救治对象。 */
function findBuddy(creep: Creep): Creep | undefined {
  let best: Creep | undefined;
  let bestRange = Infinity;
  for (const c of Object.values(Game.creeps)) {
    if (c.memory.role !== "attacker") continue;
    if (c.room?.name !== creep.room.name) continue;
    const range = creep.pos.getRangeTo(c.pos);
    if (range < bestRange) {
      bestRange = range;
      best = c;
    }
  }
  return best;
}

/** 目标房内受伤己方（含自身）最近者 — 就近救治，集火谁奶谁。 */
function findWounded(creep: Creep): Creep | undefined {
  let best: Creep | undefined;
  let bestRange = Infinity;
  for (const c of Object.values(Game.creeps)) {
    if (c.room?.name !== creep.room.name) continue;
    if (c.hits >= c.hitsMax) continue;
    const range = creep.pos.getRangeTo(c.pos);
    if (range < bestRange) {
      bestRange = range;
      best = c;
    }
  }
  return best ?? (creep.hits < creep.hitsMax ? creep : undefined);
}

/**
 * A5.4.1 战术指令消费 — 优先消费 Tactical Runtime 产出的 RoleActionIntent。

 * 当有 HEAL/RANGED_HEAL 指令 + targetId 时，按指令治疗指定目标。
 * 无指令时回退到 Legacy findWounded/findBuddy 逻辑。
 */
export function healByTacticalIntent(): ActionCandidate<Creep> {
  return {
    name: "healer:tactical-intent",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const intent = readTacticalIntent(ac.creep.name);
      if (!intent) return undefined; // 无战术指令 → 回退 Legacy
      // RETREAT → 标记回收
      if (intent.moveDirective === "RETREAT_TO_SAFE" || intent.moveDirective === "BREAK_CONTACT") {
        ac.creep.memory.recycle = true;
        return undefined;
      }
      // 有治疗指令 + targetId → 查找目标
      if ((intent.combatDirective === "HEAL_TARGET" || intent.combatDirective === "RANGED_HEAL_TARGET") && intent.targetId) {
        const target = Game.getObjectById(intent.targetId as Id<Creep>);
        if (target) return target;
        // targetId 无效 → 回退 Legacy
      }
      // 无治疗指令 → 回退 Legacy
      return undefined;
    },
    execute: (ac, target) => {
      const range = ac.creep.pos.getRangeTo(target.pos);
      const isWounded = target.hits < target.hitsMax;
      if (isWounded) {
        if (range <= 1) {
          ac.creep.heal(target);
        } else if (range <= 3) {
          ac.creep.rangedHeal(target);
          moveToTarget(ac.creep, target);
        } else {
          moveToTarget(ac.creep, target);
        }
      } else if (range > 1) {
        moveToTarget(ac.creep, target);
      }
    },
  };
}

export function healAllies(): ActionCandidate<Creep> {
  return {
    name: "healer:heal-allies",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;

      const wounded = findWounded(ac.creep);
      if (wounded) return wounded;
      const buddy = findBuddy(ac.creep);
      if (buddy) return buddy;
      // 编队不存在（attacker 全灭且无人受伤）→ 回收止损，不裸奔站桩。
      ac.creep.memory.recycle = true;
      return undefined;
    },
    execute: (ac, target) => {
      const range = ac.creep.pos.getRangeTo(target.pos);
      const isWounded = target.hits < target.hitsMax;
      if (isWounded) {
        if (range <= 1) {
          ac.creep.heal(target);
        } else if (range <= 3) {
          // 距离 2-3：rangedHeal 过渡 + 继续贴近（下 tick 转全额 heal）。
          ac.creep.rangedHeal(target);
          moveToTarget(ac.creep, target);
        } else {
          moveToTarget(ac.creep, target);
        }
      } else if (range > 1) {
        // 满血 buddy：贴身待命（range 1 内静默，塔伤出现即接管）。
        moveToTarget(ac.creep, target);
      }
    },
  };
}

const policy: RolePolicy = {
  combat: true,
  hold: attackerHold,
  // A5.4.1：tactical-intent 优先于 Legacy 候选；无指令时回退到 healAllies
  acquire: [healByTacticalIntent(), healAllies()],
  work: [healByTacticalIntent(), healAllies()],
};

export const healerRole = defineRole("healer", 2 as Priority, policy);
