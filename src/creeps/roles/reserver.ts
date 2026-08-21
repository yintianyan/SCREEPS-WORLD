/**
 * Reserver — P2 远矿 controller 占领者。在远矿房 reserveController，防止 Source Keeper 刷怪、
 * 延长 source 再生时间。设计：body [CLAIM, MOVE] 最小配置（650 能量）；无 CARRY → mode 振荡
 * 不影响行为；不用 assignment → 目标固定为 remoteTarget 的 controller；常驻 remoteTarget。
 * 架构约束：reserveController 每 tick 续期 1 tick，1 个 CLAIM 即满足；controller 被 SK/其他玩家
 * 占领时（owner 存在且非自己）attackController 而非占领；被预定时 reserveController 返回
 * ERR_INVALID_TARGET → fallback attackController 消耗敌方预定期。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { roomHasInvaderCore } from "../support/invader-core";
import { CONFIG } from "../../config";
import { moveToTarget, registerAnchor, registerStaticBlocker } from "../movement";

/**
 * InvaderCore 压制检测已收敛到 support/invader-core（全仓唯一写者，单一形状）。
 * 语义不变：核心持续为 controller 续期预约（+2/tick），attackController 仅 -1/次，
 * 磨不过即放弃动作 → idle → ensureHome 回 home；孵化冻结与回收仍由
 * remote-mining-manager 负责，此处是其 10-tick 评估间隔内的即时兜底。
 * 兼容再导出：接线测试（tests/unit/remote/invader-core-blocker.test.ts）从本模块导入。
 */
export { roomHasInvaderCore };

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
      } else {
        // 在岗站桩 → 锚定 + 静态占位自报：reserver 常驻 controller 旁，
        // 若站到 source 相邻矿位，不登记则采集者的寻路矩阵看不见它，
        // 缓存路径反复指向该格、意图逐 tick 被拒绝 → 采集者锁死空转
        // （线上实证：W36S58 北源采集者被 reserver 占住矿位）。
        // anchorStation(60)：工作/站桩同档，仅 flee(100) 可推挤。
        registerAnchor(ac.creep, CONFIG.movement.trafficPriority.anchorStation);
        registerStaticBlocker(ac.creep.room.name, ac.creep.pos);
      }
      if (result === ERR_INVALID_TARGET) {
        // controller 被其他玩家/Invader 预定 → reserveController 返回 ERR_INVALID_TARGET →
        // attackController 降低其预定期。attackController 有 1000 tick cooldown（cooldown 中
        // 返回 ERR_TIRED），每次成功攻击降低 1 tick reservation — 缓慢但持续消耗敌方预定。
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
