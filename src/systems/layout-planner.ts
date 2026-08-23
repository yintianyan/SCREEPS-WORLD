import { CONFIG } from "../config";
import type { Priority, System, TickContext, RoomSnapshot } from "../kernel/contracts";
import { roomPhase } from "../kernel/phase";
import { globalCache } from "../kernel/global-cache";
import { getRoomLayoutData, markLayoutDirty } from "../kernel/segment-store";
import { COMPACT_CORE_V2 } from "../domain/layout/templates/compact-core-v2";
import {
  blueprintToTasks,
  candidateToBuildTask,
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
  type BuildTaskCandidate,
} from "../domain/layout/task-factory";
import {
  collectCompletedKeys,
  collectCompletedKeysFromStructures,
  precomputeStructureCounts,
  computeCommittedCounts,
  buildOccupiedPositionSet,
  buildObstaclePositionSet,
} from "../domain/layout/validation";
import { planRoads, rotateTraffic } from "../domain/layout/road-planner";
import { evaluateCandidate, scoreCandidate } from "../domain/layout/candidate-score";
import { packPos, unpackPos } from "../domain/layout/types";
import { computeDistanceField } from "../domain/layout/terrain-analysis";
import { diagnoseAnchor } from "../domain/layout/anchor-selection";
import { placeStructures, placementsToCandidates, DEFAULT_PLACER_CONFIG } from "../domain/layout/constraint-placer";
import { log } from "../kernel/log";
import { assessEmergencyRebuild, isEmergencyTask } from "../domain/construction/queue";
import { auditStructureGaps, auditLinkRoleGaps, mergeLinkRoleGaps, type StructureGaps } from "../domain/layout/gaps";
import {
  getDeadAssetLinks,
  isLinkConstrained,
  markLinkConstrained,
  isDismantleOnCooldown,
  isRoomInDefense,
  createDismantlePlan,
  getDismantlePlans,
} from "./link-system";
// D2 归位：纯函数已下沉到 domain/layout/planner.ts
import {
  makeTryAddTask as makeTryAddTaskDomain,
  planHubRoads as planHubRoadsDomain,
  isPositionBuildable as isPositionBuildableDomain,
  findSpawnRelocationPosition as findSpawnRelocationPositionDomain,
  shouldPlan as shouldPlanDomain,
  GAP_RETRY_INTERVAL,
  MAX_HUB_ROADS_PER_PLAN,
} from "../domain/layout/planner";

/**
 * D2 归位：常量 GAP_RETRY_INTERVAL / MAX_HUB_ROADS_* 已下沉到
 * domain/layout/planner.ts，此处只 import 复用。
 */

// ─── P1-F.6：4-stage 分片跨 tick 中间产物 ──────────────────

/**
 * 规划分片跨 tick 中间产物（存 globalCache，不进 Memory — plan §7：大对象不进 Memory）。
 * 跨 tick 持久：planStage > 0 时各 stage 共享；global reset 丢失 → 下 tick 重置
 * planStage=0 重新开始（最多损失一个规划周期）。
 * stage 0 产出（只读消费于 1-3）：anchor/completedKeys/structureCounts/occupiedSet/
 * obstacleSet/minerals/validationOptions/segBlocked；stages 1-3 累加器：
 * existingKeys/existingPositions/tasksAdded/targetingChanged/queuedLinks。
 * queue 直接读写 roomMem.buildQueue（与 construction-manager 同 tick 可见）。
 */
interface PlanStageData {
  /** stage 0 启动 tick（诊断 + 防陈旧 data 误用）。 */
  startTick: number;
  /** 锚点解包坐标（stage 0 产出，stages 1-3 消费）。 */
  anchor: { x: number; y: number };
  /** 已完成结构 key 集合（依赖检查）。 */
  completedKeys: Set<string>;
  /** 结构计数（cell 验证复用）。 */
  structureCounts: Map<string, number>;
  /** 占用位置集合（packed）。 */
  occupiedSet: Set<number>;
  /** 障碍位置集合（密封守卫）。 */
  obstacleSet: Set<number>;
  /** 矿物位置（room.find(FIND_MINERALS) 结果转写）。 */
  minerals: readonly { pos: { x: number; y: number } }[];
  /** 验证选项包（多字段组合，供 task-factory 各函数消费）。 */
  validationOptions: {
    completedKeys: Set<string>;
    globalSiteCount: number;
    maxGlobalSites: number;
    minerals: readonly { pos: { x: number; y: number } }[];
    structureCounts: Map<string, number>;
    occupiedSet: Set<number>;
    obstacleSet: Set<number>;
  };
  /** segment blocked 黑名单（stage 0 清理过期条目后的快照）。 */
  segBlocked: Record<string, { retryAt: number }>;
  /** 队列去重 key 集合（stages 1-3 累加）。 */
  existingKeys: Set<string>;
  /** 队列去重位置集合（stages 1-3 累加）。 */
  existingPositions: Set<string>;
  /** 是否有任务入队（stages 1-3 累加，stage 3 用于决定是否 markLayoutDirty）。 */
  tasksAdded: boolean;
  /** 是否有影响 creep 目标选择的结构入队（stages 1-3 累加，stage 3 决定 revision++）。 */
  targetingChanged: boolean;
  /** 已入队 link 数（stage 2 内部累加，防超额分配 RCL link 槽位）。 */
  queuedLinks: number;
}

