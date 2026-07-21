import { CONFIG } from "../config";
import { globalCache } from "../kernel/global-cache";
import { releaseFromTask } from "./assignment-adapter";

/** 将 RoomPosition 压缩为单个数字：x * 50 + y。 */
export function packPos(pos: RoomPosition): number {
  return pos.x * 50 + pos.y;
}

// ─── Traffic 记录（numeric key）────────────────────────────

/**
 * 记录 creep 当前位置的交通热度，供道路规划器使用。
 * 使用 numeric packed key（x*50+y）替代字符串拼接，减少 GC 压力。
 */
export function recordTraffic(creep: Creep): void {
  const g = globalCache();
  if (!g.roomTraffic) g.roomTraffic = {};
  const roomName = creep.room.name;
  if (!g.roomTraffic[roomName]) g.roomTraffic[roomName] = {};
  const key = String(creep.pos.x * 50 + creep.pos.y);
  g.roomTraffic[roomName][key] = (g.roomTraffic[roomName][key] ?? 0) + 1;
}

// ─── CostMatrix 缓存（结构层 — 叠加在引擎地形矩阵之上）────

/**
 * 结构层缓存 — 每房间维护一个 CostMatrix + 位置扁平数组。
 *
 * 失效策略：结构 + 工地总数变化 → 重建。
 * 每房间每 tick 最多做一次 room.find 计数检查（per-tick flag），
 * 避免 N 个 creep 移动时重复调用 room.find（旧实现每 creep 2 次）。
 *
 * 权重：
 *   road         = 1  （覆盖地形，最低成本）
 *   container    = 2  （可通行）
 *   自有 rampart = 2  （可通行）
 *   其他结构     = 255（不可通行）
 *   非 road/container 工地 = 255（不可通行）
 */
interface StructureCacheEntry {
  /** 结构数量 hash — 数量变化时重建。 */
  count: number;
  /** 扁平位置数组 [x, y, cost, x, y, cost, ...]，供 costCallback 快速叠加。 */
  positions: number[];
  /** 本 tick 是否已做过计数检查（避免同 tick 多 creep 重复 room.find）。 */
  checkedTick: number;
}

/**
 * 确保房间的结构缓存是最新的。
 * 每房间每 tick 最多调用一次 room.find（通过 checkedTick 去重）。
 * 结构数量变化时重建 positions 数组。
 */
function ensureStructureCache(roomName: string): StructureCacheEntry | undefined {
  const g = globalCache() as any;
  if (!g.__structCache) g.__structCache = {};

  let entry: StructureCacheEntry | undefined = g.__structCache[roomName];

  // 本 tick 已检查过 → 直接返回（O(1)）。
  if (entry && entry.checkedTick === Game.time) {
    return entry;
  }

  const room = Game.rooms[roomName];
  if (!room) return undefined;

  // 每房间每 tick 仅此处调用 room.find（一次）。
  const structures = room.find(FIND_STRUCTURES);
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  const count = structures.length + sites.length;

  // 数量未变 → 标记已检查，复用缓存。
  if (entry && entry.count === count) {
    entry.checkedTick = Game.time;
    return entry;
  }

  // 重建 positions 扁平数组。
  const positions: number[] = [];

  for (const s of structures) {
    let cost: number;
    if (s.structureType === STRUCTURE_ROAD) {
      cost = 1;
    } else if (s.structureType === STRUCTURE_CONTAINER) {
      cost = 2;
    } else if (s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my) {
      cost = 2;
    } else {
      cost = 255;
    }
    positions.push(s.pos.x, s.pos.y, cost);
  }

  for (const site of sites) {
    if (site.structureType !== STRUCTURE_ROAD && site.structureType !== STRUCTURE_CONTAINER) {
      positions.push(site.pos.x, site.pos.y, 255);
    }
  }

  entry = { count, positions, checkedTick: Game.time };
  g.__structCache[roomName] = entry;
  return entry;
}

