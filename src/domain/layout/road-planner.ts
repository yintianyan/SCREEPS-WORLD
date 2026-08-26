import type { Blueprint } from "./types";
import { packPos } from "./types";
import type { RoomSnapshot } from "../../kernel/contracts";
import { CONFIG } from "../../config";
import { createCoreRoadTasks, candidateToBuildTask } from "./task-factory";
import { evaluateRoadCandidates } from "./road-policy";
import { planCorridorRoads, type CorridorPathCacheStore, DEFAULT_CORRIDOR_OPTIONS } from "./corridor-roads";

/**
 * 统一道路规划 — 合并三种道路来源，由 layout-planner 编排器调用
 * （提取自 layout-planner.ts Phase 1 重构，行为等价）：核心棋盘格路
 * （RCL2+）、流量采样路（RCL4+）、确定性走廊路（PathFinder）。
 * 门禁：priority 0（tower/storage）的 queued 任务未清空前不生成核心路；
 * 走廊路每次只规划一条。rotateTraffic 独立于道路生成，每规划周期必调。
 */


export interface RoadPlanContext {
  readonly snapshot: RoomSnapshot;
  readonly room: Room;
  readonly blueprint: Blueprint;
  readonly anchor: { x: number; y: number };
  readonly occupiedSet: ReadonlySet<number>;
  /** 当前 buildQueue（用于基础设施门禁检查）。 */
  readonly queue: readonly BuildTask[];
  /** 已入队的 key 集合（用于去重，只读引用；内部用本地 Set 追踪本批次新增）。 */
  readonly existingKeys: ReadonlySet<string>;
  /** 【G-J 合规】当前 tick（domain 不触 Game 全局）。 */
  readonly tick: number;
  /** 【D-1 修复】当前采样窗口交通数据（由 system 层从 globalCache 注入，domain 层不再直读 globalCache）。 */
  readonly currentTraffic?: Record<string, number>;
  /** 【D-1 修复】上一采样窗口交通数据（同上）。 */
  readonly prevTraffic?: Record<string, number>;
  /** 【D-2 修复】走廊路路径缓存接口（由 system 层注入，domain 不再直读 globalCache）。 */
  readonly corridorCacheStore?: CorridorPathCacheStore;
  /** 【D-2 修复】蓝图受保护位置集合（走廊路不得占用未来结构位置）。 */
  readonly protectedPositionsFactory?: () => Set<number>;
}

/** 规划本周期应入队的道路任务；调用方负责 push 到 queue 并更新 existingKeys，内部已去重。 */
export function planRoads(ctx: RoadPlanContext): BuildTask[] {
  const { snapshot, room, blueprint, anchor, occupiedSet, queue, existingKeys } = ctx;
  const tasks: BuildTask[] = [];

  const batchKeys = new Set<string>();

  const isDuplicate = (key: string): boolean =>
    existingKeys.has(key) || batchKeys.has(key);
  const markAdded = (key: string): void => { batchKeys.add(key); };

  // 基础设施门禁：有 priority 0（tower/storage）的 queued 任务时不生成核心路。
  // 旧实现用 priority <= 1 导致 RCL2-4 阶段 extension 常排队、道路被永久冻结
  // （恰是 hauler 最需要路的时期）；道路为 priority 3 + 独立 site 名额
  // （maxRoadSitesPerRoom），不会挤占 extension/container，门禁只需护 priority 0。
  const hasPendingCritical = queue.some(
    t => t.priority === 0 && t.state === "queued",
  );

  // ── 1. 核心棋盘格路（RCL2+）──
  if (!hasPendingCritical) {
    const coreRoadCandidates = createCoreRoadTasks(
      blueprint,
      anchor.x,
      anchor.y,
      snapshot.roomName,
      room,
      snapshot,
      occupiedSet,
    );
    for (const candidate of coreRoadCandidates) {
      if (isDuplicate(candidate.key)) continue;
      tasks.push(candidateToBuildTask(candidate));
      markAdded(candidate.key);
    }
  }

  // ── 2. 流量采样路（RCL4+）──
  // 【D-1 修复】交通数据由调用方注入（currentTraffic / prevTraffic），
  // domain 层不再直读 globalCache。
  if (snapshot.rcl >= 4) {
    const currentTraffic = ctx.currentTraffic;
    const prevTraffic = ctx.prevTraffic;

    // 显式传 CONFIG.layout.road 与 rcl（否则 config 成无人消费的死配置，
    // 调参静默不生效）；rcl 启用 P3 分档阈值（RCL7-8=50，RCL2-6=5）。
    const roadCandidates = evaluateRoadCandidates(
      snapshot.roomName,
      snapshot,
      currentTraffic,
      prevTraffic,
      CONFIG.layout.road,
      snapshot.rcl,
    );

    for (const candidate of roadCandidates) {
      if (isDuplicate(candidate.key)) continue;
      tasks.push({
        key: candidate.key,
        pos: candidate.pos,
        structureType: STRUCTURE_ROAD,
        priority: candidate.priority as 0 | 1 | 2 | 3,
        state: "queued",
        attempts: 0,
        retryAt: 0,
      });
      markAdded(candidate.key);
    }
  }

  // ── 3. 确定性走廊路（source↔core↔controller）──
  // 不受 hasPendingCritical 冻结：重建期 P0 排队恰是走廊路最需恢复的窗口
  // （source↔core 无路则 hauler 减速、重建更慢）。安全性：PathFinder 确定性
  // 生成 + priority 3 + 独立 road site 名额 + 每周期仅一条 ≤12 格，且
  // tryCreateSite 按 priority 排序 — P0 先建，走廊只补空档。
  {
    // 保护蓝图未来格 — 走廊路不得占用未来的 extension/结构位置。
    const protectedPositions = new Set<number>();
    for (const cell of blueprint.cells) {
      protectedPositions.add(packPos(anchor.x + cell.dx, anchor.y + cell.dy));
    }

    const corridorRoads = planCorridorRoads(
      room, snapshot, ctx.tick,
      DEFAULT_CORRIDOR_OPTIONS, undefined, protectedPositions,
      anchor, ctx.corridorCacheStore,
    );
    for (const pos of corridorRoads) {
      const key = `road.${snapshot.roomName}.${pos.x}.${pos.y}`;
      if (isDuplicate(key)) continue;
      tasks.push({
        key,
        pos: { x: pos.x, y: pos.y, roomName: snapshot.roomName },
        structureType: STRUCTURE_ROAD,
        priority: 3,
        state: "queued",
        attempts: 0,
        retryAt: 0,
      });
      markAdded(key);
    }
  }

  return tasks;
}

/**
 * 【D-1 修复】交通数据轮换接口 — domain 层不再直读 globalCache。
 * 调用方（layout-planner system 层）提供轮换操作函数，
 * domain 层只负责声明「需要轮换」这一意图。
 *
 * 无论 RCL、无论是否生成道路，每规划周期必须调用一次。
 * 确保 RCL4 启用流量路时已有 prevTraffic 可供双窗口比较。
 */
export interface TrafficRotator {
  /** 将当前窗口快照为 prevTraffic，然后清零当前窗口。 */
  rotate(roomName: string): void;
}
