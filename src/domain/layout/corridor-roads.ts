import type { RoomSnapshot } from "../../kernel/contracts";
import { globalCache, type CorridorPathCacheEntry } from "../../kernel/global-cache";

/**
 * 确定性走廊路规划 — 流量采样式修路（road-policy）对长走廊失效：
 * source/controller 到核心的中段格子离两端都远，达不到端点门槛却最该修路，
 * 故改用 PathFinder 直接求关键物流节点间最优路径（星型拓扑：每个 source
 * container→核心、controller container→核心，靠近核心路段自然重合复用）。
 * 路成后 hauler 移动成本 plain 2→1，等效运力翻倍，RCL2 即可生效。
 */


export interface CorridorPair {
  readonly from: { x: number; y: number; roomName: string };
  readonly to: { x: number; y: number; roomName: string };
}

export interface CorridorRoadOptions {
  /** 单次规划最多入队的道路格数 — 分段铺设，避免一次性占用过多 builder 拖慢 RCL 冲刺。 */
  readonly maxRoadsPerCycle: number;
}

export const DEFAULT_CORRIDOR_OPTIONS: CorridorRoadOptions = {
  maxRoadsPerCycle: 12,
};


function isSourceContainer(c: StructureContainer, snapshot: RoomSnapshot): boolean {
  return snapshot.sources.some(
    s => Math.abs(s.pos.x - c.pos.x) <= 1 && Math.abs(s.pos.y - c.pos.y) <= 1,
  );
}

/**
 * 收集物流走廊端点对（纯函数，便于单测）。排序即铺设优先级：
 * controller 供能线最吃紧优先，其次 source 源头，最后 storage(RCL4+)。
 */
export function collectCorridorEndpoints(snapshot: RoomSnapshot): CorridorPair[] {
  const spawn = snapshot.spawns[0];
  if (!spawn) return [];
  const core = { x: spawn.pos.x, y: spawn.pos.y, roomName: snapshot.roomName };

  const pairs: CorridorPair[] = [];


  if (snapshot.controllerContainer) {
    const cc = snapshot.controllerContainer;
    pairs.push({ from: { x: cc.pos.x, y: cc.pos.y, roomName: snapshot.roomName }, to: core });
  }


  for (const c of snapshot.containers) {
    if (!isSourceContainer(c, snapshot)) continue;
    pairs.push({ from: { x: c.pos.x, y: c.pos.y, roomName: snapshot.roomName }, to: core });
  }


  if (snapshot.storage) {
    const st = snapshot.storage;
    pairs.push({ from: { x: st.pos.x, y: st.pos.y, roomName: snapshot.roomName }, to: core });
  }

  return pairs;
}

/** PathFinder 抽象 — 返回 from 到 to（range 1）的路径格序列。可注入以便单测。 */
export type PathFn = (
  from: { x: number; y: number; roomName: string },
  to: { x: number; y: number; roomName: string },
) => { x: number; y: number }[];

/**
 * 构建走廊规划用 CostMatrix — 每规划周期一次，所有走廊对复用。
 * 墙/已有结构不可通行，已有道路 cost 1 优先复用。protectedPositions
 * （蓝图未来格 packed x*50+y）标记 255：防止走廊路占用未来 extension
 * 位置，导致该 extension 被 validateBuildCell 判 occupied 而永久消失。
 */
export function buildCorridorCostMatrix(
  snapshot: RoomSnapshot,
  room: Room,
  protectedPositions?: ReadonlySet<number>,
): CostMatrix {
  const cost = new PathFinder.CostMatrix();
  const terrain = room.getTerrain();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) cost.set(x, y, 255);
    }
  }
  for (const s of [...snapshot.spawns, ...snapshot.extensions, ...snapshot.towers, ...snapshot.containers]) {
    cost.set(s.pos.x, s.pos.y, 255);
  }
  if (snapshot.storage) cost.set(snapshot.storage.pos.x, snapshot.storage.pos.y, 255);
  for (const s of snapshot.sources) cost.set(s.pos.x, s.pos.y, 255);
  if (snapshot.controller) cost.set(snapshot.controller.pos.x, snapshot.controller.pos.y, 255);
  for (const s of snapshot.constructionSites) cost.set(s.pos.x, s.pos.y, 255);
  for (const r of snapshot.roads) cost.set(r.pos.x, r.pos.y, 1);


  if (protectedPositions) {
    for (const packed of protectedPositions) {
      const x = Math.floor(packed / 50);
      const y = packed % 50;
      // 仅在该格尚未被标记为道路时保护（已有道路优先保留）。
      if (cost.get(x, y) !== 1) cost.set(x, y, 255);
    }
  }

  return cost;
}

/** 默认 PathFinder 实现（运行时用）；单测通过注入 pathFn 绕过 Screeps 全局。 */
export function defaultPathFn(
  snapshot: RoomSnapshot,
  room: Room,
  protectedPositions?: ReadonlySet<number>,
): PathFn {
  // 每规划周期只构建一次 CostMatrix（旧实现每走廊对构建一次，N 对 = N 次 50x50 扫描）。
  const cost = buildCorridorCostMatrix(snapshot, room, protectedPositions);
  return (from, to) => {
    const fromPos = new RoomPosition(from.x, from.y, from.roomName);
    const toPos = new RoomPosition(to.x, to.y, to.roomName);
    const ret = PathFinder.search(fromPos, { pos: toPos, range: 1 }, {
      plainCost: 2,
      swampCost: 10,
      roomCallback: () => cost,
    });
    return ret.path.map(p => ({ x: p.x, y: p.y }));
  };
}

