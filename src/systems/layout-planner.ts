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
  createStorageLinkTask,
  createControllerLinkTask,
  createExtractorTask,
  type BuildTaskCandidate,
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
import { placeStructures, placementsToCandidates, DEFAULT_PLACER_CONFIG } from "../domain/layout/constraint-placer";
import { assessEmergencyRebuild, isEmergencyTask } from "../domain/construction/queue";

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

    // 确定锚点 — 优先使用 live spawn 位置；spawn 被毁时回退到存储锚点（紧急重建）。
    if (snapshot.spawns.length > 0) {
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
    } else if (layout.anchor === undefined) {
      // 无 spawn 且无存储锚点 — 初始 bootstrap 前的正常状态，无法规划。
      return;
    }
    // spawn 被毁但 layout.anchor 已设置时，使用存储锚点继续规划（紧急重建路径）。

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

    const globalSiteCount = ctx.globalSiteCount;
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
    // 同时构建位置集合 — 防止不同 key 的任务占据同一格子（P0 修复：
    // 旧实现只按 key 去重，constraint.extension.* 和 core.ext.* 两个命名空间
    // 会在同一位置生成重复任务，导致 buildQueue 中同位置多任务相互阻塞）。
    const existingKeys = new Set<string>();
    const existingPositions = new Set<string>();
    for (const t of queue) {
      existingKeys.add(t.key);
      existingPositions.add(`${t.pos.x},${t.pos.y}`);
    }

    // 1. 核心结构任务 — 按 CONFIG.layout.mode 分支。
    // tryAddTask 统一封装 key + position 双重去重，防止同位置多任务。
    const tryAddTask = (candidate: BuildTaskCandidate): boolean => {
      if (existingKeys.has(candidate.key)) return false;
      const posKey = `${candidate.pos.x},${candidate.pos.y}`;
      if (existingPositions.has(posKey)) return false;
      queue.push(candidateToBuildTask(candidate));
      existingKeys.add(candidate.key);
      existingPositions.add(posKey);
      return true;
    };
    if (CONFIG.layout.mode === "constraint") {
      // ── 约束推导模式：从地形约束推导结构位置 ──
      const terrain = room.getTerrain();
      const getTerrain = (x: number, y: number): boolean => terrain.get(x, y) === TERRAIN_MASK_WALL;
      const field = computeDistanceField(getTerrain);
      // 能量端点：source + controller 位置，用于评分加权（让物流结构偏好靠近能量流转路径）。
      const energyEndpoints: { x: number; y: number }[] = [];
      for (const s of snapshot.sources) energyEndpoints.push({ x: s.pos.x, y: s.pos.y });
      if (snapshot.controller) energyEndpoints.push({ x: snapshot.controller.pos.x, y: snapshot.controller.pos.y });
      const placements = placeStructures(anchor, field, getTerrain, snapshot.rcl, occupiedSet, DEFAULT_PLACER_CONFIG, energyEndpoints);
      const constraintCandidates = placementsToCandidates(placements, snapshot.roomName);

      for (const candidate of constraintCandidates) {
        if (tryAddTask(candidate)) tasksAdded = true;
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
              existingPositions.add(`${relocated.pos.x},${relocated.pos.y}`);
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
        if (tryAddTask(candidate)) tasksAdded = true;
      }
    }

    // 2. Source container 任务。
    const sourceContainerCandidates = createSourceContainerTasks(
      snapshot,
      room,
      validationOptions,
    );
    for (const candidate of sourceContainerCandidates) {
      if (tryAddTask(candidate)) {
        tasksAdded = true;
        targetingChanged = true;
      }
    }

    // 3. Controller container 任务（RCL3+）。
    const controllerContainer = createControllerContainerTask(
      snapshot,
      room,
      validationOptions,
    );
    if (controllerContainer) {
      if (tryAddTask(controllerContainer)) {
        tasksAdded = true;
        targetingChanged = true;
      }
    }

    // 3.5 Link 任务（RCL5+）— 按角色优先级分配有限的 link 槽位。
    //
    // RCL 分配策略（CONTROLLER_STRUCTURES link 上限：RCL5=2, RCL6=3, RCL7=4, RCL8=6）:
    //   RCL5 (2 links): source(1) + storage   → 最小可用 link 网络
    //   RCL6 (3 links): + controller           → 站桩升级链打通
    //   RCL7 (4 links): + source(2)            → 双 source 全覆盖
    //   RCL8 (6 links): + 2 hub                 → 终局枢纽
    //
    // 队列感知：统计 BuildQueue 中已有的 link 任务数，防止超额分配。
    // 每放置一个 link 任务后递增 queuedLinks，后续函数据此判断剩余槽位。
    let queuedLinks = queue.filter(
      t => t.structureType === STRUCTURE_LINK,
    ).length;

    // 3.5a Source link（第一趟，maxNew=1）— 保证至少 1 个 source link。
    //    优先放第一个 source，不消费所有槽位。
    const sourceLinkFirst = createSourceLinkTasks(
      snapshot,
      room,
      validationOptions,
      queuedLinks,
      1, // maxNew=1：只放 1 个 source link，给 storage 留槽位。
    );
    for (const candidate of sourceLinkFirst) {
      if (tryAddTask(candidate)) {
        queuedLinks++;
        tasksAdded = true;
        targetingChanged = true;
      }
    }

    // 3.5b Storage link — link 网络的「最后一公里」：source→storage 物流打通。
    //    RCL5 仅 2 个槽位时，storage link 优先于第二个 source link。
    const storageLink = createStorageLinkTask(
      snapshot,
      room,
      validationOptions,
      queuedLinks,
    );
    if (storageLink) {
      if (tryAddTask(storageLink)) {
        queuedLinks++;
        tasksAdded = true;
        targetingChanged = true;
      }
    }

    // 3.5c Controller link — 站桩升级链：source→controller 0 通勤升级。
    //    RCL6+ 才有第 3 个槽位（RCL5 的 2 槽位已被 source + storage 占用）。
    const controllerLink = createControllerLinkTask(
      snapshot,
      room,
      validationOptions,
      queuedLinks,
    );
    if (controllerLink) {
      if (tryAddTask(controllerLink)) {
        queuedLinks++;
        tasksAdded = true;
        targetingChanged = true;
      }
    }

    // 3.5d Source link（第二趟，maxNew=∞）— 放置剩余 source link。
    //    RCL7+ 有第 4 个槽位时，为第二个 source 也放置 link。
    const sourceLinkRest = createSourceLinkTasks(
      snapshot,
      room,
      validationOptions,
      queuedLinks,
    );
    for (const candidate of sourceLinkRest) {
      if (tryAddTask(candidate)) {
        queuedLinks++;
        tasksAdded = true;
        targetingChanged = true;
      }
    }

    // 3.7 Extractor 任务（RCL6+）— 矿位上，补齐矿物产业链第一环。
    {
      const extractor = createExtractorTask(snapshot);
      if (extractor) {
        if (tryAddTask(extractor)) tasksAdded = true;
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
        const posKey = `${task.pos.x},${task.pos.y}`;
        if (existingKeys.has(task.key) || existingPositions.has(posKey)) continue;
        queue.push(task);
        existingKeys.add(task.key);
        existingPositions.add(posKey);
        tasksAdded = true;
      }
    }

    // ── 紧急 spawn 重建 ──
    // spawn 不在 RCL_BATCHES 中（初始 spawn 由玩家放置），
    // 因此正常规划流程不会为其生成任务。spawn 被毁时在此手动入队。
    // P0 修复：原位被占时在锚点附近找替代位置，避免 createConstructionSite 死循环。
    if (snapshot.spawns.length === 0 && layout.anchor !== undefined) {
      const anchorPos = unpackPos(layout.anchor);
      const spawnKey = `constraint.spawn.01`;
      if (!existingKeys.has(spawnKey)) {
        // 确定重建位置：优先锚点，被占时螺旋搜索替代位置
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
          tasksAdded = true;
          targetingChanged = true;
        }
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

  // 紧急重建：关键基建缺失时立即触发规划，不等 50 tick 周期。
  // 仅当房间已规划过（anchor 已设置）时检查 — 初始 bootstrap 不触发。
  // 额外检查队列中是否已有待建任务：已有则无需重复规划，避免每 tick 跑规划浪费 CPU。
  if (layout.anchor !== undefined) {
    const emergency = assessEmergencyRebuild(snapshot);
    if (emergency.any) {
      const queue = roomMem?.buildQueue ?? [];
      const hasPendingTask = queue.some(
        t => (t.state === "queued" || t.state === "site") &&
          isEmergencyTask(t, snapshot, emergency),
      );
      if (!hasPendingTask) return true;
    }
  }

  return false;
}

// ─── Spawn 重建 relocation（P0 修复：避免原位被占时死循环）──

/**
 * 检测位置是否可建建筑（地形非墙 + 无已有结构占用）。
 * spawn 不能建在出口格（0 或 49），边界限制 1-48。
 */
function isPositionBuildable(
  room: Room,
  x: number,
  y: number,
  occupiedSet: Set<number>,
): boolean {
  if (x < 1 || x > 48 || y < 1 || y > 48) return false;
  const terrain = room.getTerrain();
  if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;
  if (occupiedSet.has(packPos(x, y))) return false;
  return true;
}

/**
 * 在锚点附近螺旋搜索可建 spawn 的替代位置。
 * 搜索范围 ±3 格（避免 spawn 离核心太远）。
 * 返回第一个可建位置，无则 undefined。
 */
function findSpawnRelocationPosition(
  room: Room,
  anchor: { x: number; y: number },
  occupiedSet: Set<number>,
): { x: number; y: number } | undefined {
  for (let radius = 1; radius <= 3; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        // 只搜索当前半径的边缘（螺旋外扩）
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        if (isPositionBuildable(room, x, y, occupiedSet)) {
          return { x, y };
        }
      }
    }
  }
  return undefined;
}

