import type { RoomSnapshot } from "../../kernel/contracts";


export interface RoadCandidate {
  readonly key: string;
  readonly pos: { x: number; y: number; roomName: string };
  readonly structureType: BuildableStructureConstant;
  readonly priority: number;
  readonly traffic: number;
}

/** 道路策略选项。 */
export interface RoadPolicyOptions {
  /** 采样窗口内判定为高频的最小通行次数；传 rcl 时仅作测试/调参显式覆盖，运行时由 minTrafficForRcl 派生。 */
  minTraffic: number;
  /** 每房最多返回的道路候选数。 */
  maxCandidates: number;
  /** 候选位置到高价值端点的最大距离（曼哈顿）。 */
  maxDistanceToEndpoints: number;
}

export const DEFAULT_ROAD_OPTIONS: RoadPolicyOptions = {
  // 修复：旧值 10 对 RCL2-3 太严（2 个 hauler 时每格每窗口仅 ~3-6 次通行），
  // 早期最该修路时修不出路；降到 5，双窗口要求保留（防瞬时尖峰误判）。
  minTraffic: 5,
  maxCandidates: 5,
  maxDistanceToEndpoints: 10,
};

/**
 * RCL 分档最小通行阈值表。
 * 与文档原方案 30/50 的差异（已登记取舍）：RCL2-6 保持 5 —— 原 30 会让
 * RCL4 中期反而修不出路（枢纽路+走廊路已覆盖关键节点，热度路只补低频段）；
 * RCL7-8 用 50 —— 后期 10+ hauler 流量大，低阈值会铺出大量低频路
 * （重建耗能 + 占用 builder 工时）。纯函数。
 */
export function minTrafficForRcl(rcl: number): number {
  return rcl >= 7 ? 50 : 5;
}

/**
 * 从交通热度评估道路候选（plan §5.6.6）：连续两个采样窗口均超阈值才入选，
 * 且不在保留格/出口/墙/已有 road/site 上、至少靠近两个高价值端点
 * （source/spawn/storage/controller）。
 * RCL 分档（P3）：传 rcl 时 minTraffic 由 minTrafficForRcl 派生并覆盖
 * options.minTraffic（仅测试/调参显式覆盖生效）；不传（向后兼容）沿用 options。
 * @param currentTraffic 当前窗口交通数据（posKey "x,y" → count）；prevTraffic 上一窗口
 */
export function evaluateRoadCandidates(
  roomName: string,
  snapshot: RoomSnapshot,
  currentTraffic: Record<string, number> | undefined,
  prevTraffic: Record<string, number> | undefined,
  options: RoadPolicyOptions = DEFAULT_ROAD_OPTIONS,
  rcl?: number,
): RoadCandidate[] {
  if (!currentTraffic || !prevTraffic) return [];

  const minTraffic = rcl !== undefined ? minTrafficForRcl(rcl) : options.minTraffic;

  const endpoints: { x: number; y: number }[] = [];
  for (const s of snapshot.spawns) endpoints.push({ x: s.pos.x, y: s.pos.y });
  for (const s of snapshot.sources) endpoints.push({ x: s.pos.x, y: s.pos.y });
  if (snapshot.storage) endpoints.push({ x: snapshot.storage.pos.x, y: snapshot.storage.pos.y });
  if (snapshot.controller) endpoints.push({ x: snapshot.controller.pos.x, y: snapshot.controller.pos.y });

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
    // 两个窗口都需超过阈值（RCL 分档后的有效阈值）。
    if (traffic < minTraffic) continue;
    const prevCount = prevTraffic[posKey] ?? 0;
    if (prevCount < minTraffic) continue;

    const commaIdx = posKey.indexOf(",");
    const x = parseInt(posKey.slice(0, commaIdx), 10);
    const y = parseInt(posKey.slice(commaIdx + 1), 10);

    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
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

  candidates.sort((a, b) => b.traffic - a.traffic);
  return candidates.slice(0, options.maxCandidates);
}
