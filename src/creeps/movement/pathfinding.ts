/**
 * 寻路核心 — 结构缓存、路径持久化、走廊共享、跨房间缓存、moveToTarget。
 * 路径缓存三级优先级（moveToTarget 内部）：1. 跨 tick 持久化路径（per-creep，目标+结构不变则复用）
 * 2. 走廊共享路径（同 tick 多 creep 共享主干，末端分歧）3. 新算 PathFinder + 持久化 + 放入共享缓存。
 * 跨房间路径缓存（remote mining 前置）：出口到出口的路径存 globalCache，地形不变则永不失效。
 */

import { CONFIG } from "../../config";
import { globalCache } from "../../kernel/global-cache";
import { recordSkip } from "../../kernel/memory";
import { packPos, recordTraffic } from "./traffic";
import { checkAndExecuteYield, tryPullBlocker, updateStuckTicks, clearTarget, DIR_DELTA } from "./stuck-recovery";
import { movePriorityFor, nextDirFromPath, registerMove, trafficEnabled } from "./intent";

// ─── CostMatrix 缓存（结构层）────────────────────────────

interface StructureCacheEntry {
  count: number;
  positions: number[];
  checkedTick: number;
  /** MV-2：路网 revision — 结构布局指纹变化时递增（plan §5.7.5 原设计）。
   * 持久化路径按 revision 失效而非「结构总数」：总数键的缺陷是「一拆一建总数不变 →
   * 路径穿新墙不失效」；指纹 = 位置数组的轻量散列，捕捉布局变化而非数量变化。 */
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
 * 从结构和工地数组构建 CostMatrix 位置数组。提取为共享辅助函数，消除 preload 与
 * ensure 回退路径之间的重复。
 * 同格多结构合并（关键）：rampart 可叠在 spawn/extension/tower/storage 之上，朴素
 * 「后写覆盖先写」会让己方 rampart 的 cost 2 洗掉障碍结构的 255 — 整圈核心叠盾格在
 * 矩阵里变成虚假可走格，路径穿 spawn、move 被引擎逐 tick 拒绝，物流车队集体冻结
 * （W37S58 线上实测全房停摆根因）。合并规则：任一结构为障碍（255）则整格 255；
 * 否则取最小通行成本（road 1 优于 container/rampart 2 — 叠盾道路仍按道路计费）。
 * @internal 导出仅供单元测试（tests/unit/movement/structure-matrix.test.ts）。
 */
export function buildStructurePositions(
  structures: readonly AnyStructure[],
  sites: readonly ConstructionSite[],
): { count: number; positions: number[] } {
  const merged = new Map<number, number>();
  const put = (x: number, y: number, cost: number): void => {
    const key = x * 50 + y;
    const prev = merged.get(key);
    if (prev === undefined) {
      merged.set(key, cost);
    } else {
      merged.set(key, prev === 255 || cost === 255 ? 255 : Math.min(prev, cost));
    }
  };

  for (const s of structures) {
    let cost: number;
    if (s.structureType === STRUCTURE_ROAD) cost = 1;
    else if (s.structureType === STRUCTURE_CONTAINER) cost = 2;
    else if (s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my) cost = 2;
    else cost = 255;
    put(s.pos.x, s.pos.y, cost);
  }
  for (const site of sites) {
    const t = site.structureType;
    // rampart/road/container site 完全可通行（与建成后形态一致）— 不加成本。
    // 曾把 rampart site 设为 255：防御规划器给矿位 container 与核心通道叠盾时，这些格瞬间变
    // 虚假实墙 → harvester 上不了矿位、distributor 被困核心区 → storage 只出不进烧干（线上实证）。
    if (t === STRUCTURE_ROAD || t === STRUCTURE_CONTAINER || t === STRUCTURE_RAMPART) continue;
    // 实体结构 site（extension/spawn/tower 等）：强避而非禁行 — site 阶段本可通行，
    // 255 会在密集建造期封锁通道；50 强烈绕开（避免挡住结构落成），被围困时仍可穿过逃生。
    put(site.pos.x, site.pos.y, 50);
  }

  const positions: number[] = [];
  for (const [key, cost] of merged) {
    positions.push(Math.floor(key / 50), key % 50, cost);
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
// 方案 B：RoomSnapshot 采集站桩位置（source container + controller container）预加载到
// movement 缓存，roomCallback 读取并标 255，使 PathFinder 天然绕开站桩矿工，根治缓存撞墙。
interface StaticBlockerEntry {
  positions: number[]; // 扁平 [x1, y1, x2, y2, ...]
  checkedTick: number;
}

/**
 * 预热静态占位缓存 — 由 room-snapshot 调用。站桩位置 = source 旁 range<=1 的 container
 * （harvester 矿位）+ controllerContainer（upgrader 站桩位）。每 tick 重算（creep 可能消失），
 * 只存 globalCache 不进 Memory。
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
 * 站桩占位自报 — 静止角色（远矿矿工/远矿 reserver）在岗时把自己的格登记为
 * 静态阻挡。外房无 RoomSnapshot，站桩占位无法预载，寻路矩阵看不见静止 creep：
 * 兄弟 creep 的路径反复指向被占矿位、意图逐 tick 被解算器拒绝 → 锁死空转
 * （线上实证：W36S58 北源采集者被 reserver 占住唯一矿位，idle 震荡）。
 * 语义：per-tick 生命周期（与 preload 同缓存，next tick 失效重报）；
 * 已预载本 tick 时追加去重；先于预载调用则自建条目。成本：一次数组 push。
 */
export function registerStaticBlocker(
  roomName: string,
  pos: { x: number; y: number },
): void {
  const g = globalCache() as any;
  if (!g.__staticBlockersCache) g.__staticBlockersCache = {};
  const packed = pos.x * 50 + pos.y;
  const entry = g.__staticBlockersCache[roomName];
  if (entry && entry.checkedTick === Game.time) {
    if (!entry.positions.includes(packed)) entry.positions.push(packed);
  } else {
    g.__staticBlockersCache[roomName] = { positions: [packed], checkedTick: Game.time };
  }
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

  // 审查修正（MV-2）：删除旧的「count 相等即续期」短路 — 一拆一建总数不变正是 revision
  // 机制要捕捉的场景，短路会让指纹/revision 永不更新；且部署前残留条目缺 revision 字段，
  // 短路续期会返回畸形条目。回退路径与 preload 走完全相同的指纹/revision 计算。
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

// ─── 自适应 reusePath ───

function adaptiveReusePath(creep: Creep, target: RoomPosition): number {
  const range = creep.pos.getRangeTo(target);
  if (range <= 3) return 3;
  if (range <= 10) return 5;
  return 15;
}

// ─── 疲劳感知 swampCost ───

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

// ─── 同 tick 路径共享 ───

/**
 * 沿缓存路径走一步 — moveByPath 的双模出口。
 * traffic 开启：提取下一步方向登记意图（不发引擎指令）；关闭：引擎 moveByPath + recordTraffic（旧行为）。
 * 返回 undefined 表示 creep 不在路径上（等价 ERR_NOT_FOUND，调用方失效缓存）。
 */
function issuePathStep(creep: Creep, path: readonly RoomPosition[]): ScreepsReturnCode | undefined {
  if (trafficEnabled()) {
    const nd = nextDirFromPath(creep, path);
    if (nd === undefined) return undefined;
    return registerMove(creep, nd, movePriorityFor(creep));
  }
  const result = creep.moveByPath(path as RoomPosition[]);
  if (result === ERR_NOT_FOUND || result === ERR_INVALID_ARGS) return undefined;
  if (result === OK || result === ERR_TIRED) recordTraffic(creep);
  return result;
}

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
  return issuePathStep(creep, path);
}

// ─── 走廊共享（主干路径 + 末端分歧）─────────────────────

/**
 * 走廊共享 — 同 tick 内多 creep 走向同一区域时共享主干路径。
 * 原理：hauler 填 5 个不同 extension（5 个不同目标），但前 80% 路径相同
 * （从 source container 到核心区域的主干），只有最后 2-3 格分歧。
 * 实现：走廊 key = roomHash*2500 + packedZoneCenter（区域中心格）；主干路径 = 从 creep 位置
 * 到区域边缘（range <= zoneRadius 时停止）；末端 = 各自 moveTo 精确目标。
 * 区域定义：以 spawn 为中心、半径 4 的圆形区域 = 「核心走廊」，未来可扩展多走廊。
 */

/**
 * 获取房间的核心区域中心（spawn 位置）。tick 级 globalCache 缓存（spawn 位置单 tick 内不变，
 * 多 creep 共享同一缓存项；跨 tick 自动失效）。不耦合 layout revision — spawn 位置变化是
 * 极低频事件，且 movement 层不应感知 layout 系统；即使每 tick find 一次也只是 1 次 find。
 * @internal 仅供 pathfinding 内部 + 单元测试使用。
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
    const result = issuePathStep(creep, trunkPath);
    if (result !== undefined) return result;
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

  if (result.path.length > 0) {
    // P1-D 修复：incomplete 部分路径也写入 per-tick 共享缓存 — 旧实现 `!result.incomplete`
    // 条件导致同 tick 内后续每个走向同走廊的 creep 都重跑一次 PathFinder.search（N-1 次重复
    // 无任何自愈收益；跨 tick 不重算才是自愈设计）。部分路径推进语义与引擎 moveTo 一致
    // （controller 唯一落点被静态阻挡时，upgrader 沿部分路径走近到 range3 即可开工）。
    // 持久层 __creepPathCache 维持不写 incomplete（红线保留），与 trySharedPath 写入 incomplete 对齐。
    // 契约修复：首格 prepend 首算者当前位置（PathFinder path 不含起点，见 computeAndPersistPath
    // 同款修复）— 否则首算者本人 issuePathStep 里 nextDirFromPath 定位不到自己 → 白算一次。
    // 后来者复用主干时在路径中段命中自身位置，不受首格影响。
    const trunkPath = [creep.pos, ...result.path];
    cache.set(cKey, trunkPath);
    const moveResult = issuePathStep(creep, trunkPath);
    if (moveResult !== undefined) return moveResult;
  }

  return undefined;
}

// ─── 跨 tick 路径持久化 ───

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

/**
 * 清理 __creepPathCache 中已死亡 creep 的残留条目，返回清理数。
 * P2-L：creep 死亡时其 path cache 不会被自动回收（global 状态无析构），长期运行会积累
 * stale entry 占内存。kernel 每 100 tick 调用本函数兜底回收（R9 登记的维护钩子）。
 * 设计权衡：清理逻辑放在 pathfinding（cache 属主）而非 memory.ts — memory.ts 不应感知
 * movement 的实现细节（__creepPathCache 字段名）。
 * @internal 业务代码不直接调用，唯一入口是 kernel 的低频维护循环。
 */
export function pruneDeadCreepCache(): number {
  const cache = getCreepPathCache();
  let pruned = 0;
  for (const name of Object.keys(cache)) {
    if (!Game.creeps[name]) {
      delete cache[name];
      pruned++;
    }
  }
  return pruned;
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

  const result = issuePathStep(creep, entry.path);
  if (result === undefined) {
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
  range = 1,
): RoomPosition[] | undefined {
  const result = PathFinder.search(
    creep.pos,
    { pos, range },
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

  if (result.path.length === 0) return undefined;

  // 契约修复：返回/缓存路径首格必须是 creep 当前位置。PathFinder.search 返回的 path
  // 不含起点（官服实测：search((25,25)→(30,25)).path[0]=(26,26)），而 nextDirFromPath
  // 按「在 path 中定位当前位置」提取方向 — 缺起点则刚算完的路径永远匹配不到 → undefined
  // → 缓存被立刻删除 → L2 强制重算（forceRepath 豁免冷却直走降级）的 creep 每 tick
  // 「search→白费→不动」无限死循环（线上实证：scout 在 W37S58 主房卡死 stuck 283+，
  // acquire/work 候选为空、ensureHome 是唯一移动驱动）。prepend 起点恢复系统既有契约
  // （dynamic-target-limit 测试注释「路径首格 = origin」即此假设），偏离路径重算语义
  // （第七刀：偏离不橡皮筋回旧起点）不变 — 偏离后当前位置不在 path 上仍返回 undefined。
  const fullPath = [creep.pos, ...result.path];

  // incomplete 部分路径可用但不持久化 — PathFinder 找不到完整路径时返回「朝目标推进的最优前缀」。
  // 丢弃会造成行为回归（引擎 moveTo 对 incomplete 就是沿部分路径走近：线上实测 controller 唯一
  // range1 落点被站桩静态阻挡标 255 时，upgrader 满载石化在 range5 — 走近到 range3 即可开工）。
  // 不持久化：路况随时变化，逐 tick 重算保留自愈能力。
  if (result.incomplete) return fullPath;

  getCreepPathCache()[creep.name] = { targetKey: targetPacked, structRevision, path: fullPath };
  return fullPath;
}

// ─── P1-E：动态目标寻路限频（docs/architecture/DATA_FLOW.md，remediation P1-E）────

/**
 * 档 1：目标驻留量化 — 将精确格 packed key (x*50+y) 量化到 3×3 区块 key；
 * 目标在区块内（≤2 格）移动不触发重寻路，沿旧路径走。区块外才 miss → 重算。
 * 编码：floor(x/3)*50 + floor(y/3)，与 packPos 同编码空间但值域更小，缓存比较无碰撞歧义。
 * @internal 导出仅供单元测试（tests/unit/movement/dynamic-target-limit.test.ts）。
 */
export function quantizeBlockKey(packed: number): number {
  const x = Math.floor(packed / 50);
  const y = packed % 50;
  return Math.floor(x / 3) * 50 + Math.floor(y / 3);
}

/**
 * 档 3：每房每 tick 寻路预算 — globalCache 计数器（per-tick 生命周期，与结构缓存同模式）。
 * @returns true = 获得预算（当前房本 tick search 次数 < max）；false = 超预算。
 * @internal 导出仅供单元测试。
 */
export function acquirePathBudget(roomName: string, max: number): boolean {
  const g = globalCache() as any;
  let budget = g.__pathSearchBudget;
  if (!budget || budget.tick !== Game.time) {
    budget = { tick: Game.time, byRoom: {} };
    g.__pathSearchBudget = budget;
  }
  const current = budget.byRoom[roomName] ?? 0;
  if (current >= max) return false;
  budget.byRoom[roomName] = current + 1;
  return true;
}

/**
 * Traffic 开启时的统一单步出口：持久化路径缓存 → PathFinder 重算 → 意图登记。
 * 引擎 moveTo 的意图化替身 — reusePath 语义由持久化缓存（目标 + 路网 revision 不变即复用）
 * 等价实现，forceRepath 对应 reusePath: 0。保证所有移动都经过 tick 末集中解算。
 * P1-E 三档限频（仅作用于 cache miss 的重算路径，缓存命中不受影响）：
 *   档 1 quantizeDynamicTarget：缓存 key 用 3×3 区块，动态目标区块内移动不 miss
 *     （R4 注：字段名含 "Dynamic" 但实现不区分动静态目标 — 见 config/index.ts 同名字段注释）。
 *   档 2 dynamicRepathInterval：冷却内不调 PathFinder.search，沿旧路径/直走降级；
 *     forceRepath（卡位）豁免 — 卡位 creep 必须拿到新路径。
 *   档 3 maxSearchesPerRoomPerTick：每房每 tick search 上限，超预算降级让行；
 *     forceRepath 不豁免 — 战时 CPU 爆炸比单个 creep 卡位更致命。
 */
function registerStepViaPathfinder(
  creep: Creep,
  pos: RoomPosition,
  priority: number,
  forceRepath: boolean,
  range = 1,
): ScreepsReturnCode {
  // 紧邻目标：单步直走，不值得进 PathFinder。
  if (creep.pos.getRangeTo(pos) <= 1) {
    if (creep.pos.isEqualTo(pos)) return OK;
    return registerMove(creep, creep.pos.getDirectionTo(pos), priority);
  }

  // P1-E 档 1：目标驻留量化 — 3×3 区块 key 替代精确格。动态目标在区块内移动不触发重寻路，
  // 沿旧路径走。search 仍用精确 pos。
  const exactPacked = packPos(pos);
  const targetPacked = CONFIG.movement.quantizeDynamicTarget
    ? quantizeBlockKey(exactPacked)
    : exactPacked;

  const structEntry = ensureStructureCache(creep.room.name);
  const rev = structEntry?.revision ?? -1;
  const cache = getCreepPathCache();
  if (forceRepath) delete cache[creep.name];
  const cached = cache[creep.name];

  // 缓存命中：目标同区块 + 路网 revision 不变 → 沿旧路径走一步
  // （不受冷却/预算限制 — 不调 PathFinder.search，零 CPU 开销）。
  if (cached && cached.targetKey === targetPacked && cached.structRevision === rev) {
    const nd = nextDirFromPath(creep, cached.path);
    if (nd !== undefined) return registerMove(creep, nd, priority);
    delete cache[creep.name]; // 掉出路径 — 缓存失效，下 tick 重算。
    return ERR_NO_PATH;
  }

  // cache miss — 需要重算。先过 P1-E 档 2/3 限频门。
  // 档 2：重寻路冷却。forceRepath（卡位）豁免 — 卡位 creep 必须拿到新路径。
  const interval = CONFIG.movement.dynamicRepathInterval;
  const inCooldown = !forceRepath
    && interval > 0
    && Game.time - (creep.memory.lastRepathAt ?? 0) < interval;

  // 档 3：每房每 tick 寻路预算。超预算降级（战时保险丝）。
  const budgetMax = CONFIG.movement.maxSearchesPerRoomPerTick;
  const overBudget = budgetMax > 0 && !acquirePathBudget(creep.room.name, budgetMax);

  if (inCooldown || overBudget) {
    // 限频降级：沿旧路径走一步（若有），旧路径空则 getDirectionTo 直走
    // （plan 评审修正 1/2：路径耗尽但目标仍在同区块时直走而非原地等待）。
    if (overBudget) recordSkip("movement/path-budget");
    if (cached) {
      const nd = nextDirFromPath(creep, cached.path);
      if (nd !== undefined) return registerMove(creep, nd, priority);
    }
    const dir = creep.pos.getDirectionTo(pos);
    if (dir !== null) return registerMove(creep, dir, priority);
    return ERR_NO_PATH;
  }

  // 通过限频门 — 执行 PathFinder.search。
  const path = computeAndPersistPath(creep, pos, targetPacked, rev, range);
  creep.memory.lastRepathAt = Game.time;
  if (path) {
    const nd = nextDirFromPath(creep, path);
    if (nd !== undefined) return registerMove(creep, nd, priority);
    delete cache[creep.name]; // 掉出路径 — 缓存失效，下 tick 重算。
  }
  return ERR_NO_PATH;
}

/**
 * 简单移动出口 — flee / 回收归航等「moveTo(reusePath:5, ignoreCreeps:false)」场景的双模替身。
 * traffic 关闭走引擎 moveTo（旧行为）；开启走统一单步出口。供 lifecycle / 角色 onFlee 等
 * movement 层外的调用点使用。
 */
export function stepToward(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
): ScreepsReturnCode {
  const pos = "pos" in target ? target.pos : target;
  if (!trafficEnabled()) {
    const result = creep.moveTo(pos, { reusePath: 5, ignoreCreeps: false });
    if (result === OK || result === ERR_TIRED) recordTraffic(creep);
    return result;
  }
  return registerStepViaPathfinder(creep, pos, movePriorityFor(creep), false);
}

// ─── 跨房间路径缓存（remote mining 前置）────────────────

/**
 * 跨房间路径缓存 — 出口到出口的路径存 globalCache，地形不变则永不失效（房间地形静态）。
 * 当前用途：moveTowardRoom 的出口选择优化；未来：remote mining 角色的跨房通勤。
 * key: `${fromRoom}:${toRoom}` → 出口方向 + 出口位置。
 */
interface InterRoomCacheEntry {
  exitDir: ExitConstant;
  exitPos: { x: number; y: number };
  /** MV-4：缓存写入 tick — 出口缓存加 TTL，避免出口格被新结构/敌方封堵后永不刷新
   * （原实现仅严重卡位才清）。 */
  cachedAt: number;
}

/** MV-4：跨房出口缓存 TTL。房间地形静态，但出口最近格随 creep 位置/封堵变化 —
 * 中等窗口平衡「避免每 tick findExitTo」与「不长期用陈旧出口」。 */
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

// ─── 核心移动函数 ───

/**
 * 向目标房间方向移动（通过最近出口），带道路优先 + 跨房间缓存 + 卡位脱困。
 * 卡位脱困（与 moveToTarget 对齐但精简）：L0 正常 reusePath:5（ignoreCreeps 引擎默认 false —
 * 跨房长途把 creep 当障碍更稳妥，MV-4 修正原注释「ignoreCreeps:true」的漂移）；
 * L1（stuck≥threshold）reusePath:0 强制重算路径；L2（≥threshold+repathLimit）清出口缓存 + 换出口位置。
 */
export function moveTowardRoom(creep: Creep, targetRoom: string): void {
  // 卡位检测 — 确保 ensureHome 提前 return 时仍能追踪 stuck 状态。
  const stuckTicks = updateStuckTicks(creep);
  const { stuckThreshold, repathLimit } = CONFIG.kernel;

  // 绕开 hostile 房：recon scout（memory.avoidRooms 已写入已知敌方房集合）用 Game.map.findRoute
  // 选「避开 hostile 房」的下一跳，而非几何最近出口——几何出口可能径直把 scout 带进敌方房
  // （如 W37S58→W38S58→W38S57，Aguia 的 W38S58 把 recon 卡死）。无路可绕（被 hostile 包围）
  // 时 findRoute 返回 ERR_NO_PATH，回退几何出口，由 scout 的 pushThrough 标志硬钻通过。
  let goalRoom = targetRoom;
  const avoidRooms = creep.memory.avoidRooms;
  if (avoidRooms && avoidRooms.length > 0 && Game.map?.findRoute && creep.room.name !== targetRoom) {
    const avoid = new Set(avoidRooms);
    const route = Game.map.findRoute(creep.room.name, targetRoom, {
      // 对途经房打 Infinity 成本；起点房（fromRoomName 为空）不打，否则整条路由失败。
      routeCallback(roomName, fromRoomName) {
        return avoid.has(roomName) && fromRoomName !== "" ? Infinity : 1;
      },
    });
    if (route !== ERR_NO_PATH) {
      const steps = route as { room: string }[];
      if (steps.length > 0) {
        goalRoom = steps[0]!.room;
      }
    }
  }

  // Level 2：严重卡位 → 清出口缓存，下次重新选出口。
  if (stuckTicks >= stuckThreshold + repathLimit) {
    clearInterRoomExit(creep.room.name, goalRoom);
    // 强制 repath + ignoreCreeps: false 绕过阻挡 creep。
    const exitDir = creep.room.findExitTo(goalRoom) as number;
    if (exitDir < 0) return;
    const exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
    if (exit) {
      // traffic 开启：出口是边界格，range 0 才会真正踏上出口。
      if (trafficEnabled()) {
        registerStepViaPathfinder(creep, exit, movePriorityFor(creep), true, 0);
        return;
      }
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
  const cached = getCachedInterRoomExit(creep.room.name, goalRoom);
  let exit: RoomPosition | null = null;

  if (cached) {
    exit = new RoomPosition(cached.exitPos.x, cached.exitPos.y, creep.room.name);
  } else {
    const exitDir = creep.room.findExitTo(goalRoom) as number;
    if (exitDir < 0) return;
    exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
    if (exit) {
      cacheInterRoomExit(creep.room.name, goalRoom, exitDir as ExitConstant, exit);
    }
  }

  if (exit) {
    // traffic 开启：统一单步出口（卡位时强制重算 = reusePath: 0 等价语义）。
    if (trafficEnabled()) {
      registerStepViaPathfinder(creep, exit, movePriorityFor(creep), stuckTicks >= stuckThreshold, 0);
      return;
    }
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
 * 停在 exit tile 上的 creep 下 tick 会被引擎弹回邻房，若当 tick idle 则形成
 * 「进房 → 弹回 → 再进房」横跳。返回 true 表示已处理（本 tick 内移）。
 * 审查修正：不盲移向 (25,25) — 内侧恰为地形墙时 move 静默失败、卡边界 + 角色管线被抑制；
 * 改为扫内侧邻格选可走者；全不可走返回 false 交还角色管线（其寻路会绕行进房）。
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
  // v33 修复：内侧格还需无占用 — 原实现只查地形，选中被停靠 creep / 阻挡结构
  // 占据的内侧格时，意图每 tick 被交通解算器拒绝（或引擎弹回），而管线已被
  // stepOffEdge 的 true 短路 — creep 永久钉死在边界格（线上实证：W36S58
  // reserver 被边界内侧停靠的 hauler 钉死 200+ tick，直至 hauler 自行离开）。
  // 阻挡口径与 buildStructurePositions 的 CostMatrix 一致：road/container/
  // 我方 rampart 可通行，其余结构阻挡（与寻路矩阵同一套语义，不引入分歧）。
  // mock 无 lookForAt 时降级为旧行为（能力守卫，不阻断既有测试环境）。
  const canLook = typeof creep.room.lookForAt === "function";
  for (const dx of dxs) {
    for (const dy of dys) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx <= 0 || nx >= 49 || ny <= 0 || ny >= 49) continue; // 仍是边界格不算逃离
      if (terrain.get(nx, ny) === TERRAIN_MASK_WALL) continue;
      if (canLook) {
        if (creep.room.lookForAt(LOOK_CREEPS, nx, ny).length > 0) continue;
        const structures = creep.room.lookForAt(LOOK_STRUCTURES, nx, ny) as AnyStructure[];
        const blocked = structures.some((s) => {
          if (s.structureType === STRUCTURE_ROAD || s.structureType === STRUCTURE_CONTAINER) return false;
          if (s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my) return false;
          return true;
        });
        if (blocked) continue;
      }
      const dir = creep.pos.getDirectionTo(nx, ny);
      registerMove(creep, dir as DirectionConstant, movePriorityFor(creep));
      return true;
    }
  }
  return false; // 内侧无可用格 — 交还角色管线，由其寻路绕行。
}

/**
 * 立即失效指定 creep 的持久化路径缓存 — 下一 tick 强制重算（forceRepath 语义）。
 * traffic-manager 在引擎拒绝签发移动（目标格被静态阻挡，如新筑的墙/落成结构）
 * 时调用：陈旧路径每 tick 撞同一堵墙，仅靠 stuck 计时器爬出要数百 tick
 * （线上实证：W36S58 新墙封路后编队钉死 ~400 tick 才自愈）。
 */
export function invalidateCreepPath(creepName: string): void {
  delete getCreepPathCache()[creepName];
}

/**
 * 确保 creep 已设置 home 房间；不在 home 时尝试向 home 方向移动。只有实际在 home 房内才返回 true。
 * 远程角色（remoteTarget 已设置）导航规则：remoteHauler work 模式 → 回 home 存能（穿梭行为）；
 * 其他远程角色常驻 remoteTarget；idle/flee 模式 → 回 home（安全）。
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
    // idle/flee → 回 home（安全）；remoteHauler work → 回 home（存能）；其余 → remoteTarget。
    // Bug 2 修复（扩展到全部远矿角色）：在 remoteTarget idle（container 空 / source 被压制 /
    // 无事可做）时不导航回 home，留在目标房等待条件恢复；否则 home↔remoteTarget 振荡
    // （idle→goHome→acquire→导航回 remoteTarget→又 idle…）至寿终（remoteHarvester 在
    // InvaderCore 压制房正是此症状；被 recycle 标记的 creep 由 recyclePass 接管移动，不受此影响）。
    // carrier（A3.0 跨房调拨）：acquire/idle/flee → home（source room 取能），
    // work → remoteTarget（target room 卸能）。与 remoteHauler 方向对偶。
    const isCarrier = creep.memory.role === "carrier";
    const goHome = mode === "flee" ||
      (mode === "idle" && creep.room.name !== remoteTarget) ||
      (mode === "work" && (creep.memory.role === "remoteHauler" || creep.memory.role === "coreClearer")) ||
      (isCarrier && (mode === "acquire" || mode === "idle"));
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
 * 路径缓存优先级：1. 跨 tick 持久化（per-creep，目标+结构不变）2. 走廊共享（同 tick 同区域主干）
 * 3. 同 tick 精确目标共享 4. 新 PathFinder + 持久化 5. 回退 moveTo（引擎内置缓存）。
 * 仅在操作返回 ERR_NOT_IN_RANGE 时调用。
 */
export function moveToTarget(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  moveRange = 1,
): ScreepsReturnCode {
  const pos = "pos" in target ? target.pos : target;

  // Yield 检查（traffic 开启时禁用 — 让路职责移交集中解算的推挤机制，双仲裁并存会互相打架）。
  if (!trafficEnabled() && checkAndExecuteYield(creep)) return OK;

  // 短路：range <= 1。
  const range = creep.pos.getRangeTo(pos);
  if (range <= 1) {
    const dir = creep.pos.getDirectionTo(pos);
    return registerMove(creep, dir, movePriorityFor(creep));
  }

  // 卡位检测。
  const stuckTicks = updateStuckTicks(creep);
  const { stuckThreshold, repathLimit } = CONFIG.kernel;

  // Level 3：放弃当前目标。必须重置 stuckTicks：放弃是「对这个目标认输」，不是永久瘫痪。
  // 不重置的后果（线上实测）：放弃分支不执行移动 → 位置不变 → stuckTicks 只增不减 → 每 tick
  // 直接进本分支 → 吸收态，虚假障碍消失后也永远出不来，全房 creep 集体静止。
  if (stuckTicks >= stuckThreshold + repathLimit) {
    clearTarget(creep);
    creep.memory.stuckTicks = 0;
    creep.memory.mode = "idle";
    return ERR_NO_PATH;
  }

  // Level 1：pull（traffic 开启时禁用 — 推挤已覆盖其全部场景）。
  if (!trafficEnabled() && stuckTicks === stuckThreshold) {
    tryPullBlocker(creep, pos);
  }

  // ── 方案 A：前置检测前方一格有 creep 时立即绕路（不等 stuckTicks 累积）──
  // 根因：PathFinder 的 roomCallback 默认不把 creep 当障碍，新算路径会穿过 creep，
  // 后续 creep 复用 __pathShare 缓存导致火车排队。仅在 stuckTicks===0 时检测（一旦卡住
  // Level 1/2 脱困接管）；traffic 开启时禁用 — 挡路 creep 由解算器仲裁/推挤，提前绕路
  // 反而放弃了直线路权。
  if (!trafficEnabled() && stuckTicks === 0 && range > 1) {
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
  // 交通热度记录已下沉到 issuePathStep / registerMove，调用点不再重复记录。
  if (stuckTicks === 0 && range > 3) {
    const targetPacked = packPos(pos);
    const structEntry = ensureStructureCache(creep.room.name);
    const structRevision = structEntry?.revision ?? -1;

    // 1. 跨 tick 持久化。
    const persistedResult = tryPersistedPath(creep, targetPacked, structRevision);
    if (persistedResult !== undefined) {
      return persistedResult;
    }

    // 2. 走廊共享（主干路径到核心区域边缘）。
    const corridorResult = tryCorridorPath(creep, pos);
    if (corridorResult !== undefined) {
      return corridorResult;
    }

    // 3. 同 tick 精确目标共享。
    const cacheKey = pathShareKey(creep.room.name, targetPacked);
    const sharedResult = trySharedPath(creep, cacheKey);
    if (sharedResult !== undefined) {
      return sharedResult;
    }

    // 4. 新计算 + 持久化 + 共享 —— 纳入档3每房预算（修复直算旁路）。
    // 此前仅 registerStepViaPathfinder 的 cache-miss 路径吃限频；集体缓存失效
    // 时刻（global reset / 结构 revision 跳变使持久化路径同 tick 全失效）全房
    // creep 从此处无节流重算，CPU 尖峰恰逢 bucket 低位。预算拒签时落入下方
    // 统一单步出口降级（沿旧路径一步/让行），下 tick 预算恢复自然补齐。
    const budgetMax = CONFIG.movement.maxSearchesPerRoomPerTick;
    if (budgetMax > 0 && !acquirePathBudget(creep.room.name, budgetMax)) {
      recordSkip("movement/path-budget");
    } else {
      const path = computeAndPersistPath(creep, pos, targetPacked, structRevision, moveRange);
      if (path) {
        getPathShareCache().set(cacheKey, path);
        const result = issuePathStep(creep, path);
        if (result !== undefined) {
          return result;
        }
      }
    }
  }

  // ── 回退（traffic 开启）：统一单步出口 — 消除引擎 moveTo 直发意图的旁路。
  // 卡位（Level 1+）时强制重算路径，与 reusePath: 0 等价。moveRange 透传：动作交互距离 > 1
  // （如 upgrade/build 的 range 3）时按实际距离求路 — range1 落点可能被静态阻挡/结构全部遮蔽。
  if (trafficEnabled()) {
    return registerStepViaPathfinder(creep, pos, movePriorityFor(creep), stuckTicks >= stuckThreshold, moveRange);
  }

  // ── 回退：moveTo（引擎内置缓存）──
  const reusePath = stuckTicks >= stuckThreshold + 1 ? 0 : adaptiveReusePath(creep, pos);
  const ignoreCreeps = stuckTicks < stuckThreshold;

  const options: MoveToOpts = {
    reusePath,
    maxRooms: CONFIG.movement.localMaxRooms,
    ignoreCreeps,
    range: moveRange,
    plainCost: 2,
    swampCost: fatigueSwampCost(creep),
    costCallback: structureCostCallback,
  };

  const result = creep.moveTo(pos, options);
  if (result === OK || result === ERR_TIRED) recordTraffic(creep);
  return result;
}
