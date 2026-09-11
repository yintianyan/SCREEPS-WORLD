/** 远矿运营账本 — 每 op 的收支累积与净营收核算（纯函数，不访问 Game/Memory）。 */

/**
 * 远矿运营账本的累计收支。全部单调不减，窗口结算时由调用方重置。
 *
 * 口径要点：
 * 1. 收入只认「拉回主房 sink 的能量」（transfer 成功）——远矿房 container 里的
 *    存量不算收益（未回主房，且 container 会衰减）。
 * 2. 坟墓/掉落被拾回后仍会经 hauler 交付进主房，已计入 delivered；因此账本
 *    **不单列 looted**——再冲销一次等于同一份能量记两次收入。
 * 3. defender 带 remoteTarget，其 body 成本已进 spawnCost；**不单列 riskCost**，
 *    否则同一笔孵化被记两次支出。
 */
export interface RemoteOpLedger {
  /** 拉回主房 sink 的能量。 */
  delivered: number;
  /** 为本 op 孵化 creep 的能量（body 成本，gross）。 */
  spawnCost: number;
  /** 回收返还，冲销 spawnCost。 */
  refund: number;
  /** 基建消耗：container / road 工地创建时一次性计入。 */
  infraCost: number;
  /**
   * 该 op 分摊到的 CPU 速率（CPU/tick，EMA 平滑）。**仪表值，非累计计数器**：
   * 不随账本持久化（近期速率量，跨 reset 恢复无意义），也不参与 `opNetDelivered`
   * ——CPU 定价系数尚无实测依据，硬编一个只会污染判据。此字段只供观测与人工校准：
   * 把「净营收 e/t」与「CPU/t」并列呈现，由运营者判断哪条线值得占 CPU 预算。
   */
  cpuPerTick: number;
  /** 窗口起点 tick。 */
  windowStart: number;
  /** 最近一次记账 tick。 */
  lastTick: number;
}

/** 可累加的收支字段（windowStart / lastTick 由账本自身维护）。 */
export type RemoteOpLedgerField = "delivered" | "spawnCost" | "refund" | "infraCost";

export function emptyOpLedger(tick: number): RemoteOpLedger {
  return {
    delivered: 0,
    spawnCost: 0,
    refund: 0,
    infraCost: 0,
    cpuPerTick: 0,
    windowStart: tick,
    lastTick: tick,
  };
}

/** 累加一条收支。非有限或非正输入静默忽略，维持 ≥0 与单调不减不变量。 */
export function bumpOpLedger(l: RemoteOpLedger, field: RemoteOpLedgerField, amount: number): void {
  if (!(amount > 0) || !Number.isFinite(amount)) return;
  l[field] += amount;
}

/**
 * 未回收的孵化投入 = 孵化 − 回收返还。
 * 回收返还是「把已花出去的能量拿回来」，必须冲销投入，否则回收型轮换会被
 * 记成亏损而误杀健康 op。下界 0：跨窗口的返还可能大于本窗投入。
 */
export function opUnrecoveredInvestment(l: RemoteOpLedger): number {
  return Math.max(0, l.spawnCost - l.refund);
}

/** 净营收（能量）> 0 才叫营收，否则是补贴。 */
export function opNetDelivered(l: RemoteOpLedger): number {
  return l.delivered - opUnrecoveredInvestment(l) - l.infraCost;
}

/** 净营收速率（能量/tick）。窗口长度至少 1，防未结算账本除零。 */
export function opNetRate(l: RemoteOpLedger, nowTick: number): number {
  return opNetDelivered(l) / Math.max(1, nowTick - l.windowStart);
}

export function opProfitable(l: RemoteOpLedger): boolean {
  return opNetDelivered(l) > 0;
}

/**
 * 记录一次 CPU 采样并更新 EMA。
 * α = 0.1（约 10-tick 记忆半衰期），既平滑单次抖动，又能在负载变化后约 30 tick
 * 内收敛到新稳态。非法输入（NaN / 负值）静默忽略，不污染历史。
 */
export function recordOpCpu(l: RemoteOpLedger, cpuUsed: number): void {
  if (!Number.isFinite(cpuUsed) || cpuUsed < 0) return;
  const alpha = 0.1;
  if (l.cpuPerTick <= 0) {
    // 首样本：直接置位，避免 EMA 从 0 缓慢爬升
    l.cpuPerTick = cpuUsed;
  } else {
    l.cpuPerTick = l.cpuPerTick * (1 - alpha) + cpuUsed * alpha;
  }
}

// ─── Memory 持久化（跨 global reset）─────────────────────
// heap 是实时累加器，但每次部署代码都会 global reset 把 heap 清零；
// 观测要攒出有意义的窗口就必须落 Memory。字段名压到单字符 + 整数化。

/** 账本的 Memory 紧凑快照（整数短字段，遵守 Memory 只存少量数字的约束）。 */
export interface RemoteOpLedgerSnapshot {
  /** delivered */
  d: number;
  /** spawnCost */
  s: number;
  /** refund */
  r: number;
  /** infraCost */
  i: number;
  /** windowStart */
  w: number;
}

export function toOpLedgerSnapshot(l: RemoteOpLedger): RemoteOpLedgerSnapshot {
  return {
    d: Math.round(l.delivered),
    s: Math.round(l.spawnCost),
    r: Math.round(l.refund),
    i: Math.round(l.infraCost),
    w: l.windowStart,
  };
}

/** 从 Memory 快照恢复账本。快照缺失/畸形时回退空账本（窗口从 tick 起算）。 */
export function fromOpLedgerSnapshot(
  s: RemoteOpLedgerSnapshot | undefined,
  tick: number,
): RemoteOpLedger {
  if (!s) return emptyOpLedger(tick);
  return {
    delivered: finiteOrZero(s.d),
    spawnCost: finiteOrZero(s.s),
    refund: finiteOrZero(s.r),
    infraCost: finiteOrZero(s.i),
    cpuPerTick: 0,
    windowStart: Number.isFinite(s.w) ? s.w : tick,
    lastTick: tick,
  };
}

function finiteOrZero(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** 单行摘要（供低频日志观测，不参与任何决策）。 */
export function summarizeOpLedger(
  home: string,
  target: string,
  l: RemoteOpLedger,
  nowTick: number,
): string {
  const rate = opNetRate(l, nowTick);
  return (
    `${home}->${target} net=${Math.round(opNetDelivered(l))}e ` +
    `(${rate >= 0 ? "+" : ""}${rate.toFixed(2)}e/t) ` +
    `delivered=${Math.round(l.delivered)} spawn=${Math.round(l.spawnCost)} ` +
    `refund=${Math.round(l.refund)} infra=${Math.round(l.infraCost)} ` +
    `cpu=${l.cpuPerTick.toFixed(3)} ` +
    `win=${Math.max(0, nowTick - l.windowStart)}t`
  );
}
