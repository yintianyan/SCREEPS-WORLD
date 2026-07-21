import type { Blueprint, BlueprintCell, ValidationResult } from "./types";
import { inBounds, packPos } from "./types";
import type { RoomSnapshot } from "../../kernel/contracts";

/** validateBuildCell 的选项参数。 */
export interface ValidationOptions {
  /** 已完成的 blueprint key 集合 — 用于依赖检查。 */
  completedKeys: ReadonlySet<string>;
  /** 当前全局活跃 site 数。 */
  globalSiteCount: number;
  /** 全局 site 上限。 */
  maxGlobalSites: number;
  /** 房间内的 mineral 位置（可选，由调用方提供）。 */
  minerals?: readonly { pos: { x: number; y: number } }[];
  /** 预计算的结构计数（每规划周期构建一次，避免每 cell 重复扫描）。 */
  structureCounts?: ReadonlyMap<string, number>;
  /** 预计算的占用位置集合（packed x*50+y，每规划周期构建一次）。 */
  occupiedSet?: ReadonlySet<number>;
}

/**
 * 预计算房间内各结构类型的数量（已建 + site）。
 * 每规划周期调用一次，供 validateBuildCell 复用 — 消除 O(cells × structures) 扫描。
 */
export function precomputeStructureCounts(snapshot: RoomSnapshot): Map<string, number> {
  const counts = new Map<string, number>();
  const typedArrays: ReadonlyArray<readonly AnyStructure[]> = [
    snapshot.spawns,
    snapshot.extensions,
    snapshot.towers,
    snapshot.containers,
    snapshot.roads,
    snapshot.links,
  ];
  for (const arr of typedArrays) {
    for (const s of arr) {
      counts.set(s.structureType, (counts.get(s.structureType) ?? 0) + 1);
    }
  }
  if (snapshot.storage) {
    counts.set(snapshot.storage.structureType, (counts.get(snapshot.storage.structureType) ?? 0) + 1);
  }
  for (const site of snapshot.constructionSites) {
    counts.set(site.structureType, (counts.get(site.structureType) ?? 0) + 1);
  }
  return counts;
}

/**
 * 预计算所有被占用位置（packed x*50+y）。
 * 包括：source/controller/mineral/已有结构/site。
 * 每规划周期调用一次，供 validateBuildCell 和 findAdjacentBuildable 复用。
 */
export function buildOccupiedPositionSet(
  snapshot: RoomSnapshot,
  minerals?: readonly { pos: { x: number; y: number } }[],
): Set<number> {
  const set = new Set<number>();
  for (const s of snapshot.sources) {
    set.add(packPos(s.pos.x, s.pos.y));
  }
  if (snapshot.controller) {
    set.add(packPos(snapshot.controller.pos.x, snapshot.controller.pos.y));
  }
  if (minerals) {
    for (const m of minerals) {
      set.add(packPos(m.pos.x, m.pos.y));
    }
  }
  const structures: readonly { pos: { x: number; y: number } }[] = [
    ...snapshot.spawns,
    ...snapshot.extensions,
    ...snapshot.towers,
    ...snapshot.containers,
    ...snapshot.links,
    ...snapshot.constructionSites,
  ];
  for (const s of structures) {
    set.add(packPos(s.pos.x, s.pos.y));
  }
  if (snapshot.storage) {
    set.add(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y));
  }
  return set;
}

/**
 * 统一的位置验证器 — planner 和 executor 共用，避免逻辑不一致。
 *
 * 检查顺序（plan §5.6.4）：
 *   1. 边界
 *   2. RCL 可建数量上限
 *   3. 地形（墙）
 *   4. 占用（source/controller/mineral/已有结构/site）
 *   5. 前置依赖
 *   6. 全局 site 上限
 *
 * 返回 "ok" 或第一个失败原因。
 * 传入 options.structureCounts / options.occupiedSet 时使用预计算数据（O(1) 查询），
 * 否则回退到全量扫描（向后兼容）。
 */
export function validateBuildCell(
  room: Room,
  cell: BlueprintCell,
  pos: { x: number; y: number },
  snapshot: RoomSnapshot,
  options: ValidationOptions,
): ValidationResult {
  const { x, y } = pos;

  // 1. 边界检查。
  if (!inBounds(x, y)) return "terrain";

  // 2. RCL 检查 — CONTROLLER_STRUCTURES 限制该类型的最大数量。
  const maxForType = CONTROLLER_STRUCTURES[cell.structureType]?.[snapshot.rcl] ?? 0;
  if (maxForType === 0) return "rcl";
  const existingCount = options.structureCounts
    ? (options.structureCounts.get(cell.structureType) ?? 0)
    : countExistingAndSites(snapshot, cell.structureType);
  if (existingCount >= maxForType) return "rcl";

  // 3. 地形检查 — 不能在墙上建造。
  const terrain = room.getTerrain();
  if (terrain.get(x, y) === TERRAIN_MASK_WALL) return "terrain";

  // 4. 占用检查 — 不能与 source/controller/mineral/已有结构/site 重叠。
  const occupied = options.occupiedSet
    ? options.occupiedSet.has(packPos(x, y))
    : isOccupied(x, y, snapshot, options.minerals);
  if (occupied) return "occupied";

  // 5. 依赖检查 — 前置 blueprint key 必须已完成。
  if (cell.requires) {
    for (const reqKey of cell.requires) {
      if (!options.completedKeys.has(reqKey)) return "dependency";
    }
  }

  // 6. 全局 site 上限。
  if (options.globalSiteCount >= options.maxGlobalSites) return "site-limit";

  return "ok";
}

