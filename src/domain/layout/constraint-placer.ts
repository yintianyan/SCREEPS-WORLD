/**
 * 约束推导结构放置 — 替代 compact-core-v2 固定 dx/dy 模板，贪心为每个结构
 * 在候选格中选满足全部约束且评分最高的位置。约束：偶校验棋盘格走道、非墙、
 * 不重叠、不密封、距锚点 ≤ maxRadius、lab 集群相互 range ≤ 2。
 * 放置顺序 spawn > storage > tower > link > terminal > factory > lab > extension
 * （高优先级先占位）；调用方为 layout-planner（每 50 tick 规划）。
 * 纯函数 — 不访问 Game/Memory，输入全参数注入。
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
  /**
   * 密封守卫容忍度（2026-08-01）：type → 允许「正交全堵但斜向可达」。
   * extension 容忍 1：破碎房最后几格正交常被占满、斜向仍可站（transfer 射程 1
   * 含对角），严格正交守卫下 RCL7/8 批次永远放不下 → 静默缺建（W7N3 实证 ext 41/60）。
   */
  readonly sealTolerance?: Readonly<Record<string, number>>;
}

export const DEFAULT_PLACER_CONFIG: PlacerConfig = {
  maxRadius: 7,
  minOpenness: 2,
  sealTolerance: {
    [STRUCTURE_EXTENSION]: 1,
  },
};

/**
 * 自适应搜索半径硬上限：候选池不足时 placeStructures 自动外扩至满足或达此上限。
 * 15 覆盖锚点 ±15（约大半个房间）——再大说明房间过于破碎，应触发缺口告警
 * （placeStructures 末段）而非无限扩搜浪费 CPU。
 */
const MAX_SEARCH_RADIUS = 15;

/** 放置批次（增量：该 RCL 新增的数量）。 */
export interface StructureBatch {
  readonly type: BuildableStructureConstant;
  readonly count: number;
  readonly priority: BuildPriority;
  readonly phase: LayoutPhase;
}

/**
 * 放置策略元数据（2026-08-01 单一真相源改造）：数量一律从 CONTROLLER_STRUCTURES
 * 派生（expectedStructureCounts），本表只留策略（优先级 + 阶段），消灭
 * 「手写数量表 vs 游戏常量」双真相源漂移（旧表必漏 observer/powerSpawn）。
 * 排除类型：link（task-factory 按角色放置）、extractor（必须建在 mineral 格）、
 * road/container/rampart/constructedWall（无限或专用生成器）。
 */
const BUILD_STRATEGY: Readonly<Record<string, {
  readonly priority: (rcl: number) => BuildPriority;
  readonly phaseFor: (rcl: number) => LayoutPhase;
}>> = {
  [STRUCTURE_TOWER]: {
    priority: () => 0,
    // RCL8 解锁 +3（官方上限 6：RCL3+1、RCL5+1、RCL7+1、RCL8+3）。
    phaseFor: r => (r === 3 ? "rcl3" : r === 5 ? "late" : r === 7 ? "rcl7" : "rcl8"),
  },
  [STRUCTURE_STORAGE]: { priority: () => 0, phaseFor: () => "rcl4" },
  [STRUCTURE_EXTENSION]: {
    // 与旧手写表逐级等价：RCL2-4 priority 1，RCL5+ priority 2（早期间歇、后期批量填充）。
    priority: r => (r <= 4 ? 1 : 2),
    phaseFor: r => (r === 5 ? "late" : `rcl${r}` as LayoutPhase),
  },
  [STRUCTURE_SPAWN]: { priority: () => 1, phaseFor: r => `rcl${r}` as LayoutPhase },
  [STRUCTURE_TERMINAL]: { priority: () => 1, phaseFor: () => "rcl6" },
  [STRUCTURE_FACTORY]: { priority: () => 2, phaseFor: () => "rcl7" },
  [STRUCTURE_LAB]: { priority: () => 2, phaseFor: r => `rcl${r}` as LayoutPhase },
  [STRUCTURE_OBSERVER]: { priority: () => 2, phaseFor: () => "rcl8" },
  [STRUCTURE_POWER_SPAWN]: { priority: () => 2, phaseFor: () => "rcl8" },
  // nuker：RCL8 解锁 1，核打击威慑（3×3 结构，与 spawn 同级按单格候选放置）。
  [STRUCTURE_NUKER]: { priority: () => 2, phaseFor: () => "rcl8" },
};

