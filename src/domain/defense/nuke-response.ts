/** Nuke 响应决策 — 纯函数层（审计缺口 1+3：核弹落点感知 + 资产抢救）。 */

/** 核弹伤害半径（Chebyshev 距离）：落点 5 格内的 creep/结构都会受伤。 */
export const NUKE_DAMAGE_RADIUS = 5;

/**
 * 核弹撤离窗口（tick）：只在落点前这么短时间内接管非战斗 creep。
 *
 * 核弹从发射到落地有数万 tick；过早撤离会让资产抢救/正常工作停摆。
 * 100 tick 足够从落点走到 5 格半径外（每 tick 1 格），又不会让 40,000 tick
 * 的预警把整个房间的经济冻结。
 */
export const NUKE_EVAC_WINDOW_TICKS = 100;

/** 核弹落点（只依赖位置，便于纯函数测试）。 */
export interface NukeImpactPoint {
  pos: { x: number; y: number };
  /** 剩余落地 tick；缺省视为立即生效（测试/旧数据兼容）。 */
  timeToLand?: number;
}

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

const EVASION_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * 找一个「核弹伤害半径之外」的撤离目标格；不在危险区或无安全格时返回 undefined。
 *
 * 只做几何选点，不访问 Game；移动由 creep 层 `evadeNuke` 执行。选点优先最近的
 * 半径外格，其次房间角落兜底；多个核弹时要求同时避开所有落点。
 */
export function findNukeEvasionTarget(
  pos: { x: number; y: number },
  nukes: readonly NukeImpactPoint[],
  radius = NUKE_DAMAGE_RADIUS,
  maxTimeToLand = NUKE_EVAC_WINDOW_TICKS,
): { x: number; y: number } | undefined {
  if (nukes.length === 0) return undefined;
  const active = nukes.filter(n => n.timeToLand === undefined || n.timeToLand <= maxTimeToLand);
  if (active.length === 0) return undefined;
  const inDanger = active.some(n => chebyshev(pos, n.pos) <= radius);
  if (!inDanger) return undefined;

  let best: { x: number; y: number; dist: number } | undefined;
  for (let step = radius + 1; step <= radius + 3; step++) {
    for (const [dx, dy] of EVASION_DIRECTIONS) {
      const x = Math.max(0, Math.min(49, pos.x + dx * step));
      const y = Math.max(0, Math.min(49, pos.y + dy * step));
      if (active.some(n => chebyshev({ x, y }, n.pos) <= radius)) continue;
      const dist = chebyshev(pos, { x, y });
      if (
        best === undefined ||
        dist < best.dist ||
        (dist === best.dist && (x < best.x || (x === best.x && y < best.y)))
      ) {
        best = { x, y, dist };
      }
    }
    if (best !== undefined) return { x: best.x, y: best.y };
  }

  // 兜底：多个核弹可能覆盖环上的全部候选，退到房间角落里找一个安全点。
  const corners = [
    { x: 0, y: 0 },
    { x: 49, y: 0 },
    { x: 0, y: 49 },
    { x: 49, y: 49 },
  ];
  for (const corner of corners) {
    if (active.every(n => chebyshev(corner, n.pos) > radius)) return corner;
  }
  return undefined;
}

/** 资产抢救接收房候选（由执行层从 snapshot 采集，纯函数不访问 Game）。 */
export interface SalvageCandidate {
  roomName: string;
  hasTerminal: boolean;
  /** 本房是否也处于 nuke 落点预警（true 不可作接收方 — 转进去是二次损失）。 */
  nukeAlert: boolean;
  /** terminal 剩余容量（字节口径与 store.getFreeCapacity 一致）。 */
  terminalFree: number;
}

/**
 * 选择资产抢救接收房：无警报 + 有 terminal + 容量最富余者优先。
 * 全部候选不合格时返回 undefined（单房帝国无处可转 — 静默等待，事件已记录）。
 */
export function pickSalvageRecipient(
  candidates: readonly SalvageCandidate[],
  excludeRoom: string,
): SalvageCandidate | undefined {
  let best: SalvageCandidate | undefined;
  for (const c of candidates) {
    if (c.roomName === excludeRoom) continue;
    if (c.nukeAlert || !c.hasTerminal) continue;
    if (c.terminalFree <= 0) continue;
    if (!best || c.terminalFree > best.terminalFree) best = c;
  }
  return best;
}

/**
 * 抢救资源优先序（价值密度降序）：
 * power（GPL 硬通货）> G（核弹/浓缩原料）> 高级化合物 X*（boost 战备）>
 * battery（压缩能量）> 基础矿物 > 兜底任意（含 OPS 等）。
 * 能量不在列表 — 由 planSalvageShipment 单独处理（留运费地板后全发）。
 */
const SALVAGE_PRIORITY: readonly string[] = [
  RESOURCE_POWER,
  RESOURCE_GHODIUM,
  "XUH2O",
  "XUHO2",
  "XZH2O",
  "XZHO2",
  "XLH2O",
  "XLHO2",
  "XKH2O",
  "XKHO2",
  "XGH2O",
  "XGHO2",
  RESOURCE_BATTERY,
  RESOURCE_HYDROGEN,
  RESOURCE_OXYGEN,
  RESOURCE_UTRIUM,
  RESOURCE_LEMERGIUM,
  RESOURCE_KEANIUM,
  RESOURCE_ZYNTHIUM,
  RESOURCE_CATALYST,
];

/** 一次抢救发运计划。 */
export interface SalvageShipment {
  to: string;
  resourceType: string;
  amount: number;
}

/**
 * 规划一次抢救发运（每 terminal 每轮一笔，terminal 冷却 10 tick + 系统
 * interval 200 下 50000 tick 窗口绰绰有余）：
 * 1. 非能量资源按优先序取首个有库存者全量发；
 * 2. 无非能量资源时发能量（留运费地板，剩余全发）；
 * 3. 无可发资源返回 undefined（抢救完成或本无库存）。
 */
export function planSalvageShipment(
  terminalResources: ReadonlyMap<string, number>,
  recipient: string,
  energyFeeReserve: number,
): SalvageShipment | undefined {
  for (const resourceType of SALVAGE_PRIORITY) {
    const amount = terminalResources.get(resourceType) ?? 0;
    if (amount > 0) {
      return { to: recipient, resourceType, amount };
    }
  }
  // 非能量资源发完 → 能量兜底（留运费地板）。
  const energy = terminalResources.get(RESOURCE_ENERGY) ?? 0;
  const amount = energy - energyFeeReserve;
  if (amount > 0) {
    return { to: recipient, resourceType: RESOURCE_ENERGY, amount };
  }
  return undefined;
}
