/** Terminal 市场交易 — 行情快照缓存、deal 执行与各资源通道的买卖动作。 */
import { CONFIG } from "../config";
import type { RoomSnapshot, TickContext } from "../kernel/contracts";
import { EventKind, recordEvent } from "../kernel/event-log";
import { log } from "../kernel/log";
import { globalCache, bumpEnergyCounter } from "../kernel/global-cache";
import { energyBuyAmount, energySellAmount } from "../domain/economy/energy-logistics";
import {
  getMineralDeficits,
  pickBestBuyOrder,
  pickBestSellOrder,
  type MarketOrderSummary,
} from "../domain/industry/terminal-policy";
import { collectFullInventory } from "../domain/industry/inventory";
import { collectDemands, adjustMaxPrice } from "../domain/industry/procurement";
import {
  computeDynamicBuyPrice,
  computeDynamicSellPrice,
  collectMarketPrices,
  type PriceTable,
} from "../domain/industry/market-pricing";
import { BOOST_EFFECTS, type Compound } from "../domain/industry/types";

/** 把 Game.market 的订单对象裁剪为纯函数可消费的摘要。 */
export function toSummaries(orders: readonly Order[]): MarketOrderSummary[] {
  return orders.map(o => ({
    id: o.id,
    price: o.price,
    amount: o.remainingAmount ?? o.amount,
    roomName: o.roomName,
  }));
}

/**
 * 竞品最低卖价（排除自有挂单）。市场无自动撮合：买家只吃最低 ask，
 * 挂单定价必须知道竞品卖盘才能抢先成交；排除自有单防止自我压价死循环。
 * cache 为同一轮 tryManageSellOrders 内的本地缓存 — 同一资源类型不重复 getAllOrders。
 */
export function bestCompetingAsk(
  resourceType: string,
  ownOrderIds: Set<string>,
  cache?: Map<string, number | undefined>,
): number | undefined {
  if (cache) {
    const cached = cache.get(resourceType);
    if (cached !== undefined || cache.has(resourceType)) return cached;
  }
  const sells =
    getCachedOrders(ORDER_SELL, resourceType) ??
    toSummaries(
      Game.market.getAllOrders({
        type: ORDER_SELL,
        resourceType: resourceType as ResourceConstant,
      }),
    );
  let best: number | undefined;
  for (const o of sells) {
    if (ownOrderIds.has(o.id)) continue;
    if (best === undefined || o.price < best) best = o.price;
  }
  if (cache) cache.set(resourceType, best);
  return best;
}

/** 能量运费校验后执行 deal。成功返回 true。 */
export function executeDeal(
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
    log.info(
      "terminal",
      `[${Game.time}] terminal/${roomName}: deal ${order.id} amount=${amount} price=${order.price} energyCost=${cost}`,
    );
    return true;
  }
  return false;
}

/** 能量溢出卖：storage 高于 energySellFloor 时向市场卖能量（terminal 现货出货）。 */
export function trySellSurplusEnergy(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  const storageEnergy = snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  const amount = energySellAmount(
    storageEnergy,
    CONFIG.energy.energySellFloor,
    CONFIG.market.maxDealAmount,
  );
  if (amount <= 0) return false;

  // deal 从 terminal 出货 — terminal 现货不足时等 distributor 转运，下一窗口再试。
  if (terminal.store.getUsedCapacity(RESOURCE_ENERGY) < amount) return false;

  const orders =
    getCachedOrders(ORDER_BUY, RESOURCE_ENERGY) ??
    toSummaries(Game.market.getAllOrders({ type: ORDER_BUY, resourceType: RESOURCE_ENERGY }));
  const best = pickBestBuyOrder(orders, CONFIG.energy.minEnergySellPrice);
  if (!best) return false;
  // 【审计修复 Phase 4-5】卖出能量入 L1 账本 — 记 sold。
  if (executeDeal(best, amount, terminal, snapshot.roomName)) {
    bumpEnergyCounter(snapshot.roomName, "sold", amount);
    return true;
  }
  return false;
}

