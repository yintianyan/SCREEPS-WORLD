/** Dismantler — dismantle 拆迁者 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget, registerStaticBlocker, registerAnchor } from "../movement";
import { attackerHold, markRetreat } from "./attacker";
import { getHostileStructuresCached, findWallsCached } from "../support/room-scans";
import { CONFIG } from "../../config";

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

/**
 * 拆除路径阻断 wall — dismantler 在远矿房时拆除路径上的 neutral wall。
 *
 * neutral wall 无 owner，不属于 FIND_HOSTILE_STRUCTURES，需走 FIND_STRUCTURES。
 * 只在 needWallClear 标记成立时孵化到此房的 dismantler 会执行此 action。
 * 拆最近 wall 即可：detectPathWallBlockers 已确认路径上有 wall，拆完后
 * 标记自动清除 + 回收 dismantler。
 */
export function dismantlePathWalls(): ActionCandidate<StructureWall> {
  return {
    name: "dismantler:dismantle-path-walls",
    resolve: (ac) => {
      if (markRetreat(ac.creep)) return undefined;
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      const walls = findWallsCached(ac.creep.room);
      if (walls.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(walls) ?? walls[0];
    },
    execute: (ac, target) => {
      const result = ac.creep.dismantle(target);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, target);
      } else if (result === OK) {
        // 原地拆墙时登记静态阻挡 + 锚定，让其他 creep 的 PathFinder
        // 天然绕行 dismantler 所在格，避免拆墙期间长期阻塞通勤路径。
        // registerStaticBlocker 把 dismantler 位置标 255，PathFinder 会绕行；
        // registerAnchor 防止被 traffic-resolver 低优先级 creep 推挤（推走后
        // 下 tick role-runner 又移回墙旁 → 循环振荡）。
        registerStaticBlocker(ac.creep.room.name, ac.creep.pos);
        registerAnchor(ac.creep, CONFIG.movement.trafficPriority.work);
      }
    },
  };
}

const policy: RolePolicy = {
  combat: true,
  park: true,
  hold: attackerHold,
  acquire: [dismantleStructures(), dismantlePathWalls()],
  work: [dismantleStructures(), dismantlePathWalls()],
};

export const dismantlerRole = defineRole("dismantler", 2 as Priority, policy);
