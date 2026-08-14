import type { Blueprint, BlueprintCell, ValidationResult } from "./types";
import { inBounds, packPos } from "./types";
import type { RoomSnapshot } from "../../kernel/contracts";

/** validateBuildCell 的选项参数。 */
export interface ValidationOptions {
  /** 已完成的 blueprint key 集合 — 依赖检查。 */
  completedKeys: ReadonlySet<string>;
  /** 当前全局活跃 site 数。 */
  globalSiteCount: number;
  /** 全局 site 上限。 */
  maxGlobalSites: number;
  /** 房间 mineral 位置（可选）。 */
  minerals?: readonly { pos: { x: number; y: number } }[];
  /** 预计算结构计数（每规划周期构建一次，避免逐 cell 重复扫描）。 */
  structureCounts?: ReadonlyMap<string, number>;
  /** 预计算占用位置集合（packed x*50+y）。 */
  occupiedSet?: ReadonlySet<number>;
  /** 预计算障碍位置集合（packed，仅不可通行结构/工地），供密封守卫。 */
  obstacleSet?: ReadonlySet<number>;
}

/**
 * 障碍结构类型（不可通行）。字符串字面量而非 Screeps 常量，
 * 使模块在无 Screeps 运行时（Vitest）也可加载；road/container/rampart 可通行。
 */
export const OBSTACLE_TYPES: ReadonlySet<string> = new Set([
  "spawn",
  "extension",
  "tower",
  "storage",
  "link",
  "lab",
  "terminal",
  "factory",
  "nuker",
  "observer",
  "powerSpawn",
  "extractor",
]);

/**
 * 预计算障碍位置集合（packed x*50+y）——仅不可通行结构与障碍工地。
 * 每规划周期调用一次，供密封守卫（wouldSeal）复用。
 */
export function buildObstaclePositionSet(snapshot: RoomSnapshot): Set<number> {
  const set = new Set<number>();
  const arrays: ReadonlyArray<readonly { pos: { x: number; y: number } }[]> = [
    snapshot.spawns,
    snapshot.extensions,
    snapshot.towers,
    snapshot.links,
    snapshot.labs,
  ];
  for (const arr of arrays) {
    for (const s of arr) {
      set.add(packPos(s.pos.x, s.pos.y));
    }
  }
  if (snapshot.storage) set.add(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y));
  if (snapshot.terminal) set.add(packPos(snapshot.terminal.pos.x, snapshot.terminal.pos.y));
  if (snapshot.extractor) set.add(packPos(snapshot.extractor.pos.x, snapshot.extractor.pos.y));
  if (snapshot.factory) set.add(packPos(snapshot.factory.pos.x, snapshot.factory.pos.y));
  for (const site of snapshot.constructionSites) {
    if (OBSTACLE_TYPES.has(site.structureType)) {
      set.add(packPos(site.pos.x, site.pos.y));
    }
  }
  return set;
}

/** 可站格 = 边界内、非墙、无障碍结构/工地的格子。 */
function isServiceTile(
  x: number,
  y: number,
  terrain: RoomTerrain,
  obstacleSet: ReadonlySet<number>,
): boolean {
  if (x < 1 || x > 48 || y < 1 || y > 48) return false;
  if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;
  return !obstacleSet.has(packPos(x, y));
}

/**
 * 密封守卫 —「建筑孤岛」检测（v1 实心块教训：29 结构 8 邻居全堵死）。
 * transfer/spawnCreep/repair 射程均 1，障碍结构必须保留 ≥1 相邻可站格；
 * 检查自身仍有服务格，且不夺走任何相邻障碍结构的最后一个服务格。
 * true = 会造成密封，必须拒绝。
 */
