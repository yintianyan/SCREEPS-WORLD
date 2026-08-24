/**
 * Resource Ledger — A4.2 统一资源账本。
 *
 * 合同锚点：A4.2 Architecture Audit §10.4 NM-2 / §12.2 NM-2。
 *
 * 设计意图：
 *   扩展 EnergyLedger 的双口径设计（L1 计数器 + L2 核算窗口）到多资源类型。
 *   按 resourceType 分别维护独立账本，支持：
 *   - 五态分离：STORED / RESERVED / IN_TRANSIT / ALLOCATED / CONSUMED
 *   - Production / Consumption 速率（Rolling Window EMA）
 *   - drift 恒等式对账（Initial + Production + Incoming - Outgoing - Consumption - Loss ≈ Final）
 *
 * 与 EnergyLedger 的关系：
 *   EnergyLedger 是 ResourceLedger<"energy"> 的概念特例。
 *   A4.2 不删除 EnergyLedger（避免大规模重构风险），而是新建 ResourceLedger
 *   作为多资源的统一口径。后续阶段渐进迁移 EnergyLedger 的消费方。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { ResourceType } from "../operation/agenda-item";
import { getResourceCategory } from "./resource-definition";

// ─── 资源五态 ──────────────────────────────────────────────

/**
 * 资源状态分类——用于五态分离。
 *
 * 不变量：总量 = STORED + RESERVED + IN_TRANSIT + ALLOCATED + CONSUMED
 * （CONSUMED 是累计已消费量，不属于当前存量）。
 */
export type ResourceState =
  | "stored"      // 存储中（storage / terminal / container / carry）
  | "reserved"    // 已预留（被 Reservation 锁定）
  | "in_transit"  // 在途（被 Operation 分配，正在搬运）
  | "allocated"   // 已分配（AllocationPlan 签发但未创建 Operation）
  | "consumed";   // 已消费（spawn / build / upgrade / repair / tower）

// ─── L1 计数器（按 resourceType 分别记账）──────────────────

/**
 * 单资源的 L1 累计计数器。
 *
 * 与 EnergyLedger 字段对应但泛化：
 * - energy: harvested / spawned / upgraded / built / repaired / towerSpent
 * - mineral: extracted / consumed / traded / transferred
 *
 * 通用字段（所有资源类型共享）：
 * - produced: 生产量（energy=harvested, mineral=extracted）
 * - consumed: 消费量
 * - imported: 从其他房调入量
 * - exported: 调出到其他房量
 * - bought: 市场买入量
 * - sold: 市场卖出量
 * - lost: 损失量（creep 死亡 / 过期 / 被抢）
 */
export interface ResourceCounters {
  /** 从源头生产量（energy: harvest, mineral: extract）。 */
  produced: number;
  /** 被消费量（energy: spawn/build/upgrade/repair/tower, mineral: lab react）。 */
  consumed: number;
  /** 从其他房调入量（terminal.send 接收 / carrier 搬入）。 */
  imported: number;
  /** 调出到其他房量。 */
  exported: number;
  /** 市场买入量。 */
  bought: number;
  /** 市场卖出量。 */
  sold: number;
  /** 损失量（creep 死亡携带 / 过期衰减 / 被掠夺）。 */
  lost: number;
}

/** 创建零值计数器。纯函数。 */
export function emptyCounters(): ResourceCounters {
  return {
    produced: 0,
    consumed: 0,
    imported: 0,
    exported: 0,
    bought: 0,
    sold: 0,
    lost: 0,
  };
}

/** 累加一条计数。负数忽略（防御 ≥0 不变量）。纯函数。 */
export function counterAdd(
  counters: ResourceCounters,
  field: keyof ResourceCounters,
  amount: number,
): void {
  if (!(amount > 0)) return;
  counters[field] += amount;
}

