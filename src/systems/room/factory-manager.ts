/** Factory Manager */
import { CONFIG } from "../../config";
import { shouldProcessPower, PROCESS_POWER_ENERGY } from "../../domain/economy/power-processing";
import {
  shouldDecompressBattery,
  DECOMPRESS_BATCH_ENERGY,
} from "../../domain/economy/battery-decompression";
import {
  missingComponents,
  selectCommodityTarget,
  type CommodityRecipe,
  type StockView,
} from "../../domain/industry/commodity";
import type { Priority, RoomSnapshot, System, TickContext } from "../../kernel/contracts";
import {
  globalCache,
  publishProcurementDemands,
  bumpEnergyCounter,
} from "../../kernel/global-cache";
import type { ProcurementDemand } from "../../kernel/global-cache";
import { collectFullInventory } from "../../domain/industry/inventory";
import { commodityBatchRoi } from "../../domain/industry/market-pricing";
import { expandCommodityDemands } from "../../domain/industry/procurement";
import { getResourceContract } from "../../domain/economy/resource-contract";
import { readResourceFlowState } from "../../domain/economy/resource-flow-status";
import { marketOutletState, type MarketOutletState } from "../../domain/industry/market-outlet";

export const factoryManagerSystem: System = {
  name: "factory-manager",
  priority: 3 as Priority,
  interval: CONFIG.factory.interval,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      const powerSpawn = snapshot.powerSpawn;
      if (powerSpawn && typeof powerSpawn.processPower === "function") {
        if (
          shouldProcessPower({
            powerStored: powerSpawn.store.getUsedCapacity(RESOURCE_POWER),
            energyStored: powerSpawn.store.getUsedCapacity(RESOURCE_ENERGY),
            storageEnergy: snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY),
            energyFloor: CONFIG.factory.processEnergyFloor,
            warActive: Memory.kernel?.strategy?.posture === "war",
          })
        ) {
          const result = powerSpawn.processPower();
          if (result === OK) {
            bumpEnergyCounter(snapshot.roomName, "industrialSpend", PROCESS_POWER_ENERGY);
          }
        }
      }

      const factory = snapshot.factory;
      if (!factory) continue;
      // 测试/私服环境的 factory mock 可能无 produce — 安全跳过。
      if (typeof factory.produce !== "function") continue;
      if (factory.cooldown > 0) continue;

      // ── battery 解压回能（危机优先于一切 factory 生产）──
      // storage 能量低于危机线时，把 factory 内 battery 解压为能量。
      // 比市场买入更优先：不消耗 credits、不付运费、无市场依赖。
      // 解压产出能量在 factory 内，由 distributor 搬到 storage 供 spawn 使用。
      if (tryDecompressBattery(snapshot, factory)) continue;

      // ── commodity 升级链（审计缺口 6）──
      // battery 之外的常规生产：非满仓也产（commodity 是正收益升级）。
      tryProduceCommodity(snapshot, factory, ctx);

      // ── battery 压缩（满仓止损，语义不变）──
      // 仅在 storage 满仓（能量正在源头被浪费）时压缩 — 正常水位下
      // 能量应流向 upgrade/build，压缩的 1/6 折损划不来。
      if (Memory.rooms[snapshot.roomName]?.storageNearFull !== true) continue;
      if (factory.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.factory.batchEnergy) continue;
      // Phase C 停止阀：battery 总量达到硬上限，或超过软上限且无真实出口 → 停止压缩。
      if (!batteryCompressionAllowed(snapshot)) continue;
      const result = factory.produce(RESOURCE_BATTERY);
      if (result === OK) {
        bumpEnergyCounter(
          snapshot.roomName,
          "industrialSpend",
          produceEnergyCost(RESOURCE_BATTERY),
        );
      }
    }
  },
};

