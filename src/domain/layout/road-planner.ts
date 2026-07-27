import type { Blueprint } from "./types";
import { packPos } from "./types";
import type { RoomSnapshot } from "../../kernel/contracts";
import { CONFIG } from "../../config";
import { globalCache } from "../../kernel/global-cache";
import { createCoreRoadTasks, candidateToBuildTask } from "./task-factory";
import { evaluateRoadCandidates } from "./road-policy";
import { planCorridorRoads } from "./corridor-roads";

/**
 * 统一道路规划 — 合并三种道路来源，由 layout-planner 编排器调用。
 *
 * 提取自 layout-planner.ts（Phase 1 重构），行为完全等价：
 *   1. 核心棋盘格路（RCL2+，结构旁走道）
 *   2. 流量采样路（RCL4+，实测交通热度）
 *   3. 确定性走廊路（source↔core↔controller，PathFinder）
 *
 * 门禁规则（不变）：
 *   - priority <= 1 的 buildQueue 任务未清空前，不生成核心路和走廊路
 *   - 流量路 RCL4+ 才启用
 *   - 走廊路每次只规划一条（前一条建完再规划下一条）
 *
 * 交通数据轮换（rotateTraffic）是独立函数，无论是否生成道路都必须每规划周期调用。
 */

/** planRoads 的输入上下文。 */
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
}

/**
 * 规划本周期应入队的道路任务。
 *
 * 返回待入队的 BuildTask 列表（调用方负责 push 到 queue + 更新 existingKeys）。
 * 内部已做去重（不会返回 existingKeys 中已有的 key，也不会返回本批次重复 key）。
 */
export function planRoads(ctx: RoadPlanContext): BuildTask[] {
  const { snapshot, room, blueprint, anchor, occupiedSet, queue, existingKeys } = ctx;
  const tasks: BuildTask[] = [];
  // 本批次已收录的 key（防止三种道路来源之间重复）。
  const batchKeys = new Set<string>();

  const isDuplicate = (key: string): boolean =>
    existingKeys.has(key) || batchKeys.has(key);
  const markAdded = (key: string): void => { batchKeys.add(key); };

  // 基础设施门禁：仅当 priority === 0（tower/storage）的 queued 任务存在时，
  // 不生成核心路和走廊路。
  //
  // 旧实现用 priority <= 1，导致 RCL2-4 阶段 buildQueue 中几乎总有
  // priority 1 的 extension 排队，道路被永久冻结——恰是 hauler 最需要路的时期。
  // 道路本身是 priority 3 + 独立 site 名额（maxRoadSitesPerRoom），
  // 不会挤占 extension/container 的建造名额，门禁只需保护 tower/storage 这种
  // 真正关键的 priority 0 结构即可。
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
  if (snapshot.rcl >= 4) {
    const g = globalCache();
    const currentTraffic = g.roomTraffic?.[snapshot.roomName];
    const prevTraffic = g.prevRoomTraffic?.[snapshot.roomName];

    // 显式传入 CONFIG.layout.road — 不传则 road-policy 内置默认生效，
    // config 沦为无人消费的死配置（调参静默不生效）。
    const roadCandidates = evaluateRoadCandidates(
      snapshot.roomName,
      snapshot,
      currentTraffic,
      prevTraffic,
      CONFIG.layout.road,
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
  // 不受 hasPendingCritical 冻结：重建期（P0 任务排队时）恰恰是走廊路
  // 最需要恢复的窗口 — source↔core 无路时 hauler 通勤减速，重建反而更慢。
  // 走廊路安全性：PathFinder 确定性生成（不依赖交通数据）、priority 3 +
  // 独立 road site 名额（maxRoadSitesPerRoom）、每周期仅一条走廊 ≤12 格，
  // 且 tryCreateSite 按 priority 排序 — P0 关键结构永远先建，走廊只补空档。
  {
    // 保护蓝图未来格 — 走廊路不得占用未来的 extension/结构位置。
    const protectedPositions = new Set<number>();
    for (const cell of blueprint.cells) {
      protectedPositions.add(packPos(anchor.x + cell.dx, anchor.y + cell.dy));
    }

    const corridorRoads = planCorridorRoads(room, snapshot, undefined, undefined, protectedPositions);
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
 * 交通数据轮换 — 将当前窗口快照为 prevTraffic，然后清零当前窗口。
 *
 * 无论 RCL、无论是否生成道路，每规划周期必须调用一次。
 * 确保 RCL4 启用流量路时已有 prevTraffic 可供双窗口比较。
 */
export function rotateTraffic(roomName: string): void {
  const g = globalCache();
  const currentTraffic = g.roomTraffic?.[roomName];
  if (currentTraffic) {
    if (!g.prevRoomTraffic) g.prevRoomTraffic = {};
    g.prevRoomTraffic[roomName] = { ...currentTraffic };
  }
  if (g.roomTraffic) {
    g.roomTraffic[roomName] = {};
  }
}
