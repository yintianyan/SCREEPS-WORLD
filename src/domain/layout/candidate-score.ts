import type { Blueprint } from "./types";

/** 候选锚点的评分输入 — 从 Room 和 Blueprint 提取的纯数据。 */
export interface CandidateInput {
  x: number;
  y: number;
  /** 锚点周围 3 格半径内可建造的核心格数。 */
  buildableCoreTiles: number;
  /** 到各 source 的平均距离（曼哈顿）。 */
  averageDistanceToSources: number;
  /** 到 controller 的距离。 */
  distanceToController: number;
  /** 到最近房间出口的估算距离。 */
  exitRisk: number;
  /** 模板在此锚点下被墙/边界阻挡的 cell 数。 */
  blockedTemplateCells: number;
}

/**
 * 新房锚点评分 — 纯函数。
 *
 * 评分公式（plan §5.6.3）：
 *   score = 4 * buildableCoreTiles
 *         - 2 * averageDistanceToSources
 *         - 1 * distanceToController
 *         + 3 * exitRisk   // exitRisk = 到最近出口的距离，越大越安全
 *         - 4 * blockedTemplateCells
 *
 * 分数越高越好。候选需满足核心矩形不越界、关键格不是墙、
 * 距出口保留安全距离、不占 source/controller/mineral。
 */
export function scoreCandidate(input: CandidateInput): number {
  return (
    4 * input.buildableCoreTiles
    - 2 * input.averageDistanceToSources
    - 1 * input.distanceToController
    + 3 * input.exitRisk
    - 4 * input.blockedTemplateCells
  );
}

/**
 * 从 Room 和 Blueprint 提取候选评分所需的数据。
 * 调用方提供候选坐标和房间信息，此函数完成扫描。
 * 大扫描只能在 Green 下增量完成（plan §5.6.3）。
 */
export function evaluateCandidate(
  room: Room,
  blueprint: Blueprint,
  cx: number,
  cy: number,
): CandidateInput | undefined {
  const terrain = room.getTerrain();
  const sources = room.find(FIND_SOURCES);
  const controller = room.controller;

  // 统计可建造核心格（3 格半径内非墙非边界）。
  let buildableCoreTiles = 0;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) buildableCoreTiles++;
    }
  }

  // 到各 source 的平均距离。
  let avgDist = 0;
  if (sources.length > 0) {
    let total = 0;
    for (const s of sources) {
      total += Math.abs(s.pos.x - cx) + Math.abs(s.pos.y - cy);
    }
    avgDist = total / sources.length;
  }

  // 到 controller 的距离。
  const distCtrl = controller
    ? Math.abs(controller.pos.x - cx) + Math.abs(controller.pos.y - cy)
    : 50;

  // 到最近出口的估算距离（取四方向最小值）。
  const exitRisk = Math.min(cx, cy, 49 - cx, 49 - cy);

  // 统计被墙/边界阻挡的模板 cell 数。
  let blocked = 0;
  for (const cell of blueprint.cells) {
    const x = cx + cell.dx;
    const y = cy + cell.dy;
    if (x < 1 || x > 48 || y < 1 || y > 48) {
      blocked++;
      continue;
    }
    if (terrain.get(x, y) === TERRAIN_MASK_WALL) blocked++;
  }

  return {
    x: cx,
    y: cy,
    buildableCoreTiles,
    averageDistanceToSources: avgDist,
    distanceToController: distCtrl,
    exitRisk,
    blockedTemplateCells: blocked,
  };
}

/**
 * 从候选列表中选择最佳锚点。
 * 返回分数最高的候选；列表为空时返回 undefined。
 */
export function selectBestCandidate(
  candidates: readonly CandidateInput[],
): CandidateInput | undefined {
  if (candidates.length === 0) return undefined;
  let best = candidates[0]!;
  let bestScore = scoreCandidate(best);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    const s = scoreCandidate(c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}