/**
 * commodity 生产：选目标（梯度高者 + 原料充足）→ 缓存目标（distributor
 * 补料锚点）→ factory 内原料齐时 produce。
 * 配方源：引擎 COMMODITIES 常量（私服/旧 mock 未定义时静默跳过 —
 * 与 FIND_NUKES 等引擎常量同防御口径）。battery/energy 之外的产出
 * 即 commodity（能量是解压回退，battery 走满仓链）。
 */
function tryProduceCommodity(
  snapshot: RoomSnapshot,
  factory: StructureFactory,
  ctx: TickContext,
): void {
  // 部分私服的 factory 不暴露 level（实测本服 `factory.level === undefined`）。
  // 回退到 0 会让所有 r.level≥1 配方被静默筛光 —— 模块永久哑火；回退到 RCL 才是
  // 引擎语义（工厂等级由房间等级给出）。真等级不足时 produce 自己返回 ERR 码、
  // 不产资源，所以"回高"的代价是一次失败调用，而"回低"的代价是整条链不成立。
  const factoryLevel = factory.level ?? snapshot.rcl;
  const recipes = collectRecipes(factoryLevel);
  if (recipes.length === 0) return;

  const g = globalCache();
  if (!g.factoryTargets) g.factoryTargets = {};

  const factoryStoreView = toStockView(factory.store as unknown as Record<string, number>);
  const storageStoreView = snapshot.storage
    ? toStockView(snapshot.storage.store as unknown as Record<string, number>)
    : {};

  const target = selectCommodityTarget(
    factoryStoreView,
    storageStoreView,
    factoryLevel,
    recipes,
    CONFIG.factory.commodityEnergyReserve,
    // 生产侧 ROI 闸：用自有库存转换也要算机会成本（料直接卖能拿到的钱）。
    // 闸只在行情判得了时生效 —— 私服/测试环境 marketPrices 为空表 ⇒ judgeable=false ⇒ 放行。
    { prices: g.marketPrices?.prices ?? {}, margin: CONFIG.factory.commodityRoiMargin },
  );
  // 目标缓存：distributor 的 stockFactoryComponents 消费（undefined 时清锚）。
  if (!target) {
    delete g.factoryTargets[snapshot.roomName];
    // 选不出可行目标 ≠ 不该报缺口。旧实现在这里直接 return，于是
    // 「缺料 ⇒ 选不出目标 ⇒ 永不发布需求 ⇒ 贸易侧永远不知道要买什么 ⇒ 永远缺料」
    // 是一条静默自锁（与 16.3k 拍 0 交付同族）。现在按「期望目标」上报缺口，
    // 但必须过正 ROI 闸 —— 买中间品产商品在坏行情里是深度倒挂投资（实测回收率 1.7%）。
    publishDesiredCommodityDemands(snapshot, recipes, ctx);
    return;
  }
  // Phase C 停止阀：产物无真实出口或库存已达高水位 → 停止生产并清掉补料锚。
  // 清锚是必需项：否则 distributor 仍会把组件搬进 factory，原料变成新的死库存。
  if (!commodityCanProduce(snapshot, target.resourceType)) {
    delete g.factoryTargets[snapshot.roomName];
    return;
  }
  g.factoryTargets[snapshot.roomName] = target.resourceType;

  // ── 阶段 1：发布 commodity 原料缺口需求 ──
  // V1 边界（登记取舍）不变：只为凑料搬 storage 存量，不主动市场买入 —
  // 但发布需求让 terminal-manager 知道“缺什么”，当价格合适时可买入。
  // 需求有效期 = market.interval(200) + buffer(50) = 250 tick。
  {
    const inventory = collectFullInventory(snapshot);
    const demands = expandCommodityDemands(
      target.resourceType,
      target.components,
      inventory,
      ctx.tick,
      CONFIG.market.interval + 50,
    );
    if (demands.length > 0) {
      // 合并语义：与 lab-system 的同房需求并存，不再整表覆写
      // （旧实现 P3 后跑覆盖 P1 已发布的 lab 基础矿需求，信号最坏丢失 ~200t）。
      publishProcurementDemands(snapshot.roomName, demands as ProcurementDemand[], ctx.tick);
    }
  }

  // factory 内原料齐 → 生产（缺料由 distributor 补，下轮再产）。
  const missing = missingComponents(factoryStoreView, target);
  if (Object.keys(missing).length > 0) return;
  const result = factory.produce(target.resourceType as CommodityConstant);
  if (result === OK) {
    bumpEnergyCounter(snapshot.roomName, "industrialSpend", produceEnergyCost(target.resourceType));
  }
}