/** constraint 放置器负责的有限数量结构类型（数量真相源 = CONTROLLER_STRUCTURES）。 */
const CONSTRAINT_PLACED_TYPES: readonly BuildableStructureConstant[] = [
  STRUCTURE_SPAWN,
  STRUCTURE_EXTENSION,
  STRUCTURE_TOWER,
  STRUCTURE_STORAGE,
  STRUCTURE_LAB,
  STRUCTURE_TERMINAL,
  STRUCTURE_FACTORY,
  STRUCTURE_OBSERVER,
  STRUCTURE_POWER_SPAWN,
  STRUCTURE_NUKER,
];

/**
 * 每个 RCL 应有的结构数量（累计，单一真相源 = CONTROLLER_STRUCTURES）。
 * 仅覆盖 constraint 放置器负责的类型；link/extractor/道路/防御由各自生成器负责。
 */
export function expectedStructureCounts(rcl: number): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const type of CONSTRAINT_PLACED_TYPES) {
    const table = CONTROLLER_STRUCTURES[type];
    result[type] = table?.[rcl] ?? 0;
  }
  return result;
}

/**
 * RCL2..rcl 增量批次（2026-08-01 派生版，替代手写 RCL_BATCHES）：
 * 增量 = target(rcl) - target(rcl-1)，数量与旧表严格等价，补齐 observer/
 * powerSpawn（RCL8 解锁 1）；策略（priority/phase）来自 BUILD_STRATEGY。
 */
export function buildRclBatches(rcl: number): StructureBatch[] {
  const batches: StructureBatch[] = [];
  let prev: Readonly<Record<string, number>> = {};
  for (let r = 2; r <= rcl; r++) {
    const current = { ...expectedStructureCounts(r) };
    // 锚点 spawn（玩家/扩张放置）不在派生批次内：批次计数扣除 1，
    // 从第 2 个 spawn 开始派生 — 与旧手写表（RCL7 +1、RCL8 +1）等价。
    if ((current[STRUCTURE_SPAWN] ?? 0) > 0) {
      current[STRUCTURE_SPAWN] = (current[STRUCTURE_SPAWN] ?? 0) - 1;
    }
    for (const type of CONSTRAINT_PLACED_TYPES) {
      const delta = (current[type] ?? 0) - (prev[type] ?? 0);
      if (delta <= 0) continue;
      const strategy = BUILD_STRATEGY[type];
      if (!strategy) continue;
      batches.push({
        type,
        count: delta,
        priority: strategy.priority(r),
        phase: strategy.phaseFor(r),
      });
    }
    prev = current;
  }
  return batches;
}

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
 * 预计算候选格列表 — 偶校验、边界内、非墙、开放度 ≥ minOpenness，按评分降序。
 * 评分 = openness × 2 - distFromAnchor - energyPenalty：走道越多越好；离核心越近
 * （减少 hauler 通勤）；离能量端点越近越差 — 让 storage/link 等物流结构优先落在
 * 能量流转路径附近。energyEndpoints 为空时退化为纯几何评分（向后兼容）。
 */