/** 从 globalCache 读取 planStageData；不存在返回 undefined。 */
function getPlanStageData(roomName: string): PlanStageData | undefined {
  const g = globalCache() as any;
  const store = g.__planStageData;
  if (!store) return undefined;
  return store[roomName] as PlanStageData | undefined;
}

/** 写入 planStageData 到 globalCache。 */
function setPlanStageData(roomName: string, data: PlanStageData): void {
  const g = globalCache() as any;
  if (!g.__planStageData) g.__planStageData = {};
  g.__planStageData[roomName] = data;
}

/** 清除 planStageData（stage 3 完成或重置时调用）。 */
function clearPlanStageData(roomName: string): void {
  const g = globalCache() as any;
  if (g.__planStageData) delete g.__planStageData[roomName];
}

/**
 * D2 归位：tryAddTask 闭包逻辑已下沉到 domain/layout/planner.ts 的 makeTryAddTaskDomain。
 * 系统侧薄壳包装——从 planStageData 提取参数委托给纯函数。
 */
function makeTryAddTask(
  data: PlanStageData,
  queue: BuildTask[],
): (candidate: BuildTaskCandidate) => boolean {
  return makeTryAddTaskDomain(data.existingKeys, data.existingPositions, data.segBlocked, queue);
}

/**
 * 布局规划器 — P3 低频系统，负责生成和维护建造计划（plan §5.6.3）。
 * 职责：触发条件满足时重新规划布局；蓝图 cells → BuildTask 推入 BuildQueue；
 * 动态生成 source/controller container 任务；评估交通热度生成道路候选。
 * 触发（shouldPlan 判定，每 tick 调用但内部早返回）：首次运行 / RCL 变化 /
 * nextPlanTick 到期（默认 50）/ layout.state 人工设 proposed。
 * 不使用 System.interval — kernel.shouldRunSystem 用 tick % interval 跳过会导致
 * RCL 变化触发最多延迟 interval-1 tick；改为每 tick 调用 planRoom，由 shouldPlan
 * 内部控制实际规划时机。只在 Green/Guarded 且非 BOOTSTRAP/RECOVERY/DEFENSE 运行。
 */
export const layoutPlannerSystem: System & {
  planRoom(
    snapshot: import("../kernel/contracts").RoomSnapshot,
    ctx: TickContext,
  ): void;
} = {
  name: "layout-planner",
  priority: 3 as Priority,
  /**
   * P1-F：recoveryEligible 钩子 — 任一 snapshot 命中紧急重建（关键基建
   * 缺失：spawn/storage/tower/sourceContainer）时自报 true，让 kernel
   * 将本系统提升为 P1 等效优先级通过 budget 拦截。
   *
   * CTO 裁决（2026-08-01）：常规 50-tick 重规划不再享受 recovery 档豁免 —
   * 仅在关键基建确实缺失时提升。kernel 只读此钩子，不再硬编码 layout-planner
   * 名字（docs/architecture/KERNEL_ARCHITECTURE.md）。
   */
  recoveryEligible: (ctx: TickContext): boolean => {
    for (const snapshot of ctx.snapshots()) {
      if (assessEmergencyRebuild(snapshot).any) return true;
    }
    return false;
  },

  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      this.planRoom(snapshot, ctx);
    }
  },

  planRoom(snapshot, ctx): void {
    const room = Game.rooms[snapshot.roomName];
    if (!room) return;

    const roomMem = Memory.rooms[snapshot.roomName];
    if (!roomMem) return;

    // 初始化 LayoutMemory（热数据留 Memory，冷数据 overrides/blocked 在 segment）。
    if (!roomMem.layout) {
      roomMem.layout = {
        version: 2,
        templateId: COMPACT_CORE_V2.id,
        state: "accepted",
        revision: 0,
        nextPlanTick: ctx.tick,
        // P1-F.6：4-stage 分片起始为 0（空闲态）。
        planStage: 0,
      };
    }

    const layout = roomMem.layout;

    // 人工 manual 状态不自动规划。
    if (layout.state === "manual") return;

    // P1-F.6：4-stage 分片调度。
    // stage 0：prep（锚点 + shouldPlan + 构建 PlanStageData）→ 1；
    // stage 1：核心结构（constraint/template）→ 2；
    // stage 2：物流结构（container/link/extractor）→ 3；
    // stage 3：道路 + spawn 重建 + 收尾 → 0 + 清 planStageData。
    // 跨 tick 中间产物放 globalCache（plan §7：大对象不进 Memory）；global reset 丢失
    // planStageData 时下 tick 重置 planStage=0 重新开始（最多损失一个规划周期）。
    const stage = layout.planStage ?? 0;
    if (stage === 0) {
      planStage0Prep(snapshot, ctx, roomMem, layout);
      return;
    }

    const data = getPlanStageData(snapshot.roomName);
    if (!data) {
      // global reset 丢失中间产物 — 重置重新开始。
      layout.planStage = 0;
      return;
    }

    if (stage === 1) {
      planStage1Core(snapshot, ctx, roomMem, layout, data);
    } else if (stage === 2) {
      planStage2Logistics(snapshot, ctx, roomMem, layout, data);
    } else if (stage === 3) {
      planStage3RoadsAndFinalize(snapshot, ctx, roomMem, layout, data);
    }
  },
};

