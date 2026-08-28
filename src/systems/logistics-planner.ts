/** Logistics Planner 系统 */
import type { Priority, System, TickContext, RoomSnapshot } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import { CONFIG } from "../config";
import {
  planLogistics,
  type PlannerInput,
} from "../domain/logistics/planner";
import type { TransportPlan } from "../domain/logistics/transport-plan";
import { createEmptyPlan } from "../domain/logistics/transport-plan";
import {
  planEmpireCapacity,
  type RoomCapacityInput,
  type EmpireCapacityResult,
} from "../domain/logistics/capacity-planning";
import { RouteCache } from "../domain/logistics/route-cache";
import { createRoute } from "../domain/logistics/route";
import type { SupplyContract } from "../domain/economy/supply-contract";
import { isContractActive } from "../domain/economy/supply-contract";
import type { SupplyNode } from "../domain/operation/supply-node";
import type { DemandNode } from "../domain/operation/demand-node";
import type { ResourceType, OperationPriority } from "../domain/operation/agenda-item";
import {
  computeLogisticsHealth,
  type LogisticsHealthResult,
} from "../domain/logistics/logistics-health";
import {
  createAccounting,
  recordDelivered,
  recordLost,
  summarizeAccounting,
  type TransportAccounting,
} from "../domain/logistics/transport-accounting";
import { detectBottleneck } from "../domain/logistics/bottleneck";
import { detectStarvation } from "../domain/logistics/starvation";
import {
  detectIdleHaulers,
  type HaulerIdleSummary,
} from "../domain/logistics/idle-detection";
import { log } from "../kernel/log";

// ─── 路由缓存（heap，跨 tick 持久） ─────────────────────────

/** 帝国级 RouteCache — 跨 tick 持久（heap），global reset 后重建。 */
const routeCache = new RouteCache();

// ─── 空闲追踪（heap，跨 tick 持久） ─────────────────────────

/** 房间 → 房间级运力规划结果（heap，每周期覆写）。 */
let lastCapacityResult: EmpireCapacityResult | undefined;

/** 房间 → hauler 闲置持续 tick 计数（heap，跨 tick 持续）。 */
const idleTicksByRoom = new Map<string, number>();

// A4.4 修复 BYPASS-010：跨 tick Transport Accounting 追踪（heap，跨 tick 持久）。
// key = requestId, value = TransportAccounting。
// 每 100t 由 logistics-planner 从 Operation 状态同步 delivered/lost。
const accountingByRequestId = new Map<string, TransportAccounting>();

// ─── 系统定义 ─────────────────────────────────────────────