/** 两份计数器逐字段差值（end − start）。纯函数。 */
export function counterDelta(
  start: ResourceCounters,
  end: ResourceCounters,
): ResourceCounters {
  const out = emptyCounters();
  for (const f of Object.keys(out) as (keyof ResourceCounters)[]) {
    out[f] = Math.max(0, end[f] - start[f]);
  }
  return out;
}

/** 产量合计（produced + imported + bought）。纯函数。 */
export function counterInflow(c: ResourceCounters): number {
  return c.produced + c.imported + c.bought;
}

/** 消费/流出合计（consumed + exported + sold + lost）。纯函数。 */
export function counterOutflow(c: ResourceCounters): number {
  return c.consumed + c.exported + c.sold + c.lost;
}

/** 净流 = inflow - outflow。纯函数。 */
export function counterNetFlow(c: ResourceCounters): number {
  return counterInflow(c) - counterOutflow(c);
}

// ─── 资源快照（即时存量）──────────────────────────────────

/**
 * 单资源的即时存量快照（从 RoomSnapshot 采集）。
 * 对应 EnergyPools 的概念，但按资源类型分别记录。
 */
export interface ResourceStockSnapshot {
  /** storage 内存量。 */
  storage: number;
  /** terminal 内存量。 */
  terminal: number;
  /** container 内存量。 */
  containers: number;
  /** creep 在途携带量。 */
  carry: number;
  /** lab 内存量（矿物专用，energy 为 0）。 */
  labs: number;
  /** factory 内存量（商品/化合物专用，energy 为 0）。 */
  factory: number;
  /** 散落量（dropped / tombstone / ruin）。 */
  loose: number;
}

/** 创建零值存量快照。纯函数。 */
export function emptyStock(): ResourceStockSnapshot {
  return {
    storage: 0,
    terminal: 0,
    containers: 0,
    carry: 0,
    labs: 0,
    factory: 0,
    loose: 0,
  };
}

/** 存量合计（受踪池）。纯函数。 */
export function stockTotal(s: ResourceStockSnapshot): number {
  return s.storage + s.terminal + s.containers + s.carry + s.labs + s.factory + s.loose;
}

/** 储备口径（storage + terminal，Reservation 扣除基数）。纯函数。 */
export function stockReserve(s: ResourceStockSnapshot): number {
  return s.storage + s.terminal;
}

// ─── 核算窗口 ──────────────────────────────────────────────

/**
 * 单资源在一个核算窗口内的完整结果。
 *
 * drift 恒等式：
 *   drift = Δstock - (inflow - outflow)
 *   = (stockEnd - stockStart) - (produced + imported + bought
 *      - consumed - exported - sold - lost)
 *
 * drift ≈ 0 表示账实一致；超容差则触发 Reconciliation。
 */
export interface ResourceAccountingWindow {
  /** 资源类型。 */
  resource: ResourceType;
  /** 起止 tick。 */
  t0: number;
  t1: number;
  ticks: number;
  /** 窗口内计数器增量。 */
  delta: ResourceCounters;
  /** 流入合计。 */
  inflow: number;
  /** 流出合计。 */
  outflow: number;
  /** 净流。 */
  netFlow: number;
  /** 期初存量。 */
  stockStart: number;
  /** 期末存量。 */
  stockEnd: number;
  /** drift = Δstock - netFlow；超容差即核算缺陷信号。 */
  drift: number;
  /** 本窗生产速率（单位/tick）。 */
  productionRate: number;
  /** 本窗消费速率（单位/tick）。 */
  consumptionRate: number;
}

/**
 * 滚动一个核算窗口。纯函数。
 *
 * @param resource 资源类型
 * @param t0 起始 tick
 * @param t1 结束 tick
 * @param startCounters 窗口起点累计计数器
 * @param endCounters 窗口终点累计计数器
 * @param startStock 窗口起点存量快照
 * @param endStock 窗口终点存量快照
 */
