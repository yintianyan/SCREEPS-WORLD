import { CONFIG } from "../config";
import type { Priority, System, TickContext, RoomSnapshot } from "../kernel/contracts";
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
import { globalCache } from "../kernel/global-cache";

/**
 * 防御规划器 — P3 独立系统，负责生成 rampart/wall 建造任务。
 *
 * 策略（Phase 5 升级）：
 *   1. 优先使用 min-cut 算法：用最少 rampart 封锁所有入侵路径
 *   2. Min-cut 失败（割集过大/地形太开放）时 fallback 到扇区防御
 *
 * 触发：interval 10（每 10 tick 评估一次）。
 *
 * CPU 优化（P1 修复）：
 *   - min-cut 结果缓存在 global heap，仅在核心结构变化时重算
 *   - bucket < 5000 时完全跳过（非关键系统不能拖垮生存）
 *   - buildQueue 中已有 mincut rampart key 时跳过计算
 *   - room.find(FIND_EXIT) 结果缓存在 heap（地形不变）
 */
export const defensePlannerSystem: System = {
  name: "defense-planner",
  priority: 3 as Priority,
  interval: 10,

  run(ctx: TickContext): void {
    // P3 在 conserve/recovery 下不运行。
    if (ctx.budget.tier === "conserve" || ctx.budget.tier === "recovery") return;

    // Bucket 门禁 — 低于 5000 时完全跳过防御规划。
    // 防御规划是非关键的 P3 工作，不能在 CPU 紧张时拖垮生存。
    if (Game.cpu.bucket < 5000) return;

    for (const snapshot of ctx.snapshots()) {
      planDefense(snapshot);
    }
  },
};

/** Min-cut 最大 rampart 数（超过则 fallback 到扇区）。 */
const MAX_CUT_RAMPARTS = 30;

/** 缓存的 min-cut 结果。 */
interface MinCutCache {
  /** 核心结构位置的签名（用于检测是否需要重算）。 */
  signature: string;
  /** min-cut 计算结果。 */
  result: { rampartPositions: { x: number; y: number }[]; complete: boolean };
  /** 缓存创建的 tick。 */
  tick: number;
}

/** 缓存的出口位置。 */
interface ExitCache {
  positions: { x: number; y: number }[];
  tick: number;
}

/**
 * 获取或创建房间的 min-cut 缓存。
 * 缓存 key 为 roomName，存放在 global heap。
 */
function getMinCutCache(roomName: string): MinCutCache | undefined {
  const g = globalCache() as any;
  // 优先读 global heap（快）
  if (g.__minCutCache?.[roomName]) return g.__minCutCache[roomName];

  // Global Reset 后从 Memory 恢复 — 避免 bucket < 5000 时防御真空
  const roomMem = Memory.rooms[roomName];
  if (roomMem?.minCut) {
    const stored = roomMem.minCut;
    const positions: { x: number; y: number }[] = [];
    for (let i = 0; i < stored.positions.length; i += 2) {
      positions.push({ x: stored.positions[i]!, y: stored.positions[i + 1]! });
    }
    const cache: MinCutCache = {
      signature: stored.sig,
      result: { rampartPositions: positions, complete: stored.complete },
      tick: 0,
    };
    // 写回 global heap
    if (!g.__minCutCache) g.__minCutCache = {};
    g.__minCutCache[roomName] = cache;
    return cache;
  }

  return undefined;
}

function setMinCutCache(roomName: string, cache: MinCutCache): void {
  const g = globalCache() as any;
  if (!g.__minCutCache) g.__minCutCache = {};
  g.__minCutCache[roomName] = cache;

  // 同步到 Memory（跨 Global Reset 存活）
  const roomMem = Memory.rooms[roomName];
  if (roomMem) {
    const positions: number[] = [];
    for (const pos of cache.result.rampartPositions) {
      positions.push(pos.x, pos.y);
    }
    roomMem.minCut = {
      sig: cache.signature,
      positions,
      complete: cache.result.complete,
    };
  }
}