export function wouldSeal(
  x: number,
  y: number,
  terrain: RoomTerrain,
  obstacleSet: ReadonlySet<number>,
): boolean {
  // 1. 自身服务格检查。
  let selfFree = false;
  for (let dx = -1; dx <= 1 && !selfFree; dx++) {
    for (let dy = -1; dy <= 1 && !selfFree; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (isServiceTile(x + dx, y + dy, terrain, obstacleSet)) selfFree = true;
    }
  }
  if (!selfFree) return true;

  // 2. 邻居服务格检查：我们占掉 (x,y) 后，邻居必须仍有 ≥1 个可站格。
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!obstacleSet.has(packPos(nx, ny))) continue;
      let neighborFree = 0;
      for (let tx = -1; tx <= 1; tx++) {
        for (let ty = -1; ty <= 1; ty++) {
          if (tx === 0 && ty === 0) continue;
          const cx = nx + tx;
          const cy = ny + ty;
          if (cx === x && cy === y) continue; // 我们即将占据的格子
          if (isServiceTile(cx, cy, terrain, obstacleSet)) neighborFree++;
        }
      }
      if (neighborFree === 0) return true;
    }
  }
  return false;
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
    snapshot.labs,
    snapshot.ramparts,
    snapshot.walls,
  ];
  for (const arr of typedArrays) {
    for (const s of arr) {
      counts.set(s.structureType, (counts.get(s.structureType) ?? 0) + 1);
    }
  }
  if (snapshot.storage) {
    counts.set(snapshot.storage.structureType, (counts.get(snapshot.storage.structureType) ?? 0) + 1);
  }
  if (snapshot.terminal) {
    counts.set(snapshot.terminal.structureType, (counts.get(snapshot.terminal.structureType) ?? 0) + 1);
  }
  if (snapshot.extractor) {
    counts.set(snapshot.extractor.structureType, (counts.get(snapshot.extractor.structureType) ?? 0) + 1);
  }
  if (snapshot.factory) {
    counts.set(snapshot.factory.structureType, (counts.get(snapshot.factory.structureType) ?? 0) + 1);
  }
  if (snapshot.observer) {
    counts.set(snapshot.observer.structureType, (counts.get(snapshot.observer.structureType) ?? 0) + 1);
  }
  if (snapshot.powerSpawn) {
    counts.set(snapshot.powerSpawn.structureType, (counts.get(snapshot.powerSpawn.structureType) ?? 0) + 1);
  }
  if (snapshot.nuker) {
    counts.set(snapshot.nuker.structureType, (counts.get(snapshot.nuker.structureType) ?? 0) + 1);
  }
  for (const site of snapshot.constructionSites) {
    counts.set(site.structureType, (counts.get(site.structureType) ?? 0) + 1);
  }
  return counts;
}

/**
 * 承诺数量 = 已建结构 + 我方 site + 队列 queued/blocked 任务，供 constraint
 * 放置器批次抵扣（代际稳定性）：只排真实缺口，消除幽灵任务与位置漂移
 * （存量幽灵由 syncTaskStates 类型饱和判定清 done）。队列只计 queued/blocked —
 * site/done 已被 site 与结构计数覆盖，重复计会高估承诺导致缺建。
 */
