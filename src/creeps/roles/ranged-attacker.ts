/** Ranged Attacker — kiting 战术远程攻击者 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget, registerMove } from "../movement";
import { attackerHold, markRetreat } from "./attacker";
import { getHostilesCached } from "../support/targeting";
import { getHostileStructuresCached } from "../support/room-scans";
import { CONFIG } from "../../config";

/** kiting 攻击：rangedAttack 射程 3，不在近战范围则边退边打。 */
export function rangedAttackEnemies(): ActionCandidate<Creep> {
  return {
    name: "rangedAttacker:attack-creeps",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      const hostiles = getHostilesCached(ac.creep.room);
      if (hostiles.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(hostiles) ?? hostiles[0];
    },
    execute: (ac, target) => {
      const dist = ac.creep.pos.getRangeTo(target.pos);
      if (dist <= 3) {
        ac.creep.rangedAttack(target);
        if (dist <= 1 && ac.creep.fatigue === 0) {
          // 近身敌人：kiting — 向远离方向移动保持射程。
          // 通过 registerMove 走 traffic-manager 意图仲裁（flee 优先级），
          // 不绕过集中解算直接发引擎指令。
          const dir = ac.creep.pos.getDirectionTo(target);
          if (dir !== null) {
            const opposite = ((dir + 3) % 8) + 1;
            registerMove(ac.creep, opposite as DirectionConstant, CONFIG.movement.trafficPriority.flee);
          }
        }
      } else {
        moveToTarget(ac.creep, target);
      }
    },
  };
}

/** 对建筑远程攻击：射程 3 内 rangedAttack 结构。 */
export function rangedAttackStructures(): ActionCandidate<AnyStructure> {
  return {
    name: "rangedAttacker:attack-structures",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      const structs = getHostileStructuresCached(ac.creep.room);
      if (structs.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(structs) ?? structs[0];
    },
    execute: (ac, target) => {
      const result = ac.creep.rangedAttack(target);
      if (result === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, target);
    },
  };
}

const policy: RolePolicy = {
  combat: true,
  park: true,
  hold: attackerHold,
  acquire: [rangedAttackEnemies(), rangedAttackStructures()],
  work: [rangedAttackEnemies(), rangedAttackStructures()],
};

export const rangedAttackerRole = defineRole("rangedAttacker", 2 as Priority, policy);