/**
 * 计算核心结构的签名 — 用于检测是否需要重算 min-cut。
 * 签名包含 spawns、extensions、storage、towers 的位置。
 * 只有核心结构变化时才需要重算。
 */
function computeCoreSignature(snapshot: import("../kernel/contracts").RoomSnapshot): string {
  const parts: string[] = [];
  for (const s of snapshot.spawns) parts.push(`s${s.pos.x},${s.pos.y}`);
  for (const s of snapshot.extensions) parts.push(`e${s.pos.x},${s.pos.y}`);
  if (snapshot.storage) parts.push(`st${snapshot.storage.pos.x},${snapshot.storage.pos.y}`);
  for (const s of snapshot.towers) parts.push(`t${s.pos.x},${s.pos.y}`);
  return parts.sort().join("|");
}

/**
 * 获取或缓存房间的出口位置。
 * room.find(FIND_EXIT) 是全房扫描，缓存避免每 10 tick 重算。
 */
function getCachedExits(room: Room, roomName: string): { x: number; y: number }[] {
  const g = globalCache() as any;
  if (!g.__exitCache) g.__exitCache = {};
  const cached: ExitCache | undefined = g.__exitCache[roomName];
  // 出口位置在房间地形不变时是固定的，缓存 1000 tick 过期。
  if (cached && Game.time - cached.tick < 1000) {
    return cached.positions;
  }
  const positions = room.find(FIND_EXIT).map(p => ({ x: p.x, y: p.y }));
  g.__exitCache[roomName] = { positions, tick: Game.time };
  return positions;
}

