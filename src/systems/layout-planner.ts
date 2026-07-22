import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { getRoomLayoutData, markLayoutDirty } from "../kernel/segment-store";
import { COMPACT_CORE_V2 } from "../domain/layout/templates/compact-core-v2";
import {
  blueprintToTasks,
  candidateToBuildTask,
  relocateCandidate,
  createSourceContainerTasks,
  createControllerContainerTask,
  createSourceLinkTasks,
  createControllerLinkTask,
  createExtractorTask,
} from "../domain/layout/task-factory";
import {
  collectCompletedKeys,
  collectCompletedKeysFromStructures,
  precomputeStructureCounts,
  buildOccupiedPositionSet,
  buildObstaclePositionSet,
} from "../domain/layout/validation";
import { planRoads, rotateTraffic } from "../domain/layout/road-planner";
import { evaluateCandidate, scoreCandidate } from "../domain/layout/candidate-score";
import { packPos, unpackPos } from "../domain/layout/types";
import { computeDistanceField } from "../domain/layout/terrain-analysis";
import { diagnoseAnchor } from "../domain/layout/anchor-selection";
import { placeStructures, placementsToCandidates } from "../domain/layout/constraint-placer";

/**
 * 布局规划器 — P3 低频系统，负责生成和维护建造计划。
 *
 * 职责（plan §5.6.3）：
 *   - 在触发条件满足时重新规划布局
 *   - 将蓝图 cells 转为 BuildTask 并推入 BuildQueue
 *   - 动态生成 source/controller container 任务
 *   - 评估交通热度并生成道路候选
 *
 * 触发条件（由 shouldPlan 判定，每 tick 调用一次但内部早返回）：
 *   - 首次运行（无 LayoutMemory）
 *   - controller 等级变化
 *   - nextPlanTick 到期（默认 50 tick）
 *   - layout.state 被人工设为 proposed
 *
 * 不使用 System.interval — 因 kernel.shouldRunSystem 用 tick % interval 跳过，
 * 会导致 RCL 变化触发最多延迟 interval-1 tick。改为每 tick 调用 planRoom，
 * 由 shouldPlan 内部的 nextPlanTick 和 RCL 检查控制实际规划时机。
 *
 * 只在 Green 或 Guarded 且房间不处于 BOOTSTRAP/RECOVERY/DEFENSE 时运行。
 */
