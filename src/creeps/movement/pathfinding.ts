/**
 * 寻路核心 — 结构缓存、路径持久化、走廊共享、跨房间缓存、moveToTarget。
 *
 * 路径缓存三级优先级（moveToTarget 内部）：
 *   1. 跨 tick 持久化路径（per-creep，目标+结构不变则复用）
 *   2. 走廊共享路径（同 tick 多 creep 共享主干，末端分歧）
 *   3. 新计算 PathFinder + 持久化 + 放入共享缓存
 *
 * 跨房间路径缓存（remote mining 前置）：
 *   出口到出口的路径存 globalCache，地形不变则永不失效。
 */

import { CONFIG } from "../../config";
import { globalCache } from "../../kernel/global-cache";
import { packPos, recordTraffic } from "./traffic";
import { checkAndExecuteYield, tryPullBlocker, updateStuckTicks, clearTarget, DIR_DELTA } from "./stuck-recovery";

// ─── CostMatrix 缓存（结构层）────────────────────────────

interface StructureCacheEntry {
  count: number;
  positions: number[];
  checkedTick: number;
  /** MV-2：路网 revision — 结构布局指纹变化时递增（plan §5.7.5 原设计）。
   * 持久化路径按 revision 失效而非「结构总数」：总数键有两个缺陷 —
   * a) 任一 site 创建/完工使全房所有 creep 的路径同 tick 集体失效
   *    （建造期每 tick 1 site → 高频全量重算，CPU 突刺）… 其实总数变化
   *    本就该失效；真正的缺陷是 b) 一拆一建总数不变 → 路径穿新墙不失效。
   * 指纹 = 位置数组的轻量散列，捕捉「布局变化」而非「数量变化」。 */
  revision: number;
  /** 位置数组指纹（内部用，revision 递增判据）。 */
  fingerprint: number;
}

/** 位置数组轻量指纹 — O(n) 求和散列，捕捉布局变化。 */
function fingerprintPositions(positions: readonly number[]): number {
  let h = positions.length;
  for (let i = 0; i < positions.length; i++) {
    h = (h * 31 + positions[i]!) | 0;
  }
  return h;
}

/**
 * 从结构和工地数组构建 CostMatrix 位置数组。
 * 提取为共享辅助函数，消除 preloadStructureCache 与 ensureStructureCache 回退路径之间的重复。
 */
function buildStructurePositions(
  structures: readonly AnyStructure[],
  sites: readonly ConstructionSite[],
): { count: number; positions: number[] } {
  const positions: number[] = [];
  for (const s of structures) {
    let cost: number;
    if (s.structureType === STRUCTURE_ROAD) cost = 1;
    else if (s.structureType === STRUCTURE_CONTAINER) cost = 2;
    else if (s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my) cost = 2;
    else cost = 255;
    positions.push(s.pos.x, s.pos.y, cost);
  }
  for (const site of sites) {
    const t = site.structureType;
    // rampart/road/container site 完全可通行（与建成后形态一致）— 不加成本。
    // 曾把 rampart site 设为 255：防御规划器给矿位 container 与核心通道叠盾时，
    // 这些格瞬间变虚假实墙 → harvester 上不了矿位（双源满血采集归零）、
    // distributor 被困核心区（满载卡死）→ storage 只出不进烧干，全房停滞。
    if (t === STRUCTURE_ROAD || t === STRUCTURE_CONTAINER || t === STRUCTURE_RAMPART) continue;
    // 实体结构 site（extension/spawn/tower 等）：强避而非禁行 —
    // site 阶段本可通行，255 会在密集建造期封锁通道；50 让路径强烈绕开
    // （避免挡住结构落成），但被围困时仍可穿过逃生。
    positions.push(site.pos.x, site.pos.y, 50);
  }
  return { count: structures.length + sites.length, positions };
}

/**
 * 预热结构缓存 — 由 room-snapshot 调用，利用已采集的数据避免冗余 room.find。
 * movement 模块拥有自己的缓存结构（__structCache），外部通过此函数写入，
 * 不再直接操作 globalCache as any（P1-2：消除隐式耦合）。
 */
