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
 * 将蓝图转为 BuildTask 候选列表。
 * 每个候选包含验证结果，调用方根据验证结果决定是否推入 BuildQueue。
 *
 * 只生成当前 RCL 允许的 phase 的任务；
 * 越界或验证失败的候选仍返回（带失败原因），供调试和 blocked 记录。
 *
 * overrides：cell.key → packed 替代位置（重定位持久化，存 segment）。
 * 命中时直接使用替代坐标而非蓝图偏移 —— 墙/占用导致 cell 搬家后，
 * 后续规划周期不必重新搜索。
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
    // 只处理当前 RCL 允许的 phase。
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
 * 为验证失败的可移动 cell 寻找替代位置（fallback relocation）。
 *
 * 适用：cell 落在墙/占用/密封格。依次尝试同 parity 的 Chebyshev-2 邻居，
 * 第一个通过完整验证（含密封守卫）且不与蓝图/队列位置冲突的位置胜出。
 *
 * forbidden：禁止落子的 packed 位置（全部蓝图 cell 绝对坐标 + 队列任务坐标），
 * 防止两个 cell 被重定位到同一格。
 *
 * 返回新候选（key 不变、pos 更新），找不到返回 undefined。
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

/**
 * 从候选列表中筛选可立即入队的安全任务。
 * 过滤掉 terrain/occupied/seal 等永久失败的任务。
 */
export function filterValidCandidates(
  candidates: readonly BuildTaskCandidate[],
): BuildTaskCandidate[] {
  return candidates.filter(c => c.validation === "ok" || c.validation === "rcl" || c.validation === "dependency" || c.validation === "site-limit");
}

/**
 * 从候选列表中提取永久失败的任务（用于 blocked 记录）。
 * seal（建筑孤岛）属永久失败：除非邻居结构消失，否则永不放行。
 */
