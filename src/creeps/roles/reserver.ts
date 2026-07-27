/**
 * Reserver — P2 远矿 controller 占领者。
 *
 * 职责：在远矿房 reserveController，防止 Source Keeper 刷怪，延长 source 再生时间。
 *
 * 设计要点：
 *   - body: [CLAIM, MOVE] — 最小占领配置，650 能量
 *   - 无 CARRY 部件 → updateMode 会在 acquire/work 间振荡，但两个 mode 行为相同
 *   - 不使用 assignment 系统 → 目标固定为 remoteTarget 的 controller
 *   - 常驻 remoteTarget（ensureHome 导航适配）
 *
 * 策略声明：
 *   acquire/work: 移动到 controller 并 reserveController（行为相同）
 *
 * 架构约束：
 *   - reserveController 每 tick 续期 1 tick，1 个 CLAIM 部件即满足
 *   - controller 被 SK/其他玩家占领时（owner 存在且非自己）攻击而非占领
 *   - controller 被 Invader/其他玩家预定时（reservation 存在）→ reserveController
 *     返回 ERR_INVALID_TARGET → fallback 到 attackController 消耗敌方预定期
 *   - 无 CARRY → mode 振荡不影响行为（两 mode 候选相同）
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { globalCache } from "../../kernel/global-cache";
import { moveToTarget } from "../movement";

/**
 * 检测房间是否被 InvaderCore 占据（per-tick per-room 共享缓存）。
 *
 * InvaderCore 持续为 controller 续期预约（每 tick +2），reserver 的
 * attackController 每次仅 -1（1 CLAIM）— 永远磨不过，留守是纯空耗。
 * 检测到核心即放弃动作，role-runner 走 idle → ensureHome 导航回 home；
 * 孵化冻结与回收由 remote-mining-manager 负责，此处是其 10-tick
 * 评估间隔内的即时兜底。缓存单 tick 生命周期，同房多 creep 共享一次 find。
 * 导出供接线测试验证检测与缓存行为。
 */
export function roomHasInvaderCore(room: Room): boolean {
  const g = globalCache() as { __remoteInvaderCore?: Record<string, { tick: number; blocked: boolean }> };
  if (!g.__remoteInvaderCore) g.__remoteInvaderCore = {};
  const cached = g.__remoteInvaderCore[room.name];
  if (cached && cached.tick === Game.time) return cached.blocked;

  const cores = room.find(FIND_HOSTILE_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_INVADER_CORE,
  });
  const blocked = cores.length > 0;
  g.__remoteInvaderCore[room.name] = { tick: Game.time, blocked };
  return blocked;
}

/** 占领/攻击 controller。 */
function reserveControllerAction(): ActionCandidate<StructureController> {
  return {
    name: "reserver:reserve-controller",
    resolve: (ac) => {
      // 只在 remoteTarget 房间内执行。
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      // 房间必须有 controller。
      const controller = ac.creep.room.controller;
      if (!controller) return undefined;
      // InvaderCore 压制房：放弃动作 — attackController 磨不过核心续期，
      // 返回 undefined 走 idle → 回 home 等待回收，不在此空耗寿命。
      if (roomHasInvaderCore(ac.creep.room)) return undefined;
      return controller;
    },
    execute: (ac, controller) => {
      // controller 有主且非自己 → 攻击 controller（降级敌方控制）。
      if (controller.owner && !controller.my) {
        const result = ac.creep.attackController(controller);
        if (result === ERR_NOT_IN_RANGE) {
          moveToTarget(ac.creep, controller);
        }
        return;
      }

      // 尝试预定。
      const result = ac.creep.reserveController(controller);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, controller);
      } else if (result === ERR_INVALID_TARGET) {
        // controller 被其他玩家/Invader 预定 → attackController 降低其预定期。
        // reserveController 在 controller 已被其他玩家预定时返回 ERR_INVALID_TARGET。
        // attackController 有 1000 tick cooldown（cooldown 中返回 ERR_TIRED），
        // 每次成功攻击降低 1 tick reservation — 缓慢但持续消耗敌方预定。
        const attackResult = ac.creep.attackController(controller);
        if (attackResult === ERR_NOT_IN_RANGE) {
          moveToTarget(ac.creep, controller);
        }
        // ERR_TIRED = cooldown 中，等待下一 tick 再试。
      }
    },
  };
}

const policy: RolePolicy = {
  acquire: [
    reserveControllerAction(),
  ],
  work: [
    // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
    reserveControllerAction(),
  ],
};

export const reserverRole = defineRole("reserver", 2 as Priority, policy);