// ─── P1-F.6：4-stage 分片实现 ─────────────────────────────

/**
 * Stage 0：prep — 锚点确定 + shouldPlan 门禁 + 构建 PlanStageData。
 *
 * 包含原 planRoom 的锚点逻辑（spawn 位置变化检测、queue 清空、site 移除）
 * 和所有 prep 计算（completedKeys、occupiedSet、distance field 等）。
 * 完成后写入 planStageData 到 globalCache，设置 planStage=1。
 */
function planStage0Prep(
  snapshot: RoomSnapshot,
  ctx: TickContext,
  roomMem: RoomMemory,
  layout: NonNullable<RoomMemory["layout"]>,
): void {
  const room = Game.rooms[snapshot.roomName];
  if (!room) return;

  // 确定锚点 — 优先使用 live spawn 位置；spawn 被毁时回退到存储锚点（紧急重建）。
  if (snapshot.spawns.length > 0) {
    const spawn = snapshot.spawns[0]!;
    const anchorPacked = packPos(spawn.pos.x, spawn.pos.y);

    // 首次设置锚点，或 spawn 重建在新位置时更新锚点。
    if (layout.anchor === undefined) {
      layout.anchor = anchorPacked;
      const candidateInput = evaluateCandidate(room, COMPACT_CORE_V2, spawn.pos.x, spawn.pos.y);
      if (candidateInput) {
        layout.anchorScore = scoreCandidate(candidateInput);
      }

      // Phase 3 诊断：Distance Transform 锚点质量评估。
      {
        const terrain = room.getTerrain();
        const getTerrain = (x: number, y: number): boolean => terrain.get(x, y) === TERRAIN_MASK_WALL;
        const field = computeDistanceField(getTerrain);
        const exits = room.find(FIND_EXIT).map(p => ({ x: p.x, y: p.y }));
        const sources = snapshot.sources.map(s => ({ x: s.pos.x, y: s.pos.y }));
        const controller = snapshot.controller
          ? { x: snapshot.controller.pos.x, y: snapshot.controller.pos.y }
          : undefined;
        const mineral = snapshot.minerals[0]
          ? { x: snapshot.minerals[0]!.pos.x, y: snapshot.minerals[0]!.pos.y }
          : undefined;

        const diagnosis = diagnoseAnchor(spawn.pos.x, spawn.pos.y, {
          field, sources, controller, exits, mineral, getTerrain,
        });
        console.log(
          `[layout] anchor diagnosis ${snapshot.roomName}: ` +
          `rank ${diagnosis.rank}/${diagnosis.total}, ` +
          `score ${diagnosis.candidate.score.toFixed(1)}, ` +
          `openness ${diagnosis.candidate.openness}, ` +
          `blocked ${diagnosis.candidate.blockedCells}, ` +
          `srcDist ${diagnosis.candidate.avgSourceDist.toFixed(1)}`,
        );
      }
    } else if (layout.anchor !== anchorPacked) {
      layout.anchor = anchorPacked;
      const segData = getRoomLayoutData(snapshot.roomName);
      segData.overrides = {};
      segData.blocked = {};
      markLayoutDirty();
      layout.revision++;
      // 锚点变化意味着所有旧坐标失效 — 清空 buildQueue，由下次规划重建。
      roomMem.buildQueue = [];
      // 同步移除按旧锚点创建的 construction site（孤儿 site 根治）。
      for (const site of snapshot.myConstructionSites) {
        site.remove();
      }
    }
  } else if (layout.anchor === undefined) {
    // 无 spawn 且无存储锚点 — 初始 bootstrap 前的正常状态，无法规划。
    return;
  }

  // 目标清单缺口审计 — 单一真相源（CONTROLLER_STRUCTURES 派生）对照已建结构 +
  // 我方在建 site + queued/blocked 队列任务。缺口 > 0 即真实未达成（audit 已把队列
  // 任务计入已有，缺口不会因队列存在而误报）：shouldPlan 据此强制规划（不等
  // nextPlanTick，受 nextGapPlanTick 节流）；落盘 layoutGaps 供控制台采样。
  const queue = roomMem.buildQueue ?? [];
  const gaps = auditStructureGaps(snapshot, queue);
  // link 角色感知（2026-08-02）：总数满足但角色分布错（死资产）时暴露真实缺口。
  mergeLinkRoleGaps(gaps, auditLinkRoleGaps(snapshot, queue));
  // 死资产检测（2026-08-02，§3.3）：source link 持续 500t 三重校验失败 → 触发规划。
  // deadAssetLink key 值为死资产数量，触发 shouldPlan；拆改通道由 P1-4 实现。
  const deadAssets = getDeadAssetLinks(ctx.tick);
  if (deadAssets.length > 0) {
    gaps.deadAssetLink = deadAssets.length;
  }
  recordLayoutGaps(snapshot.roomName, gaps);

  // 检查触发条件。
  if (!shouldPlan(layout, ctx.tick, snapshot, gaps)) return;

  // 执行规划 — stage 0 开始。
  layout.state = "building";

  // 收集已完成 key 集合（用于依赖检查）。
  const completedKeys = collectCompletedKeys(queue);
  const anchor = unpackPos(layout.anchor);
  for (const key of collectCompletedKeysFromStructures(COMPACT_CORE_V2, anchor.x, anchor.y, snapshot)) {
    completedKeys.add(key);
  }

  // 直接使用 RoomSnapshot 中的 minerals 数据。
  const minerals = snapshot.minerals as readonly { pos: { x: number; y: number } }[];

  // 预计算结构计数与占用集合 — 每规划周期构建一次，供所有 cell 验证复用。
  const structureCounts = precomputeStructureCounts(snapshot);
  const occupiedSet = buildOccupiedPositionSet(snapshot, minerals);
  const obstacleSet = buildObstaclePositionSet(snapshot);

  const validationOptions = {
    completedKeys,
    globalSiteCount: ctx.globalSiteCount,
    maxGlobalSites: CONFIG.construction.maxGlobalSites,
    minerals,
    structureCounts,
    occupiedSet,
    obstacleSet,
  };

  // 预构建队列 key 集合 — O(1) 去重。
  const existingKeys = new Set<string>();
  const existingPositions = new Set<string>();
  for (const t of queue) {
    existingKeys.add(t.key);
    existingPositions.add(`${t.pos.x},${t.pos.y}`);
  }

  // 阻塞黑名单：清理过期条目。
  const segBlocked = getRoomLayoutData(snapshot.roomName).blocked ?? {};
  for (const [blockedKey, entry] of Object.entries(segBlocked)) {
    if (ctx.tick >= entry.retryAt) {
      delete segBlocked[blockedKey];
      markLayoutDirty();
    }
  }

  // 写入 planStageData — stages 1-3 共享。
  setPlanStageData(snapshot.roomName, {
    startTick: ctx.tick,
    anchor,
    completedKeys,
    structureCounts,
    occupiedSet,
    obstacleSet,
    minerals,
    validationOptions,
    segBlocked,
    existingKeys,
    existingPositions,
    tasksAdded: false,
    targetingChanged: false,
    queuedLinks: queue.filter(t => t.structureType === STRUCTURE_LINK).length,
  });

  // 推进到 stage 1。
  layout.planStage = 1;
}

