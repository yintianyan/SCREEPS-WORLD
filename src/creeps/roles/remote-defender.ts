/** RemoteDefender — 远矿防御者（RANGED_ATTACK kiting 战术）
 *
 * 设计参考：社区最佳实践（screepspl.us Combat 指南）
 * - RANGED_ATTACK 射程 3、10 dmg/part/tick，无 counter-attack 风险
 * - kiting = 边退边打，近战敌人永远够不到 → 对 NPC melee 入侵者无损
 * - 对 RANGED_ATTACK 型入侵者在射程内对射，配合 TOUGH 吸伤 + 数量优势取胜
 * - 多只 defender 车轮战：3×3R = 90 dmg/tick，重型入侵者 32 tick 击杀
 *
 * 角色行为：
 * 1. 有敌可打 → kiting（保持距离 3 射程内边退边打）
 * 2. 无敌可打 → 归防守位（container/source 质心）
 * 3. 半血撤退 → 标记 recycle，demand 孵接替者
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { getHostilesCached } from "../support/targeting";
import { findContainersCached, findExitsCached, findSourcesCached } from "../support/room-scans";

/** kiting 理想距离：RANGED_ATTACK 射程 3，保持恰好 3 格可输出且不被近战够到。 */
const KITE_RANGE = 3;
/** kiting 安全距离：近战敌人进入此距离内必须撤退（ATTACK 射程 1 + 1 格缓冲）。 */
const KITE_SAFE_RANGE = 2;

/**
 * kiting 攻击行为 — 查找最近 hostile 并以 RANGED_ATTACK 边退边打。
 *
 * 战术逻辑：
 * - 距离 > KITE_RANGE：靠近（到射程内才能开火）
 * - 距离 == KITE_RANGE：原地 rangedAttack（最优输出位）
 * - 距离 < KITE_SAFE_RANGE：后退（不让近战够到）
 * - 距离在 SAFE~KITE 之间：原地 rangedAttack（仍在射程内）
 *
 * 对 RANGED_ATTACK 型入侵者：不后退（对方也能射 3 格），直接对射。
 * 通过 TOUGH 前置 + 多只车轮战取胜。
 */
function kiteAttackAction(): ActionCandidate<Creep> {
  return {
    name: "remote-defender:kite-attack",
    resolve: ac => {
      // RD-1：血量护栏 — 半血即撤。标记 recycle → role-runner 短路 idle →
      // spawn-manager recyclePass 归航；collectRemoteCreeps 跳过 recycle 中的
      // creep → demand 会孵接替者。kiting 战术正常无损，但 ranged 对射会受伤。
      if (ac.creep.hits < ac.creep.hitsMax * 0.5) {
        ac.creep.memory.recycle = true;
        return undefined;
      }
      // 只在 remoteTarget 房间内执行。
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;

      // 查找 hostile creep（过滤联盟白名单）— 走 per-tick per-room 共享缓存。
      const hostiles = getHostilesCached(ac.creep.room);
      if (hostiles.length === 0) return undefined;

      // 选最近的 hostile — kiting 需要与目标保持精确距离。
      return ac.creep.pos.findClosestByRange(hostiles) ?? hostiles[0];
    },
    execute: (ac, target) => {
      const creep = ac.creep;
      const dist = creep.pos.getRangeTo(target.pos);

      // 判断目标是否有 RANGED_ATTACK — 决定是否后退。
      const targetBody = (target as Creep).body ?? [];
      const targetHasRanged = targetBody.some(p => p.type === RANGED_ATTACK && p.hits > 0);

      if (dist > KITE_RANGE) {
        // 太远 — 靠近到射程内。
        // 在移动同时尝试 rangedAttack（如果已在射程边缘）。
        if (dist <= KITE_RANGE + 1) {
          creep.rangedAttack(target);
        }
        moveToTarget(creep, target);
      } else if (dist <= KITE_SAFE_RANGE && !targetHasRanged) {
        // 太近且对方是近战 — 后退到安全距离。
        // 后退方向 = 远离目标。用 rangedMassAttack 命中身边所有敌人。
        creep.rangedAttack(target);
        // 向远离目标方向移动：找最远的出口方向。
        const safeDir = findKiteRetreatDir(creep, target.pos);
        if (safeDir) {
          creep.move(safeDir);
        }
      } else {
        // 在射程内（SAFE < dist <= KITE，或对方也有 ranged）— 原地对射。
        creep.rangedAttack(target);
        // 如果对方有 ranged 且我们血量偏低，也尝试微调距离。
        if (targetHasRanged && creep.hits < creep.hitsMax * 0.7) {
          const safeDir = findKiteRetreatDir(creep, target.pos);
          if (safeDir) {
            creep.move(safeDir);
          }
        }
      }
    },
  };
}

/**
 * 计算后退方向 — 远离目标。
 * 返回最安全的后退方向（远离目标且不撞墙）。
 */
function findKiteRetreatDir(creep: Creep, threatPos: RoomPosition): DirectionConstant | undefined {
  // 计算远离目标的方向。
  const dx = creep.pos.x - threatPos.x;
  const dy = creep.pos.y - threatPos.y;

  // 优先选择能拉开最大距离的方向。
  // 简化：选目标在反方向的象限。
  let bestDir: DirectionConstant | undefined;
  if (Math.abs(dx) >= Math.abs(dy)) {
    // 水平远离优先
    bestDir = (dx > 0 ? RIGHT : LEFT) as DirectionConstant;
  } else {
    bestDir = (dy > 0 ? BOTTOM : TOP) as DirectionConstant;
  }

  // 检查目标方向是否可走（不撞墙/边界）。
  const nx = creep.pos.x + (bestDir === RIGHT ? 1 : bestDir === LEFT ? -1 : 0);
  const ny = creep.pos.y + (bestDir === BOTTOM ? 1 : bestDir === TOP ? -1 : 0);
  if (nx < 0 || nx > 49 || ny < 0 || ny > 49) {
    // 边界 — 尝试斜向后退。
    if (Math.abs(dx) >= Math.abs(dy)) {
      bestDir = (dy > 0 ? BOTTOM : TOP) as DirectionConstant;
    } else {
      bestDir = (dx > 0 ? RIGHT : LEFT) as DirectionConstant;
    }
    const nx2 = creep.pos.x + (bestDir === RIGHT ? 1 : bestDir === LEFT ? -1 : 0);
    const ny2 = creep.pos.y + (bestDir === BOTTOM ? 1 : bestDir === TOP ? -1 : 0);
    if (nx2 < 0 || nx2 > 49 || ny2 < 0 || ny2 > 49) {
      return undefined;
    }
  }

  return bestDir;
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
  acquire: [kiteAttackAction(), moveToDefensePost()],
  work: [
    // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
    kiteAttackAction(),
    moveToDefensePost(),
  ],
};

export const remoteDefenderRole = defineRole("remoteDefender", 1 as Priority, policy);