/** 引擎配方里的能量成本（无 `components.energy` = 0；battery 压缩 600/批）。 */
function produceEnergyCost(resourceType: string): number {
  const table = (
    globalThis as {
      COMMODITIES?: Record<string, { components?: Record<string, number> }>;
    }
  ).COMMODITIES;
  return table?.[resourceType]?.components?.energy ?? 0;
}

/** 行情缓存与 terminal-manager 同窗口视为新鲜。 */
const MARKET_CACHE_TTL = CONFIG.market.interval + 50;

/** storage + terminal + factory 的资源合计（产物库存口径）。 */
function totalStoredResource(snapshot: RoomSnapshot, resource: string): number {
  let total = 0;
  for (const store of [
    snapshot.storage?.store,
    snapshot.terminal?.store,
    snapshot.factory?.store,
  ]) {
    if (!store) continue;
    const amount = (store as unknown as Record<string, number>)[resource];
    if (typeof amount === "number") total += amount;
  }
  return total;
}

/** 本房是否有该资源的跨房出口票（援助/计划驱动 send）。 */
function hasExportTicket(roomName: string, resource: string): boolean {
  const needs = globalCache().exportNeeds?.byRoom[roomName];
  if (!needs) return false;
  return needs.some(need => need.resource === resource && need.deadline > Game.time);
}

/**
 * 产物出口状态。跨房援助票优先（它不依赖市场），其次市场买盘。
 * 缓存缺失/过期 → unknown；调用方只在明确 no 时停止生产（判不了 ≠ 该拦）。
 */
function commodityOutletState(roomName: string, resource: string): MarketOutletState {
  if (hasExportTicket(roomName, resource)) return "yes";
  return marketOutletState(resource, globalCache().marketOrderCache, Game.time, MARKET_CACHE_TTL);
}

/**
 * commodity 生产前置闸（Phase C）：
 * - 产物库存达到高水位 → 停止（避免无上限堆积）；
 * - 有明确「无买盘且无援助票」→ 停止，并清掉补料锚，防止继续把原料搬进 factory。
 */
function commodityCanProduce(snapshot: RoomSnapshot, resource: string): boolean {
  const contract = getResourceContract(resource);
  if (totalStoredResource(snapshot, resource) >= contract.highWater) return false;
  // Phase A 接线：状态机判定「产物堆在高水位以上且连续无流出」→ 停止生产。
  // 只认 stuck：critical/deficit 是「库存太少」，停止生产只会让它更少。
  // 读数超龄（>150 拍）时 read 返回 undefined ⇒ 不拦（判不了 ≠ 该停）。
  if (
    readResourceFlowState(Memory.rooms[snapshot.roomName]?.resourceFlow, resource, Game.time) ===
    "stuck"
  ) {
    return false;
  }
  return commodityOutletState(snapshot.roomName, resource) !== "no";
}

/**
 * battery 压缩前置闸（Phase C）：
 * - 总量 ≥ 硬上限（150K）→ 无条件停止压缩；
 * - 总量 ≥ 软上限（100K）且明确无卖出/援助票 → 停止。
 * 缓存判不了时不拦，保持旧行为。
 */
