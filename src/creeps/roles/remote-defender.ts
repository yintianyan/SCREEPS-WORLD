/**
 * RemoteDefender — P1 远矿防御者。前往受威胁的远矿房，击杀 NPC Invader / reserver creep。
 * 设计：body [ATTACK,ATTACK,MOVE,MOVE] @520 — 20 damage/tick，10 tick 击杀 NPC reserver；
 * 无 CARRY → mode 振荡但两 mode 行为相同；不用 assignment → 目标固定为 remoteTarget 中 hostile；
 * 常驻 remoteTarget（ensureHome 导航适配）。
 * 行为链：ensureHome 导航 → 找 hostile（过滤联盟白名单）→ attack 最近 → 无威胁则 idle → 回 home 回收。
 * 架构约束：NPC reserver 无攻击能力 → defender 不会受伤；NPC Invader 可能有 ATTACK → 需足够 ATTACK 快杀。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { getHostilesCached } from "../support/targeting";

/** 在 remoteTarget 房间内查找并攻击 hostile creep。 */
function attackHostileAction(): ActionCandidate<Creep> {
  return {
    name: "remote-defender:attack-hostile",
    resolve: (ac) => {
      // RD-1：血量护栏 — 「NPC reserver 无攻击能力 → defender 不会受伤」只对 reserver 成立；
      // 带 ATTACK/RANGED 的 Invader（demand 触发场景就包含它）会站桩互殴。半血即撤：标记
      // recycle → role-runner 短路 idle → spawn-manager recyclePass 归航；collectRemoteCreeps
      // 跳过 recycle 中的 creep → demand 会孵接替者。
      if (ac.creep.hits < ac.creep.hitsMax * 0.5) {
        ac.creep.memory.recycle = true;
        return undefined;
      }
      // 只在 remoteTarget 房间内执行。
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;

      // 查找 hostile creep（过滤联盟白名单）— 走 per-tick per-room 共享缓存，
      // 同房多 defender 共享一次 find，避免每只每 tick 全房扫描。
      const hostiles = getHostilesCached(ac.creep.room);
      if (hostiles.length === 0) return undefined;

      // 选最近的 hostile。
      return ac.creep.pos.findClosestByRange(hostiles) ?? hostiles[0];
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
  // 战斗角色 — 豁免 flee 检测，否则到达远矿房看到敌人立刻逃回 home，攻击候选永远轮不到执行。
  combat: true,
  acquire: [
    attackHostileAction(),
  ],
  work: [
    // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
    attackHostileAction(),
  ],
};

export const remoteDefenderRole = defineRole("remoteDefender", 1 as Priority, policy);