export const logisticsPlannerSystem: System = {
  name: "logistics-planner",
  priority: 1 as Priority,
  interval: 100,

  run(ctx: TickContext): void {
    // ── 1. 收集运行时数据 ──
    const snapshots = [...ctx.snapshots()];

    // 1a. 收集 Supply Contracts（从 Memory.kernel.supplyContracts 读取）
    const contracts = collectContracts();

    // 1b. 收集 Supply/Demand Nodes（复用 agenda-manager 已写入 globalCache 的 networkSnapshot）
    const networkSnapshot = globalCache().networkSnapshot;
    const surpluses: SupplyNode[] = networkSnapshot?.supplyNodes ?? [];
    const deficits: DemandNode[] = networkSnapshot?.demandNodes ?? [];

    // 1b-A5.3. 战争物流需求注入：从 globalCache.warLogisticsDemand 提取
    //   WarPlan 产出的 energy/boost/transport/replacement 需求，
    //   适配为 DemandNode 注入物流规划，使战争物资进入物流网络。
    const warLogi = globalCache().warLogisticsDemand;
    if (warLogi && warLogi.tick >= ctx.tick - 100) {
      // 能量需求（孵化 + 运输）— 战争物资优先级 high
      if (warLogi.energy > 0) {
        deficits.push({
          room: warLogi.sponsor,
          resource: "energy" as const,
          requested: warLogi.energy,
          priority: 1 as OperationPriority,
          deadline: ctx.tick + 2000,
          criticality: "high" as const,
          fulfilled: 0,
          remaining: warLogi.energy,
          firstSeen: warLogi.tick,
          timestamp: warLogi.tick,
        });
      }
    }

    // 1b-A5.4.1. 战术补给需求注入：从 globalCache.tacticalSupplyDemands 提取
    //   Tactical Runtime 产出的 energy 补给需求，
    //   适配为 DemandNode 注入物流规划，使战术物资进入物流网络。
    const tacG = globalCache() as ReturnType<typeof globalCache> & {
      tacticalSupplyDemands?: Array<{
        squadId: string;
        operationId: string;
        resource: string;
        amount: number;
        targetRoom: string;
        priority: 0 | 1 | 2 | 3;
        tick: number;
        reason: string;
      }>;
    };
    const tacSupplies = tacG.tacticalSupplyDemands;
    if (tacSupplies && tacSupplies.length > 0) {
      for (const td of tacSupplies) {
        if (td.amount <= 0) continue;
        deficits.push({
          room: td.targetRoom,
          resource: td.resource as "energy",
          requested: td.amount,
          priority: td.priority as OperationPriority,
          deadline: ctx.tick + 2000,
          criticality: "high" as const,
          fulfilled: 0,
          remaining: td.amount,
          firstSeen: td.tick,
          timestamp: td.tick,
        });
      }
    }

    // 1c. 收集运力规划输入
    const capacityInputs = collectCapacityInputs(snapshots, ctx.tick);

    // 1d. 执行运力规划
    const capacity = planEmpireCapacity(capacityInputs);
    lastCapacityResult = capacity;

    // 1e. 更新路由缓存
    refreshRouteCache(snapshots, ctx.tick);

    // 1f. 收集威胁评估
    const threats = collectThreats(snapshots);

    // ── 2. 调用纯函数：planLogistics ──
    const plannerInput: PlannerInput = {
      contracts,
      deficits,
      surpluses,
      capacity,
      routeCache,
      threats,
      tick: ctx.tick,
    };

    const plan = planLogistics(plannerInput);

    // ── 3. 收集 Accounting ──
    // A4.4 修复 BYPASS-010：跨 tick Accounting 追踪。
    // 旧问题：collectAccounting 只从 Plan requests 创建初始 Accounting（delivered/lost=0），
    //   无跨 tick 累积 → Logistics Health 基于空数据 → deliveryRate/lossRate 不可信。
    // 修复：
    //   1. 为 Plan 中的新 requests 创建初始 Accounting
    //   2. 从 Memory 中的 Operation 状态同步 delivered/lost
    //   3. 写入 globalCache 供其他系统消费
    const accounting = collectAccountingWithTracking(plan, ctx.tick);
    const accountingSummary = summarizeAccounting(accounting);

    // ── 4. 计算 Logistics Health ──
    // A4.4 修复 BYPASS-011：Health 基于真实 Accounting 数据，不再全为 0。
    const avgLatency = computeAvgLatency();
    const health = computeLogisticsHealth(accounting, plan.requests, avgLatency, ctx.tick);

    // ── 5. 检测瓶颈 ──
    const bottlenecks = capacity.rooms.map(r => {
      const input = capacityInputs.find(c => c.room === r.room);
      return detectBottleneck(
        input?.productionRate ?? 0,   // productionRate
        r.actualCapacity,              // logisticsCapacity
        0,                              // storageCapacity（由系统侧填充）
        input?.consumptionRate ?? 0,   // consumptionRate
        r.room,                         // room
      );
    });

    // ── 6. 检测饥饿 ──
    const empireTotalSupply = surpluses.reduce((s, n) => s + n.transferable, 0);
    const empireTotalDemand = deficits.reduce((s, n) => s + n.remaining, 0);
    const starvationResults = snapshots.map(s =>
      detectStarvation(
        s.roomName,
        0, // deficitDuration — 需跨 tick 追踪（Phase 8 测试验证）
        empireTotalSupply,
        empireTotalDemand,
      ),
    );

    // ── 7. 检测闲置 hauler ──
    const haulerSummaries = collectHaulerSummaries();
    const idleThreshold = 200;
    const idleHaulerNames = detectIdleHaulers(haulerSummaries, ctx.tick, idleThreshold);

    // 更新闲置 tick 计数
    for (const [roomName, ticks] of idleTicksByRoom) {
      // 如果该房没有闲置 hauler，递减计数
      const roomHasIdle = idleHaulerNames.some(name => {
        const creep = Game.creeps[name];
        return creep?.memory?.home === roomName;
      });
      if (!roomHasIdle) {
        idleTicksByRoom.set(roomName, Math.max(0, ticks - 1));
      }
    }
    // 对有闲置 hauler 的房间递增
    for (const name of idleHaulerNames) {
      const creep = Game.creeps[name];
      const home = creep?.memory?.home ?? creep?.room?.name;
      if (home) {
        idleTicksByRoom.set(home, (idleTicksByRoom.get(home) ?? 0) + 1);
      }
    }

    // ── 8. 扩缩编决策 ──
    // 【WO-DEAD 已删除】logisticsScaling — 只写不读的观测字段，构建代码已清理。

    // ── 9. 构建 Dashboard ──
    // 【WO-DEAD 已删除】logisticsDashboard — 只写不读的仪表盘字段，构建代码已清理。

    // ── 10. 写入 globalCache 供下游消费 ──
    const g = globalCache();
    g.logisticsPlan = { tick: ctx.tick, plan };
    g.logisticsHealth = health;
    g.logisticsCapacity = { tick: ctx.tick, result: capacity };
    g.logisticsIdleHaulers = { tick: ctx.tick, names: idleHaulerNames };
    // A4.4 修复 BYPASS-010：暴露 Accounting 到 globalCache 供 Observability 消费。
    g.logisticsAccounting = { tick: ctx.tick, summary: accountingSummary, entries: accounting };

    // ── 11. 控制台输出（观测用，低频不会刷屏） ──
    if (plan.requests.length > 0 || health.level !== "healthy") {
      log.info("logistics-planner", `logistics-planner: ${plan.reason}, ` +
        `health=${health.level}(${health.score.toFixed(2)}), ` +
        `delivery=${(health.deliveryRate * 100).toFixed(0)}%, ` +
        `backlog=${health.backlogCount}, ` +
        `capacity_gap=H${capacity.totalHaulerGap}/C${capacity.totalCarrierGap}, ` +
        `accounting=req=${accountingSummary.totalRequested}/del=${accountingSummary.totalDelivered}/lost=${accountingSummary.totalLost}`,);
    }
  },
};