export function preloadStructureCache(
  roomName: string,
  structures: readonly AnyStructure[],
  sites: readonly ConstructionSite[],
): void {
  const g = globalCache() as any;
  if (!g.__structCache) g.__structCache = {};
  const { count, positions } = buildStructurePositions(structures, sites);
  // MV-2：布局指纹变化才 bump revision — 持久化路径按 revision 失效。
  const fp = fingerprintPositions(positions);
  const prev: StructureCacheEntry | undefined = g.__structCache[roomName];
  const revision = prev === undefined || prev.fingerprint !== fp
    ? (prev?.revision ?? 0) + 1
    : prev.revision;
  g.__structCache[roomName] = { count, positions, checkedTick: Game.time, revision, fingerprint: fp };
}

// ─── 静态占位缓存（站桩 creep 位置）────────────────────────
// 方案 B：RoomSnapshot 采集站桩位置（source container + controller container），
// 预加载到 movement 缓存。pathfinding 的 roomCallback 读取并标 255，
// 使 PathFinder 算路径时天然绕开站桩矿工，根治缓存撞墙问题。
interface StaticBlockerEntry {
  positions: number[]; // 扁平 [x1, y1, x2, y2, ...]
  checkedTick: number;
}

/**
 * 预热静态占位缓存 — 由 room-snapshot 调用，利用已采集的 container/source 数据。
 * 站桩位置 = source 旁 range<=1 的 container（harvester 矿位）+ controllerContainer（upgrader 站桩位）。
 * 这些位置每 tick 重算（creep 可能消失），只存 globalCache 不进 Memory。
 */
export function preloadStaticBlockers(
  roomName: string,
  positions: number[],
): void {
  const g = globalCache() as any;
  if (!g.__staticBlockersCache) g.__staticBlockersCache = {};
  g.__staticBlockersCache[roomName] = { positions, checkedTick: Game.time };
}

/**
 * 将静态占位标记到 CostMatrix — 在所有 roomCallback 末尾调用。
 * 命中条件：checkedTick === Game.time（本 tick 已预加载）。
 * 未命中则跳过（该房间无站桩数据时路径仍可正常计算，只是不会绕开站桩 creep）。
 */
function applyStaticBlockers(matrix: CostMatrix, roomName: string): void {
  const g = globalCache() as any;
  const entry: StaticBlockerEntry | undefined = g.__staticBlockersCache?.[roomName];
  if (!entry || entry.checkedTick !== Game.time) return;
  const positions = entry.positions;
  for (let i = 0; i < positions.length; i += 2) {
    matrix.set(positions[i]!, positions[i + 1]!, 255);
  }
}

/**
 * 确保房间的结构缓存是最新的。
 * 优先读取 room-snapshot 预热的缓存（零 room.find）；
 * 仅在预热缺失时回退到 room.find（向后兼容）。
 */
function ensureStructureCache(roomName: string): StructureCacheEntry | undefined {
  const g = globalCache() as any;
  if (!g.__structCache) g.__structCache = {};

  let entry: StructureCacheEntry | undefined = g.__structCache[roomName];

  // 本 tick 已预热（由 room-snapshot 构建）→ 直接返回。
  if (entry && entry.checkedTick === Game.time) {
    return entry;
  }

  // 回退路径：预热缺失时自行 room.find（不应在正常 tick 中触发）。
  const room = Game.rooms[roomName];
  if (!room) return undefined;

  const structures = room.find(FIND_STRUCTURES);
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES);

  // 审查修正（MV-2）：删除旧的「count 相等即续期」短路 — 一拆一建总数
  // 不变正是 revision 机制要捕捉的场景，短路会让指纹/revision 永不更新；
  // 且部署前残留条目缺 revision 字段，短路续期会返回畸形条目。
  // 回退路径与 preload 走完全相同的指纹/revision 计算。
  const built = buildStructurePositions(structures, sites);
  const fp = fingerprintPositions(built.positions);
  const revision = entry === undefined || entry.fingerprint !== fp
    ? (entry?.revision ?? 0) + 1
    : entry.revision;
  entry = { count: built.count, positions: built.positions, checkedTick: Game.time, revision, fingerprint: fp };
  g.__structCache[roomName] = entry;
  return entry;
}

