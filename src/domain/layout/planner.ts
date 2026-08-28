/** 布局规划纯函数层（D2 归位：从 systems/layout-planner.ts 提取）。 */

import type { RoomSnapshot } from "../../kernel/contracts";
import type { BuildTaskCandidate } from "./task-factory";
import {
  candidateToBuildTask,
  blueprintToTasks,
  relocateCandidate,
  createSourceContainerTasks,
  createControllerContainerTask,
  createSourceLinkTasks,
  createStorageLinkTask,
  createControllerLinkTask,
  shouldHaveStorageLink,
  shouldHaveControllerLink,
  createExtractorTask,
  createMineralContainerTask,
} from "./task-factory";
import { packPos } from "./types";
import {
  collectCompletedKeys,
  collectCompletedKeysFromStructures,
  precomputeStructureCounts,
  computeCommittedCounts,
  buildOccupiedPositionSet,
  buildObstaclePositionSet,
  type ValidationOptions,
} from "./validation";
import { computeDistanceField } from "./terrain-analysis";
import { placeStructures, placementsToCandidates, DEFAULT_PLACER_CONFIG } from "./constraint-placer";
import { COMPACT_CORE_V2 } from "./templates/compact-core-v2";

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

// ─── Stage 0：规划数据预构建（planStage0Prep 纯计算部分提取）──────

/** Stage 0 产出的跨 stage 共享规划数据（系统侧叠加 startTick/segBlocked/累加器后存 globalCache）。 */
export interface Stage0PlanData {
  anchor: { x: number; y: number };
  completedKeys: Set<string>;
  structureCounts: Map<string, number>;
  occupiedSet: Set<number>;
  obstacleSet: Set<number>;
  minerals: readonly { pos: { x: number; y: number } }[];
  validationOptions: ValidationOptions;
  existingKeys: Set<string>;
  existingPositions: Set<string>;
  queuedLinks: number;
}

/**
 * 构建 stage 0 规划数据：已完成 key 集合（队列 + 已建结构）、结构计数、
 * 占用/障碍集合、验证选项包、队列去重索引与 link 队列计数。
 * 纯函数——全部输入来自快照与队列，不触 Game/Memory。
 */
export function buildStage0PlanData(input: {
  snapshot: RoomSnapshot;
  anchor: { x: number; y: number };
  queue: readonly BuildTask[];
  globalSiteCount: number;
  maxGlobalSites: number;
}): Stage0PlanData {
  const { snapshot, anchor, queue, globalSiteCount, maxGlobalSites } = input;

  const completedKeys = collectCompletedKeys(queue);
  for (const key of collectCompletedKeysFromStructures(COMPACT_CORE_V2, anchor.x, anchor.y, snapshot)) {
    completedKeys.add(key);
  }

  const minerals = snapshot.minerals as readonly { pos: { x: number; y: number } }[];
  const structureCounts = precomputeStructureCounts(snapshot);
  const occupiedSet = buildOccupiedPositionSet(snapshot, minerals);
  const obstacleSet = buildObstaclePositionSet(snapshot);

  const validationOptions: ValidationOptions = {
    completedKeys,
    globalSiteCount,
    maxGlobalSites,
    minerals,
    structureCounts,
    occupiedSet,
    obstacleSet,
  };

  const existingKeys = new Set<string>();
  const existingPositions = new Set<string>();
  for (const t of queue) {
    existingKeys.add(t.key);
    existingPositions.add(`${t.pos.x},${t.pos.y}`);
  }

  return {
    anchor,
    completedKeys,
    structureCounts,
    occupiedSet,
    obstacleSet,
    minerals,
    validationOptions,
    existingKeys,
    existingPositions,
    queuedLinks: queue.filter(t => t.structureType === STRUCTURE_LINK).length,
  };
}

// ─── Stage 1：核心结构规划（planStage1Core 提取）──────────────

/** Stage 1 产出：入队统计 + relocation 覆盖写（系统侧合并进 segment 并标脏）。 */
export interface CoreStageResult {
  tasksAdded: boolean;
  /** relocation 覆盖写（blueprint key → packed pos）。 */
  overrideWrites: Record<string, number>;
}

/**
 * 核心结构规划：constraint 模式（地形约束推导位置）或 template 模式
 * （蓝图偏移 + 失效 cell relocation）。任务经注入的准入闭包入队；
 * relocation 直接入队（与历史行为一致，不受背景上限约束）。
 * 纯函数——terrain/room 经参数注入，segment 覆盖写由调用方落地。
 */
