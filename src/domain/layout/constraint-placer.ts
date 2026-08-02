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
  /**
   * 密封守卫容忍度（2026-08-01）：type → 是否允许「正交全堵但斜向可达」。
   * 默认 0（严格正交守卫，旧语义）。extension 容忍 1：破碎房（anchorScore 低）
   * 最后几格正交常被邻居占满、斜向仍可站（transfer 射程 1 含对角），
   * 严格正交守卫下 RCL7/8 批次永远放不下 → 静默缺建（W7N3 实证：ext 41/60）。
   * 斜向可站保留填充/维修可达性，能量容量收益 > 正交美观损失。
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
 * 自适应搜索半径的硬上限。
 *
 * 默认 maxRadius=7 对齐 compact-core-v2 的 ±6 外环；当受限地形（多墙）下
 * 候选池不足以容纳所需结构时，placeStructures 自动外扩搜索半径直到满足或达此上限。
 * 15 覆盖锚点 ±15 的 31×31 区域（约大半个房间）——再大说明房间本身过于破碎，
 * 应触发缺口告警（见 placeStructures 末段）而非无限扩搜浪费 CPU。
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
 * 放置策略元数据（2026-08-01 单一真相源改造）。
 *
 * 数量一律从 CONTROLLER_STRUCTURES 派生（expectedStructureCounts），本表只保留
 * 策略信息（优先级 + 阶段），消灭「手写数量表 vs 游戏常量」双真相源漂移
 * （漏 observer/powerSpawn 即旧手写表的必然结果）。
 *
 * 明确排除的类型：
 *   - link：task-factory 按角色放置（source/storage/controller）
 *   - extractor：必须建在 mineral 格上，非自由放置
 *   - road/container/rampart/constructedWall：无限或防御/物流专用生成器
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
    // 旧手写表：RCL2-4 priority 1，RCL5+ priority 2（早期间歇性建造，
    // 后期批量填充）。数量派生后策略档位也必须与旧行为逐级等价。
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
 * 生成 RCL2..rcl 的增量放置批次（2026-08-01 派生版，替代手写 RCL_BATCHES）。
 *
 * 增量 = target(rcl) - target(rcl-1)；数量与旧手写表严格等价，额外补齐
 * observer/powerSpawn（RCL8 解锁 1）。策略（priority/phase）来自 BUILD_STRATEGY。
 */