/**
 * costCallback — 将结构层成本叠加到引擎传入的地形矩阵上。
 * 返回 void（修改传入矩阵，保留地形成本）。
 */
function structureCostCallback(roomName: string, matrix: CostMatrix): void {
  const entry = ensureStructureCache(roomName);
  if (!entry) return;
  const positions = entry.positions;
  for (let i = 0; i < positions.length; i += 3) {
    matrix.set(positions[i]!, positions[i + 1]!, positions[i + 2]!);
  }
  applyStaticBlockers(matrix, roomName);
}

// ─── 自适应 reusePath ─────────────────────────────────────

function adaptiveReusePath(creep: Creep, target: RoomPosition): number {
  const range = creep.pos.getRangeTo(target);
  if (range <= 3) return 3;
  if (range <= 10) return 5;
  return 15;
}

// ─── 疲劳感知 swampCost ──────────────────────────────────

const PART_WEIGHT: Record<string, number> = {
  [WORK]: 2, [CARRY]: 2, [MOVE]: 2,
  [ATTACK]: 3, [RANGED_ATTACK]: 3, [HEAL]: 3,
  [TOUGH]: 1, [CLAIM]: 5,
};

function fatigueSwampCost(creep: Creep): number {
  const body = creep.body;
  let moveCapacity = 0;
  let totalWeight = 0;
  for (const part of body) {
    const weight = PART_WEIGHT[part.type] ?? 2;
    totalWeight += weight;
    if (part.type === MOVE) moveCapacity += 2;
  }
  return moveCapacity < totalWeight ? 255 : 10;
}

// ─── 同 tick 路径共享 ─────────────────────────────────────

function packRoomName(roomName: string): number {
  const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!match) return 0;
  const x = Number(match[2]) * (match[1] === "W" ? -1 : 1);
  const y = Number(match[4]) * (match[3] === "N" ? -1 : 1);
  return x * 1000 + y;
}

function pathShareKey(roomName: string, packedPos: number): number {
  return packRoomName(roomName) * 2500 + packedPos;
}

function getPathShareCache(): Map<number, RoomPosition[]> {
  const g = globalCache() as any;
  if (!g.__pathShare || g.__pathShareTick !== Game.time) {
    g.__pathShare = new Map();
    g.__pathShareTick = Game.time;
  }
  return g.__pathShare as Map<number, RoomPosition[]>;
}

function trySharedPath(creep: Creep, cacheKey: number): ScreepsReturnCode | undefined {
  const cache = getPathShareCache();
  const path = cache.get(cacheKey);
  if (!path) return undefined;
  const result = creep.moveByPath(path);
  if (result === ERR_NOT_FOUND || result === ERR_INVALID_ARGS) return undefined;
  return result;
}

// ─── 走廊共享（主干路径 + 末端分歧）─────────────────────

/**
 * 走廊共享 — 同 tick 内多 creep 走向同一区域时共享主干路径。
 *
 * 原理：hauler 填 5 个不同 extension（5 个不同目标），但前 80% 路径相同
 * （从 source container 到核心区域的主干）。只有最后 2-3 格分歧。
 *
 * 实现：
 *   - 走廊 key = roomHash * 2500 + packedZoneCenter（区域中心格）
 *   - 主干路径 = 从 creep 位置到区域边缘（range <= zoneRadius 时停止）
 *   - 末端 = 各自 moveTo 精确目标（短距离，开销可忽略）
 *
 * 区域定义：以 spawn 为中心、半径 4 的圆形区域 = "核心走廊"。
 * 未来可扩展为多走廊（source 走廊、controller 走廊）。
 */

