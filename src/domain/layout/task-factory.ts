import type { Blueprint, BlueprintCell, BuildPriority, LayoutPhase, ValidationResult } from "./types";
import { absPos, packPos, unpackPos } from "./types";
import type { RoomSnapshot } from "../../kernel/contracts";
import { validateBuildCell, wouldSeal, type ValidationOptions } from "./validation";
import { classifyLinkRole, type LinkRole } from "../economy/links";

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
 * 蓝图 → BuildTask 候选（含验证结果，调用方决定是否入队）。
 * 只生成当前 RCL 允许的 phase；失败候选仍返回（供调试和 blocked 记录）。
 * overrides：cell.key → packed 替代位置（重定位持久化，存 segment）—
 * 命中时用替代坐标而非蓝图偏移，墙/占用搬家后不必重新搜索。
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
  overrides?: ReadonlyMap<string, number>,
): BuildTaskCandidate[] {
  const candidates: BuildTaskCandidate[] = [];

  for (const cell of blueprint.cells) {
    if (!phaseAllowed(cell.phase, rcl)) continue;

    const override = overrides?.get(cell.key);
    const pos = override !== undefined
      ? { ...unpackPos(override), roomName }
      : absPos(anchorX, anchorY, cell, roomName);
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

/** 可重定位的结构类型 — spawn/storage 是锚定结构不可搬家，其余核心结构可微调。 */
export const RELOCATABLE_TYPES: ReadonlySet<string> = new Set(["extension", "tower", "link"]);

/**
 * 重定位候选偏移 — 全部为偶校验（dx+dy 偶数），保持 v2 棋盘格不变量：
 * 新位置的 4 个正交邻居仍是奇校验走道格，密封安全由几何保证。
 */
const RELOCATE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [2, 0], [-2, 0], [0, 2], [0, -2],
  [2, 2], [-2, 2], [2, -2], [-2, -2],
];

/**
 * 为验证失败的 cell 找替代位置：依次尝试同 parity 的 Chebyshev-2 邻居，
 * 第一个通过完整验证且不与 forbidden（全部蓝图 cell 绝对坐标 + 队列任务坐标）
 * 冲突的胜出。返回 key 不变、pos 更新的候选；找不到返回 undefined。
 */
export function relocateCandidate(
  candidate: BuildTaskCandidate,
  cell: BlueprintCell,
  room: Room,
  snapshot: RoomSnapshot,
  options: ValidationOptions,
  forbidden: ReadonlySet<number>,
): BuildTaskCandidate | undefined {
  if (!RELOCATABLE_TYPES.has(candidate.structureType)) return undefined;

  for (const [dx, dy] of RELOCATE_OFFSETS) {
    const x = candidate.pos.x + dx;
    const y = candidate.pos.y + dy;
    if (forbidden.has(packPos(x, y))) continue;
    const pos = { x, y, roomName: candidate.pos.roomName };
    const validation = validateBuildCell(room, cell, pos, snapshot, options);
    if (validation === "ok") {
      return { ...candidate, pos, validation };
    }
  }
  return undefined;
}

/** 筛选可立即入队的安全任务（过滤 terrain/occupied/seal 等永久失败）。 */
export function filterValidCandidates(
  candidates: readonly BuildTaskCandidate[],
): BuildTaskCandidate[] {
  return candidates.filter(c => c.validation === "ok" || c.validation === "rcl" || c.validation === "dependency" || c.validation === "site-limit");
}

/** 提取永久失败任务（用于 blocked 记录）；seal 除非邻居消失否则永不放行。 */
export function extractBlockedCandidates(
  candidates: readonly BuildTaskCandidate[],
): BuildTaskCandidate[] {
  return candidates.filter(c => c.validation === "terrain" || c.validation === "occupied" || c.validation === "seal");
}

/** 候选 → BuildTask（state 初始 "queued"，推入 BuildQueue）。 */
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

  // 只统计紧邻 source 的 container/site：existingContainers 含 controller
  // container，误用会导致被毁的 source container 永不补建。
  const adjacentToSource = (x: number, y: number): boolean =>
    snapshot.sources.some(s => Math.abs(s.pos.x - x) <= 1 && Math.abs(s.pos.y - y) <= 1);
  const sourceContainerCount = snapshot.containers.filter(c => adjacentToSource(c.pos.x, c.pos.y)).length;
  const sourceContainerSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_CONTAINER && adjacentToSource(s.pos.x, s.pos.y),
  ).length;
  if (sourceContainerCount + sourceContainerSites >= snapshot.sources.length) return candidates;

  for (const source of snapshot.sources) {
    if (hasAdjacentStructure(source.pos.x, source.pos.y, snapshot, STRUCTURE_CONTAINER)) continue;

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
 * controller container 任务。老玩家认知：RCL2 即建（container RCL2 解锁），
 * upgrader 站桩 0 通勤升级，吞吐约 2 倍 — RCL2→RCL3 是最漫长 grind。
 */
export function createControllerContainerTask(
  snapshot: RoomSnapshot,
  room: Room,
  options: ValidationOptions,
): BuildTaskCandidate | undefined {
  if (snapshot.rcl < 2) return undefined;
  if (!snapshot.controller) return undefined;

  const controller = snapshot.controller;
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
 * 候选格运行时是否会被分类为期望 link 角色 — 闭合「放置意图」与「运行时分类」裂缝：
 * source 离 storage 近时（Chebyshev ≤ 4），source 八邻域部分格会被 classifyLinkRole
 * 判为 storage → harvester 拒灌 → 该 link 永不被灌，RCL5 仅有的 2 个 link 槽位被
 * 静默浪费一个。放置侧只接受角色一致的格，从根上消除误分类。
 * anchorRange 取 2：必须与 CONFIG.economy.link.anchorRange / classifyLinkRole 默认值
 * 同步（放置侧纯函数不访问 CONFIG，改动需三处同步）。
 */
function linkRoleMatch(
  snapshot: RoomSnapshot,
  x: number,
  y: number,
  expected: LinkRole,
): boolean {
  const role = classifyLinkRole(
    { x, y },
    snapshot.sources.map(s => ({ x: s.pos.x, y: s.pos.y })),
    snapshot.controller ? { x: snapshot.controller.pos.x, y: snapshot.controller.pos.y } : undefined,
    snapshot.storage ? { x: snapshot.storage.pos.x, y: snapshot.storage.pos.y } : undefined,
    2,
  );
  return role === expected;
}

/** 将 linkRoleMatch 包装为 findAdjacentBuildable 的候选格谓词。 */
function linkRolePredicate(
  snapshot: RoomSnapshot,
  expected: LinkRole,
): (c: { x: number; y: number }) => boolean {
  return c => linkRoleMatch(snapshot, c.x, c.y, expected);
}

/**
 * source link 可喂性校验（W7N3 定位，2026-08-01）：旧逻辑只验证「link 贴 source +
 * 可建造」，不验证存在可喂站桩格（可走、未占用、同时贴 source 与 link）。W7N3
 * source-2 实证 link 建在 (39,7) 后双贴格全墙 → link 建成即死（能量恒 0）且骗过
 * 「紧邻 source 即跳过」永不补位。放置侧过滤候选，运行时 harvest.ts
 * findSourceLinkStand 用同一几何约束，两处口径一致。
 * 容器格例外：harvester 可站桩于 source container（range0 倒能），containerTiles 放行。
 */
export function hasSourceLinkFeedStand(
  linkX: number,
  linkY: number,
  sourceX: number,
  sourceY: number,
  terrain: RoomTerrain,
  occupiedSet: ReadonlySet<number>,
  containerTiles: ReadonlySet<number>,
): boolean {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = linkX + dx;
      const y = linkY + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (occupiedSet.has(packPos(x, y)) && !containerTiles.has(packPos(x, y))) continue;
      if (x === sourceX && y === sourceY) continue; // source 格本身不可作站位
      if (Math.max(Math.abs(x - sourceX), Math.abs(y - sourceY)) > 1) continue;
      return true;
    }
  }
  return false;
}

