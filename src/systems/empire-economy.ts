/**
 * Empire Economy 系统 — A2 后半·步 12：系统侧薄壳。
 *
 * 合同锚点：SYSTEM_BOUNDARIES §1.4 Empire、§1.5 Economy、
 * DATA_FLOW §1 红队 A1（分频聚合 + Cached Snapshot）。
 *
 * 职责：每 N tick 调用 domain 纯函数链组装 Empire Planner Input，
 * 写入 Memory.kernel.empireEconomy 瘦快照。不写 Room Memory、
 * 不控制 Creep、不绕过 Request Pool、不直接调用 Spawn
 * （ECONOMY §6 红线 1/4，DECISION_AUTHORITY §1）。
 *
 * 执行链：
 *   RoomSnapshot + RoomMemory + EconomyQuery
 *   → buildRoomEconomicProfile (步 1)
 *   → buildRoomCapacityProfile (步 3)
 *   → buildEmpireResourceView (步 4)
 *   → evaluateEconomicHealth (步 5)
 *   → detectImbalance (步 6)
 *   → allocateEmpireBudget (步 7)
 *   → evaluateExpansionReadiness (步 8)
 *   → evaluateSafetyMargin (步 9)
 *   → buildEmpirePlannerInput (步 10)
 *
 * 状态所有权（STATE_OWNERSHIP §3.1）：
 *   唯一写者 = 本系统 → Memory.kernel.empireEconomy（瘦快照）。
 *   不写 Memory.rooms[r].*（Room 状态仍由 room-state/economy 写）。
 *
 * CPU 预算：低频执行（interval=100），不每 tick 重算整个 Empire。
 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { CONFIG } from "../config";
import { globalCache } from "../kernel/global-cache";
import { queryEconomy, type EconomyQuery } from "./economy";
import {
  buildRoomEconomicProfile,
  type RoomEconomicProfile,
  type RoomEconomicMemory,
} from "../domain/economy/room-profile";
import {
  buildRoomCapacityProfile,
  type RoomCapacityProfile,
} from "../domain/economy/capacity-profile";
import { buildEmpireResourceView } from "../domain/strategy/resource-view";
import { evaluateEconomicHealth } from "../domain/strategy/economic-health";
import { detectImbalance } from "../domain/strategy/imbalance";
import { allocateEmpireBudget } from "../domain/strategy/budget";
import { evaluateExpansionReadiness } from "../domain/strategy/readiness";
import { evaluateSafetyMargin } from "../domain/strategy/safety-margin";
import { buildEmpirePlannerInput } from "../domain/strategy/planner-input";
// A4.2 多资源链路
import { getAllMineralTypes } from "../domain/economy/resource-definition";
import {
  createResourceLedger,
  getOrCreateEntry,
  emptyStock,
  aggregateLedgers,
  type ResourceLedger,
  type ResourceStockSnapshot,
} from "../domain/economy/resource-ledger";
import { evaluateMultiResourceHealth } from "../domain/strategy/multi-resource-health";
import { identifyBottlenecks } from "../domain/economy/bottleneck";
import type { ResourceHealthStatus } from "../domain/economy/resource-health";
import type { ResourceType } from "../domain/operation/agenda-item";

/**
 * Empire Economy 瘦快照（写入 Memory.kernel.empireEconomy）。
 * 只存必要 Summary——不复制完整 RoomState（MEMORY_ARCHITECTURE §4）。
 */