/**
 * 获取房间的核心区域中心（spawn 位置）。
 *
 * tick 级 globalCache 缓存：
 *   - spawn 位置在单 tick 内不变，多 creep 共享同一缓存项。
 *   - 命中条件：cached.tick === Game.time。
 *   - 未命中：执行 room.find + 写缓存 → 后续 creep 直接读缓存。
 *   - 跨 tick 失效：Game.time 变化后首次调用重新 find。
 *
 * 缓存不耦合 layout revision — spawn 位置变化是极低频事件（layout 重建），
 * 且 movement 层不应感知 layout 系统。即使每 tick 重新 find 一次也只是 1 次 find，
 * 相比每 creep 都 find 的原实现已是数量级优化。
 *
 * @internal 仅供 pathfinding 内部 + 单元测试使用。外部消费者应通过
 *            moveToTarget 间接依赖走廊共享能力，不直接调用此函数。
 */
export function getCoreCenter(roomName: string): { x: number; y: number } | undefined {
  const g = globalCache() as any;
  if (!g.__coreCenter) g.__coreCenter = {};
  const cached = g.__coreCenter[roomName];
  if (cached && cached.tick === Game.time) return cached.pos;

  const room = Game.rooms[roomName];
  if (!room) return undefined;
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return undefined;
  const pos = { x: spawns[0]!.pos.x, y: spawns[0]!.pos.y };
  g.__coreCenter[roomName] = { tick: Game.time, pos };
  return pos;
}

/** 走廊共享缓存 key：roomHash * 2500 + packedZoneCenter。 */
function corridorKey(roomName: string, zoneCenter: { x: number; y: number }): number {
  return packRoomName(roomName) * 2500 + (zoneCenter.x * 50 + zoneCenter.y);
}

/** 核心走廊半径（进入此范围后各 creep 分歧到各自目标）。 */
const CORRIDOR_ZONE_RADIUS = 4;

/**
 * 尝试使用走廊共享路径。
 * 如果 creep 在走廊区域外且目标是走廊区域内，共享主干路径到区域边缘。
 * 返回 OK/ERR_TIRED 表示成功使用了走廊路径；undefined 表示不适用。
 */
function tryCorridorPath(creep: Creep, target: RoomPosition): ScreepsReturnCode | undefined {
  const center = getCoreCenter(creep.room.name);
  if (!center) return undefined;

  // 只有目标在核心区域内才使用走廊共享。
  const targetDistToCore = Math.max(Math.abs(target.x - center.x), Math.abs(target.y - center.y));
  if (targetDistToCore > CORRIDOR_ZONE_RADIUS) return undefined;

  // creep 已在区域内 — 不需要走廊（短距离直接 moveTo）。
  const creepDistToCore = Math.max(Math.abs(creep.pos.x - center.x), Math.abs(creep.pos.y - center.y));
  if (creepDistToCore <= CORRIDOR_ZONE_RADIUS + 1) return undefined;

  const cKey = corridorKey(creep.room.name, center);
  const cache = getPathShareCache();
  const trunkPath = cache.get(cKey);

  if (trunkPath) {
    // 复用主干路径。
    const result = creep.moveByPath(trunkPath);
    if (result !== ERR_NOT_FOUND && result !== ERR_INVALID_ARGS) return result;
  }

  // 首个到该走廊的 creep — 计算主干路径（到区域边缘 range = CORRIDOR_ZONE_RADIUS+1）。
  const centerPos = new RoomPosition(center.x, center.y, creep.room.name);
  const result = PathFinder.search(
    creep.pos,
    { pos: centerPos, range: CORRIDOR_ZONE_RADIUS + 1 },
    {
      plainCost: 2,
      swampCost: fatigueSwampCost(creep),
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
        applyStaticBlockers(matrix, roomName);
        return matrix;
      },
    },
  );

  if (!result.incomplete && result.path.length > 0) {
    cache.set(cKey, result.path);
    const moveResult = creep.moveByPath(result.path);
    if (moveResult !== ERR_NOT_FOUND && moveResult !== ERR_INVALID_ARGS) return moveResult;
  }

  return undefined;
}

// ─── 跨 tick 路径持久化 ─────────────────────────────────

interface CreepPathEntry {
  targetKey: number;
  /** MV-2：路网 revision — 布局变化时失效（替代旧 structCount 总数键）。 */
  structRevision: number;
  path: RoomPosition[];
}

