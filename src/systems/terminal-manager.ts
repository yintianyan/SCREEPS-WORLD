/**
 * Terminal Manager — P3 系统，terminal 业务的唯一属主：
 * 市场贸易（Game.market.deal）+ 帝国能量/矿物互济（terminal.send）+ 能量市场交易（R5）。
 *
 * 战略定位：单房间只产一种矿物，lab 反应链需多矿种原料 — 互济接入前市场是唯一原料来源，
 * 而买入需要 credits，credits 唯一收入是卖出盈余矿物，故必须双向交易才能闭环：
 * extractor → terminal → 卖盈余换 credits → 买缺口矿物 → supplyLabs（terminal 回退）。
 *
 * 每轮执行顺序（= 优先级）：0. 跨房能量互济（planEnergyAid 纯函数，地板迟滞防震荡，
 * 殖民生存优先于交易收入）→ 0.5 跨房矿物互济（planMineralAid，姐妹房 homeMineral
 * 盈余先于市场买入 — 省 credits）→ 1. 能量溢出卖（storage > energySellFloor，RCL8 后
 * 能量是最大出口，价格底线 minEnergySellPrice）→ 2. 矿物卖 → 2.5 battery 卖（满仓溢能
 * 的压缩资产变现）→ 3. 危机能量买（storage < energyBuyFloor，价格上限
 * maxEnergyBuyPrice，高于此价宁可压缩运营）→ 4. 缺口矿物买 → 5. power 买（高信用
 * 门禁 powerBuyCreditFloor — GPL 长期投资，不许挤占生存采购预算）。
 *
 * 节流：interval 200 + bucket 门禁（getAllOrders 是重调用 [Facts]）；每房每轮最多 1 单
 * （terminal 有 deal 冷却），全局引擎上限 10 单/tick [Facts]；私服无市场 API 时跳过
 * （互济不受此限 — terminal.send 不依赖市场订单，仅依赖 calcTransactionCost 可用）。
 * 能量运费：deal/send 无论买卖都从本方 terminal 扣能量（calcTransactionCost），由
 * distributor 的 stockTerminalEnergy 维持储备。
 */
import { CONFIG } from "../config";
import type { Priority, RoomSnapshot, System, TickContext } from "../kernel/contracts";
import { EventKind, recordEvent } from "../kernel/event-log";
import {
  energyBuyAmount,
  energySellAmount,
  planEnergyAid,
  type RoomEnergyState,
} from "../domain/economy/energy-logistics";
import {
  planMineralAid,
  type RoomMineralState,
} from "../domain/economy/mineral-logistics";
import {
  pickSalvageRecipient,
  planSalvageShipment,
  type SalvageCandidate,
} from "../domain/defense/nuke-response";
import {
  planSellOrder,
  shouldCancelStaleOrder,
  shouldChangeOrderPrice,
} from "../domain/industry/market-orders";
import {
  getMineralDeficits,
  pickBestBuyOrder,
  pickBestSellOrder,
  type MarketOrderSummary,
} from "../domain/industry/terminal-policy";
import { collectFullInventory } from "../domain/industry/inventory";
import { collectDemands, adjustMaxPrice } from "../domain/industry/procurement";
import { globalCache } from "../kernel/global-cache";
import type { ProcurementDemand } from "../kernel/global-cache";
import type { TransportPlan } from "../domain/logistics/transport-plan";
import {
  computeDynamicBuyPrice,
  computeDynamicSellPrice,
  collectMarketPrices,
  type PriceTable,
} from "../domain/industry/market-pricing";
import {
  executeBestCandidate,
  type DealCandidate,
  SELL_PRIORITY_CAP,
  CRISIS_ENERGY_PRIORITY,
  DEFICIT_PRIORITY_BASE,
  POWER_PRIORITY,
  GHODIUM_PRIORITY,
} from "../domain/industry/deal-scheduler";
import { BOOST_EFFECTS, type Compound } from "../domain/industry/types";