function batteryCompressionAllowed(snapshot: RoomSnapshot): boolean {
  const contract = getResourceContract(RESOURCE_BATTERY);
  const total = totalStoredResource(snapshot, RESOURCE_BATTERY);
  if (total >= contract.hardCap) return false;
  // Phase A 接线：状态机的 stuck 是「高水位 + 连续 500 拍无流出」的累计证据，
  // 比单窗水位更稳；只认 stuck，不动低库存侧（battery 少时压缩正是补库存）。
  if (
    readResourceFlowState(
      Memory.rooms[snapshot.roomName]?.resourceFlow,
      RESOURCE_BATTERY,
      Game.time,
    ) === "stuck"
  ) {
    return false;
  }
  if (
    total >= contract.highWater &&
    commodityOutletState(snapshot.roomName, RESOURCE_BATTERY) === "no"
  ) {
    return false;
  }
  return true;
}

/**
 * 「期望目标」的原料缺口上报（纯决策的外层包装）。
 * 期望目标 = 等级允许的最高档配方（`recipes` 已由 collectRecipes 按等级筛过并梯度降序），
 * **无视当前库存** —— 这正是它与 selectCommodityTarget 的唯一区别，也是自锁能被解开的地方。
 * 上报前过 `commodityBatchRoi`：行情倒挂时一条需求都不发，等价于旧行为。
 */
function publishDesiredCommodityDemands(
  snapshot: RoomSnapshot,
  recipes: readonly CommodityRecipe[],
  ctx: TickContext,
): void {
  const desired = recipes[0];
  if (!desired) return;
  // Phase C 停止阀：期望产物本身没有出口/库存已满 → 不发布采购需求。
  // 否则会花钱把原料买进来，产成一个卖不掉的成品（把死库存从原料换成成品）。
  if (!commodityCanProduce(snapshot, desired.resourceType)) return;

  const inventory = collectFullInventory(snapshot);
  const missing: Record<string, number> = {};
  for (const [res, need] of Object.entries(desired.components)) {
    if (res === "energy") continue;
    const gap = need - (inventory[res] ?? 0);
    if (gap > 0) missing[res] = gap;
  }
  // 料齐却仍选不出目标 ⇒ 卡不在采购上（能量储备/等级），报需求只会制造噪声。
  if (Object.keys(missing).length === 0) return;

  const g = globalCache();
  const table = (globalThis as { COMMODITIES?: Record<string, { amount?: number }> }).COMMODITIES;
  const roi = commodityBatchRoi(
    missing,
    g.marketPrices?.prices ?? {},
    desired.resourceType,
    table?.[desired.resourceType]?.amount ?? 1,
    CONFIG.factory.commodityRoiMargin,
  );
  if (!roi.profitable) return;

  const demands = expandCommodityDemands(
    desired.resourceType,
    desired.components,
    inventory,
    ctx.tick,
    CONFIG.market.interval + 50,
  );
  if (demands.length > 0) {
    publishProcurementDemands(snapshot.roomName, demands as ProcurementDemand[], ctx.tick);
  }
}