/**
 * 统计房间内某类型的已建结构 + 已有 site 数。
 * 通用扫描：覆盖所有 BuildableStructureConstant 类型，避免新增结构类型时遗漏。
 * （回退路径 — 优先使用 precomputeStructureCounts。）
 */
function countExistingAndSites(
  snapshot: RoomSnapshot,
  structureType: BuildableStructureConstant,
): number {
  // 预分类的结构数组按类型计数（覆盖 snapshot 已分类的所有结构）。
  const typedArrays: ReadonlyArray<readonly AnyStructure[]> = [
    snapshot.spawns,
    snapshot.extensions,
    snapshot.towers,
    snapshot.containers,
    snapshot.roads,
    snapshot.links,
  ];
  let count = 0;
  for (const arr of typedArrays) {
    for (const s of arr) {
      if (s.structureType === structureType) count++;
    }
  }
  // storage 是单例字段单独处理。
  if (snapshot.storage && snapshot.storage.structureType === structureType) count++;
  // 加上已有的同类型 site。
  count += snapshot.constructionSites.filter(
    s => s.structureType === structureType,
  ).length;
  return count;
}

/** 检查位置是否被 source/controller/mineral/已有结构/site 占用。（回退路径） */
function isOccupied(
  x: number,
  y: number,
  snapshot: RoomSnapshot,
  minerals?: readonly { pos: { x: number; y: number } }[],
): boolean {
  // source
  for (const s of snapshot.sources) {
    if (s.pos.x === x && s.pos.y === y) return true;
  }
  // controller
  if (snapshot.controller) {
    if (snapshot.controller.pos.x === x && snapshot.controller.pos.y === y) return true;
  }
  // mineral
  if (minerals) {
    for (const m of minerals) {
      if (m.pos.x === x && m.pos.y === y) return true;
    }
  }
  // 已有结构
  const structures: readonly { pos: { x: number; y: number } }[] = [
    ...snapshot.spawns,
    ...snapshot.extensions,
    ...snapshot.towers,
    ...snapshot.containers,
    ...snapshot.links,
    ...snapshot.constructionSites,
  ];
  for (const s of structures) {
    if (s.pos.x === x && s.pos.y === y) return true;
  }
  if (snapshot.storage) {
    if (snapshot.storage.pos.x === x && snapshot.storage.pos.y === y) return true;
  }
  return false;
}

/**
 * 从 BuildQueue 中提取已完成的 blueprint key 集合。
 * 用于依赖检查 — 只有 state 为 "done" 的任务才算完成。
 */
export function collectCompletedKeys(queue: readonly BuildTask[]): Set<string> {
  const set = new Set<string>();
  for (const task of queue) {
    // 已完成或已有 site 的任务算作依赖满足。
    if (task.state === "done" || task.state === "site") {
      set.add(task.key);
    }
    // 已建结构也满足依赖 — 通过 key 匹配。
  }
  return set;
}

/**
 * 从房间实际已建结构中提取已完成的 blueprint key 集合。
 *
 * construction-manager 会在任务完成后立即删除 "done" 任务，
 * 因此仅依赖队列会漏掉已建结构。此函数通过检查锚点偏移位置
 * 上的实际结构类型来补充 completedKeys。
 */
export function collectCompletedKeysFromStructures(
  blueprint: Blueprint,
  anchorX: number,
  anchorY: number,
  snapshot: RoomSnapshot,
): Set<string> {
  const set = new Set<string>();

  // 预构建位置 → 结构类型映射（packed numeric key，消除字符串分配）。
  const structureMap = new Map<number, string>();
  for (const s of [...snapshot.spawns, ...snapshot.extensions, ...snapshot.towers, ...snapshot.containers, ...snapshot.links]) {
    structureMap.set(packPos(s.pos.x, s.pos.y), s.structureType);
  }
  if (snapshot.storage) {
    structureMap.set(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y), STRUCTURE_STORAGE);
  }

  for (const cell of blueprint.cells) {
    const x = anchorX + cell.dx;
    const y = anchorY + cell.dy;
    const existing = structureMap.get(packPos(x, y));
    if (existing === cell.structureType) {
      set.add(cell.key);
    }
  }
  return set;
}