function getCreepPathCache(): Record<string, CreepPathEntry> {
  const g = globalCache() as any;
  if (!g.__creepPathCache) g.__creepPathCache = {};
  return g.__creepPathCache;
}

function tryPersistedPath(
  creep: Creep,
  targetPacked: number,
  structRevision: number,
): ScreepsReturnCode | undefined {
  const cache = getCreepPathCache();
  const entry = cache[creep.name];
  if (!entry) return undefined;
  if (entry.targetKey !== targetPacked) return undefined;
  if (entry.structRevision !== structRevision) return undefined;

  const result = creep.moveByPath(entry.path);
  if (result === ERR_NOT_FOUND || result === ERR_INVALID_ARGS) {
    delete cache[creep.name];
    return undefined;
  }
  return result;
}

function computeAndPersistPath(
  creep: Creep,
  pos: RoomPosition,
  targetPacked: number,
  structRevision: number,
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
        applyStaticBlockers(matrix, roomName);
        return matrix;
      },
    },
  );

  if (result.incomplete || result.path.length === 0) return undefined;

  getCreepPathCache()[creep.name] = { targetKey: targetPacked, structRevision, path: result.path };
  return result.path;
}

// ─── 跨房间路径缓存（remote mining 前置）────────────────

/**
 * 跨房间路径缓存 — 出口到出口的路径存 globalCache。
 * 地形不变则永不失效（房间地形是静态的）。
 *
 * 当前用途：moveTowardRoom 的出口选择优化。
 * 未来用途：remote mining 角色的跨房间通勤路径。
 *
 * key: `${fromRoom}:${toRoom}` → 出口方向 + 出口位置
 */
interface InterRoomCacheEntry {
  exitDir: ExitConstant;
  exitPos: { x: number; y: number };
  /** MV-4：缓存写入 tick — 出口缓存加 TTL，避免出口格被新结构/敌方封堵后
   * 永不刷新（原实现仅严重卡位才清）。 */
  cachedAt: number;
}

/** MV-4：跨房出口缓存 TTL。房间地形静态，但出口最近格随 creep 位置/
 * 封堵变化 — 给一个中等窗口平衡「避免每 tick findExitTo」与「不长期用陈旧出口」。 */
const INTER_ROOM_CACHE_TTL = 100;

function getInterRoomCache(): Record<string, InterRoomCacheEntry> {
  const g = globalCache() as any;
  if (!g.__interRoomCache) g.__interRoomCache = {};
  return g.__interRoomCache;
}

/** 缓存跨房间出口信息。 */
function cacheInterRoomExit(fromRoom: string, toRoom: string, exitDir: ExitConstant, exitPos: RoomPosition): void {
  getInterRoomCache()[`${fromRoom}:${toRoom}`] = {
    exitDir,
    exitPos: { x: exitPos.x, y: exitPos.y },
    cachedAt: Game.time,
  };
}

/** 查询缓存的跨房间出口信息（MV-4：TTL 过期视为未命中）。 */
function getCachedInterRoomExit(fromRoom: string, toRoom: string): InterRoomCacheEntry | undefined {
  const entry = getInterRoomCache()[`${fromRoom}:${toRoom}`];
  if (!entry) return undefined;
  if (Game.time - (entry.cachedAt ?? 0) > INTER_ROOM_CACHE_TTL) {
    delete getInterRoomCache()[`${fromRoom}:${toRoom}`];
    return undefined;
  }
  return entry;
}

/** 清除缓存的跨房间出口信息（卡位脱困时调用，强制下次重新选出口）。 */
function clearInterRoomExit(fromRoom: string, toRoom: string): void {
  delete getInterRoomCache()[`${fromRoom}:${toRoom}`];
}

// ─── 核心移动函数 ─────────────────────────────────────────

/**
 * 向目标房间方向移动（通过最近出口），带道路优先 + 跨房间缓存 + 卡位脱困。
 *
 * 卡位脱困（与 moveToTarget 对齐但精简）：
 *   Level 0（正常）：reusePath: 5（ignoreCreeps 引擎默认 false — 跨房长途
 *     把 creep 当障碍更稳妥，MV-4 修正原注释「ignoreCreeps: true」的漂移）
 *   Level 1（stuck >= threshold）：reusePath: 0 强制重算路径
 *   Level 2（stuck >= threshold + repathLimit）：清出口缓存 + 换出口位置
 */
