/**
 * Agenda Manager 系统 — A3.1 Empire Resource Network·系统侧薄壳
 *（SYSTEM_BOUNDARIES §1.13 Agenda 管理器）。
 *
 * 职责（低频 100 tick 执行）：
 *   1. 从 empire-economy 获取 RoomEconomicProfile 列表
 *   2. 构建 Supply/Demand Nodes + Resource Network Snapshot
 *   3. 调用 Allocation Policy v2（7 因子可解释分配）
 *   4. 管理 OperationContext 生命周期（Memory.kernel.agendas）
 *   5. 管理 ReservationTable（Memory.kernel.reservations）
 *   6. 提交 carrier spawn 请求到 source 房 spawn queue
 *   7. 验证：检测 carrier 在 target room + carrier 实际卸载量
 *   8. 事件驱动重规划（carrier 死亡 / 房间状态变更）
 *   9. 清理终态 Operation（归档后删除）
 *   10. Network Health + Rebalance State
 *
 * A3.1 修复：
 *   - TOCTOU：Operation 创建循环中递减 transferable（防 Double Allocation）
 *   - Baseline 污染：改用 carrier 实际卸载量验证（不用 storage delta）
 *   - Operation Storm：全局上限 + per-source/target 上限
 *
 * 状态所有权（STATE_OWNERSHIP §3.1）：
 *   唯一写者 = 本系统 → Memory.kernel.agendas / Memory.kernel.reservations。
 *
 * CPU 预算：低频执行（interval=100），不每 tick 重算。
 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import { queryEconomy, type EconomyQuery } from "./economy";
import {
  buildRoomEconomicProfile,
  canExportEnergy,
  needsEnergyAid,
  type RoomEconomicProfile,
  type RoomEconomicMemory,
} from "../domain/economy/room-profile";
import { computeTransferableBulk } from "../domain/economy/ownership";
import {
  makeRegistryEntry,
  getSurplusRooms,
  getDeficitRooms,
  type RoomRegistry,
} from "../domain/strategy/room-registry";
import {
  createOperation,
  isActive,
  isTerminalStatus,
  type OperationContext,
} from "../domain/operation/agenda-item";
import {
  markReady,
  markRunning,
  markVerifying,
  markCompleted,
  markBlocked,
  markFailed,
  retryFromBlocked,
  checkExpiry,
  reportDelivery,
} from "../domain/operation/lifecycle";
import {
  createReservation,
  releaseReservation,
  sweepExpired,
  sumReservationsByRoom,
  type ReservationTable,
} from "../domain/operation/reservation";
import { shouldAbortVerification, shouldPartialComplete } from "../domain/operation/verification";
import { hasActiveOperation, pruneTerminal } from "../domain/operation/dedup";
import { processReplanEvent, type ReplanEvent } from "../domain/operation/replan";
import { computeOperationMetrics, formatOperationMetrics } from "../domain/operation/metrics";
import { submitRequest, hasRequest } from "../domain/spawn/queue";
import { selectBody } from "../config/bodies";

// A3.1 imports
import { buildSupplyNodes, type SupplyNode } from "../domain/operation/supply-node";
import { buildDemandNodes, type DemandNode } from "../domain/operation/demand-node";
import { buildNetworkSnapshot, type NetworkSnapshot } from "../domain/operation/network-snapshot";
import {
  allocateNetwork,
  type RouteDistance,
  type ExplainableAllocationResult,
} from "../domain/operation/allocation-policy";
import { MAX_GLOBAL_OPERATIONS } from "../domain/operation/allocation-policy";
import { computeNetworkHealth, type NetworkHealthResult } from "../domain/operation/network-health";
import {
  RebalanceState,
  decideRebalance,
  markRebalanced,
  type RebalanceEvent,
} from "../domain/operation/rebalance";

/** 默认 Operation 超时（tick）。2000 tick ≈ 运输 + 验证 + 重试。 */
const DEFAULT_OPERATION_DEADLINE = 2000;

