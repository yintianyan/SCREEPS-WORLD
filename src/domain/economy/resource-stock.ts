/**
 * 房间资源库存聚合（Phase A）。
 *
 * 口径与《资源流契约表》§1.4 一致：
 * stock = storage + terminal + factory + labs + containers。
 *
 * link/spawn/extension/tower 属于运营缓冲区，逐 tick 被消费或回填，
 * 不计入「长周期库存」；把它们算进来会让 energy 的 stockTicks 虚高。
 */
import type { RoomSnapshot } from "../../kernel/contracts";

type StoreView = Readonly<Record<string, unknown>>;

/** 把一个 store 的数值型资源累加进 stocks；方法与零值自动跳过。 */
function addStore(stocks: Record<string, number>, store: unknown): void {
  if (store === undefined || store === null) return;
  for (const [resource, amount] of Object.entries(store as StoreView)) {
    if (typeof amount !== "number" || amount <= 0) continue;
    stocks[resource] = (stocks[resource] ?? 0) + amount;
  }
}

/**
 * 聚合房间的长周期资源库存。
 * 只读快照，不访问 Game/Memory；纯函数。
 */
export function collectRoomResourceStocks(snapshot: RoomSnapshot): Record<string, number> {
  const stocks: Record<string, number> = {};
  addStore(stocks, snapshot.storage?.store);
  addStore(stocks, snapshot.terminal?.store);
  addStore(stocks, snapshot.factory?.store);
  for (const lab of snapshot.labs) addStore(stocks, lab.store);
  for (const container of snapshot.containers) addStore(stocks, container.store);
  return stocks;
}

/** 单资源的窗口净流量。 */
export interface ResourceStockFlow {
  resource: string;
  /** 窗口末库存。 */
  stock: number;
  /** 正增量折算的流入速率（单位/tick）。 */
  inflowPerTick: number;
  /** 负增量折算的流出速率（单位/tick）。 */
  outflowPerTick: number;
}

/**
 * 用相邻两窗库存快照做差，得到每资源净流量。
 *
 * 口径声明：这里只有**净额**。同一窗内进 10 出 10 会读作流量 0 —— 对 stuck 判定
 * 而言这个方向是安全的（"在流动"），但不足以解释吞吐；需要吞吐时另设仪器。
 * 只在两份快照都存在时调用（系统层负责首窗只播种基线）。
 */
export function diffResourceStocks(
  previous: Readonly<Record<string, number>> | undefined,
  current: Readonly<Record<string, number>>,
  elapsedTicks: number,
): ResourceStockFlow[] {
  const elapsed = Math.max(1, elapsedTicks);
  const resources = new Set([...Object.keys(previous ?? {}), ...Object.keys(current)]);
  const flows: ResourceStockFlow[] = [];
  for (const resource of resources) {
    const stock = Math.max(0, current[resource] ?? 0);
    const before = Math.max(0, previous?.[resource] ?? 0);
    const delta = stock - before;
    flows.push({
      resource,
      stock,
      inflowPerTick: delta > 0 ? delta / elapsed : 0,
      outflowPerTick: delta < 0 ? -delta / elapsed : 0,
    });
  }
  return flows;
}