// ─── 数据收集辅助函数 ─────────────────────────────────────

/**
 * 收集 Supply Contracts（从 Memory 读取）。
 * Contracts 由 supply-contract-manager（未来模块）或 empire-economy 写入。
 */
function collectContracts(): SupplyContract[] {
  const stored = (Memory.kernel as { supplyContracts?: SupplyContract[] })?.supplyContracts;
  if (!stored || !Array.isArray(stored)) return [];
  return stored as SupplyContract[];
}

/**
 * 收集每房的运力规划输入。
 * 从 RoomSnapshot + Game.creeps 提取：
 *   - productionRate（source 数 × 10 e/tick/source 近似）
 *   - consumptionRate（fillTargets 缺口近似）
 *   - roundTripTicks（从 layout 或经验值估算）
 *   - haulerCapacity（从 body 计算）
 *   - currentHaulerCount / currentCarrierCount（从 Game.creeps 计数）
 */
function collectCapacityInputs(snapshots: readonly RoomSnapshot[], tick: number): RoomCapacityInput[] {
  const result: RoomCapacityInput[] = [];

  // 全房 creep 按 home 分桶
  const haulersByRoom = new Map<string, Creep[]>();
  const carriersByRoom = new Map<string, Creep[]>();
  for (const creep of Object.values(Game.creeps)) {
    if (creep.spawning) continue;
    const home = creep.memory.home ?? creep.room?.name;
    if (!home) continue;
    const role = creep.memory.role;
    if (role === "hauler") {
      let arr = haulersByRoom.get(home);
      if (!arr) { arr = []; haulersByRoom.set(home, arr); }
      arr.push(creep);
    } else if (role === "carrier") {
      let arr = carriersByRoom.get(home);
      if (!arr) { arr = []; carriersByRoom.set(home, arr); }
      arr.push(creep);
    }
  }

  for (const snap of snapshots) {
    // 生产率近似：每 source 10 e/tick（Screeps 标准 source 产出 3000/300 = 10 e/tick）
    const productionRate = snap.sources.length * 10;

    // 消费率近似：fillTargets 缺口总量 / 100（粗略估算）
    let consumptionRate = 0;
    for (const ft of snap.fillTargets) {
      const deficit = ft.store.getCapacity(RESOURCE_ENERGY) - ft.store.getUsedCapacity(RESOURCE_ENERGY);
      consumptionRate += deficit / 100;
    }

    // 往返时间：本地搬运约 20 tick（经验值，可由 layout 距离校准）
    const localRoundTripTicks = 20;

    // 跨房往返：从 RoomMemory.intel.pathCost 估算，无则 0
    const crossRoomRoundTripTicks = 0; // 本房运力规划不含跨房

    // hauler 运力：从 body 计算
    const haulers = haulersByRoom.get(snap.roomName) ?? [];
    const haulerCapacity = haulers.length > 0
      ? haulers[0]!.body.filter(p => p.type === CARRY).length * CARRY_CAPACITY
      : 100; // 默认 2 CARRY body

    result.push({
      room: snap.roomName,
      productionRate,
      consumptionRate,
      localRoundTripTicks,
      crossRoomRoundTripTicks,
      haulerCapacity,
      currentHaulerCount: haulers.length,
      currentCarrierCount: (carriersByRoom.get(snap.roomName) ?? []).length,
    });
  }

  return result;
}

