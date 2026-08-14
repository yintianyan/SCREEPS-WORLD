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
import { computeMinCutDefense, MINCUT_ALGO_VERSION } from "../domain/layout/min-cut-defense";
import { globalCache, type MinCutCache, type ExitCache } from "../kernel/global-cache";

/**
 * 防御规划器 — P3 独立系统，负责生成 rampart/wall 建造任务（interval 10）。
 * 策略（Phase 5 升级）：优先 min-cut 算法（最少 rampart 封锁所有入侵路径）；
 * Min-cut 失败（割集过大/地形太开放）时 fallback 扇区防御。
 * CPU 优化（P1 修复）：min-cut 结果缓存 global heap，仅核心结构变化时重算；
 * bucket < 5000 完全跳过；buildQueue 已有 mincut key 时跳过计算；FIND_EXIT 缓存 heap。
 */
export const defensePlannerSystem: System = {
  name: "defense-planner",
  priority: 3 as Priority,
  interval: 10,

  run(ctx: TickContext): void {
    // P3 在 conserve/recovery 下不运行。
    if (ctx.budget.tier === "conserve" || ctx.budget.tier === "recovery") return;

    // Bucket 门禁 — 低于 5000 时完全跳过防御规划（非关键的 P3 工作，不能拖垮生存）。
    if (Game.cpu.bucket < 5000) return;

    for (const snapshot of ctx.snapshots()) {
      planDefense(snapshot);
    }
  },
};

/**
 * Min-cut 最大防御建筑数（超过则 fallback 到扇区）。
 *
 * v3：从 30 提升到 50 — 8 邻接后割集可能增大（对角线路径也需封锁），
 * 30 在多出口开放地形下易误判为"割集过大"而回退扇区防御。
 */
const MAX_CUT_RAMPARTS = 50;

/**
 * 把算法版本戳拼入 signature，让算法语义变更后旧缓存自然失效。
 *
 * 旧 Memory（无版本前缀）与新计算的 signature 比较时不匹配，触发重算；
 * 新写入的 signature 含前缀，后续命中正常。无 Memory schema 变更。
 */
function withAlgoVersion(coreSig: string): string {
  return `${MINCUT_ALGO_VERSION}|${coreSig}`;
}

/** MinCutCache / ExitCache 接口已移至 kernel/global-cache.ts（GlobalCache 字段类型声明）。 */

/**
 * 获取或创建房间的 min-cut 缓存（缓存 key = roomName，存 global heap）。
 * 优先读 heap；Global Reset 后从 Memory 恢复 — 避免 bucket < 5000 时防御真空。
 */