interface EmpireEconomySnapshot {
  /** 采样 tick。 */
  t: number;
  /** 帝国总能量。 */
  te: number;
  /** 帝国总生产 ×10。 */
  tp: number;
  /** 帝国总净流 ×100。 */
  nf: number;
  /** 帝国总储备。 */
  tr: number;
  /** 最差风险缓冲 ×10。 */
  rb: number;
  /** 平均效率 ×100。 */
  ef: number;
  /** 健康度枚举编码。 */
  h: number;
  /** deficit 房间数。 */
  dr: number;
  /** surplus 房间数。 */
  sr: number;
  /** 是否有 Imbalance。 */
  im: number;
  /** 扩张就绪度枚举编码。 */
  er: number;
  /** 安全边际分数 ×100。 */
  sm: number;
  /** 扩张预算。 */
  eb: number;
  /** 自由预算。 */
  fb: number;
  /** 储备预算。 */
  rr: number;
  // ── A4.2 多资源维度 ──
  /** 多资源帝国健康度编码。 */
  mh: number;
  /** 是否有矿物缺口。 */
  md: number;
  /** 瓶颈资源编码（0 = energy, 1-7 = U/L/K/Z/O/H/X, 99 = none）。 */
  bn: number;
  /** 最差矿物健康度编码。 */
  wmh: number;
}

/** 健康度编码（节省 Memory 字符）。 */
const HEALTH_CODES: Record<string, number> = {
  critical: 0,
  deficit: 1,
  stable: 2,
  growing: 3,
  healthy: 4,
};

/** 扩张就绪度编码。 */
const READINESS_CODES: Record<string, number> = {
  NOT_READY: 0,
  READY: 1,
  STRONGLY_READY: 2,
};

/** A4.2 多资源健康度编码（与 Energy 健康度编码对齐，供快照用）。 */
const MULTI_HEALTH_CODES: Record<ResourceHealthStatus, number> = {
  critical: 0,
  deficit: 1,
  degraded: 2,
  stable: 3,
  healthy: 4,
};

/**
 * A4.2：从 RoomSnapshot 采集矿物库存快照。
 *
 * 只采集矿物（非 energy），energy 由现有 EnergyLedger 链路处理。
 * 遍历 storage / terminal / container / lab / factory 中的矿物存量。
 */
function collectMineralStock(snapshot: import("../kernel/contracts").RoomSnapshot): Map<string, ResourceStockSnapshot> {
  const minerals = getAllMineralTypes();
  const result = new Map<string, ResourceStockSnapshot>();

  for (const mineral of minerals) {
    const stock = emptyStock();

    // storage
    if (snapshot.storage) {
      stock.storage = snapshot.storage.store[mineral as MineralConstant] ?? 0;
    }
    // terminal
    if (snapshot.terminal) {
      stock.terminal = snapshot.terminal.store[mineral as MineralConstant] ?? 0;
    }
    // containers
    for (const c of snapshot.containers) {
      stock.containers += c.store[mineral as MineralConstant] ?? 0;
    }
    // labs
    for (const l of snapshot.labs) {
      stock.labs += (l.store[mineral as MineralConstant] ?? 0) as number;
    }
    // factory
    if (snapshot.factory) {
      stock.factory += (snapshot.factory.store[mineral as MineralConstant] ?? 0) as number;
    }

    // 只记录有存量的矿物
    if (stock.storage + stock.terminal + stock.containers + stock.labs + stock.factory > 0) {
      result.set(mineral, stock);
    }
  }

  return result;
}

/**
 * A4.2：从各房矿物库存聚合为帝国级 ResourceLedger。
 */
function buildEmpireResourceLedger(
  snapshots: readonly import("../kernel/contracts").RoomSnapshot[],
): ResourceLedger {
  const roomLedgers: ResourceLedger[] = [];

  for (const snap of snapshots) {
    const roomLedger = createResourceLedger();
    const mineralStocks = collectMineralStock(snap);

    for (const [mineral, stock] of mineralStocks) {
      const entry = getOrCreateEntry(roomLedger, mineral as ResourceType);
      entry.stock = stock;
    }

    roomLedgers.push(roomLedger);
  }

  return aggregateLedgers(roomLedgers);
}

/**
 * A4.2：将 Energy-only EconomicHealth 映射到 ResourceHealthStatus。
 *
 * EmpireEconomicHealth（critical/deficit/stable/growing/healthy）
 * → ResourceHealthStatus（critical/deficit/degraded/stable/healthy）。
 * growing 归入 stable（对应 ResourceHealth 没有 growing 维度）。
 */
