import type { Blueprint, BlueprintCell, BuildPriority, LayoutPhase, ValidationResult } from "./types";
import { absPos, packPos } from "./types";
import type { RoomSnapshot } from "../../kernel/contracts";
import { validateBuildCell, type ValidationOptions } from "./validation";

/** 蓝图单元转任务候选 — 包含验证结果。 */
export interface BuildTaskCandidate {
  readonly key: string;
  readonly pos: { x: number; y: number; roomName: string };
  readonly structureType: BuildableStructureConstant;
  readonly priority: BuildPriority;
  readonly phase: LayoutPhase;
  readonly requires?: readonly string[];
  readonly validation: ValidationResult;
}

/**
 * 判断某 phase 在给定 RCL 下是否允许建造。
 * bootstrap phase 不新建核心 site（先恢复能量链）。
 */
export function phaseAllowed(phase: LayoutPhase, rcl: number): boolean {
  switch (phase) {
    case "bootstrap":
      return false;
    case "rcl2":
      return rcl >= 2;
    case "rcl3":
      return rcl >= 3;
    case "rcl4":
      return rcl >= 4;
    case "late":
      return rcl >= 5;
    case "rcl6":
      return rcl >= 6;
    case "rcl7":
      return rcl >= 7;
    case "rcl8":
      return rcl >= 8;
  }
}

/**
 * 将蓝图转为 BuildTask 候选列表。
 * 每个候选包含验证结果，调用方根据验证结果决定是否推入 BuildQueue。
 *
 * 只生成当前 RCL 允许的 phase 的任务；
 * 越界或验证失败的候选仍返回（带失败原因），供调试和 blocked 记录。
 */
export function blueprintToTasks(
  blueprint: Blueprint,
  anchorX: number,
  anchorY: number,
  roomName: string,
  room: Room,
  snapshot: RoomSnapshot,
  rcl: number,
  options: ValidationOptions,
): BuildTaskCandidate[] {
  const candidates: BuildTaskCandidate[] = [];

  for (const cell of blueprint.cells) {
    // 只处理当前 RCL 允许的 phase。
    if (!phaseAllowed(cell.phase, rcl)) continue;

    const pos = absPos(anchorX, anchorY, cell, roomName);
    const validation = validateBuildCell(room, cell, pos, snapshot, options);

    candidates.push({
      key: cell.key,
      pos,
      structureType: cell.structureType,
      priority: cell.priority,
      phase: cell.phase,
      requires: cell.requires,
      validation,
    });
  }

  return candidates;
}

/**
 * 从候选列表中筛选可立即入队的安全任务。
 * 过滤掉 terrain/occupied 等永久失败的任务。
 */
export function filterValidCandidates(
  candidates: readonly BuildTaskCandidate[],
): BuildTaskCandidate[] {
  return candidates.filter(c => c.validation === "ok" || c.validation === "rcl" || c.validation === "dependency" || c.validation === "site-limit");
}

/**
 * 从候选列表中提取永久失败的任务（用于 blocked 记录）。
 */
export function extractBlockedCandidates(
  candidates: readonly BuildTaskCandidate[],
): BuildTaskCandidate[] {
  return candidates.filter(c => c.validation === "terrain" || c.validation === "occupied");
}

/**
 * 将候选转为 BuildTask 对象（用于推入 BuildQueue）。
 * state 初始为 "queued"。
 */
export function candidateToBuildTask(
  candidate: BuildTaskCandidate,
): BuildTask {
  return {
    key: candidate.key,
    pos: candidate.pos,
    structureType: candidate.structureType,
    priority: candidate.priority,
    state: "queued",
    attempts: 0,
    retryAt: 0,
  };
}

/**
 * 为 source 生成 container 任务。
 * 在 source 附近寻找可建造位置。
 */