export function moveTowardRoom(creep: Creep, targetRoom: string): void {
  // 卡位检测 — 确保 ensureHome 提前 return 时仍能追踪 stuck 状态。
  const stuckTicks = updateStuckTicks(creep);
  const { stuckThreshold, repathLimit } = CONFIG.kernel;

  // Level 2：严重卡位 → 清出口缓存，下次重新选出口。
  if (stuckTicks >= stuckThreshold + repathLimit) {
    clearInterRoomExit(creep.room.name, targetRoom);
    // 强制 repath + ignoreCreeps: false 绕过阻挡 creep。
    const exitDir = creep.room.findExitTo(targetRoom) as number;
    if (exitDir < 0) return;
    const exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
    if (exit) {
      creep.moveTo(exit, {
        reusePath: 0,
        plainCost: 2,
        swampCost: fatigueSwampCost(creep),
        ignoreCreeps: false,
        costCallback: structureCostCallback,
      });
    }
    return;
  }

  // 尝试使用缓存的出口信息（避免每 tick 调用 findExitTo + findClosestByRange）。
  const cached = getCachedInterRoomExit(creep.room.name, targetRoom);
  let exit: RoomPosition | null = null;

  if (cached) {
    exit = new RoomPosition(cached.exitPos.x, cached.exitPos.y, creep.room.name);
  } else {
    const exitDir = creep.room.findExitTo(targetRoom) as number;
    if (exitDir < 0) return;
    exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
    if (exit) {
      cacheInterRoomExit(creep.room.name, targetRoom, exitDir as ExitConstant, exit);
    }
  }

  if (exit) {
    // Level 1：卡位 → reusePath: 0 强制重算路径。
    const reusePath = stuckTicks >= stuckThreshold ? 0 : 5;
    const result = creep.moveTo(exit, {
      reusePath,
      plainCost: 2,
      // MV-4：与 moveToTarget 一致用疲劳感知 swamp 成本 — 重载跨房 creep
      // （remote-hauler 满载回家）不再被固定 10 引进沼泽泥潭。
      swampCost: fatigueSwampCost(creep),
      costCallback: structureCostCallback,
    });
    if (result === OK || result === ERR_TIRED) {
      recordTraffic(creep);
    }
  }
}

/**
 * MV-4：到达目标房但站在边界格（exit tile）— 内移一步防引擎弹回。
 * 停在 exit tile 上的 creep 下 tick 会被引擎弹回邻房，若角色当 tick idle
 * 则形成「进房 → 弹回 → 再进房」横跳。返回 true 表示已处理（本 tick 内移）。
 *
 * 审查修正：不再盲移向 (25,25) — 内侧恰为地形墙时 move 静默失败，
 * creep 卡边界 + 角色管线被抑制，形成比修复前更差的弹房死循环。
 * 改为扫内侧邻格选可走者；全不可走则返回 false 交还角色管线
 * （角色自己的寻路会绕行进房）。
 */
function stepOffEdge(creep: Creep): boolean {
  const { x, y } = creep.pos;
  if (x !== 0 && x !== 49 && y !== 0 && y !== 49) return false;
  // mock 环境无 getTerrain 时不处理（归位同款能力守卫）。
  if (typeof creep.room.getTerrain !== "function") return false;
  const terrain = creep.room.getTerrain();
  // 内移方向：先算指向房心的粗方向分量，再枚举含斜向的内侧候选。
  const dxs = x === 0 ? [1] : x === 49 ? [-1] : [0, 1, -1];
  const dys = y === 0 ? [1] : y === 49 ? [-1] : [0, 1, -1];
  for (const dx of dxs) {
    for (const dy of dys) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx <= 0 || nx >= 49 || ny <= 0 || ny >= 49) continue; // 仍是边界格不算逃离
      if (terrain.get(nx, ny) === TERRAIN_MASK_WALL) continue;
      const dir = creep.pos.getDirectionTo(nx, ny);
      creep.move(dir as DirectionConstant);
      return true;
    }
  }
  return false; // 无可走内侧格 — 交还角色管线，由其寻路绕行。
}

