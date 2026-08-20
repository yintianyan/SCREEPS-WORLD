/**
 * Factory Manager — P3 系统，RCL7-8 终局结构的最小运营层。
 * Factory：① battery 压缩（storage 满仓时把过剩能量转为资产 — 止损语义，
 * 正常水位不压缩：1/6 折损划不来）；② commodity 升级链（审计缺口 6）：
 * 配方读引擎 COMMODITIES（不硬编码），梯度高者优先，原料 = factory +
 * storage 合计，distributor 按 missingComponents 补料进 factory。
 * PowerSpawn：processPower（1 power + 50 energy/次）积累 GPL — 调度门禁见
 * domain/economy/power-processing（能量地板 + war 姿态，投资让位生存）。
 * 原料能量由 distributor 的 stockFactoryEnergy/stockFactoryComponents 搬运。
 *
 * commodity 目标缓存在 globalCache（可丢 — global reset 后重选，无 Memory
 * schema 依赖；目标本身每 interval 重评，粘性只避免同 tick 抖动）。
 */
import { CONFIG } from "../config";
import { shouldProcessPower } from "../domain/economy/power-processing";
import {
  missingComponents,
  selectCommodityTarget,
  type CommodityRecipe,
  type StockView,
} from "../domain/industry/commodity";
import type { Priority, RoomSnapshot, System, TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import type { ProcurementDemand } from "../kernel/global-cache";
import { collectFullInventory } from "../domain/industry/inventory";
import { expandCommodityDemands } from "../domain/industry/procurement";

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
          powerSpawn.processPower();
        }
      }

      const factory = snapshot.factory;
      if (!factory) continue;
      // 测试/私服环境的 factory mock 可能无 produce — 安全跳过。
      if (typeof factory.produce !== "function") continue;
      if (factory.cooldown > 0) continue;

      // ── commodity 升级链（审计缺口 6）──
      // battery 之外的常规生产：非满仓也产（commodity 是正收益升级）。
      tryProduceCommodity(snapshot, factory, ctx);

      // ── battery 压缩（满仓止损，语义不变）──
      // 仅在 storage 满仓（能量正在源头被浪费）时压缩 — 正常水位下
      // 能量应流向 upgrade/build，压缩的 1/6 折损划不来。
      if (Memory.rooms[snapshot.roomName]?.storageNearFull !== true) continue;
      if (factory.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.factory.batchEnergy) continue;
      factory.produce(RESOURCE_BATTERY);
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
function tryProduceCommodity(snapshot: RoomSnapshot, factory: StructureFactory, ctx: TickContext): void {
  const recipes = collectRecipes(factory.level ?? 0);
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
    factory.level ?? 0,
    recipes,
    CONFIG.factory.commodityEnergyReserve,
  );
  // 目标缓存：distributor 的 stockFactoryComponents 消费（undefined 时清锚）。
  if (target) g.factoryTargets[snapshot.roomName] = target.resourceType;
  else delete g.factoryTargets[snapshot.roomName];
  if (!target) return;

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
      if (!g.procurementDemands || g.procurementDemands.tick !== ctx.tick) {
        g.procurementDemands = { tick: ctx.tick, byRoom: {} };
      }
      g.procurementDemands.byRoom[snapshot.roomName] = demands as ProcurementDemand[];
    }
  }

  // factory 内原料齐 → 生产（缺料由 distributor 补，下轮再产）。
  const missing = missingComponents(factoryStoreView, target);
  if (Object.keys(missing).length > 0) return;
  factory.produce(target.resourceType as CommodityConstant);
}

/** 从引擎 COMMODITIES 裁剪配方表（梯度降序：T3 → T1；无 components 的跳过）。 */
function collectRecipes(factoryLevel: number): CommodityRecipe[] {
  const table = (globalThis as { COMMODITIES?: Record<string, { level?: number; components?: Record<string, number> }> }).COMMODITIES;
  if (!table) return [];
  const recipes: CommodityRecipe[] = [];
  for (const [resourceType, def] of Object.entries(table)) {
    if (!def?.components) continue; // 不可生产（原料类/能量解压等）
    // battery 走满仓压缩链，commodity 链不重复处理。
    if (resourceType === RESOURCE_BATTERY) continue;
    if ((def.level ?? 0) > factoryLevel) continue;
    recipes.push({ resourceType, level: def.level ?? 0, components: def.components });
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
