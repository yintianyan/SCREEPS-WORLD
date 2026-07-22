/**
 * 约束推导锚点选择 — 从地形约束推导最优核心位置。
 *
 * 设计哲学（plan §5.6）：
 *   布局从约束推导，而非套用固定模板。锚点是布局的根基——
 *   选错锚点 = 核心区域被墙切割 = 大量 relocation = 物流效率崩塌。
 *
 * 当前状态（Phase 3）：
 *   本模块只做"诊断评分"——评估已有锚点（spawn 位置）的质量，
 *   不改变运行时行为。Phase 4 才启用约束推导放置。
 *
 * 评分维度：
 *   - openness：核心区域平坦度（Distance Transform 值）
 *   - avgSourceDist：到所有 source 的平均曼哈顿距离（hauler 通勤）
 *   - controllerDist：到 controller 的距离（升级通勤，link 前重要）
 *   - exitDistance：到最近出口的距离（防御纵深）
 *   - blockedCells：核心 7×7 区域内被墙/边界阻挡的格数
 *   - mineralDist：到 mineral 的距离（RCL6+ 相关）
 *
 * 纯函数 — 不访问 Game/Memory，所有输入通过参数注入。
 */

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

/** 锚点约束数据（从房间状态提取）。 */
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
  /** 到 mineral 的距离。 */
  readonly mineralDist: number;
}

/** 锚点候选（含坐标和评分）。 */
export interface AnchorCandidate extends AnchorConstraint {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

/** selectAnchors 的输入。 */
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

/**
 * 评分公式：加权线性组合。
 * score = w.openness * openness + w.sourceDist * avgSourceDist + ...
 * 分数越高越好。
 */
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

/**
 * 评估单个位置的锚点质量（不搜索，只评分）。
 * 用于诊断已有 spawn 位置。
 */
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
 * 从 DistanceField 中搜索并排序候选锚点。
 *
 * 筛选条件：
 *   1. openness >= minOpenness（默认 4，约 4 格半径无墙）
 *   2. 边界内 [bounds]（默认 [5,44]）
 *   3. 不占 source/controller/mineral
 *
 * CPU 成本：O(40×40) 候选 × O(7×7) blockedCells = ~8000 次比较。
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

  // 不可占用位置
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

/**
 * 诊断：评估已有锚点在候选列表中的排名。
 * 返回 { rank, total, candidate } — rank 从 1 开始。
 * 如果已有锚点不满足 minOpenness，rank = -1（不合格）。
 */
export function diagnoseAnchor(
  currentX: number,
  currentY: number,
  input: AnchorSelectionInput,
): { rank: number; total: number; candidate: AnchorCandidate } {
  const current = evaluateAnchorAt(currentX, currentY, input, input.weights);
  const all = selectAnchors(input);

  // 找当前锚点在排序列表中的位置
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