/** 归档终态 Operation 的延迟（tick）。终态保留 N tick 后清理。 */
const TERMINAL_RETENTION = 1000;

/** 路由缓存（heap，跨 tick 不持久 — 失效后下次重算）。 */
const routeCache = new Map<string, { from: string; to: string; hops: number; reachable: boolean }>();

/** pending 重规划事件（heap 缓冲，下次 planning cycle 消费）。 */
let pendingEvents: ReplanEvent[] = [];

/** Rebalance 状态（heap，跨 tick 持久 — 跟随 agenda-manager 生命周期）。 */
const rebalanceState = new RebalanceState();

/** 前次 Network Snapshot（用于 rebalance 判定）。 */
let prevSnapshot: NetworkSnapshot | undefined;

/** 前次 Network Health（用于可观测性）。 */
let prevHealth: NetworkHealthResult | undefined;

/**
 * 外部写入重规划事件（供其他系统注入：carrier 死亡、房间失守等）。
 */
export function queueReplanEvent(event: ReplanEvent): void {
  pendingEvents.push(event);
}

/**
 * 外部写入 rebalance 事件（供其他系统注入：新 Supply/Demand 等）。
 */
export function queueRebalanceEvent(event: RebalanceEvent): void {
  rebalanceState.addEvent(event);
}

/**
 * 执行 Game.map.findRoute 并缓存结果。
 * 失败/不可达时返回 hops=-1。
 */
function computeRoute(from: string, to: string): { from: string; to: string; hops: number; reachable: boolean } {
  const key = `${from}:${to}`;
  const cached = routeCache.get(key);
  if (cached) return cached;

  try {
    const route = Game.map.findRoute(from, to);
    if (route === ERR_NO_PATH || (typeof route === "number" && route < 0)) {
      const result = { from, to, hops: -1, reachable: false };
      routeCache.set(key, result);
      return result;
    }
    const hops = Array.isArray(route) ? route.length : -1;
    const result = { from, to, hops, reachable: hops >= 0 };
    routeCache.set(key, result);
    return result;
  } catch {
    const result = { from, to, hops: -1, reachable: false };
    routeCache.set(key, result);
    return result;
  }
}

/** 从 Memory 加载 Operations。 */
function loadOperations(): OperationContext[] {
  const stored = Memory.kernel?.agendas;
  if (!stored || !Array.isArray(stored)) return [];
  return stored as unknown as OperationContext[];
}

/** 保存 Operations 到 Memory。 */
function saveOperations(operations: readonly OperationContext[]): void {
  if (!Memory.kernel) Memory.kernel = {};
  const now = Game.time;
  const toSave = operations.filter(
    op => isActive(op) || (isTerminalStatus(op.status) && now - op.updatedAt < TERMINAL_RETENTION),
  );
  Memory.kernel.agendas = toSave as unknown as OperationContext[];
}

/** 从 Memory 加载 ReservationTable。 */
function loadReservations(): ReservationTable {
  const stored = Memory.kernel?.reservations;
  if (!stored || typeof stored !== "object") return new Map();
  const table: ReservationTable = new Map();
  const entries = stored as Record<string, unknown>;
  for (const [id, val] of Object.entries(entries)) {
    if (val && typeof val === "object") {
      table.set(id, val as any);
    }
  }
  return table;
}

/** 保存 ReservationTable 到 Memory。 */
function saveReservations(table: ReservationTable): void {
  if (!Memory.kernel) Memory.kernel = {};
  const obj: Record<string, unknown> = {};
  for (const [id, entry] of table) {
    obj[id] = entry;
  }
  Memory.kernel.reservations = obj;
}

/**
 * 为 Operation 提交 carrier spawn 请求到 source 房的 spawn queue。
 * 请求 key = `carrier:${opId}`（幂等：同 opId 不重复提交）。
 */
