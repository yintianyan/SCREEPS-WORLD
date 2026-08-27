/**
 * 布局规划纯函数层（D2 归位：从 systems/layout-planner.ts 提取）。
 *
 * 本文件承载从系统侧提取的布局规划纯计算逻辑——不触 Game/Memory/RawMemory
 * （lint 红线）。系统侧 `src/systems/layout-planner.ts` 只保留：
 * ① System 注册 + planRoom 入口；② Game API 调用（getTerrain/find 等）；
 * ③ Memory 读写（layout state / buildQueue）；④ globalCache 中间产物管理。
 *
 * 归位遵循 ENGINEERING_BLUEPRINT §5 #3：布局纯函数归 domain/layout/，
 * 系统侧只留队列推进与 site 签发。
 */

import type { BuildTaskCandidate } from "./task-factory";
import { candidateToBuildTask } from "./task-factory";
import { packPos } from "./types";

// ─── 队列去重（makeTryAddTask 提取）──────────────────────────

/**
 * 构建队列去重闭包：key + position + blacklist 三重检查。
 * stages 1-3 共用同一去重逻辑——纯函数，不触 Game/Memory。
 * R2 队列治理：maxBackgroundQueued 参数启用 admission control — 非终端队列中
 * priority >= 2 的背景任务（道路/防御等）达到上限后拒绝新背景任务入队；
 * priority <= 1（生存 + 关键发展）不受限。返回值 false = 被去重/黑名单/上限拒绝。
 */
export function makeTryAddTask(
  existingKeys: Set<string>,
  existingPositions: Set<string>,
  segBlocked: Record<string, { retryAt: number }>,
  queue: BuildTask[],
  opts?: {
    /** 背景任务（priority>=2）队列硬上限 — 默认 Infinity（不受限）。 */
    maxBackgroundQueued?: number;
    /** 入队 tick（BuildTask.queuedAt）。 */
    nowTick?: number;
    /** 上限拒绝计数（调用方观测用，跨候选累加）。 */
    stats?: { capRejected: number };
  },
): (candidate: BuildTaskCandidate) => boolean {
  const isBlacklisted = (key: string): boolean => segBlocked[key] !== undefined;
  const maxBackgroundQueued = opts?.maxBackgroundQueued ?? Infinity;
  const nowTick = opts?.nowTick ?? 0;
  const backgroundQueued = (): number =>
    queue.filter(t => (t.state === "queued" || t.state === "blocked") && t.priority >= 2).length;
  return (candidate: BuildTaskCandidate): boolean => {
    if (existingKeys.has(candidate.key)) return false;
    if (isBlacklisted(candidate.key)) return false;
    const posKey = `${candidate.pos.x},${candidate.pos.y}`;
    if (existingPositions.has(posKey)) return false;
    if (
      candidate.priority >= 2 &&
      backgroundQueued() >= maxBackgroundQueued
    ) {
      if (opts?.stats) opts.stats.capRejected++;
      return false;
    }
    queue.push(candidateToBuildTask(candidate, nowTick));
    existingKeys.add(candidate.key);
    existingPositions.add(posKey);
    return true;
  };
}

// ─── 枢纽道路联动（planHubRoads 提取）──────────────────────────

/** 枢纽道路联动常量（从 systems/layout-planner.ts 提取）。 */
export const MAX_HUB_ROADS_PER_STRUCTURE = 2;
export const MAX_HUB_ROADS_PER_PLAN = 6;

/** 目标清单缺口未闭合时的慢速重试间隔（从 systems/layout-planner.ts 提取）。 */
export const GAP_RETRY_INTERVAL = 500;

/**
 * 枢纽道路联动：为已建枢纽结构预铺相邻 road。
 * 纯函数——terrain 和 occupiedSet 由调用方传入（系统侧从 Game API 获取）。
 * 设计约束（CONSTRUCTION_ARCHITECTURE §2.2）：道路逐段添加、绝不预铺全房；
 * 本函数只铺枢纽结构邻格（extension 仍走热度路）。
 */