export const terminalManagerSystem: System = {
  name: "terminal-manager",
  priority: 3 as Priority,
  interval: CONFIG.market.interval,
  run(ctx: TickContext): void {
    // nuke 资产抢救（审计缺口 3）：生存动作 — 先于市场 API / tier / bucket
    // 门禁执行（send 不依赖市场 API；被 nuke 瞄准的房可能正处于战时 CPU 降档）。
    tryNukeSalvage(ctx);

    // 私服/测试环境无市场 API — 安全跳过。
    if (typeof Game.market?.getAllOrders !== "function") return;
    // 贸易不是生存关键：仅在 CPU 富余时运行。
    if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded") return;
    if ((Game.cpu.bucket ?? 0) < CONFIG.market.minBucket) return;

    // ── 行情快照采集 ──
    // 每 interval tick 运行时先采集当前市场行情（最低卖价/最高买价）写入
    // globalCache.marketPrices。所有买/卖决策以行情快照为基准计算动态价格门禁，
    // 替代 CONFIG 中的静态死价格 — 市场通胀/通缩时门禁自动浮动。
    refreshMarketPrices();

    // 0. 帝国能量互济：跨房救助优先于贸易（殖民生存 > 交易收入）。
    tryEmpireEnergyAid(ctx);

    // 0.5 帝国矿物互济：姐妹房 homeMineral 盈余先于市场买入（省 credits）。
    tryEmpireMineralAid(ctx);

    // A4.3：查询 Logistics Plan 中由 logistics-planner 产出的跨房请求。
    // 如果 Plan 中有涉及 terminal 的请求，terminal-manager 作为 Network 计划执行器
    // 优先执行 Plan 指定的操作。Plan 未覆盖的领域由原有自主决策逻辑 fallback。
    const logisticsPlan = globalCache().logisticsPlan?.plan;
    const planRequestRooms = collectPlanTerminalRooms(logisticsPlan);

    for (const snapshot of ctx.snapshots()) {
      const terminal = snapshot.terminal;
      if (!terminal) continue;

      // 0.8 挂单生命周期管理（审计缺口 4）：超龄撤单 + 大宗盈余挂 sell 单
      //（不占 terminal 冷却 — createOrder/cancelOrder 是账户操作）。
      tryManageSellOrders(snapshot);

      if (terminal.cooldown > 0) continue;

      // A4.3：如果本房 terminal 在 Plan 的请求中，注入 Plan 驱动的候选。
      // Plan 驱动的 terminal.send 优先级最高（Network 计划 > 自主市场决策）。
      const candidates: DealCandidate[] = [];

      // A4.3 Plan 驱动候选：从 logisticsPlan 中筛选本房涉及的请求。
      if (logisticsPlan && planRequestRooms.has(snapshot.roomName)) {
        candidates.push({
          type: "plan-driven-send",
          priority: 200, // 最高优先级 — Plan 驱动 > 自主市场决策
          execute: () => tryPlanDrivenSend(snapshot, terminal, logisticsPlan, ctx),
        });
      }

      // 卖出候选（priority ≤ SELL_PRIORITY_CAP）。
      candidates.push({
        type: "sell-energy",
        priority: 45,
        execute: () => trySellSurplusEnergy(snapshot, terminal),
      });
      candidates.push({
        type: "sell-mineral",
        priority: 40,
        execute: () => trySellHomeMineral(snapshot, terminal),
      });
      candidates.push({
        type: "sell-battery",
        priority: 35,
        execute: () => trySellSurplusBattery(snapshot, terminal),
      });
      // sell-compound：盈余 boost 化合物卖出（priority 30 — 低于 battery 因为
      // 化合物是战略资源，只在明显盈余时变现）。
      candidates.push({
        type: "sell-compound",
        priority: 30,
        execute: () => trySellSurplusCompound(snapshot, terminal),
      });
      // sell-commodity：factory commodity 产出卖出（priority 25 — 终局高值资产，
      // terminal 有现货时变现，低于 compound 因为 commodity 不如 boost 化合物紧缺）。
      candidates.push({
        type: "sell-commodity",
        priority: 25,
        execute: () => trySellCommodity(snapshot, terminal),
      });

      // 买入候选。
      candidates.push({
        type: "buy-crisis-energy",
        priority: CRISIS_ENERGY_PRIORITY,
        execute: () => tryBuyCrisisEnergy(snapshot, terminal),
      });
      // buy-deficit 的 priority 动态反映需求表中的最高 priority —
      // 需求表存在时 priority 必须高于卖出候选（SELL_PRIORITY_CAP=50），
      // 否则买入被日常卖出永久挤出（卖出消耗 terminal 冷却 → 买入无窗口）。
      // 工业链原料买入是生产性投资，优先于日常卖出变现。
      //
      // 需求表时效：lab-system 每 50 tick 发布一次（idle 期间），terminal-manager
      // 每 200 tick 运行一次 — 两者 tick 极少重合。检查需求是否在有效期内
      //（发布 tick 到 deadline 之间）而非严格等于当前 tick。
      {
        let deficitPriority = DEFICIT_PRIORITY_BASE;
        // 信道持久化（publishProcurementDemands）：条目活到各自 deadline，
        // 过期过滤在 collectDemands 内完成 —— 表级 age 门禁已无意义。
        const demandsCache = globalCache().procurementDemands;
        if (demandsCache) {
          const allDemands = collectDemands(demandsCache.byRoom, ctx.tick);
          if (allDemands.length > 0) {
            // 需求表存在时，取最高 priority 但不低于 SELL_PRIORITY_CAP+1，
            // 确保买入在 deal 竞争中胜过卖出候选。
            deficitPriority = Math.max(allDemands[0]!.priority, SELL_PRIORITY_CAP + 1);
          }
        }
        candidates.push({
          type: "buy-deficit",
          priority: deficitPriority,
          execute: () => tryBuyDeficit(snapshot, terminal, ctx),
        });
      }
      candidates.push({
        type: "buy-power",
        priority: POWER_PRIORITY,
        execute: () => tryBuyPower(snapshot, terminal),
      });
      candidates.push({
        type: "buy-ghodium",
        priority: GHODIUM_PRIORITY,
        execute: () => tryBuyGhodium(snapshot, terminal),
      });

      // 按 priority 降序逐个尝试执行 — 最高优先级的先试，
      // 如果没成交（无卖单/无现货）则 fallback 到下一个。
      // 这修复了 continue 饥饿：卖出返回 false 时买入有机会执行。
      executeBestCandidate(candidates);
    }

    // 7. pixel 出售（审计缺口 5）：账户资源吃最优 buy 单 — 生成端（pixel-system）
    //    与变现端闭环，pixel 不再只是「自愿放血」的成本侧。
    trySellPixel();
  },
};

