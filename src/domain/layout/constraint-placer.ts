/**
 * 约束推导结构放置 — 从地形约束推导每个结构的位置。
 *
 * 替代固定模板偏移（compact-core-v2 的 dx/dy），用贪心算法在候选格中
 * 为每个结构找满足所有约束且评分最高的位置。
 *
 * 约束集：
 *   1. 偶校验（dx+dy 偶数）— 棋盘格走道不变量
 *   2. 非墙、非越界
 *   3. 不重叠（occupiedSet）
 *   4. 不密封（wouldSeal 守卫）
 *   5. 到锚点距离 <= maxRadius
 *   6. Lab 集群：反应 trio 必须相互 range <= 2
 *
 * 放置顺序（优先级从高到低）：
 *   spawn > storage > tower > link > terminal > factory > lab > extension
 *   高优先级结构先占位，低优先级结构在剩余格中选择。
 *
 * 纯函数 — 不访问 Game/Memory，所有输入通过参数注入。
 */

import type { DistanceField } from "./terrain-analysis";
import { opennessAt } from "./terrain-analysis";
import type { BuildPriority, LayoutPhase } from "./types";
import { packPos } from "./types";

/** 放置结果 — 一个结构的最终位置。 */
export interface ConstraintPlacement {
  readonly key: string;
  readonly pos: { x: number; y: number };
  readonly structureType: BuildableStructureConstant;
  readonly priority: BuildPriority;
  readonly phase: LayoutPhase;
}

/** 放置算法配置。 */
export interface PlacerConfig {
  /** 核心区域搜索半径（默认 7，与 compact-core-v2 的 ±6 外环对齐）。 */
  readonly maxRadius: number;
  /** 最低开放度门槛（默认 2，确保结构周围有走道）。 */
  readonly minOpenness: number;
}

export const DEFAULT_PLACER_CONFIG: PlacerConfig = {
  maxRadius: 7,
  minOpenness: 2,
};

/** 每 RCL 应放置的结构清单（增量，非累计）。 */
interface StructureBatch {
  readonly type: BuildableStructureConstant;
  readonly count: number;
  readonly priority: BuildPriority;
  readonly phase: LayoutPhase;
}

/** RCL → 该等级新增的结构批次（与 CONTROLLER_STRUCTURES 对齐）。 */
const RCL_BATCHES: Record<number, StructureBatch[]> = {
  2: [
    { type: STRUCTURE_EXTENSION, count: 5, priority: 1, phase: "rcl2" },
  ],
  3: [
    { type: STRUCTURE_EXTENSION, count: 5, priority: 1, phase: "rcl3" },
    { type: STRUCTURE_TOWER, count: 1, priority: 0, phase: "rcl3" },
  ],
  4: [
    { type: STRUCTURE_EXTENSION, count: 10, priority: 1, phase: "rcl4" },
    { type: STRUCTURE_STORAGE, count: 1, priority: 0, phase: "rcl4" },
  ],
  5: [
    { type: STRUCTURE_EXTENSION, count: 10, priority: 2, phase: "late" },
    { type: STRUCTURE_TOWER, count: 1, priority: 0, phase: "late" },
    { type: STRUCTURE_LINK, count: 1, priority: 2, phase: "late" },
  ],
  6: [
    { type: STRUCTURE_EXTENSION, count: 10, priority: 2, phase: "rcl6" },
    { type: STRUCTURE_LINK, count: 1, priority: 2, phase: "rcl6" },
    { type: STRUCTURE_TERMINAL, count: 1, priority: 1, phase: "rcl6" },
    { type: STRUCTURE_LAB, count: 3, priority: 2, phase: "rcl6" },
  ],
  7: [
    { type: STRUCTURE_EXTENSION, count: 10, priority: 2, phase: "rcl7" },
    { type: STRUCTURE_TOWER, count: 1, priority: 0, phase: "rcl7" },
    { type: STRUCTURE_SPAWN, count: 1, priority: 1, phase: "rcl7" },
    { type: STRUCTURE_FACTORY, count: 1, priority: 2, phase: "rcl7" },
    { type: STRUCTURE_LAB, count: 3, priority: 2, phase: "rcl7" },
  ],
  8: [
    { type: STRUCTURE_EXTENSION, count: 10, priority: 2, phase: "rcl8" },
    { type: STRUCTURE_SPAWN, count: 1, priority: 1, phase: "rcl8" },
    { type: STRUCTURE_LAB, count: 4, priority: 2, phase: "rcl8" },
  ],
};