/**
 * source link 任务（RCL5+）：紧邻 source 放置，harvester 直灌 link 瞬移
 * 到 controller/storage，替代 hauler 长途往返。
 * queuedLinkCount：BuildQueue 中已有 link 任务数（防超额分配槽位）。
 * maxNew：本趟上限 — layout-planner 两趟调用：先 maxNew=1 保 storage link
 * 槽位，再 maxNew=Infinity 放剩余 source link。
 */
export function createSourceLinkTasks(
  snapshot: RoomSnapshot,
  room: Room,
  options: ValidationOptions,
  queuedLinkCount = 0,
  maxNew = Infinity,
): BuildTaskCandidate[] {
  if (snapshot.rcl < 5) return [];
  const candidates: BuildTaskCandidate[] = [];
  const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK]?.[snapshot.rcl] ?? 0;
  const existingLinks = snapshot.links.length;
  const linkSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_LINK,
  ).length;
  if (existingLinks + linkSites + queuedLinkCount >= maxLinks) return candidates;

  const remainingSlots = maxLinks - existingLinks - linkSites - queuedLinkCount;
  const limit = Math.min(maxNew, remainingSlots);
  const terrain = room.getTerrain();
  const occupiedSet = options.occupiedSet ?? buildOccupiedSet(snapshot, options.minerals);
  const containerTiles = new Set(snapshot.containers.map(c => packPos(c.pos.x, c.pos.y)));

  for (const source of snapshot.sources) {
    if (candidates.length >= limit) break;
    // W7N3 修复：按可喂性判定而非「紧邻即跳过」— 死 link（无可喂站桩格）不算
    // 已覆盖，继续尝试补位；已有紧邻 link/site 且可喂才跳过。
    const adjacentLinkFeedable = [
      ...snapshot.links,
      ...snapshot.constructionSites.filter(s => s.structureType === STRUCTURE_LINK),
    ].some(l =>
      Math.abs(l.pos.x - source.pos.x) <= 1 &&
      Math.abs(l.pos.y - source.pos.y) <= 1 &&
      hasSourceLinkFeedStand(
        l.pos.x, l.pos.y, source.pos.x, source.pos.y, terrain, occupiedSet, containerTiles,
      ),
    );
    if (adjacentLinkFeedable) continue;
    // 角色感知选位：只接受运行时分类为 source 的邻格 — source 邻近 storage/controller
    // 时部分邻格会被判为 storage/controller → harvester 拒灌 → 死 link。
    const adjacentPos = findAdjacentBuildable(
      source.pos, room, snapshot, options, linkRolePredicate(snapshot, "source"),
    );
    // 密封守卫：link 是障碍结构，出生即密封或封死邻居的位置不放。
    if (adjacentPos && options.obstacleSet && wouldSeal(adjacentPos.x, adjacentPos.y, room.getTerrain(), options.obstacleSet)) {
      continue;
    }
    // 可喂性守卫：必须存在可走、未占用的双贴站桩格（W7N3 source-2 实证
    // 双贴格全墙 → link 建成即死），放置前过滤。
    if (adjacentPos && !hasSourceLinkFeedStand(
      adjacentPos.x, adjacentPos.y, source.pos.x, source.pos.y, terrain, occupiedSet, containerTiles,
    )) {
      continue;
    }
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
 * controller link 任务（RCL5+）：紧邻 controller，upgrader 站桩 withdraw 取能，
 * 能量由 source link 瞬移送入，0 通勤站桩升级。
 * queuedLinkCount：BuildQueue 中已有 link 任务数。
 */
export function createControllerLinkTask(
  snapshot: RoomSnapshot,
  room: Room,
  options: ValidationOptions,
  queuedLinkCount = 0,
): BuildTaskCandidate | undefined {
  if (!shouldHaveControllerLink(snapshot, queuedLinkCount)) return undefined;
  const controller = snapshot.controller!;

  const adjacentPos = findAdjacentBuildable(
    controller.pos, room, snapshot, options, linkRolePredicate(snapshot, "controller"),
  );
  if (!adjacentPos) return undefined;
  // 密封守卫：link 是障碍结构。
  if (options.obstacleSet && wouldSeal(adjacentPos.x, adjacentPos.y, room.getTerrain(), options.obstacleSet)) {
    return undefined;
  }

  return {
    key: `logistics.link.controller`,
    pos: adjacentPos,
    structureType: STRUCTURE_LINK,
    priority: 1,
    phase: "late",
    validation: "ok",
  };
}

/**
 * 是否应有 controller link（RCL5+ + 无相邻 link + 槽位未满）。
 * P1-3 fallback 链：layout-planner 以此区分「几何放不下」（标记 linkConstrained）
 * 与「正常跳过」（已建成 / 槽位满 / RCL 不足）。
 */
export function shouldHaveControllerLink(
  snapshot: RoomSnapshot,
  queuedLinkCount = 0,
): boolean {
  if (snapshot.rcl < 5) return false;
  if (!snapshot.controller) return false;
  if (hasAdjacentStructure(
    snapshot.controller.pos.x,
    snapshot.controller.pos.y,
    snapshot,
    STRUCTURE_LINK,
  )) return false;
  const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK]?.[snapshot.rcl] ?? 0;
  const existingLinks = snapshot.links.length;
  const linkSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_LINK,
  ).length;
  return existingLinks + linkSites + queuedLinkCount < maxLinks;
}

