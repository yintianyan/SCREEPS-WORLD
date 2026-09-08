/** Scout — 侦察单位，到达目标房后标记自回收。
 *
 * 情报采集由 room-observer 的 captureScoutVision 通过正规通道（intelHandoff →
 * intelligence system）完成，scout 本身不直写 Memory.rooms。scout body 只有
 * [MOVE]（50 能量），无战斗能力 — 到达即回收是正确生命周期。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";

/**
 * 到达目标房后标记自回收。
 * 情报采集（sources/owner/towers/walls 等）由 room-observer.captureScoutVision
 * 通过 collectRoomVision → scanNeighborIntel → submitObservation(intelHandoff)
 * 正规通道完成，本 action 不直写 Memory。
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
