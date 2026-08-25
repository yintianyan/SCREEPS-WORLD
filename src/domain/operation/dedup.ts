/**
 * Operation Dedup — A3.0 操作幂等去重
 *（PLANNING_ARCHITECTURE §3 AgendaItem 幂等键去重）。
 *
 * 幂等键 = "supply:${from}:${to}:${resource}"
 * 同一对 (from, to, resource) 只允许一个活跃 Operation。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { OperationContext, ResourceType } from "./agenda-item";
import { isActive, makeOperationId } from "./agenda-item";

/**
 * 检查是否已存在同 key 的活跃 Operation。
 */
export function hasActiveOperation(
  operations: readonly OperationContext[],
  sourceRoom: string,
  targetRoom: string,
  resource: ResourceType = "energy",
): boolean {
  const id = makeOperationId(sourceRoom, targetRoom, resource);
  return operations.some(op => op.id === id && isActive(op));
}

/**
 * 获取同 key 的活跃 Operation（不存在返回 undefined）。
 */
export function findActiveOperation(
  operations: readonly OperationContext[],
  sourceRoom: string,
  targetRoom: string,
  resource: ResourceType = "energy",
): OperationContext | undefined {
  const id = makeOperationId(sourceRoom, targetRoom, resource);
  return operations.find(op => op.id === id && isActive(op));
}

/**
 * 过滤出所有活跃操作（非终态）。
 */
export function filterActive(
  operations: readonly OperationContext[],
): OperationContext[] {
  return operations.filter(isActive);
}

/**
 * 过滤出所有终态操作（可归档删除）。
 */
export function filterTerminal(
  operations: readonly OperationContext[],
): OperationContext[] {
  return operations.filter(op => !isActive(op));
}

/**
 * 清理终态操作 — 返回仅含活跃操作的新数组。
 * 归档由调用方在清理前记录（AgendaOutcome 事件）。
 */
export function pruneTerminal(
  operations: readonly OperationContext[],
): OperationContext[] {
  return filterActive(operations);
}

/**
 * 统计各状态的 Operation 数量。
 */
export function countByStatus(
  operations: readonly OperationContext[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const op of operations) {
    counts[op.status] = (counts[op.status] ?? 0) + 1;
  }
  return counts;
}