/**
 * 规划走廊路 — 每次只铺最高优先级的一条，前一条建完再规划下一条：
 * 全量铺会涌入 30-40 条 road 淹没 buildQueue、抢占 builder 工时导致
 * extension/container 建造停滞。去重跳过已有 road/site/结构/source/
 * controller 与本批已收录格，受 maxRoadsPerCycle 分段返回；调用方
 * layout-planner 再按 key 与 buildQueue 去重入队。
 *
 * 路径缓存（漏洞 #5/#8 修复）：结果存 globalCache.corridorPathCache
 * （heap 不升 schema），pairKey/rcl/anchor 任一变化失效；路径格被新建
 * 结构占用只做 occupied 过滤、不触发失效（局部重算无意义，整体重算更优）。
 *
 * @param anchor 锚点位置（缓存失效条件之一；不传则不缓存，保证单测确定性）
 * @param pathFn PathFinder 注入（单测用）；protectedPositions 蓝图未来格
 */
export function planCorridorRoads(
  room: Room,
  snapshot: RoomSnapshot,
  options: CorridorRoadOptions = DEFAULT_CORRIDOR_OPTIONS,
  pathFn?: PathFn,
  protectedPositions?: ReadonlySet<number>,
  anchor?: { x: number; y: number },
): { x: number; y: number; roomName: string }[] {
  const pairs = collectCorridorEndpoints(snapshot);
  if (pairs.length === 0) return [];


  const pair = pairs[0]!;
  const pairKey = `${pair.from.x},${pair.from.y}→${pair.to.x},${pair.to.y}`;


  // 路径缓存查询（仅当 anchor 提供时启用）。
  let path: { x: number; y: number }[];
  if (anchor && !pathFn) {
    path = getCachedOrComputePath(snapshot.roomName, pairKey, pair, anchor, snapshot, room, protectedPositions);
  } else {
    // 单测注入 pathFn 或无 anchor 时不走缓存（保证测试确定性）。
    const fn = pathFn ?? defaultPathFn(snapshot, room, protectedPositions);
    path = fn(pair.from, pair.to);
  }


  // 已占用格：不能在其上修路，也不重复入队。
  const occupied = new Set<string>();
  for (const s of [
    ...snapshot.roads,
    ...snapshot.constructionSites,
    ...snapshot.spawns,
    ...snapshot.extensions,
    ...snapshot.towers,
    ...snapshot.containers,
  ]) {
    occupied.add(`${s.pos.x},${s.pos.y}`);
  }
  if (snapshot.storage) occupied.add(`${snapshot.storage.pos.x},${snapshot.storage.pos.y}`);
  for (const s of snapshot.sources) occupied.add(`${s.pos.x},${s.pos.y}`);
  if (snapshot.controller) occupied.add(`${snapshot.controller.pos.x},${snapshot.controller.pos.y}`);

  const seen = new Set<string>();
  const result: { x: number; y: number; roomName: string }[] = [];
  for (const step of path) {
    if (step.x < 1 || step.x > 48 || step.y < 1 || step.y > 48) continue;
    const key = `${step.x},${step.y}`;
    if (occupied.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push({ x: step.x, y: step.y, roomName: snapshot.roomName });
    if (result.length >= options.maxRoadsPerCycle) break;
  }

  return result;
}

/**
 * 查询走廊路缓存：命中且 signature（pairKey + rcl + anchor，漏洞 #5 完整失效条件）
 * 匹配则返回缓存路径，否则计算并写入。任一变化即失效：端点 container/storage
 * 消失或新建、RCL 解锁新结构、spawn 重建换位。
 */
function getCachedOrComputePath(
  roomName: string,
  pairKey: string,
  pair: CorridorPair,
  anchor: { x: number; y: number },
  snapshot: RoomSnapshot,
  room: Room,
  protectedPositions?: ReadonlySet<number>,
): { x: number; y: number }[] {
  const cache = globalCache();
  if (cache.corridorPathCache === undefined) cache.corridorPathCache = new Map();
  const cached = cache.corridorPathCache.get(roomName);

  // 命中条件：pairKey + rcl + anchor 全匹配。
  const cacheHit =
    cached !== undefined &&
    cached.pairKey === pairKey &&
    cached.rcl === snapshot.rcl &&
    cached.anchor.x === anchor.x &&
    cached.anchor.y === anchor.y;

  if (cacheHit) {
    return cached!.path;
  }

  // 未命中或失效 → PathFinder 计算。
  const fn = defaultPathFn(snapshot, room, protectedPositions);
  const path = fn(pair.from, pair.to);

  const entry: CorridorPathCacheEntry = {
    pairKey,
    rcl: snapshot.rcl,
    anchor: { x: anchor.x, y: anchor.y },
    path,
    tick: Game.time,
  };
  cache.corridorPathCache.set(roomName, entry);
  return path;
}