export function planCoreStage(input: {
  mode: "constraint" | "template";
  snapshot: RoomSnapshot;
  room: Room;
  anchor: { x: number; y: number };
  occupiedSet: ReadonlySet<number>;
  validationOptions: ValidationOptions;
  existingKeys: Set<string>;
  existingPositions: Set<string>;
  segBlocked: Record<string, { retryAt: number }>;
  overrides: Map<string, number>;
  queue: BuildTask[];
  maxBackgroundQueued: number;
  nowTick: number;
  capStats?: { capRejected: number };
  onShortfall?: (shortfalls: readonly { type: string; needed: number; placed: number; roomName?: string }[]) => void;
}): CoreStageResult {
  const { snapshot, room, anchor, occupiedSet, validationOptions, existingKeys, existingPositions, segBlocked, queue } = input;
  const tryAddTask = makeTryAddTask(existingKeys, existingPositions, segBlocked, queue, {
    maxBackgroundQueued: input.maxBackgroundQueued,
    nowTick: input.nowTick,
    stats: input.capStats,
  });
  const result: CoreStageResult = { tasksAdded: false, overrideWrites: {} };

  if (input.mode === "constraint") {
    // 约束推导模式：从地形约束推导结构位置。
    const terrain = room.getTerrain();
    const getTerrain = (x: number, y: number): boolean => terrain.get(x, y) === TERRAIN_MASK_WALL;
    const field = computeDistanceField(getTerrain);
    const energyEndpoints: { x: number; y: number }[] = [];
    for (const s of snapshot.sources) energyEndpoints.push({ x: s.pos.x, y: s.pos.y });
    if (snapshot.controller) energyEndpoints.push({ x: snapshot.controller.pos.x, y: snapshot.controller.pos.y });
    const placements = placeStructures(
      anchor,
      field,
      getTerrain,
      snapshot.rcl,
      occupiedSet,
      computeCommittedCounts(snapshot, queue),
      DEFAULT_PLACER_CONFIG,
      energyEndpoints,
      snapshot.labs.map(l => ({ x: l.pos.x, y: l.pos.y })),
      snapshot.roomName,
      snapshot.controller
        ? { x: snapshot.controller.pos.x, y: snapshot.controller.pos.y }
        : undefined,
      snapshot.terminal
        ? { x: snapshot.terminal.pos.x, y: snapshot.terminal.pos.y }
        : undefined,
      input.onShortfall,
    );
    for (const candidate of placementsToCandidates(placements, snapshot.roomName)) {
      if (tryAddTask(candidate)) result.tasksAdded = true;
    }
    return result;
  }

  // 模板模式（默认）：固定蓝图偏移 + relocation。
  const coreCandidates = blueprintToTasks(
    COMPACT_CORE_V2,
    anchor.x,
    anchor.y,
    snapshot.roomName,
    room,
    snapshot,
    snapshot.rcl,
    validationOptions,
    input.overrides,
  );

  // 禁止落子集合：全部蓝图 cell 绝对坐标 + 队列任务坐标。
  const forbidden = new Set<number>();
  for (const cell of COMPACT_CORE_V2.cells) {
    forbidden.add(packPos(anchor.x + cell.dx, anchor.y + cell.dy));
  }
  for (const t of queue) {
    forbidden.add(packPos(t.pos.x, t.pos.y));
  }
  const cellByKey = new Map(COMPACT_CORE_V2.cells.map(c => [c.key, c]));
  const RELOCATABLE_FAILURES: ReadonlySet<string> = new Set(["terrain", "occupied", "seal"]);

  for (const candidate of coreCandidates) {
    if (candidate.validation !== "ok") {
      if (RELOCATABLE_FAILURES.has(candidate.validation) && !existingKeys.has(candidate.key)) {
        const cell = cellByKey.get(candidate.key);
        const relocated = cell
          ? relocateCandidate(candidate, cell, room, snapshot, validationOptions, forbidden)
          : undefined;
        if (relocated) {
          queue.push(candidateToBuildTask(relocated, input.nowTick));
          existingKeys.add(relocated.key);
          existingPositions.add(`${relocated.pos.x},${relocated.pos.y}`);
          forbidden.add(packPos(relocated.pos.x, relocated.pos.y));
          result.overrideWrites[relocated.key] = packPos(relocated.pos.x, relocated.pos.y);
          result.tasksAdded = true;
        }
      }
      continue;
    }
    if (tryAddTask(candidate)) result.tasksAdded = true;
  }
  return result;
}

// ─── Stage 2：物流结构规划（planStage2Logistics 提取）──────────

/** Stage 2 产出：累加器终值 + link 几何受限标记（系统侧据此记录受限冷却）。 */
export interface LogisticsStageResult {
  queuedLinks: number;
  tasksAdded: boolean;
  targetingChanged: boolean;
  controllerGeometryBlocked: boolean;
  storageGeometryBlocked: boolean;
}

/**
 * 物流结构规划：source/controller container、link 槽位按角色分配
 * （source(1) → controller → storage → source(rest)；受限时只补 source link）、
 * extractor 与 mineral container。准入经注入闭包；fallback 链终点
 * （controller + storage 都几何放不下）以标记位返回，由系统侧记录冷却。
 * 纯函数——room 经参数注入，准入闭包由调用方提供。
 */