/**
 * Stage 1：核心结构 — constraint 模式（placeStructures）或 template 模式（blueprintToTasks + relocation）。
 *
 * 从 planStageData 读取 stage 0 产出的 anchor、occupiedSet、validationOptions 等，
 * 入队核心结构任务，推进到 stage 2。
 */
function planStage1Core(
  snapshot: RoomSnapshot,
  _ctx: TickContext,
  roomMem: RoomMemory,
  layout: NonNullable<RoomMemory["layout"]>,
  data: PlanStageData,
): void {
  const room = Game.rooms[snapshot.roomName];
  if (!room) return;

  const queue = roomMem.buildQueue ?? [];
  const tryAddTask = makeTryAddTask(data, queue);
  const { anchor, occupiedSet, validationOptions, existingKeys, existingPositions } = data;

  if (CONFIG.layout.mode === "constraint") {
    // ── 约束推导模式：从地形约束推导结构位置 ──
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
      (shortfalls) => {
        for (const s of shortfalls) {
          log.warn("layout", "placement shortfall in " + (s.roomName ?? "?") + ": " + s.type + " need " + s.needed + " placed " + s.placed);
        }
      },
    );
    const constraintCandidates = placementsToCandidates(placements, snapshot.roomName);

    for (const candidate of constraintCandidates) {
      if (tryAddTask(candidate)) data.tasksAdded = true;
    }
  } else {
    // ── 模板模式（默认）：固定蓝图偏移 + relocation ──
    const segData = getRoomLayoutData(snapshot.roomName);
    const overrides = new Map<string, number>(Object.entries(segData.overrides ?? {}));
    const coreCandidates = blueprintToTasks(
      COMPACT_CORE_V2,
      anchor.x,
      anchor.y,
      snapshot.roomName,
      room,
      snapshot,
      snapshot.rcl,
      validationOptions,
      overrides,
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
            queue.push(candidateToBuildTask(relocated));
            existingKeys.add(relocated.key);
            existingPositions.add(`${relocated.pos.x},${relocated.pos.y}`);
            forbidden.add(packPos(relocated.pos.x, relocated.pos.y));
            segData.overrides ??= {};
            segData.overrides[relocated.key] = packPos(relocated.pos.x, relocated.pos.y);
            markLayoutDirty();
            data.tasksAdded = true;
          }
        }
        continue;
      }
      if (tryAddTask(candidate)) data.tasksAdded = true;
    }
  }

  roomMem.buildQueue = queue;
  layout.planStage = 2;
}

/**
 * Stage 2：物流结构 — source/controller container + link 网络 + extractor + mineral container。
 *
 * Link 槽位按 RCL 分级分配（2026-08-02 修订）：
 *   RCL5 source+controller（controller 优先于 storage，避免 storage 几何失败连累升级链）
 *   RCL6 +storage, RCL7 维持, RCL8 +source2+2hub
 * 推进到 stage 3。
 */