/** 从引擎 COMMODITIES 裁剪配方表（梯度降序：T3 → T1；无 components 的跳过）。 */
function collectRecipes(factoryLevel: number): CommodityRecipe[] {
  const table = (
    globalThis as {
      COMMODITIES?: Record<
        string,
        { level?: number; amount?: number; components?: Record<string, number> }
      >;
    }
  ).COMMODITIES;
  if (!table) return [];
  const recipes: CommodityRecipe[] = [];
  for (const [resourceType, def] of Object.entries(table)) {
    if (!def?.components) continue; // 不可生产（原料类/能量解压等）
    // battery 走满仓压缩链，commodity 链不重复处理。
    if (resourceType === RESOURCE_BATTERY) continue;
    // energy 走危机解压链（tryDecompressBattery，门禁 storage < energyBuyFloor），
    // commodity 链同样不重复处理。
    //
    // ⚠️ 这一条不是洁癖，是 2026-10-18 线上跑出来的：生产侧 ROI 闸把 oxidant 拦下之后
    //（回收率 53%，深度倒挂），selectCommodityTarget 顺着梯度往下走选中了引擎的解压
    // 配方 `COMMODITIES[energy] = {battery: 5} → energy 50`，`factoryTargets` 当场从
    // "oxidant" 翻成 "energy"。按买价算它确实"划算"（5 battery × 200 = 1,000 对
    // 50 energy × 32.186 = 1,609，+61% > margin 35%）—— 但 ROI 闸只看市场价，看不见
    // **我们自己的出口能力**：battery 有畅通的卖出通道（sell-battery 优先级 35），
    // 而能量已经在 surplus（storage 844,545，卖线 100,000）且出口被 maxDealAmount
    // 卡到 25 单位/拍、优先级还刚被降到 19。把有出口的资产换成没出口的资产，
    // 账面上 +61%、实际上是往一个只剩 118,842 空格的 storage 里灌水。
    // 在 ROI 闸加上之前这条被 oxidant 的梯度（level 1 > 0）压着，是潜伏的。
    if (resourceType === RESOURCE_ENERGY) continue;
    if ((def.level ?? 0) > factoryLevel) continue;
    // amount 必须带上：生产侧 ROI 闸要按「单批产量 × 产物买价」算收益，
    // 缺省成 1 会把收益低估两个数量级（oxidant 单批产 100），闸会误拦一切。
    recipes.push({
      resourceType,
      level: def.level ?? 0,
      amount: def.amount ?? 1,
      components: def.components,
    });
  }
  // 梯度降序（level 高 = 高级 commodity 优先）。
  recipes.sort((a, b) => b.level - a.level);
  return recipes;
}

/** store 对象 → 纯视图（过滤方法键，仅数值项）。 */
function toStockView(store: Record<string, number>): StockView {
  const view: Record<string, number> = {};
  for (const [k, v] of Object.entries(store)) {
    if (typeof v === "number" && v > 0) view[k] = v;
  }
  return view;
}

/** 解压期间 factory 内能量的水位阀（超过则暂停解压，等回收链搬运）。 */
const DECOMPRESS_FACTORY_ENERGY_CAP = 20_000;

/**
 * battery 解压回能：storage 未达目标水位时，把 factory 内的 battery 逆向生产为能量。
 *
 * 官方配方（`@screeps/common/lib/constants.js`）：**50 battery → 500 energy**，cooldown 10。
 * 产出能量留在 factory.store 内 — distributor 需将其搬到 storage 供 spawn 使用。
 * 与 reclaimFactoryOutput 配合：storage 低于目标水位时优先搬 factory 能量到 storage。
 *
 * 返回 true = 已执行 produce（消耗 factory 本 tick 的 produce 窗口，跳过 commodity/压缩）。
 * 返回 false = 条件不满足，继续后续 commodity/压缩链。
 */
function tryDecompressBattery(snapshot: RoomSnapshot, factory: StructureFactory): boolean {
  const batteryInFactory = factory.store.getUsedCapacity(RESOURCE_BATTERY) ?? 0;
  const storageEnergy = snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY);
  if (
    !shouldDecompressBattery({
      storageEnergy,
      batteryInFactory,
      factoryCooldown: factory.cooldown,
      storageTarget: CONFIG.factory.decompressStorageTarget,
    })
  )
    return false;

  // 产出 500 energy 需要 factory 有空间 —— 满仓时 produce 返 ERR_FULL，先让回收链搬运。
  if (factory.store.getFreeCapacity(RESOURCE_ENERGY) < DECOMPRESS_BATCH_ENERGY) return false;

  // 回收链运力阀：解压 50 e/t 的注入速率远超 distributor 的搬运能力
  // （W8N3 实测 3 只 8C ≈ 1,200/趟），factory energy 一度堆到 19.9K。
  // 超过此水位就暂停解压，等 reclaimFactoryOutput 把能量搬回 storage 再继续 ——
  // 否则堆到容量 50K 后 produce 返 ERR_FULL，整条解压链静默停摆。
  if (factory.store.getUsedCapacity(RESOURCE_ENERGY) >= DECOMPRESS_FACTORY_ENERGY_CAP) {
    return false;
  }

  factory.produce(RESOURCE_ENERGY);
  return true;
}
