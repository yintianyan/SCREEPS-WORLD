/** Defender */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { moveToTarget } from "../movement";
import { defineRole } from "../engine/role-runner";

/** 攻击 home 房内最近的威胁 creep。 */
function attackNearestThreat(): ActionCandidate<Creep> {
  return {
    name: "defender:attack-threat",
    resolve: (ac) => {
      const threats = ac.snapshot.threatCreeps;
      if (threats.length === 0) return undefined;
      // DF-1：追击边界 — 参照 remote-defender 的房内限定模式。a) 被挤/弹出 home 房时不接敌
      // （ensureHome 会导航回来）；b) 贴出口（边界 1 格内）的敌人不追 — exit kiting 会把
      // defender 反复拉到边界格被引擎弹房。放弃的目标交给塔处理（塔无射程死角）。
      if (ac.creep.room.name !== ac.creep.memory.home) return undefined;
      const engageable = (threats as Creep[]).filter(
        t => t.pos.x > 1 && t.pos.x < 48 && t.pos.y > 1 && t.pos.y < 48,
      );
      if (engageable.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(engageable) ?? engageable[0];
    },
    execute: (ac, target) => {
      const result = ac.creep.attack(target);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, target);
      }
    },
  };
}

const policy: RolePolicy = {
  combat: true,
  park: true,
  acquire: [
    attackNearestThreat(),
  ],
  work: [
    // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
    attackNearestThreat(),
  ],
};

export const defenderRole = defineRole("defender", 1 as Priority, policy);
