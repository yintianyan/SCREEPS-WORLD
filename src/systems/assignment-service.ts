import type { Priority, System, TickContext, RoomSnapshot, ColonyState } from "../kernel/contracts";
import {
  buildRoomTasks,
  type CreepAssignmentRef,
  type RoomTaskFlags,
} from "../domain/assignment/service";
import { TaskPool } from "../domain/assignment/task-pool";
import { globalCache } from "../kernel/global-cache";
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
 *   4. 角色通过 helpers.getAssignment 获取或续约任务
 *
 * 架构：领域层 buildRoomTasks / getInvalidatedCreepNames 是纯函数，
 * 本模块（系统层）负责从 Game/Memory 收集数据、调用纯函数、写回缓存。
 *
 * 优先级：P1 — 失败时角色回退到无 assignment 行为，允许 safeRun 冷却避免刷屏。
 */
export const assignmentServiceSystem: System = {
  name: "assignment-service",
  priority: 1 as Priority,
  run(ctx: TickContext): void {
    const pool = initAssignmentCache(ctx.tick);
    for (const snapshot of ctx.snapshots()) {
      // 紧急抢占（plan §5.7.2 规则 5）：能量低于 fill 阈值或有敌对单位时，
      // 释放 priority >= 1 的普通任务，强制 creep 重新请求 P0 fill 或进入 flee。
      // 必须在 generateRoomTasks 之前执行，确保本 tick 任务列表反映抢占后状态。
      if (isEmergencyState(snapshot)) {
        invalidateAssignments(pool, snapshot.roomName, 1);
      }
      generateRoomTasks(pool, snapshot, ctx);
    }
  },
};

// ──────────────────────────────────────────────
// 适配层 — 从 Game/Memory 收集数据，调用纯函数，写回缓存
// ──────────────────────────────────────────────

/**
 * 初始化 assignment 缓存（每 tick 开头调用）。
 * 缓存操作在适配层完成 — 领域层不访问 globalCache。
 */
function initAssignmentCache(tick: number): TaskPool {
  const pool = new TaskPool();
  pool.init(tick);
  const g = globalCache();
  g.assignment = { tick, pool };
  return pool;
}

/**
 * 适配：为房间生成任务列表并写入 TaskPool。
 * 从 Game.creeps 收集 creep 分配摘要，从 Memory 读取房间标志位，
 * 调用纯函数 buildRoomTasks 后将结果存入任务池。
 */
function generateRoomTasks(pool: TaskPool, snapshot: RoomSnapshot, ctx: TickContext): void {
  if (pool.tick !== ctx.tick) return;

  const roomName = snapshot.roomName;
  const roomMem = Memory.rooms[roomName];

  // 从 Game.creeps 收集 creep 分配摘要。
  const creepRefs: CreepAssignmentRef[] = [];
  for (const creep of Object.values(Game.creeps)) {
    const home = creep.memory.home ?? creep.room?.name;
    if (!home) continue;
    const a = creep.memory.assignment;
    creepRefs.push({
      name: creep.name,
      home,
      assignment: a
        ? {
            id: a.id,
            kind: a.kind,
            sourceId: a.sourceId ? (a.sourceId as string) : undefined,
          }
        : undefined,
    });
  }

  const flags: RoomTaskFlags = {
    colonyState: (roomMem?.colonyState ?? "normal") as ColonyState,
    controllerDowngradeRisk: roomMem?.controllerDowngradeRisk === true,
  };

  const tasks = buildRoomTasks(snapshot, creepRefs, flags);
  pool.setRoomTasks(roomName, tasks);
}

/**
 * 适配：失效指定房间内 priority >= minPriority 的所有任务。
 * 使用 TaskPool.invalidate() 单次遍历收集 creep 名并清空 assignedCreeps，
 * 然后清除这些 creep 的 memory.assignment。
 */
function invalidateAssignments(pool: TaskPool, roomName: string, minPriority: number): void {
  const creepNames = pool.invalidate(roomName, minPriority);

  // 清除 creep memory 中的 assignment。
  for (const name of creepNames) {
    const creep = Game.creeps[name];
    if (creep) {
      creep.memory.assignment = undefined;
    }
  }
}

// ──────────────────────────────────────────────
// 纯判断函数
// ──────────────────────────────────────────────

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
function isEmergencyState(snapshot: RoomSnapshot): boolean {
  const dynamicThreshold = Math.min(
    Math.floor(snapshot.energyCapacityAvailable * 0.4),
    CONFIG.assignment.emergencyFillThreshold,
  );
  if (snapshot.energyAvailable < dynamicThreshold) return true;
  if (snapshot.hostileCreeps.length > 0) return true;
  return false;
}
