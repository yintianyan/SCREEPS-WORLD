/**
 * RemoteDefender — P1 远矿防御者。
 *
 * 职责：前往受威胁的远矿房，击杀 NPC Invader / reserver creep。
 *
 * 设计要点：
 *   - body: [ATTACK, ATTACK, MOVE, MOVE] @520 — 20 damage/tick，10 tick 击杀 NPC reserver
 *   - 无 CARRY 部件 → updateMode 会在 acquire/work 间振荡，但两个 mode 行为相同
 *   - 不使用 assignment 系统 → 目标固定为 remoteTarget 中的 hostile creep
 *   - 常驻 remoteTarget（ensureHome 导航适配）
 *
 * 策略声明：
 *   acquire/work: 在 remoteTarget 房间内查找 hostile creep → 攻击最近的
 *
 * 行为链路：
 *   1. ensureHome 导航到 remoteTarget
 *   2. find FIND_HOSTILE_CREEPS（过滤联盟白名单）
 *   3. 有 hostile → attack 最近者
 *   4. 无 hostile → 威胁已清除 → idle（ensureHome 导航回 home 等待回收）
 *
 * 架构约束：
 *   - NPC reserver 通常只有 [CLAIM, MOVE]，无攻击能力 → defender 不会受伤
 *   - NPC Invader 可能有 ATTACK/RANGED_ATTACK → defender 需要足够 ATTACK 快速击杀
 *   - 威胁清除后 idle → 回 home → recycleExcessRemoteCreeps 回收
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { CONFIG } from "../../config";

/** 在 remoteTarget 房间内查找并攻击 hostile creep。 */
function attackHostileAction(): ActionCandidate<Creep> {
  return {
    name: "remote-defender:attack-hostile",
    resolve: (ac) => {
      // 只在 remoteTarget 房间内执行。
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;

      // 查找 hostile creep（过滤联盟白名单）。
      const hostiles = ac.creep.room.find(FIND_HOSTILE_CREEPS, {
        filter: (c) => {
          const allies = CONFIG.defense.allies;
          return !allies.includes(c.owner.username);
        },
      });
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
  acquire: [
    attackHostileAction(),
  ],
  work: [
    // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
    attackHostileAction(),
  ],
};

export const remoteDefenderRole = defineRole("remoteDefender", 1 as Priority, policy);
