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
  /**
   * 跨房导入能量（远矿 hauler 交付到本房 sink）。只记「外部房→本房」，
   * 房内搬运不计。当前**不计入 ledgerIncome**：并入会抬高本房净流 EMA，
   * 进而改变门控与需求弹性——那是独立的行为变更，需单独评估后再接线。
   */
  imported: number;
}

export type LedgerField = keyof EnergyLedger;

/** 消费类字段——风险缓冲的 P0/P1 速率分母取此子集（spawn/tower/repair）。 */
const CONSUMPTION_FIELDS: readonly LedgerField[] = [
  "spawned",
  "recycledRefund",
  "upgraded",
  "built",
  "repaired",
  "towerSpent",
  "sold",
];

export function emptyLedger(): EnergyLedger {
  return {
    harvested: 0,
    pickedUp: 0,
    spawned: 0,
    recycledRefund: 0,
    upgraded: 0,
    built: 0,
    repaired: 0,
    towerSpent: 0,
    bought: 0,
    sold: 0,
    imported: 0,
  };
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

/** 收入合计（harvest + pickup + bought + imported）。远矿 hauler 交付到本房 sink 是真实流入：
 * 不并入则远矿支撑的本土房净流恒为负，帝国健康度/扩张就绪门（minNetFlow）被系统性压低。
 * 与 ledgerConsumption 不含远矿房的 harvested 对应 —— 本房账本只收交付侧、不记远矿采集侧，无双重计算。 */
export function ledgerIncome(l: EnergyLedger): number {
  return l.harvested + l.pickedUp + l.bought + l.imported;
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
  return {
    spawnExt: 0,
    containers: 0,
    storage: 0,
    terminal: 0,
    links: 0,
    carry: 0,
    towers: 0,
    loose: 0,
    other: 0,
  };
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
  return (
    pools.spawnExt +
    pools.containers +
    pools.storage +
    pools.terminal +
    pools.links +
    pools.carry +
    pools.towers +
    pools.loose
  );
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
  /** 在途背包能量（tracked 的一部分，但它与 `imported` 结算在**不同侧**：carry 按
   * memory.home 立刻计、imported 要等投递成功那刻才计）⇒ 跨窗残差恰为一只 hauler 满载。
   * 单独落这两个数，是为了让那种噪声一眼可辨而不是被算成"账实不符"。 */
  carryStart: number;
  carryEnd: number;
  /** drift = Δtracked − flowBalance − looseΔ **+ Δother**；超容差即核算缺陷信号。
   * （旧版写的是 −Δother，而 `other` 不在 trackedPoolsOf 里 ⇒ 一次 storage→工业池的纯搬运
   * 被算成两倍损失；`ba18a6b` 纠正。） */
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
  //
  // Δother 的符号是**加**，不是减 —— 因为 `other`（factory/powerSpawn/lab 储能）
  // 不在 `trackedPoolsOf` 里。一笔"storage → 工业池"的搬运会让 tracked 少 X、other 多 X：
  // 减号把同一个 X 算两次损失（drift=−2X），于是**正常的工业装料每窗都谎报账实不符**；
  // 加号才让纯搬运归零（Δtracked=−X 与 +Δother=+X 相消）。
  // 代价（已知局限，别当成已修完）：工业池内部真正烧掉的能量（压缩 commodity、boost、
  // 反应每批 20 能量）没有计数器，而池快照无法把它与"排回 storage"区分 ⇒ 那种消耗在这里
  // 显示为 0 而不是负 drift。补法是加一个 `industrialSpend` 消费桶（见任务列表），
  // 而不是把符号改回去 —— 改回去只会让 AccountingDrift 每窗空响。
  const drift =
    trackedEnd - trackedStart - flowBalance - looseDelta + (endPools.other - startPools.other);
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
    carryStart: startPools.carry,
    carryEnd: endPools.carry,
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
export function updateNetFlowEma(
  prev: number | undefined,
  windowPerTick: number,
  alpha: number,
): number {
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
  /**
   * 最近一窗各桶增量（能量，零值不入账）。
   *
   * 为什么要落盘：drift 的符号只能告诉我们"账与存量不一致"，点名不了**哪一项**。
   * 线上实测 `dr=-1802/50t`（≈ −36/t 持续超容差）而 `nf=+11.85`、环上净流 −27.9 ——
   * 三份读数互相打脸，而 G3（经济健康）与 G4（净流）两道扩张闸就建在这个数上。
   * 桶增量本来就在 `rollupWindow` 里算出来了（`byBucket`），此前被扔掉。
   */
  bk?: Record<string, number>;
  /**
   * 一个视界内的累计量 `[Σdrift, ΣflowBalance, Σticks]`（能量与拍）。
   *
   * 为什么必须有：单窗 `dr` 分不清"两窗来回摆"与"单向漏记"——线上正是这样：
   * `dr` 依次 −6 / +221 / −196 / −1378 / −2126 / +1712 / −2695，而 `pl` 的
   * `trackedEnd` 与下一窗的 `trackedStart` 接不上（933145 ≠ 934074），端点差分不能当积分用。
   * 累计之后一次读数就能判：**Σdrift ≈ 0 而 Σ|dr| 大 ⇒ 振荡**（账可放心用）；
   * **Σdrift 与 ΣflowBalance 同量级 ⇒ 单向漏记**（此时 `nf`/G4 不可信，必须先修账再谈扩张）。
   * 视界到 `WS_HORIZON_TICKS` 就滚动重开；换码后从本字段续算，不随 heap 归零。
   */
  ws?: [number, number, number];
  /**
   * 最近一窗的池快照 `[trackedStart, trackedEnd, otherStart, otherEnd, looseDelta]`。
   * 与 bk 合起来才构成 drift 的完整恒等式：缺的是**记账项**还是**没被跟踪的池**，一眼可分。
   */
  pl?: number[];
  /** 最近一窗在途背包能量 `[carryStart, carryEnd]`。
   * 为什么单独给：carry 是存量面（creep 一装货就按 home 计入 tracked），
   * imported 是流量面（投递成功那刻才计入收入）—— 两者跨窗边界错开一整个背包量，
   * 于是"只装不走"的窗 drift 偏正、"只走不装"的窗偏负。有了这两个数，
   * 残差 = Δcarry 与 Δimported 之差，一眼可辨，不必再猜是哪条远矿线在动。 */
  ce?: number[];
}

export function toMemorySnapshot(
  tick: number,
  netFlowEma: number | undefined,
  reserve: number,
  riskBuffer: number,
  drift: number,
  estimatedIncome: number,
  effFactor: number,
  w?: AccountingWindow,
  ws?: [number, number, number],
): EconomyMemorySnapshot {
  const snap: EconomyMemorySnapshot = {
    t: tick,
    nf: Math.round((netFlowEma ?? 0) * 100),
    cr: Math.round(reserve),
    rb: Math.round(riskBuffer * 10),
    dr: Math.round(drift),
    ei: Math.round(estimatedIncome * 10),
    ef: Math.round(effFactor * 100),
  };
  if (w) {
    const buckets: Record<string, number> = {};
    for (const [field, value] of Object.entries(w.byBucket)) {
      const rounded = Math.round(value);
      if (rounded !== 0) buckets[field] = rounded;
    }
    if (Object.keys(buckets).length > 0) snap.bk = buckets;
    snap.pl = [
      Math.round(w.trackedStart),
      Math.round(w.trackedEnd),
      Math.round(w.otherStart),
      Math.round(w.otherEnd),
      Math.round(w.looseDelta),
    ];
    snap.ce = [Math.round(w.carryStart), Math.round(w.carryEnd)];
  }
  if (ws) snap.ws = [Math.round(ws[0]), Math.round(ws[1]), Math.round(ws[2])];
  return snap;
}

/**
 * `ws` 的累计视界（拍）。取 2000 ≈ 40 个核算窗：远矿投递周期约 50~130 拍，
 * 视界必须跨十几个周期才压得住脉冲，否则"Σdrift≈0"可能只是撞上了相位。
 */
export const WS_HORIZON_TICKS = 2000;

/** 一窗的收支流平衡（与 `summarizeWindow` 里的 `net` 同一口径）。 */
export function flowBalanceOf(w: AccountingWindow): number {
  return w.income - w.consumption + w.refunds;
}

/**
 * 把一窗的 `drift` / 流平衡累进视界累计量。
 *
 * 视界到 `WS_HORIZON_TICKS` 就**滚动重开**（不是减去旧值——本字段只有三个数，
 * 没有环形历史，减不动）；`prev` 缺失（首窗/该房首次核算）时从本窗起算。
 */
export function accumulateWs(
  prev: readonly number[] | undefined,
  w: AccountingWindow,
): [number, number, number] {
  const flowBalance = flowBalanceOf(w);
  const [drift = 0, flow = 0, ticks = 0] = prev ?? [];
  const nextTicks = ticks + w.ticks;
  // 视界到点滚动重开：本字段只有三个数、没有环形历史，减不动旧值。
  if (nextTicks > WS_HORIZON_TICKS) return [w.drift, flowBalance, w.ticks];
  return [drift + w.drift, flow + flowBalance, nextTicks];
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
  return `t${w.t0}-${w.t1} inc=${Math.round(w.income)} con=${Math.round(
    w.consumption,
  )} ref=${Math.round(w.refunds)} net=${
    w.income - w.consumption + w.refunds >= 0 ? "+" : ""
  }${Math.round(w.income - w.consumption + w.refunds)} drift=${Math.round(
    w.drift,
  )} p0p1/t=${w.p0p1PerTick.toFixed(2)} inc/t=${w.incomePerTick.toFixed(2)} looseD=${Math.round(
    w.looseDelta,
  )}`;
}

// ─── 跨 tick 房间流采样（实测口径）─────────────────────────

/** 单房流采样快照（heap 持有；global reset 丢失可接受 — 重见即重新播种）。 */
export interface RoomFlowSample {
  /** 采样 tick — gap > 1 时跳过 bump（再生抵消采集导致差分不可靠）。 */
  tick: number;
  /** Σ source.energy。 */
  sources: number;
  /** controller.progress（仅 owned 房采集，非 owned 恒 0）。 */
  progress: number;
  /** 在建工地进度（siteId → [progress, progressTotal]）。 */
  sites: Record<string, [number, number]>;
}

/**
 * 跨 tick 实测差分 → 本 tick 流量（能量）。
 * 官服引擎的资源结算发生在 tick 末 intent 解析：同 tick 的 creep 背包差值恒 0
 * （线上实证 harvest 返回 OK 但 store 10→10；mockup 同步结算会掩盖此差异）。
 * 相邻两次代码执行点之间，房间状态恰好结算完一个完整 tick 的 intent —
 * 房间级状态差分是唯一与引擎语义无关的实测口径。
 * 再生脉冲 / RCL 升级清零使差值为负 — clamp 0：漏记单 tick 的量，绝不记假账。
 */
export function diffRoomFlows(
  prev: RoomFlowSample,
  cur: RoomFlowSample,
): { harvested: number; upgraded: number; built: number } {
  return {
    harvested: Math.max(0, prev.sources - cur.sources),
    upgraded: Math.max(0, cur.progress - prev.progress),
    built: diffSiteProgress(prev.sites, cur.sites),
  };
}

/** 工地进度差分：完工离场的工地补记剩余量（取消出场的会高估 — 罕见，drift 门兜底）。 */
function diffSiteProgress(
  prev: Record<string, [number, number]>,
  cur: Record<string, [number, number]>,
): number {
  let built = 0;
  for (const [id, [prevProg, total]] of Object.entries(prev)) {
    const now = cur[id];
    if (now) built += Math.max(0, now[0] - prevProg);
    else built += Math.max(0, total - prevProg);
  }
  return built;
}