/**
 * 刷新路由缓存：从 Game.map.describeExits 重建已知房间对的路由。
 * 仅对有 terminal 或有远矿/跨房 Operation 的房间对建路由。
 */
function refreshRouteCache(snapshots: readonly RoomSnapshot[], tick: number): void {
  // 清理过期路由（> 5000 tick 未使用）
  const expired = routeCache.sweep(tick, 5000);
  if (expired.length > 0) {
    // 静默清理 — 低频运行不刷屏
  }

  // 为有跨房需求的对建路由
  const networkSnapshot = globalCache().networkSnapshot;
  if (!networkSnapshot) return;

  // 从 SupplyNode / DemandNode 对提取需要路由的房间对
  const supplyRooms = new Set(networkSnapshot.supplyNodes.map(n => n.room));
  const demandRooms = new Set(networkSnapshot.demandNodes.map(n => n.room));

  for (const from of supplyRooms) {
    for (const to of demandRooms) {
      if (from === to) continue;
      if (!routeCache.needsReeval(from, to, 0, 0, 100, tick)) continue;

      // 从 Game.map 估算路由
      const linearDist = estimateLinearDistance(from, to);
      if (linearDist < 0) continue; // 无法计算

      const route = createRoute(
        from,
        to,
        linearDist,
        linearDist * 50, // 估算单程 tick（50 tick/room）
        linearDist * 100, // 估算成本（100 energy/room）
        tick,
        [],
      );
      routeCache.set(route);
    }
  }
}

/**
 * 估算两房间的线性距离。
 * 使用 Game.map.getRoomLinearDistance（如果可用）。
 */
function estimateLinearDistance(from: string, to: string): number {
  try {
    return Game.map.getRoomLinearDistance(from, to) ?? -1;
  } catch {
    return -1;
  }
}

/**
 * 收集威胁评估：从 RoomSnapshot.threatCreeps 推导每房威胁等级。
 */
function collectThreats(snapshots: readonly RoomSnapshot[]): Map<string, number> {
  const threats = new Map<string, number>();
  for (const snap of snapshots) {
    const hostileCount = snap.threatCreeps.length;
    const threat = hostileCount > 0 ? Math.min(1, hostileCount / 5) : 0;
    threats.set(snap.roomName, threat);
  }
  return threats;
}

