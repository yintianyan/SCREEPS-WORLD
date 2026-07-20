import type { RoomSnapshot } from "../../kernel/contracts";

/** 道路候选 — 交通热度转道路任务的结果。 */
export interface RoadCandidate {
  readonly key: string;
  readonly pos: { x: number; y: number; roomName: string };
  readonly structureType: BuildableStructureConstant;
  readonly priority: number;
  readonly traffic: number;
}

/** 道路策略选项。 */
export interface RoadPolicyOptions {
  /** 采样窗口内位置被判定为高频的最小通行次数。 */
  minTraffic: number;
  /** 每房最多返回的道路候选数。 */
  maxCandidates: number;
  /** 候选位置到高价值端点的最大距离（曼哈顿）。 */
  maxDistanceToEndpoints: number;
}

export const DEFAULT_ROAD_OPTIONS: RoadPolicyOptions = {
  minTraffic: 10,
  maxCandidates: 5,
  maxDistanceToEndpoints: 10,
};

/**
 * 从交通热度数据中评估道路候选（plan §5.6.6）。
 *
 * 规则：
 *   - 只有连续两个采样窗口都超过阈值的位置才入选
 *   - 不在核心保留格、出口、墙、已有 road 或 site 上
 *   - 至少靠近两个高价值端点（source/spawn/storage/controller）
 *
 * @param currentTraffic 当前采样窗口的交通数据（posKey "x,y" -> count）
 * @param prevTraffic 上一个采样窗口的交通数据
 */
export function evaluateRoadCandidates(
  roomName: string,
  snapshot: RoomSnapshot,
  currentTraffic: Record<string, number> | undefined,
  prevTraffic: Record<string, number> | undefined,
  options: RoadPolicyOptions = DEFAULT_ROAD_OPTIONS,
): RoadCandidate[] {
  if (!currentTraffic || !prevTraffic) return [];

  // 收集高价值端点位置。
  const endpoints: { x: number; y: number }[] = [];
  for (const s of snapshot.spawns) endpoints.push({ x: s.pos.x, y: s.pos.y });
  for (const s of snapshot.sources) endpoints.push({ x: s.pos.x, y: s.pos.y });
  if (snapshot.storage) endpoints.push({ x: snapshot.storage.pos.x, y: snapshot.storage.pos.y });
  if (snapshot.controller) endpoints.push({ x: snapshot.controller.pos.x, y: snapshot.controller.pos.y });

  // 构建已占用位置集合（已有结构 + site + source/controller + road）。
  const occupiedSet = new Set<string>();
  for (const s of [
    ...snapshot.spawns,
    ...snapshot.extensions,
    ...snapshot.towers,
    ...snapshot.containers,
    ...snapshot.roads,
    ...snapshot.constructionSites,
  ]) {
    occupiedSet.add(`${s.pos.x},${s.pos.y}`);
  }
  if (snapshot.storage) {
    occupiedSet.add(`${snapshot.storage.pos.x},${snapshot.storage.pos.y}`);
  }
  for (const s of snapshot.sources) {
    occupiedSet.add(`${s.pos.x},${s.pos.y}`);
  }
  if (snapshot.controller) {
    occupiedSet.add(`${snapshot.controller.pos.x},${snapshot.controller.pos.y}`);
  }

  const candidates: RoadCandidate[] = [];

  for (const [posKey, traffic] of Object.entries(currentTraffic)) {
    // 两个窗口都需超过阈值。
    if (traffic < options.minTraffic) continue;
    const prevCount = prevTraffic[posKey] ?? 0;
    if (prevCount < options.minTraffic) continue;

    const commaIdx = posKey.indexOf(",");
    const x = parseInt(posKey.slice(0, commaIdx), 10);
    const y = parseInt(posKey.slice(commaIdx + 1), 10);

    // 边界检查。
    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
    // 已占用位置不建 road。
    if (occupiedSet.has(posKey)) continue;

    // 至少靠近两个高价值端点。
    let nearbyEndpoints = 0;
    for (const ep of endpoints) {
      const dist = Math.abs(ep.x - x) + Math.abs(ep.y - y);
      if (dist <= options.maxDistanceToEndpoints) nearbyEndpoints++;
      if (nearbyEndpoints >= 2) break;
    }
    if (nearbyEndpoints < 2) continue;

    candidates.push({
      key: `road.${roomName}.${x}.${y}`,
      pos: { x, y, roomName },
      structureType: STRUCTURE_ROAD,
      priority: 3,
      traffic,
    });
  }

  // 按交通量降序排序，取前 N 个。
  candidates.sort((a, b) => b.traffic - a.traffic);
  return candidates.slice(0, options.maxCandidates);
}
