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

export const terminalManagerSystem: System = {
  name: "terminal-manager",
  priority: 3 as Priority,
  interval: CONFIG.market.interval,
  run(ctx: TickContext): void {
    // nuke 资产抢救：生存动作 — 先于市场 API / tier / bucket
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

      // 0.8 挂单生命周期管理：超龄撤单 + 大宗盈余挂 sell 单
      //（不占 terminal 冷却 — createOrder/cancelOrder 是账户操作）。
      tryManageSellOrders(snapshot);

      if (terminal.cooldown > 0) continue;

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
        order.remainingAmount ?? 0,
        order.totalAmount ?? 0,
        order.price ?? 0,
        best?.price,
        CONFIG.market.sellOrderMarkup,
        {
          competingAsk: bestCompetingAsk(order.resourceType, ownOrderIds, askCache),
          floor: computeDynamicSellPrice(
            order.resourceType,
            getMarketPrices(),
            CONFIG.market.sellDiscount,
            CONFIG.market.fallbackMinSellPrice,
          ),
          step: CONFIG.market.sellUndercutStep,
        },
      );
      if (newPrice !== undefined) {
        if (market.changeOrderPrice(order.id, newPrice) === OK) {
          log.info(
            "terminal",
            `[${Game.time}] market: 改价 ${order.id}（${order.resourceType} ${order.price}→${newPrice}）`,
          );
          continue; // 改价成功 — 不撤单，等新价成交
        }
      }
    }

    // 改价不适用（无 bid / 价变不足 / API 不可用）→ 撤单重挂。
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
      floor: computeDynamicSellPrice(
        homeMineral,
        getMarketPrices(),
        CONFIG.market.sellDiscount,
        CONFIG.market.fallbackMinSellPrice,
      ),
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