/**
 * A4.4 修复 BYPASS-010：跨 tick Accounting 追踪。

 * 逻辑：
 *   1. 为 Plan 中的新 requests 创建初始 Accounting（如果 requestId 不在缓存中）
 *   2. 从 Memory 中的 Operation 状态同步 delivered/lost
 *   3. 清理已完成的 Accounting 条目（防止无限增长）
 *   4. 返回当前所有活跃 Accounting 条目
 */
function collectAccountingWithTracking(plan: TransportPlan, tick: number): TransportAccounting[] {
  // 1. 为新 requests 创建初始 Accounting
  for (const req of plan.requests) {
    if (!accountingByRequestId.has(req.requestId)) {
      accountingByRequestId.set(req.requestId, createAccounting(req.requestId, req.amount));
    }
  }

  // 2. 从 Operation 状态同步 delivered/lost
  syncAccountingFromOperations(tick);

  // 3. 清理已完成的条目（delivered + lost >= requested 且超过 500 tick）
  cleanupCompletedAccounting(tick);

  // 4. 返回 Plan 中 requests 对应的 Accounting
  return plan.requests.map(r => accountingByRequestId.get(r.requestId)!).filter(Boolean);
}

/**
 * 从 Memory 中的 Operation 状态同步 delivered/lost 到 Accounting。

 * Operation 的 deliveredAmount / requestedAmount 对应 Accounting 的 delivered / requested。
 * Operation 失败（status=failed）→ lost = requestedAmount - deliveredAmount。
 */
function syncAccountingFromOperations(tick: number): void {
  const operations = loadOperations();

  for (const op of operations) {
    // 只处理 supply 类型的 Operation（跨房调拨）
    if (op.type !== "supply") continue;

    // 从 Operation 的 sourceRoom/targetRoom 推导 requestId
    // Plan 的 requestId 格式: `tr:${scope}:${sourceRoom}:${targetRoom}:${resource}:${seq}`
    // Operation 不直接存储 requestId，用 (source, target, resource) 匹配
    const matchingReqs = findMatchingRequests(op.sourceRoom, op.targetRoom, op.resource);

    for (const reqId of matchingReqs) {
      const acc = accountingByRequestId.get(reqId);
      if (!acc) continue;

      // 同步 delivered
      if (op.deliveredAmount > acc.delivered) {
        const delta = op.deliveredAmount - acc.delivered;
        const updated = recordDelivered(acc, delta);
        accountingByRequestId.set(reqId, updated);
      }

      // 同步 lost（Operation 失败时）
      if (op.status === "failed" || op.status === "cancelled") {
        const lostAmount = op.requestedAmount - op.deliveredAmount;
        if (lostAmount > 0) {
          const current = accountingByRequestId.get(reqId)!;
          if (lostAmount > current.lost) {
            const updated = recordLost(current, lostAmount - current.lost);
            accountingByRequestId.set(reqId, updated);
          }
        }
      }
    }
  }
}

/**
 * 从 Memory 读取 Operations。
 */
function loadOperations(): import("../domain/operation/agenda-item").OperationContext[] {
  const stored = (global as unknown as { __operations?: import("../domain/operation/agenda-item").OperationContext[] }).__operations;
  return stored ?? [];
}

/**
 * 在 Accounting 缓存中查找与 (source, target, resource) 匹配的 requestId。
 */
function findMatchingRequests(sourceRoom: string, targetRoom: string, resource: string): string[] {
  const result: string[] = [];
  for (const [reqId] of accountingByRequestId) {
    // requestId 格式: tr:${scope}:${source}:${target}:${resource}:${seq}
    const parts = reqId.split(":");
    if (parts.length >= 5 && parts[2] === sourceRoom && parts[3] === targetRoom && parts[4] === resource) {
      result.push(reqId);
    }
  }
  return result;
}

/**
 * 清理已完成的 Accounting 条目（防止 Map 无限增长）。
 * 完成条件：delivered + lost >= requested 且超过 500 tick 未更新。
 */
