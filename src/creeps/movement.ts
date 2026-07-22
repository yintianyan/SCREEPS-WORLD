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

// ─── Pull/Yield 让路机制 ─────────────────────────────────

/** 方向 → (dx, dy) 偏移表。 */
const DIR_DELTA: Record<number, [number, number]> = {
  [TOP]: [0, -1], [TOP_RIGHT]: [1, -1], [RIGHT]: [1, 0], [BOTTOM_RIGHT]: [1, 1],
  [BOTTOM]: [0, 1], [BOTTOM_LEFT]: [-1, 1], [LEFT]: [-1, 0], [TOP_LEFT]: [-1, -1],
};

/**
 * 请求阻挡 creep 让路。
 * 将让路请求存入 globalCache，目标 creep 在下一次 moveToTarget 调用时执行。
 * 同 tick 内优先级低的 creep 请求优先级高的 creep 让路时，
 * 由于高优先级 creep 已经执行过，请求会在下一 tick 生效。
 *
 * 设计意图：对静止 creep（如 harvester 站桩采矿）请求无效是正确行为——
 * 它们不调用 moveToTarget，请求自然过期。站桩矿工不应让出矿位，
 * 否则会导致采集效率崩塌。绕行 creep 应通过 ignoreCreeps:false 自行绕路。
 */
function requestYield(blockerName: string, dir: number): void {
  const g = globalCache() as any;
  if (!g.__yieldRequests) g.__yieldRequests = {};
  g.__yieldRequests[blockerName] = dir;
}

/**
 * 检查并执行让路请求。
 * 在 moveToTarget 开头调用 — 如果其他 creep 请求本 creep 让路，
 * 立即执行移动并返回 true（本 tick 不再执行其他移动逻辑）。
 */
export function checkAndExecuteYield(creep: Creep): boolean {
  const g = globalCache() as any;
  if (!g.__yieldRequests) return false;
  const dir = g.__yieldRequests[creep.name] as number | undefined;
  if (dir === undefined) return false;
  delete g.__yieldRequests[creep.name];
  const result = creep.move(dir as DirectionConstant);
  if (result === OK || result === ERR_TIRED) {
    recordTraffic(creep);
  }
  return true;
}

/**
 * 尝试让阻挡 creep 让路。
 * 在卡位 Level 1 时调用：找到目标方向上的 creep，请求它沿同方向移动。
 */
function tryPullBlocker(creep: Creep, targetPos: RoomPosition): void {
  const dir = creep.pos.getDirectionTo(targetPos);
  const delta = DIR_DELTA[dir];
  if (!delta) return;
  const nextX = creep.pos.x + delta[0];
  const nextY = creep.pos.y + delta[1];
  if (nextX < 0 || nextX > 49 || nextY < 0 || nextY > 49) return;

  const blockers = creep.room.lookForAt(LOOK_CREEPS, nextX, nextY);
  if (blockers.length > 0) {
    const blocker = blockers[0]!;
    // 请求阻挡者沿同方向移动（让出位置）。
    requestYield(blocker.name, dir);
  }
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

// ─── 疲劳感知 swampCost ──────────────────────────────────

/** 各部件重量表（Screeps 引擎值）。 */
const PART_WEIGHT: Record<string, number> = {
  [WORK]: 2, [CARRY]: 2, [MOVE]: 2,
  [ATTACK]: 3, [RANGED_ATTACK]: 3, [HEAL]: 3,
  [TOUGH]: 1, [CLAIM]: 5,
};

/**
 * 根据 creep body 计算有效 swampCost。
 *
 * 原理：每个 MOVE 部件提供 2 点负重容量。若总重量 > MOVE 容量，
 * creep 在 plain 上每 tick 都会积累疲劳（走 1 格停 1 格），
 * 在 swamp 上疲劳 ×5 —  effectively 不可通行（走 1 格停 5+ tick）。
 *
 * 慢速 creep（MOVE 容量 < 总重量）：swampCost = 255（完全避开沼泽）。
 * 正常 creep：swampCost = 10（标准惩罚，道路优先但仍可穿越）。
 */
function fatigueSwampCost(creep: Creep): number {
  const body = creep.body;
  let moveCapacity = 0;
  let totalWeight = 0;
  for (const part of body) {
    const weight = PART_WEIGHT[part.type] ?? 2;
    totalWeight += weight;
    if (part.type === MOVE) moveCapacity += 2;
  }
  // 慢速 creep：沼泽 effectively 不可通行。
  return moveCapacity < totalWeight ? 255 : 10;
}

// ─── 同 tick 路径共享 ─────────────────────────────────────

/**
 * 将 Screeps 房间名压缩为唯一整数（W7N4 → -7004, E10S20 → 9980）。
 * 用于构建纯数字 cache key，避免字符串分配。
 */
function packRoomName(roomName: string): number {
  // 格式: [WE]\d+[NS]\d+
  const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!match) return 0;
  const x = Number(match[2]) * (match[1] === "W" ? -1 : 1);
  const y = Number(match[4]) * (match[3] === "N" ? -1 : 1);
  return x * 1000 + y;
}

