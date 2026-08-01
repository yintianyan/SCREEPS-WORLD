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
  /** 预计算的障碍位置集合（packed x*50+y，仅不可通行结构/工地）。供密封守卫使用。 */
  obstacleSet?: ReadonlySet<number>;
}

/**
 * 障碍结构类型（不可通行）。使用字符串字面量而非 Screeps 常量，
 * 使模块在无 Screeps 运行时（Vitest）也可加载。
 * road/container/自有 rampart 可通行，不在此列。
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
 * 密封守卫 —「建筑孤岛」检测（v1 实心块教训：29 个结构 8 邻居全堵死）。
 *
 * transfer / spawnCreep / repair 射程均为 1，任何障碍结构都必须保留
 * ≥1 个相邻可站格（服务格），否则永远无法填充/维修/孵化。
 *
 * 在 (x,y) 放置障碍结构前检查：
 *   1. 自身仍有 ≥1 个相邻可站格（否则出生即密封）；
 *   2. 不夺走任何相邻障碍结构的最后一个可站格（否则把邻居封死）。
 *
 * 返回 true = 会造成密封，必须拒绝。
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
      // 邻居当前的可站格（排除我们将占据的 (x,y)）。
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
 * 各结构类型的「承诺数量」= 已建结构 + 我方在建 site + 队列中未完成任务。
 *
 * 供 constraint 放置器做批次抵扣（代际稳定性）：placeStructures 只为
 * 真实缺口生成放置，已被承诺的数量不再排位 — 消除「已建格进 occupied →
 * 贪心顺延到次优格 → 同一逻辑结构在新格重复排队」的代际漂移与幽灵任务
 * （存量幽灵任务由 syncTaskStates 的类型饱和判定转 done 清除）。
 *
 * 队列口径：仅计 queued/blocked 任务 — site 状态的任务对应实体 site
 * （已由 site 计数覆盖），done 任务对应已建结构（已由结构计数覆盖），
 * 重复计入会高估承诺、导致缺口放置不足。
 *
 * 纯函数 — 从 snapshot 与队列读取只读数据。
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
    ...snapshot.labs,
    // 道路是结构：可通行但不可在其上建造新结构。漏掉会导致约束放置器把
    // extension 等候选选在既有道路格上 → site 创建失败 → 阻塞/黑名单空转。
    ...snapshot.roads,
    ...snapshot.constructionSites,
  ];
  for (const s of structures) {
    set.add(packPos(s.pos.x, s.pos.y));
  }
  // 单例结构 — 此前遗漏 terminal/factory/extractor/observer/powerSpawn，导致
  // 约束放置器把新结构选在这些已占格上 → createConstructionSite 返 ERR_INVALID_TARGET
  // → 反复失败进黑名单 → 主房 RCL6-8 结构（如 spawn#2/tower#3/factory）永久建不齐。
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

  // 4.5 密封守卫 — 障碍结构不得出生即密封，也不得把邻居封死（v1 实心块教训）。
  // 仅在提供 obstacleSet 时启用（planner 每周期预计算）。
  if (options.obstacleSet && OBSTACLE_TYPES.has(cell.structureType)) {
    if (wouldSeal(x, y, terrain, options.obstacleSet)) return "seal";
  }

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