/** @internal 导出仅供单测验证 P2-N 增量与全量等价性。 */
export function buildCandidateGrid(
  anchor: { x: number; y: number },
  field: DistanceField,
  getTerrain: (x: number, y: number) => boolean,
  config: PlacerConfig,
  energyEndpoints: readonly { x: number; y: number }[] = [],
  prevCandidates?: readonly CandidateTile[],
  prevRadius?: number,
): CandidateTile[] {
  const { maxRadius, minOpenness } = config;

  // P2-N：增量模式 — prevCandidates 与 prevRadius 提供 且 maxRadius == prevRadius+1。
  const useIncremental = prevCandidates !== undefined && prevRadius !== undefined && maxRadius === prevRadius + 1;

  const scoreTile = (dx: number, dy: number): CandidateTile | undefined => {
    const x = anchor.x + dx;
    const y = anchor.y + dy;
    if (x < 2 || x > 47 || y < 2 || y > 47) return undefined;
    if (getTerrain(x, y)) return undefined;
    const openness = opennessAt(field, x, y);
    if (openness < minOpenness) return undefined;
    const dist = Math.abs(dx) + Math.abs(dy);
    let energyPenalty = 0;
    if (energyEndpoints.length > 0) {
      let minEnergyDist = Infinity;
      for (const ep of energyEndpoints) {
        const d = Math.abs(ep.x - x) + Math.abs(ep.y - y);
        if (d < minEnergyDist) minEnergyDist = d;
      }
      energyPenalty = minEnergyDist * 0.5;
    }
    return { x, y, score: openness * 2 - dist - energyPenalty };
  };

  // P2-N：确定性 tiebreaker 保证增量与全量等价 — 全量输入序为扫描序、增量输入序为
  // 「prev 排序序 + 新环带序」，同分元素最终顺序不同；加 (x,y) 升序兜底后两者严格
  // 相等（全量路径本就 x/y 升序，无回归），附带代际稳定性提升。
  const sortByScore = (a: CandidateTile, b: CandidateTile): number => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  };

  if (useIncremental) {
    // 增量：只评分新环带格（|dx| 或 |dy| == maxRadius），与 prev 合并后重排序。
    const candidates: CandidateTile[] = [...prevCandidates!];
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      for (let dy = -maxRadius; dy <= maxRadius; dy++) {
        if (((dx + dy) % 2 + 2) % 2 !== 0) continue;
        if (Math.abs(dx) !== maxRadius && Math.abs(dy) !== maxRadius) continue;
        const tile = scoreTile(dx, dy);
        if (tile) candidates.push(tile);
      }
    }
    candidates.sort(sortByScore);
    return candidates;
  }

  const candidates: CandidateTile[] = [];

  for (let dx = -maxRadius; dx <= maxRadius; dx++) {
    for (let dy = -maxRadius; dy <= maxRadius; dy++) {
      // 偶校验（棋盘格不变量）
      if (((dx + dy) % 2 + 2) % 2 !== 0) continue;
      const tile = scoreTile(dx, dy);
      if (tile) candidates.push(tile);
    }
  }

  candidates.sort(sortByScore);
  return candidates;
}

/**
 * 轻量版 wouldSeal：自身 4 正交邻居是否 ≥1 可站格
 * （完整版在 validation.ts，此处避免循环依赖）。
 */
function wouldSealLocal(
  x: number,
  y: number,
  getTerrain: (x: number, y: number) => boolean,
  occupied: ReadonlySet<number>,
  tolerance = 0,
): boolean {
  const orthogonal: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of orthogonal) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
    if (getTerrain(nx, ny)) continue;
    if (occupied.has(packPos(nx, ny))) continue;
    return false; // 找到可站格
  }
  // 容忍度分级（2026-08-01）：tolerance > 0 允许「正交全堵但斜向可达」— 斜向距离
  // = transfer 射程 1（Chebyshev），严格正交守卫会让破碎房 RCL7/8 批次放不满（W7N3 实证）。
  if (tolerance > 0) {
    const diagonal: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of diagonal) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
      if (getTerrain(nx, ny)) continue;
      if (occupied.has(packPos(nx, ny))) continue;
      return false; // 斜向可站 — 放行
    }
  }
  return true; // 密封
}

/**
 * lab 集群放置：找相互 Chebyshev ≤ 2 的 trio；count > 3 时续接既有集群。
 * @returns 找到的位置列表（可能少于 count）
 */