/**
 * costCallback — 将结构层成本叠加到引擎传入的地形矩阵上。
 * 不 return 新矩阵（返回 void），引擎继续使用修改后的原矩阵（保留地形成本）。
 *
 * 零 room.find 调用 — 直接读取 ensureStructureCache 维护的 positions 数组。
 */
function structureCostCallback(roomName: string, matrix: CostMatrix): void {
  const entry = ensureStructureCache(roomName);
  if (!entry) return;

  const positions = entry.positions;
  for (let i = 0; i < positions.length; i += 3) {
    matrix.set(positions[i]!, positions[i + 1]!, positions[i + 2]!);
  }
}

// ─── 自适应 reusePath ─────────────────────────────────────

/**
 * 根据距离计算 reusePath 值。
 *
 * 短距离（<=3）：reusePath 3 — 目标变化快（fillTarget 被填满），需要快速重算。
 * 中距离（4-10）：reusePath 5 — 平衡缓存命中和路径新鲜度。
 * 长距离（>10）：reusePath 15 — 路径稳定，减少 PathFinder 调用。
 */
function adaptiveReusePath(creep: Creep, target: RoomPosition): number {
  const range = creep.pos.getRangeTo(target);
  if (range <= 3) return 3;
  if (range <= 10) return 5;
  return 15;
}

// ─── 同 tick 路径共享 ─────────────────────────────────────

/**
 * 同 tick 内多 creep 走向同一目标时，共享序列化路径。
 *
 * 工作原理：
 *   1. 首个 creep 到某目标：PathFinder.search → 序列化 → 存入 per-tick Map
 *   2. 后续 creep 同目标：moveByPath(缓存路径) — O(1) 步进，跳过 PathFinder
 *   3. moveByPath 返回 ERR_NOT_FOUND（creep 不在路径上）→ 回退到 moveTo
 *
 * 适用条件（仅 Level 0 正常移动时启用）：
 *   - 非卡位状态（ignoreCreeps: true 时路径才有效）
 *   - range > 3（短距离 PathFinder 开销可忽略）
 *
 * key = `${roomName}:${packedTarget}`，每 tick 清空。
 */
function getPathShareCache(): Map<string, RoomPosition[]> {
  const g = globalCache() as any;
  if (!g.__pathShare || g.__pathShareTick !== Game.time) {
    g.__pathShare = new Map();
    g.__pathShareTick = Game.time;
  }
  return g.__pathShare as Map<string, RoomPosition[]>;
}

/**
 * 尝试使用共享路径移动。
 * 返回 ScreepsReturnCode 表示成功使用了共享路径；返回 undefined 表示不适用（需回退到 moveTo）。
 */
function trySharedPath(
  creep: Creep,
  cacheKey: string,
): ScreepsReturnCode | undefined {
  const cache = getPathShareCache();
  const path = cache.get(cacheKey);
  if (!path) return undefined;

  const result = creep.moveByPath(path);
  // ERR_NOT_FOUND = creep 不在缓存路径上 → 不适用，需回退。
  // ERR_INVALID_ARGS = 路径格式异常 → 同上。
  if (result === ERR_NOT_FOUND || result === ERR_INVALID_ARGS) {
    return undefined;
  }
  return result;
}

/**
 * 计算并缓存共享路径。
 * 使用 PathFinder.search（与 moveTo 相同参数），路径数组直接存入 per-tick 缓存。
 * moveByPath 接受 RoomPosition[]，无需序列化（per-tick 缓存无跨 tick 持久化需求）。
 * 返回路径数组，失败返回 undefined。
 */
function computeAndCachePath(
  creep: Creep,
  pos: RoomPosition,
  cacheKey: string,
): RoomPosition[] | undefined {
  const result = PathFinder.search(
    creep.pos,
    { pos, range: 1 },
    {
      plainCost: 2,
      swampCost: 10,
      maxRooms: 1,
      roomCallback: (roomName: string): boolean | CostMatrix => {
        const room = Game.rooms[roomName];
        if (!room) return false;
        const matrix = new PathFinder.CostMatrix();
        const entry = ensureStructureCache(roomName);
        if (entry) {
          const positions = entry.positions;
          for (let i = 0; i < positions.length; i += 3) {
            matrix.set(positions[i]!, positions[i + 1]!, positions[i + 2]!);
          }
        }
        return matrix;
      },
    },
  );

  if (result.incomplete || result.path.length === 0) return undefined;

  getPathShareCache().set(cacheKey, result.path);
  return result.path;
}

