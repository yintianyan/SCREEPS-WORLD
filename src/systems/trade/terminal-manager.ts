/** Terminal Manager — 候选调度与 Decision Authority；交易动作用于 terminal-market，互济用于 terminal-selfaid。 */
import { CONFIG } from "../../config";
import type { Priority, RoomSnapshot, System, TickContext } from "../../kernel/contracts";
import { EventKind, recordEvent } from "../../kernel/event-log";
import { log } from "../../kernel/log";
import {
  planSellOrder,
  shouldCancelStaleOrder,
  shouldChangeOrderPrice,
} from "../../domain/industry/market-orders";
import { pickBestBuyOrder } from "../../domain/industry/terminal-policy";
import { computeDynamicSellPrice } from "../../domain/industry/market-pricing";
import { collectDemands } from "../../domain/industry/procurement";
import { ensureTradeLedger, type TradeLedger } from "../../domain/industry/trade-ledger";
import { globalCache } from "../../kernel/global-cache";
import type { TransportPlan } from "../../domain/logistics/transport-plan";
import {
  executeBestCandidate,
  type DealCandidate,
  SELL_PRIORITY_CAP,
  CRISIS_ENERGY_PRIORITY,
  DEFICIT_PRIORITY_BASE,
  POWER_PRIORITY,
  GHODIUM_PRIORITY,
} from "../../domain/industry/deal-scheduler";
import {
  bestCompetingAsk,
  getCachedOrders,
  getMarketPrices,
  refreshMarketPrices,
  toSummaries,
  tryBuyCrisisEnergy,
  tryBuyDeficit,
  tryBuyGhodium,
  tryBuyPower,
  trySellCommodity,
  trySellHomeMineral,
  trySellPixel,
  trySellSurplusBattery,
  trySellSurplusCompound,
  trySellSurplusEnergy,
} from "./terminal-market";
import { tryEmpireEnergyAid, tryEmpireMineralAid, tryNukeSalvage } from "./terminal-selfaid";

/** 取（或建行）贸易决策账本 —— heap 单例；建行走 domain 的同一处（采购侧字段由 terminal-market 写）。 */
function tradeLedger(): TradeLedger {
  return ensureTradeLedger(globalCache());
}

