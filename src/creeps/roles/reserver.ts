/** Reserver */
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
    resolve: ac => {
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
        // attackController 有 cooldown — 成功时返回 OK 并触发 1000 tick cooldown。
        // ERR_TIRED = cooldown 中，下次 attackController 前不应盲试。
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
        // F16 修复：缓存 attackController cooldown — 不在 cooldown 中每 tick 盲试。
        // controller 被其他玩家/Invader 预定 → reserveController 返回 ERR_INVALID_TARGET。
        // attackController 降低其预定期，但有 1000 tick cooldown（cooldown 中返回 ERR_TIRED）。
        // 无 cooldown 缓存时每 tick 盲调 → ERR_TIRED 浪费 CPU。
        const cooldownEnd = ac.creep.memory.attackCooldownEnd ?? 0;
        if (Game.time < cooldownEnd) return; // cooldown 未结束，跳过

        const attackResult = ac.creep.attackController(controller);
        if (attackResult === ERR_NOT_IN_RANGE) {
          moveToTarget(ac.creep, controller);
        } else if (attackResult === OK) {
          // 成功攻击 — 记录 cooldown 截止 tick（attackController cooldown = 1000）。
          ac.creep.memory.attackCooldownEnd = Game.time + 1000;
        }
        // ERR_TIRED = cooldown 仍存在（可能被其他 creep 触发），更新 cooldown 估算。
        // ERR_INVALID_TARGET = controller 无主或己方，无需攻击。
      }
    },
  };
}

const policy: RolePolicy = {
  // reserver 是远矿基础设施的关键角色 — 不消耗能量（CLAIM 只 reserve/attack
  // controller）、不占 spawn 队列（已孵化）、CPU 开销极低。但它的优先级是 P2，
  // 当 home 房处于 recovery/bootstrap 时会被 colonyStateFreezesRole 冻结。
  // 冻结 reserver → 远矿房 reservation 过期 → source 被别人抢占 → 远矿产能归零，
  // 与 recovery 的目标（恢复经济）背道而驰。因此声明 recoveryEligible 豁免。
  recoveryEligible: true,
  acquire: [reserveControllerAction()],
  work: [
    // 与 acquire 相同 — 无 CARRY 部件，mode 振荡不影响行为。
    reserveControllerAction(),
  ],
};

export const reserverRole = defineRole("reserver", 2 as Priority, policy);