export function planLogisticsStage(input: {
  snapshot: RoomSnapshot;
  room: Room;
  validationOptions: ValidationOptions;
  queuedLinks: number;
  linkConstrained: boolean;
  tryAdd: (candidate: BuildTaskCandidate) => boolean;
}): LogisticsStageResult {
  const { snapshot, room, validationOptions, tryAdd } = input;
  const result: LogisticsStageResult = {
    queuedLinks: input.queuedLinks,
    tasksAdded: false,
    targetingChanged: false,
    controllerGeometryBlocked: false,
    storageGeometryBlocked: false,
  };
  const addLink = (candidate: BuildTaskCandidate | undefined): void => {
    if (candidate && tryAdd(candidate)) {
      result.queuedLinks++;
      result.tasksAdded = true;
      result.targetingChanged = true;
    }
  };

  // Source container 任务。
  for (const candidate of createSourceContainerTasks(snapshot, room, validationOptions)) {
    if (tryAdd(candidate)) {
      result.tasksAdded = true;
      result.targetingChanged = true;
    }
  }

  // Controller container 任务（RCL3+）。
  const controllerContainer = createControllerContainerTask(snapshot, room, validationOptions);
  if (controllerContainer && tryAdd(controllerContainer)) {
    result.tasksAdded = true;
    result.targetingChanged = true;
  }

  // Link 任务（RCL5+）— 按角色优先级分配有限 link 槽位。
  if (input.linkConstrained) {
    // 受限标记期内：跳过 controller/storage link，仍尝试 source link。
    for (const candidate of createSourceLinkTasks(snapshot, room, validationOptions, result.queuedLinks, 1)) {
      addLink(candidate);
    }
    for (const candidate of createSourceLinkTasks(snapshot, room, validationOptions, result.queuedLinks)) {
      addLink(candidate);
    }
    return result;
  }

  // Source link（第一趟，maxNew=1）。
  for (const candidate of createSourceLinkTasks(snapshot, room, validationOptions, result.queuedLinks, 1)) {
    addLink(candidate);
  }
  // Controller link（RCL5+，先于 storage）。
  const controllerLink = createControllerLinkTask(snapshot, room, validationOptions, result.queuedLinks);
  addLink(controllerLink);
  // Storage link。
  const storageLink = createStorageLinkTask(snapshot, room, validationOptions, result.queuedLinks);
  addLink(storageLink);
  // fallback 链终点判定：两者都「应该有但放不下」才算几何受限（用 shouldHave*
  // 谓词区分「几何放不下」与「正常跳过」——已建成/槽位满/RCL 不足）。
  result.controllerGeometryBlocked = !controllerLink && shouldHaveControllerLink(snapshot, result.queuedLinks);
  result.storageGeometryBlocked = !storageLink && shouldHaveStorageLink(snapshot, result.queuedLinks);
  // Source link（第二趟，maxNew=∞）。
  for (const candidate of createSourceLinkTasks(snapshot, room, validationOptions, result.queuedLinks)) {
    addLink(candidate);
  }

  // Extractor 任务（RCL6+）与 mineral container 任务（RCL6+，需 extractor）。
  const extractor = createExtractorTask(snapshot);
  if (extractor && tryAdd(extractor)) result.tasksAdded = true;
  const mineralContainer = createMineralContainerTask(snapshot, room, validationOptions);
  if (mineralContainer && tryAdd(mineralContainer)) result.tasksAdded = true;

  return result;
}

// ─── Stage 3：紧急 spawn 重建决策（planStage3RoadsAndFinalize 提取）──

export type SpawnRebuildDecision =
  | { kind: "anchor"; pos: { x: number; y: number } }
  | { kind: "relocated"; pos: { x: number; y: number } }
  | { kind: "stuck" }
  | undefined;

/**
 * 紧急 spawn 重建决策：无 spawn 且有存储锚点时，锚点可建则原位重建，
 * 否则锚点邻域螺旋搜索替代位；无可建位返回 stuck。
 * 纯函数——terrain 经 getTerrain 注入；入队与日志由调用方落地。
 */
export function planSpawnRebuild(input: {
  hasSpawn: boolean;
  anchor: { x: number; y: number } | undefined;
  existingKeys: ReadonlySet<string>;
  getTerrain: (x: number, y: number) => boolean;
  occupiedSet: ReadonlySet<number>;
}): SpawnRebuildDecision {
  if (input.hasSpawn || !input.anchor) return undefined;
  const spawnKey = "constraint.spawn.01";
  if (input.existingKeys.has(spawnKey)) return undefined;
  if (isPositionBuildable(input.anchor.x, input.anchor.y, input.getTerrain, input.occupiedSet)) {
    return { kind: "anchor", pos: { x: input.anchor.x, y: input.anchor.y } };
  }
  const relocated = findSpawnRelocationPosition(input.anchor, input.getTerrain, input.occupiedSet);
  return relocated ? { kind: "relocated", pos: relocated } : { kind: "stuck" };
}