/** 构建路径共享的纯数字 key：roomHash * 2500 + packedPos。 */
function pathShareKey(roomName: string, packedPos: number): number {
  return packRoomName(roomName) * 2500 + packedPos;
}

/**
 * 同 tick 内多 creep 走向同一目标时，共享路径数组。
 *
 * 工作原理：
 *   1. 首个 creep 到某目标：PathFinder.search → 存入 per-tick Map
 *   2. 后续 creep 同目标：moveByPath(缓存路径) — O(1) 步进，跳过 PathFinder
 *   3. moveByPath 返回 ERR_NOT_FOUND（creep 不在路径上）→ 回退到 moveTo
 *
 * 适用条件（仅 Level 0 正常移动时启用）：
 *   - 非卡位状态（ignoreCreeps: true 时路径才有效）
 *   - range > 3（短距离 PathFinder 开销可忽略）
 *
 * key = roomHash * 2500 + packedTarget（纯数字，零字符串分配），每 tick 清空。
 */
function getPathShareCache(): Map<number, RoomPosition[]> {
  const g = globalCache() as any;
  if (!g.__pathShare || g.__pathShareTick !== Game.time) {
    g.__pathShare = new Map();
    g.__pathShareTick = Game.time;
  }
  return g.__pathShare as Map<number, RoomPosition[]>;
}

/**
 * 尝试使用共享路径移动。
 * 返回 ScreepsReturnCode 表示成功使用了共享路径；返回 undefined 表示不适用（需回退到 moveTo）。
 */
