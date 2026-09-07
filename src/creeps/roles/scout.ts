/** Scout — 侦察单位，到达目标房后扫描情报并自回收 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { getHostilesCached } from "../support/targeting";
import { getHostileStructuresCached, findSourcesCached } from "../support/room-scans";

/**
 * 到达目标房后执行侦察扫描：记录敌方 creep/结构、source/controller 等级等信息
 * 到 Memory（由 intelligence system 消费），扫描完成后标记自回收。
 *
 * scout body 只有 [MOVE]（50 能量），无战斗能力 — 到达即扫描即回收是正确生命周期。
 */
function reconRoomAction(): ActionCandidate<true> {
  return {
    name: "scout:recon-room",
    resolve: (ac) => {
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      // 已标记回收 — 不重复执行
      if (ac.creep.memory.recycle) return undefined;
      return true;
    },
    execute: (ac) => {
      const room = ac.creep.room;
      const roomName = room.name;

      // 记录基础情报到 Memory.rooms（intelligence system 的数据源）
      const roomMem = (Memory.rooms[roomName] ??= {}) as any;
      roomMem.lastScout = Game.time;

      // 记录敌方威胁
      const hostiles = getHostilesCached(room);
      const hostileStructs = getHostileStructuresCached(room);
      if (hostiles.length > 0 || hostileStructs.length > 0) {
        roomMem.hostilePresence = {
          creeps: hostiles.length,
          structures: hostileStructs.length,
          tick: Game.time,
        };
      } else {
        // 无威胁则清除旧记录（情报有时效性）
        delete roomMem.hostilePresence;
      }

      // 记录 controller 状态（扩张决策用）
      const controller = room.controller;
      if (controller) {
        roomMem.scoutController = {
          level: controller.level,
          my: controller.my,
          reservation: controller.reservation?.username ?? null,
          ticksToDowngrade: controller.ticksToDowngrade,
          hasOwner: !!(controller.owner || controller.sign?.username),
        };
      }

      // 记录 source 数量（扩张选址参考）
      const sources = findSourcesCached(room);
      roomMem.scoutSources = sources.length;

      // 侦察完成 — 标记自回收，spawn-manager 引导归航
      ac.creep.memory.recycle = true;
    },
  };
}

const policy: RolePolicy = {
  park: true,
  acquire: [
    // 到达目标房后执行侦察扫描，完成后标记回收。
    reconRoomAction(),
  ],
  work: [
    // work 模式也执行侦察（scout 无 CARRY，mode 振荡不影响行为）。
    reconRoomAction(),
  ],
  // recon push-through：钻进敌方过境房时不 flee 回 home，
  // 继续向 remoteTarget 推进（配合 memory.avoidRooms 绕行，仅在被 hostile 包围无路可绕时硬钻）。
  // 否则一次性便宜 scout（[MOVE] 50 能量）遇袭即弃任务，recon 永不完成 → 占领链卡死。
  pushThrough: true,
};

export const scoutRole = defineRole("scout", 3 as Priority, policy);
