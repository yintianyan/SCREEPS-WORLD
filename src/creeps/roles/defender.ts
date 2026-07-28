/**
 * Defender — P1 本房防御角色。
 *
 * 职责：colonyState=defense（房内出现威胁 creep）时由 demand 孵化，
 * 与塔协同清剿入侵者：塔负责远程集火，defender 负责贴脸补刀 /
 * 无塔窗口期（RCL1-2 或塔被打空）的唯一主动防线。
 *
 * 策略声明：
 *   combat: true — 豁免 role-runner 的 flee 检测（职责就是接敌）
 *   acquire/work: 攻击最近的威胁 creep（读 home snapshot.threatCreeps，零 find）
 *   威胁清除后无候选 → park 待命，直至寿命耗尽（demand 不再补充/替换）
 *
 * 约束遵守：目标来自 RoomSnapshot.threatCreeps（P0 层已分类过滤联盟与无害单位），
 * 角色自身不做任何 room.find / 全局扫描。
 */
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
      // DF-1：追击边界 — 参照 remote-defender 的房内限定模式。
      // a) defender 自己被挤/弹出 home 房时不接敌（ensureHome 会导航回来）；
      // b) 贴出口（边界 1 格内）的敌人不追 — exit kiting 会把 defender
      //    反复拉到边界格被引擎弹房。放弃的目标交给塔处理（塔无射程死角），
      //    全部威胁都贴边时 resolve miss → park 待命。
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