function trySharedPath(
  creep: Creep,
  cacheKey: number,
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

// ─── 跨 tick 路径持久化（堆缓存）─────────────────────────

/**
 * 每 creep 的路径缓存 — 存 globalCache（堆），Global Reset 后重算一次。
 *
 * 适用场景：hauler 在 source↔core 走廊上跑 1500 tick（整个寿命），
 * 每 tick 都走同一条路。没有持久化时靠 reusePath:15 缓存 15 tick，
 * 之后重算 → 1500 tick 寿命 ≈ 100 次 PathFinder.search。
 * 有持久化后：目标不变 + 结构不变 → 整个寿命只算 1 次。
 *
 * 失效条件：
 *   - 目标位置变化（assignment 切换）
 *   - 结构数量变化（新建筑/建筑被毁 → 路径可能不通）
 *   - moveByPath 返回 ERR_NOT_FOUND（creep 偏离路径）
 *   - 卡位（stuckTicks > 0 → 需要绕行，旧路径无效）
 */
interface CreepPathEntry {
  /** 目标 packed pos（x*50+y）。 */
  targetKey: number;
  /** 计算路径时的结构数量（变化则失效）。 */
  structCount: number;
  /** 缓存的路径。 */
  path: RoomPosition[];
}

function getCreepPathCache(): Record<string, CreepPathEntry> {
  const g = globalCache() as any;
  if (!g.__creepPathCache) g.__creepPathCache = {};
  return g.__creepPathCache;
}

/**
 * 尝试使用持久化路径移动。
 * 返回 ScreepsReturnCode 表示成功；undefined 表示不适用（需回退到正常寻路）。
 */
function tryPersistedPath(
  creep: Creep,
  targetPacked: number,
  structCount: number,
): ScreepsReturnCode | undefined {
  const cache = getCreepPathCache();
  const entry = cache[creep.name];
  if (!entry) return undefined;
  if (entry.targetKey !== targetPacked) return undefined;
  if (entry.structCount !== structCount) return undefined;

  const result = creep.moveByPath(entry.path);
  if (result === ERR_NOT_FOUND || result === ERR_INVALID_ARGS) {
    // creep 偏离路径 — 失效缓存，回退到正常寻路。
    delete cache[creep.name];
    return undefined;
  }
  return result;
}

/**
 * 计算路径并存入持久化缓存。
 * 使用 PathFinder.search（与 moveTo 相同参数），路径存入堆。
 */
function computeAndPersistPath(
  creep: Creep,
  pos: RoomPosition,
  targetPacked: number,
  structCount: number,
): RoomPosition[] | undefined {
  const result = PathFinder.search(
    creep.pos,
    { pos, range: 1 },
    {
      plainCost: 2,
      swampCost: fatigueSwampCost(creep),
      maxRooms: CONFIG.movement.localMaxRooms,
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

  getCreepPathCache()[creep.name] = {
    targetKey: targetPacked,
    structCount,
    path: result.path,
  };
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

  // ── Yield 检查：其他 creep 请求本 creep 让路时优先执行。──
  if (checkAndExecuteYield(creep)) {
    return OK;
  }

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

  // 注意：旧实现有 range 2-3 贪心短路（creep.move(getDirectionTo)），已移除。
  // 原因：creep.move 不忽略其他 creep，多 creep 同目标时全部挤入同一邻格 → 死锁。
  // E1S9 实测：7 个 creep 卡在 Source1 旁 2 格处 500+ tick 无法采集。
  // 完整 PathFinder + ignoreCreeps:true + range:1 能正确分散多 creep 到不同邻格。

  // ── 卡位检测（仅在值变化时写 Memory，减少 Proxy 开销）──
  const currentPacked = packPos(creep.pos);
  const prevStuck = creep.memory.stuckTicks ?? 0;
  if (creep.memory.lastPos === currentPacked) {
    if (prevStuck === 0) creep.memory.stuckTicks = 1;
    else creep.memory.stuckTicks = prevStuck + 1;
  } else if (prevStuck !== 0) {
    // 位置变化且之前有卡位记录 — 才需要写 0。正常移动时跳过写入。
    creep.memory.stuckTicks = 0;
  }
  if (creep.memory.lastPos !== currentPacked) {
    creep.memory.lastPos = currentPacked;
  }

  const stuckTicks = creep.memory.stuckTicks ?? 0;
  const { stuckThreshold, repathLimit } = CONFIG.kernel;

  // Level 3：超过总限制 — 放弃目标，让角色下 tick 重新评估。
  if (stuckTicks >= stuckThreshold + repathLimit) {
    clearTarget(creep);
    creep.memory.mode = "idle";
    return ERR_NO_PATH;
  }

  // Level 1 首次触发：请求阻挡 creep 让路（比 ignoreCreeps:false 绕行更快）。
  if (stuckTicks === stuckThreshold) {
    tryPullBlocker(creep, pos);
  }

  // ── 路径缓存（仅 Level 0 正常移动 + 中远距离时启用）──
  // 优先级：持久化路径（跨 tick）→ 同 tick 共享路径 → 新计算 + 持久化
  // 卡位时路径可能含 ignoreCreeps:false 的绕行，不适合复用。
  // 短距离（<=3）PathFinder 开销可忽略，不值得缓存。
  if (stuckTicks === 0 && range > 3) {
    const targetPacked = packPos(pos);
    const structEntry = ensureStructureCache(creep.room.name);
    const structCount = structEntry?.count ?? -1;

    // 1. 尝试跨 tick 持久化路径（hauler 走廊 1500 tick 只算 1 次）。
    const persistedResult = tryPersistedPath(creep, targetPacked, structCount);
    if (persistedResult !== undefined) {
      if (persistedResult === OK || persistedResult === ERR_TIRED) {
        recordTraffic(creep);
      }
      return persistedResult;
    }

    // 2. 尝试同 tick 共享路径（多 creep 同目标时复用）。
    const cacheKey = pathShareKey(creep.room.name, targetPacked);
    const sharedResult = trySharedPath(creep, cacheKey);
    if (sharedResult !== undefined) {
      if (sharedResult === OK || sharedResult === ERR_TIRED) {
        recordTraffic(creep);
      }
      return sharedResult;
    }

    // 3. 首个到该目标的 creep — 计算路径，同时持久化 + 放入同 tick 共享。
    const path = computeAndPersistPath(creep, pos, targetPacked, structCount);
    if (path) {
      getPathShareCache().set(cacheKey, path);
      const result = creep.moveByPath(path);
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
    // 本地任务锁定单房（C1：配置化，remote 角色未来经 route/waypoint 跨房，不动内核）。
    maxRooms: CONFIG.movement.localMaxRooms,
    ignoreCreeps,
    // 关键：range 1 = 走到目标相邻格即可（source/controller/结构格不可站立）。
    // 缺少此项时 moveTo 默认 range=0，PathFinder 搜索不可行走格 → 永远找不到路径。
    range: 1,
    // 道路优先：引擎默认 road=1，plain=2 使道路成本仅为 plain 的一半。
    plainCost: 2,
    // 疲劳感知：慢速 creep（MOVE 容量 < 总重量）完全避开沼泽。
    swampCost: fatigueSwampCost(creep),
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
