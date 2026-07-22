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
import { computeMinCutDefense } from "../domain/layout/min-cut-defense";

/**
 * 防御规划器 — P3 独立系统，负责生成 rampart/wall 建造任务。
 *
 * 策略（Phase 5 升级）：
 *   1. 优先使用 min-cut 算法：用最少 rampart 封锁所有入侵路径
 *   2. Min-cut 失败（割集过大/地形太开放）时 fallback 到扇区防御
 *
 * 触发：interval 10（每 10 tick 评估一次）。
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

/** Min-cut 最大 rampart 数（超过则 fallback 到扇区）。 */
const MAX_CUT_RAMPARTS = 30;

function planDefense(
  snapshot: import("../kernel/contracts").RoomSnapshot,
): void {
  if (snapshot.rcl < 4) return;

  const room = Game.rooms[snapshot.roomName];
  if (!room) return;

  const roomMem = Memory.rooms[snapshot.roomName];
  if (!roomMem) return;

  const queue = roomMem.buildQueue ?? [];
  const existingKeys = new Set<string>();
  for (const t of queue) existingKeys.add(t.key);

  // 采集出口位置。
  const exitPositions = room.find(FIND_EXIT).map(p => ({ x: p.x, y: p.y }));

  // 核心区域格（要保护的结构）。
  const corePositions: { x: number; y: number }[] = [];
  for (const s of snapshot.spawns) corePositions.push({ x: s.pos.x, y: s.pos.y });
  for (const s of snapshot.extensions) corePositions.push({ x: s.pos.x, y: s.pos.y });
  if (snapshot.storage) corePositions.push({ x: snapshot.storage.pos.x, y: snapshot.storage.pos.y });
  for (const s of snapshot.towers) corePositions.push({ x: s.pos.x, y: s.pos.y });

  let added = false;

  // ── 策略 1：Min-Cut（最少 rampart 完全封锁）──
  if (corePositions.length > 0 && exitPositions.length > 0) {
    const terrain = room.getTerrain();
    const getTerrain = (x: number, y: number): boolean => terrain.get(x, y) === TERRAIN_MASK_WALL;
    const cutResult = computeMinCutDefense(getTerrain, corePositions, exitPositions, MAX_CUT_RAMPARTS);

    if (cutResult.complete) {
      // Min-cut 成功：使用割集位置生成 rampart 任务。
      for (let i = 0; i < cutResult.rampartPositions.length; i++) {
        const pos = cutResult.rampartPositions[i]!;
        const key = `defense.mincut.${pos.x}.${pos.y}`;
        if (existingKeys.has(key)) continue;
        queue.push({
          key,
          pos: { x: pos.x, y: pos.y, roomName: snapshot.roomName },
          structureType: STRUCTURE_RAMPART,
          priority: 2,
          state: "queued",
          attempts: 0,
          retryAt: 0,
        });
        existingKeys.add(key);
        added = true;
      }
      if (added) { roomMem.buildQueue = queue; }
      return; // min-cut 成功，不需要 fallback
    }
  }

  // ── 策略 2：扇区防御（fallback）──
  const minerals = snapshot.minerals as readonly { pos: { x: number; y: number } }[];
  const occupiedSet = buildOccupiedPositionSet(snapshot, minerals);
  const validationOptions: ValidationOptions = {
    completedKeys: collectCompletedKeys(queue),
    globalSiteCount: 0,
    maxGlobalSites: CONFIG.construction.maxGlobalSites,
    minerals,
    structureCounts: precomputeStructureCounts(snapshot),
    occupiedSet,
    obstacleSet: buildObstaclePositionSet(snapshot),
  };

  const defenseCandidates = createDefenseTasks(
    snapshot,
    exitPositions,
    room,
    validationOptions,
  );

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