// ─── 核心移动函数 ─────────────────────────────────────────

/** 向目标房间方向移动（通过最近出口），带道路优先。 */
export function moveTowardRoom(creep: Creep, targetRoom: string): void {
  const exitDir = creep.room.findExitTo(targetRoom) as number;
  if (exitDir < 0) return;
  const exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
  if (exit) {
    const result = creep.moveTo(exit, {
      reusePath: 5,
      plainCost: 2,
      swampCost: 10,
      costCallback: structureCostCallback,
    });
    if (result === OK || result === ERR_TIRED) {
      recordTraffic(creep);
    }
  }
}

/**
 * 确保 creep 已设置 home 房间；不在 home 时尝试向 home 方向移动。
 * 只有 creep 实际在 home 房间内时才返回 true。
 */
export function ensureHome(creep: Creep): boolean {
  if (!creep.memory.home) {
    creep.memory.home = creep.room.name;
  }
  const home = creep.memory.home;
  if (creep.room.name === home) return true;
  moveTowardRoom(creep, home);
  return false;
}

/**
 * 移动到目标 — 带自适应路径缓存、道路优先、渐进式脱困、同 tick 路径共享。
 *
 * 脱困三级策略：
 *   Level 0（正常）：ignoreCreeps: true + road-preference
 *   Level 1（stuckTicks >= stuckThreshold）：ignoreCreeps: false（绕过阻挡 creep）
 *   Level 2（stuckTicks >= stuckThreshold + 1）：reusePath: 0 强制重算路径
 *   Level 3（stuckTicks >= stuckThreshold + repathLimit）：放弃，清除目标，idle
 *
 * 仅在操作返回 ERR_NOT_IN_RANGE 时调用。
 */
