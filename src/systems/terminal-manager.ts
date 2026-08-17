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
} from "../domain/industry/market-orders";
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
    // nuke 资产抢救（审计缺口 3）：生存动作 — 先于市场 API / tier / bucket
    // 门禁执行（send 不依赖市场 API；被 nuke 瞄准的房可能正处于战时 CPU 降档）。
    tryNukeSalvage(ctx);

    // 私服/测试环境无市场 API — 安全跳过。
    if (typeof Game.market?.getAllOrders !== "function") return;
    // 贸易不是生存关键：仅在 CPU 富余时运行。
    if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded") return;
    if ((Game.cpu.bucket ?? 0) < CONFIG.market.minBucket) return;

    // 0. 帝国能量互济：跨房救助优先于贸易（殖民生存 > 交易收入）。
    tryEmpireEnergyAid(ctx);

    // 0.5 帝国矿物互济：姐妹房 homeMineral 盈余先于市场买入（省 credits）。
    tryEmpireMineralAid(ctx);

    for (const snapshot of ctx.snapshots()) {
      const terminal = snapshot.terminal;
      if (!terminal) continue;

      // 0.8 挂单生命周期管理（审计缺口 4）：超龄撤单 + 大宗盈余挂 sell 单
      //（不占 terminal 冷却 — createOrder/cancelOrder 是账户操作）。
      tryManageSellOrders(snapshot);

      if (terminal.cooldown > 0) continue;

      // 1. 能量溢出 → 卖能量（财富引擎）。
      if (trySellSurplusEnergy(snapshot, terminal)) continue; // 本次冷却窗口已用掉

      // 2. 先卖后买：卖出是 credits 的唯一来源，信用地板前必须先有收入。
      if (trySellHomeMineral(snapshot, terminal)) continue; // 本次冷却窗口已用掉

      // 2.5 battery 卖：满仓溢能的压缩资产变现（reclaimFactoryOutput 落货后）。
      if (trySellSurplusBattery(snapshot, terminal)) continue;

      // 3. 危机能量买（生存救助优先于反应原料）。
      if (tryBuyCrisisEnergy(snapshot, terminal)) continue;

      // 4. 买入缺口矿物（credits 允许时）。
      if (tryBuyDeficit(snapshot, terminal)) continue;

      // 5. 买入 power（高信用门禁 — GPL 投资排在所有生存/工业采购之后）。
      tryBuyPower(snapshot, terminal);

      // 6. 买入 ghodium（nuker 威慑备弹 — 战略采购，lab 自产是主通道，市场只是加速）。
      tryBuyGhodium(snapshot, terminal);
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
  };
  if (typeof market.createOrder !== "function") return;
  const myOrders = Object.values(market.orders ?? {});

  // 本房挂单维护（撤超龄/残单）。
  for (const order of myOrders) {
    if (order.type !== "sell" || order.roomName !== snapshot.roomName) continue;
    if (
      shouldCancelStaleOrder(
        order.createdTimestamp ?? 0,
        order.remainingAmount ?? 0,
        order.totalAmount ?? 0,
        Date.now(),
        CONFIG.market.orderStaleMs,
      )
    ) {
      if (market.cancelOrder?.(order.id) === OK) {
        console.log(`[${Game.time}] market: 撤单 ${order.id}（${order.resourceType} 超龄零成交）`);
      }
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
  const best = pickBestBuyOrder(bids, CONFIG.market.minSellPrice);
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
  const pixels = Game.resources?.[RESOURCE_PIXEL] ?? 0;
  if (pixels <= 0) return;
  let best: MarketOrderSummary | undefined;
  for (const o of toSummaries(
    Game.market.getAllOrders({ type: ORDER_BUY, resourceType: RESOURCE_PIXEL }),
  )) {
    if (o.price < CONFIG.market.minPixelSellPrice || o.amount <= 0) continue;
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
  const best = pickBestBuyOrder(orders, CONFIG.market.minBatterySellPrice);
  if (!best) return false;

  const amount = Math.min(inTerminal, best.amount, CONFIG.market.maxDealAmount);
  return executeDeal(best, amount, terminal, snapshot.roomName);
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
  const best = pickBestSellOrder(orders, CONFIG.market.powerBuyMaxPrice);
  if (!best) return false;

  const affordable = Math.floor((Game.market.credits - CONFIG.market.powerBuyCreditFloor) / best.price);
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
  const best = pickBestSellOrder(orders, CONFIG.nuker.ghodiumBuyMaxPrice);
  if (!best) return false;

  const affordable = Math.floor(
    (Game.market.credits - CONFIG.nuker.ghodiumBuyCreditFloor) / best.price,
  );
  const amount = Math.min(deficit, best.amount, CONFIG.market.maxDealAmount, affordable);
  return executeDeal(best, amount, terminal, snapshot.roomName);
}
