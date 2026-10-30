/** 选点前置校验用的地形摘要（R651）——墙/沼泽占比 + 最佳锚点几何。
 *
 * 为什么单独成一模块：`buildCandidate` 是纯函数，只能读 intel；而这些量需要
 * 距离场与 `selectAnchors`（此前只在 claim 之后由 `seedLayoutAnchor` 跑）。把计算
 * 收在侦察那一趟（有视野时），intel 落盘后选点就能在 **claim 之前** 用真实地形否决。
 */

import { computeDistanceField } from "./terrain-analysis";
import { selectAnchors } from "./anchor-selection";
import { COMPACT_CORE_V3 } from "./templates/compact-core-v3";

/** 进 intel 的地形摘要（0..1 比例 + 锚点几何）。 */
export interface TerrainIntelSummary {
  /** 自然墙占比（地形 TERRAIN_MASK_WALL，0..1）。 */
  wallRatio: number;
  /** 沼泽占比（0..1）——通勤/道路维护成本的一阶代理。 */
  swampRatio: number;
  /** `selectAnchors` 最佳锚点评分（越高越好，可为负）。 */
  bestAnchorScore?: number;
  /** 最佳锚点到 controller 的曼哈顿距离。 */
  anchorToController?: number;
  /** 最佳锚点到最近 source 的曼哈顿距离。 */
  anchorToSources?: number;
  /** 回 claim 房：最佳锚点到**遗留 spawn** 的曼哈顿距离（无 spawn 则 undefined）。 */
  leftoverSpawnToAnchor?: number;
  /** R662：最佳锚点上 v3 模板格的地形可放率（0..1）——"看起来能放"变成可计算的门。 */
  anchorPlaceableRatio?: number;
}

export interface TerrainIntelInput {
  /** 返回 terrain 位掩码（TERRAIN_MASK_WALL=1 / TERRAIN_MASK_SWAMP=2）。 */
  getTerrainValue: (x: number, y: number) => number;
  sources: readonly { x: number; y: number }[];
  controller?: { x: number; y: number };
  exits: readonly { x: number; y: number }[];
  mineral?: { x: number; y: number };
  /** 房内**任何** spawn 的位置（含无主遗迹）——回 claim 房的布局锚点校验用。 */
  spawns?: readonly { x: number; y: number }[];
}

const ROOM_CELLS = 50 * 50;
const TERRAIN_WALL = 1;
const TERRAIN_SWAMP = 2;

const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * 汇总地形选点指标（纯函数）。
 *
 * 墙/沼泽按 2,500 格统计；锚点用与 `seedLayoutAnchor` **同一套** `selectAnchors`
 * （同权重、同搜索域），保证"选点前评估"与"claim 后落位"不会变成两把尺。
 * 开放度门槛按 4 取不到时回退 2（与 state-machine 的回退一致）。
 */
export function summarizeTerrain(input: TerrainIntelInput): TerrainIntelSummary {
  const { getTerrainValue } = input;
  let walls = 0;
  let swamps = 0;
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const t = getTerrainValue(x, y);
      if ((t & TERRAIN_WALL) !== 0) walls++;
      else if ((t & TERRAIN_SWAMP) !== 0) swamps++;
    }
  }

  const getTerrain = (x: number, y: number): boolean =>
    (getTerrainValue(x, y) & TERRAIN_WALL) !== 0;
  const field = computeDistanceField(getTerrain);
  const base = {
    field,
    sources: input.sources,
    controller: input.controller,
    exits: input.exits,
    mineral: input.mineral,
    getTerrain,
  };
  let candidates = selectAnchors({ ...base, maxCandidates: 1 });
  if (candidates.length === 0) {
    candidates = selectAnchors({ ...base, maxCandidates: 1, minOpenness: 2 });
  }
  const best = candidates[0];
  const summary: TerrainIntelSummary = {
    wallRatio: walls / ROOM_CELLS,
    swampRatio: swamps / ROOM_CELLS,
  };
  if (!best) return summary;
  summary.bestAnchorScore = best.score;
  if (input.controller) summary.anchorToController = manhattan(best, input.controller);
  if (input.sources.length > 0) {
    summary.anchorToSources = Math.min(...input.sources.map(s => manhattan(best, s)));
  }
  if (input.spawns && input.spawns.length > 0) {
    summary.leftoverSpawnToAnchor = Math.min(...input.spawns.map(s => manhattan(best, s)));
  }
  // R662：模板格在锚点周围的地形可放率（1..48 且非墙）。
  let fit = 0;
  for (const c of COMPACT_CORE_V3.cells) {
    const x = best.x + c.dx;
    const y = best.y + c.dy;
    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
    if ((getTerrainValue(x, y) & TERRAIN_WALL) === 0) fit++;
  }
  summary.anchorPlaceableRatio = fit / COMPACT_CORE_V3.cells.length;
  return summary;
}