function planStage2Logistics(
  snapshot: RoomSnapshot,
  ctx: TickContext,
  roomMem: RoomMemory,
  layout: NonNullable<RoomMemory["layout"]>,
  data: PlanStageData,
): void {
  const room = Game.rooms[snapshot.roomName];
  if (!room) return;

  const queue = roomMem.buildQueue ?? [];
  const tryAddTask = makeTryAddTask(data, queue);
  const { validationOptions } = data;

  // 2. Source container 任务。
  const sourceContainerCandidates = createSourceContainerTasks(snapshot, room, validationOptions);
  for (const candidate of sourceContainerCandidates) {
    if (tryAddTask(candidate)) {
      data.tasksAdded = true;
      data.targetingChanged = true;
    }
  }

  // 3. Controller container 任务（RCL3+）。
  const controllerContainer = createControllerContainerTask(snapshot, room, validationOptions);
  if (controllerContainer) {
    if (tryAddTask(controllerContainer)) {
      data.tasksAdded = true;
      data.targetingChanged = true;
    }
  }

  // 3.5 Link 任务（RCL5+）— 按角色优先级分配有限 link 槽位。
  // 分配顺序（2026-08-02 修订）：source(1) → controller → storage → source(rest)。
  // RCL5 仅 2 槽位时落在 source + controller（避免 storage 几何失败后 controller 被
  // 跳过、升级链断裂）。
  // P1-3 link 几何受限（2026-08-02，fallback 链）：controller + storage 都几何放不下
  // 时标记 linkConstrained，1000t 内跳过 link 任务创建避免空转；source link 不受影响
  // （source 邻域通常开阔，几何失败罕见）。
  if (isLinkConstrained(snapshot.roomName, ctx.tick)) {
    // linkConstrained 标记期内：跳过 controller/storage link 创建，但仍尝试 source link
    // （source link 是 link 网络的基础，不应因 controller/storage 受限而停建）。
    const sourceLinkFirst = createSourceLinkTasks(snapshot, room, validationOptions, data.queuedLinks, 1);
    for (const candidate of sourceLinkFirst) {
      if (tryAddTask(candidate)) {
        data.queuedLinks++;
        data.tasksAdded = true;
        data.targetingChanged = true;
      }
    }
    const sourceLinkRest = createSourceLinkTasks(snapshot, room, validationOptions, data.queuedLinks);
    for (const candidate of sourceLinkRest) {
      if (tryAddTask(candidate)) {
        data.queuedLinks++;
        data.tasksAdded = true;
        data.targetingChanged = true;
      }
    }
  } else {
    // 3.5a Source link（第一趟，maxNew=1）。
    const sourceLinkFirst = createSourceLinkTasks(snapshot, room, validationOptions, data.queuedLinks, 1);
    for (const candidate of sourceLinkFirst) {
      if (tryAddTask(candidate)) {
        data.queuedLinks++;
        data.tasksAdded = true;
        data.targetingChanged = true;
      }
    }

    // 3.5b Controller link（RCL5+，先于 storage）。
    const controllerLink = createControllerLinkTask(snapshot, room, validationOptions, data.queuedLinks);
    if (controllerLink) {
      if (tryAddTask(controllerLink)) {
        data.queuedLinks++;
        data.tasksAdded = true;
        data.targetingChanged = true;
      }
    }

    // 3.5c Storage link。
    const storageLink = createStorageLinkTask(snapshot, room, validationOptions, data.queuedLinks);
    if (storageLink) {
      if (tryAddTask(storageLink)) {
        data.queuedLinks++;
        data.tasksAdded = true;
        data.targetingChanged = true;
      }
    }

    // P1-3 fallback 链终点：controller + storage 都几何放不下 → 标记 linkConstrained。
    // 用 shouldHave* 谓词区分「几何放不下」与「正常跳过」（已建成/槽位满/RCL不足），
    // 仅当两者都「应该有但放不下」才标记，避免误标正常状态。
    const controllerGeometryBlocked = !controllerLink && shouldHaveControllerLink(snapshot, data.queuedLinks);
    const storageGeometryBlocked = !storageLink && shouldHaveStorageLink(snapshot, data.queuedLinks);
    if (controllerGeometryBlocked && storageGeometryBlocked) {
      markLinkConstrained(snapshot.roomName, ctx.tick);
      console.log(
        `[layout] link constrained in ${snapshot.roomName}: ` +
        `controller + storage link geometry blocked, retry after ${1000}t`,
      );
    }

    // 3.5d Source link（第二趟，maxNew=∞）。
    const sourceLinkRest = createSourceLinkTasks(snapshot, room, validationOptions, data.queuedLinks);
    for (const candidate of sourceLinkRest) {
      if (tryAddTask(candidate)) {
        data.queuedLinks++;
        data.tasksAdded = true;
        data.targetingChanged = true;
      }
    }
  }

  // 3.6 P1-4 受限拆改：死资产 link 检测到替代位置后创建拆改计划。
  // 流程：死资产检测就绪（getDeadAssetLinks 持续 500t 三重校验失败）→ 替代位置由
  // createSourceLinkTasks 搜索（死 link 不可喂 → findAdjacentBuildable 找新位置 →
  // 替代任务已入队）→ 此处登记拆改计划，跟踪「替代建成 → 验证灌能 → destroy 旧 link」。
  // 门禁（避免空转）：冷却（DISMANTLE_COOLDOWN=1000t）；战时暂停（defense 不新建计划）；
  // 替代任务必须存在（本周期未入队 → 跳过）；已有计划不重复创建。
  // 执行与验证由 construction-manager 负责（每 tick 消费 dismantlePlans）。
  {
    const deadAssets = getDeadAssetLinks(ctx.tick);
    if (deadAssets.length > 0 && !isRoomInDefense(snapshot.roomName) && !isDismantleOnCooldown(snapshot.roomName, ctx.tick)) {
      const existingPlans = getDismantlePlans();
      for (const deadLinkId of deadAssets) {
        if (existingPlans.has(deadLinkId)) continue;
        // 死资产 link 必须属于本房（跨房死资产由各自 layout-planner 处理）。
        const deadLink = snapshot.links.find(l => l.id === deadLinkId);
        if (!deadLink) continue;
        // 在 queue 中找到紧邻同一 source 的 queued 状态替代任务。
        // 安全性：死资产 link 是已建成 structure，不会有对应 queued 任务；
        // 若替代任务已 done（建成）且灌能，死资产已被清除不会走到这里；
        // 若替代任务已 done 但未灌能（替代也是死资产），createSourceLinkTasks
        // 不会再创建新任务 → 无 queued 任务 → 不创建拆改计划 → 由 fallback 路径处理。
        const replacementTask = findReplacementForDeadLink(deadLink, snapshot, queue);
        if (!replacementTask) continue;
        createDismantlePlan(
          deadLinkId,
          snapshot.roomName,
          replacementTask.key,
          { x: replacementTask.pos.x, y: replacementTask.pos.y },
          ctx.tick,
        );
        console.log(
          `[layout] dismantle plan created: dead link ${deadLinkId} in ${snapshot.roomName}, ` +
          `replacement at (${replacementTask.pos.x},${replacementTask.pos.y})`,
        );
      }
    }
  }

  // 3.7 Extractor 任务（RCL6+）。
  {
    const extractor = createExtractorTask(snapshot);
    if (extractor) {
      if (tryAddTask(extractor)) data.tasksAdded = true;
    }
  }

  // 3.7b Mineral container 任务（RCL6+，需 extractor）。
  {
    const mineralContainer = createMineralContainerTask(snapshot, room, validationOptions);
    if (mineralContainer) {
      if (tryAddTask(mineralContainer)) data.tasksAdded = true;
    }
  }

  roomMem.buildQueue = queue;
  layout.planStage = 3;
}