export function extractBlockedCandidates(
  candidates: readonly BuildTaskCandidate[],
): BuildTaskCandidate[] {
  return candidates.filter(c => c.validation === "terrain" || c.validation === "occupied" || c.validation === "seal");
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
 * 判断候选格 (x,y) 在运行时是否会被分类为期望的 link 角色。
 *
 * 复用 link-system 运行时的 classifyLinkRole（最近锚获胜，anchorRange=2），
 * 闭合「放置意图」与「运行时分类」之间的裂缝：
 *
 * 病灶 — 当 source 离核心较近（source 与 storage 的 Chebyshev 距离 ≤ 4）时，
 * source 八邻域中某些格到 storage 比到该 source 更近，运行时被 classifyLinkRole
 * 判为 storage 而非 source。放置侧（findAdjacentBuildable）只保证几何相邻、
 * 不保证角色，会把 source link 建在该格上。后果：harvester 的 sourceAdjacentLink
 * 要求 role==="source" 才灌能 → 该 link 永不被灌 → 被 link-system 当成第二个
 * storage link，而 planLinkTransfers 用 find 只取第一个 storage link → 第二个
 * storage link 永久惰化，RCL5 仅有的 2 个 link 槽位被静默浪费一个。
 *
 * 修复 — 放置侧只接受运行时分类与意图一致的格子，从根上消除误分类。
 *
 * anchorRange 取 2，必须与 CONFIG.economy.link.anchorRange 及 classifyLinkRole
 * 默认值保持一致（放置侧为纯函数不访问 CONFIG，此处用字面量，改动需三处同步）。
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
 * W7N3 定位（2026-08-01）：source link 的可喂性校验。
 *
 * 旧放置逻辑只验证「link 贴 source（role=source）+ 可建造」，不验证存在
 * 「可喂站桩格」——一个可走、未占用、同时贴 source（range<=1，能采）与
 * 贴 link（range<=1，能灌）的格。W7N3 source-2 实证：link 放 (39,7) 后两个
 * 双贴格 (38,7)/(39,6) 全是墙，唯一可站格 (37,7) 被 container 占用 →
 * link 建成即死（能量恒 0），harvester 只能倒 container，该 link 占一个
 * RCL 槽位且骗过「紧邻 source 即跳过」逻辑永不补位。
 *
 * 放置侧在生成任务前用本函数过滤候选；运行时 harvest.ts findSourceLinkStand
 * 用同一几何约束，两处口径一致。
 *
 * 容器格例外：harvester 站桩于 source container 之上（range0 倒能），若 link
 * 贴容器（range<=1），容器格即有效站位——occupiedSet 会排除容器格，故单独
 * 传入 containerTiles 放行。
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
 * 为 source 生成 link 任务（RCL5+）。
 * source link 紧邻 source 放置，harvester 采矿后直接 transfer 到 link，
 * 由 link 系统瞬移到 controller/storage link，替代 hauler 长途往返。
 *
 * 队列感知：`queuedLinkCount` 传入当前 BuildQueue 中已有的 link 任务数
 * （含所有角色的 link 任务），防止超额分配 RCL 上限内的 link 槽位。
 *
 * 数量限制：`maxNew` 限制本次调用最多创建的新 source link 数。
 * layout-planner 分两趟调用：第一趟 maxNew=1 保证 storage link 有槽位；
 * 第二趟 maxNew=Infinity 放置剩余 source link。
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
  // 队列中的 link 任务也算占用槽位 — 防止超额分配。
  if (existingLinks + linkSites + queuedLinkCount >= maxLinks) return candidates;

  const remainingSlots = maxLinks - existingLinks - linkSites - queuedLinkCount;
  const limit = Math.min(maxNew, remainingSlots);
  const terrain = room.getTerrain();
  const occupiedSet = options.occupiedSet ?? buildOccupiedSet(snapshot, options.minerals);
  const containerTiles = new Set(snapshot.containers.map(c => packPos(c.pos.x, c.pos.y)));

  for (const source of snapshot.sources) {
    if (candidates.length >= limit) break;
    // W7N3 修复：旧逻辑「紧邻 source 即跳过」会把死 link（无可喂站桩格）也
    // 当成已覆盖 → 错误跳过、死 link 永不被替换。改为按可喂性判定：
    // 已有紧邻 link/site 且存在可喂站桩格 → 跳过；死 link → 继续尝试补位。
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
    // 角色感知选位：只接受运行时分类为 source 的邻格（闭合放置意图与运行时分类）。
    // source 邻近 storage/controller 时，部分邻格会被 classifyLinkRole 判为
    // storage/controller → harvester 拒灌 → 死 link。谓词过滤从根上避免。
    const adjacentPos = findAdjacentBuildable(
      source.pos, room, snapshot, options, linkRolePredicate(snapshot, "source"),
    );
    // 密封守卫：link 是障碍结构，出生即密封或封死邻居的位置不放。
    if (adjacentPos && options.obstacleSet && wouldSeal(adjacentPos.x, adjacentPos.y, room.getTerrain(), options.obstacleSet)) {
      continue;
    }
    // 可喂性守卫：候选 link 必须存在可走、未占用的双贴站桩格（贴 source + 贴 link）。
    // W7N3 source-2 实证：两个双贴格全是墙 → link 建成即死。放置前过滤，防再犯。
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
 * 为 controller 生成 link 任务（RCL5+）。
 * controller link 紧邻 controller 放置，upgrader 站桩 withdraw 取能，
 * 能量由 source link 瞬移送入，实现 0 通勤站桩升级。
 *
 * 队列感知：`queuedLinkCount` 传入当前 BuildQueue 中已有的 link 任务数。
 */
export function createControllerLinkTask(
  snapshot: RoomSnapshot,
  room: Room,
  options: ValidationOptions,
  queuedLinkCount = 0,
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
  if (existingLinks + linkSites + queuedLinkCount >= maxLinks) return undefined;

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
 * 为 storage 生成 link 任务（RCL5+）。
 * storage link 紧邻 storage 放置（range <= 2），作为 link 网络的「最后一公里」：
 * source link 能量瞬移到 storage link，hauler 从 storage link 排空到 storage。
 *
 * 优先级 = 1（与 controller link 同级）：在 RCL5 仅 2 个 link 槽位时，
 * storage link 的优先级高于第二个 source link —— 因为 source + storage
 * 是最小可用 link 网络（source→storage 物流打通），而双 source 无 storage
 * 意味着 link 网络无法卸载能量。
 *
 * 队列感知：`queuedLinkCount` 传入当前 BuildQueue 中已有的 link 任务数。
 */
export function createStorageLinkTask(
  snapshot: RoomSnapshot,
  room: Room,
  options: ValidationOptions,
  queuedLinkCount = 0,
): BuildTaskCandidate | undefined {
  if (snapshot.rcl < 5) return undefined;
  if (!snapshot.storage) return undefined;

  // 检查 storage 附近是否已有 link 或 link 工地。
  if (hasAdjacentStructure(
    snapshot.storage.pos.x,
    snapshot.storage.pos.y,
    snapshot,
    STRUCTURE_LINK,
  )) return undefined;

  const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK]?.[snapshot.rcl] ?? 0;
  const existingLinks = snapshot.links.length;
  const linkSites = snapshot.constructionSites.filter(
    s => s.structureType === STRUCTURE_LINK,
  ).length;
  if (existingLinks + linkSites + queuedLinkCount >= maxLinks) return undefined;

  // 在 storage 附近 1 格内寻找可建造位置（link 不需要站桩位，只需紧邻 storage）。
  // 角色感知：只接受运行时分类为 storage 的邻格（闭合放置意图与运行时分类）。
  const adjacentPos = findAdjacentBuildable(
    snapshot.storage.pos, room, snapshot, options, linkRolePredicate(snapshot, "storage"),
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
    // 优先级 1：与 controller link 同级，高于第二个 source link（priority 2）。
    // layout-planner 在 source(1) 之后、controller 之前调用，保证 RCL5
    // 仅有的 2 个槽位分配为 source + storage。
    priority: 1,
    phase: "late",
    validation: "ok",
  };
}

/**
 * 为 mineral 生成 extractor 任务（RCL6+）。
 *
 * extractor 必须建在 mineral 矿位上——矿位本身就是合法建造点，
 * 因此不走 validateBuildCell 的 occupied 检查（矿会被误判为占用）。
 * 补齐「extractor → harvestMineral → hauler 运回」产业链的第一环。
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
 * 为 mineral 生成 container 任务（RCL6+，需 extractor）。
 *
 * mineral miner 站桩采矿后把矿物倒入此 container，hauler 再搬到 terminal/storage。
 * createSourceContainerTasks 只覆盖 sources、不含 mineral —— 故 mineral container
 * 单列。选位复用 findAdjacentBuildable（mineral 八邻域找非墙非占用格）。
 * priority 3（低于 source container / spawn 等，工业链非生存关键）。
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

  // mineral 旁已有 container 或 site 则不再生成。
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
 * 在目标位置附近寻找可建造位置。
 *
 * 站桩位感知：优先选择「旁边至少有一个可站立格」的位置。
 * harvester/upgrader 站桩时需要站在 container 相邻格，若 container 落在
 * 三面是墙的凹位，站桩 creep 无处站立，退化成每 tick 挪一步。
 * 先收集所有可建造候选，优先返回有站立格的；都没有时回退到任意可建造格。
 *
 * predicate（可选）：候选格的额外准入条件（默认恒真）。link 放置传入
 * linkRolePredicate，只接受运行时角色分类与放置意图一致的格子 —— 闭合
 * 「放置意图」与「运行时分类」的裂缝（详见 linkRoleMatch 注释）。
 * 站立格偏好与回退路径都先经 predicate 过滤，container 等不传 predicate 的
 * 调用方行为完全不变。
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

// ─── 核心预规划道路 ─────────────────────────────────────────

/**
 * 为棋盘格走道生成预规划道路。
 *
 * 老玩家认知：v2 棋盘格中结构在偶校验格，奇校验格是天然走道。
 * 如果等流量采样（100+ tick 窗口 × 2）再铺路，前 200 tick hauler 在 plain 上走
 * （cost 2），效率减半。预规划走道格铺 road 让 hauler 从第一天就 cost 1。
 *
 * 策略：找到所有奇校验格（dx+dy 为奇数），且正交相邻 ≥ 2 个已建/已规划结构位置，
 * 这些格子一定是高频通行路径。生成 priority 3 道路任务（背景建造，不拖慢 RCL 冲刺）。
 *
 * 只在 RCL2+ 生成（至少有第一批 extension 后走道才有意义）。
 * 每周期最多生成 maxRoadsPerCycle 条（避免淹没 buildQueue）。
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

  // 收集当前 RCL 已建/已规划的结构绝对位置（偶校验格）。
  const structurePositions = new Set<number>();
  for (const cell of blueprint.cells) {
    if (cell.minRcl > snapshot.rcl) continue;
    structurePositions.add(packPos(anchorX + cell.dx, anchorY + cell.dy));
  }
  // 加入已有结构位置。
  for (const s of [...snapshot.spawns, ...snapshot.extensions, ...snapshot.towers, ...snapshot.containers, ...snapshot.links]) {
    structurePositions.add(packPos(s.pos.x, s.pos.y));
  }
  if (snapshot.storage) structurePositions.add(packPos(snapshot.storage.pos.x, snapshot.storage.pos.y));

  // 扫描核心区域（±7）内的奇校验格，找正交相邻 ≥ 2 个结构的走道格。
  let generated = 0;
  for (let dx = -7; dx <= 7 && generated < maxRoadsPerCycle; dx++) {
    for (let dy = -7; dy <= 7 && generated < maxRoadsPerCycle; dy++) {
      // 只要奇校验格（走道格）。
      if ((dx + dy) % 2 === 0) continue;

      const x = anchorX + dx;
      const y = anchorY + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (occupiedSet.has(packPos(x, y))) continue;

      // 计算正交相邻（4 方向）的结构数量。
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

// ─── 动态防御工事 ─────────────────────────────────────────

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
  lineLength: 3,
  maxLinesPerCycle: 1,
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
 * 为房间生成防御工事任务（出口走廊封堵线）。
 *
 * 老玩家认知：单个 rampart 不挡路，敌人直接绕过去。
 * 有意义的防御 = 垂直于出口方向的连续 rampart 线（3-5 个），
 * 迫使入侵者必须摧毁或绕路，为 tower 争取 5-10 tick 输出窗口。
 *
 * 策略：
 *   1. 把出口按相对核心的方位归入 8 个扇区
 *   2. 对暴露扇区（出口最多的优先），在 核心 + 方向 × radius 处
 *      沿垂直方向铺设 lineLength 个 rampart
 *   3. 每个 rampart 吸附到最近可建造空格（避免落在墙上）
 *   4. 每周期最多生成 maxLinesPerCycle 条线（不拖慢 RCL 冲刺）
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

  // 暴露扇区按出口数量降序，取前 N 条线。
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

    // 线的中心点：核心 + 出口方向 × radius。
    const centerX = core.pos.x + vec[0] * config.defenseRadius;
    const centerY = core.pos.y + vec[1] * config.defenseRadius;

    // 沿垂直方向铺设 lineLength 个 rampart（居中分布）。
    const halfLen = Math.floor(config.lineLength / 2);
    for (let i = -halfLen; i <= halfLen; i++) {
      const idealX = centerX + perp[0] * i;
      const idealY = centerY + perp[1] * i;

      const pos = findBuildableNear(idealX, idealY, terrain, localOccupied);
      if (!pos) continue;

      // 标记为已占用，防止同线内重复落子。
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