/**
 * 确保 creep 已设置 home 房间；不在 home 时尝试向 home 方向移动。
 * 只有 creep 实际在 home 房间内时才返回 true。
 *
 * 远程角色（remoteTarget 已设置）的导航规则：
 *   - remoteHauler work 模式 → 回 home 存能（穿梭行为）
 *   - 其他远程角色 → 常驻 remoteTarget
 *   - idle/flee 模式 → 回 home（安全）
 */
export function ensureHome(creep: Creep): boolean {
  if (!creep.memory.home) {
    creep.memory.home = creep.room.name;
  }
  const home = creep.memory.home;

  // 远程角色导航
  const remoteTarget = creep.memory.remoteTarget;
  if (remoteTarget) {
    const mode = creep.memory.mode ?? "acquire";
    // idle/flee → 回 home（安全）
    // remoteHauler work → 回 home（存能）
    // 其余 → remoteTarget
    // Bug 2 修复（扩展到全部远矿角色）：在 remoteTarget idle（container 空 /
    // source 被压制 / 无事可做）时不导航回 home，留在目标房等待条件恢复。
    // 否则 home↔remoteTarget 振荡：remoteTarget idle → goHome → home →
    // updateMode 转 acquire → 导航回 remoteTarget → 又 idle → goHome → ...
    // creep 在两房边界来回穿梭直至寿终（remoteHarvester 在 InvaderCore 压制房
    // 正是这个症状；被 recycle 标记的 creep 由 recyclePass 接管移动，不受此影响）。
    const goHome = mode === "flee" ||
      (mode === "idle" && creep.room.name !== remoteTarget) ||
      (mode === "work" && creep.memory.role === "remoteHauler");
    const dest = goHome ? home : remoteTarget;
    if (creep.room.name === dest) {
      // MV-4：边界格防弹回 — 先内移一步再交还角色管线。
      if (stepOffEdge(creep)) return false;
      return true;
    }
    moveTowardRoom(creep, dest);
    return false;
  }

  // 本地角色：原行为
  if (creep.room.name === home) {
    if (stepOffEdge(creep)) return false;
    return true;
  }
  moveTowardRoom(creep, home);
  return false;
}

/**
 * 移动到目标 — 带自适应路径缓存、走廊共享、渐进式脱困。
 *
 * 路径缓存优先级：
 *   1. 跨 tick 持久化（per-creep，目标+结构不变）
 *   2. 走廊共享（同 tick 同区域主干）
 *   3. 同 tick 精确目标共享
 *   4. 新 PathFinder + 持久化
 *   5. 回退 moveTo（引擎内置缓存）
 *
 * 仅在操作返回 ERR_NOT_IN_RANGE 时调用。
 */