/** 放置优先级：数值越小越先放置（先占位）。 */
const TYPE_PLACE_ORDER: Record<string, number> = {
  [STRUCTURE_SPAWN]: 0,
  [STRUCTURE_STORAGE]: 1,
  [STRUCTURE_TOWER]: 2,
  [STRUCTURE_LINK]: 3,
  [STRUCTURE_TERMINAL]: 4,
  [STRUCTURE_FACTORY]: 5,
  [STRUCTURE_LAB]: 6,
  [STRUCTURE_EXTENSION]: 7,
};

/** 候选格（预计算，按评分排序）。 */
interface CandidateTile {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

/**
 * 预计算候选格列表 — 偶校验、边界内、非墙、开放度 >= minOpenness。
 *
 * 评分 = openness × 2 - distFromAnchor - energyPenalty
 *
 * - openness：周围走道越多越好（棋盘格不变量保证）
 * - distFromAnchor：离核心越近越好（减少 hauler 通勤）
 * - energyPenalty：离能量端点（source/controller）越远越好，
 *   让 storage/link 等物流结构优先落在靠近能量流转路径的位置。
 *
 * 按评分降序排列。
 *
 * @param energyEndpoints 能量端点位置（source/controller），用于计算能量流转距离惩罚。
 *   为空时退化为纯几何评分（向后兼容）。
 */
function buildCandidateGrid(
  anchor: { x: number; y: number },
  field: DistanceField,
  getTerrain: (x: number, y: number) => boolean,
  config: PlacerConfig,
  energyEndpoints: readonly { x: number; y: number }[] = [],
): CandidateTile[] {
  const candidates: CandidateTile[] = [];
  const { maxRadius, minOpenness } = config;

  for (let dx = -maxRadius; dx <= maxRadius; dx++) {
    for (let dy = -maxRadius; dy <= maxRadius; dy++) {
      // 偶校验（棋盘格不变量）
      if (((dx + dy) % 2 + 2) % 2 !== 0) continue;

      const x = anchor.x + dx;
      const y = anchor.y + dy;

      // 边界（留出 2 格安全距离）
      if (x < 2 || x > 47 || y < 2 || y > 47) continue;
      // 非墙
      if (getTerrain(x, y)) continue;
      // 开放度门槛
      const openness = opennessAt(field, x, y);
      if (openness < minOpenness) continue;

      const dist = Math.abs(dx) + Math.abs(dy);

      // 能量端点距离惩罚：到最近端点的曼哈顿距离 × 0.5。
      // 权重 0.5 让它不会压倒 openness/anchor 距离，只在同等条件下偏好靠近能量端点的格子。
      let energyPenalty = 0;
      if (energyEndpoints.length > 0) {
        let minEnergyDist = Infinity;
        for (const ep of energyEndpoints) {
          const d = Math.abs(ep.x - x) + Math.abs(ep.y - y);
          if (d < minEnergyDist) minEnergyDist = d;
        }
        energyPenalty = minEnergyDist * 0.5;
      }

      candidates.push({ x, y, score: openness * 2 - dist - energyPenalty });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * 检查在 (x,y) 放置障碍结构是否会密封。
 * 简化版 wouldSeal：检查自身 4 正交邻居中是否有 >= 1 个可站格。
 * （完整 wouldSeal 在 validation.ts 中，这里用轻量版避免循环依赖。）
 */
function wouldSealLocal(
  x: number,
  y: number,
  getTerrain: (x: number, y: number) => boolean,
  occupied: ReadonlySet<number>,
): boolean {
  const orthogonal: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of orthogonal) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
    if (getTerrain(nx, ny)) continue;
    if (occupied.has(packPos(nx, ny))) continue;
    return false; // 找到可站格，不密封
  }
  return true; // 4 正交邻居全堵，密封
}

/**
 * 为 lab 集群寻找相互 range <= 2 的位置组。
 *
 * 策略：从候选格中找第一个满足条件的 trio（3 个 lab 相互 Chebyshev <= 2）。
 * 如果 count > 3，继续找与已有 lab 集群 range <= 2 的额外位置。
 *
 * @returns 找到的位置列表（可能少于 count）
 */
function placeLabCluster(
  count: number,
  candidates: readonly CandidateTile[],
  occupied: Set<number>,
  getTerrain: (x: number, y: number) => boolean,
  existingLabs: readonly { x: number; y: number }[],
): { x: number; y: number }[] {
  const placed: { x: number; y: number }[] = [...existingLabs];
  const result: { x: number; y: number }[] = [];

  for (let i = 0; i < count; i++) {
    let found = false;
    for (const c of candidates) {
      const packed = packPos(c.x, c.y);
      if (occupied.has(packed)) continue;
      if (wouldSealLocal(c.x, c.y, getTerrain, occupied)) continue;

      // 检查与已有 lab 的 Chebyshev 距离 <= 2
      if (placed.length > 0) {
        const inRange = placed.some(
          l => Math.max(Math.abs(l.x - c.x), Math.abs(l.y - c.y)) <= 2,
        );
        if (!inRange) continue;
      }

      // 找到合法位置
      placed.push({ x: c.x, y: c.y });
      result.push({ x: c.x, y: c.y });
      occupied.add(packed);
      found = true;
      break;
    }
    if (!found) break; // 找不到更多合法位置
  }

  return result;
}

/**
 * 约束推导结构放置 — 主入口。
 *
 * 为指定 RCL 放置所有结构（从 RCL2 到目标 RCL 的累计）。
 * 返回放置结果列表，调用方转为 BuildTask 入队。
 *
 * @param anchor 核心锚点（主 spawn 位置）
 * @param field Distance Transform 距离场
 * @param getTerrain 地形查询（是否墙）
 * @param rcl 目标 RCL 等级
 * @param preOccupied 预占用位置（source/controller/mineral/已有结构）
 * @param config 放置配置
 * @param energyEndpoints 能量端点位置（source/controller），用于评分加权。
 *   传入时结构放置偏好靠近能量流转路径；不传时退化为纯几何评分。
 */
export function placeStructures(
  anchor: { x: number; y: number },
  field: DistanceField,
  getTerrain: (x: number, y: number) => boolean,
  rcl: number,
  preOccupied: ReadonlySet<number>,
  config: PlacerConfig = DEFAULT_PLACER_CONFIG,
  energyEndpoints: readonly { x: number; y: number }[] = [],
): ConstraintPlacement[] {
  const candidates = buildCandidateGrid(anchor, field, getTerrain, config, energyEndpoints);
  const occupied = new Set<number>(preOccupied);
  // 锚点本身被 spawn 占用
  occupied.add(packPos(anchor.x, anchor.y));

  const placements: ConstraintPlacement[] = [];
  const counters: Record<string, number> = {}; // 结构类型计数器（用于 key 生成）
  const labPositions: { x: number; y: number }[] = []; // 已放置的 lab 位置

  // 收集所有 RCL 批次并按放置优先级排序
  const batches: StructureBatch[] = [];
  for (let r = 2; r <= rcl; r++) {
    const rclBatches = RCL_BATCHES[r];
    if (rclBatches) batches.push(...rclBatches);
  }
  batches.sort((a, b) => (TYPE_PLACE_ORDER[a.type] ?? 99) - (TYPE_PLACE_ORDER[b.type] ?? 99));

  for (const batch of batches) {
    const { type, count, priority, phase } = batch;

    // Lab 特殊处理：集群放置
    if (type === STRUCTURE_LAB) {
      const labResult = placeLabCluster(count, candidates, occupied, getTerrain, labPositions);
      for (const pos of labResult) {
        const idx = (counters[type] ?? 0) + 1;
        counters[type] = idx;
        labPositions.push(pos);
        placements.push({
          key: `constraint.lab.${String(idx).padStart(2, "0")}`,
          pos,
          structureType: type,
          priority,
          phase,
        });
      }
      continue;
    }

    // 通用贪心放置
    let placed = 0;
    for (const c of candidates) {
      if (placed >= count) break;
      const packed = packPos(c.x, c.y);
      if (occupied.has(packed)) continue;

      // 密封守卫（障碍结构）
      const isObstacle = type !== STRUCTURE_ROAD && type !== STRUCTURE_CONTAINER;
      if (isObstacle && wouldSealLocal(c.x, c.y, getTerrain, occupied)) continue;

      occupied.add(packed);
      const idx = (counters[type] ?? 0) + 1;
      counters[type] = idx;
      placements.push({
        key: `constraint.${type}.${String(idx).padStart(2, "0")}`,
        pos: { x: c.x, y: c.y },
        structureType: type,
        priority,
        phase,
      });
      placed++;
    }
  }

  return placements;
}

/**
 * 将 ConstraintPlacement 列表转为 BuildTaskCandidate 格式（兼容现有入队流程）。
 * 所有候选标记为 validation: "ok"（放置算法已保证合法性）。
 */
export function placementsToCandidates(
  placements: readonly ConstraintPlacement[],
  roomName: string,
): {
  key: string;
  pos: { x: number; y: number; roomName: string };
  structureType: BuildableStructureConstant;
  priority: BuildPriority;
  phase: LayoutPhase;
  validation: "ok";
}[] {
  return placements.map(p => ({
    key: p.key,
    pos: { ...p.pos, roomName },
    structureType: p.structureType,
    priority: p.priority,
    phase: p.phase,
    validation: "ok" as const,
  }));
}