/**
 * Stage 3：道路 + spawn 重建 + 收尾。
 *
 * - planRoads 生成道路任务
 * - 紧急 spawn 重建（无 spawn 且 anchor 已设置）
 * - rotateTraffic 数据轮换
 * - 更新 buildQueue、revision、nextPlanTick（带 P1-F 相位偏移）
 * - 重置 planStage=0 + 清 planStageData
 */
function planStage3RoadsAndFinalize(
  snapshot: RoomSnapshot,
  ctx: TickContext,
  roomMem: RoomMemory,
  layout: NonNullable<RoomMemory["layout"]>,
  data: PlanStageData,
): void {
  const room = Game.rooms[snapshot.roomName];
  if (!room) return;

  const queue = roomMem.buildQueue ?? [];
  const tryAddTask = makeTryAddTask(data, queue);
  const { anchor, occupiedSet, existingKeys, existingPositions, segBlocked } = data;
  const isBlacklisted = (key: string): boolean => segBlocked[key] !== undefined;

  // 3.9-5. 道路规划。
  {
    const roadTasks = planRoads({
      snapshot,
      room,
      blueprint: COMPACT_CORE_V2,
      anchor,
      occupiedSet,
      queue,
      existingKeys,
      tick: ctx.tick,
    });
    for (const task of roadTasks) {
      const posKey = `${task.pos.x},${task.pos.y}`;
      if (existingKeys.has(task.key) || existingPositions.has(posKey)) continue;
      if (isBlacklisted(task.key)) continue;
      queue.push(task);
      existingKeys.add(task.key);
      existingPositions.add(posKey);
      data.tasksAdded = true;
    }
  }

  // 3.9-6. 枢纽道路联动 — 物流枢纽结构（spawn/storage/terminal/factory/lab/link）
  // 邻格预铺 1-2 条 road，不等热度采样（W7N4 实证滞后病灶：RCL8 满配后 ext 邻路率 32%）。
  // 门禁（预算感知 + 规模感知）：仅 RCL6+（terminal/lab 时代城区成型）；必须有 storage
  // （无 storage 贫困房额外 builder 需求会延迟 harvester 重建 — RCL5 脉冲世界 1500t
  // 未恢复实证）；经济承压（economyPressure >= 0.5 / recovery）不铺。
  // 基于已建枢纽（snapshot）而非排队任务 — 修复「结构建成后路网滞后」本体。
  const economyOk = (Memory.rooms[snapshot.roomName]?.economyPressure ?? 0) < 0.5;
  if (economyOk && !snapshot.needsRecovery && snapshot.rcl >= 6 && snapshot.storage) {
    planHubRoads(
      snapshot, room, anchor, occupiedSet,
      queue, existingKeys, existingPositions, isBlacklisted,
    );
  }

  // ── 紧急 spawn 重建 ──
  if (snapshot.spawns.length === 0 && layout.anchor !== undefined) {
    const anchorPos = unpackPos(layout.anchor);
    const spawnKey = `constraint.spawn.01`;
    if (!existingKeys.has(spawnKey)) {
      let buildPos: { x: number; y: number } | undefined;
      if (isPositionBuildable(room, anchorPos.x, anchorPos.y, occupiedSet)) {
        buildPos = { x: anchorPos.x, y: anchorPos.y };
      } else {
        buildPos = findSpawnRelocationPosition(room, anchorPos, occupiedSet);
        if (buildPos) {
          console.log(
            `[layout] spawn rebuild: anchor (${anchorPos.x},${anchorPos.y}) blocked, ` +
            `relocating to (${buildPos.x},${buildPos.y}) in ${snapshot.roomName}`,
          );
        } else {
          console.log(
            `[layout] WARN: spawn rebuild stuck in ${snapshot.roomName}, ` +
            `no relocation position found near anchor`,
          );
        }
      }
      if (buildPos) {
        queue.push({
          key: spawnKey,
          pos: { x: buildPos.x, y: buildPos.y, roomName: snapshot.roomName },
          structureType: STRUCTURE_SPAWN,
          priority: 0,
          state: "queued",
          attempts: 0,
          retryAt: 0,
        });
        existingKeys.add(spawnKey);
        existingPositions.add(`${buildPos.x},${buildPos.y}`);
        data.tasksAdded = true;
        data.targetingChanged = true;
      }
    }
  }

  // 交通数据轮换（无论 RCL 都执行，确保 RCL4 时已有 prevTraffic 可用）。
  rotateTraffic(snapshot.roomName);

  roomMem.buildQueue = queue;

  // 仅在影响 creep 目标选择的结构入队时递增 revision。
  if (data.targetingChanged) {
    layout.revision++;
  }

  // 更新规划时间戳和 RCL 跟踪。
  // P1-F：nextPlanTick 加房间名哈希偏移 — 消除「N 个房每 50 tick 同一 tick 扎堆重规划」
  // 的 CPU 尖峰（roomPhase 与 systemPhase 同 DJB-like 哈希算法）。首次初始化不加偏移 —
  // 房间刚建立时需立即规划。
  // 2026-08-01 目标清单闭环：用更新后队列重算缺口（本周期新任务已入队，缺口应闭合）；
  // 缺口仍存在 = 受限地形放置失败 → GAP_RETRY_INTERVAL(500) 慢速重试，避免每 50 tick
  // 空转重规划（W7N3 实证病灶）；缺口闭合 → 恢复正常 planInterval。nextGapPlanTick 同步
  // 节流 gap-force，防止下 tick 立即被缺口强制触发抵消慢速节流。
  const gapsAfter = auditStructureGaps(snapshot, roomMem.buildQueue);
  // link 角色感知（同 stage 0 入口）：合并角色缺口，暴露死资产/角色分布错。
  mergeLinkRoleGaps(gapsAfter, auditLinkRoleGaps(snapshot, roomMem.buildQueue));
  recordLayoutGaps(snapshot.roomName, gapsAfter);
  const gapsOpen = Object.keys(gapsAfter).length > 0;
  const interval = gapsOpen ? GAP_RETRY_INTERVAL : CONFIG.layout.planInterval;
  layout.nextPlanTick = ctx.tick + interval + roomPhase(snapshot.roomName, interval);
  if (gapsOpen) {
    layout.nextGapPlanTick = ctx.tick + GAP_RETRY_INTERVAL;
  } else {
    delete layout.nextGapPlanTick;
  }
  roomMem.lastRcl = snapshot.rcl;

  // 收尾 — 重置 planStage + 清 planStageData。
  layout.planStage = 0;
  clearPlanStageData(snapshot.roomName);
}

