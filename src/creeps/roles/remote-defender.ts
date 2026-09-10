/** RemoteDefender */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { getHostilesCached } from "../support/targeting";
import { findContainersCached, findExitsCached, findSourcesCached } from "../support/room-scans";

/** 在 remoteTarget 房间内查找并攻击 hostile creep。 */
function attackHostileAction(): ActionCandidate<Creep> {
  return {
    name: "remote-defender:attack-hostile",
    resolve: ac => {
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

/**
 * 无敌情归防守位 — 防守位 = 我方 container 质心（守护采集基建），无 container 用
 * source 质心。远矿房常有 1 格宽的天然门坎（墙形所致），defender 到达后停在门口
 * 节点会堵死整个远矿交通（reserver/hauler pathFailure 的元凶）；通用 park 只能
 * 把它挪出边界带，挪到的下一格可能仍是门格 —— 归位到房间深处的防守位才是根治。
 */
function moveToDefensePost(): ActionCandidate<RoomPosition> {
  return {
    name: "remote-defender:move-to-post",
    resolve: ac => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      // 有敌情时攻击候选接管 —— 本候选仅在无敌可打时兜底归位。
      if (getHostilesCached(ac.creep.room).length > 0) return undefined;
      const post = defensePostOf(ac.creep.room);
      if (!post) return undefined;
      if (ac.creep.pos.getRangeTo(post) <= 2) return undefined;
      return post;
    },
    execute: (ac, post) => {
      moveToTarget(ac.creep, post);
    },
  };
}

/**
 * 防守位：选择最能覆盖入口路径的位置。
 * F15 修复：原质心算法在多 container 房会落在两 container 中间空地，
 * 不在任何 container 旁 — 敌人到 container 时 defender 还要走过去。
 * 改为：直接选最近入口的 container/source 作为防守位（最外层防线）。
 * 单 container/source 时退化为本体位置（与原逻辑一致）。
 */
function defensePostOf(room: Room): RoomPosition | undefined {
  const containers = findContainersCached(room);
  const anchors =
    containers.length > 0 ? containers.map(c => c.pos) : findSourcesCached(room).map(s => s.pos);
  if (anchors.length === 0) return undefined;
  if (anchors.length === 1) return anchors[0];

  // 多锚点：选择距最近入口最近者（最外层防线，拦截路径最短）。
  const exits = findExitsCached(room);
  if (exits.length === 0) {
    // 无出口数据（可能视野不全）— 退化为质心。
    let sx = 0,
      sy = 0;
    for (const p of anchors) {
      sx += p.x;
      sy += p.y;
    }
    return (
      room.getPositionAt(Math.round(sx / anchors.length), Math.round(sy / anchors.length)) ??
      undefined
    );
  }
  let best = anchors[0]!;
  let bestDist = Infinity;
  for (const anchor of anchors) {
    let nearestExitDist = Infinity;
    for (const exit of exits) {
      const d = anchor.getRangeTo(exit);
      if (d < nearestExitDist) nearestExitDist = d;
    }
    if (nearestExitDist < bestDist) {
      bestDist = nearestExitDist;
      best = anchor;
    }
  }
  return best;
}

const policy: RolePolicy = {
  // 战斗角色 — 豁免 flee 检测，否则到达远矿房看到敌人立刻逃回 home，攻击候选永远轮不到执行。
  combat: true,
  // idle 时归位 — 无敌可打时停在门口走廊带会堵死远矿出入口（reserver 等
  // 后续 creep pathFailure 的元凶），parkInForeignRoom 会把它推离边界带。
  park: true,
  acquire: [attackHostileAction(), moveToDefensePost()],
  work: [
    // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
    attackHostileAction(),
    moveToDefensePost(),
  ],
};

export const remoteDefenderRole = defineRole("remoteDefender", 1 as Priority, policy);