export function createSourceContainerTasks(
  snapshot: RoomSnapshot,
  room: Room,
  options: ValidationOptions,
): BuildTaskCandidate[] {
  const candidates: BuildTaskCandidate[] = [];
  const maxContainers = CONTROLLER_STRUCTURES[STRUCTURE_CONTAINER]?.[snapshot.rcl] ?? 0;
  const existingContainers = snapshot.containers.length;
  const containerSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_CONTAINER,
  ).length;

  // 已有 container + site 数已达上限。
  if (existingContainers + containerSites >= maxContainers) return candidates;

  // 统计真正覆盖 source 的 container 数（紧邻某 source 的 container / site）。
  // 不能用 existingContainers（含 controller container）对比 source 数 —— 否则
  // controller container 会被误算进 source 覆盖，导致被毁的 source container 永不补建。
  const adjacentToSource = (x: number, y: number): boolean =>
    snapshot.sources.some(s => Math.abs(s.pos.x - x) <= 1 && Math.abs(s.pos.y - y) <= 1);
  const sourceContainerCount = snapshot.containers.filter(c => adjacentToSource(c.pos.x, c.pos.y)).length;
  const sourceContainerSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_CONTAINER && adjacentToSource(s.pos.x, s.pos.y),
  ).length;
  if (sourceContainerCount + sourceContainerSites >= snapshot.sources.length) return candidates;

  for (const source of snapshot.sources) {
    // 检查 source 旁是否已有 container 或 site。
    if (hasAdjacentStructure(source.pos.x, source.pos.y, snapshot, STRUCTURE_CONTAINER)) continue;

    // 寻找相邻可建造位置。
    const adjacentPos = findAdjacentBuildable(source.pos, room, snapshot, options);
    if (adjacentPos) {
      candidates.push({
        key: `logistics.container.source.${source.id}`,
        pos: adjacentPos,
        structureType: STRUCTURE_CONTAINER,
        priority: 1,
        phase: "rcl2",
        validation: "ok",
      });
    }
  }

  return candidates;
}

/**
 * 为 controller 生成 container 任务。
 *
 * 老玩家关键认知：controller container 在 RCL2 就应建造（container RCL2 即解锁），
 * 它让 upgrader 站桩升级（0 通勤），升级吞吐提升约 2 倍。RCL2→RCL3 是整个游戏
 * 最漫长的 grind，越早建好 controller container 越早摆脱慢速升级。
 */
export function createControllerContainerTask(
  snapshot: RoomSnapshot,
  room: Room,
  options: ValidationOptions,
): BuildTaskCandidate | undefined {
  if (snapshot.rcl < 2) return undefined;
  if (!snapshot.controller) return undefined;

  const controller = snapshot.controller;
  // 检查 controller 旁是否已有 container 或 site。
  if (hasAdjacentStructure(controller.pos.x, controller.pos.y, snapshot, STRUCTURE_CONTAINER)) return undefined;

  const maxContainers = CONTROLLER_STRUCTURES[STRUCTURE_CONTAINER]?.[snapshot.rcl] ?? 0;
  const existingContainers = snapshot.containers.length;
  const containerSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_CONTAINER,
  ).length;
  if (existingContainers + containerSites >= maxContainers) return undefined;

  const adjacentPos = findAdjacentBuildable(controller.pos, room, snapshot, options);
  if (!adjacentPos) return undefined;

  return {
    key: `logistics.container.controller`,
    pos: adjacentPos,
    structureType: STRUCTURE_CONTAINER,
    // 优先级 1：高于 extension（priority 2）。一旦有 site 名额空出立即插队建造。
    priority: 1,
    phase: "rcl2",
    validation: "ok",
  };
}

/**
 * 为 source 生成 link 任务（RCL5+）。
 * source link 紧邻 source 放置，harvester 采矿后直接 transfer 到 link，
 * 由 link 系统瞬移到 controller/storage link，替代 hauler 长途往返。
 */
export function createSourceLinkTasks(
  snapshot: RoomSnapshot,
  room: Room,
  options: ValidationOptions,
): BuildTaskCandidate[] {
  if (snapshot.rcl < 5) return [];
  const candidates: BuildTaskCandidate[] = [];
  const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK]?.[snapshot.rcl] ?? 0;
  const existingLinks = snapshot.links.length;
  const linkSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_LINK,
  ).length;
  if (existingLinks + linkSites >= maxLinks) return candidates;

  for (const source of snapshot.sources) {
    if (hasAdjacentStructure(source.pos.x, source.pos.y, snapshot, STRUCTURE_LINK)) continue;
    const adjacentPos = findAdjacentBuildable(source.pos, room, snapshot, options);
    if (adjacentPos) {
      candidates.push({
        key: `logistics.link.source.${source.id}`,
        pos: adjacentPos,
        structureType: STRUCTURE_LINK,
        priority: 2,
        phase: "late",
        validation: "ok",
      });
    }
  }
  return candidates;
}

/**
 * 为 controller 生成 link 任务（RCL5+）。
 * controller link 紧邻 controller 放置，upgrader 站桩 withdraw 取能，
 * 能量由 source link 瞬移送入，实现 0 通勤站桩升级。
 */