function placeLabCluster(
  count: number,
  candidates: readonly CandidateTile[],
  occupied: Set<number>,
  getTerrain: (x: number, y: number) => boolean,
  existingLabs: readonly { x: number; y: number }[],
  terminalPos?: { x: number; y: number },
): { x: number; y: number }[] {
  const placed: { x: number; y: number }[] = [...existingLabs];
  const result: { x: number; y: number }[] = [];

  // 首批 lab 锚定 terminal（2026-08-02）：第一批 lab 时 existingLabs 为空，
  // 通用评分会把集群落在 anchor 高分侧、与后建的 terminal 分离（W8N3 实证
  // lab-terminal 均值 9.3）；有 terminal 时首个 lab 优先落其邻域（≤3）。
  // 老房（已有 lab）行为零变化。
  if (placed.length === 0 && terminalPos) {
    const terminalCandidates = candidates.filter(
      c => Math.abs(c.x - terminalPos.x) + Math.abs(c.y - terminalPos.y) <= 3,
    );
    for (const c of terminalCandidates) {
      const packed = packPos(c.x, c.y);
      if (occupied.has(packed)) continue;
      if (wouldSealLocal(c.x, c.y, getTerrain, occupied)) continue;
      placed.push({ x: c.x, y: c.y });
      result.push({ x: c.x, y: c.y });
      occupied.add(packed);
      break; // 仅首个 lab 锚定
    }
  }

  // 降级阶梯（2026-08-01）：既有集群 2 格内无可建格时缺口永久挂起（W7N3 lab 4/10），
  // 按级放宽：≤2（反应 trio 契约）→ ≤3（宽松续接）→ 自由放置（仅密封守卫，单 lab
  // 可做矿物研究）。上级放不满才降级；开阔地形首级即放满，行为与旧实现一致。
  const maxRanges: number[] = [2, 3, Infinity];
  for (const maxRange of maxRanges) {
    if (result.length >= count) break;
    for (let i = result.length; i < count; i++) {
      let found = false;
      for (const c of candidates) {
        const packed = packPos(c.x, c.y);
        if (occupied.has(packed)) continue;
        if (wouldSealLocal(c.x, c.y, getTerrain, occupied)) continue;

        // Chebyshev 距离约束（自由放置级跳过）。
        if (placed.length > 0 && isFinite(maxRange)) {
          const inRange = placed.some(
            l => Math.max(Math.abs(l.x - c.x), Math.abs(l.y - c.y)) <= maxRange,
          );
          if (!inRange) continue;
        }

        placed.push({ x: c.x, y: c.y });
        result.push({ x: c.x, y: c.y });
        occupied.add(packed);
        found = true;
        break;
      }
      if (!found) break; // 本级放不满 → 降级到下一级
    }
  }

  return result;
}

/**
 * Tower 分桶配额 — 按 RCL 阶段分配 controller 侧 / anchor 侧数量：
 * RCL3 通用池（openness 倾向 anchor 侧）、RCL5/7 全 controller、RCL8 1 controller + 2 anchor
 * （累计 3 anchor + 3 controller）。
 * 硬约束（docs §3.7）：RCL5/7 至少 1 塔 anchor Chebyshev ≤ 5（RCL3 塔满足），
 * RCL8 至少 2 塔（本批次 2 anchor 塔满足）。桶放不满时剩余走通用池，避免静默缺塔。
 * @returns controller 桶 + anchor 桶配额（剩余走通用池）
 */
function towerBucketQuota(
  phase: LayoutPhase,
  need: number,
): { controller: number; anchor: number } {
  switch (phase) {
    case "late": // RCL5/7：全 controller
    case "rcl7":
      return { controller: need, anchor: 0 };
    case "rcl8": // RCL8：1 controller + 2 anchor（§3.7 至少 2 anchor ≤ 5）
      return { controller: Math.min(1, need), anchor: Math.max(0, need - 1) };
    default: // rcl3 等：通用池（openness 评分倾向 anchor 侧）
      return { controller: 0, anchor: 0 };
  }
}