function submitCarrierSpawn(op: OperationContext, tick: number): void {
  const roomMem = Memory.rooms[op.sourceRoom];
  if (!roomMem) return;

  const queue = roomMem.spawnQueue ?? [];
  const spawnKey = `carrier:${op.id}`;

  if (hasRequest(queue, spawnKey)) return;

  const sourceRoom = Game.rooms[op.sourceRoom];
  const energyCapacity = sourceRoom?.energyCapacityAvailable ?? 300;
  const body = selectBody("carrier", energyCapacity);
  if (!body) return;

  const request: SpawnRequest = {
    key: spawnKey,
    role: "carrier",
    home: op.sourceRoom,
    priority: op.priority as 0 | 1 | 2 | 3 | 4,
    body,
    memory: {
      role: "carrier",
      home: op.sourceRoom,
      remoteTarget: op.targetRoom,
      assignment: {
        id: op.id,
        kind: "carrier",
      } as unknown as CreepAssignment,
    } as unknown as CreepMemory,
    createdAt: tick,
    expiresAt: tick + DEFAULT_OPERATION_DEADLINE,
    retries: 0,
  };

  submitRequest(queue, request);
  roomMem.spawnQueue = queue;
}

/**
 * 检查 Operation 是否已有 carrier 在场。
 */
function hasCarrierForOp(op: OperationContext): boolean {
  if (op.carrierName) {
    const creep = Game.creeps[op.carrierName];
    if (creep && !creep.spawning) return true;
  }
  const roomMem = Memory.rooms[op.sourceRoom];
  if (roomMem?.spawnQueue) {
    const spawnKey = `carrier:${op.id}`;
    if (hasRequest(roomMem.spawnQueue, spawnKey)) return true;
  }
  return false;
}