/**
 * 挂单生命周期管理（审计缺口 4）— 每房每轮：
 * 1. 检查自有挂单：已成交完/超龄零成交 → cancelOrder（重挂价随新 bid 重算）；
 * 2. homeMineral 大宗盈余（吃单单笔消化不完）且无在途挂单 → createOrder
 *    挂 sell 单（价 = 最优 buy × markup — 吃即刻成交与挂单等买家之间的价差套利）。
 * 挂单是账户操作（手续费 credits），不占 terminal 冷却。
 */
function tryManageSellOrders(snapshot: RoomSnapshot): void {
  const market = Game.market as typeof Game.market & {
    orders?: Record<string, any>;
    createOrder?: (params: Record<string, unknown>) => number;
    cancelOrder?: (orderId: string) => number;
    changeOrderPrice?: (orderId: string, newPrice: number) => number;
  };
  if (typeof market.createOrder !== "function") return;
  const myOrders = Object.values(market.orders ?? {});

  // 本房挂单维护（改价/撤单）。
  for (const order of myOrders) {
    if (order.type !== "sell" || order.roomName !== snapshot.roomName) continue;
    const stale = shouldCancelStaleOrder(
      order.createdTimestamp ?? 0,
      order.remainingAmount ?? 0,
      order.totalAmount ?? 0,
      Date.now(),
      CONFIG.market.orderStaleMs,
    );
    if (!stale) continue;

    // 超龄零成交 — 优先改价（省 5% 手续费），改不了再撤单重挂。
    if (typeof market.changeOrderPrice === "function") {
      const bids = toSummaries(
        Game.market.getAllOrders({ type: ORDER_BUY, resourceType: order.resourceType }),
      );
      const best = pickBestBuyOrder(bids, computeDynamicSellPrice(order.resourceType, getMarketPrices(), CONFIG.market.sellDiscount, CONFIG.market.fallbackMinSellPrice));
      const newPrice = shouldChangeOrderPrice(
        order.remainingAmount ?? 0,
        order.totalAmount ?? 0,
        order.price ?? 0,
        best?.price,
        CONFIG.market.sellOrderMarkup,
      );
      if (newPrice !== undefined) {
        if (market.changeOrderPrice(order.id, newPrice) === OK) {
          console.log(`[${Game.time}] market: 改价 ${order.id}（${order.resourceType} ${order.price}→${newPrice}）`);
          continue; // 改价成功 — 不撤单，等新价成交
        }
      }
    }

    // 改价不适用（无 bid / 价变不足 / API 不可用）→ 撤单重挂。
    if (market.cancelOrder?.(order.id) === OK) {
      console.log(`[${Game.time}] market: 撤单 ${order.id}（${order.resourceType} 超龄零成交）`);
    }
  }

  // homeMineral 大宗盈余挂单。
  const homeMineral = snapshot.minerals[0]?.mineralType;
  if (!homeMineral) return;
  const inTerminal = snapshot.terminal?.store.getUsedCapacity(homeMineral) ?? 0;
  const inStorage = snapshot.storage?.store.getUsedCapacity(homeMineral) ?? 0;
  const surplus = inTerminal + inStorage - CONFIG.market.sellReserve;
  if (surplus <= 0) return;

  const existing = myOrders.find(
    o => o.type === "sell" && o.roomName === snapshot.roomName && o.resourceType === homeMineral,
  );
  if (existing && (existing.remainingAmount ?? 0) > 0) return; // 在途有效挂单 — 不重复

  const bids = toSummaries(
    Game.market.getAllOrders({ type: ORDER_BUY, resourceType: homeMineral }),
  );
  const best = pickBestBuyOrder(bids, computeDynamicSellPrice(homeMineral, getMarketPrices(), CONFIG.market.sellDiscount, CONFIG.market.fallbackMinSellPrice));
  const plan = planSellOrder({
    resourceType: homeMineral,
    surplus,
    existingOrderId: existing?.id,
    bestBuyPrice: best?.price,
    markup: CONFIG.market.sellOrderMarkup,
    maxOrderAmount: CONFIG.market.maxOrderAmount,
    minOrderAmount: CONFIG.market.minOrderAmount,
  });
  if (!plan) return;

  const result = market.createOrder({
    type: ORDER_SELL,
    resourceType: plan.resourceType as ResourceConstant,
    price: plan.price,
    totalAmount: plan.totalAmount,
    roomName: snapshot.roomName,
  });
  if (result === OK) {
    console.log(
      `[${Game.time}] market: 挂单 sell ${plan.totalAmount} ${plan.resourceType} @ ${plan.price}（${snapshot.roomName}）`,
    );
  }
}

