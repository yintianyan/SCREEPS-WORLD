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
import { getHostilesCached } from "../support/targeting";

/** 在 remoteTarget 房间内查找并攻击 hostile creep。 */
function attackHostileAction(): ActionCandidate<Creep> {
  return {
    name: "remote-defender:attack-hostile",
    resolve: (ac) => {
      // RD-1：血量护栏 — 注释「NPC reserver 无攻击能力 → defender 不会受伤」
      // 只对 reserver 成立；带 ATTACK/RANGED 的 Invader（demand 触发场景
      // 就包含它）会站桩互殴。半血即撤：标记 recycle，role-runner 下 tick
      // 短路 idle，spawn-manager recyclePass 归航回收残值。
      // collectRemoteCreeps 跳过 recycle 中的 creep → demand 会孵接替者。
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
  // 战斗角色 — 豁免 flee 检测，否则到达远矿房看到敌人立刻逃回 home，
  // 攻击候选永远轮不到执行。
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
