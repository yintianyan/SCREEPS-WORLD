/** Event-driven Replan */

import type { OperationContext, OperationPriority } from "./agenda-item";
import { isActive } from "./agenda-item";
import { markCancelled, markBlocked, TransitionResult } from "./lifecycle";

/** 重规划事件类型。 */
export type ReplanEvent =
  | { type: "room-lost"; roomName: string }
  | { type: "room-critical"; roomName: string }
  | { type: "room-recovered"; roomName: string }
  | { type: "carrier-death"; operationId: string; creepName: string }
  | { type: "resource-loss"; sourceRoom: string; lostAmount: number }
  | { type: "target-satisfied"; targetRoom: string };

/**
 * 处理重规划事件 — 返回需要更新的 Operation 列表。

 * 纯函数 — 不修改原数组，返回新数组（含状态变更后的 Operation）。
 */
export function processReplanEvent(
  operations: readonly OperationContext[],
  event: ReplanEvent,
  tick: number,
): OperationContext[] {
  switch (event.type) {
    case "room-lost":
      return handleRoomLost(operations, event.roomName, tick);

    case "room-critical":
      return handleRoomCritical(operations, event.roomName, tick);

    case "room-recovered":
      // Room recovered — 不自动创建 Operation，只标记需要重规划
      // 实际重规划由 Agenda Manager 下一个 planning cycle 执行
      return [...operations];

    case "carrier-death":
      return handleCarrierDeath(operations, event.operationId, tick);

    case "resource-loss":
      return handleResourceLoss(operations, event.sourceRoom, event.lostAmount, tick);

    case "target-satisfied":
      return handleTargetSatisfied(operations, event.targetRoom, tick);

    default:
      return [...operations];
  }
}

/** 房间失守 → 取消所有涉及该房的活跃 Operation。 */
function handleRoomLost(
  operations: readonly OperationContext[],
  roomName: string,
  tick: number,
): OperationContext[] {
  return operations.map(op => {
    if (!isActive(op)) return op;
    if (op.sourceRoom === roomName || op.targetRoom === roomName) {
      const result = markCancelled(op, tick, `room lost: ${roomName}`);
      return result.op;
    }
    return op;
  });
}

/** 房间进入 Critical → 取消以该房为 source 的 Operation。 */
function handleRoomCritical(
  operations: readonly OperationContext[],
  roomName: string,
  tick: number,
): OperationContext[] {
  return operations.map(op => {
    if (!isActive(op)) return op;
    if (op.sourceRoom === roomName) {
      const result = markCancelled(op, tick, `source critical: ${roomName}`);
      return result.op;
    }
    // target 进入 critical 不取消 — 反而更紧急，优先调度
    return op;
  });
}

/** Carrier 死亡 → 标记 Operation blocked（触发重试）。 */
function handleCarrierDeath(
  operations: readonly OperationContext[],
  operationId: string,
  tick: number,
): OperationContext[] {
  return operations.map(op => {
    if (!isActive(op)) return op;
    if (op.id === operationId && op.status === "running") {
      const result = markBlocked(op, tick, `carrier death`);
      return result.op;
    }
    return op;
  });
}

/** 源房资源不足 → 降级或取消相关 Operation。 */
function handleResourceLoss(
  operations: readonly OperationContext[],
  sourceRoom: string,
  lostAmount: number,
  tick: number,
): OperationContext[] {
  return operations.map(op => {
    if (!isActive(op)) return op;
    if (op.sourceRoom === sourceRoom && op.status === "running") {
      // 如果损失量大（> 预留量），标记 blocked
      if (lostAmount > op.reservedAmount) {
        const result = markBlocked(op, tick, `resource loss: ${lostAmount}`);
        return result.op;
      }
    }
    return op;
  });
}

/** 目标房已满足需求 → 取消向该房的 Operation。 */
function handleTargetSatisfied(
  operations: readonly OperationContext[],
  targetRoom: string,
  tick: number,
): OperationContext[] {
  return operations.map(op => {
    if (!isActive(op)) return op;
    if (op.targetRoom === targetRoom) {
      const result = markCancelled(op, tick, `target satisfied: ${targetRoom}`);
      return result.op;
    }
    return op;
  });
}

/**
 * 判断是否应该触发重规划（批量事件处理后）。
 * 当有 Operation 被取消或 blocked 时，下一个 planning cycle 应该重新评估。
 */
export function shouldReplan(
  operations: readonly OperationContext[],
  prevOperations: readonly OperationContext[],
): boolean {
  if (operations.length !== prevOperations.length) return true;
  for (let i = 0; i < operations.length; i++) {
    if (operations[i]!.status !== prevOperations[i]!.status) return true;
  }
  return false;
}
