/**
 * FlowPlan → deliver 任务的纯函数映射（Phase 1）。
 *
 * 任务只表达「源 → 汇组」的租约；具体结构在角色执行时解析。
 * assignedCreeps 由 assignment-service 每 tick 从 creep memory 回填。
 */
import type { AssignmentTaskEntry } from "./service";
import type { FlowLane, RoomFlowPlan } from "../logistics/flow-types";

export interface FlowDeliverContext {
  readonly roomName: string;
  readonly lane: FlowLane;
  readonly priority: number;
  /** 只处理该 groupId 的分配；缺省 = 全部（Phase 0 测试兼容）。 */
  readonly groupId?: string;
  /** link 中转：承运人从哪取（storage）与灌到哪（storage link）。 */
  readonly linkFeederSourceId?: string;
  readonly linkFeederTargetId?: string;
  readonly linkFeederPos?: { readonly x: number; readonly y: number };
  /** creep 直达：承运人从哪取（storage）与送到哪（cc/controller link）。 */
  readonly creepSourceId?: string;
  readonly creepTargetId?: string;
  /** Phase 2：汇组目标（如 core），执行时解析最近的可用结构。 */
  readonly creepTargetGroup?: string;
  readonly creepTargetPos?: { readonly x: number; readonly y: number };
}

export function flowDeliverTaskId(
  roomName: string,
  lane: FlowLane,
  groupId: string,
  via: "link" | "creep",
): string {
  return `deliver:${roomName}:${lane}:${groupId}:${via}`;
}

/**
 * 把一次房间流量计划映射为 deliver 任务。
 *
 * 只生成当前 context 支持的两类：
 * - link：storage → storage link（由 link-system 继续送 controller link）；
 * - creep：storage → controller container / controller link。
 */
export function buildFlowDeliverTasks(
  plan: RoomFlowPlan,
  ctx: FlowDeliverContext,
): AssignmentTaskEntry[] {
  const tasks: AssignmentTaskEntry[] = [];
  for (const alloc of plan.allocations) {
    if (alloc.carriersNeeded <= 0) continue;
    if (ctx.groupId !== undefined && alloc.groupId !== ctx.groupId) continue;
    if (alloc.via === "link") {
      if (!ctx.linkFeederSourceId || !ctx.linkFeederTargetId) continue;
      tasks.push({
        id: flowDeliverTaskId(ctx.roomName, ctx.lane, alloc.groupId, "link"),
        kind: "deliver",
        sourceId: ctx.linkFeederSourceId,
        targetId: ctx.linkFeederTargetId,
        priority: ctx.priority,
        maxWorkers: alloc.carriersNeeded,
        assignedCreeps: [],
        pos: ctx.linkFeederPos,
      });
    } else {
      if (
        !ctx.creepSourceId ||
        (ctx.creepTargetId === undefined && ctx.creepTargetGroup === undefined)
      ) {
        continue;
      }
      tasks.push({
        id: flowDeliverTaskId(ctx.roomName, ctx.lane, alloc.groupId, "creep"),
        kind: "deliver",
        sourceId: ctx.creepSourceId,
        targetId: ctx.creepTargetId,
        targetGroup: ctx.creepTargetGroup,
        priority: ctx.priority,
        maxWorkers: alloc.carriersNeeded,
        assignedCreeps: [],
        pos: ctx.creepTargetPos,
      });
    }
  }
  return tasks;
}