export function planHubRoads(
  roomName: string,
  hubs: readonly { x: number; y: number }[],
  anchor: { x: number; y: number },
  terrain: { get: (x: number, y: number) => number },
  occupiedSet: ReadonlySet<number>,
  queue: BuildTask[],
  existingKeys: Set<string>,
  existingPositions: Set<string>,
  isBlacklisted: (key: string) => boolean,
): void {
  let added = 0;
  for (const hub of hubs) {
    if (added >= MAX_HUB_ROADS_PER_PLAN) break;

    const neighbors: { x: number; y: number }[] = [
      { x: hub.x + 1, y: hub.y },
      { x: hub.x - 1, y: hub.y },
      { x: hub.x, y: hub.y + 1 },
      { x: hub.x, y: hub.y - 1 },
    ];
    // 物流侧优先：距 anchor 近的邻格先铺（城区内网，不铺城外野路）。
    neighbors.sort(
      (a, b) =>
        (Math.abs(a.x - anchor.x) + Math.abs(a.y - anchor.y)) -
        (Math.abs(b.x - anchor.x) + Math.abs(b.y - anchor.y)),
    );

    let perStructure = 0;
    for (const n of neighbors) {
      if (perStructure >= MAX_HUB_ROADS_PER_STRUCTURE) break;
      if (n.x < 1 || n.x > 48 || n.y < 1 || n.y > 48) continue;
      if (terrain.get(n.x, n.y) === TERRAIN_MASK_WALL) continue;
      if (occupiedSet.has(packPos(n.x, n.y))) continue;
      const key = `road.${roomName}.${n.x}.${n.y}`;
      if (existingKeys.has(key) || isBlacklisted(key)) continue;
      if (existingPositions.has(`${n.x},${n.y}`)) continue;

      queue.push({
        key,
        pos: { x: n.x, y: n.y, roomName },
        structureType: STRUCTURE_ROAD,
        priority: 3,
        state: "queued",
        attempts: 0,
        retryAt: 0,
      });
      existingKeys.add(key);
      existingPositions.add(`${n.x},${n.y}`);
      perStructure++;
      added++;
    }
  }
}

// ─── Spawn 重建 relocation（纯函数提取）──────────────────────────

/**
 * 检测位置是否可建建筑（地形非墙 + 无已有结构占用）。
 * 纯函数——terrain 通过 getTerrain 函数注入（系统侧从 room.getTerrain() 获取）。
 * spawn 不能建在出口格（0 或 49），边界限制 1-48。
 */
export function isPositionBuildable(
  x: number,
  y: number,
  getTerrain: (x: number, y: number) => boolean,
  occupiedSet: ReadonlySet<number>,
): boolean {
  if (x < 1 || x > 48 || y < 1 || y > 48) return false;
  if (getTerrain(x, y)) return false; // getTerrain 返回 true=墙
  if (occupiedSet.has(packPos(x, y))) return false;
  return true;
}

/**
 * 在锚点附近螺旋搜索可建 spawn 的替代位置。
 * 搜索范围 ±3 格（避免 spawn 离核心太远）。
 * 返回第一个可建位置，无则 undefined。
 * 纯函数——terrain 通过 getTerrain 函数注入。
 */
export function findSpawnRelocationPosition(
  anchor: { x: number; y: number },
  getTerrain: (x: number, y: number) => boolean,
  occupiedSet: ReadonlySet<number>,
): { x: number; y: number } | undefined {
  for (let radius = 1; radius <= 3; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        // 只搜索当前半径的边缘（螺旋外扩）
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        if (isPositionBuildable(x, y, getTerrain, occupiedSet)) {
          return { x, y };
        }
      }
    }
  }
  return undefined;
}

// ─── shouldPlan 判定（纯函数提取）──────────────────────────

/**
 * 判断是否应该执行规划。
 * 纯函数——所有外部状态通过参数传入。
 * 系统侧调用方提供 layout 快照、roomMem 快照、emergency 状态。
 */
export function shouldPlan(
  layoutState: string,
  nextPlanTick: number,
  nextGapPlanTick: number | undefined,
  hasAnchor: boolean,
  hasGaps: boolean,
  tick: number,
  lastRcl: number | undefined,
  rcl: number,
  emergencyAny: boolean,
  hasPendingEmergencyTask: boolean,
): boolean {
  // 人工 proposed 状态 — 立即规划。
  if (layoutState === "proposed") return true;

  // 目标清单缺口 — 期望结构未达成。缺口持续时按 nextGapPlanTick 慢速重试。
  if (hasAnchor && hasGaps) {
    if (tick >= (nextGapPlanTick ?? 0)) return true;
  }

  // nextPlanTick 到期。
  if (tick >= nextPlanTick) return true;

  // RCL 变化。
  if (lastRcl !== undefined && lastRcl !== rcl) {
    return true;
  }

  // 紧急重建：关键基建缺失时立即触发规划，不等 50 tick 周期。
  if (hasAnchor && emergencyAny && !hasPendingEmergencyTask) {
    return true;
  }

  return false;
}