export function rollupResourceWindow(
  resource: ResourceType,
  t0: number,
  t1: number,
  startCounters: ResourceCounters,
  endCounters: ResourceCounters,
  startStock: ResourceStockSnapshot,
  endStock: ResourceStockSnapshot,
): ResourceAccountingWindow {
  const ticks = Math.max(1, t1 - t0);
  const delta = counterDelta(startCounters, endCounters);
  const inflow = counterInflow(delta);
  const outflow = counterOutflow(delta);
  const netFlow = inflow - outflow;
  const stockStart = stockTotal(startStock);
  const stockEnd = stockTotal(endStock);
  const dStock = stockEnd - stockStart;
  const drift = dStock - netFlow;

  return {
    resource,
    t0,
    t1,
    ticks,
    delta,
    inflow,
    outflow,
    netFlow,
    stockStart,
    stockEnd,
    drift,
    productionRate: delta.produced / ticks,
    consumptionRate: delta.consumed / ticks,
  };
}

/**
 * drift 容差判定：max(floor, throughput × ratio)。
 * 纯函数。
 */
export function resourceDriftLimit(
  w: ResourceAccountingWindow,
  floor: number,
  ratio: number,
): number {
  const throughput = Math.abs(w.inflow) + Math.abs(w.outflow);
  return Math.max(floor, throughput * ratio);
}

/**
 * 判断 drift 是否超容差。纯函数。
 */
export function isResourceDriftExcessive(
  w: ResourceAccountingWindow,
  floor: number,
  ratio: number,
): boolean {
  return Math.abs(w.drift) > resourceDriftLimit(w, floor, ratio);
}

// ─── EMA 速率估算 ──────────────────────────────────────────

/**
 * 生产速率 EMA 更新。纯函数。
 *
 * @param prev 前值（undefined = 首窗直接取现值）
 * @param windowPerTick 本窗每 tick 生产量
 * @param alpha 平滑系数
 */
export function updateProductionRateEma(
  prev: number | undefined,
  windowPerTick: number,
  alpha: number,
): number {
  if (prev === undefined || !Number.isFinite(prev)) return windowPerTick;
  return prev + alpha * (windowPerTick - prev);
}

/**
 * 消费速率 EMA 更新。纯函数。
 */
export function updateConsumptionRateEma(
  prev: number | undefined,
  windowPerTick: number,
  alpha: number,
): number {
  if (prev === undefined || !Number.isFinite(prev)) return windowPerTick;
  return prev + alpha * (windowPerTick - prev);
}

// ─── 多资源账本 ─────────────────────────────────────────────

/**
 * 单资源在帝国级（或房间级）的完整账本条目。
 */
export interface ResourceLedgerEntry {
  /** 资源类型。 */
  resource: ResourceType;
  /** 累计计数器（L1，跨窗连续不清零）。 */
  counters: ResourceCounters;
  /** 最近存量快照。 */
  stock: ResourceStockSnapshot;
  /** 生产速率 EMA（单位/tick）。 */
  productionRate: number | undefined;
  /** 消费速率 EMA（单位/tick）。 */
  consumptionRate: number | undefined;
  /** 最近一窗 drift。 */
  lastDrift: number;
  /** 已预留量（Reservation 锁定）。 */
  reserved: number;
  /** 在途量（Operation 分配中）。 */
  inTransit: number;
}

/** 创建零值账本条目。纯函数。 */
export function emptyLedgerEntry(resource: ResourceType): ResourceLedgerEntry {
  return {
    resource,
    counters: emptyCounters(),
    stock: emptyStock(),
    productionRate: undefined,
    consumptionRate: undefined,
    lastDrift: 0,
    reserved: 0,
    inTransit: 0,
  };
}

/**
 * Resource Ledger — 多资源统一账本。
 *
 * key = ResourceType，value = ResourceLedgerEntry。
 * 一个账本实例可代表一个房间或整个帝国的资源状态。
 */
export type ResourceLedger = Map<ResourceType, ResourceLedgerEntry>;

/**
 * 获取或创建账本条目。纯函数（返回 entry 引用，不存在则创建）。
 */
