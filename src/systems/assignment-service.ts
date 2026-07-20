import type { Priority, System, TickContext } from "../kernel/contracts";
import {
  initAssignment,
  generateRoomTasks,
  invalidateAssignments,
} from "../domain/assignment/service";
import { CONFIG } from "../config";

/**
 * 任务分配服务 — P1 系统，在所有角色之前运行。
 *
 * 职责（plan §5.7.2）：
 *   - 为每房生成本 tick 可用任务列表
 *   - source 槽位显式化（每 source 的 maxWorkers）
 *   - 物流任务确定性化（haul/fill 任务）
 *   - 建造任务带 maxWorkers 与 lease
 *   - 紧急抢占由系统完成（P0 fill / flee 使普通 assignment 失效）
 *
 * 数据流：
 *   1. 每 tick 初始化 global.assignment 缓存
 *   2. 检测紧急状态（能量不足或敌对威胁）— 触发抢占
 *   3. 为每房生成任务列表存入缓存
 *   4. 角色通过 requestAssignment 获取或续约任务
 *
 * 优先级：P1 — 失败时角色回退到无 assignment 行为，允许 safeRun 冷却避免刷屏。
 */
export const assignmentServiceSystem: System = {
  name: "assignment-service",
  priority: 1 as Priority,
  run(ctx: TickContext): void {
    initAssignment(ctx.tick);
    for (const snapshot of ctx.snapshots()) {
      // 紧急抢占（plan §5.7.2 规则 5）：能量低于 fill 阈值或有敌对单位时，
      // 释放 priority >= 1 的普通任务，强制 creep 重新请求 P0 fill 或进入 flee。
      // 必须在 generateRoomTasks 之前执行，确保本 tick 任务列表反映抢占后状态。
      if (isEmergencyState(snapshot)) {
        invalidateAssignments(snapshot.roomName, 1);
      }
      generateRoomTasks(snapshot, ctx);
    }
  },
};

/**
 * 判断房间是否处于紧急状态需要触发任务抢占。
 * 紧急条件（任一满足）：
 *   - 能量低于动态 fill 阈值 — 需要所有非关键 creep 转为 fill
 *   - 有敌对 creep — 非战斗 creep 应进入 flee
 *
 * 动态阈值：取 energyCapacityAvailable 的 40% 和固定上限的较小值。
 * 修复：原固定 300 阈值在 RCL1（容量 300）下永久触发紧急状态，
 * 导致 assignment 每 tick 被清空重建，creep 无法稳定工作。
 */
function isEmergencyState(snapshot: import("../kernel/contracts").RoomSnapshot): boolean {
  const dynamicThreshold = Math.min(
    Math.floor(snapshot.energyCapacityAvailable * 0.4),
    CONFIG.assignment.emergencyFillThreshold,
  );
  if (snapshot.energyAvailable < dynamicThreshold) return true;
  if (snapshot.hostileCreeps.length > 0) return true;
  return false;
}
