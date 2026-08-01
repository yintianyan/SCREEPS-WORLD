/**
 * 结构缺口审计器 — 目标清单驱动的布局闭环核心（2026-08-01）。
 *
 * 期望 = expectedStructureCounts(rcl)（单一真相源 = CONTROLLER_STRUCTURES）；
 * 已有 = 已建结构 + 在建 site + 队列任务（queued/blocked，与
 * computeCommittedCounts 同口径）。缺口 > 0 即真实需求：
 *   - layout-planner 用它触发规划（不再只依赖 nextPlanTick 周期）
 *   - 缺口写入 Memory.kernel.layoutGaps（可观测，替代控制台告警）
 *   - placement 放不下时缺口持续存在 → 慢速重试 + 人工介入信号
 *
 * 纯函数 — 不访问 Game/Memory。
 */
import type { RoomSnapshot } from "../../kernel/contracts";
import { expectedStructureCounts } from "./constraint-placer";

/** 结构缺口：type → 还缺多少个（> 0 才收录）。 */
export type StructureGaps = Record<string, number>;

export function auditStructureGaps(
  snapshot: RoomSnapshot,
  queue: readonly BuildTask[],
): StructureGaps {
  const expected = expectedStructureCounts(snapshot.rcl);
  const have = new Map<string, number>();
  const add = (type: string): void => {
    have.set(type, (have.get(type) ?? 0) + 1);
  };
  for (const s of snapshot.spawns) add(s.structureType);
  for (const s of snapshot.extensions) add(s.structureType);
  for (const s of snapshot.towers) add(s.structureType);
  for (const s of snapshot.labs) add(s.structureType);
  if (snapshot.storage) add(snapshot.storage.structureType);
  if (snapshot.terminal) add(snapshot.terminal.structureType);
  if (snapshot.factory) add(snapshot.factory.structureType);
  if (snapshot.observer) add(snapshot.observer.structureType);
  if (snapshot.powerSpawn) add(snapshot.powerSpawn.structureType);
  for (const site of snapshot.myConstructionSites) add(site.structureType);
  for (const task of queue) {
    if (task.state === "queued" || task.state === "blocked") add(task.structureType);
  }

  const gaps: StructureGaps = {};
  for (const [type, target] of Object.entries(expected)) {
    const gap = target - (have.get(type) ?? 0);
    if (gap > 0) gaps[type] = gap;
  }
  return gaps;
}