function planDefense(
  snapshot: import("../kernel/contracts").RoomSnapshot,
): void {
  // P0-3 修复：RCL 门禁从 4 降为 3。
  // RCL3 是"刚有 Tower 但无 rampart"的最脆弱窗口期 — 一波突袭就破。
  // RCL3 时跳过昂贵的 min-cut，走扇区防御 fallback（少量 rampart 包围核心）。
  if (snapshot.rcl < 3) return;

  const room = Game.rooms[snapshot.roomName];
  if (!room) return;

  const roomMem = Memory.rooms[snapshot.roomName];
  if (!roomMem) return;

  const queue = roomMem.buildQueue ?? [];
  const existingKeys = new Set<string>();
  for (const t of queue) existingKeys.add(t.key);

  let added = false;

  // ── 核心结构 rampart 覆盖（P1：保护建筑不被直接攻击）──
  // rampart 可与建筑共格 — 在每个核心结构位置叠加 rampart，
  // 使敌方必须先拆 rampart 才能攻击建筑。独立于 min-cut/扇区路径封锁逻辑。
  added = addCoreRampartCoverage(queue, snapshot, existingKeys) || added;

  // 快速检查：如果 buildQueue 中已有未完成的 mincut rampart key，跳过 min-cut 计算。
  // min-cut rampart key 格式: defense.mincut.{x}.{y}
  const mincutKeyCount = queue.filter(
    t => t.key.startsWith("defense.mincut.") && t.state !== "done",
  ).length;

  // P0 修复：如果 buildQueue 中已有未完成的 mincut rampart 任务，跳过全部计算。
  // 这些任务存于 Memory（跨 global reset 存活），无需因 global cache 清空而重算。
  // 如果核心结构已变，旧 rampart 位置会因 ERR_INVALID_TARGET 被标记为 blocked，
  // cleanTasks 清理后 mincutKeyCount 归零，自然触发重算。
  if (mincutKeyCount > 0) {
    if (added) roomMem.buildQueue = queue;
    return; // rampart 任务已在队列中，无需重算 min-cut
  }

  // mincutKeyCount == 0：所有 rampart 已建成或从未创建 — 检查缓存决定是否重算。
  const cached = getMinCutCache(snapshot.roomName);
  const coreSig = computeCoreSignature(snapshot);

  // 使用缓存的出口位置。
  const exitPositions = getCachedExits(room, snapshot.roomName);

  // 核心区域格（要保护的结构）。
  const corePositions: { x: number; y: number }[] = [];
  for (const s of snapshot.spawns) corePositions.push({ x: s.pos.x, y: s.pos.y });
  for (const s of snapshot.extensions) corePositions.push({ x: s.pos.x, y: s.pos.y });
  if (snapshot.storage) corePositions.push({ x: snapshot.storage.pos.x, y: snapshot.storage.pos.y });
  for (const s of snapshot.towers) corePositions.push({ x: s.pos.x, y: s.pos.y });

  // ── 策略 1：Min-Cut（最少 rampart 完全封锁）──
  // P0-3：RCL3 跳过 min-cut — 核心结构少，扇区防御更快且够用。
  // min-cut 计算昂贵（图论算法），RCL3 的简单布局不值得这个成本。
  if (snapshot.rcl >= 4) {
    // 仅在缓存 miss 时执行昂贵的 min-cut 计算。
    let cutResult: { rampartPositions: { x: number; y: number }[]; complete: boolean };

    if (cached && cached.signature === coreSig) {
      // 核心结构未变但 mincut key 为 0（可能任务被清理了）— 用缓存结果重新生成任务。
      cutResult = cached.result;
    } else {
      // 缓存 miss 或核心结构已变 — 执行 min-cut 计算。
      const terrain = room.getTerrain();
      const getTerrain = (x: number, y: number): boolean => terrain.get(x, y) === TERRAIN_MASK_WALL;
      const computed = computeMinCutDefense(getTerrain, corePositions, exitPositions, MAX_CUT_RAMPARTS);
      cutResult = {
        rampartPositions: computed.rampartPositions,
        complete: computed.complete,
      };
      // 缓存结果。
      setMinCutCache(snapshot.roomName, {
        signature: coreSig,
        result: cutResult,
        tick: Game.time,
      });
    }

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

  // ── 策略 2：扇区防御（RCL3 的主路径 / RCL4+ 的 fallback）──
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

/**
 * 核心结构 rampart 覆盖 — 在每个核心结构位置生成 rampart 任务。
 *
 * rampart 可与建筑共格，使敌方必须先拆 rampart 才能攻击建筑。
 * 用 snapshot.ramparts 去重，避免对已有 rampart 的位置重复入队。
 *
 * 覆盖范围：spawn / extension / storage / tower / link / container —
 * 这些是敌方优先攻击的高价值目标。
 *
 * 返回是否新增了任务。
 */
function addCoreRampartCoverage(
  queue: BuildTask[],
  snapshot: RoomSnapshot,
  existingKeys: Set<string>,
): boolean {
  // 构建已有 rampart 位置集合（去重）
  const existingRampartPositions = new Set<number>();
  for (const r of snapshot.ramparts) {
    existingRampartPositions.add(r.pos.x * 50 + r.pos.y);
  }

  // 核心结构位置集合
  const corePositions: { x: number; y: number }[] = [];
  for (const s of snapshot.spawns) corePositions.push({ x: s.pos.x, y: s.pos.y });
  for (const s of snapshot.extensions) corePositions.push({ x: s.pos.x, y: s.pos.y });
  if (snapshot.storage) corePositions.push({ x: snapshot.storage.pos.x, y: snapshot.storage.pos.y });
  for (const s of snapshot.towers) corePositions.push({ x: s.pos.x, y: s.pos.y });
  for (const s of snapshot.links) corePositions.push({ x: s.pos.x, y: s.pos.y });
  for (const s of snapshot.containers) corePositions.push({ x: s.pos.x, y: s.pos.y });

  let added = false;
  for (const pos of corePositions) {
    const packed = pos.x * 50 + pos.y;
    // 跳过已有 rampart 的位置
    if (existingRampartPositions.has(packed)) continue;
    const key = `defense.core.rampart.${pos.x}.${pos.y}`;
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
  return added;
}