export function createControllerLinkTask(
  snapshot: RoomSnapshot,
  room: Room,
  options: ValidationOptions,
): BuildTaskCandidate | undefined {
  if (snapshot.rcl < 5) return undefined;
  if (!snapshot.controller) return undefined;

  const controller = snapshot.controller;
  if (hasAdjacentStructure(controller.pos.x, controller.pos.y, snapshot, STRUCTURE_LINK)) return undefined;

  const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK]?.[snapshot.rcl] ?? 0;
  const existingLinks = snapshot.links.length;
  const linkSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_LINK,
  ).length;
  if (existingLinks + linkSites >= maxLinks) return undefined;

  const adjacentPos = findAdjacentBuildable(controller.pos, room, snapshot, options);
  if (!adjacentPos) return undefined;

  return {
    key: `logistics.link.controller`,
    pos: adjacentPos,
    structureType: STRUCTURE_LINK,
    priority: 1,
    phase: "late",
    validation: "ok",
  };
}

/** 检查指定位置附近 1 格内是否已有某类型结构（直接遍历，零数组分配）。 */
function hasAdjacentStructure(
  cx: number,
  cy: number,
  snapshot: RoomSnapshot,
  structureType: BuildableStructureConstant,
): boolean {
  const adjacent = (s: { pos: { x: number; y: number }; structureType: string }): boolean =>
    s.structureType === structureType &&
    Math.abs(s.pos.x - cx) <= 1 && Math.abs(s.pos.y - cy) <= 1;

  for (const s of snapshot.containers) if (adjacent(s)) return true;
  for (const s of snapshot.links) if (adjacent(s)) return true;
  for (const s of snapshot.constructionSites) if (adjacent(s)) return true;
  return false;
}

/**
 * 在目标位置附近寻找可建造位置。
 *
 * 站桩位感知：优先选择「旁边至少有一个可站立格」的位置。
 * harvester/upgrader 站桩时需要站在 container 相邻格，若 container 落在
 * 三面是墙的凹位，站桩 creep 无处站立，退化成每 tick 挪一步。
 * 先收集所有可建造候选，优先返回有站立格的；都没有时回退到任意可建造格。
 */
function findAdjacentBuildable(
  center: RoomPosition,
  room: Room,
  snapshot: RoomSnapshot,
  options: ValidationOptions,
): { x: number; y: number; roomName: string } | undefined {
  const terrain = room.getTerrain();
  // 优先使用预计算的占用集合（每规划周期构建一次），否则回退到本地构建。
  const occupiedSet = options.occupiedSet ?? buildOccupiedSet(snapshot, options.minerals);

  const candidates: { x: number; y: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (occupiedSet.has(packPos(x, y))) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return undefined;

  // 优先返回有相邻站立格的候选（站立格：非墙、边界内、非中心格）。
  for (const c of candidates) {
    if (hasStandingTile(c.x, c.y, center.x, center.y, terrain)) {
      return { ...c, roomName: center.roomName };
    }
  }

  // 回退：任意可建造格（极端地形下保证 container 仍能放下）。
  const fallback = candidates[0]!;
  return { ...fallback, roomName: center.roomName };
}

/** 检查 (x,y) 相邻 8 格中是否存在可站立格（非墙、边界内、非 (cx,cy) 中心格）。 */
function hasStandingTile(
  x: number,
  y: number,
  cx: number,
  cy: number,
  terrain: RoomTerrain,
): boolean {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx === cx && ny === cy) continue; // 中心是 source/controller，不能站
      if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
      if (terrain.get(nx, ny) === TERRAIN_MASK_WALL) continue;
      return true;
    }
  }
  return false;
}

/** 预构建已占用位置集合（回退路径 — 优先使用 validation.buildOccupiedPositionSet）。 */
function buildOccupiedSet(
  snapshot: RoomSnapshot,
  minerals?: readonly { pos: { x: number; y: number } }[],
): Set<number> {
  const set = new Set<number>();
  for (const s of [
    ...snapshot.spawns,
    ...snapshot.extensions,
    ...snapshot.containers,
    ...snapshot.towers,
    ...snapshot.links,
    ...snapshot.constructionSites,
  ]) {
    set.add(packPos(s.pos.x, s.pos.y));
  }
  if (snapshot.storage) {
    set.add(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y));
  }
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
  return set;
}

// ─── 动态防御工事 ─────────────────────────────────────────

/** 防御工事生成选项。 */
export interface DefenseOptions {
  /** 开始建造防御工事的最低 RCL（早期靠 tower 裸防即可）。 */
  minRcl: number;
  /** 防御盾半径 — 核心向外第几格放置 rampart。 */
  defenseRadius: number;
  /** 单次规划最多生成的 rampart 数（分段铺设，不拖慢 RCL 冲刺）。 */
  maxRampartsPerCycle: number;
}