/**
 * storage link 任务（RCL5+）：紧邻 storage（range ≤ 2），link 网络「最后一公里」，
 * hauler 从 storage link 排空到 storage。
 * priority 1（与 controller link 同级，高于第二 source link）；调用顺序
 * （stage 2，2026-08-02）：source(1) → controller → storage → source(rest) —
 * RCL5 落 source+controller，controller 几何失败时 storage 顶上。
 */
export function createStorageLinkTask(
  snapshot: RoomSnapshot,
  room: Room,
  options: ValidationOptions,
  queuedLinkCount = 0,
): BuildTaskCandidate | undefined {
  if (!shouldHaveStorageLink(snapshot, queuedLinkCount)) return undefined;
  const storage = snapshot.storage!;

  // 角色感知：只接受运行时分类为 storage 的邻格（link 无需站桩位）。
  const adjacentPos = findAdjacentBuildable(
    storage.pos, room, snapshot, options, linkRolePredicate(snapshot, "storage"),
  );
  if (!adjacentPos) return undefined;
  // 密封守卫：link 是障碍结构。
  if (options.obstacleSet && wouldSeal(adjacentPos.x, adjacentPos.y, room.getTerrain(), options.obstacleSet)) {
    return undefined;
  }

  return {
    key: `logistics.link.storage`,
    pos: adjacentPos,
    structureType: STRUCTURE_LINK,
    // 优先级 1：与 controller link 同级（RCL5 落 source+controller，RCL6 起 storage 入网）。
    priority: 1,
    phase: "late",
    validation: "ok",
  };
}