export function buildRclBatches(rcl: number): StructureBatch[] {
  const batches: StructureBatch[] = [];
  let prev: Readonly<Record<string, number>> = {};
  for (let r = 2; r <= rcl; r++) {
    const current = { ...expectedStructureCounts(r) };
    // 锚点 spawn 豁免：CONTROLLER_STRUCTURES 的 spawn 计数包含玩家/扩张
    // 放置的锚点 spawn（不占批次），批次从第 2 个 spawn 开始派生 —
    // 与旧手写表（RCL7 +1、RCL8 +1）逐级等价。
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

  // 候选格评分函数（提取避免增量/全量两份重复逻辑）。
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

  // P2-N：排序需确定性 tiebreaker — 同分元素按 (x,y) 升序兜底。
  // 原因：JS 稳定排序保留输入序，但全量路径输入序为扫描序（dx/dy 升序），
  // 增量路径输入序为「prev 排序序 + 新环带扫描序」，两者对同分元素产生不同
  // 最终顺序 → 增量与全量不等价。加 (x,y) tiebreaker 后：
  //   1) 全量路径扫描序本身就是 x/y 升序，tiebreaker 与之完全一致 → 无回归
  //   2) 增量路径同分元素被强制对齐到 (x,y) 序 → 与全量严格相等
  // 附带收益：代际稳定性提升 — 同分候选不再受输入顺序漂移影响。
  const sortByScore = (a: CandidateTile, b: CandidateTile): number => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  };

  if (useIncremental) {
    // 增量：复制 prev 候选，只评分新环带格（|dx| 或 |dy| == maxRadius），合并后重排序。
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
 * 检查在 (x,y) 放置障碍结构是否会密封。
 * 简化版 wouldSeal：检查自身 4 正交邻居中是否有 >= 1 个可站格。
 * （完整 wouldSeal 在 validation.ts 中，这里用轻量版避免循环依赖。）
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
    return false; // 找到可站格，不密封（旧语义快速路径）
  }
  // 容忍度分级（2026-08-01）：tolerance > 0 的类型允许「正交全堵但斜向可达」。
  // 斜向距离 = transfer 射程 1（Chebyshev），creep 仍可站在对角格填充/维修 —
  // 严格正交守卫会拒绝这些格，破碎房 RCL7/8 批次永远放不满（W7N3 实证）。
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
  return true; // 正交与斜向均无可站格 — 密封
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
  terminalPos?: { x: number; y: number },
): { x: number; y: number }[] {
  const placed: { x: number; y: number }[] = [...existingLabs];
  const result: { x: number; y: number }[] = [];

  // 首批 lab 锚定 terminal（2026-08-02）：RCL6 第一批 lab 时 existingLabs
  // 为空，第一个 lab 按通用评分落在 anchor 高分侧，terminal 后建 → lab
  // 集群与物流枢纽分离（W8N3 实证：lab-terminal 均值 9.3）。有 terminal
  // 时，第一个 lab 优先落在 terminal 邻域（<=3），后续 lab 续接该集群 —
  // 老房（已有 lab）行为零变化，未来房 lab 从出生就贴物流枢纽。
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
      break; // 只锚定第一个 lab
    }
  }

  // 降级阶梯（2026-08-01）：破碎房（W7N3 lab 4/10）在既有 lab 集群 2 格内
  // 已无可建格时，缺口永久挂起。按级放宽：
  //   level 0：与既有 lab Chebyshev <= 2（反应 trio 契约，默认不变）
  //   level 1：<= 3（宽松续接，仍保持集群连通）
  //   level 2：自由放置（仅密封守卫；单 lab 可做矿物研究，优于永久缺口）
  // 上级放不满才降级；开阔地形首级即放满，行为与旧实现完全一致。
  const maxRanges: number[] = [2, 3, Infinity];
  for (const maxRange of maxRanges) {
    if (result.length >= count) break;
    for (let i = result.length; i < count; i++) {
      let found = false;
      for (const c of candidates) {
        const packed = packPos(c.x, c.y);
        if (occupied.has(packed)) continue;
        if (wouldSealLocal(c.x, c.y, getTerrain, occupied)) continue;

        // 与已有 lab 的 Chebyshev 距离约束（自由放置级跳过）。
        if (placed.length > 0 && isFinite(maxRange)) {
          const inRange = placed.some(
            l => Math.max(Math.abs(l.x - c.x), Math.abs(l.y - c.y)) <= maxRange,
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
      if (!found) break; // 本级放不满 → 降级到下一级
    }
  }

  return result;
}

/**
 * Tower 分桶配额 — 按 RCL 阶段决定 controller 侧 / anchor 侧配额。
 *
 * 设计目标（docs/layout-system-design-2026-08.md §3.7）：
 *   RCL3 (+1)：通用池（openness 评分倾向 anchor 侧）→ 1 anchor 塔
 *   RCL5 (+1)：全 controller 桶 → 1 controller 塔（累计 1 anchor + 1 controller）
 *   RCL7 (+1)：全 controller 桶 → 1 controller 塔（累计 1 anchor + 2 controller）
 *   RCL8 (+3)：1 controller + 2 anchor（累计 3 anchor + 3 controller）
 *
 * 硬约束（docs §3.7）：
 *   RCL5/7：至少 1 塔 anchor Chebyshev ≤ 5（由 RCL3 塔满足）
 *   RCL8：至少 2 塔 anchor Chebyshev ≤ 5（由 RCL8 批次的 2 anchor 塔满足）
 *
 * 通用池兜底：当 controller 桶或 anchor 桶因地形受限放不满时，
 * 剩余 need 走通用池（按 openness 评分），避免静默缺塔。
 *
 * @param phase 批次相位
 * @param need 本批次需放置数量
 * @returns controller 桶配额 + anchor 桶配额（剩余走通用池）
 */
function towerBucketQuota(
  phase: LayoutPhase,
  need: number,
): { controller: number; anchor: number } {
  switch (phase) {
    case "late": // RCL5：全 controller
    case "rcl7": // RCL7：全 controller
      return { controller: need, anchor: 0 };
    case "rcl8": // RCL8：1 controller + 2 anchor（硬约束至少 2 anchor ≤ 5）
      return { controller: Math.min(1, need), anchor: Math.max(0, need - 1) };
    default: // rcl3 等：通用池（openness 评分倾向 anchor 侧）
      return { controller: 0, anchor: 0 };
  }
}

/**
 * Tower 分桶放置 — controller 侧 + anchor 侧硬约束 + 通用池兜底。
 *
 * 三阶段放置（docs/layout-system-design-2026-08.md §3.7）：
 *   1. controller 桶：按距 controller 每 15 格分桶排序，优先落在 controller 射程高效区
 *      （官方衰减：20 格起降至最低 25% 伤害）
 *   2. anchor 桶：Chebyshev(anchor) ≤ 5 硬约束；≤ 5 候选不足时降级 ≤ 7；
 *      再不足走通用池。保证核心防御覆盖。
 *   3. 通用池兜底：剩余 need 按 candidates 原序（openness 评分降序）放置。
 *
 * 候选格被占用后从 occupied 集合排除，避免 controller 桶与 anchor 桶选同一格。
 *
 * @returns 放置位置列表（可能少于 need，由缺口告警机制兜底）
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

  // 1. controller 桶：按距 controller 每 15 格分桶排序（近桶优先）
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
    // 紧桶：≤ 5
    const tightPool = candidates.filter(c => chebyshev(c) <= 5).sort(sortByScore);
    const placed = tryPlace(tightPool, quota.anchor);
    // 降级：≤ 5 不够时放宽到 ≤ 7（排除已尝试的 ≤ 5）
    if (placed < quota.anchor) {
      const relaxedPool = candidates
        .filter(c => chebyshev(c) > 5 && chebyshev(c) <= 7)
        .sort(sortByScore);
      tryPlace(relaxedPool, quota.anchor - placed);
    }
  }

  // 3. 通用池兜底：剩余 need 按 candidates 原序放置
  const remaining = need - result.length;
  if (remaining > 0) {
    tryPlace(candidates, remaining);
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
 * @param committed 各结构类型的承诺数量（已建 + 在建 site + 队列任务）—
 *   放置时按批次抵扣，只为真实缺口生成放置（代际稳定性核心）。
 * @param config 放置配置（可选，缺省用 DEFAULT_PLACER_CONFIG）。
 * @param energyEndpoints 能量端点位置（source/controller），用于评分加权。
 *   传入时结构放置偏好靠近能量流转路径；不传时退化为纯几何评分。
 * @param existingLabPositions 已建 lab 位置 — 新增 lab 续接既有集群（相邻约束）。
 * @param roomName 房间名（可选）— 仅用于放置缺口告警日志定位，不影响放置逻辑。
 * @param controllerPos controller 位置（可选）— tower 分桶放置：RCL5+ 批次
 *   按「距 controller 每 15 格分桶」优先落在 controller 射程高效区
 *   （官方衰减：20 格起降至最低 25% 伤害）；RCL8 批次额外强制至少 2 塔
 *   anchor Chebyshev ≤ 5（核心防御覆盖硬约束，降级 ≤ 7）。
 * @param terminalPos terminal 位置（可选）— lab 首批锚定：RCL6 第一批
 *   lab 落在 terminal 邻域（<=3），集群与物流枢纽共生。
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
): ConstraintPlacement[] {
  // ── 自适应搜索半径 ──
  // 默认 maxRadius=7 的固定候选池在多墙地形 + RCL7-8 高密度（需 ~80 结构）下
  // 会被耗尽：wouldSealLocal 密封守卫随已建结构增多越来越严，固定池里通过密封
  // 守卫的格不够放满全部批次 → 静默少放（尤其最低优先级的 extension，池再小
  // 连 spawn/tower/lab 也会缺）。
  //
  // 2026-08-01 扩搜条件修复：旧实现只在「候选池容量 < 需求总数」时外扩 —
  // 但 W7N3 实证存在「池够大、格全不可放」的破碎房：r7 池 53 格 ≥ 需求 31，
  // 全部被已有结构/密封守卫排除（开阔区在 r7 外），永不触发扩搜 → 每规划
  // 周期空转 0 放置，19 ext/6 lab/3 tower 缺口永远闭合不了。
  // 现改为「一轮放置后仍有缺口 → 外扩重试」（上限 MAX_SEARCH_RADIUS），
  // 直到放满或半径穷尽。开阔地形首轮即放满，行为与旧实现完全一致。
  // P2-N 增量外扩保留：buildCandidateGrid 传 prevCandidates + prevRadius，
  // 只评分新环带格，结果与全量等价（(x,y) tiebreaker 确定性总序）。
  let effectiveRadius = config.maxRadius;
  let candidates = buildCandidateGrid(anchor, field, getTerrain, { ...config, maxRadius: effectiveRadius }, energyEndpoints);

  const occupied = new Set<number>(preOccupied);
  // 锚点本身被 spawn 占用
  occupied.add(packPos(anchor.x, anchor.y));

  const placements: ConstraintPlacement[] = [];
  // Lab 集群续接：已建 lab 位置作为集群种子 — 抵扣后新增的 lab
  // 必须落在既有集群 range<=2 内，否则反应 trio 相邻约束被代际漂移破坏。
  const labPositions: { x: number; y: number }[] = [...existingLabPositions];

  // 承诺抵扣（代际稳定性核心）：已建结构 + 在建 site + 队列任务
  // 已经覆盖的数量不再生成放置。旧实现每周期放置 RCL 累计全量、
  // 只跳过被占格子 — 已建结构把自己的格子占掉后，放置顺延到次优格，
  // 产生「同一逻辑结构在新格子再排一次」的幽灵任务与代际位置漂移。
  const remaining: Record<string, number> = {};
  for (const [type, n] of committed) remaining[type] = n;
  // 初始 spawn（锚点位）由玩家/扩张放置，不在派生批次内（锚点豁免）—
  // 从 spawn 承诺中扣除 1，避免误抵扣掉 RCL7/8 批次的 spawn #2/#3。
  if ((remaining[STRUCTURE_SPAWN] ?? 0) > 0) {
    remaining[STRUCTURE_SPAWN]! -= 1;
  }
  // 收集所有 RCL 批次（派生：数量真相源 = CONTROLLER_STRUCTURES）并按放置优先级排序。
  const batches = buildRclBatches(rcl);
  batches.sort((a, b) => (TYPE_PLACE_ORDER[a.type] ?? 99) - (TYPE_PLACE_ORDER[b.type] ?? 99));

  // 抵扣承诺后的真实缺口（按类型累计）— 放置目标 + 末段缺口告警依据。
  // 逐批次抵扣 ≡ 按类型总量抵扣（同类型批次合计后再扣承诺，顺序无影响），
  // 与旧 deductBatch 语义逐级等价（含 spawn 锚点豁免）。
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
      // 批次级份额：min(本批 count, 类型总缺口 - 已放)。不能用
      // 「总缺口 - 已放」直接当 need — 那会让每类型只有第一个批次在放置，
      // 后续批次的 priority/phase 全部丢失（tower 全变 rcl3 相位）。
      const need = Math.min(
        batch.count,
        Math.max(0, (residualNeedByType.get(type) ?? 0) - (placedByType.get(type) ?? 0)),
      );
      if (need <= 0) continue;

      // Lab 特殊处理：集群放置
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

      // Tower 特殊处理：分桶放置（controller 侧 + anchor 硬约束 + 通用池兜底）。
      // 设计文档 §3.7：RCL5+ 启用 controller 分桶，RCL8 强制至少 2 塔 anchor ≤ 5。
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

      // 通用贪心放置
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

    // 缺口是否全部闭合；未闭合且半径未穷尽 → 外扩重试。
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
  // 根治「静默少放」：过去候选池耗尽时 placeStructures 直接返回不足量 placements，
  // 无任何信号，玩家直到运营受影响（extension 不足→能量上限低→孵化慢）才发现。
  // 现按类型对比真实缺口（抵扣承诺后）与实际放置，缺口即告警，标明搜索半径已扩
  // 到上限的事实——提示房间地形过于破碎，需人工介入（换锚点 / 接受降级 / 手动规划）。
  // 频率：layout-planner 每 50 tick 规划一次，告警至多每 50 tick 一条，可接受。
  for (const [type, needed] of residualNeedByType) {
    const placedCount = placedByType.get(type) ?? 0;
    if (placedCount < needed) {
      console.log(
        `[layout] WARN placement shortfall${roomName ? ` in ${roomName}` : ""}: ` +
        `${type} need ${needed} placed ${placedCount} (missing ${needed - placedCount}) — ` +
        `search radius exhausted at ${effectiveRadius}, terrain too constrained`,
      );
    }
  }

  return placements;
}

/**
 * 放置任务 key — 坐标绑定：`constraint.<type>.<x>.<y>`。
 *
 * 旧实现用递增计数器命名（constraint.extension.01），key 与坐标零绑定 —
 * 已建格进入 occupied 后贪心顺延，同一 key 代际间指向不同格子，
 * existingKeys 去重 / 黑名单 / done 判定全部失去锚定。
 * 坐标绑定后同一格永远同 key，重推导天然幂等。
 */
function placementKey(type: string, x: number, y: number): string {
  return `constraint.${type}.${x}.${y}`;
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
