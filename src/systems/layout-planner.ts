import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import { getRoomLayoutData, markLayoutDirty } from "../kernel/segment-store";
import { COMPACT_CORE_V1 } from "../domain/layout/templates/compact-core-v1";
import {
  blueprintToTasks,
  candidateToBuildTask,
  createSourceContainerTasks,
  createControllerContainerTask,
  createSourceLinkTasks,
  createControllerLinkTask,
  createExtractorTask,
  createDefenseTasks,
} from "../domain/layout/task-factory";
import {
  collectCompletedKeys,
  collectCompletedKeysFromStructures,
  precomputeStructureCounts,
  buildOccupiedPositionSet,
} from "../domain/layout/validation";
import { evaluateRoadCandidates } from "../domain/layout/road-policy";
import { planCorridorRoads } from "../domain/layout/corridor-roads";
import { evaluateCandidate, scoreCandidate } from "../domain/layout/candidate-score";
import { packPos, unpackPos } from "../domain/layout/types";

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
        version: 1,
        templateId: COMPACT_CORE_V1.id,
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
      const candidateInput = evaluateCandidate(room, COMPACT_CORE_V1, spawn.pos.x, spawn.pos.y);
      if (candidateInput) {
        layout.anchorScore = scoreCandidate(candidateInput);
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
    for (const key of collectCompletedKeysFromStructures(COMPACT_CORE_V1, anchor.x, anchor.y, snapshot)) {
      completedKeys.add(key);
    }

    // 直接使用 RoomSnapshot 中的 minerals 数据 — RoomSnapshot 已在 buildRoomSnapshot
    // 中通过 room.find(FIND_MINERALS) 采集，此处无需重复调用（避免 CPU 浪费）。
    const minerals = snapshot.minerals as readonly { pos: { x: number; y: number } }[];

    // 预计算结构计数与占用集合 — 每规划周期构建一次，供所有 cell 验证复用。
    // 消除旧实现 O(cells × structures) 的重复扫描（50+ cells × 30+ structures）。
    const structureCounts = precomputeStructureCounts(snapshot);
    const occupiedSet = buildOccupiedPositionSet(snapshot, minerals);

    const globalSiteCount = countGlobalSites(ctx);
    const validationOptions = {
      completedKeys,
      globalSiteCount,
      maxGlobalSites: CONFIG.construction.maxGlobalSites,
      minerals,
      structureCounts,
      occupiedSet,
    };

    // 预构建队列 key 集合 — O(1) 去重，替代旧实现每候选 O(queue) 的 some() 扫描。
    const existingKeys = new Set<string>();
    for (const t of queue) existingKeys.add(t.key);

    // 1. 核心模板任务。
    const coreCandidates = blueprintToTasks(
      COMPACT_CORE_V1,
      anchor.x,
      anchor.y,
      snapshot.roomName,
      room,
      snapshot,
      snapshot.rcl,
      validationOptions,
    );

    for (const candidate of coreCandidates) {
      if (candidate.validation !== "ok") continue;
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

    // 3.8 动态防御工事（RCL4+）— 出口方向感知的 rampart 核心盾。
    {
      const exitPositions = room.find(FIND_EXIT).map(p => ({ x: p.x, y: p.y }));
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
        tasksAdded = true;
      }
    }

    // 4. 流量道路候选 — RCL4+ 才启用。
    // RCL2-3 阶段经济聚焦基础设施（extension/container），流量路是锦上添花，
    // 过早启用会淹没 buildQueue 抢占 builder 工时。RCL4 有 storage 后物流压力增大，
    // 此时按实际交通热度铺路才有意义。
    if (snapshot.rcl >= 4) {
      const g = globalCache();
      const currentTraffic = g.roomTraffic?.[snapshot.roomName];
      const prevTraffic = g.prevRoomTraffic?.[snapshot.roomName];

      const roadCandidates = evaluateRoadCandidates(
        snapshot.roomName,
        snapshot,
        currentTraffic,
        prevTraffic,
      );

      for (const candidate of roadCandidates) {
        if (existingKeys.has(candidate.key)) continue;
        queue.push({
          key: candidate.key,
          pos: candidate.pos,
          structureType: STRUCTURE_ROAD,
          priority: candidate.priority as 0 | 1 | 2 | 3,
          state: "queued",
          attempts: 0,
          retryAt: 0,
        });
        existingKeys.add(candidate.key);
        tasksAdded = true;
      }
    }

    // 交通数据轮换（无论 RCL 都执行，确保 RCL4 时已有 prevTraffic 可用）。
    {
      const g = globalCache();
      const currentTraffic = g.roomTraffic?.[snapshot.roomName];
      if (currentTraffic) {
        if (!g.prevRoomTraffic) g.prevRoomTraffic = {};
        g.prevRoomTraffic[snapshot.roomName] = { ...currentTraffic };
      }
      if (g.roomTraffic) {
        g.roomTraffic[snapshot.roomName] = {};
      }
    }

    // 5. 确定性走廊路（source container↔核心↔controller container）。
    // 流量采样修不到长走廊中段，这里用 PathFinder 沿最优路径直接铺路，
    // hauler 移动成本减半 → 运力翻倍。priority 3 背景建造，不拖慢 RCL 冲刺。
    //
    // 前置门禁：当前队列中仍有 priority <= 1 的 "queued" 任务时不生成 road。
    // 原因：extension/container 是经济基础设施，必须先建完；road 是锦上添花，
    // 不能在基础设施未完成时淹没 buildQueue 抢占 builder 工时。
    {
      const hasPendingInfrastructure = queue.some(
        t => t.priority <= 1 && t.state === "queued",
      );

      if (!hasPendingInfrastructure) {
        // 保护蓝图未来格 — 走廊路不得占用未来的 extension/结构位置，
        // 否则该格会被 validateBuildCell 判定 "occupied" 导致 extension 永久消失。
        const protectedPositions = new Set<number>();
        for (const cell of COMPACT_CORE_V1.cells) {
          protectedPositions.add(packPos(anchor.x + cell.dx, anchor.y + cell.dy));
        }

        const corridorRoads = planCorridorRoads(room, snapshot, undefined, undefined, protectedPositions);
        for (const pos of corridorRoads) {
          const key = `road.${snapshot.roomName}.${pos.x}.${pos.y}`;
          if (existingKeys.has(key)) continue;
          queue.push({
            key,
            pos: { x: pos.x, y: pos.y, roomName: snapshot.roomName },
            structureType: STRUCTURE_ROAD,
            priority: 3,
            state: "queued",
            attempts: 0,
            retryAt: 0,
          });
          existingKeys.add(key);
          tasksAdded = true;
        }
      }
    }

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