export const layoutPlannerSystem: System & {
  planRoom(
    snapshot: import("../kernel/contracts").RoomSnapshot,
    ctx: TickContext,
  ): void;
} = {
  name: "layout-planner",
  priority: 3 as Priority,

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
      };
    }

    const layout = roomMem.layout;

    // 人工 manual 状态不自动规划。
    if (layout.state === "manual") return;

    // 确定锚点 — 主 spawn 位置。
    if (snapshot.spawns.length === 0) {
      // 无 spawn — 无法以 spawn 为锚点规划核心。
      return;
    }

    const spawn = snapshot.spawns[0]!;
    const anchorPacked = packPos(spawn.pos.x, spawn.pos.y);

    // 首次设置锚点，或 spawn 重建在新位置时更新锚点。
    // spawn 位置变化时清空 segment 中的 overrides 和 blocked（旧偏移记录失效）并递增 revision，
    // 触发所有携带旧 revision 的 assignment 失效（见 validateAssignment 的 revision 检查）。
    if (layout.anchor === undefined) {
      layout.anchor = anchorPacked;
      // 接通 candidate-score：评估所选锚点质量并存储（诊断 + 未来多房间选址参考）。
      // 此前 evaluateCandidate/scoreCandidate 是死代码，现在在锚点确立时实际执行。
      const candidateInput = evaluateCandidate(room, COMPACT_CORE_V2, spawn.pos.x, spawn.pos.y);
      if (candidateInput) {
        layout.anchorScore = scoreCandidate(candidateInput);
      }

      // Phase 3 诊断：Distance Transform 锚点质量评估（不改变运行时行为）。
      // 计算地形开放度，评估当前 spawn 位置在所有候选中的排名。
      // 结果仅输出日志，供人工判断锚点质量；Phase 4 才启用约束推导放置。
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
          ? { x: snapshot.minerals[0].pos.x, y: snapshot.minerals[0].pos.y }
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
      // 冷数据在 segment 中重置。
      const segData = getRoomLayoutData(snapshot.roomName);
      segData.overrides = {};
      segData.blocked = {};
      markLayoutDirty();
      layout.revision++;
      // 锚点变化意味着所有旧坐标失效 — 清空 buildQueue，由下次规划重建。
      roomMem.buildQueue = [];
    }

    // 检查触发条件。
    if (!shouldPlan(layout, ctx.tick, snapshot)) return;

    // 执行规划。
    layout.state = "building";
    const queue = roomMem.buildQueue ?? [];
    let tasksAdded = false;
    // revision 语义收窄：只有影响 creep 目标选择的结构（container/link/spawn/storage）
    // 入队时才递增 revision。road/extension 不改变 fillTargets/withdraw 目标，
    // 不应让全员 assignment 失效（旧实现每 50 tick 加条路就全员重选任务，纯浪费）。
    let targetingChanged = false;

    // 收集已完成 key 集合（用于依赖检查）。
    // 合并队列状态和实际已建结构，避免 done 任务被清除后依赖检查失败。
    const completedKeys = collectCompletedKeys(queue);
    const anchor = unpackPos(layout.anchor);
    for (const key of collectCompletedKeysFromStructures(COMPACT_CORE_V2, anchor.x, anchor.y, snapshot)) {
      completedKeys.add(key);
    }

    // 直接使用 RoomSnapshot 中的 minerals 数据 — RoomSnapshot 已在 buildRoomSnapshot
    // 中通过 room.find(FIND_MINERALS) 采集，此处无需重复调用（避免 CPU 浪费）。
    const minerals = snapshot.minerals as readonly { pos: { x: number; y: number } }[];

    // 预计算结构计数与占用集合 — 每规划周期构建一次，供所有 cell 验证复用。
    // 消除旧实现 O(cells × structures) 的重复扫描（50+ cells × 30+ structures）。
    const structureCounts = precomputeStructureCounts(snapshot);
    const occupiedSet = buildOccupiedPositionSet(snapshot, minerals);
    // 障碍集合（仅不可通行结构/工地）— 密封守卫：拒绝制造建筑孤岛的建造。
    const obstacleSet = buildObstaclePositionSet(snapshot);

    const globalSiteCount = countGlobalSites(ctx);
    const validationOptions = {
      completedKeys,
      globalSiteCount,
      maxGlobalSites: CONFIG.construction.maxGlobalSites,
      minerals,
      structureCounts,
      occupiedSet,
      obstacleSet,
    };

    // 预构建队列 key 集合 — O(1) 去重，替代旧实现每候选 O(queue) 的 some() 扫描。
    const existingKeys = new Set<string>();
    for (const t of queue) existingKeys.add(t.key);

    // 1. 核心模板任务（应用 segment 中的重定位 overrides：墙/占用导致搬家的 cell
    // 直接使用替代坐标，不必每周期重新搜索）。
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

    // 禁止落子集合：全部蓝图 cell 绝对坐标 + 队列任务坐标，
    // 防止重定位把两个 cell 搬到同一格。
    const forbidden = new Set<number>();
    for (const cell of COMPACT_CORE_V2.cells) {
      forbidden.add(packPos(anchor.x + cell.dx, anchor.y + cell.dy));
    }
    for (const t of queue) {
      forbidden.add(packPos(t.pos.x, t.pos.y));
    }
    const cellByKey = new Map(COMPACT_CORE_V2.cells.map(c => [c.key, c]));
    // 可重定位的永久失败（墙/占用/密封；rcl/dependency/site-limit 是瞬态，不搬家）。
    const RELOCATABLE_FAILURES: ReadonlySet<string> = new Set(["terrain", "occupied", "seal"]);

    for (const candidate of coreCandidates) {
      if (candidate.validation !== "ok") {
        // fallback relocation：extension 可搬到同 parity 的邻近格。
        if (RELOCATABLE_FAILURES.has(candidate.validation) && !existingKeys.has(candidate.key)) {
          const cell = cellByKey.get(candidate.key);
          const relocated = cell
            ? relocateCandidate(candidate, cell, room, snapshot, validationOptions, forbidden)
            : undefined;
          if (relocated) {
            queue.push(candidateToBuildTask(relocated));
            existingKeys.add(relocated.key);
            forbidden.add(packPos(relocated.pos.x, relocated.pos.y));
            // 持久化替代位置到 segment，后续周期直接复用。
            segData.overrides ??= {};
            segData.overrides[relocated.key] = packPos(relocated.pos.x, relocated.pos.y);
            markLayoutDirty();
            tasksAdded = true;
          }
        }
        continue;
      }
      if (existingKeys.has(candidate.key)) continue;
      queue.push(candidateToBuildTask(candidate));
      existingKeys.add(candidate.key);
      tasksAdded = true;
    }

    // 2. Source container 任务。
    const sourceContainerCandidates = createSourceContainerTasks(
      snapshot,
      room,
      validationOptions,
    );
    for (const candidate of sourceContainerCandidates) {
      if (existingKeys.has(candidate.key)) continue;
      queue.push(candidateToBuildTask(candidate));
      existingKeys.add(candidate.key);
      tasksAdded = true;
      targetingChanged = true; // container 影响 withdraw 目标
    }

    // 3. Controller container 任务（RCL3+）。
    const controllerContainer = createControllerContainerTask(
      snapshot,
      room,
      validationOptions,
    );
    if (controllerContainer) {
      if (!existingKeys.has(controllerContainer.key)) {
        queue.push(candidateToBuildTask(controllerContainer));
        existingKeys.add(controllerContainer.key);
        tasksAdded = true;
        targetingChanged = true; // container 影响 withdraw 目标
      }
    }

    // 3.5 Source link 任务（RCL5+）。
    const sourceLinkCandidates = createSourceLinkTasks(
      snapshot,
      room,
      validationOptions,
    );
    for (const candidate of sourceLinkCandidates) {
      if (existingKeys.has(candidate.key)) continue;
      queue.push(candidateToBuildTask(candidate));
      existingKeys.add(candidate.key);
      tasksAdded = true;
      targetingChanged = true; // link 影响能量传输目标
    }

    // 3.6 Controller link 任务（RCL5+）。
    const controllerLink = createControllerLinkTask(
      snapshot,
      room,
      validationOptions,
    );
    if (controllerLink) {
      if (!existingKeys.has(controllerLink.key)) {
        queue.push(candidateToBuildTask(controllerLink));
        existingKeys.add(controllerLink.key);
        tasksAdded = true;
        targetingChanged = true; // link 影响能量传输目标
      }
    }

    // 3.7 Extractor 任务（RCL6+）— 矿位上，补齐矿物产业链第一环。
    {
      const extractor = createExtractorTask(snapshot);
      if (extractor && !existingKeys.has(extractor.key)) {
        queue.push(candidateToBuildTask(extractor));
        existingKeys.add(extractor.key);
        tasksAdded = true;
      }
    }

    // 3.8 防御工事已提取到独立系统 defense-planner.ts（Phase 2 重构）。

    // 3.9-5. 道路规划（核心棋盘格路 + 流量采样路 + 确定性走廊路）。
    // 提取到 domain/layout/road-planner.ts — 行为等价，含基础设施门禁和去重。
    {
      const roadTasks = planRoads({
        snapshot,
        room,
        blueprint: COMPACT_CORE_V2,
        anchor,
        occupiedSet,
        queue,
        existingKeys,
      });
      for (const task of roadTasks) {
        queue.push(task);
        existingKeys.add(task.key);
        tasksAdded = true;
      }
    }

    // 交通数据轮换（无论 RCL 都执行，确保 RCL4 时已有 prevTraffic 可用）。
    rotateTraffic(snapshot.roomName);

    roomMem.buildQueue = queue;

    // 仅在影响 creep 目标选择的结构入队时递增 revision — 避免道路/extension 入队
    // 导致全员 assignment 无意义失效（旧实现每 50 tick 加条路就全员重选任务）。
    if (targetingChanged) {
      layout.revision++;
    }

    // 更新规划时间戳和 RCL 跟踪。
    layout.nextPlanTick = ctx.tick + CONFIG.layout.planInterval;
    roomMem.lastRcl = snapshot.rcl;
  },
};

/** 判断是否应该执行规划。 */
function shouldPlan(
  layout: NonNullable<RoomMemory["layout"]>,
  tick: number,
  snapshot: import("../kernel/contracts").RoomSnapshot,
): boolean {
  // 人工 proposed 状态 — 立即规划。
  if (layout.state === "proposed") return true;

  // nextPlanTick 到期。
  if (tick >= layout.nextPlanTick) return true;

  // RCL 变化。
  const roomMem = Memory.rooms[snapshot.roomName];
  if (roomMem?.lastRcl !== undefined && roomMem.lastRcl !== snapshot.rcl) {
    return true;
  }

  return false;
}

/** 统计全局活跃 site 数。 */
function countGlobalSites(ctx: TickContext): number {
  let count = 0;
  for (const snap of ctx.snapshots()) {
    count += snap.myConstructionSites.length;
  }
  return count;
}
