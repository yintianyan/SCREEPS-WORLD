/**
 * Scout — P3 一次性侦察兵（R6b 主动情报）。
 * 使命：走到 remoteTarget（prospect-manager 指定的扩张候选房）站一 tick 提供视野 —
 * room-observer 的 captureScoutVision 随即把 sources/owner/towers 写入 intel，
 * 扩张评估器获得决策就绪情报。任务成功/失败由 prospect-manager 判定并标记回收。
 * 无任何主动作候选：ensureHome 导航到目标房后站定（不 park — 目标房非己方，
 * 己方快照的停靠数据不适用于他房）；非战斗角色，过境/目标房遇袭自动 fleeToHome。
 * body [MOVE]：50 能量可抛弃、无疲劳全速。
 */
import type { Priority } from "../../kernel/contracts";
import type { RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";

const policy: RolePolicy = {
  acquire: [],
  work: [],
  // recon push-through：钻进敌方过境房（如 Aguia 的 W38S58）时不 flee 回 home，
  // 继续向 remoteTarget 推进（配合 memory.avoidRooms 绕行，仅在被 hostile 包围无路可绕时硬钻）。
  // 否则一次性便宜 scout（[MOVE] 50 能量）遇袭即弃任务，recon 永不完成 → 占领链卡死。
  pushThrough: true,
};

export const scoutRole = defineRole("scout", 3 as Priority, policy);