function mapEnergyHealthToResourceHealth(
  h: "critical" | "deficit" | "stable" | "growing" | "healthy",
): ResourceHealthStatus {
  switch (h) {
    case "critical": return "critical";
    case "deficit": return "deficit";
    case "stable": return "stable";
    case "growing": return "stable";
    case "healthy": return "healthy";
  }
}

/** heap 缓存的 Planner Input（供同 tick 内其他系统只读消费）。 */
let cachedPlannerInput: { tick: number; input: ReturnType<typeof buildEmpirePlannerInput> } | undefined;

/**
 * 查询口：返回最近一次 Empire Planner Input（同 tick 内缓存）。
 * 消费方（如 expansion-manager / observability）经此读取，不直读 Memory 结构。
 */
export function queryEmpirePlannerInput() {
  return cachedPlannerInput?.input;
}

export const empireEconomySystem: System = {
  name: "empire-economy",
  priority: 1 as Priority,
  /** 每 100 tick 执行一次（低频聚合——不每 tick 重算整个 Empire）。 */
  interval: 100,
  run(ctx: TickContext): void {
    const profiles: RoomEconomicProfile[] = [];
    const capacityProfiles: RoomCapacityProfile[] = [];

    // ── 步 1+3：组装各房 Economic Profile + Capacity Profile ──
    for (const snapshot of ctx.snapshots()) {
      const roomName = snapshot.roomName;
      const roomMem = Memory.rooms[roomName] as RoomEconomicMemory | undefined;
      if (!roomMem) continue;

      const economyQuery: EconomyQuery | undefined = queryEconomy(roomName);
      const economyInput = economyQuery
        ? {
            tick: economyQuery.tick,
            netFlow: economyQuery.netFlow,
            contractReserve: economyQuery.contractReserve,
            riskBuffer: economyQuery.riskBuffer,
            drift: economyQuery.drift,
            estimatedIncome: economyQuery.estimatedIncome,
            efficiency: economyQuery.efficiency,
          }
        : undefined;

      const profile = buildRoomEconomicProfile(snapshot, roomMem, economyInput, ctx.tick);
      profiles.push(profile);

      // Capacity Profile 需要额外参数（从 snapshot 采集）
      const haulerCount = roomMem.phase?.harvesterCount ?? 0; // 近似
      const builderCount = Math.max(1, Math.floor(haulerCount / 3)); // 近似
      const terminalCapacity = snapshot.terminal?.store.getCapacity(RESOURCE_ENERGY) ?? 0;
      let linkCapacity = 0;
      for (const l of snapshot.links) linkCapacity += l.store.getCapacity(RESOURCE_ENERGY);
      const spawnCount = snapshot.spawns.length;

      capacityProfiles.push(
        buildRoomCapacityProfile(
          profile,
          haulerCount,
          builderCount,
          terminalCapacity,
          linkCapacity,
          spawnCount,
          CONFIG.economy.referenceCarryCapacity,
        ),
      );
    }

    if (profiles.length === 0) return;

    // ── 步 4：Empire Resource View ──
    const resourceView = buildEmpireResourceView(profiles, ctx.tick);

    // ── 步 5：Empire Economic Health ──
    const health = evaluateEconomicHealth(resourceView);

    // ── 步 6：Resource Imbalance Detection ──
    const imbalance = detectImbalance(profiles, resourceView, ctx.tick);

    // ── 步 7：Empire Budget ──
    const budget = allocateEmpireBudget(resourceView, health.health, ctx.tick);

    // ── 步 8：Expansion Readiness ──
    const cpuTier = Memory.kernel?.capacity?.tier ?? "comfortable";
    const postureExpansionAllowed = Memory.kernel?.strategy?.expansionAllowed ?? false;
    const readiness = evaluateExpansionReadiness(
      resourceView,
      health.health,
      budget,
      cpuTier as "abundant" | "comfortable" | "tight" | "constrained",
      postureExpansionAllowed,
    );

    // ── 步 9：Safety Margin ──
    const safetyMargin = evaluateSafetyMargin(resourceView, health.health);

    // ── 步 10：Empire Planner Input ──
    const plannerInput = buildEmpirePlannerInput(
      ctx.tick,
      profiles,
      capacityProfiles,
      resourceView,
      health,
      imbalance,
      budget,
      readiness,
      safetyMargin,
    );

    // ── 写入 heap 缓存（供同 tick 内其他系统只读消费）──
    cachedPlannerInput = { tick: ctx.tick, input: plannerInput };

    // ── A4.2 步 11：多资源链路 ──
    // 从 RoomSnapshot 采集矿物库存 → 帝国级 ResourceLedger → 多资源健康度 + 瓶颈
    const allSnapshots = Array.from(ctx.snapshots());
    const empireLedger = buildEmpireResourceLedger(allSnapshots);
    const energyHealthStatus = mapEnergyHealthToResourceHealth(health.health);
    const multiHealth = evaluateMultiResourceHealth(
      ctx.tick,
      empireLedger,
      energyHealthStatus,
    );
    const bottlenecks = identifyBottlenecks(empireLedger);

    // 写入 globalCache 供其他系统消费
    const g = globalCache();
    g.multiResourceHealth = multiHealth;
    g.resourceBottlenecks = bottlenecks;
    g.empireResourceLedger = empireLedger;

    // ── 写入 Memory 瘦快照 ──
    if (!Memory.kernel) Memory.kernel = {};

    // 瓶颈资源编码
    const BOTTLENECK_CODES: Record<string, number> = {
      energy: 0, U: 1, L: 2, K: 3, Z: 4, O: 5, H: 6, X: 7,
    };
    const bottleneckCode = multiHealth.bottleneck !== null
      ? (BOTTLENECK_CODES[multiHealth.bottleneck] ?? 99)
      : 99;
    const worstMineralHealthCode = multiHealth.worstMineralHealth !== null
      ? (MULTI_HEALTH_CODES[multiHealth.worstMineralHealth] ?? 0)
      : 4; // 无矿物数据时默认 healthy

    const snapshot: EmpireEconomySnapshot = {
      t: ctx.tick,
      te: resourceView.totalEnergy,
      tp: Math.round(resourceView.totalProduction * 10),
      nf: Math.round(resourceView.totalNetFlow * 100),
      tr: resourceView.totalReserve,
      rb: Math.round(resourceView.minRiskBuffer * 10),
      ef: Math.round(resourceView.avgEfficiency * 100),
      h: HEALTH_CODES[health.health] ?? 0,
      dr: imbalance.deficitCount,
      sr: imbalance.surplusCount,
      im: imbalance.hasImbalance ? 1 : 0,
      er: READINESS_CODES[readiness.readiness] ?? 0,
      sm: Math.round(safetyMargin.score * 100),
      eb: budget.expansion,
      fb: budget.free,
      rr: budget.reserve,
      // A4.2 多资源维度
      mh: MULTI_HEALTH_CODES[multiHealth.health] ?? 0,
      md: multiHealth.hasMineralDeficit ? 1 : 0,
      bn: bottleneckCode,
      wmh: worstMineralHealthCode,
    };
    Memory.kernel.empireEconomy = snapshot;

    // ── 可观测性：变更时打日志 ──
    const prev = Memory.kernel.empireEconomy;
    if (prev?.er !== snapshot.er || prev?.h !== snapshot.h || prev?.mh !== snapshot.mh) {
      const mineralInfo = multiHealth.worstMineral !== null
        ? ` worstMineral=${multiHealth.worstMineral}:${multiHealth.worstMineralHealth}`
        : "";
      console.log(
        `[${ctx.tick}] empire-economy: health=${health.health} multiHealth=${multiHealth.health}` +
        ` readiness=${readiness.readiness}` +
        ` energy=${resourceView.totalEnergy} netFlow=${resourceView.totalNetFlow.toFixed(1)}` +
        ` surplus=${imbalance.surplusCount} deficit=${imbalance.deficitCount}` +
        ` safety=${safetyMargin.score.toFixed(2)}` +
        mineralInfo +
        (bottlenecks.length > 0 ? ` bottleneck=${bottlenecks[0]?.resource}(${bottlenecks[0]?.score.toFixed(2)})` : ""),
      );
    }
  },
};