/**
 * 是否应有 storage link（RCL5+ + 有 storage + 无相邻 link + 槽位未满）。
 * P1-3 fallback 链：layout-planner 以此区分「几何放不下」（标记 linkConstrained）
 * 与「正常跳过」。
 */
export function shouldHaveStorageLink(
  snapshot: RoomSnapshot,
  queuedLinkCount = 0,
): boolean {
  if (snapshot.rcl < 5) return false;
  if (!snapshot.storage) return false;
  if (hasAdjacentStructure(
    snapshot.storage.pos.x,
    snapshot.storage.pos.y,
    snapshot,
    STRUCTURE_LINK,
  )) return false;
  const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK]?.[snapshot.rcl] ?? 0;
  const existingLinks = snapshot.links.length;
  const linkSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_LINK,
  ).length;
  return existingLinks + linkSites + queuedLinkCount < maxLinks;
}

/**
 * extractor 任务（RCL6+）：必须建在 mineral 格上，不走 validateBuildCell 的
 * occupied 检查（矿位会被误判为占用）；补齐「extractor → harvestMineral →
 * hauler 运回」产业链第一环。
 */
export function createExtractorTask(
  snapshot: RoomSnapshot,
): BuildTaskCandidate | undefined {
  if (snapshot.rcl < 6) return undefined;
  const mineral = snapshot.minerals[0];
  if (!mineral) return undefined;

  // 已有 extractor 或 extractor site 则不再生成（每房上限 1）。
  const maxExtractors = CONTROLLER_STRUCTURES[STRUCTURE_EXTRACTOR]?.[snapshot.rcl] ?? 0;
  const existingExtractors = snapshot.extractor !== undefined ? 1 : 0;
  const extractorSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_EXTRACTOR,
  ).length;
  if (existingExtractors + extractorSites >= maxExtractors) return undefined;

  return {
    key: `industry.extractor.${mineral.id}`,
    pos: { x: mineral.pos.x, y: mineral.pos.y, roomName: snapshot.roomName },
    structureType: STRUCTURE_EXTRACTOR,
    priority: 3,
    phase: "rcl6",
    validation: "ok",
  };
}

