/** 能量核算纯函数层（· ENERGY_ACCOUNTING_MODEL）。 */

// ─── L1 计数器 ──────────────────────────────────────────────

/** 单房能量账本（L1 计数器）。全部非负，只增不减（不变量：income/consumption ≥ 0）。 */
export interface EnergyLedger {
  /** 从 source 实采能量。 */
  harvested: number;
  /** 掉落/墓碑/废墟回收能量（真实流入，非搬运）。 */
  pickedUp: number;
  /** spawnCreep 成功全额计费（gross）。 */
  spawned: number;
  /** recycle 返还冲销（按剩余寿命比例），防消费高估。 */
  recycledRefund: number;
  /** controller 升级入账能量。 */
  upgraded: number;
  /** 建造 progress 点数（=能量）。 */
  built: number;
  /** 维修耗能。 */
  repaired: number;
  /** 塔 attack/heal/repair 耗能（每次 10）。 */
  towerSpent: number;
  // 【审计修复 Phase 4-5】市场交易能量入 L1 账本。
  // bought = 市场买入的能量量（income 侧）；sold = 市场卖出的能量量（consumption 侧）。
  /** 市场买入能量（terminal.deal 收到的能量）。 */
  bought: number;
  /** 市场卖出能量（terminal.deal 付出的能量）。 */
  sold: number;
}

export type LedgerField = keyof EnergyLedger;

/** 消费类字段——风险缓冲的 P0/P1 速率分母取此子集（spawn/tower/repair）。 */
const CONSUMPTION_FIELDS: readonly LedgerField[] = [
  "spawned", "recycledRefund", "upgraded", "built", "repaired", "towerSpent", "sold",
];

export function emptyLedger(): EnergyLedger {
  return { harvested: 0, pickedUp: 0, spawned: 0, recycledRefund: 0, upgraded: 0, built: 0, repaired: 0, towerSpent: 0, bought: 0, sold: 0 };
}

/**
 * 累加一条计数。负数输入直接忽略（防御埋点错误破坏 ≥0 不变量）；
 * recycledRefund 语义为冲销项，同样只记绝对值。
 */
export function ledgerAdd(ledger: EnergyLedger, field: LedgerField, amount: number): void {
  if (!(amount > 0)) return;
  ledger[field] += amount;
}

/** 两账本逐字段差值（end − start）——窗口滚动用。 */
export function ledgerDelta(start: EnergyLedger, end: EnergyLedger): EnergyLedger {
  const out = emptyLedger();
  for (const f of Object.keys(out) as LedgerField[]) {
    out[f] = Math.max(0, end[f] - start[f]);
  }
  return out;
}

/** 收入合计（harvest + pickup + bought）。 */
export function ledgerIncome(l: EnergyLedger): number {
  return l.harvested + l.pickedUp + l.bought;
}

/** 消费合计（gross，不含冲销；sold 为市场卖出能量，属消费侧）。 */
export function ledgerConsumption(l: EnergyLedger): number {
  let sum = 0;
  for (const f of CONSUMPTION_FIELDS) {
    if (f === "recycledRefund") continue;
    sum += l[f];
  }
  return sum;
}

/** P0/P1 消费速率分子（spawn + tower + repair —— 围城配给序的常供侧）。 */
export function ledgerP0P1Consumption(l: EnergyLedger): number {
  return l.spawned + l.towerSpent + l.repaired;
}

// ─── 池划分快照 ──────────────────────────────────────────────

/** 单房能量池快照（数字 only；采集端从 RoomSnapshot 组装）。 */
export interface EnergyPools {
  /** spawn + extension 内能量。 */
  spawnExt: number;
  containers: number;
  storage: number;
  terminal: number;
  links: number;
  /** 在途背包能量——计入受踪池，消除「采集/入仓跨窗错位」的假漂移。 */
  carry: number;
  /** 塔库存——塔是 tracked 池：注入（fill）为搬运、流出已由 towerSpent 计数；
   * 若不入池，注入侧会呈系统性负 drift（实测 −9/tick 量级，B4 归因记录）。 */
  towers: number;
  /** 衰减性散落资产：dropped + tombstone + ruin 内能量。 */
  loose: number;
  /** 工业池：factory + powerSpawn（单房期允许未分账，进 drift 解释项）。 */
  other: number;
}

export function emptyPools(): EnergyPools {
  return { spawnExt: 0, containers: 0, storage: 0, terminal: 0, links: 0, carry: 0, towers: 0, loose: 0, other: 0 };
}

