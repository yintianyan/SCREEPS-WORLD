/**
 * Healer — P2 战争编队治疗端（heal-tank 最小闭环）。
 * 职责：仅 war 姿态时由 war-planner 与 attacker 同波孵化；跨房行军至 war 目标房
 * （role-runner remoteTarget 通勤栈），贴身奶受伤己方（含自奶），满血时跟随
 * buddy attacker 贴身待命（塔伤下 tick 即转 heal）；自身低血标记回收撤出。
 *
 * 编队协同：与 attacker 共用 warPlan 的 build/advance 波次 — hold 复用
 * attackerHold（集结逻辑同构：build 相位归建停驻，advance 才整波推进）。
 * 编队不存在防御：目标房内既无受伤己方也无 attacker（编队被打散/全灭）→
 * 自标记 recycle 止损，绝不在敌房裸奔站桩。
 *
 * 战术依据：贴身 heal 12/part/tick、range 3 退化 rangedHeal 4/part/tick；
 * 塔（600 衰减至 75/shot）对 heal 覆盖下的 TOUGH 前排难以造成净减员 —
 * 这正是 tower-engagement 防守侧早已登记的 heal-tank 骗塔战术，此处为进攻镜像。
 *
 * 约束：combat:true 豁免 flee（奶车不能丢下前排逃跑）；无 CARRY 不涉物流。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { attackerHold, markRetreat } from "./attacker";

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
  acquire: [healAllies()],
  work: [healAllies()],
};

export const healerRole = defineRole("healer", 2 as Priority, policy);