/**
 * pixel 出售（审计缺口 5）：pixel 是账户资源（Game.resources.pixel），交易
 * 无 terminal/运费 — deal 不带 room 即账户交割。吃最优 buy 单即刻变现，
 * 价格低于门槛囤着（账户资源无仓储成本）。
 * 择优不用 pickBestBuyOrder（它要求 roomName — terminal 交割口径；
 * pixel 单无 room，被其过滤）。
 */
function trySellPixel(): void {
  // 注意：RESOURCE_PIXEL 在部分 Screeps 运行时未作为全局提供（@types/screeps 声明了但
  // 运行时缺失 → 裸引用会抛 ReferenceError）。直接用字面量 "pixel"，跨环境稳定且零依赖。
  const pixels = Game.resources?.["pixel"] ?? 0;
  if (pixels <= 0) return;
  let best: MarketOrderSummary | undefined;
  for (const o of toSummaries(
    Game.market.getAllOrders({ type: ORDER_BUY, resourceType: "pixel" }),
  )) {
    if (o.price < computeDynamicSellPrice("pixel", getMarketPrices(), CONFIG.market.sellDiscount, CONFIG.market.fallbackMinPixelSellPrice) || o.amount <= 0) continue;
    if (!best || o.price > best.price) best = o;
  }
  if (!best) return;
  // 账户交易：无 roomName（pixel 不从 terminal 出货、无能量运费）。
  const amount = Math.min(pixels, best.amount);
  if (Game.market.deal(best.id, amount) === OK) {
    recordEvent(EventKind.EnergyTransfer, "", [amount]);
    console.log(`[${Game.time}] pixel: 卖出 ${amount} pixel @ ${best.price}`);
  }
}

/**
 * nuke 资产抢救（审计缺口 3）：警报房（incomingNukes 非空）的 terminal 库存
 * 逐轮 send 到无警报兄弟房 — power/G/化合物优先，能量留运费地板后兜底全发。
 * 节奏：interval 200 × send 不限量 × 50000 tick 预警窗口 = 足以转空。
 * 无合格接收房（单房帝国/兄弟房全在警报）静默 — 感知事件已记录，无可抢救动作。
 */
function tryNukeSalvage(ctx: TickContext): void {
  const snapshots = [...ctx.snapshots()];
  const alertRooms = snapshots.filter(s => (s.incomingNukes?.length ?? 0) > 0);
  if (alertRooms.length === 0) return;

  // 接收房候选：一次构建，全体警报房复用。
  const candidates: SalvageCandidate[] = snapshots.map(s => ({
    roomName: s.roomName,
    hasTerminal: s.terminal !== undefined,
    nukeAlert: (s.incomingNukes?.length ?? 0) > 0,
    terminalFree: s.terminal?.store.getFreeCapacity() ?? 0,
  }));

  for (const snapshot of alertRooms) {
    const terminal = snapshot.terminal;
    if (!terminal || terminal.cooldown > 0) continue;
    const recipient = pickSalvageRecipient(candidates, snapshot.roomName);
    if (!recipient) continue;

    // terminal 库存枚举（引擎 store 为资源→数量的普通对象映射）。
    const resources = new Map<string, number>(
      Object.entries(terminal.store as unknown as Record<string, number>),
    );
    const plan = planSalvageShipment(
      resources,
      recipient.roomName,
      CONFIG.market.terminalEnergyReserveFloor,
    );
    if (!plan) continue;

    if (terminal.send(plan.resourceType as ResourceConstant, plan.amount, plan.to) === OK) {
      recordEvent(EventKind.NukeSalvage, snapshot.roomName, [
        salvageResourceCode(plan.resourceType),
        plan.amount,
      ]);
      console.log(
        `[${Game.time}] nuke-salvage: ${snapshot.roomName} → ${plan.to} ${plan.amount} ${plan.resourceType}`,
      );
    }
  }
}

/** NukeSalvage 事件的资源编码：0=power/1=G/2=浓缩化合物(X*)/3=battery/4=基础矿物/5=能量/6=其他。 */
function salvageResourceCode(resourceType: string): number {
  if (resourceType === RESOURCE_POWER) return 0;
  if (resourceType === RESOURCE_GHODIUM) return 1;
  if (resourceType.startsWith("X")) return 2;
  if (resourceType === RESOURCE_BATTERY) return 3;
  if (["H", "O", "U", "L", "K", "Z"].includes(resourceType)) return 4;
  if (resourceType === RESOURCE_ENERGY) return 5;
  return 6;
}