/**
 * Tower 分桶放置：controller 桶（距 controller 每 15 格分桶，落在射程高效区 —
 * 官方衰减 20 格起降至最低 25% 伤害）→ anchor 桶（Chebyshev ≤ 5 硬约束，降级 ≤ 7）
 * → 通用池兜底（candidates 原序）。桶间经 occupied 集合互斥选格。
 * @returns 可能少于 need（缺口告警兜底）
 */
function placeTowerBuckets(
  need: number,
  phase: LayoutPhase,
  candidates: readonly CandidateTile[],
  occupied: Set<number>,
  getTerrain: (x: number, y: number) => boolean,
  anchor: { x: number; y: number },
  controllerPos: { x: number; y: number },
  sealTolerance: number,
): { x: number; y: number }[] {
  const quota = towerBucketQuota(phase, need);
  const result: { x: number; y: number }[] = [];

  /** 从给定候选池中放置 n 个塔，跳过已占/密封格。 */
  const tryPlace = (pool: readonly CandidateTile[], n: number): number => {
    let placed = 0;
    for (const c of pool) {
      if (placed >= n) break;
      const packed = packPos(c.x, c.y);
      if (occupied.has(packed)) continue;
      if (wouldSealLocal(c.x, c.y, getTerrain, occupied, sealTolerance)) continue;
      occupied.add(packed);
      result.push({ x: c.x, y: c.y });
      placed++;
    }
    return placed;
  };

  // 1. controller 桶：距 controller 每 15 格分桶，近桶优先
  if (quota.controller > 0) {
    const controllerSorted = [...candidates].sort((a, b) => {
      const bucketOf = (c: CandidateTile): number =>
        Math.floor(
          (Math.abs(c.x - controllerPos.x) + Math.abs(c.y - controllerPos.y)) / 15,
        );
      return (bucketOf(a) - bucketOf(b)) || (b.score - a.score) || a.x - b.x || a.y - b.y;
    });
    tryPlace(controllerSorted, quota.controller);
  }

  // 2. anchor 桶：Chebyshev ≤ 5 硬约束（降级 ≤ 7）
  if (quota.anchor > 0) {
    const chebyshev = (c: CandidateTile): number =>
      Math.max(Math.abs(c.x - anchor.x), Math.abs(c.y - anchor.y));
    const sortByScore = (a: CandidateTile, b: CandidateTile): number =>
      (b.score - a.score) || a.x - b.x || a.y - b.y;
    // 紧桶（≤5）
    const tightPool = candidates.filter(c => chebyshev(c) <= 5).sort(sortByScore);
    const placed = tryPlace(tightPool, quota.anchor);
    // 降级：≤5 不足时放宽到 ≤7（排除已尝试的 ≤5）
    if (placed < quota.anchor) {
      const relaxedPool = candidates
        .filter(c => chebyshev(c) > 5 && chebyshev(c) <= 7)
        .sort(sortByScore);
      tryPlace(relaxedPool, quota.anchor - placed);
    }
  }

  // 3. 通用池兜底：剩余 need 按 candidates 原序
  const remaining = need - result.length;
  if (remaining > 0) {
    tryPlace(candidates, remaining);
  }

  return result;
}

/**
 * 约束推导放置主入口 — 为 RCL2..rcl 累计放置所有结构，返回结果由调用方转 BuildTask。
 * @param committed 各类型承诺数量（已建 + site + 队列任务），按批次抵扣，
 *   只为真实缺口生成放置（代际稳定性核心）
 * @param energyEndpoints 能量端点（source/controller）评分加权；缺省退化纯几何
 * @param existingLabPositions 已建 lab — 新增 lab 续接既有集群
 * @param roomName 仅用于放置缺口告警日志定位
 * @param controllerPos tower 分桶：RCL5+ 按距 controller 每 15 格分桶落在射程高效区
 *   （官方衰减 20 格起 25% 伤害）；RCL8 强制至少 2 塔 anchor Chebyshev ≤ 5（降级 ≤ 7）
 * @param terminalPos lab 首批锚定：第一个 lab 落 terminal 邻域（≤3）
 */
