import type { RoomSnapshot } from "../../kernel/contracts";

/**
 * 确定性走廊路规划。
 *
 * 老玩家认知：流量采样式修路（road-policy）对「长走廊」失效——source 到核心/controller 的
 * 中段格子离两端都远，永远达不到「靠近两个端点」的门槛，而那里恰恰是 hauler 跑得最多、
 * 最该修路的地方。这里改用 PathFinder 直接求关键物流节点间的最优路径并铺路：
 *   - 每个 source container → 核心(spawn)
 *   - controller container → 核心(spawn)
 * 星型拓扑让 source→核心→controller 的所有运输线都被覆盖，靠近核心的路段自然重合复用。
 * 路修好后 hauler 移动成本减半（plain 2→1），等效运力翻倍，RCL2 即可生效。
 */

/** 一条走廊的端点对（from → to）。 */
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

/** 判断 container 是否为 source container（紧邻某个 source）。 */
function isSourceContainer(c: StructureContainer, snapshot: RoomSnapshot): boolean {
  return snapshot.sources.some(
    s => Math.abs(s.pos.x - c.pos.x) <= 1 && Math.abs(s.pos.y - c.pos.y) <= 1,
  );
}

/**
 * 收集需要连通的物流走廊端点对（纯函数，便于单测）。
 *
 * 排序（按物流优先级从高到低）：
 *   1. controller container → core — 站桩升级供能线，hauler 供能最吃紧
 *   2. source container → core — 能量源头到孵化点
 *   3. storage → core — storage(RCL4+) 建成后 hauler 需 storage↔spawn 往返送能
 *
 * 配合 maxRoadsPerCycle 分段铺设时，优先保证最关键的供能走廊先成型。
 */
export function collectCorridorEndpoints(snapshot: RoomSnapshot): CorridorPair[] {
  const spawn = snapshot.spawns[0];
  if (!spawn) return [];
  const core = { x: spawn.pos.x, y: spawn.pos.y, roomName: snapshot.roomName };

  const pairs: CorridorPair[] = [];

  // controller container → 核心（优先）。
  if (snapshot.controllerContainer) {
    const cc = snapshot.controllerContainer;
    pairs.push({ from: { x: cc.pos.x, y: cc.pos.y, roomName: snapshot.roomName }, to: core });
  }

  // 每个 source container → 核心。
  for (const c of snapshot.containers) {
    if (!isSourceContainer(c, snapshot)) continue;
    pairs.push({ from: { x: c.pos.x, y: c.pos.y, roomName: snapshot.roomName }, to: core });
  }

  // storage → 核心（RCL4+，storage 建成后 hauler 的核心通勤路段）。
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
 * 构建走廊规划用的 CostMatrix — 每规划周期只构建一次，供所有走廊对复用。
 * 避开墙与已有结构（不能在其上修路），偏好已有道路（复用）。
 *
 * protectedPositions：蓝图未来格（packed x*50+y）— 标记为 255 不可通行。
 * 修复：旧实现不保护蓝图格，走廊路可能占用未来 extension 位置，
 * 导致该 extension 被 validateBuildCell 判定 "occupied" 而永久消失。
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

  // 保护蓝图未来格 — 走廊路不得占用未来的 extension/结构位置。
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

/**
 * 默认 PathFinder 实现：CostMatrix 每规划周期构建一次，所有走廊对共享。
 * 仅在运行时调用；单测通过注入 pathFn 绕过 Screeps 全局。
 */
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
 * 规划走廊路：沿最高优先级走廊对的最优路径收集待建道路格。
 *
 * 每次只规划一条走廊（第一个 pair），前一条建完后才规划下一条。
 * 原因：同时规划所有走廊会一次性涌入 30-40 条 road 淹没 buildQueue，
 * 抢占 builder 工时导致 extension/container 建造停滞。
 * 一条一条建，经济基础设施优先，道路是锦上添花。
 *
 * 去重规则：跳过已有 road / constructionSite / 结构 / source / controller 所在格，
 * 以及本批次已收录的格。受 maxRoadsPerCycle 上限约束分段返回。
 * 调用方（layout-planner）再按 key 与 buildQueue 去重后入队。
 */
export function planCorridorRoads(
  room: Room,
  snapshot: RoomSnapshot,
  options: CorridorRoadOptions = DEFAULT_CORRIDOR_OPTIONS,
  pathFn?: PathFn,
  protectedPositions?: ReadonlySet<number>,
): { x: number; y: number; roomName: string }[] {
  const pairs = collectCorridorEndpoints(snapshot);
  if (pairs.length === 0) return [];

  const fn = pathFn ?? defaultPathFn(snapshot, room, protectedPositions);

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

  // 只规划第一条走廊（最高优先级），不贪多。
  const pair = pairs[0]!;
  const path = fn(pair.from, pair.to);
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