/** 合同「储备」口径：storage + terminal + link 折算水位（Reservation 扣除基数）。 */
export function contractReserveOf(pools: EnergyPools): number {
  return pools.storage + pools.terminal + pools.links;
}

/**
 * 受踪池合计（恒等式左端库存项，仅 other/工业池除外）。含在途背包与散落资产：
 * 死亡携带→墓碑、掉落→捡拾全程在踪；自然衰减表现为 dLoose<0 的可解释漂移
 * （任务书 §14「差异必须能解释」），不再是无主黑洞。
 */
export function trackedPoolsOf(pools: EnergyPools): number {
  return pools.spawnExt + pools.containers + pools.storage + pools.terminal + pools.links + pools.carry + pools.towers + pools.loose;
}

// ─── 核算窗口 ────────────────────────────────────────────────

/** 一个核算窗的完整结果。 */
export interface AccountingWindow {
  /** 起止 tick（含头不含尾）。 */
  t0: number;
  t1: number;
  ticks: number;
  income: number;
  consumption: number;
  refunds: number;
  /** 逐字段窗口增量（分解报表用）。 */
  byBucket: EnergyLedger;
  trackedStart: number;
  trackedEnd: number;
  otherStart: number;
  otherEnd: number;
  looseDelta: number;
  /** drift = Δtracked − flowBalance − Δother；超容差即核算缺陷信号。 */
  drift: number;
  /** 本窗 P0/P1 消费速率（能量/tick）。 */
  p0p1PerTick: number;
  /** 本窗实测收入速率（能量/tick）。 */
  incomePerTick: number;
}

/**
 * 滚动一个核算窗。t1−t0 必须 > 0；两份账本/池快照分别为窗口起点的累计值与终点的
 * 累计值（计数器跨窗连续，不清零重计——避免 reset 窗口边界丢账）。
 */
export function rollupWindow(
  t0: number,
  t1: number,
  startLedger: EnergyLedger,
  endLedger: EnergyLedger,
  startPools: EnergyPools,
  endPools: EnergyPools,
): AccountingWindow {
  const ticks = Math.max(1, t1 - t0);
  const d = ledgerDelta(startLedger, endLedger);
  const income = ledgerIncome(d);
  const consumption = ledgerConsumption(d);
  const refunds = d.recycledRefund;
  const trackedStart = trackedPoolsOf(startPools);
  const trackedEnd = trackedPoolsOf(endPools);
  const flowBalance = income - consumption + refunds;
  const looseDelta = endPools.loose - startPools.loose;
  // loose（dropped/tombstone/ruin）自然衰减不属于核算缺陷——单独报告 looseDelta，
  // 从 drift 中排除以避免误报（测试「loose 衰减单独报告且不影响 drift」验证此不变量）。
  const drift = (trackedEnd - trackedStart) - flowBalance - looseDelta - (endPools.other - startPools.other);
  return {
    t0,
    t1,
    ticks,
    income,
    consumption,
    refunds,
    byBucket: d,
    trackedStart,
    trackedEnd,
    otherStart: startPools.other,
    otherEnd: endPools.other,
    looseDelta,
    drift,
    p0p1PerTick: ledgerP0P1Consumption(d) / ticks,
    incomePerTick: income / ticks,
  };
}

/**
 * drift 容差判定：max(floor, 吞吐×ratio)。吞吐以收支流水平衡的绝对值近似。
 * 连续超容差的「连续」判定由调用方（Economy 系统）持状态，此处单窗判定。
 */
export function driftLimit(w: AccountingWindow, floor: number, ratio: number): number {
  const throughput = Math.abs(w.income - w.consumption) + w.refunds;
  return Math.max(floor, throughput * ratio);
}

export function isDriftExcessive(w: AccountingWindow, floor: number, ratio: number): boolean {
  return Math.abs(w.drift) > driftLimit(w, floor, ratio);
}

// ─── 三指标（L2）────────────────────────────────────────────

/**
 * 净流 EMA 更新。输入为本窗每 tick 流平衡（可负）；α 取 CONFIG.economy.accounting.netFlowAlpha。
 * 首窗直接取现值（无历史可平滑）。
 */
export function updateNetFlowEma(prev: number | undefined, windowPerTick: number, alpha: number): number {
  if (prev === undefined || !Number.isFinite(prev)) return windowPerTick;
  return prev + alpha * (windowPerTick - prev);
}