/**
 * D2 归位：枢纽道路联动纯函数已下沉到 domain/layout/planner.ts。
 * 系统侧薄壳——从 snapshot 组装参数委托给纯函数。
 */
function planHubRoads(
  snapshot: import("../kernel/contracts").RoomSnapshot,
  room: Room,
  anchor: { x: number; y: number },
  occupiedSet: ReadonlySet<number>,
  queue: BuildTask[],
  existingKeys: Set<string>,
  existingPositions: Set<string>,
  isBlacklisted: (key: string) => boolean,
): void {
  const hubs: { x: number; y: number }[] = [
    ...snapshot.spawns.map(s => ({ x: s.pos.x, y: s.pos.y })),
    ...snapshot.labs.map(s => ({ x: s.pos.x, y: s.pos.y })),
    ...snapshot.links.map(s => ({ x: s.pos.x, y: s.pos.y })),
  ];
  if (snapshot.storage) hubs.push({ x: snapshot.storage.pos.x, y: snapshot.storage.pos.y });
  if (snapshot.terminal) hubs.push({ x: snapshot.terminal.pos.x, y: snapshot.terminal.pos.y });
  if (snapshot.factory) hubs.push({ x: snapshot.factory.pos.x, y: snapshot.factory.pos.y });

  planHubRoadsDomain(
    snapshot.roomName, hubs, anchor, room.getTerrain(),
    occupiedSet, queue, existingKeys, existingPositions, isBlacklisted,
  );
}