/**
 * 帝国能量互济 — 每轮至多一笔（决策纯函数，本函数只做采集与执行）。
 * 发送方 terminal 须同时承担 货量 + 能量运费 + 储备地板；
 * calcTransactionCost 不可用（部分私服）时整体跳过。
 */
function tryEmpireEnergyAid(ctx: TickContext): void {
  if (typeof Game.market?.calcTransactionCost !== "function") return;
  const snapshots = [...ctx.snapshots()];
  if (snapshots.length < 2) return;

  const rooms: RoomEnergyState[] = snapshots.map(s => ({
    roomName: s.roomName,
    storageEnergy: s.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    canSend: s.terminal !== undefined && s.terminal.cooldown === 0,
    canReceive: s.terminal !== undefined,
  }));

  const plan = planEnergyAid(rooms, {
    recipientFloor: CONFIG.energy.aidRecipientFloor,
    donorFloor: CONFIG.energy.aidDonorFloor,
    maxTransfer: CONFIG.energy.aidMaxTransfer,
    minTransfer: CONFIG.energy.aidMinTransfer,
  });
  if (!plan) return;

  const terminal = ctx.getSnapshot(plan.from)?.terminal;
  if (!terminal || terminal.cooldown > 0) return;

  // 发送方 terminal 须同时承担 货量 + 运费 + 储备地板。
  const fee = Game.market.calcTransactionCost(plan.amount, plan.from, plan.to);
  const energyInTerminal = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
  if (energyInTerminal < plan.amount + fee + CONFIG.market.terminalEnergyReserveFloor) return;

  const result = terminal.send(RESOURCE_ENERGY, plan.amount, plan.to);
  if (result === OK) {
    recordEvent(EventKind.EnergyTransfer, plan.to, [plan.amount]);
    console.log(
      `[${Game.time}] energy-aid: ${plan.from} → ${plan.to} ${plan.amount} energy (fee=${fee})`,
    );
  }
}

