import type { Blueprint, BlueprintCell, BuildPriority, LayoutPhase, ValidationResult } from "./types";
import { absPos } from "./types";
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

/** 检查指定位置附近 1 格内是否已有某类型结构。 */
function hasAdjacentStructure(
  cx: number,
  cy: number,
  snapshot: RoomSnapshot,
  structureType: BuildableStructureConstant,
): boolean {
  const structures = [...snapshot.containers, ...snapshot.links, ...snapshot.constructionSites];
  for (const s of structures) {
    if (s.structureType !== structureType) continue;
    if (Math.abs(s.pos.x - cx) <= 1 && Math.abs(s.pos.y - cy) <= 1) return true;
  }
  return false;
}

/** 在目标位置附近寻找可建造位置。 */
function findAdjacentBuildable(
  center: RoomPosition,
  room: Room,
  snapshot: RoomSnapshot,
  options: ValidationOptions,
): { x: number; y: number; roomName: string } | undefined {
  const terrain = room.getTerrain();
  const occupiedSet = buildOccupiedSet(snapshot, options.minerals);

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (occupiedSet.has(`${x},${y}`)) continue;
      return { x, y, roomName: center.roomName };
    }
  }
  return undefined;
}

/** 预构建已占用位置集合。 */
function buildOccupiedSet(
  snapshot: RoomSnapshot,
  minerals?: readonly { pos: { x: number; y: number } }[],
): Set<string> {
  const set = new Set<string>();
  for (const s of [
    ...snapshot.spawns,
    ...snapshot.extensions,
    ...snapshot.containers,
    ...snapshot.towers,
    ...snapshot.links,
    ...snapshot.constructionSites,
  ]) {
    set.add(`${s.pos.x},${s.pos.y}`);
  }
  if (snapshot.storage) {
    set.add(`${snapshot.storage.pos.x},${snapshot.storage.pos.y}`);
  }
  for (const s of snapshot.sources) {
    set.add(`${s.pos.x},${s.pos.y}`);
  }
  if (snapshot.controller) {
    set.add(`${snapshot.controller.pos.x},${snapshot.controller.pos.y}`);
  }
  if (minerals) {
    for (const m of minerals) {
      set.add(`${m.pos.x},${m.pos.y}`);
    }
  }
  return set;
}