export const terminalManagerSystem: System = {
  name: "terminal-manager",
  priority: 3 as Priority,
  interval: CONFIG.market.interval,
  run(ctx: TickContext): void {
    // 决策实测账本（heap，由 telemetry 落到 stats.trade）：只记录，不参与任何判断。
    // 存在的理由见 domain/industry/trade-ledger —— 贸易此前是唯一"线上看不见在想什么"的模块。
    const ledger = tradeLedger();
    ledger.runs++;
    ledger.lastTick = ctx.tick;
    ledger.gatedBy = "";
    ledger.bucket = Game.cpu.bucket ?? 0;
    ledger.credits = Game.market?.credits ?? 0;
    ledger.myOrders = Game.market?.orders ? Object.keys(Game.market.orders).length : 0;
    ledger.roomsWithTerminal = 0;
    ledger.roomsOnCooldown = 0;
    ledger.terminalEnergy = 0;
    ledger.storageEnergy = 0;

    // nuke 资产抢救：生存动作 — 先于市场 API / tier / bucket
    // 门禁执行（send 不依赖市场 API；被 nuke 瞄准的房可能正处于战时 CPU 降档）。
    tryNukeSalvage(ctx);

    // 私服/测试环境无市场 API — 安全跳过。
    if (typeof Game.market?.getAllOrders !== "function") {
      ledger.gatedBy = "no-market-api";
      return;
    }
    // 贸易不是生存关键：仅在 CPU 富余时运行。
    if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded") {
      ledger.gatedBy = "cpu-tier";
      return;
    }
    if ((Game.cpu.bucket ?? 0) < CONFIG.market.minBucket) {
      ledger.gatedBy = "bucket";
      return;
    }

    // ── 行情快照采集 ──
    // 每 interval tick 运行时先采集当前市场行情（最低卖价/最高买价）写入
    // globalCache.marketPrices。所有买/卖决策以行情快照为基准计算动态价格门禁，
    // 替代 CONFIG 中的静态死价格 — 市场通胀/通缩时门禁自动浮动。
    refreshMarketPrices();

    // Plan 存在时，自主互济降级为 DEGRADED MODE fallback。
    // 旧逻辑：tryEmpireEnergyAid/tryEmpireMineralAid 先于 Plan 候选执行，
    // 如果互济已执行 → terminal 冷却 → Plan 驱动的 send 被跳过。
    // 修复后：Plan 存在且有效时，自主互济不执行（Plan 拥有 Decision Authority）。
    // Plan 不存在时（非 100t tick），自主互济作为 DEGRADED MODE 执行。
    const logisticsPlan = globalCache().logisticsPlan?.plan;
    const planIsActive = logisticsPlan && logisticsPlan.plannedAt >= ctx.tick - 100;
    const planRequestRooms = collectPlanTerminalRooms(logisticsPlan);

    if (!planIsActive) {
      // DEGRADED MODE：Plan 不可用，自主互济作为 fallback。
      // 0. 帝国能量互济：跨房救助优先于贸易（殖民生存 > 交易收入）。
      tryEmpireEnergyAid(ctx);
      // 0.5 帝国矿物互济：姐妹房 homeMineral 盈余先于市场买入（省 credits）。
      tryEmpireMineralAid(ctx);
    } else if (planRequestRooms.size > 0) {
      // Plan 存在且有 terminal 请求 — Plan 拥有 Decision Authority。
      // 自主互济跳过，由 Plan 驱动的 tryPlanDrivenSend 执行。
      log.info(
        "terminal",
        `[${ctx.tick}] terminal: Plan active (plannedAt=${logisticsPlan!.plannedAt}), self-aid skipped in favor of Plan-driven send`,
      );
    }

    for (const snapshot of ctx.snapshots()) {
      const terminal = snapshot.terminal;
      if (!terminal) continue;
      ledger.roomsWithTerminal++;
      ledger.terminalEnergy += terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      ledger.storageEnergy += snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;

      // 0.8 挂单生命周期管理：超龄撤单 + 大宗盈余挂 sell 单
      //（不占 terminal 冷却 — createOrder/cancelOrder 是账户操作）。
      tryManageSellOrders(snapshot);

      if (terminal.cooldown > 0) {
        ledger.roomsOnCooldown++;
        continue;
      }

      // Plan 驱动候选：如果本房 terminal 在 Plan 的请求中，注入 Plan 驱动的候选。
      // Plan 驱动的 terminal.send 优先级最高（Network 计划 > 自主市场决策）。
      const candidates: DealCandidate[] = [];

      if (logisticsPlan && planRequestRooms.has(snapshot.roomName)) {
        candidates.push({
          type: "plan-driven-send",
          priority: 200, // 最高优先级 — Plan 驱动 > 自主市场决策
          execute: () => tryPlanDrivenSend(snapshot, terminal, logisticsPlan, ctx),
        });
      }

      // 卖出候选（priority ≤ SELL_PRIORITY_CAP）。
      //
      // ★排位判据＝「这一笔卖出能不能腾出 terminal 容量」，不是「这一笔值多少钱」。
      // terminal 容量 300,000 是整条工业线的硬瓶颈（矿物落地、factory 产出回收、市场
      // 买入落地全都优先投 terminal），而能量**不占** terminal 容量 —— 它住在 storage
      //（容量 1,000,000），只在成交那一刻从 terminal 的 10k 运费储备里扣。
      // 旧排位把 sell-energy 放在 45（仅次于 buy-deficit 的 ≥51），而它的触发条件
      // 「storage > energySellFloor(100k)」在能量盈余房里**恒真** ⇒ 每 200 拍那唯一的
      // 成交窗口被它吃掉，sell-mineral/battery/compound/commodity 一次都轮不到。
      // 官服实测后果（tick 83,725,642）：W37S58 terminal 用掉 278,956/300,000（93%，
      // 只剩 21,044 空格），其中 O 117,009、battery 94,236、GO 7,972、UL 6,547
      // 全部零出货，而同期 storage 能量 844,545 一直在被以 1,000/200拍 的速度卖掉。
      // ⇒ 降到 19：高于 buy-power(15)/buy-ghodium(10)，但让位给一切"腾容量"的卖出。
      // 取 19 而不是 20 是为了不和 DEFICIT_PRIORITY_BASE(20) 撞档 —— 需求表为空时
      // buy-deficit 回落到 20（旧的 getMineralDeficits 支路，买基础矿备料，是生产性
      // 投入），撞档时靠稳定排序的插入顺序决胜属于隐式契约，不如让位一档写明。
      candidates.push({
        type: "sell-energy",
        priority: 19,
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
        // 生产者侧指纹放在 if 之外：demandsCache 整个不存在（从没发布过）时也要留下
        // 「发布过几条」的证据 —— 否则「生产者没走到」与「走到了但消费时已过期」又会
        // 读成同一个 0，而这两种止步要修的是不同的模块。
        const published = globalCache().procurementPublished?.[snapshot.roomName];
        ledger.demandsPublished = published?.n ?? 0;
        ledger.publishedAt = published?.at ?? 0;
        // 第二道指纹：publish 在 `if (demands.length > 0)` 里面，所以 published=0 还分不清
        // 「没走到发布决策」与「走到了但算出 0 条」—— 这两处要修的模块不同，只能各记一次。
        const attempted = globalCache().procurementAttempted?.[snapshot.roomName];
        ledger.demandsComputed = attempted?.computed ?? 0;
        ledger.attemptedAt = attempted?.at ?? 0;
        if (demandsCache) {
          const allDemands = collectDemands(demandsCache.byRoom, ctx.tick);
          // 采购侧读数写在**这里**（每轮都会走到），不是只写在 tryBuyDeficit 里：那个候选
          // 可能被更高优先级的 deal 或 terminal 冷却挤掉，于是"没人发布需求"和"发布了但这个
          // 候选没被执行"会读成同一个 0 —— 而这两种止步要修的是不同的模块。
          ledger.demandsLive = allDemands.length;
          if (allDemands.length > 0) {
            const top = allDemands[0]!;
            ledger.demandTop = `${top.resource}:${top.amount}/p${top.priority}/${top.reason}`;
            // 需求表存在时，取最高 priority 但不低于 SELL_PRIORITY_CAP+1，
            // 确保买入在 deal 竞争中胜过卖出候选。
            deficitPriority = Math.max(top.priority, SELL_PRIORITY_CAP + 1);
          }
        }
        ledger.buyDeficitPriority = deficitPriority;
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

    // 7. pixel 出售：账户资源吃最优 buy 单 — 生成端（pixel-system）
    //    与变现端闭环，pixel 不再只是「自愿放血」的成本侧。
    trySellPixel();
  },
};

/**
 * 挂单生命周期管理 — 每房每轮：
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
  const ownOrderIds = new Set(Object.keys(market.orders ?? {}));
  // 同一轮内竞品 ask 查询缓存 — 同一资源类型不重复 getAllOrders。
  const askCache = new Map<string, number | undefined>();
  // 挂单价的地板只用**绝对地板**，不再由 bid 派生。
  //
  // 为什么：`anchorSellPrice` 的算式是 `max(floor, min(bid×markup, ask−step))`，
  // 而旧调用方把 floor 传成 `computeDynamicSellPrice(...)` = `max(buyMax×0.9, 绝对地板)`。
  // 市场没有自动撮合 ⇒ bid 高于 ask 的「交叉报价」可以长期并存（官服 shard3 实测
  // tick 83,725,711：O 最优买 37.846、最低竞品卖 27.091）。此时 floor=34.06 高于
  // askAnchor=27.08 ⇒ max() 把压价锚整个吃掉，挂单价恒落在最便宜竞品 ask 之上 6.97，
  // 而买家只吃最低 ask ⇒ 这张单永远排不上队。线上实证：sell O 5,000 @36.38 挂了
  // 4,646 拍零成交、sell Z 1,150 @18.13 挂了 46,535 拍零成交（Z 的 bid 只有 12.541）。
  //
  // bid 派生的那个值不是"价值地板"，它是"我愿意接受的最低**即时成交**价"——
  // 那个语义属于 deal 侧的 `pickBestBuyOrder(minPrice)`，下面继续用，两处不共用一个数。
  //（家族：同一字段两种语义 ⇒ 自败回路。）
  const orderPriceFloor = CONFIG.market.fallbackMinSellPrice;
  for (const order of myOrders) {
    if (order.type !== "sell" || order.roomName !== snapshot.roomName) continue;
    const remaining = order.remainingAmount ?? 0;
    const total = order.totalAmount ?? 0;

    // ── 改价：零成交就每轮跟行情，**不设挂龄门槛** ──
    // changeOrderPrice 不重收手续费，所以"跟着 bid/ask 走"是零成本的；把它挂在超龄条件
    // 下面等于让一张错价单在整个超龄期里干等。撤单重挂才有成本 —— 两件事的触发条件必须分开。
    if (remaining > 0 && remaining >= total && typeof market.changeOrderPrice === "function") {
      const bids =
        getCachedOrders(ORDER_BUY, order.resourceType) ??
        toSummaries(
          Game.market.getAllOrders({ type: ORDER_BUY, resourceType: order.resourceType }),
        );
      const best = pickBestBuyOrder(
        bids,
        computeDynamicSellPrice(
          order.resourceType,
          getMarketPrices(),
          CONFIG.market.sellDiscount,
          CONFIG.market.fallbackMinSellPrice,
        ),
      );
      const newPrice = shouldChangeOrderPrice(
        remaining,
        total,
        order.price ?? 0,
        best?.price,
        CONFIG.market.sellOrderMarkup,
        {
          competingAsk: bestCompetingAsk(order.resourceType, ownOrderIds, askCache),
          floor: orderPriceFloor,
          step: CONFIG.market.sellUndercutStep,
        },
      );
      if (newPrice !== undefined && market.changeOrderPrice(order.id, newPrice) === OK) {
        log.info(
          "terminal",
          `[${Game.time}] market: 改价 ${order.id}（${order.resourceType} ${order.price}→${newPrice}）`,
        );
        continue; // 改价成功 — 不撤单，等新价成交
      }
    }

    // ── 撤单：残单立即清；零成交要**真**超龄才撤 ──
    // ⚠️ 挂龄按拍号算：Screeps 的 Order 字段是 `created`（拍），没有 `createdTimestamp`。
    // 旧写法 `order.createdTimestamp ?? 0` 配 `Date.now()` ⇒ 恒真 ⇒ 这道闸形同不存在。
    const stale = shouldCancelStaleOrder(
      order.created ?? 0,
      remaining,
      total,
      Game.time,
      CONFIG.market.orderStaleTicks,
    );
    if (!stale) continue;
    if (market.cancelOrder?.(order.id) === OK) {
      log.info(
        "terminal",
        `[${Game.time}] market: 撤单 ${order.id}（${order.resourceType} 超龄零成交）`,
      );
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
  const best = pickBestBuyOrder(
    bids,
    computeDynamicSellPrice(
      homeMineral,
      getMarketPrices(),
      CONFIG.market.sellDiscount,
      CONFIG.market.fallbackMinSellPrice,
    ),
  );
  const plan = planSellOrder({
    resourceType: homeMineral,
    surplus,
    existingOrderId: existing?.id,
    bestBuyPrice: best?.price,
    markup: CONFIG.market.sellOrderMarkup,
    maxOrderAmount: CONFIG.market.maxOrderAmount,
    minOrderAmount: CONFIG.market.minOrderAmount,
    pricing: {
      competingAsk: bestCompetingAsk(homeMineral, ownOrderIds, askCache),
      // 同上：挂单地板只用绝对地板。用 bid×0.9 当地板会在交叉市场里把压价锚吃掉，
      // 挂单永远排在最低竞品 ask 之上 ⇒ 永不成交（O @36.38 挂 4,646 拍零成交即此）。
      floor: orderPriceFloor,
      step: CONFIG.market.sellUndercutStep,
    },
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
    log.info(
      "terminal",
      `[${Game.time}] market: 挂单 sell ${plan.totalAmount} ${plan.resourceType} @ ${plan.price}（${snapshot.roomName}）`,
    );
  }
}

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

 * 当 logistics-planner 产出 Transport Plan 中有涉及本房 terminal 的请求时，
 * terminal-manager 作为 Network 计划执行器，按 Plan 指定的资源/量/目标执行 terminal.send。

 * 执行规则：
 *   1. 筛选 Plan 中 source.room = 本房 且 source.type = "terminal" 的请求
 *   2. 对每个请求，检查 terminal 内现货 ≥ 请求量 + 能量运费 + 储备地板
 *   3. 满足条件则执行 terminal.send
 *   4. 每个 terminal 每轮只执行 1 笔（terminal 冷却限制）

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
    const resource =
      req.resource === "energy" ? RESOURCE_ENERGY : (req.resource as ResourceConstant);
    const inTerminal = terminal.store.getUsedCapacity(resource) ?? 0;
    if (inTerminal < req.amount) continue; // 现货不足，等 distributor 转运

    // 能量运费校验
    if (typeof Game.market?.calcTransactionCost === "function") {
      const fee = Game.market.calcTransactionCost(
        req.amount,
        req.source.room,
        req.destination.room,
      );
      const energyInTerminal = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      if (energyInTerminal < fee + CONFIG.market.terminalEnergyReserveFloor) continue;
    }

    // 执行 send
    const result = terminal.send(resource, req.amount, req.destination.room);
    if (result === OK) {
      recordEvent(EventKind.MineralTransfer, req.destination.room, [req.amount]);
      log.info(
        "terminal",
        `[${Game.time}] terminal/plan-driven: ${snapshot.roomName} → ${req.destination.room}` +
          ` ${req.amount} ${req.resource} (origin=${req.origin})`,
      );
      return true; // 占用 terminal 冷却
    }
    // send 失败（cooldown/资源不足等）→ 试下一个请求
  }

  return false; // 没有可执行的请求
}