export function computeCommittedCounts(
  snapshot: RoomSnapshot,
  queue: readonly BuildTask[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (type: string): void => {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  };
  for (const s of snapshot.spawns) add(s.structureType);
  for (const s of snapshot.extensions) add(s.structureType);
  for (const s of snapshot.towers) add(s.structureType);
  for (const s of snapshot.labs) add(s.structureType);
  if (snapshot.storage) add(snapshot.storage.structureType);
  if (snapshot.terminal) add(snapshot.terminal.structureType);
  if (snapshot.factory) add(snapshot.factory.structureType);
  if (snapshot.observer) add(snapshot.observer.structureType);
  if (snapshot.powerSpawn) add(snapshot.powerSpawn.structureType);
  if (snapshot.nuker) add(snapshot.nuker.structureType);
  for (const site of snapshot.myConstructionSites) add(site.structureType);
  for (const task of queue) {
    if (task.state === "queued" || task.state === "blocked") add(task.structureType);
  }
  return counts;
}

/**
 * 预计算所有被占用位置（packed x*50+y）：source/controller/mineral/已有结构/site。
 * 每规划周期调用一次，供 validateBuildCell / findAdjacentBuildable 复用。
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
    ...snapshot.labs,
    // 道路可通行但不可在其上新建 — 漏掉会让放置器选在既有道路格上 → site 创建失败。
    ...snapshot.roads,
    ...snapshot.constructionSites,
  ];
  for (const s of structures) {
    set.add(packPos(s.pos.x, s.pos.y));
  }
  // 单例结构此前遗漏，导致放置器选在已占格 → createConstructionSite 返
  // ERR_INVALID_TARGET → 反复失败进黑名单 → RCL6-8 结构永久建不齐。
  if (snapshot.storage) {
    set.add(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y));
  }
  if (snapshot.terminal) {
    set.add(packPos(snapshot.terminal.pos.x, snapshot.terminal.pos.y));
  }
  if (snapshot.factory) {
    set.add(packPos(snapshot.factory.pos.x, snapshot.factory.pos.y));
  }
  if (snapshot.extractor) {
    set.add(packPos(snapshot.extractor.pos.x, snapshot.extractor.pos.y));
  }
  if (snapshot.observer) {
    set.add(packPos(snapshot.observer.pos.x, snapshot.observer.pos.y));
  }
  if (snapshot.powerSpawn) {
    set.add(packPos(snapshot.powerSpawn.pos.x, snapshot.powerSpawn.pos.y));
  }
  if (snapshot.nuker) {
    set.add(packPos(snapshot.nuker.pos.x, snapshot.nuker.pos.y));
  }
  return set;
}

/**
 * 统一位置验证器 — planner/executor 共用避免逻辑不一致（检查顺序见 plan §5.6.4）：
 * 边界 → RCL 上限 → 地形 → 占用 → 依赖 → 全局 site 上限，返回 "ok" 或首个失败原因。
 * 传入预计算 structureCounts/occupiedSet 时 O(1)，否则回退全量扫描（向后兼容）。
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

  // 2. RCL 上限（CONTROLLER_STRUCTURES 限制最大数量）。
  const maxForType = CONTROLLER_STRUCTURES[cell.structureType]?.[snapshot.rcl] ?? 0;
  if (maxForType === 0) return "rcl";
  const existingCount = options.structureCounts
    ? (options.structureCounts.get(cell.structureType) ?? 0)
    : countExistingAndSites(snapshot, cell.structureType);
  if (existingCount >= maxForType) return "rcl";

  // 3. 地形（墙）。
  const terrain = room.getTerrain();
  if (terrain.get(x, y) === TERRAIN_MASK_WALL) return "terrain";

  // 4. 占用（source/controller/mineral/已有结构/site）。
  const occupied = options.occupiedSet
    ? options.occupiedSet.has(packPos(x, y))
    : isOccupied(x, y, snapshot, options.minerals);
  if (occupied) return "occupied";

  // 4.5 密封守卫：障碍结构不得出生即密封或封死邻居（仅提供 obstacleSet 时启用）。
  if (options.obstacleSet && OBSTACLE_TYPES.has(cell.structureType)) {
    if (wouldSeal(x, y, terrain, options.obstacleSet)) return "seal";
  }

  // 5. 依赖（前置 blueprint key 须已完成）。
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
 * 已建结构 + site 数（通用扫描覆盖全部 BuildableStructureConstant —
 * 回退路径，优先用 precomputeStructureCounts）。
 */
function countExistingAndSites(
  snapshot: RoomSnapshot,
  structureType: BuildableStructureConstant,
): number {
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

/** 从 BuildQueue 提取已完成 blueprint key（state "done"/"site" 均算完成），供依赖检查。 */
export function collectCompletedKeys(queue: readonly BuildTask[]): Set<string> {
  const set = new Set<string>();
  for (const task of queue) {
    if (task.state === "done" || task.state === "site") {
      set.add(task.key);
    }
  }
  return set;
}

/**
 * 从实际已建结构补充 completedKeys — construction-manager 完成后立即删
 * "done" 任务，仅靠队列会漏掉已建结构；按锚点偏移位置的实际结构类型补齐。
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