export const agendaManagerSystem: System = {
  name: "agenda-manager",
  priority: 1 as Priority,
  interval: 100,
  run(ctx: TickContext): void {
    // ── 0. 加载状态 ──
    let operations = loadOperations();
    let reservations = loadReservations();

    // ── 1. 处理 pending 重规划事件 ──
    if (pendingEvents.length > 0) {
      for (const event of pendingEvents) {
        operations = processReplanEvent(operations, event, ctx.tick);
      }
      pendingEvents = [];
    }

    // ── 2. 超时检查 ──
    operations = operations.map(op => {
      const expiry = checkExpiry(op, ctx.tick);
      return expiry.op;
    });

    // ── 3. Reservation TTL 清扫 ──
    const sweepResult = sweepExpired(reservations, ctx.tick);
    reservations = sweepResult.table;
    for (const opId of sweepResult.expired) {
      operations = operations.map(op => {
        if (op.id === opId && isActive(op)) {
          const result = markBlocked(op, ctx.tick, "reservation expired");
          return result.op;
        }
        return op;
      });
    }

    // ── 4. 验证阶段 Operation 检查 ──
    operations = operations.map(op => {
      if (op.status !== "verifying") return op;
      if (shouldAbortVerification(op, ctx.tick)) {
        const result = markFailed(op, ctx.tick, "verification timeout: 0 delivery");
        return result.op;
      }
      if (shouldPartialComplete(op, ctx.tick)) {
        const result = markCompleted(op, ctx.tick);
        return result.op;
      }
      return op;
    });

    // ── 5. blocked Operation 重试 ──
    operations = operations.map(op => {
      if (op.status === "blocked") {
        const result = retryFromBlocked(op, ctx.tick);
        if (result.ok) return result.op;
        const failResult = markFailed(op, ctx.tick, "max retries exceeded");
        if (!failResult.ok) {
          reservations = releaseReservation(reservations, op.id);
        }
        return failResult.op;
      }
      return op;
    });

    // ── 6. 构建 Room Profiles ──
    const profiles: RoomEconomicProfile[] = [];
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
    }

    if (profiles.length < 2) {
      saveOperations(operations);
      saveReservations(reservations);
      return;
    }

    // ── 7. 计算各房可调拨量 ──
    const reservationsByRoom = new Map<string, number>();
    for (const profile of profiles) {
      const reserved = sumReservationsByRoom(reservations, profile.roomName);
      reservationsByRoom.set(profile.roomName, reserved);
    }
    const transferableMap = computeTransferableBulk(profiles, reservationsByRoom);

    // ── 8. 构建 Room Registry ──
    const registry: RoomRegistry = new Map();
    for (const profile of profiles) {
      const transferable = transferableMap.get(profile.roomName) ?? 0;
      const entry = makeRegistryEntry(profile, transferable, ctx.tick);
      entry.canExport = canExportEnergy(profile) && transferable > 0;
      entry.needsAid = needsEnergyAid(profile);
      registry.set(profile.roomName, entry);
    }

    // ── 9. 构建 Supply/Demand Nodes（A3.1 新增）──
    const surplusRooms = getSurplusRooms(registry);
    const deficitRooms = getDeficitRooms(registry);

    const inTransitByTarget = new Map<string, number>();
    for (const op of operations) {
      if (isActive(op) && (op.status === "running" || op.status === "verifying" || op.status === "ready")) {
        const current = inTransitByTarget.get(op.targetRoom) ?? 0;
        inTransitByTarget.set(op.targetRoom, current + (op.requestedAmount - op.deliveredAmount));
      }
    }

    const supplyNodes = buildSupplyNodes(surplusRooms, reservationsByRoom, ctx.tick);
    const demandNodes = buildDemandNodes(deficitRooms, inTransitByTarget, ctx.tick);

    // ── 10. 构建 Network Snapshot ──
    const snapshot = buildNetworkSnapshot(
      ctx.tick,
      supplyNodes,
      demandNodes,
      operations,
      reservations,
      [], // allocationPlans will be filled below
    );

    // ── 11. Rebalance 判定（A3.1 新增）──
    const rebalanceDecision = decideRebalance(rebalanceState, ctx.tick);
    const shouldDoRebalance = rebalanceDecision.shouldRebalance;

    // ── 12. 分配策略（A3.1 Allocation Policy v2）──
    let allocResult: ExplainableAllocationResult | undefined;

    if (shouldDoRebalance && supplyNodes.length > 0 && demandNodes.length > 0) {
      // 构建路由距离表
      const routes = new Map<string, RouteDistance>();
      for (const s of supplyNodes) {
        for (const d of demandNodes) {
          const route = computeRoute(s.room, d.room);
          routes.set(`${s.room}:${d.room}`, {
            from: s.room,
            to: d.room,
            hops: route.hops,
            reachable: route.reachable,
          });
        }
      }

      // 统计活跃 Operation by source/target
      const activeOpsBySource = new Map<string, number>();
      const activeOpsByTarget = new Map<string, number>();
      for (const op of operations) {
        if (isActive(op)) {
          activeOpsBySource.set(op.sourceRoom, (activeOpsBySource.get(op.sourceRoom) ?? 0) + 1);
          activeOpsByTarget.set(op.targetRoom, (activeOpsByTarget.get(op.targetRoom) ?? 0) + 1);
        }
      }

      // Operation Storm 防护：活跃 Operation 已达上限不再创建
      const activeCount = operations.filter(isActive).length;
      if (activeCount < MAX_GLOBAL_OPERATIONS) {
        allocResult = allocateNetwork(
          supplyNodes,
          demandNodes,
          routes,
          activeOpsBySource,
          activeOpsByTarget,
          ctx.tick,
        );
      }

      // 标记 rebalance 完成
      markRebalanced(rebalanceState, ctx.tick);
    }

    // ── 13. 为新计划创建 Operation（TOCTOU 修复）──
    if (allocResult) {
      // 用本地 Map 追踪 transferable 递减 — TOCTOU 防护
      const sourceTransferable = new Map<string, number>();
      for (const s of supplyNodes) {
        sourceTransferable.set(s.room, s.transferable);
      }

      for (const plan of allocResult.plans) {
        // Operation Storm 防护
        if (operations.filter(isActive).length >= MAX_GLOBAL_OPERATIONS) break;

        // 幂等去重
        if (hasActiveOperation(operations, plan.sourceRoom, plan.targetRoom, "energy")) {
          continue;
        }

        // TOCTOU 防护：从本地 Map 检查 + 递减（不用 registry 的过时快照）
        const localAvail = sourceTransferable.get(plan.sourceRoom) ?? 0;
        if (localAvail < plan.amount) continue;

        const deadline = ctx.tick + DEFAULT_OPERATION_DEADLINE;
        const op = createOperation(
          plan.sourceRoom,
          plan.targetRoom,
          "energy",
          plan.amount,
          plan.priority,
          deadline,
          ctx.tick,
        );

        const readyResult = markReady(op, ctx.tick);
        if (readyResult.ok) {
          operations.push(readyResult.op);
          // 创建 Reservation
          reservations = createReservation(
            reservations,
            readyResult.op.id,
            plan.sourceRoom,
            plan.targetRoom,
            plan.amount,
            ctx.tick,
          );
          // TOCTOU 防护：递减本地可调拨量
          sourceTransferable.set(plan.sourceRoom, localAvail - plan.amount);
        }
      }
    }

    // ── 13.5 A4.3：Plan 驱动的 Operation 创建 ──
    // 从 logistics-planner 产出的 Transport Plan 中筛选 scope="empire" 的请求，
    // 为尚未有活跃 Operation 的 (source, target, resource) 三元组创建新 Operation。
    // 这补充了 allocation-policy 只处理 energy 的局限——Plan 可产出矿物等非能量资源的跨房请求。
    const logisticsPlan = globalCache().logisticsPlan?.plan;
    if (logisticsPlan && logisticsPlan.plannedAt >= ctx.tick - 100) {
      // 仅消费最近 100 tick 内产出的 Plan（避免过期 Plan 创建僵尸 Operation）。
      const sourceTransferablePlan = new Map<string, number>();
      for (const s of supplyNodes) {
        sourceTransferablePlan.set(s.room, s.transferable);
      }

      for (const req of logisticsPlan.requests) {
        if (req.scope !== "empire") continue;
        // Operation Storm 防护
        if (operations.filter(isActive).length >= MAX_GLOBAL_OPERATIONS) break;

        // 幂等去重：同 (source, target, resource) 只有一个活跃 Operation
        if (hasActiveOperation(operations, req.source.room, req.destination.room, req.resource)) {
          continue;
        }

        // TOCTOU 防护
        const localAvail = sourceTransferablePlan.get(req.source.room) ?? 0;
        if (localAvail < req.amount) continue;

        const deadline = Math.min(req.deadline, ctx.tick + DEFAULT_OPERATION_DEADLINE);
        const op = createOperation(
          req.source.room,
          req.destination.room,
          req.resource,
          req.amount,
          req.priority as 0 | 1 | 2 | 3,
          deadline,
          ctx.tick,
        );

        const readyResult = markReady(op, ctx.tick);
        if (readyResult.ok) {
          operations.push(readyResult.op);
          reservations = createReservation(
            reservations,
            readyResult.op.id,
            req.source.room,
            req.destination.room,
            req.amount,
            ctx.tick,
          );
          sourceTransferablePlan.set(req.source.room, localAvail - req.amount);
        }
      }
    }

    // ── 14. 路由计算 + carrier spawn 请求 ──
    for (const op of operations) {
      if (op.status !== "ready") continue;

      const route = computeRoute(op.sourceRoom, op.targetRoom);
      if (!route.reachable) {
        const blockedResult = markBlocked(op, ctx.tick, "route unreachable");
        if (blockedResult.ok) {
          const idx = operations.indexOf(op);
          if (idx >= 0) operations[idx] = blockedResult.op;
        }
        continue;
      }

      const sourceSnapshot = ctx.getSnapshot(op.sourceRoom);
      const sourceStorage = sourceSnapshot?.storage;
      if (!sourceStorage) {
        const blockedResult = markBlocked(op, ctx.tick, "source storage lost");
        if (blockedResult.ok) {
          const idx = operations.indexOf(op);
          if (idx >= 0) operations[idx] = blockedResult.op;
        }
        continue;
      }

      submitCarrierSpawn(op, ctx.tick);

      // ready → running
      const runningResult = markRunning(op, ctx.tick);
      if (runningResult.ok) {
        const idx = operations.indexOf(op);
        if (idx >= 0) {
          operations[idx] = runningResult.op;
        }
      }
    }

    // ── 15. 验证 running Operation（Baseline 污染修复）──
    for (const op of operations) {
      if (op.status !== "running") continue;

      const carrierExists = hasCarrierForOp(op);
      if (!carrierExists) {
        const roomMem = Memory.rooms[op.sourceRoom];
        const spawnKey = `carrier:${op.id}`;
        const inQueue = roomMem?.spawnQueue?.some(r => r.key === spawnKey) ?? false;
        if (!inQueue && !op.carrierName) {
          submitCarrierSpawn(op, ctx.tick);
        }
        continue;
      }

      // 记录 carrier name
      if (!op.carrierName) {
        for (const [name, creep] of Object.entries(Game.creeps)) {
          if (creep.memory.assignment?.id === op.id) {
            const idx = operations.indexOf(op);
            if (idx >= 0) operations[idx]!.carrierName = name;
            break;
          }
        }
      }

      // 检查 carrier 是否到达 target room 且空载
      const carrierName = op.carrierName;
      if (carrierName) {
        const carrier = Game.creeps[carrierName];
        if (carrier && !carrier.spawning) {
          if (carrier.room.name === op.targetRoom && carrier.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
            // A3.1 修复：用 carrier 的实际 carry 容量作为送达量（不用 storage delta）
            // carrier 空载 = 它已卸完所有能量到 target storage
            // 这是行为证据——不依赖其他 Operation 的状态
            const carrierCapacity = carrier.store.getCapacity(RESOURCE_ENERGY);

            if (carrierCapacity > 0) {
              const idx = operations.indexOf(op);
              if (idx >= 0) {
                operations[idx] = reportDelivery(op, carrierCapacity, ctx.tick);

                // 检查是否完成
                if (operations[idx]!.deliveredAmount >= op.requestedAmount) {
                  // 全量送达 → completed
                  const completedResult = markCompleted(operations[idx]!, ctx.tick);
                  if (completedResult.ok) {
                    operations[idx] = completedResult.op;
                    reservations = releaseReservation(reservations, op.id);
                  }
                } else {
                  // 部分送达 → verifying
                  const verifyingResult = markVerifying(operations[idx]!, ctx.tick);
                  if (verifyingResult.ok) operations[idx] = verifyingResult.op;
                }
              }
            }
          }
        }
      }
    }

    // ── 16. 清理终态 Operation ──
    operations = pruneTerminal(operations);

    // ── 17. 构建 final Network Snapshot + Health ──
    const finalSnapshot = buildNetworkSnapshot(
      ctx.tick,
      supplyNodes,
      demandNodes,
      operations,
      reservations,
      allocResult?.plans ?? [],
    );

    const health = computeNetworkHealth(finalSnapshot, operations, ctx.tick);

    // ── 18. 保存状态 ──
    saveOperations(operations);
    saveReservations(reservations);

    // ── 19. 可观测性 ──
    const metrics = computeOperationMetrics(operations, ctx.tick);
    const g = globalCache();
    g.agendaMetrics = metrics;

    // 存储 A3.1 可观测性数据
    g.networkSnapshot = finalSnapshot;
    g.networkHealth = health;

    prevSnapshot = finalSnapshot;
    prevHealth = health;

    if (metrics.activeCount > 0 || health.level !== "healthy") {
      console.log(formatOperationMetrics(metrics));
      console.log(`Network Health: ${health.level} (score=${health.score.toFixed(2)}, supply=${finalSnapshot.totalSupply}, demand=${finalSnapshot.totalRemaining})`);
    }
  },
};
