import { CONFIG } from "../../config";
import type { TickContext } from "../../kernel/contracts";
import { chooseTaskForRole, validateAssignmentRules } from "../../domain/assignment/service";
import type { TaskPool } from "../../domain/assignment/task-pool";
import { globalCache } from "../../kernel/global-cache";
import { recordEvent, EventKind } from "../../kernel/event-log";
import { getObjectById } from "./obj-cache";

// ──────────────────────────────────────────────
// 适配层 — 从 Game/Memory/creep 读取数据，调用纯函数，写回状态
// ──────────────────────────────────────────────

/** 获取当前 tick 的 TaskPool，不存在或过期时返回 undefined。 */
function getPool(ctx?: TickContext): TaskPool | undefined {
  const g = globalCache();
  if (!g.assignment) return undefined;
  const tick = ctx?.tick ?? Game.time;
  if (g.assignment.tick !== tick) return undefined;
  return g.assignment.pool;
}

/**
 * 适配：释放 creep 的当前任务分配。
 * 通过 TaskPool 的 O(1) 索引查找任务，移除 creep 名字。
 */
export function releaseFromTask(creep: Creep): void {
  const assignment = creep.memory.assignment;
  if (!assignment) return;

  const pool = getPool();
  if (!pool) return;

  pool.releaseCreep(assignment.id, creep.name);
}

/**
 * 适配：获取或续约 creep 的任务分配（plan §5.7.2）。
 *
 * 从 creep.memory 读取现有 assignment，通过 Game.getObjectById 验证
 * target/source 存在性，从 Memory 读取 layout.revision，
 * 调用纯函数 validateAssignmentRules 判断有效性。
 * 有效则续约 lease；无效则释放并调用纯函数 chooseTaskForRole 选择新任务。
 *
 * 无可用任务时返回 undefined — 角色应进入 idle 或回退行为。
 */
function requestAssignment(creep: Creep, ctx: TickContext): CreepAssignment | undefined {
  // 1. 验证现有 assignment。
  if (creep.memory.assignment) {
    const home = creep.memory.home ?? creep.room?.name ?? "";
    const layoutRevision = Memory.rooms[home]?.layout?.revision ?? 0;
    const assignment = creep.memory.assignment;

    // 通过缓存版 getObjectById 检查 target/source 存在性（P2-6 去重）。
    const targetExists = !assignment.targetId || getObjectById(assignment.targetId) !== null;
    const sourceExists = !assignment.sourceId || getObjectById(assignment.sourceId) !== null;

    if (validateAssignmentRules(assignment, ctx.tick, layoutRevision, targetExists, sourceExists)) {
      assignment.leaseUntil = ctx.tick + CONFIG.assignment.leaseDuration;
      return assignment;
    }

    // 无效 — 确定失效原因并记录事件。
    // failReasonCode: 0=lease 过期 1=revision 变化 2=target 消失 3=source 消失
    let failReason = 0;
    if (ctx.tick > assignment.leaseUntil) failReason = 0;
    else if (assignment.revision !== layoutRevision) failReason = 1;
    else if (assignment.targetId && !targetExists) failReason = 2;
    else if (assignment.sourceId && !sourceExists) failReason = 3;
    recordEvent(EventKind.AssignmentExpired, home, [failReason]);

    // 无效 — 释放旧 assignment。
    releaseFromTask(creep);
    creep.memory.assignment = undefined;
  }

  // 2. 从预排序列表中选择新任务。
  const pool = getPool(ctx);
  if (!pool) return undefined;

  const home = creep.memory.home ?? creep.room?.name ?? "";
  const roomTasks = pool.getRoomTasks(home);
  if (!roomTasks) return undefined;

  const role = creep.memory.role ?? "unknown";
  const chosen = chooseTaskForRole(role, roomTasks, { x: creep.pos.x, y: creep.pos.y });
  if (!chosen) return undefined;

  const layoutRevision = Memory.rooms[home]?.layout?.revision ?? 0;
  const assignment: CreepAssignment = {
    id: chosen.id,
    kind: chosen.kind as CreepAssignment["kind"],
    targetId: chosen.targetId as Id<_HasId> | undefined,
    sourceId: chosen.sourceId as Id<Source> | undefined,
    revision: layoutRevision,
    assignedAt: ctx.tick,
    leaseUntil: ctx.tick + CONFIG.assignment.leaseDuration,
  };

  creep.memory.assignment = assignment;
  pool.assignCreep(chosen.id, creep.name);
  recordEvent(EventKind.AssignmentAssigned, home, [chosen.priority]);
  return assignment;
}

/**
 * 获取或续约 creep 的任务分配（plan §5.7.2）。
 * 如果现有 assignment 有效则续约；否则从可用任务列表分配新的。
 * 无可用任务时返回 undefined — 角色应进入 idle 或回退行为。
 */
export function getAssignment(creep: Creep, ctx: TickContext): CreepAssignment | undefined {
  return requestAssignment(creep, ctx);
}

/** 释放 creep 的当前任务分配。 */
export function releaseAssignment(creep: Creep): void {
  releaseFromTask(creep);
  creep.memory.assignment = undefined;
}