export function placeStructures(
  anchor: { x: number; y: number },
  field: DistanceField,
  getTerrain: (x: number, y: number) => boolean,
  rcl: number,
  preOccupied: ReadonlySet<number>,
  committed: ReadonlyMap<string, number>,
  config: PlacerConfig = DEFAULT_PLACER_CONFIG,
  energyEndpoints: readonly { x: number; y: number }[] = [],
  existingLabPositions: readonly { x: number; y: number }[] = [],
  roomName?: string,
  controllerPos?: { x: number; y: number },
  terminalPos?: { x: number; y: number },
  diagnostics?: (shortfalls: readonly { type: string; needed: number; placed: number; roomName?: string }[]) => void,
): ConstraintPlacement[] {
  // ── 自适应搜索半径 ──
  // 固定 maxRadius=7 候选池在多墙 + RCL7-8 高密度下会被密封守卫耗尽 → 静默少放。
  // 旧实现仅「池容量 < 需求」时外扩，但存在「池够大、格全不可放」的破碎房
  // （W7N3：r7 池 53 ≥ 需求 31，全被排除）永不触发 → 缺口永远闭合不了。
  // 现改为「一轮放置后仍有缺口 → 外扩重试」至 MAX_SEARCH_RADIUS；开阔地形
  // 首轮即放满，行为与旧实现一致。P2-N 增量外扩只评分新环带格，与全量等价。
  let effectiveRadius = config.maxRadius;
  let candidates = buildCandidateGrid(anchor, field, getTerrain, { ...config, maxRadius: effectiveRadius }, energyEndpoints);

  const occupied = new Set<number>(preOccupied);
  // 锚点格被 spawn 占用
  occupied.add(packPos(anchor.x, anchor.y));

  const placements: ConstraintPlacement[] = [];
  // Lab 续接：既有 lab 为集群种子 — 新增 lab 必须落在集群 range≤2 内，
  // 否则反应 trio 相邻约束被代际漂移破坏。
  const labPositions: { x: number; y: number }[] = [...existingLabPositions];

  // 承诺抵扣（代际稳定性核心）：已建 + site + 队列覆盖的数量不再生成放置 —
  // 旧实现全量重排、顺延次优格，产生幽灵任务与代际位置漂移。
  const remaining: Record<string, number> = {};
  for (const [type, n] of committed) remaining[type] = n;
  // 锚点 spawn（玩家/扩张放置）不在派生批次内 — 承诺扣除 1，避免误抵扣 RCL7/8 的 spawn #2/#3。
  if ((remaining[STRUCTURE_SPAWN] ?? 0) > 0) {
    remaining[STRUCTURE_SPAWN]! -= 1;
  }
  // 收集 RCL 批次并按放置优先级排序。
  const batches = buildRclBatches(rcl);
  batches.sort((a, b) => (TYPE_PLACE_ORDER[a.type] ?? 99) - (TYPE_PLACE_ORDER[b.type] ?? 99));

  // 真实缺口（按类型累计）：逐批次抵扣 ≡ 按类型总量抵扣（同类型合计后扣承诺，
  // 顺序无影响），与旧 deductBatch 语义逐级等价（含 spawn 锚点豁免）。
  const batchTotalByType = new Map<string, number>();
  for (const b of batches) {
    batchTotalByType.set(b.type, (batchTotalByType.get(b.type) ?? 0) + b.count);
  }
  const residualNeedByType = new Map<string, number>();
  for (const [type, total] of batchTotalByType) {
    const need = Math.max(0, total - (remaining[type] ?? 0));
    if (need > 0) residualNeedByType.set(type, need);
  }
  const placedByType = new Map<string, number>();

  // ── 放置主循环（含扩搜重试）──
  for (;;) {
    for (const batch of batches) {
      const { type, priority, phase } = batch;
      // 批次级份额 = min(本批 count, 类型总缺口 - 已放)：直接用「总缺口 - 已放」
      // 会让每类型只有首个批次在放置，后续批次的 priority/phase 全丢（tower 全变 rcl3 相位）。
      const need = Math.min(
        batch.count,
        Math.max(0, (residualNeedByType.get(type) ?? 0) - (placedByType.get(type) ?? 0)),
      );
      if (need <= 0) continue;

      // Lab：集群放置
      if (type === STRUCTURE_LAB) {
        const labResult = placeLabCluster(need, candidates, occupied, getTerrain, labPositions, terminalPos);
        for (const pos of labResult) {
          labPositions.push(pos);
          placements.push({
            key: placementKey(type, pos.x, pos.y),
            pos,
            structureType: type,
            priority,
            phase,
          });
        }
        placedByType.set(type, (placedByType.get(type) ?? 0) + labResult.length);
        continue;
      }

      // Tower：分桶放置（§3.7：RCL5+ controller 分桶，RCL8 至少 2 塔 anchor ≤ 5）；
      // 无 controllerPos 时退化为通用池（向后兼容）。
      if (type === STRUCTURE_TOWER && controllerPos) {
        const towerResult = placeTowerBuckets(
          need, phase, candidates, occupied, getTerrain, anchor, controllerPos,
          config.sealTolerance?.[type] ?? 0,
        );
        for (const pos of towerResult) {
          placements.push({
            key: placementKey(type, pos.x, pos.y),
            pos,
            structureType: type,
            priority,
            phase,
          });
        }
        placedByType.set(type, (placedByType.get(type) ?? 0) + towerResult.length);
        continue;
      }

      let placed = 0;
      for (const c of candidates) {
        if (placed >= need) break;
        const packed = packPos(c.x, c.y);
        if (occupied.has(packed)) continue;

        // 密封守卫（障碍结构）
        const isObstacle = type !== STRUCTURE_ROAD && type !== STRUCTURE_CONTAINER;
        if (isObstacle && wouldSealLocal(
          c.x, c.y, getTerrain, occupied, config.sealTolerance?.[type] ?? 0,
        )) continue;

        occupied.add(packed);
        placements.push({
          key: placementKey(type, c.x, c.y),
          pos: { x: c.x, y: c.y },
          structureType: type,
          priority,
          phase,
        });
        placed++;
      }
      placedByType.set(type, (placedByType.get(type) ?? 0) + placed);
    }

    // 仍有缺口且半径未穷尽 → 外扩重试。
    let remainingNeed = 0;
    for (const [type, need] of residualNeedByType) {
      remainingNeed += Math.max(0, need - (placedByType.get(type) ?? 0));
    }
    if (remainingNeed === 0 || effectiveRadius >= MAX_SEARCH_RADIUS) break;
    effectiveRadius++;
    candidates = buildCandidateGrid(
      anchor, field, getTerrain, { ...config, maxRadius: effectiveRadius }, energyEndpoints,
      candidates, effectiveRadius - 1,
    );
  }

  // ── 放置缺口可观测性 ──
  // 根治静默少放：按类型对比真实缺口与实际放置，缺口即告警（半径已穷尽 → 地形
  // 过于破碎，需人工介入：换锚点 / 接受降级 / 手动规划）。频率 = 规划频率（50 tick）。
  // 【G-J 合规】domain 不触 console：缺口以数据回调交由 systems 层记录。
  const shortfalls: { type: string; needed: number; placed: number; roomName?: string }[] = [];
  for (const [type, needed] of residualNeedByType) {
    const placedCount = placedByType.get(type) ?? 0;
    if (placedCount < needed) {
      shortfalls.push({ type, needed, placed: placedCount, roomName });
    }
  }
  if (shortfalls.length > 0 && diagnostics) {
    diagnostics(shortfalls);
  }

  return placements;
}

/**
 * 放置 key — 坐标绑定 `constraint.<type>.<x>.<y>`：同一格永远同 key，重推导天然
 * 幂等（旧递增计数器 key 随贪心顺延漂移，去重/黑名单/done 判定全部失锚）。
 */
function placementKey(type: string, x: number, y: number): string {
  return `constraint.${type}.${x}.${y}`;
}

/**
 * ConstraintPlacement → BuildTaskCandidate（兼容入队流程）；
 * validation 一律 "ok"（放置算法已保证合法性）。
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
