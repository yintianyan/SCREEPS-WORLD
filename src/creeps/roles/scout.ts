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
};

export const scoutRole = defineRole("scout", 3 as Priority, policy);