/**
 * D2 归位：shouldPlan 纯函数已下沉到 domain/layout/planner.ts。
 * 系统侧薄壳——从 Memory/快照提取参数委托给纯函数。
 */
function shouldPlan(
  layout: NonNullable<RoomMemory["layout"]>,
  tick: number,
  snapshot: import("../kernel/contracts").RoomSnapshot,
  gaps: StructureGaps,
): boolean {
  const roomMem = Memory.rooms[snapshot.roomName];
  const emergency = assessEmergencyRebuild(snapshot);
  const queue = roomMem?.buildQueue ?? [];
  const hasPendingEmergencyTask = emergency.any && queue.some(
    t => (t.state === "queued" || t.state === "site") &&
      isEmergencyTask(t, snapshot, emergency),
  );
  return shouldPlanDomain(
    layout.state,
    layout.nextPlanTick,
    layout.nextGapPlanTick,
    layout.anchor !== undefined,
    Object.keys(gaps).length > 0,
    tick,
    roomMem?.lastRcl,
    snapshot.rcl,
    emergency.any,
    hasPendingEmergencyTask,
  );
}

/**
 * 目标清单缺口落盘（观测通道）：Memory.kernel.layoutGaps[roomName] = type → 缺口数。
 * 设计约束（plan §7）：Memory 不存运行时索引 — 缺口字典是「短 key + 少量数字」，仅在实际
 * 缺口集合变化时写入，稳定态不产生序列化抖动；缺口闭合后删除该房条目（不留历史）。
 */
function recordLayoutGaps(roomName: string, gaps: StructureGaps): void {
  Memory.kernel ??= {};
  const prev = Memory.kernel.layoutGaps?.[roomName];
  const keys = Object.keys(gaps);
  if (keys.length === 0) {
    if (prev !== undefined) {
      const store = Memory.kernel.layoutGaps ??= {};
      delete store[roomName];
    }
    return;
  }
  if (prev === undefined || Object.keys(prev).length !== keys.length) {
    const store = Memory.kernel.layoutGaps ??= {};
    store[roomName] = { ...gaps };
    return;
  }
  for (const k of keys) {
    if (prev[k] !== gaps[k]) {
      const store = Memory.kernel.layoutGaps ??= {};
      store[roomName] = { ...gaps };
      return;
    }
  }
}

// ─── Spawn 重建 relocation（P0 修复：避免原位被占时死循环）──

/**
 * D2 归位：spawn 重建 relocation 纯函数已下沉到 domain/layout/planner.ts。
 * 系统侧薄壳——从 room.getTerrain() 注入 getTerrain 函数。
 */
function isPositionBuildable(
  room: Room,
  x: number,
  y: number,
  occupiedSet: Set<number>,
): boolean {
  const terrain = room.getTerrain();
  return isPositionBuildableDomain(x, y, (tx, ty) => terrain.get(tx, ty) === TERRAIN_MASK_WALL, occupiedSet);
}

/**
 * 在锚点附近螺旋搜索可建 spawn 的替代位置。系统侧薄壳委托给纯函数。
 */
function findSpawnRelocationPosition(
  room: Room,
  anchor: { x: number; y: number },
  occupiedSet: Set<number>,
): { x: number; y: number } | undefined {
  const terrain = room.getTerrain();
  return findSpawnRelocationPositionDomain(
    anchor,
    (x, y) => terrain.get(x, y) === TERRAIN_MASK_WALL,
    occupiedSet,
  );
}

// ─── P1-4 拆改辅助 ─────────────────────────────────────────

/**
 * 为死资产 link 找到对应的替代 build task。
 * 关联逻辑：死资产 link 紧邻某 source → createSourceLinkTasks 为同一 source 生成替代
 * 任务（key = `logistics.link.source.<sourceId>`）；本函数遍历 queue 中 queued 状态的
 * link 任务，找到紧邻同一 source 的任务作为替代。死 link 不紧邻 source（异常，死资产判定
 * 要求 role=source）或 queue 无 queued 替代任务时返回 undefined。
 * 导出便于单测覆盖关联逻辑（2026-08-02 review：曾因调用层用 existingKeys 过滤导致
 * 恒为空，已修复并补测试）。
 */
export function findReplacementForDeadLink(
  deadLink: { pos: { x: number; y: number } },
  snapshot: RoomSnapshot,
  newLinkTasks: readonly BuildTask[],
): BuildTask | undefined {
  // 找到死 link 紧邻的 source（range <= 1）。
  const adjacentSource = snapshot.sources.find(
    s => Math.abs(s.pos.x - deadLink.pos.x) <= 1 && Math.abs(s.pos.y - deadLink.pos.y) <= 1,
  );
  if (!adjacentSource) return undefined;
  // 替代任务紧邻同一 source（但位置不同 — occupiedSet 排除了死 link 位置）。
  // 只匹配 queued 状态：done 表示替代 link 已建成，此时死资产仍在说明替代也是
  // 死资产 → 不应创建拆改计划（应由 fallback 路径 markLinkConstrained 处理）。
  return newLinkTasks.find(
    t => t.structureType === STRUCTURE_LINK &&
      t.state === "queued" &&
      Math.abs(t.pos.x - adjacentSource.pos.x) <= 1 &&
      Math.abs(t.pos.y - adjacentSource.pos.y) <= 1,
  );
}