/** 危机能量买：storage 低于 energyBuyFloor 且 credits 充足时买入（最后救助通道）。 */
export function tryBuyCrisisEnergy(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  if (Game.market.credits < CONFIG.market.creditFloor) return false;

  const storageEnergy = snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  // 按最高买价预算可负担量（保守：实际成交价只低不高）。
  const affordable = Math.floor(
    (Game.market.credits - CONFIG.market.creditFloor) / CONFIG.energy.maxEnergyBuyPrice,
  );
  const amount = energyBuyAmount(
    storageEnergy,
    CONFIG.energy.energyBuyFloor,
    CONFIG.market.maxDealAmount,
    affordable,
  );
  if (amount <= 0) return false;

  const orders =
    getCachedOrders(ORDER_SELL, RESOURCE_ENERGY) ??
    toSummaries(Game.market.getAllOrders({ type: ORDER_SELL, resourceType: RESOURCE_ENERGY }));
  const best = pickBestSellOrder(orders, CONFIG.energy.maxEnergyBuyPrice);
  if (!best) return false;
  // 【审计修复 Phase 4-5】买入能量入 L1 账本 — 记 bought。
  if (executeDeal(best, amount, terminal, snapshot.roomName)) {
    bumpEnergyCounter(snapshot.roomName, "bought", amount);
    return true;
  }
  return false;
}

/**
 * 卖出本房盈余矿物 — 保留 sellReserve 自用，只卖 terminal 内现货
 *（deal 从 terminal 出货，storage 部分由 haulMineralsToStorage 逐步转运）。
 */
