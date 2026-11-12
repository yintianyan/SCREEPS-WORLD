/**
 * 市场买盘出口判定（Phase C）。
 *
 * 用于停止阀：只有「缓存新鲜且确实存在数量 > 0 的买单」才算可判定的出口。
 * 缓存缺失或过期 → unknown（判不了 ≠ 该拦），保持旧行为，避免把首次运行/
 * global reset 的行情空窗误读成「没有买盘」而停掉整条生产线。
 */
import type { MarketOrderSummary } from "./terminal-policy";

/** globalCache.marketOrderCache 的只读视图。 */
export interface MarketOrderCacheView {
  tick: number;
  orders: Record<string, readonly MarketOrderSummary[]>;
}

/** 买盘出口状态：yes=存在真实买单；no=缓存新鲜但无买单；unknown=判不了。 */
export type MarketOutletState = "yes" | "no" | "unknown";

const EMPTY_RESOURCE_SET: ReadonlySet<string> = new Set<string>();

/** 单资源买盘判定。纯函数。 */
export function marketOutletState(
  resource: string,
  cache: MarketOrderCacheView | undefined,
  currentTick: number,
  maxAge: number,
): MarketOutletState {
  if (!cache || currentTick - cache.tick > maxAge) return "unknown";
  const orders = cache.orders[`buy/${resource}`] ?? [];
  return orders.some(order => order.amount > 0) ? "yes" : "no";
}

/** 缓存新鲜时提取所有有买盘的资源；过期/缺失返回空集合。纯函数。 */
export function collectBuyOrderResources(
  cache: MarketOrderCacheView | undefined,
  currentTick: number,
  maxAge: number,
): ReadonlySet<string> {
  if (!cache || currentTick - cache.tick > maxAge) return EMPTY_RESOURCE_SET;
  const resources = new Set<string>();
  for (const [key, orders] of Object.entries(cache.orders)) {
    if (!key.startsWith("buy/")) continue;
    if (!orders.some(order => order.amount > 0)) continue;
    resources.add(key.slice("buy/".length));
  }
  return resources;
}