export function moveToTarget(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
): ScreepsReturnCode {
  const pos = "pos" in target ? target.pos : target;

  // ── 短路：range <= 1 时直接 move，跳过一切寻路逻辑。──
  const range = creep.pos.getRangeTo(pos);
  if (range <= 1) {
    const dir = creep.pos.getDirectionTo(pos);
    const result = creep.move(dir);
    if (result === OK || result === ERR_TIRED) {
      recordTraffic(creep);
    }
    return result;
  }

  // ── 固定路线短路：range 2-3 贪心移动（站桩升级/站桩采集的核心优化）。──
  // controller container → controller 永远只有 1-2 格，source → container 同理。
  // 这些静态结构之间不存在障碍（布局系统保证），贪心 getDirectionTo 即可。
  // 省去 PathFinder + stuck detection + costCallback 的全部开销（~0.1ms/creep/tick）。
  // 若贪心失败（ERR_NO_PATH — 极端情况如墙体塌陷）， fall through 到完整寻路。
  if (range <= 3) {
    const dir = creep.pos.getDirectionTo(pos);
    const result = creep.move(dir);
    if (result === OK || result === ERR_TIRED) {
      recordTraffic(creep);
      return result;
    }
    // ERR_NO_PATH / ERR_BUSY 等 → fall through 到完整寻路。
  }

  // ── 卡位检测 ──
  const currentPacked = packPos(creep.pos);
  if (creep.memory.lastPos === currentPacked) {
    creep.memory.stuckTicks = (creep.memory.stuckTicks ?? 0) + 1;
  } else {
    creep.memory.stuckTicks = 0;
  }
  creep.memory.lastPos = currentPacked;

  const stuckTicks = creep.memory.stuckTicks ?? 0;
  const { stuckThreshold, repathLimit } = CONFIG.kernel;

  // Level 3：超过总限制 — 放弃目标，让角色下 tick 重新评估。
  if (stuckTicks >= stuckThreshold + repathLimit) {
    clearTarget(creep);
    creep.memory.mode = "idle";
    return ERR_NO_PATH;
  }

  // ── 同 tick 路径共享（仅 Level 0 正常移动 + 中远距离时启用）──
  // 卡位时路径可能含 ignoreCreeps:false 的绕行，不适合共享。
  // 短距离（<=3）PathFinder 开销可忽略，不值得序列化/反序列化。
  if (stuckTicks === 0 && range > 3) {
    const cacheKey = `${creep.room.name}:${packPos(pos)}`;

    // 尝试复用已有共享路径。
    const sharedResult = trySharedPath(creep, cacheKey);
    if (sharedResult !== undefined) {
      if (sharedResult === OK || sharedResult === ERR_TIRED) {
        recordTraffic(creep);
      }
      return sharedResult;
    }

    // 首个到该目标的 creep — 计算并缓存路径。
    const serialized = computeAndCachePath(creep, pos, cacheKey);
    if (serialized) {
      const result = creep.moveByPath(serialized);
      if (result !== ERR_NOT_FOUND && result !== ERR_INVALID_ARGS) {
        if (result === OK || result === ERR_TIRED) {
          recordTraffic(creep);
        }
        return result;
      }
    }
    // 路径计算失败或 creep 不在路径上 → 回退到 moveTo。
  }

  // ── 构建 MoveToOpts ──
  const reusePath = stuckTicks >= stuckThreshold + 1 ? 0 : adaptiveReusePath(creep, pos);
  const ignoreCreeps = stuckTicks < stuckThreshold;

  const options: MoveToOpts = {
    reusePath,
    maxRooms: 1,
    ignoreCreeps,
    // 道路优先：引擎默认 road=1，plain=2 使道路成本仅为 plain 的一半。
    plainCost: 2,
    swampCost: 10,
    // 叠加结构层（不可通行结构 + road 覆写）。修改传入矩阵，不 return 新矩阵。
    costCallback: structureCostCallback,
  };

  const result = creep.moveTo(pos, options);
  if (result === OK || result === ERR_TIRED) {
    recordTraffic(creep);
  }
  return result;
}

/** 清除 creep 的目标和分配，进入安全空闲。 */
export function clearTarget(creep: Creep): void {
  releaseFromTask(creep);
  creep.memory.targetId = undefined;
  creep.memory.assignment = undefined;
  creep.memory.stuckTicks = 0;
}

// ─── Flee 辅助 ────────────────────────────────────────────

/**
 * 查找最安全的出口 — 选择与敌人方向夹角最大的出口（约束 G-DF-09）。
 */
export function findSafestExit(creep: Creep, enemyPos: RoomPosition): RoomPosition | undefined {
  const exits = Game.map.describeExits(creep.room.name);
  if (!exits) return undefined;

  const enemyDirX = enemyPos.x - 25;
  const enemyDirY = enemyPos.y - 25;

  const exitCandidates: { dir: number; dot: number }[] = [];
  for (const dirStr of Object.keys(exits)) {
    const dir = Number(dirStr);
    let exitVecX = 0;
    let exitVecY = 0;
    switch (dir) {
      case TOP: exitVecY = -1; break;
      case RIGHT: exitVecX = 1; break;
      case BOTTOM: exitVecY = 1; break;
      case LEFT: exitVecX = -1; break;
      default: continue;
    }
    const dot = enemyDirX * exitVecX + enemyDirY * exitVecY;
    exitCandidates.push({ dir, dot });
  }

  if (exitCandidates.length === 0) return undefined;

  exitCandidates.sort((a, b) => a.dot - b.dot);

  const hasOpposite = exitCandidates[0]!.dot < 0;
  const chosenDir = hasOpposite
    ? exitCandidates[0]!.dir
    : exitCandidates[exitCandidates.length - 1]!.dir;

  return creep.pos.findClosestByRange(chosenDir as ExitConstant) ?? undefined;
}
