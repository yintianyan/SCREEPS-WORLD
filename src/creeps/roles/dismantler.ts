/** Dismantler — dismantle 拆迁者 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { attackerHold, markRetreat } from "./attacker";
import { getHostileStructuresCached } from "../support/room-scans";

/** 按建筑价值分档选择拆迁目标。 */
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

/** 拆迁敌结构：dismantle 50 dmg/part/tick，不触发 counter-attack。 */
export function dismantleStructures(): ActionCandidate<AnyStructure> {
  return {
    name: "dismantler:dismantle-structures",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      const structs = getHostileStructuresCached(ac.creep.room);
      if (structs.length === 0) return undefined;
      let best: AnyStructure | undefined;
      let bestScore = -Infinity;
      for (const s of structs) {
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
      const result = ac.creep.dismantle(target);
      if (result === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, target);
    },
  };
}

const policy: RolePolicy = {
  combat: true,
  hold: attackerHold,
  acquire: [dismantleStructures()],
  work: [dismantleStructures()],
};

export const dismantlerRole = defineRole("dismantler", 2 as Priority, policy);