function getMinCutCache(roomName: string): MinCutCache | undefined {
  const g = globalCache();
  if (g.__minCutCache?.[roomName]) return g.__minCutCache[roomName];

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
  const g = globalCache();
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
 * 签名包含 spawns、extensions、storage、towers 的位置，只有核心结构变化才重算。
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
 * 获取或缓存房间的出口位置（room.find(FIND_EXIT) 是全房扫描，缓存避免每 10 tick 重算；
 * 出口位置在房间地形不变时固定，1000 tick 过期）。
 */
function getCachedExits(room: Room, roomName: string): { x: number; y: number }[] {
  const g = globalCache();
  if (!g.__exitCache) g.__exitCache = {};
  const cached: ExitCache | undefined = g.__exitCache[roomName];
  if (cached && Game.time - cached.tick < 1000) {
    return cached.positions;
  }
  const positions = room.find(FIND_EXIT).map(p => ({ x: p.x, y: p.y }));
  g.__exitCache[roomName] = { positions, tick: Game.time };
  return positions;
}

/**
 * P1-2：min-cut 割集位置可建造性预校验（纯函数，便于单元测试）。
 * 1. 出口格及紧邻出口格不可建 wall/rampart（Screeps 出口格 x/y=0|49，紧邻格 x/y=1|48
 *    可建但防御价值为零且 min-cut 常误选）；2. 已有 construction site 的位置跳过
 *    （避免重复入队 → 创建失败 → blocked）。
 */
export function isMinCutPositionBuildable(
  pos: { x: number; y: number },
  hasConstructionSite: boolean,
): boolean {
  if (pos.x <= 1 || pos.x >= 48 || pos.y <= 1 || pos.y >= 48) return false;
  if (hasConstructionSite) return false;
  return true;
}

/**
 * P2-1：构建不可放置割集顶点的位置集合（出口格及紧邻出口格）。
 *
 * 这些位置在 min-cut 算法中拆点边容量设为 INF（不可切割），
 * 算法自然选其他位置作为割集，保证生成的割集全部可建造。
 *
 * 集合包含 x≤1 或 x≥48 或 y≤1 或 y≥48 的所有格子（packed = x*50+y）。
 * defense-planner 是 P3 低频系统（interval=10, bucket≥5000），遍历开销可接受。
 */
function buildBlockedPositions(): Set<number> {
  const blocked = new Set<number>();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (x <= 1 || x >= 48 || y <= 1 || y >= 48) {
        blocked.add(x * 50 + y);
      }
    }
  }
  return blocked;
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

  // 快速检查：buildQueue 已有未完成的 mincut 防御建筑 key → 跳过 min-cut 计算。
  // min-cut key 格式（v3）: defense.mincut.wall.{x}.{y} / defense.mincut.rampart.{x}.{y}
  // 旧格式 defense.mincut.{x}.{y} 也匹配前缀检查，自然消化后不重生成。
  const mincutKeyCount = queue.filter(
    t => t.key.startsWith("defense.mincut.") && t.state !== "done" && t.state !== "blocked",
  ).length;

  // P0 修复：已有未完成的 mincut rampart 任务时跳过全部计算（任务存 Memory，跨 reset 存活，
  // 无需因 global cache 清空而重算）。核心结构已变时旧 rampart 会 ERR_INVALID_TARGET →
  // blocked → cleanTasks 清理后 mincutKeyCount 归零，自然触发重算。
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

    if (cached && cached.signature === withAlgoVersion(coreSig)) {
      // 核心结构未变但 mincut key 为 0（可能任务被清理了）— 用缓存结果重新生成任务。
      cutResult = cached.result;
    } else {
      // 缓存 miss 或核心结构已变 — 执行 min-cut 计算。
      const terrain = room.getTerrain();
      const getTerrain = (x: number, y: number): boolean => terrain.get(x, y) === TERRAIN_MASK_WALL;
      // P2-1：构建不可放置割集顶点的位置集合（出口格及紧邻出口格）。
      // 这些位置 min-cut 会设为不可切割，算法选其他位置作为割集，
      // 保证生成的割集全部可建造（与 P1-2 入队预校验双重保险）。
      const blockedPositions = buildBlockedPositions();
      const computed = computeMinCutDefense(getTerrain, corePositions, exitPositions, MAX_CUT_RAMPARTS, blockedPositions);
      cutResult = {
        rampartPositions: computed.rampartPositions,
        complete: computed.complete,
      };
      // 缓存结果。signature 含算法版本戳，旧版本缓存自然失效。
      setMinCutCache(snapshot.roomName, {
        signature: withAlgoVersion(coreSig),
        result: cutResult,
        tick: Game.time,
      });
    }

    if (cutResult.complete) {
      // Min-cut 成功：使用割集位置生成防御建筑任务。
      //
      // v3 盲点 1 修正：割集顶点按位置特征分流 wall/rampart。
      //   - 无结构 → STRUCTURE_WALL（wall 阻挡通行，真正阻断路径）
      //   - 有结构（road/container/link/核心）→ STRUCTURE_RAMPART
      //     （Screeps 中 wall 不能与任何结构共格，rampart 可共格）
      // 旧实现全用 rampart 是语义错误 — rampart 不阻挡通行，敌人可直接穿过。
      //
      // 已建 rampart/wall 位置跳过 — 缓存命中的再生成路径若不对照实建结构去重，
      // 会为已建成的割集位置重复入队（建 site 必失败 → blocked → purge →
      // 下周期再生成，幽灵任务无限 churn；core 覆盖路径同款去重，此处补齐）。
      const builtRamparts = new Set<number>();
      for (const r of snapshot.ramparts) {
        builtRamparts.add(r.pos.x * 50 + r.pos.y);
      }
      const builtWalls = new Set<number>();
      for (const w of snapshot.walls) {
        builtWalls.add(w.pos.x * 50 + w.pos.y);
      }

      // 构建结构位置集合 — 这些位置不能放 wall，需 fallback 到 rampart。
      // 含 roads/containers/links 及核心结构（核心已被 min-cut 排除，此处防御性检查）。
      const structurePositions = new Set<number>();
      for (const s of snapshot.roads) structurePositions.add(s.pos.x * 50 + s.pos.y);
      for (const s of snapshot.containers) structurePositions.add(s.pos.x * 50 + s.pos.y);
      for (const s of snapshot.links) structurePositions.add(s.pos.x * 50 + s.pos.y);
      for (const s of snapshot.spawns) structurePositions.add(s.pos.x * 50 + s.pos.y);
      for (const s of snapshot.extensions) structurePositions.add(s.pos.x * 50 + s.pos.y);
      for (const s of snapshot.towers) structurePositions.add(s.pos.x * 50 + s.pos.y);
      if (snapshot.storage) {
        structurePositions.add(snapshot.storage.pos.x * 50 + snapshot.storage.pos.y);
      }

      for (let i = 0; i < cutResult.rampartPositions.length; i++) {
        const pos = cutResult.rampartPositions[i]!;
        const packed = pos.x * 50 + pos.y;
        // 已建 rampart 或 wall 的位置跳过
        if (builtRamparts.has(packed) || builtWalls.has(packed)) continue;

        // P1-2：可建造性预校验 — 避免入队注定 blocked 的任务。
        const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
        if (!isMinCutPositionBuildable(pos, sites.length > 0)) continue;

        // 按位置特征分流：有结构 → rampart（共格），无结构 → wall（阻挡通行）
        const hasStructure = structurePositions.has(packed);
        const structureType = hasStructure ? STRUCTURE_RAMPART : STRUCTURE_WALL;
        const keyPrefix = hasStructure ? "defense.mincut.rampart" : "defense.mincut.wall";
        const key = `${keyPrefix}.${pos.x}.${pos.y}`;
        if (existingKeys.has(key)) continue;
        queue.push({
          key,
          pos: { x: pos.x, y: pos.y, roomName: snapshot.roomName },
          structureType,
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