export const DEFAULT_DEFENSE_OPTIONS: DefenseOptions = {
  minRcl: 4,
  defenseRadius: 5,
  maxRampartsPerCycle: 2,
};

/** 8 方向单位向量（对应 atan2 的 8 个 45° 扇区，0 = 东，顺时针）。 */
const OCTANT_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/** 将 (dx, dy) 方向归一到 8 扇区索引。 */
function octantIndex(dx: number, dy: number): number {
  const angle = Math.atan2(dy, dx); // -PI..PI
  const sector = Math.round(angle / (Math.PI / 4)); // -4..4
  return ((sector % 8) + 8) % 8; // 0..7
}

/**
 * 为房间生成防御工事任务（rampart 核心盾）。
 *
 * 老玩家认知：静态蓝图无法预知出口方向，防御必须动态生成。
 * 策略：把房间出口按相对核心的方位归入 8 个扇区，对暴露扇区（出口最多的优先）
 * 在 核心 + 方向 × defenseRadius 处放 rampart，吸附到最近可建造空格。
 * 这不是密封墙（那是后期 bunker 的事），而是早期方向性盾牌——
 * 迫使入侵者绕路，为 tower 争取输出时间，RCL4 有 storage 后开始部署。
 *
 * 纯函数 — 出口位置由调用方通过 room.find(FIND_EXIT) 采集后传入。
 */
export function createDefenseTasks(
  snapshot: RoomSnapshot,
  exitPositions: readonly { x: number; y: number }[],
  room: Room,
  options: ValidationOptions,
  config: DefenseOptions = DEFAULT_DEFENSE_OPTIONS,
): BuildTaskCandidate[] {
  const candidates: BuildTaskCandidate[] = [];
  if (snapshot.rcl < config.minRcl) return candidates;

  const core = snapshot.spawns[0];
  if (!core) return candidates;

  // rampart 上限检查（已有 + site 达上限则不再生成）。
  const maxRamparts = CONTROLLER_STRUCTURES[STRUCTURE_RAMPART]?.[snapshot.rcl] ?? 0;
  const existingRamparts = snapshot.ramparts.length;
  const rampartSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_RAMPART,
  ).length;
  if (existingRamparts + rampartSites >= maxRamparts) return candidates;

  // 按扇区统计出口数量。
  const exitCountByOctant = new Map<number, number>();
  for (const exit of exitPositions) {
    const dx = exit.x - core.pos.x;
    const dy = exit.y - core.pos.y;
    const octant = octantIndex(dx, dy);
    exitCountByOctant.set(octant, (exitCountByOctant.get(octant) ?? 0) + 1);
  }
  if (exitCountByOctant.size === 0) return candidates;

  // 暴露扇区按出口数量降序，取前 N 个。
  const exposedOctants = [...exitCountByOctant.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, config.maxRampartsPerCycle)
    .map(([octant]) => octant);

  const terrain = room.getTerrain();
  const occupiedSet = options.occupiedSet ?? buildOccupiedSet(snapshot, options.minerals);

  for (const octant of exposedOctants) {
    const vec = OCTANT_VECTORS[octant]!;
    const idealX = core.pos.x + vec[0] * config.defenseRadius;
    const idealY = core.pos.y + vec[1] * config.defenseRadius;

    const pos = findBuildableNear(idealX, idealY, terrain, occupiedSet);
    if (!pos) continue;

    candidates.push({
      key: `defense.rampart.${octant}`,
      pos: { ...pos, roomName: snapshot.roomName },
      structureType: STRUCTURE_RAMPART,
      priority: 2,
      phase: "rcl4",
      validation: "ok",
    });
  }

  return candidates;
}

/**
 * 在理想点附近（半径 2）寻找最近的可建造空格。
 * 返回距离理想点欧氏距离最近的非墙、未占用、边界内的格子。
 */
function findBuildableNear(
  idealX: number,
  idealY: number,
  terrain: RoomTerrain,
  occupiedSet: ReadonlySet<number>,
): { x: number; y: number } | undefined {
  let best: { x: number; y: number } | undefined;
  let bestDist = Infinity;

  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const x = Math.round(idealX) + dx;
      const y = Math.round(idealY) + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (occupiedSet.has(packPos(x, y))) continue;
      const dist = (x - idealX) ** 2 + (y - idealY) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
}