export function getOrCreateEntry(
  ledger: ResourceLedger,
  resource: ResourceType,
): ResourceLedgerEntry {
  let entry = ledger.get(resource);
  if (!entry) {
    entry = emptyLedgerEntry(resource);
    ledger.set(resource, entry);
  }
  return entry;
}

/**
 * 获取账本条目（不存在返回 undefined）。纯函数。
 */
export function getLedgerEntry(
  ledger: ResourceLedger,
  resource: ResourceType,
): ResourceLedgerEntry | undefined {
  return ledger.get(resource);
}

/**
 * 可调拨量 = stockReserve - reserved - safetyReserve。
 * 纯函数。
 */
export function computeTransferable(
  entry: ResourceLedgerEntry,
  safetyReserve: number,
): number {
  const reserve = stockReserve(entry.stock);
  return Math.max(0, reserve - entry.reserved - safetyReserve);
}

/**
 * 盈余量 = 可调拨量 - expectedDemand。
 * 正值 = 可外送；负值 = 需要调入。
 * 纯函数。
 */
export function computeSurplus(
  entry: ResourceLedgerEntry,
  safetyReserve: number,
  expectedDemand: number,
): number {
  return computeTransferable(entry, safetyReserve) - expectedDemand;
}

/**
 * 缺口量 = safetyReserve + expectedConsumption - stockReserve - inTransit。
 * 正值 = 有缺口；负值 = 无缺口。
 * 纯函数。
 */
export function computeDeficit(
  entry: ResourceLedgerEntry,
  safetyReserve: number,
  expectedConsumption: number,
): number {
  const reserve = stockReserve(entry.stock);
  return Math.max(0, safetyReserve + expectedConsumption - reserve - entry.inTransit);
}

/**
 * 创建空账本。纯函数。
 */
export function createResourceLedger(): ResourceLedger {
  return new Map();
}

/**
 * 从一组资源类型初始化账本（预创建条目）。
 * 纯函数。
 */
export function initResourceLedger(
  resources: readonly ResourceType[],
): ResourceLedger {
  const ledger = new Map<ResourceType, ResourceLedgerEntry>();
  for (const r of resources) {
    ledger.set(r, emptyLedgerEntry(r));
  }
  return ledger;
}

/**
 * 获取账本中所有非零资源类型。纯函数。
 */
export function getActiveResources(ledger: ResourceLedger): ResourceType[] {
  const out: ResourceType[] = [];
  for (const [resource, entry] of ledger) {
    if (stockTotal(entry.stock) > 0 || counterInflow(entry.counters) > 0) {
      out.push(resource);
    }
  }
  return out;
}

/**
 * 帝国级聚合：将多个房间的 ResourceLedger 聚合为帝国级视图。
 * 纯函数。
 */
export function aggregateLedgers(
  roomLedgers: readonly ResourceLedger[],
): ResourceLedger {
  const empire = new Map<ResourceType, ResourceLedgerEntry>();

  for (const roomLedger of roomLedgers) {
    for (const [resource, entry] of roomLedger) {
      const emp = getOrCreateEntry(empire, resource);
      // 累加计数器
      for (const f of Object.keys(emp.counters) as (keyof ResourceCounters)[]) {
        emp.counters[f] += entry.counters[f];
      }
      // 累加存量
      for (const f of Object.keys(emp.stock) as (keyof ResourceStockSnapshot)[]) {
        emp.stock[f] += entry.stock[f];
      }
      // 累加预留和在途
      emp.reserved += entry.reserved;
      emp.inTransit += entry.inTransit;
      // 速率取加权平均（简单平均，后续可按房间权重优化）
      if (entry.productionRate !== undefined) {
        emp.productionRate = (emp.productionRate ?? 0) + entry.productionRate;
      }
      if (entry.consumptionRate !== undefined) {
        emp.consumptionRate = (emp.consumptionRate ?? 0) + entry.consumptionRate;
      }
    }
  }

  return empire;
}
