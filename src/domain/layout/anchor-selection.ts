/** 约束推导锚点选择 — 从地形约束推导最优核心位置（plan §5.6）。 */

import type { DistanceField } from "./terrain-analysis";
import { opennessAt, countBlockedCells } from "./terrain-analysis";

/** 锚点评分权重（可调，未来移入 CONFIG）。 */
export interface AnchorWeights {
  readonly openness: number;
  readonly sourceDist: number;
  readonly controllerDist: number;
  readonly exitDistance: number;
  readonly blockedCells: number;
  readonly mineralDist: number;
}

/** 默认权重 — 地形平坦度最重要，blockedCells 强惩罚。 */
export const DEFAULT_WEIGHTS: AnchorWeights = {
  openness: 5,
  sourceDist: -2,
  controllerDist: -1.5,
  exitDistance: 2,
  blockedCells: -3,
  mineralDist: -0.5,
};


export interface AnchorConstraint {
  /** 核心区域开放度（Distance Transform 值）。 */
  readonly openness: number;
  /** 到所有 source 的平均曼哈顿距离。 */
  readonly avgSourceDist: number;
  /** 到 controller 的曼哈顿距离。 */
  readonly controllerDist: number;
  /** 到最近出口的距离（越大越安全）。 */
  readonly exitDistance: number;
  /** 核心 7×7 区域内被墙/边界阻挡的格数。 */
  readonly blockedCells: number;

  readonly mineralDist: number;
}


export interface AnchorCandidate extends AnchorConstraint {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}


export interface AnchorSelectionInput {
  readonly field: DistanceField;
  readonly sources: readonly { x: number; y: number }[];
  readonly controller: { x: number; y: number } | undefined;
  readonly exits: readonly { x: number; y: number }[];
  readonly mineral: { x: number; y: number } | undefined;
  readonly getTerrain: (x: number, y: number) => boolean;
  readonly weights?: AnchorWeights;
  /** 搜索范围（默认 [5,44]，留出核心半径 + 防御纵深）。 */
  readonly bounds?: { minX: number; maxX: number; minY: number; maxY: number };
  /** 最低开放度门槛（默认 4）。 */
  readonly minOpenness?: number;
  /** 返回的最大候选数（默认 5）。 */
  readonly maxCandidates?: number;
}

/** 加权线性组合评分，分数越高越好。 */
export function scoreAnchor(c: AnchorConstraint, w: AnchorWeights = DEFAULT_WEIGHTS): number {
  return (
    w.openness * c.openness
    + w.sourceDist * c.avgSourceDist
    + w.controllerDist * c.controllerDist
    + w.exitDistance * c.exitDistance
    + w.blockedCells * c.blockedCells
    + w.mineralDist * c.mineralDist
  );
}

/** 评估单个位置锚点质量（不搜索，只评分），用于诊断已有 spawn。 */
export function evaluateAnchorAt(
  x: number,
  y: number,
  input: Pick<AnchorSelectionInput, "field" | "sources" | "controller" | "exits" | "mineral" | "getTerrain">,
  weights: AnchorWeights = DEFAULT_WEIGHTS,
): AnchorCandidate {
  const { field, sources, controller, exits, mineral, getTerrain } = input;

  const openness = opennessAt(field, x, y);

  let avgSourceDist = 0;
  if (sources.length > 0) {
    let total = 0;
    for (const s of sources) total += Math.abs(s.x - x) + Math.abs(s.y - y);
    avgSourceDist = total / sources.length;
  } else {
    avgSourceDist = 25; // 无 source 时给中性值
  }

  const controllerDist = controller
    ? Math.abs(controller.x - x) + Math.abs(controller.y - y)
    : 25;

  let exitDistance = 50;
  for (const e of exits) {
    const d = Math.abs(e.x - x) + Math.abs(e.y - y);
    if (d < exitDistance) exitDistance = d;
  }

  const mineralDist = mineral
    ? Math.abs(mineral.x - x) + Math.abs(mineral.y - y)
    : 25;

  const blockedCells = countBlockedCells(x, y, 3, getTerrain);

  const constraint: AnchorConstraint = {
    openness, avgSourceDist, controllerDist, exitDistance, blockedCells, mineralDist,
  };

  return { x, y, ...constraint, score: scoreAnchor(constraint, weights) };
}

/**
 * 搜索并排序候选锚点。CPU 约 O(40×40)×O(7×7) ≈ 8000 次比较，
 * 只在首次规划时执行一次，后续从 Memory 读取。
 */
export function selectAnchors(input: AnchorSelectionInput): AnchorCandidate[] {
  const {
    field, sources, controller, exits, mineral, getTerrain,
    weights = DEFAULT_WEIGHTS,
    bounds = { minX: 5, maxX: 44, minY: 5, maxY: 44 },
    minOpenness = 4,
    maxCandidates = 5,
  } = input;


  const occupied = new Set<number>();
  for (const s of sources) occupied.add(s.x * 50 + s.y);
  if (controller) occupied.add(controller.x * 50 + controller.y);
  if (mineral) occupied.add(mineral.x * 50 + mineral.y);

  const candidates: AnchorCandidate[] = [];

  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      if (occupied.has(x * 50 + y)) continue;
      const openness = opennessAt(field, x, y);
      if (openness < minOpenness) continue;

      const candidate = evaluateAnchorAt(x, y, { field, sources, controller, exits, mineral, getTerrain }, weights);
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxCandidates);
}

/** 诊断：已有锚点在候选列表中的排名（rank 从 1 起，比所有候选都差时为 total+1）。 */
export function diagnoseAnchor(
  currentX: number,
  currentY: number,
  input: AnchorSelectionInput,
): { rank: number; total: number; candidate: AnchorCandidate } {
  const current = evaluateAnchorAt(currentX, currentY, input, input.weights);
  const all = selectAnchors(input);


  let rank = -1;
  for (let i = 0; i < all.length; i++) {
    if (all[i]!.score <= current.score) {
      rank = i + 1;
      break;
    }
  }
  if (rank === -1) rank = all.length + 1; // 比所有候选都差

  return { rank, total: all.length, candidate: current };
}