/** 能量溢出卖：storage 高于 energySellFloor 时向市场卖能量（terminal 现货出货）。 */
function trySellSurplusEnergy(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  const storageEnergy = snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  const amount = energySellAmount(
    storageEnergy,
    CONFIG.energy.energySellFloor,
    CONFIG.market.maxDealAmount,
  );
  if (amount <= 0) return false;
  // deal 从 terminal 出货 — terminal 现货不足时等 distributor 转运，下一窗口再试。
  if (terminal.store.getUsedCapacity(RESOURCE_ENERGY) < amount) return false;

  const orders = toSummaries(
    Game.market.getAllOrders({ type: ORDER_BUY, resourceType: RESOURCE_ENERGY }),
  );
  const best = pickBestBuyOrder(orders, CONFIG.energy.minEnergySellPrice);
  if (!best) return false;
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

/** 危机能量买：storage 低于 energyBuyFloor 且 credits 充足时买入（最后救助通道）。 */
function tryBuyCrisisEnergy(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
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

  const orders = toSummaries(
    Game.market.getAllOrders({ type: ORDER_SELL, resourceType: RESOURCE_ENERGY }),
  );
  const best = pickBestSellOrder(orders, CONFIG.energy.maxEnergyBuyPrice);
  if (!best) return false;
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

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
  const best = pickBestBuyOrder(orders, computeDynamicSellPrice(homeMineral, getMarketPrices(), CONFIG.market.sellDiscount, CONFIG.market.fallbackMinSellPrice));
  if (!best) return false;

  const amount = Math.min(surplus, inTerminal, best.amount, CONFIG.market.maxDealAmount);
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

/**
 * 买入缺口资源 — 阶段 1 改造：优先消费 procurementDemands 需求表。
 *
 * 新流程：
 * 1. 读取 globalCache.procurementDemands（lab-system / factory-manager 发布）；
 * 2. 按 priority 降序排序，逐个尝试买入；
 * 3. 基础矿物用 CONFIG.market.maxBuyPrice 价格门禁；
 * 4. 中间产物/化合物用 maxBuyPrice × 2 价格门禁（加工溢价）。
 *
 * 向后兼容：无需求表时回退到旧的 getMineralDeficits（硬编码 MINERAL_RESERVE_TARGET）。
 * 每次运行只处理一种（控制 getAllOrders 开销）。
 */
function tryBuyDeficit(snapshot: RoomSnapshot, terminal: StructureTerminal, ctx: TickContext): boolean {
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
      const fallback = CONFIG.market.fallbackMaxBuyPrice[demand.resource] ??
        Math.max(...Object.values(CONFIG.market.fallbackMaxBuyPrice));
      const basePrice = computeDynamicBuyPrice(
        demand.resource, prices, CONFIG.market.buyPremium, fallback,
      );
      const maxPrice = adjustMaxPrice(basePrice, demand.priority);

      const orders = toSummaries(
        Game.market.getAllOrders({ type: ORDER_SELL, resourceType: demand.resource as ResourceConstant }),
      );
      const best = pickBestSellOrder(orders, maxPrice);
      if (!best) continue;

      const affordable = Math.floor((Game.market.credits - CONFIG.market.creditFloor) / best.price);
      const amount = Math.min(demand.amount, best.amount, CONFIG.market.maxDealAmount, affordable);
      if (amount <= 0) continue;

      console.log(`[${Game.time}] terminal/${snapshot.roomName}: 买入 ${demand.resource} amount=${amount} priority=${demand.priority} reason=${demand.reason}`);
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
  const fallback = CONFIG.market.fallbackMaxBuyPrice[target.mineral] ??
    Math.max(...Object.values(CONFIG.market.fallbackMaxBuyPrice));
  const maxPrice = computeDynamicBuyPrice(target.mineral, prices, CONFIG.market.buyPremium, fallback);
  if (maxPrice <= 0) return false;

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

/**
 * 卖出盈余 boost 化合物 — 阶段 4 改造。
 *
 * lab-system 在 boost 库存超过 boostStockpile 后将盈余写入 globalCache.surplusCompounds，
 * 本函数读取该信号并在 deal 窗口内尝试卖出。
 *
 * 价格门禁：基于行情快照动态定价（市场最高买价 × sellDiscount）。
 * 成交量受盈余量、terminal 现货、订单余量与单笔上限四重约束。
 */
function trySellSurplusCompound(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  const g = globalCache();
  const surplus = g.surplusCompounds;
  if (!surplus) return false;

  // 取第一个有 terminal 现货的盈余化合物（控制 getAllOrders 开销 — 每次只卖一种）。
  for (const [res, surplusAmount] of Object.entries(surplus.items)) {
    if (surplusAmount <= 0) continue;
    const inTerminal = terminal.store.getUsedCapacity(res as ResourceConstant) ?? 0;
    if (inTerminal <= 0) continue;

    const orders = toSummaries(
      Game.market.getAllOrders({ type: ORDER_BUY, resourceType: res as ResourceConstant }),
    );
    const best = pickBestBuyOrder(orders, computeDynamicSellPrice(res, getMarketPrices(), CONFIG.market.sellDiscount, CONFIG.market.fallbackMinSellPrice));
    if (!best) continue;

    const amount = Math.min(surplusAmount, inTerminal, best.amount, CONFIG.market.maxDealAmount);
    if (amount <= 0) continue;

    console.log(`[${Game.time}] terminal/${snapshot.roomName}: 卖出盈余化合物 ${res} amount=${amount} price=${best.price}`);
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
function collectMineralInventory(snapshot: RoomSnapshot): Record<string, number> {
  return collectFullInventory(snapshot);
}

/**
 * 帝国矿物互济 — 每轮至多一笔（决策纯函数 planMineralAid，本函数只做采集与执行）。
 * 与能量互济同款预算口径：发送方 terminal 须同时承担 货量 + 能量运费 + 储备地板。
 */
function tryEmpireMineralAid(ctx: TickContext): void {
  if (typeof Game.market?.calcTransactionCost !== "function") return;
  const snapshots = [...ctx.snapshots()];
  if (snapshots.length < 2) return;

  const rooms: RoomMineralState[] = snapshots.map(s => {
    const inventory = collectMineralInventory(s);
    const homeMineral = s.minerals[0]?.mineralType;
    return {
      roomName: s.roomName,
      homeMineral,
      homeStock: homeMineral ? (inventory[homeMineral] ?? 0) : 0,
      inventory,
      canSend: s.terminal !== undefined && s.terminal.cooldown === 0,
      canReceive: s.terminal !== undefined,
    };
  });

  const plan = planMineralAid(rooms, {
    donorReserve: CONFIG.market.sellReserve,
    maxTransfer: CONFIG.market.maxDealAmount,
    minTransfer: CONFIG.market.mineralAidMinTransfer,
  });
  if (!plan) return;

  const terminal = ctx.getSnapshot(plan.from)?.terminal;
  if (!terminal || terminal.cooldown > 0) return;

  const fee = Game.market.calcTransactionCost(plan.amount, plan.from, plan.to);
  const energyInTerminal = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
  if (energyInTerminal < fee + CONFIG.market.terminalEnergyReserveFloor) return;

  const result = terminal.send(plan.mineral as ResourceConstant, plan.amount, plan.to);
  if (result === OK) {
    recordEvent(EventKind.MineralTransfer, plan.to, [plan.amount]);
    console.log(
      `[${Game.time}] mineral-aid: ${plan.from} → ${plan.to} ${plan.amount} ${plan.mineral} (fee=${fee})`,
    );
  }
}

/**
 * 卖出 terminal 内的 battery 现货（reclaimFactoryOutput 的落货出口）。
 * 只卖 terminal 现货、不动 storage 库存 — 与矿物卖同口径（storage 部分由搬运链
 * 逐步转运），价格低于底线时囤着等行情。
 */
function trySellSurplusBattery(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  const inTerminal = terminal.store.getUsedCapacity(RESOURCE_BATTERY);
  if (inTerminal <= 0) return false;

  const orders = toSummaries(
    Game.market.getAllOrders({ type: ORDER_BUY, resourceType: RESOURCE_BATTERY }),
  );
  const best = pickBestBuyOrder(orders, computeDynamicSellPrice(RESOURCE_BATTERY, getMarketPrices(), CONFIG.market.sellDiscount, CONFIG.market.fallbackMinBatterySellPrice));
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
function trySellCommodity(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
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

    const orders = toSummaries(
      Game.market.getAllOrders({ type: ORDER_BUY, resourceType: res }),
    );
    const best = pickBestBuyOrder(orders, computeDynamicSellPrice(res, getMarketPrices(), CONFIG.market.sellDiscount, CONFIG.market.fallbackMinSellPrice));
    if (!best) continue;

    const amount = Math.min(inTerminal, best.amount, CONFIG.market.maxDealAmount);
    if (amount <= 0) continue;

    console.log(`[${Game.time}] terminal/${snapshot.roomName}: 卖出 commodity ${res} amount=${amount} price=${best.price}`);
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
function tryBuyPower(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  if (Game.market.credits < CONFIG.market.powerBuyCreditFloor) return false;

  const have =
    (terminal.store.getUsedCapacity(RESOURCE_POWER) ?? 0) +
    (snapshot.storage?.store.getUsedCapacity(RESOURCE_POWER) ?? 0) +
    (snapshot.powerSpawn?.store.getUsedCapacity(RESOURCE_POWER) ?? 0);
  const deficit = CONFIG.factory.powerSpawnPowerTarget - have;
  if (deficit <= 0) return false;

  const orders = toSummaries(
    Game.market.getAllOrders({ type: ORDER_SELL, resourceType: RESOURCE_POWER }),
  );
  const best = pickBestSellOrder(orders, computeDynamicBuyPrice(RESOURCE_POWER, getMarketPrices(), CONFIG.market.buyPremium, CONFIG.market.fallbackPowerBuyMaxPrice));
  if (!best) return false;

  const affordable = Math.floor((Game.market.credits - CONFIG.market.powerBuyCreditFloor) / best.price);
  const amount = Math.min(deficit, best.amount, CONFIG.market.maxDealAmount, affordable);
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

// ─── 市场行情快照 ──────────────────────────────────────────

/** 需要采集行情的资源列表 — 覆盖所有交易涉及的资源类型。 */
const PRICED_RESOURCES = [
  "H", "O", "U", "L", "K", "Z", "X",
  "OH", "ZK", "UL", "G",
  "GO", "GH2O", "XGH2O",
  "battery", "power", "pixel",
  "GHODIUM",
] as const;

/**
 * 采集当前市场行情并写入 globalCache.marketPrices。
 * 每 interval tick 调用一次 — getAllOrders 已在 deal 候选逻辑中各自调用，
 * 此函数集中采集一轮行情供所有买/卖决策复用（避免每个函数独立 getAllOrders）。
 *
 * 采集策略：对每种资源分别查 sell/buy 订单，取最低卖价与最高买价。
 * 成本：PRICED_RESOURCES.length × 2 次 getAllOrders（过滤后通常 < 20 条/资源）。
 * 与旧实现（每函数独立 getAllOrders）总开销持平，但结果复用。
 */
function refreshMarketPrices(): void {
  const sellOrders: Record<string, { price: number }[]> = {};
  const buyOrders: Record<string, { price: number }[]> = {};

  for (const res of PRICED_RESOURCES) {
    const sells = Game.market.getAllOrders({ type: ORDER_SELL, resourceType: res as ResourceConstant });
    sellOrders[res] = sells.map(o => ({ price: o.price }));
    const buys = Game.market.getAllOrders({ type: ORDER_BUY, resourceType: res as ResourceConstant });
    buyOrders[res] = buys.map(o => ({ price: o.price }));
  }

  const prices = collectMarketPrices(PRICED_RESOURCES, sellOrders, buyOrders);
  const g = globalCache();
  g.marketPrices = { tick: Game.time, prices };
}

/**
 * 获取当前行情快照表（供买/卖决策计算动态价格）。
 * 若行情过期或缺失返回空对象 — computeDynamicBuy/SellPrice 会回退到 fallback。
 */
function getMarketPrices(): PriceTable {
  const g = globalCache();
  if (g.marketPrices && Game.time - g.marketPrices.tick <= CONFIG.market.interval + 50) {
    return g.marketPrices.prices;
  }
  return {};
}

/**
 * 买入 ghodium（nuker 威慑备弹的市场加速通道 — lab 自产是主通道）。
 * 库存口径 = terminal + storage + nuker 合计 vs nuker.ghodiumStockpile；
 * 无 nuker 的房不采购（G 无其他消费方，买了就是死资本）。
 * 高信用门禁 + 单笔上限双重约束：5k 缺口不会一次吃掉全部流动资金。
 * 买入后由 distributor 的 stockNuker 搬到 nuker。
 */
function tryBuyGhodium(snapshot: RoomSnapshot, terminal: StructureTerminal): boolean {
  const nuker = snapshot.nuker;
  if (!nuker) return false;
  if (Game.market.credits < CONFIG.nuker.ghodiumBuyCreditFloor) return false;

  const have =
    (terminal.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0) +
    (snapshot.storage?.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0) +
    (nuker.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0);
  const deficit = CONFIG.nuker.ghodiumStockpile - have;
  if (deficit <= 0) return false;

  const orders = toSummaries(
    Game.market.getAllOrders({ type: ORDER_SELL, resourceType: RESOURCE_GHODIUM }),
  );
  const best = pickBestSellOrder(orders, computeDynamicBuyPrice(RESOURCE_GHODIUM, getMarketPrices(), CONFIG.market.buyPremium, CONFIG.nuker.fallbackGhodiumBuyMaxPrice));
  if (!best) return false;

  const affordable = Math.floor(
    (Game.market.credits - CONFIG.nuker.ghodiumBuyCreditFloor) / best.price,
  );
  const amount = Math.min(deficit, best.amount, CONFIG.market.maxDealAmount, affordable);
  return executeDeal(best, amount, terminal, snapshot.roomName);
}

// ─── A4.3 Plan 驱动的 Terminal 执行器 ──────────────────────

/**
 * 收集 Logistics Plan 中涉及的 terminal 房间集合。
 * Plan 中的 TransportRequestV2 若 source/destination 的 type 为 "terminal"，
 * 则该房是 Plan 驱动的 terminal 操作对象。
 */
function collectPlanTerminalRooms(plan: TransportPlan | undefined): Set<string> {
  const rooms = new Set<string>();
  if (!plan) return rooms;
  for (const req of plan.requests) {
    if (req.source.type === "terminal") rooms.add(req.source.room);
    if (req.destination.type === "terminal") rooms.add(req.destination.room);
  }
  return rooms;
}

/**
 * Plan 驱动的 terminal.send 执行器。
 *
 * 当 logistics-planner 产出 Transport Plan 中有涉及本房 terminal 的请求时，
 * terminal-manager 作为 Network 计划执行器，按 Plan 指定的资源/量/目标执行 terminal.send。
 *
 * 执行规则：
 *   1. 筛选 Plan 中 source.room = 本房 且 source.type = "terminal" 的请求
 *   2. 对每个请求，检查 terminal 内现货 ≥ 请求量 + 能量运费 + 储备地板
 *   3. 满足条件则执行 terminal.send
 *   4. 每个 terminal 每轮只执行 1 笔（terminal 冷却限制）
 *
 * 返回 true 表示已执行 send（占用 terminal 冷却）。
 */
function tryPlanDrivenSend(
  snapshot: RoomSnapshot,
  terminal: StructureTerminal,
  plan: TransportPlan,
  _ctx: TickContext,
): boolean {
  // 筛选本房作为 source 的 terminal 请求
  const roomRequests = plan.requests.filter(
    r => r.source.room === snapshot.roomName && r.source.type === "terminal",
  );
  if (roomRequests.length === 0) return false;

  // 按 priority 升序（0=最高）取最高优先级的请求
  roomRequests.sort((a, b) => a.priority - b.priority);

  for (const req of roomRequests) {
    const resource = req.resource === "energy" ? RESOURCE_ENERGY : req.resource as ResourceConstant;
    const inTerminal = terminal.store.getUsedCapacity(resource) ?? 0;
    if (inTerminal < req.amount) continue; // 现货不足，等 distributor 转运

    // 能量运费校验
    if (typeof Game.market?.calcTransactionCost === "function") {
      const fee = Game.market.calcTransactionCost(req.amount, req.source.room, req.destination.room);
      const energyInTerminal = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      if (energyInTerminal < fee + CONFIG.market.terminalEnergyReserveFloor) continue;
    }

    // 执行 send
    const result = terminal.send(resource, req.amount, req.destination.room);
    if (result === OK) {
      recordEvent(EventKind.MineralTransfer, req.destination.room, [req.amount]);
      console.log(
        `[${Game.time}] terminal/plan-driven: ${snapshot.roomName} → ${req.destination.room}` +
        ` ${req.amount} ${req.resource} (origin=${req.origin})`,
      );
      return true; // 占用 terminal 冷却
    }
    // send 失败（cooldown/资源不足等）→ 试下一个请求
  }

  return false; // 没有可执行的请求
}