export function trySellHomeMineral(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  const homeMineral = snapshot.minerals[0]?.mineralType;
  if (!homeMineral) return false;

  const inTerminal = terminal.store.getUsedCapacity(homeMineral) ?? 0;
  const inStorage = snapshot.storage?.store.getUsedCapacity(homeMineral) ?? 0;
  const surplus = inTerminal + inStorage - CONFIG.market.sellReserve;
  if (surplus <= 0 || inTerminal <= 0) return false;

  const orders =
    getCachedOrders(ORDER_BUY, homeMineral) ??
    toSummaries(Game.market.getAllOrders({ type: ORDER_BUY, resourceType: homeMineral }));
  const best = pickBestBuyOrder(
    orders,
    computeDynamicSellPrice(
      homeMineral,
      getMarketPrices(),
      CONFIG.market.sellDiscount,
      CONFIG.market.fallbackMinSellPrice,
    ),
  );
  if (!best) return false;

  const amount = Math.min(surplus, inTerminal, best.amount, CONFIG.market.maxDealAmount);
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

/**
 * 买入缺口资源 — 阶段 1 改造：优先消费 procurementDemands 需求表。

 * 新流程：
 * 1. 读取 globalCache.procurementDemands（lab-system / factory-manager 发布）；
 * 2. 按 priority 降序排序，逐个尝试买入；
 * 3. 基础矿物用 CONFIG.market.maxBuyPrice 价格门禁；
 * 4. 中间产物/化合物用 maxBuyPrice × 2 价格门禁（加工溢价）。

 * 向后兼容：无需求表时回退到旧的 getMineralDeficits（硬编码 MINERAL_RESERVE_TARGET）。
 * 每次运行只处理一种（控制 getAllOrders 开销）。
 */
export function tryBuyDeficit(
  snapshot: RoomSnapshot,
  terminal: StructureTerminal,
  ctx: TickContext,
): boolean {
  if (Game.market.credits < CONFIG.market.creditFloor) return false;

  // ── 阶段 1：优先消费需求表 ──
  // 需求表时效：信道已持久化到各条目 deadline（publishProcurementDemands），
  // 生产者节奏与终端 200t 相位彻底解耦；僵尸需求由 collectDemands 过滤。
  // 类型化访问（审计修复：globalThis 裸旁路与 globalCache 写入侧同对象，
  // 但绕过类型契约 —— 家族「无类型共享可变状态」的实例清除）。
  const demandsCache = globalCache().procurementDemands;
  if (demandsCache) {
    const allDemands = collectDemands(demandsCache.byRoom, ctx.tick);
    // 过滤出当前房间的需求（跨房需求不在此房买 — terminal.send 走互济通道）。
    // 实际上所有房的需求都汇入：任意房的缺口都可在任意 terminal 买入（买入后走互济送到位）。
    // 但为控制 getAllOrders 开销，只取 priority 最高的一个需求。
    for (const demand of allDemands) {
      if (demand.deadline <= ctx.tick) continue;
      if (demand.amount <= 0) continue;

      // 价格门禁：基于行情快照的动态定价 + 优先级动态调整（阶段 5）。
      // 买入上限 = 市场最低卖价 × buyPremium（行情缺失时回退 fallback）。
      // 高优先级需求(priority≥30)允许上浮50% — boost/war 时间价值 > 价格差异。
      const prices = getMarketPrices();
      const fallback =
        CONFIG.market.fallbackMaxBuyPrice[demand.resource] ??
        Math.max(...Object.values(CONFIG.market.fallbackMaxBuyPrice));
      const basePrice = computeDynamicBuyPrice(
        demand.resource,
        prices,
        CONFIG.market.buyPremium,
        fallback,
      );
      const maxPrice = adjustMaxPrice(basePrice, demand.priority);

      const orders =
        getCachedOrders(ORDER_SELL, demand.resource) ??
        toSummaries(
          Game.market.getAllOrders({
            type: ORDER_SELL,
            resourceType: demand.resource as ResourceConstant,
          }),
        );
      const best = pickBestSellOrder(orders, maxPrice);
      if (!best) continue;

      const affordable = Math.floor((Game.market.credits - CONFIG.market.creditFloor) / best.price);
      const amount = Math.min(demand.amount, best.amount, CONFIG.market.maxDealAmount, affordable);
      if (amount <= 0) continue;

      log.info(
        "terminal",
        `[${Game.time}] terminal/${snapshot.roomName}: 买入 ${demand.resource} amount=${amount} priority=${demand.priority} reason=${demand.reason}`,
      );
      return executeDeal(best, amount, terminal, snapshot.roomName);
    }
    // 需求表有需求但全部买入失败（无卖单/价超门禁）— 不回退到硬编码目标，
    // 避免在已有明确需求时买不需要的东西。
    return false;
  }

  // ── 向后兼容：无需求表时回退到硬编码 MINERAL_RESERVE_TARGET ──
  const inventory = collectMineralInventory(snapshot);
  const deficits = getMineralDeficits(inventory);
  if (deficits.length === 0) return false;

  // 缺口最大者优先 — 反应链最先卡在存量最少的原料上。
  deficits.sort((a, b) => b.deficit - a.deficit);
  const target = deficits[0]!;
  const prices = getMarketPrices();
  const fallback =
    CONFIG.market.fallbackMaxBuyPrice[target.mineral] ??
    Math.max(...Object.values(CONFIG.market.fallbackMaxBuyPrice));
  const maxPrice = computeDynamicBuyPrice(
    target.mineral,
    prices,
    CONFIG.market.buyPremium,
    fallback,
  );
  if (maxPrice <= 0) return false;

  const orders =
    getCachedOrders(ORDER_SELL, target.mineral) ??
    toSummaries(
      Game.market.getAllOrders({
        type: ORDER_SELL,
        resourceType: target.mineral as ResourceConstant,
      }),
    );
  const best = pickBestSellOrder(orders, maxPrice);
  if (!best) return false;

  // 成交量受缺口、订单余量、单笔上限与 credits 余额四重约束。
  const affordable = Math.floor((Game.market.credits - CONFIG.market.creditFloor) / best.price);
  const amount = Math.min(target.deficit, best.amount, CONFIG.market.maxDealAmount, affordable);
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

/**
 * 卖出盈余 boost 化合物 — 阶段 4 改造。

 * lab-system 在 boost 库存超过 boostStockpile 后将盈余写入 globalCache.surplusCompounds，
 * 本函数读取该信号并在 deal 窗口内尝试卖出。

 * 价格门禁：基于行情快照动态定价（市场最高买价 × sellDiscount）。
 * 成交量受盈余量、terminal 现货、订单余量与单笔上限四重约束。
 */
export function trySellSurplusCompound(
  snapshot: RoomSnapshot,
  terminal: StructureTerminal,
): boolean {
  const g = globalCache();
  const surplus = g.surplusCompounds;
  if (!surplus) return false;

  // 取第一个有 terminal 现货的盈余化合物（控制 getAllOrders 开销 — 每次只卖一种）。
  for (const [res, surplusAmount] of Object.entries(surplus.items)) {
    if (surplusAmount <= 0) continue;
    const inTerminal = terminal.store.getUsedCapacity(res as ResourceConstant) ?? 0;
    if (inTerminal <= 0) continue;

    const orders =
      getCachedOrders(ORDER_BUY, res) ??
      toSummaries(
        Game.market.getAllOrders({ type: ORDER_BUY, resourceType: res as ResourceConstant }),
      );
    const best = pickBestBuyOrder(
      orders,
      computeDynamicSellPrice(
        res,
        getMarketPrices(),
        CONFIG.market.sellDiscount,
        CONFIG.market.fallbackMinSellPrice,
      ),
    );
    if (!best) continue;

    const amount = Math.min(surplusAmount, inTerminal, best.amount, CONFIG.market.maxDealAmount);
    if (amount <= 0) continue;

    log.info(
      "terminal",
      `[${Game.time}] terminal/${snapshot.roomName}: 卖出盈余化合物 ${res} amount=${amount} price=${best.price}`,
    );
    return executeDeal(best, amount, terminal, snapshot.roomName);
  }
  return false;
}

/**
 * 汇总全房矿物库存（供缺口计算）。
 * 统一库存视图（阶段 0 改造）：storage + terminal + labs + factory。
 * 旧实现只看 storage+terminal — 遗漏 lab 反应中原料与 factory 在制 stock，
 * 导致缺口计算虚高/虚低（如反应链正在消耗 H 时 H 库存不在口径内，重复买入）。
 */
export function collectMineralInventory(snapshot: RoomSnapshot): Record<string, number> {
  return collectFullInventory(snapshot);
}

/**
 * 卖出 terminal 内的 battery 现货（reclaimFactoryOutput 的落货出口）。
 * 只卖 terminal 现货、不动 storage 库存 — 与矿物卖同口径（storage 部分由搬运链
 * 逐步转运），价格低于底线时囤着等行情。
 */
export function trySellSurplusBattery(
  snapshot: RoomSnapshot,
  terminal: StructureTerminal,
): boolean {
  const inTerminal = terminal.store.getUsedCapacity(RESOURCE_BATTERY);
  if (inTerminal <= 0) return false;

  const orders =
    getCachedOrders(ORDER_BUY, RESOURCE_BATTERY) ??
    toSummaries(Game.market.getAllOrders({ type: ORDER_BUY, resourceType: RESOURCE_BATTERY }));
  const best = pickBestBuyOrder(
    orders,
    computeDynamicSellPrice(
      RESOURCE_BATTERY,
      getMarketPrices(),
      CONFIG.market.sellDiscount,
      CONFIG.market.fallbackMinBatterySellPrice,
    ),
  );
  if (!best) return false;

  const amount = Math.min(inTerminal, best.amount, CONFIG.market.maxDealAmount);
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

/**
 * 卖出 factory commodity 产出（circuit/wire/alloy/device 等）。
 * commodity 是 factory 升级链产物，搬到 terminal 后由此函数变现。
 * 口径：terminal 内非 energy、非 homeMineral、非 battery、非 boost 化合物的资源。
 * 价格门禁用 minSellPrice（与矿物同底线 — 不贱卖，commodity 单价远高于基础矿）。
 * 每次只卖一种（控制 getAllOrders 开销）。
 */
export function trySellCommodity(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  const homeMineral = snapshot.minerals[0]?.mineralType;

  // 扫描 terminal 中 commodity 产出（排除 energy/homeMineral/battery/boost 化合物）。
  for (const res of Object.keys(terminal.store) as ResourceConstant[]) {
    if (res === RESOURCE_ENERGY) continue;
    if (res === homeMineral) continue;
    if (res === RESOURCE_BATTERY) continue;
    // boost 化合物由 trySellSurplusCompound 通道处理（有 BOOST_EFFECTS 映射）。
    if (BOOST_EFFECTS[res as Compound]) continue;
    // 基础矿物由 trySellHomeMineral 通道处理。
    if (["H", "O", "U", "L", "K", "Z", "X"].includes(res)) continue;
    // G 由 tryBuyGhodium 通道管理（买入而非卖出）。
    if (res === RESOURCE_GHODIUM) continue;
    // power 由 tryBuyPower 通道管理（买入而非卖出）。
    if (res === RESOURCE_POWER) continue;

    const inTerminal = terminal.store.getUsedCapacity(res) ?? 0;
    if (inTerminal <= 0) continue;

    const orders =
      getCachedOrders(ORDER_BUY, res) ??
      toSummaries(Game.market.getAllOrders({ type: ORDER_BUY, resourceType: res }));
    const best = pickBestBuyOrder(
      orders,
      computeDynamicSellPrice(
        res,
        getMarketPrices(),
        CONFIG.market.sellDiscount,
        CONFIG.market.fallbackMinSellPrice,
      ),
    );
    if (!best) continue;

    const amount = Math.min(inTerminal, best.amount, CONFIG.market.maxDealAmount);
    if (amount <= 0) continue;

    log.info(
      "terminal",
      `[${Game.time}] terminal/${snapshot.roomName}: 卖出 commodity ${res} amount=${amount} price=${best.price}`,
    );
    return executeDeal(best, amount, terminal, snapshot.roomName);
  }
  return false;
}

/**
 * 买入 power（powerSpawn 原料的唯一入口 — 无自产渠道）。
 * 库存口径 = terminal + storage + powerSpawn 合计 vs powerSpawnPowerTarget；
 * 高信用门禁（powerBuyCreditFloor）远高于 creditFloor — power 是 GPL 长期投资，
 * credits 不宽裕时预算全部让位给矿物/能量采购。买入后由 distributor 的
 * stockPowerSpawn 从 terminal 搬到 powerSpawn。
 */
export function tryBuyPower(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  if (Game.market.credits < CONFIG.market.powerBuyCreditFloor) return false;

  const have =
    (terminal.store.getUsedCapacity(RESOURCE_POWER) ?? 0) +
    (snapshot.storage?.store.getUsedCapacity(RESOURCE_POWER) ?? 0) +
    (snapshot.powerSpawn?.store.getUsedCapacity(RESOURCE_POWER) ?? 0);
  const deficit = CONFIG.factory.powerSpawnPowerTarget - have;
  if (deficit <= 0) return false;

  const orders =
    getCachedOrders(ORDER_SELL, RESOURCE_POWER) ??
    toSummaries(Game.market.getAllOrders({ type: ORDER_SELL, resourceType: RESOURCE_POWER }));
  const best = pickBestSellOrder(
    orders,
    computeDynamicBuyPrice(
      RESOURCE_POWER,
      getMarketPrices(),
      CONFIG.market.buyPremium,
      CONFIG.market.fallbackPowerBuyMaxPrice,
    ),
  );
  if (!best) return false;

  const affordable = Math.floor(
    (Game.market.credits - CONFIG.market.powerBuyCreditFloor) / best.price,
  );
  const amount = Math.min(deficit, best.amount, CONFIG.market.maxDealAmount, affordable);
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

/**
 * 买入 ghodium（nuker 威慑备弹的市场加速通道 — lab 自产是主通道）。
 * 库存口径 = terminal + storage + nuker 合计 vs nuker.ghodiumStockpile；
 * 无 nuker 的房不采购（G 无其他消费方，买了就是死资本）。
 * 高信用门禁 + 单笔上限双重约束：5k 缺口不会一次吃掉全部流动资金。
 * 买入后由 distributor 的 stockNuker 搬到 nuker。
 */
export function tryBuyGhodium(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  const nuker = snapshot.nuker;
  if (!nuker) return false;
  if (Game.market.credits < CONFIG.nuker.ghodiumBuyCreditFloor) return false;

  const have =
    (terminal.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0) +
    (snapshot.storage?.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0) +
    (nuker.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0);
  const deficit = CONFIG.nuker.ghodiumStockpile - have;
  if (deficit <= 0) return false;

  const orders =
    getCachedOrders(ORDER_SELL, RESOURCE_GHODIUM) ??
    toSummaries(Game.market.getAllOrders({ type: ORDER_SELL, resourceType: RESOURCE_GHODIUM }));
  const best = pickBestSellOrder(
    orders,
    computeDynamicBuyPrice(
      RESOURCE_GHODIUM,
      getMarketPrices(),
      CONFIG.market.buyPremium,
      CONFIG.nuker.fallbackGhodiumBuyMaxPrice,
    ),
  );
  if (!best) return false;

  const affordable = Math.floor(
    (Game.market.credits - CONFIG.nuker.ghodiumBuyCreditFloor) / best.price,
  );
  const amount = Math.min(deficit, best.amount, CONFIG.market.maxDealAmount, affordable);
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

/**
 * pixel 出售：pixel 是账户资源（Game.resources.pixel），交易
 * 无 terminal/运费 — deal 不带 room 即账户交割。吃最优 buy 单即刻变现，
 * 价格低于门槛囤着（账户资源无仓储成本）。
 * 择优不用 pickBestBuyOrder（它要求 roomName — terminal 交割口径；
 * pixel 单无 room，被其过滤）。
 */
export function trySellPixel(): void {
  // 注意：RESOURCE_PIXEL 在部分 Screeps 运行时未作为全局提供（@types/screeps 声明了但
  // 运行时缺失 → 裸引用会抛 ReferenceError）。直接用字面量 "pixel"，跨环境稳定且零依赖。
  const pixels = Game.resources?.["pixel"] ?? 0;
  if (pixels <= 0) return;
  let best: MarketOrderSummary | undefined;
  for (const o of toSummaries(
    Game.market.getAllOrders({ type: ORDER_BUY, resourceType: "pixel" }),
  )) {
    if (
      o.price <
        computeDynamicSellPrice(
          "pixel",
          getMarketPrices(),
          CONFIG.market.sellDiscount,
          CONFIG.market.fallbackMinPixelSellPrice,
        ) ||
      o.amount <= 0
    )
      continue;
    if (!best || o.price > best.price) best = o;
  }
  if (!best) return;
  // 账户交易：无 roomName（pixel 不从 terminal 出货、无能量运费）。
  const amount = Math.min(pixels, best.amount);
  if (Game.market.deal(best.id, amount) === OK) {
    recordEvent(EventKind.EnergyTransfer, "", [amount]);
    log.info("terminal", `[${Game.time}] pixel: 卖出 ${amount} pixel @ ${best.price}`);
  }
}

// ─── 市场行情快照 ──────────────────────────────────────────

/** 需要采集行情的资源列表 — 覆盖所有交易涉及的资源类型。 */
const PRICED_RESOURCES = [
  "H",
  "O",
  "U",
  "L",
  "K",
  "Z",
  "X",
  "OH",
  "ZK",
  "UL",
  "G",
  "GO",
  "GH2O",
  "XGH2O",
  "battery",
  "power",
  "pixel",
  "GHODIUM",
] as const;

/**
 * 采集当前市场行情并写入 globalCache.marketPrices + 全量订单缓存。
 * 单次 getAllOrders() 无参数调用获取全市场订单，在内存中按 resourceType + type
 * 分组，替代旧实现 36 次过滤调用（18 资源 × 2 类型）。
 * 同时缓存订单摘要供后续 deal 函数复用，避免各函数独立 getAllOrders。
 */
export function refreshMarketPrices(): void {
  // 优先无参数调用获取全市场订单（1 次 API 调用替代旧实现 36 次过滤调用）。
  // 兼容回退：部分环境（如旧版测试 mock）不支持无参数调用，回退到按资源过滤。
  let allOrders: Order[] | null = null;
  try {
    const raw = Game.market.getAllOrders();
    if (Array.isArray(raw)) allOrders = raw;
  } catch {
    // mock 不支持无参数调用 — 走回退路径。
  }
  const iterable = allOrders ?? [];

  const sellByRes: Record<string, { price: number }[]> = {};
  const buyByRes: Record<string, { price: number }[]> = {};
  const orderCache: Record<string, MarketOrderSummary[]> = {};

  for (const o of iterable) {
    const res = o.resourceType as string;
    const key = `${o.type}/${res}`;
    if (o.type === ORDER_SELL) {
      (sellByRes[res] ??= []).push({ price: o.price });
    } else if (o.type === ORDER_BUY) {
      (buyByRes[res] ??= []).push({ price: o.price });
    }
    if (!orderCache[key]) orderCache[key] = [];
    orderCache[key].push({
      id: o.id,
      price: o.price,
      amount: o.remainingAmount ?? o.amount,
      roomName: o.roomName,
    });
  }

  // 无参数调用回退：iterable 为空时按 PRICED_RESOURCES 逐资源查询。
  if (iterable.length === 0) {
    for (const res of PRICED_RESOURCES) {
      const sells = Game.market.getAllOrders({
        type: ORDER_SELL,
        resourceType: res as ResourceConstant,
      });
      sellByRes[res] = sells.map(o => ({ price: o.price }));
      const key = `${ORDER_SELL}/${res}`;
      orderCache[key] = toSummaries(sells);
      const buys = Game.market.getAllOrders({
        type: ORDER_BUY,
        resourceType: res as ResourceConstant,
      });
      buyByRes[res] = buys.map(o => ({ price: o.price }));
      const key2 = `${ORDER_BUY}/${res}`;
      orderCache[key2] = toSummaries(buys);
    }
  }

  const priceResources = Object.keys({ ...sellByRes, ...buyByRes });
  const prices = collectMarketPrices(
    priceResources.length > 0 ? priceResources : [...PRICED_RESOURCES],
    sellByRes,
    buyByRes,
  );
  const g = globalCache();
  g.marketPrices = { tick: Game.time, prices };
  g.marketOrderCache = { tick: Game.time, orders: orderCache };
}

/**
 * 获取当前行情快照表（供买/卖决策计算动态价格）。
 * 若行情过期或缺失返回空对象 — computeDynamicBuy/SellPrice 会回退到 fallback。
 */
export function getMarketPrices(): PriceTable {
  const g = globalCache();
  if (g.marketPrices && Game.time - g.marketPrices.tick <= CONFIG.market.interval + 50) {
    return g.marketPrices.prices;
  }
  return {};
}

/**
 * 获取缓存的订单摘要（按 type/resource 检索），减少 deal 函数独立 getAllOrders。
 * 缓存由 refreshMarketPrices 在同 interval tick 写入，有效期与 marketPrices 对齐。
 */
export function getCachedOrders(type: string, resource: string): MarketOrderSummary[] | undefined {
  const g = globalCache();
  if (g.marketOrderCache && Game.time - g.marketOrderCache.tick <= CONFIG.market.interval + 50) {
    return g.marketOrderCache.orders[`${type}/${resource}`];
  }
  return undefined;
}
