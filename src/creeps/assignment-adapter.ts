import { CONFIG } from "../config";
import type { TickContext } from "../kernel/contracts";
import { chooseTaskForRole, validateAssignmentRules, removeCreepFromTask } from "../domain/assignment/service";
import { globalCache } from "../kernel/global-cache";

// ──────────────────────────────────────────────
// 适配层 — 从 Game/Memory/creep 读取数据，调用纯函数，写回状态
// ──────────────────────────────────────────────

/**
 * 适配：释放 creep 的当前任务分配。
 * 从 creep.memory 读取 assignment，在 globalCache 中找到对应任务列表，
 * 调用纯函数 removeCreepFromTask 移除 creep 名字。
 */
export function releaseFromTask(creep: Creep): void {
  const assignment = creep.memory.assignment;
  if (!assignment) return;

  const g = globalCache();
  if (!g.assignment) return;

  const home = creep.memory.home ?? creep.room?.name ?? "";
  const roomTasks = g.assignment.roomTasks.get(home);
  if (!roomTasks) return;

  removeCreepFromTask(roomTasks, assignment.id, creep.name);
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

    // 通过 Game.getObjectById 检查 target/source 存在性。
    const targetExists = !assignment.targetId || Game.getObjectById(assignment.targetId) !== null;
    const sourceExists = !assignment.sourceId || Game.getObjectById(assignment.sourceId) !== null;

    if (validateAssignmentRules(assignment, ctx.tick, layoutRevision, targetExists, sourceExists)) {
      assignment.leaseUntil = ctx.tick + CONFIG.assignment.leaseDuration;
      return assignment;
    }

    // 无效 — 释放旧 assignment。
    releaseFromTask(creep);
    creep.memory.assignment = undefined;
  }

  // 2. 从预排序列表中选择新任务。
  const g = globalCache();
  if (!g.assignment || g.assignment.tick !== ctx.tick) return undefined;

  const home = creep.memory.home ?? creep.room?.name ?? "";
  const roomTasks = g.assignment.roomTasks.get(home);
  if (!roomTasks) return undefined;

  const role = creep.memory.role ?? "unknown";
  const chosen = chooseTaskForRole(role, roomTasks);
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
  chosen.assignedCreeps.push(creep.name);
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