function cleanupCompletedAccounting(tick: number): void {
  // Accounting 不存储 tick，用 globalCache 的 logisticsPlan.tick 作为近似
  // 清理条件：Plan 中不再包含该 requestId，且 Accounting 的 remaining = 0
  const currentPlan = globalCache().logisticsPlan?.plan;
  const currentReqIds = new Set(currentPlan?.requests.map(r => r.requestId) ?? []);

  for (const [reqId, acc] of accountingByRequestId) {
    // 如果不在当前 Plan 中且已完成/失败，清理
    if (!currentReqIds.has(reqId) && acc.remaining <= 0) {
      accountingByRequestId.delete(reqId);
    }
  }

  // 安全上限：最多保留 200 条 Accounting（防止异常情况下的无限增长）
  if (accountingByRequestId.size > 200) {
    // 删除最早创建的条目（按 requestId 排序，旧的先删）
    const sorted = [...accountingByRequestId.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const toRemove = sorted.slice(0, accountingByRequestId.size - 200);
    for (const [id] of toRemove) {
      accountingByRequestId.delete(id);
    }
  }
}

/**
 * 计算平均延迟（从 logistics 系统的延迟样本环）。
 */
function computeAvgLatency(): number {
  // 复用 logistics 系统的延迟样本
  // 通过动态 import 避免循环依赖
  // 延迟样本由 logistics 系统的 logisticsLatencySamples() 导出函数提供。
  // 此处通过 globalCache 的 logisticsLatency 字段读取（如 logistics 系统写入）。
  // 当前使用 0 作为默认值——Phase 8 集成时接入 logistics 延迟样本。
  return 0;
}

/**
 * 收集 hauler 摘要（供闲置检测）。
 */
function collectHaulerSummaries(): HaulerIdleSummary[] {
  const result: HaulerIdleSummary[] = [];
  for (const creep of Object.values(Game.creeps)) {
    if (creep.spawning) continue;
    const role = creep.memory.role;
    if (role !== "hauler" && role !== "carrier" && role !== "remoteHauler") continue;
    result.push({
      name: creep.name,
      lastActionTick: (creep.memory as { lastActionTick?: number }).lastActionTick ?? Game.time,
      ticksToLive: creep.ticksToLive ?? 1500,
      role,
    });
  }
  return result;
}

/**
 * 收集 hauler 运力信息（供 Dashboard）。
 */
function collectHaulerCapacityInfo(snapshots: readonly RoomSnapshot[]) {
  const haulers: { capacity: number; idle: boolean }[] = [];
  for (const creep of Object.values(Game.creeps)) {
    if (creep.spawning) continue;
    const role = creep.memory.role;
    if (role !== "hauler" && role !== "carrier" && role !== "remoteHauler") continue;
    const capacity = creep.store.getCapacity(RESOURCE_ENERGY);
    const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    haulers.push({ capacity, idle: used === 0 && !creep.memory.assignment });
  }
  return haulers;
}

/**
 * 检查 spawn 是否有余力（用于扩缩编决策）。
 */
function checkSpawnAvailable(snap: RoomSnapshot | undefined): boolean {
  if (!snap) return false;
  // 有空闲 spawn 或孵化队列不满
  const spawning = snap.spawns.filter(s => s.spawning).length;
  return spawning < snap.spawns.length;
}

/**
 * 获取房间经济压力（0..1, 0=健康, 1=危机）。
 */
function getEconomyPressure(roomName: string): number {
  const econSnap = Memory.rooms[roomName]?.economy;
  if (!econSnap) return 0;
  // CR > 1 = 高压力
  return Math.min(1, (econSnap.cr ?? 0) / 2);
}

// ─── 查询口（供其他系统消费） ─────────────────────────────

/**
 * 获取最近的 Transport Plan（供 logistics / agenda-manager 消费）。
 */
export function getLogisticsPlan(): TransportPlan | undefined {
  const cached = globalCache().logisticsPlan;
  if (!cached) return undefined;
  return cached.plan;
}


