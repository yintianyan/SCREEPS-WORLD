/**
 * terminal 出口车道决策（Phase B）。
 *
 * 双向：
 * - `trim`：terminal 内某资源超过配额 → 搬回 storage（terminal 是 300K 共享瓶颈，
 *   W8N3 实测 battery 占 70%，不清退则一切贸易/工业落地都被挤死）。
 * - `export`：storage 有货、terminal 配额还有空间、且存在真实出口需求 → 搬进 terminal。
 *
 * 「真实出口需求」只有两种：跨房援助/计划驱动的 `aid`，与市场买盘的 `sell`。
 * 没有 ticket 的资源不搬 —— 否则只是把沉淀从 storage 转移到 terminal。
 *
 * 纯函数：不访问 Game/Memory/globalCache，输入由动作层采集。
 */
import {
  classifyFlowResource,
  getResourceBufferCap,
  getResourceContract,
} from "./resource-contract";

/** 出口票据方向。 */
export type TerminalLaneDirection = "trim" | "export";

/** 出口票据来源：超配额清退 / 跨房需求 / 市场买盘。 */
export type TerminalLaneReason = "trim" | "aid" | "sell";

/** 一张出口票据。 */
export interface TerminalLaneTicket {
  direction: TerminalLaneDirection;
  resource: string;
  amount: number;
  reason: TerminalLaneReason;
}

/** 跨房需求（由 terminal-manager 从援助/计划驱动发送中采集）。 */
export interface TerminalLaneNeed {
  resource: string;
  amount: number;
}

/** 决策输入 — 全部为纯数据。 */
export interface TerminalLaneInput {
  /** storage 的资源存量表。 */
  storageStocks: Readonly<Record<string, number>>;
  /** terminal 的资源存量表。 */
  terminalStocks: Readonly<Record<string, number>>;
  /** terminal 当前剩余容量（getFreeCapacity 无参口径）。 */
  terminalFree: number;
  /** 本房 home mineral（用于判定 sellReserve 保留）。 */
  homeMineral?: string;
  /** 当前存在真实买盘的资源集合。 */
  buyOrderResources: ReadonlySet<string>;
  /** lab-system 发布的化合物盈余表；缺省表示无盈余信号。 */
  surplusCompounds?: Readonly<Record<string, number>>;
  /** 跨房援助/计划驱动的出口需求。 */
  aidNeeds?: readonly TerminalLaneNeed[];
  /** terminal 必须保留的空格（CONFIG.market.buyFreeCapacityFloor）。 */
  reserveFree: number;
  /** home mineral 的卖出保留量（CONFIG.market.sellReserve）。 */
  sellReserve: number;
}

/**
 * storage 中该资源「可以搬走」的数量。
 *
 * 保留口径按契约：
 * - home mineral 保留 sellReserve（自用反应原料），其他基础矿物保留 criticalWater；
 * - battery 保留 criticalWater（战略储备底仓）；
 * - 化合物只在 lab-system 发布盈余时搬（无盈余信号 = 不搬）；
 * - commodity 无本地消费者，全部可搬；
 * - energy/power/G/ops/pixel 不走本车道（各有专属链路）。
 */
function exportableFromStorage(resource: string, input: TerminalLaneInput): number {
  const stored = input.storageStocks[resource] ?? 0;
  if (stored <= 0) return 0;

  switch (classifyFlowResource(resource)) {
    case "baseMineral": {
      const reserve =
        input.homeMineral === resource
          ? input.sellReserve
          : getResourceContract(resource).criticalWater;
      return Math.max(0, stored - reserve);
    }
    case "battery":
      return Math.max(0, stored - getResourceContract(resource).criticalWater);
    case "compound": {
      const surplus = input.surplusCompounds?.[resource];
      if (surplus === undefined || surplus <= 0) return 0;
      return Math.min(stored, surplus);
    }
    case "commodity":
    case "rawCommodity":
      return stored;
    default:
      return 0;
  }
}

/**
 * 允许被 terminal 配额强制清退的资源类别。
 *
 * 只含「贸易/工业出口型」资源。G/power/energy 刻意排除：
 * - energy 由 stockTerminalEnergy 独立管理（贸易运费储备）；
 * - G/power 是战略物资，terminal 只是中转，清退到 storage 会造成两仓来回搬。
 */
const TRIMMABLE_CLASSES: ReadonlySet<string> = new Set([
  "battery",
  "baseMineral",
  "compound",
  "commodity",
  "rawCommodity",
]);

/**
 * 规划本房的 terminal 车道票据。
 *
 * 顺序即优先级：trim（腾容量）→ aid（已成立的外部需求）→ sell（市场买盘）。
 * 多个 export 票据共享 `terminalFree - reserveFree`，不会合计超出空间。
 */
export function planTerminalLane(input: TerminalLaneInput): TerminalLaneTicket[] {
  const tickets: TerminalLaneTicket[] = [];

  // ── 1. trim：terminal 超配额 ──
  for (const [resource, quantity] of Object.entries(input.terminalStocks)) {
    if (resource === "energy" || quantity <= 0) continue;
    if (!TRIMMABLE_CLASSES.has(classifyFlowResource(resource))) continue;
    const cap = getResourceBufferCap(resource, "terminal")?.soft;
    // 未登记配额的资源不强制清退（避免把 power/G 等战略物资赶出 terminal）。
    if (cap === undefined || quantity <= cap) continue;
    tickets.push({
      direction: "trim",
      resource,
      amount: quantity - cap,
      reason: "trim",
    });
  }

  // ── 2. export：需要 terminal 空间 ──
  let remainingFree = Math.max(0, input.terminalFree - input.reserveFree);
  if (remainingFree <= 0) return tickets;

  const pushed = new Map<string, number>();
  const addExport = (resource: string, requested: number, reason: "aid" | "sell"): void => {
    if (requested <= 0 || remainingFree <= 0) return;
    const cap = getResourceBufferCap(resource, "terminal")?.soft;
    if (cap === undefined) return;

    const already = pushed.get(resource) ?? 0;
    const terminalNow = (input.terminalStocks[resource] ?? 0) + already;
    const quotaFree = Math.max(0, cap - terminalNow);
    const storageFree = exportableFromStorage(resource, input) - already;
    const amount = Math.min(requested, storageFree, quotaFree, remainingFree);
    if (amount <= 0) return;

    remainingFree -= amount;
    pushed.set(resource, already + amount);
    tickets.push({ direction: "export", resource, amount, reason });
  };

  // 2a. 跨房需求优先（援助是已经成立的外部缺口）。
  for (const need of input.aidNeeds ?? []) {
    addExport(need.resource, need.amount, "aid");
  }

  // 2b. 市场买盘。排序保证确定性（Set 迭代顺序依写入顺序，不可作为行为契约）。
  const sellable = [...input.buyOrderResources].sort();
  for (const resource of sellable) {
    addExport(resource, Number.MAX_SAFE_INTEGER, "sell");
  }

  return tickets;
}

/** 取第一张指定方向的票据（动作层只执行一张）。纯函数。 */
export function firstTicketOf(
  tickets: readonly TerminalLaneTicket[],
  direction: TerminalLaneDirection,
): TerminalLaneTicket | undefined {
  return tickets.find(t => t.direction === direction);
}