/**
 * 风险缓冲（断供耐受 tick 数）＝ contractReserve ÷ P0/P1 消费速率。
 * 速率下限 ε 防零除——无消费时缓冲视为充裕（返回大数而非 ∞，便于序列化）。
 */
export const RISK_BUFFER_CAP = 100000;

export function riskBufferTicks(reserve: number, p0p1PerTick: number, epsilon = 0.05): number {
  const rate = Math.max(p0p1PerTick, epsilon);
  return Math.min(RISK_BUFFER_CAP, reserve / rate);
}

/** 单 source 名义产能（引擎常量快照 3000/300 = 10 能量/tick）。 */
export const NOMINAL_INCOME_PER_SOURCE = 10;

/** 效率系数初值（社区数，research/10 §10.4：本地利用率初值 70%，按实测校准）。 */
export const INITIAL_EFFICIENCY_FACTOR = 0.7;

/**
 * 效率系数更新：实测收入速率 ÷ 名义产能，clamp 到 [0,1] 后 EMA 平滑。
 * 初值 0.7（社区数，research/10 §10.4）；实测校准义务由此履行（C7）。
 */
export function updateEfficiencyFactor(
  prev: number | undefined,
  measuredIncomePerTick: number,
  sourceCount: number,
  alpha: number,
): number {
  const nominal = Math.max(1, sourceCount) * NOMINAL_INCOME_PER_SOURCE;
  const measured = Math.max(0, Math.min(1, measuredIncomePerTick / nominal));
  if (prev === undefined || !Number.isFinite(prev)) return measured;
  return Math.max(0, Math.min(1, prev + alpha * (measured - prev)));
}

/** 估计收入（门控入账口径）：source 数 × 名义产能 × 效率系数。禁名义直入——系数必须生效。 */
export function estimateIncome(sourceCount: number, effFactor: number): number {
  return Math.max(0, sourceCount) * NOMINAL_INCOME_PER_SOURCE * Math.max(0, Math.min(1, effFactor));
}

// ─── Memory 瘦快照（schema v37）─────────────────────────────

/** Memory.rooms[r].economy 瘦快照——整数化短字段（STATE_OWNERSHIP §2 白名单）。 */
export interface EconomyMemorySnapshot {
  /** 采样 tick。 */
  t: number;
  /** 净流 EMA ×100（能量/tick）。 */
  nf: number;
  /** 合同储备（storage+terminal+link）。 */
  cr: number;
  /** 风险缓冲 tick 数 ×10。 */
  rb: number;
  /** 最近一窗 drift。 */
  dr: number;
  /** 估计收入 ×10（能量/tick）。 */
  ei: number;
  /** 效率系数 ×100。 */
  ef: number;
}

export function toMemorySnapshot(
  tick: number,
  netFlowEma: number | undefined,
  reserve: number,
  riskBuffer: number,
  drift: number,
  estimatedIncome: number,
  effFactor: number,
): EconomyMemorySnapshot {
  return {
    t: tick,
    nf: Math.round((netFlowEma ?? 0) * 100),
    cr: Math.round(reserve),
    rb: Math.round(riskBuffer * 10),
    dr: Math.round(drift),
    ei: Math.round(estimatedIncome * 10),
    ef: Math.round(effFactor * 100),
  };
}

/** 从 Memory 快照恢复 heap 态（global reset 惰性重建路径；缺字段回退 undefined 语义）。 */
export function fromMemorySnapshot(s: Partial<EconomyMemorySnapshot> | undefined): {
  netFlowEma: number | undefined;
  effFactor: number | undefined;
} {
  if (!s) return { netFlowEma: undefined, effFactor: undefined };
  return {
    netFlowEma: typeof s.nf === "number" ? s.nf / 100 : undefined,
    effFactor: typeof s.ef === "number" ? s.ef / 100 : undefined,
  };
}

/** 从池快照组装受踪池/其他池差值都需要的中间量——采集端便捷函数。 */
export function summarizeWindow(w: AccountingWindow): string {
  return "t" + w.t0 + "-" + w.t1
    + " inc=" + Math.round(w.income)
    + " con=" + Math.round(w.consumption)
    + " ref=" + Math.round(w.refunds)
    + " net=" + (w.income - w.consumption + w.refunds >= 0 ? "+" : "") + Math.round(w.income - w.consumption + w.refunds)
    + " drift=" + Math.round(w.drift)
    + " p0p1/t=" + w.p0p1PerTick.toFixed(2)
    + " inc/t=" + w.incomePerTick.toFixed(2)
    + " looseD=" + Math.round(w.looseDelta);
}