export function moveToTarget(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
): ScreepsReturnCode {
  const pos = "pos" in target ? target.pos : target;

  // Yield 检查。
  if (checkAndExecuteYield(creep)) return OK;

  // 短路：range <= 1。
  const range = creep.pos.getRangeTo(pos);
  if (range <= 1) {
    const dir = creep.pos.getDirectionTo(pos);
    const result = creep.move(dir);
    if (result === OK || result === ERR_TIRED) recordTraffic(creep);
    return result;
  }

  // 卡位检测。
  const stuckTicks = updateStuckTicks(creep);
  const { stuckThreshold, repathLimit } = CONFIG.kernel;

  // Level 3：放弃当前目标。
  // 必须重置 stuckTicks：放弃是「对这个目标认输」，不是永久瘫痪。
  // 不重置的后果（线上实测）：放弃分支不执行移动 → 位置不变 → stuckTicks
  // 只增不减 → 每 tick 直接进本分支 → 吸收态，虚假障碍消失后也永远出不来，
  // 全房 creep 集体静止。重置后角色逻辑重选目标，下一目标从零开始计数。
  if (stuckTicks >= stuckThreshold + repathLimit) {
    clearTarget(creep);
    creep.memory.stuckTicks = 0;
    creep.memory.mode = "idle";
    return ERR_NO_PATH;
  }

  // Level 1：pull。
  if (stuckTicks === stuckThreshold) {
    tryPullBlocker(creep, pos);
  }

  // ── 方案 A：前置检测前方一格有 creep 时立即绕路（不等 stuckTicks 累积）──
  // 根因：PathFinder 的 roomCallback 默认不把 creep 当障碍，新算路径会穿过 creep，
  // 后续 creep 复用 __pathShare 缓存导致火车排队。
  // 仅在 stuckTicks === 0 时检测——一旦卡住（stuckTicks > 0），Level 1/2 脱困接管。
  if (stuckTicks === 0 && range > 1) {
    const dir = creep.pos.getDirectionTo(pos);
    const delta = DIR_DELTA[dir];
    if (delta) {
      const nextX = creep.pos.x + delta[0];
      const nextY = creep.pos.y + delta[1];
      if (nextX >= 0 && nextX <= 49 && nextY >= 0 && nextY <= 49) {
        const blockers = creep.room.lookForAt(LOOK_CREEPS, nextX, nextY);
        if (blockers.length > 0) {
          // 前方一格有 creep，跳过缓存直接让引擎绕路。
          const result = creep.moveTo(pos, {
            reusePath: 0,
            ignoreCreeps: false,
            maxRooms: CONFIG.movement.localMaxRooms,
            range: 1,
            plainCost: 2,
            swampCost: fatigueSwampCost(creep),
            costCallback: structureCostCallback,
          });
          if (result === OK || result === ERR_TIRED) recordTraffic(creep);
          return result;
        }
      }
    }
  }

  // ── 路径缓存（Level 0 + 中远距离）──
  if (stuckTicks === 0 && range > 3) {
    const targetPacked = packPos(pos);
    const structEntry = ensureStructureCache(creep.room.name);
    const structRevision = structEntry?.revision ?? -1;

    // 1. 跨 tick 持久化。
    const persistedResult = tryPersistedPath(creep, targetPacked, structRevision);
    if (persistedResult !== undefined) {
      if (persistedResult === OK || persistedResult === ERR_TIRED) recordTraffic(creep);
      return persistedResult;
    }

    // 2. 走廊共享（主干路径到核心区域边缘）。
    const corridorResult = tryCorridorPath(creep, pos);
    if (corridorResult !== undefined) {
      if (corridorResult === OK || corridorResult === ERR_TIRED) recordTraffic(creep);
      return corridorResult;
    }

    // 3. 同 tick 精确目标共享。
    const cacheKey = pathShareKey(creep.room.name, targetPacked);
    const sharedResult = trySharedPath(creep, cacheKey);
    if (sharedResult !== undefined) {
      if (sharedResult === OK || sharedResult === ERR_TIRED) recordTraffic(creep);
      return sharedResult;
    }

    // 4. 新计算 + 持久化 + 共享。
    const path = computeAndPersistPath(creep, pos, targetPacked, structRevision);
    if (path) {
      getPathShareCache().set(cacheKey, path);
      const result = creep.moveByPath(path);
      if (result !== ERR_NOT_FOUND && result !== ERR_INVALID_ARGS) {
        if (result === OK || result === ERR_TIRED) recordTraffic(creep);
        return result;
      }
    }
  }

  // ── 回退：moveTo（引擎内置缓存）──
  const reusePath = stuckTicks >= stuckThreshold + 1 ? 0 : adaptiveReusePath(creep, pos);
  const ignoreCreeps = stuckTicks < stuckThreshold;

  const options: MoveToOpts = {
    reusePath,
    maxRooms: CONFIG.movement.localMaxRooms,
    ignoreCreeps,
    range: 1,
    plainCost: 2,
    swampCost: fatigueSwampCost(creep),
    costCallback: structureCostCallback,
  };

  const result = creep.moveTo(pos, options);
  if (result === OK || result === ERR_TIRED) recordTraffic(creep);
  return result;
}
