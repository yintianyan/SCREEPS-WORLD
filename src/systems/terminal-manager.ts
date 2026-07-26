/**
 * Terminal Manager — P3 系统，市场贸易的唯一 Game.market 调用点。
 *
 * 战略定位：单房间只产一种矿物，lab 反应链需要多矿种原料。
 * 在多房间互济接入前，市场是唯一的原料来源；而买入需要 credits，
 * credits 的唯一收入是卖出本房盈余矿物 — 因此必须双向交易才能形成闭环：
 *
 *   extractor → 本房矿物 → terminal（haulMineralsToStorage 已优先存 terminal）
 *     → 卖出盈余换 credits → 买入缺口矿物 → supplyLabs（terminal 回退）→ lab 反应链
 *
 * 能量运费：deal 无论买卖都从本方 terminal 扣能量
 *（calcTransactionCost），由 distributor 的 stockTerminalEnergy 维持储备。
 *
 * 节流设计：
 *   - interval 200 tick + bucket 门禁 — getAllOrders 是重调用 [Facts]
 *   - 每次运行每房最多 1 单（terminal 有 deal 冷却），全局引擎上限 10 单/tick [Facts]
 *   - 私服无市场 API 时整体跳过（与 pixel-system 同款守卫）
 */
import { CONFIG } from "../config";
import type { Priority, RoomSnapshot, System, TickContext } from "../kernel/contracts";
import {
  getMineralDeficits,
  pickBestBuyOrder,
  pickBestSellOrder,
  type MarketOrderSummary,
} from "../domain/industry/terminal-policy";

export const terminalManagerSystem: System = {
  name: "terminal-manager",
  priority: 3 as Priority,
  interval: CONFIG.market.interval,
  run(ctx: TickContext): void {
    // 私服/测试环境无市场 API — 安全跳过。
    if (typeof Game.market?.getAllOrders !== "function") return;
    // 贸易不是生存关键：仅在 CPU 富余时运行。
    if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded") return;
    if ((Game.cpu.bucket ?? 0) < CONFIG.market.minBucket) return;

    for (const snapshot of ctx.snapshots()) {
      const terminal = snapshot.terminal;
      if (!terminal) continue;
      if (terminal.cooldown > 0) continue;

      // 1. 先卖后买：卖出是 credits 的唯一来源，信用地板前必须先有收入。
      if (trySellHomeMineral(snapshot, terminal)) continue; // 本次冷却窗口已用掉

      // 2. 买入缺口矿物（credits 允许时）。
      tryBuyDeficit(snapshot, terminal);
    }
  },
};

/** 把 Game.market 的订单对象裁剪为纯函数可消费的摘要。 */
function toSummaries(orders: readonly Order[]): MarketOrderSummary[] {
  return orders.map(o => ({
    id: o.id,
    price: o.price,
    amount: o.remainingAmount ?? o.amount,
    roomName: o.roomName,
  }));
}

/** 能量运费校验后执行 deal。成功返回 true。 */
function executeDeal(
  order: MarketOrderSummary,
  amount: number,
  terminal: StructureTerminal,
  roomName: string,
): boolean {
  if (amount <= 0 || !order.roomName) return false;
  const cost = Game.market.calcTransactionCost(amount, roomName, order.roomName);
  if (cost > terminal.store.getUsedCapacity(RESOURCE_ENERGY)) return false;
  const result = Game.market.deal(order.id, amount, roomName);
  if (result === OK) {
    console.log(
      `[${Game.time}] terminal/${roomName}: deal ${order.id} amount=${amount} price=${order.price} energyCost=${cost}`,
    );
    return true;
  }
  return false;
}

/**
 * 卖出本房盈余矿物 — 保留 sellReserve 自用，只卖 terminal 内现货
 *（deal 从 terminal 出货，storage 部分由 haulMineralsToStorage 逐步转运）。
 */
function trySellHomeMineral(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  const homeMineral = snapshot.minerals[0]?.mineralType;
  if (!homeMineral) return false;

  const inTerminal = terminal.store.getUsedCapacity(homeMineral) ?? 0;
  const inStorage = snapshot.storage?.store.getUsedCapacity(homeMineral) ?? 0;
  const surplus = inTerminal + inStorage - CONFIG.market.sellReserve;
  if (surplus <= 0 || inTerminal <= 0) return false;

  const orders = toSummaries(
    Game.market.getAllOrders({ type: ORDER_BUY, resourceType: homeMineral }),
  );
  const best = pickBestBuyOrder(orders, CONFIG.market.minSellPrice);
  if (!best) return false;

  const amount = Math.min(surplus, inTerminal, best.amount, CONFIG.market.maxDealAmount);
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

/** 买入库存缺口最大的一种基础矿物（每次运行只处理一种，控制 getAllOrders 开销）。 */
function tryBuyDeficit(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  if (Game.market.credits < CONFIG.market.creditFloor) return false;

  const inventory = collectMineralInventory(snapshot);
  const deficits = getMineralDeficits(inventory);
  if (deficits.length === 0) return false;

  // 缺口最大者优先 — 反应链最先卡在存量最少的原料上。
  deficits.sort((a, b) => b.deficit - a.deficit);
  const target = deficits[0]!;
  const maxPrice = CONFIG.market.maxBuyPrice[target.mineral];
  if (maxPrice === undefined) return false;

  const orders = toSummaries(
    Game.market.getAllOrders({ type: ORDER_SELL, resourceType: target.mineral as ResourceConstant }),
  );
  const best = pickBestSellOrder(orders, maxPrice);
  if (!best) return false;

  // 成交量受缺口、订单余量、单笔上限与 credits 余额四重约束。
  const affordable = Math.floor((Game.market.credits - CONFIG.market.creditFloor) / best.price);
  const amount = Math.min(target.deficit, best.amount, CONFIG.market.maxDealAmount, affordable);
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

/** 汇总 storage + terminal 的矿物库存（供缺口计算）。 */
function collectMineralInventory(snapshot: RoomSnapshot): Record<string, number> {
  const inventory: Record<string, number> = {};
  const stores = [snapshot.storage?.store, snapshot.terminal?.store];
  for (const store of stores) {
    if (!store) continue;
    for (const resource of Object.keys(store) as ResourceConstant[]) {
      if (resource === RESOURCE_ENERGY) continue;
      inventory[resource] = (inventory[resource] ?? 0) + (store[resource] ?? 0);
    }
  }
  return inventory;
}
