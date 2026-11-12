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
