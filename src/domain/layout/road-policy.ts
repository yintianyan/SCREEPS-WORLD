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
  /**
   * 采样窗口内位置被判定为高频的最小通行次数。
   *
   * RCL 分档启用后（`evaluateRoadCandidates` 传 rcl），此字段仅作为
   * 测试/调参的显式覆盖；运行时由 `minTrafficForRcl(rcl)` 派生。
   */
  minTraffic: number;
  /** 每房最多返回的道路候选数。 */
  maxCandidates: number;
  /** 候选位置到高价值端点的最大距离（曼哈顿）。 */
  maxDistanceToEndpoints: number;
}

export const DEFAULT_ROAD_OPTIONS: RoadPolicyOptions = {
  // 修复：旧值 10 对 RCL2-3 太严（2 个 hauler 时每格每窗口仅 ~3-6 次通行），
  // 导致最该修路的早期修不出路，hauler 白跑上万 tick plain。降到 5 让早期道路成型。
  // 双窗口要求保留（防瞬时尖峰误判），仅降低阈值。
  minTraffic: 5,
  maxCandidates: 5,
  maxDistanceToEndpoints: 10,
};

/**
 * RCL 分档的最小通行阈值表（docs/layout-system-design-2026-08.md §3.6 P3）。
 *
 * 设计取舍（与文档原方案 30/50 的差异）：
 *   - RCL2-6 保持 5（已验证的早期/中期优化值）。
 *     文档原写 RCL4-6=30，但代码现状 minTraffic=5 是修复「旧值 10 对 RCL2-3
 *     太严」病灶后的优化值，直接套 30 会让 RCL4 道路突然修不出 — hauler
 *     通勤最吃紧的中期反而无路。枢纽路+走廊路已覆盖关键物流节点，
 *     热度路只需补低频路段，5 足以过滤瞬时尖峰。
 *   - RCL7-8 提高到 50（文档值）。后期 10+ hauler 流量大，低阈值会铺出
 *     大量低频路（重建耗能 + 维护 builder 工时），50 让热度路只铺真高频段。
 *
 * 纯函数 — 不访问 Game/Memory，便于单测全 RCL 分档。
 *
 * @param rcl 房间 RCL
 * @returns 该 RCL 的最小通行阈值
 */
export function minTrafficForRcl(rcl: number): number {
  return rcl >= 7 ? 50 : 5;
}

/**
 * 从交通热度数据中评估道路候选（plan §5.6.6）。
 *
 * 规则：
 *   - 只有连续两个采样窗口都超过阈值的位置才入选
 *   - 不在核心保留格、出口、墙、已有 road 或 site 上
 *   - 至少靠近两个高价值端点（source/spawn/storage/controller）
 *
 * RCL 分档阈值（P3，docs/layout-system-design-2026-08.md §3.6）：
 *   - 传入 rcl 时，minTraffic 由 `minTrafficForRcl(rcl)` 派生，
 *     options.minTraffic 被覆盖（仅测试/调参显式覆盖时才生效）。
 *   - 不传 rcl（向后兼容）时，沿用 options.minTraffic。
 *
 * @param currentTraffic 当前采样窗口的交通数据（posKey "x,y" -> count）
 * @param prevTraffic 上一个采样窗口的交通数据
 * @param rcl 房间 RCL（用于分档阈值；不传则用 options.minTraffic）
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

  // RCL 分档阈值优先；rcl 未传时（向后兼容/单测）回落到 options.minTraffic。
  const minTraffic = rcl !== undefined ? minTrafficForRcl(rcl) : options.minTraffic;

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
    // 两个窗口都需超过阈值（RCL 分档后的有效阈值）。
    if (traffic < minTraffic) continue;
    const prevCount = prevTraffic[posKey] ?? 0;
    if (prevCount < minTraffic) continue;

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
