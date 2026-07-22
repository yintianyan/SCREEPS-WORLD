import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import {
  createDefenseTasks,
  candidateToBuildTask,
} from "../domain/layout/task-factory";
import {
  buildOccupiedPositionSet,
  buildObstaclePositionSet,
  precomputeStructureCounts,
  collectCompletedKeys,
  type ValidationOptions,
} from "../domain/layout/validation";

/**
 * 防御规划器 — P3 独立系统，负责生成 rampart/wall 建造任务。
 *
 * 提取自 layout-planner.ts（Phase 2 重构）。独立为系统的原因：
 *   1. 防御规划与核心布局无数据依赖（不需要蓝图/锚点）
 *   2. 未来升级为 min-cut 算法时，计算量更大，需要独立 CPU 预算
 *   3. 防御响应频率应独立于布局规划周期（布局 50 tick，防御 10 tick）
 *
 * 行为：
 *   - RCL4+ 才生成防御工事
 *   - 每周期最多 1 条 rampart 线（3 个 rampart）
 *   - 与 buildQueue 已有 key 去重
 *   - 出口方向感知的扇区防御（未来升级为 min-cut）
 *
 * 触发：interval 10（每 10 tick 评估一次）。
 * createDefenseTasks 内部有 RCL 门禁 + maxRamparts 上限检查，
 * 高频调用不会产生多余任务。
 */
export const defensePlannerSystem: System = {
  name: "defense-planner",
  priority: 3 as Priority,
  interval: 10,

  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      planDefense(snapshot);
    }
  },
};

function planDefense(
  snapshot: import("../kernel/contracts").RoomSnapshot,
): void {
    // RCL4+ 门禁（createDefenseTasks 内部也有，这里提前短路避免 room.find 开销）。
    if (snapshot.rcl < 4) return;

    const room = Game.rooms[snapshot.roomName];
    if (!room) return;

    const roomMem = Memory.rooms[snapshot.roomName];
    if (!roomMem) return;

    const queue = roomMem.buildQueue ?? [];

    // 构建最小 ValidationOptions（createDefenseTasks 只用 occupiedSet）。
    const minerals = snapshot.minerals as readonly { pos: { x: number; y: number } }[];
    const occupiedSet = buildOccupiedPositionSet(snapshot, minerals);
    const validationOptions: ValidationOptions = {
      completedKeys: collectCompletedKeys(queue),
      globalSiteCount: 0, // createDefenseTasks 不检查 site-limit
      maxGlobalSites: CONFIG.construction.maxGlobalSites,
      minerals,
      structureCounts: precomputeStructureCounts(snapshot),
      occupiedSet,
      obstacleSet: buildObstaclePositionSet(snapshot),
    };

    // 采集出口位置（唯一需要 room.find 的操作）。
    const exitPositions = room.find(FIND_EXIT).map(p => ({ x: p.x, y: p.y }));

    // 生成防御候选。
    const defenseCandidates = createDefenseTasks(
      snapshot,
      exitPositions,
      room,
      validationOptions,
    );

    // 去重入队。
    const existingKeys = new Set<string>();
    for (const t of queue) existingKeys.add(t.key);

    let added = false;
    for (const candidate of defenseCandidates) {
      if (existingKeys.has(candidate.key)) continue;
      queue.push(candidateToBuildTask(candidate));
      existingKeys.add(candidate.key);
      added = true;
    }

    if (added) {
      roomMem.buildQueue = queue;
    }
}