/**
 * mineral container 任务（RCL6+，需 extractor）：miner 站桩倒矿，hauler 运走。
 * createSourceContainerTasks 只覆盖 sources，故 mineral container 单列。
 * priority 3（工业链非生存关键）。
 */
export function createMineralContainerTask(
  snapshot: RoomSnapshot,
  room: Room,
  options: ValidationOptions,
): BuildTaskCandidate | undefined {
  if (snapshot.rcl < 6) return undefined;
  if (snapshot.extractor === undefined) return undefined;
  const mineral = snapshot.minerals[0];
  if (!mineral) return undefined;

  if (hasAdjacentStructure(mineral.pos.x, mineral.pos.y, snapshot, STRUCTURE_CONTAINER)) return undefined;

  const adjacentPos = findAdjacentBuildable(mineral.pos, room, snapshot, options);
  if (!adjacentPos) return undefined;

  return {
    key: `industry.container.mineral.${mineral.id}`,
    pos: adjacentPos,
    structureType: STRUCTURE_CONTAINER,
    priority: 3,
    phase: "rcl6",
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
 * 在目标附近找可建造位置。站桩位感知：优先选「旁边有可站立格」的候选 —
 * container 落在三面墙凹位则站桩 creep 无处站立（退化每 tick 挪一步），
 * 全无时回退任意可建造格。
 * predicate（可选，默认恒真）：link 放置传 linkRolePredicate，闭合放置意图与
 * 运行时分类的裂缝；偏好与回退路径都先经其过滤，container 等调用方不变。
 */
function findAdjacentBuildable(
  center: RoomPosition,
  room: Room,
  snapshot: RoomSnapshot,
  options: ValidationOptions,
  predicate: (c: { x: number; y: number }) => boolean = () => true,
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
      if (!predicate({ x, y })) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return undefined;

  // 优先返回有相邻站立格的候选。
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

// ─── 核心预规划道路 ────────────────

/**
 * 棋盘格走道预规划道路 — 等流量采样（100+ tick × 2）再铺路会让前 200 tick
 * hauler 走 plain（cost 2）效率减半；预铺让第一天就 cost 1（老玩家认知）。
 * 奇校验格（天然走道）且正交相邻 ≥ 2 个已建/已规划结构 → 高频通行路径，
 * priority 3 背景建造。RCL2+ 生成；每周期上限 maxRoadsPerCycle 条防淹没队列。
 */
export function createCoreRoadTasks(
  blueprint: Blueprint,
  anchorX: number,
  anchorY: number,
  roomName: string,
  room: Room,
  snapshot: RoomSnapshot,
  occupiedSet: ReadonlySet<number>,
  maxRoadsPerCycle = 4,
): BuildTaskCandidate[] {
  const candidates: BuildTaskCandidate[] = [];
  if (snapshot.rcl < 2) return candidates;

  const terrain = room.getTerrain();

  // 当前 RCL 已建/已规划结构绝对位置（偶校验格）。
  const structurePositions = new Set<number>();
  for (const cell of blueprint.cells) {
    if (cell.minRcl > snapshot.rcl) continue;
    structurePositions.add(packPos(anchorX + cell.dx, anchorY + cell.dy));
  }
  for (const s of [...snapshot.spawns, ...snapshot.extensions, ...snapshot.towers, ...snapshot.containers, ...snapshot.links]) {
    structurePositions.add(packPos(s.pos.x, s.pos.y));
  }
  if (snapshot.storage) structurePositions.add(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y));

  // 扫描核心区（±7）奇校验格：正交相邻 ≥ 2 结构即高频走道。
  let generated = 0;
  for (let dx = -7; dx <= 7 && generated < maxRoadsPerCycle; dx++) {
    for (let dy = -7; dy <= 7 && generated < maxRoadsPerCycle; dy++) {
      if ((dx + dy) % 2 === 0) continue;

      const x = anchorX + dx;
      const y = anchorY + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (occupiedSet.has(packPos(x, y))) continue;

      let adjacentStructures = 0;
      const orthogonal: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [ox, oy] of orthogonal) {
        if (structurePositions.has(packPos(x + ox, y + oy))) {
          adjacentStructures++;
        }
      }

      if (adjacentStructures >= 2) {
        candidates.push({
          key: `road.core.${x}.${y}`,
          pos: { x, y, roomName },
          structureType: STRUCTURE_ROAD,
          priority: 3,
          phase: "rcl2",
          validation: "ok",
        });
        generated++;
      }
    }
  }

  return candidates;
}

// ─── 动态防御工事 ────────────────

/** 防御工事生成选项。 */
export interface DefenseOptions {
  /** 开始建造防御工事的最低 RCL（早期靠 tower 裸防即可）。 */
  minRcl: number;
  /** 防御线半径 — 核心向外第几格放置 rampart 线（越大 = 敌人越早被拦截）。 */
  defenseRadius: number;
  /** 每条防御线的 rampart 数量（垂直于出口方向排列）。 */
  lineLength: number;
  /** 单次规划最多生成的防御线数（每线 lineLength 个 rampart）。 */
  maxLinesPerCycle: number;
}

export const DEFAULT_DEFENSE_OPTIONS: DefenseOptions = {
  // P0-3：从 4 降为 3 — RCL3 是"刚有 Tower 但无 rampart"的最脆弱窗口期。
  minRcl: 3,
  defenseRadius: 7,
  // v3 增强：3→5 — 旧 3 格线在宽出口留缺口可绕行；5 格形成连续封锁面。
  lineLength: 5,
  // v3 增强：1→2 — 2 条线提供纵深，首线被破后第二线为 tower 争取输出窗口。
  maxLinesPerCycle: 2,
};

/** 8 方向单位向量（对应 atan2 的 8 个 45° 扇区，0 = 东，顺时针）。 */
const OCTANT_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/** 垂直方向（逆时针旋转 90°）：(dx,dy) → (-dy,dx)。 */
function perpendicular(vec: readonly [number, number]): readonly [number, number] {
  return [-vec[1], vec[0]];
}

/** 将 (dx, dy) 方向归一到 8 扇区索引。 */
function octantIndex(dx: number, dy: number): number {
  const angle = Math.atan2(dy, dx); // -PI..PI
  const sector = Math.round(angle / (Math.PI / 4)); // -4..4
  return ((sector % 8) + 8) % 8; // 0..7
}

/**
 * 出口走廊封堵线 — 单个 rampart 不挡路（敌人直接绕过），垂直于出口方向的
 * 连续 rampart 线迫使入侵者摧毁或绕路，为 tower 争取 5-10 tick 输出窗口。
 * 暴露扇区（出口多者优先）按核心+方向×radius 铺 lineLength 个 rampart，
 * 逐格吸附最近可建空格；每周期最多 maxLinesPerCycle 条线。
 * 出口位置由调用方 room.find(FIND_EXIT) 采集后传入。
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

  // 暴露扇区按出口数降序，取前 maxLinesPerCycle 条。
  const exposedOctants = [...exitCountByOctant.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, config.maxLinesPerCycle)
    .map(([octant]) => octant);

  const terrain = room.getTerrain();
  // 本地可变副本：防止同线内重复落子（ReadonlySet 不可修改）。
  const localOccupied = new Set<number>(options.occupiedSet ?? buildOccupiedSet(snapshot, options.minerals));

  for (const octant of exposedOctants) {
    const vec = OCTANT_VECTORS[octant]!;
    const perp = perpendicular(vec);

    // 线中心 = 核心 + 方向 × radius。
    const centerX = core.pos.x + vec[0] * config.defenseRadius;
    const centerY = core.pos.y + vec[1] * config.defenseRadius;

    // 沿垂直方向居中铺 lineLength 个 rampart。
    const halfLen = Math.floor(config.lineLength / 2);
    for (let i = -halfLen; i <= halfLen; i++) {
      const idealX = centerX + perp[0] * i;
      const idealY = centerY + perp[1] * i;

      const pos = findBuildableNear(idealX, idealY, terrain, localOccupied);
      if (!pos) continue;

      // 标记已占用，防同线内重复落子。
      localOccupied.add(packPos(pos.x, pos.y));

      candidates.push({
        key: `defense.rampart.${octant}.${i + halfLen}`,
        pos: { ...pos, roomName: snapshot.roomName },
        structureType: STRUCTURE_RAMPART,
        priority: 2,
        phase: "rcl4",
        validation: "ok",
      });
    }
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
      if (x < 1 || x > 48 || y > 48 || y < 1) continue;
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
