/**
 * Agenda Manager 系统 — A3.0 多房帝国执行基础·系统侧薄壳
 *（SYSTEM_BOUNDARIES §1.13 Agenda 管理器）。
 *
 * 职责（低频 100 tick 执行）：
 *   1. 从 empire-economy 获取 RoomEconomicProfile 列表
 *   2. 调用 domain 纯函数链：ownership → registry → allocation → transport-planner
 *   3. 管理 OperationContext 生命周期（Memory.kernel.agendas）
 *   4. 管理 ReservationTable（Memory.kernel.reservations）
 *   5. 执行路由（Game.map.findRoute）并注入到 transport-planner
 *   6. 提交 carrier spawn 请求到 source 房 spawn queue
 *   7. 事件驱动重规划（carrier 死亡 / 房间状态变更）
 *   8. 清理终态 Operation（归档后删除）
 *   9. 验证：检测 carrier 在 target room + target storage 增量
 *
 * 状态所有权（STATE_OWNERSHIP §3.1）：
 *   唯一写者 = 本系统 → Memory.kernel.agendas / Memory.kernel.reservations。
 *
 * 不做（硬约束）：
 *   - 不直接调用 spawnCreep（通过 spawn queue 提交请求）
 *   - 不直接修改 Room Memory（只读 snapshot + Memory.kernel.*）
 *   - 不直接控制 Creep（carrier 由 role-runner 驱动）
 *   - 不绕过 Request Pool（carrier 不经 transportPool）
 *
 * CPU 预算：低频执行（interval=100），不每 tick 重算。
 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { CONFIG } from "../config";
import { globalCache } from "../kernel/global-cache";
import { queryEconomy, type EconomyQuery } from "./economy";
import {
  buildRoomEconomicProfile,
  canExportEnergy,
  needsEnergyAid,
  type RoomEconomicProfile,
  type RoomEconomicMemory,
} from "../domain/economy/room-profile";
import { computeTransferable, computeTransferableBulk } from "../domain/economy/ownership";
import {
  makeRegistryEntry,
  getSurplusRooms,
  getDeficitRooms,
  type RoomRegistry,
} from "../domain/strategy/room-registry";
import {
  createOperation,
  makeOperationId,
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
  markCancelled,
  markExpired,
  markFailed,
  retryFromBlocked,
  checkExpiry,
  reportDelivery,
} from "../domain/operation/lifecycle";
import {
  allocateMultiRoom,
  sumAllocationsByTarget,
  type AllocationPlan,
} from "../domain/operation/allocation";
import {
  createReservation,
  releaseReservation,
  sweepExpired,
  sumReservationsByRoom,
  type ReservationTable,
} from "../domain/operation/reservation";
import { verifyTransfer, shouldAbortVerification, shouldPartialComplete } from "../domain/operation/verification";
import { hasActiveOperation, pruneTerminal } from "../domain/operation/dedup";
import { processReplanEvent, shouldReplan, type ReplanEvent } from "../domain/operation/replan";
import { computeOperationMetrics, formatOperationMetrics } from "../domain/operation/metrics";
import { submitRequest, hasRequest } from "../domain/spawn/queue";
import { bodyCost, selectBody } from "../config/bodies";
import { getRoleBounds } from "../config/tuned";

/** 默认 Operation 超时（tick）。2000 tick ≈ 运输 + 验证 + 重试。 */
const DEFAULT_OPERATION_DEADLINE = 2000;

/** 归档终态 Operation 的延迟（tick）。终态保留 N tick 后清理。 */
const TERMINAL_RETENTION = 1000;

/** 路由缓存（heap，跨 tick 不持久 — 失效后下次重算）。 */
const routeCache = new Map<string, { from: string; to: string; hops: number; reachable: boolean }>();

/** pending 重规划事件（heap 缓冲，下次 planning cycle 消费）。 */
let pendingEvents: ReplanEvent[] = [];

/**
 * 外部写入重规划事件（供其他系统注入：carrier 死亡、房间失守等）。
 */
export function queueReplanEvent(event: ReplanEvent): void {
  pendingEvents.push(event);
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

/** 从 Memory 加载 Operations（瘦数组，终态后删除）。 */
function loadOperations(): OperationContext[] {
  const stored = Memory.kernel?.agendas;
  if (!stored || !Array.isArray(stored)) return [];
  return stored as unknown as OperationContext[];
}

/** 保存 Operations 到 Memory。 */
function saveOperations(operations: readonly OperationContext[]): void {
  if (!Memory.kernel) Memory.kernel = {};
  // 只保存活跃 + 未过期的终态（归档保留期内）
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
 * carrier 的 memory 注入 home=sourceRoom, remoteTarget=targetRoom,
 * assignment={id:opId, kind:"carrier"}。
 */
function submitCarrierSpawn(op: OperationContext, sourceRcl: number, tick: number): void {
  const roomMem = Memory.rooms[op.sourceRoom];
  if (!roomMem) return;

  const queue = roomMem.spawnQueue ?? [];
  const spawnKey = `carrier:${op.id}`;

  // 幂等：同 opId 的请求不重复提交
  if (hasRequest(queue, spawnKey)) {
    // 已提交 — 检查是否孵化成功（carrier 已在场则记录 carrierName）
    return;
  }

  // 选择 body — 按 source 房间的 energyCapacityAvailable 分档
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
 * 检查 Operation 是否已有 carrier 在场（孵化完成或正在运行）。
 */
function hasCarrierForOp(op: OperationContext): boolean {
  if (op.carrierName) {
    const creep = Game.creeps[op.carrierName];
    if (creep && !creep.spawning) return true;
  }
  // 检查 spawn queue 中是否有待孵化请求
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
  /** 低频执行：每 100 tick 一次（不每 tick 全量重算）。 */
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
    // 被清除的 reservation 对应的 Operation 标记 blocked
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
        // 重试上限到达 → 失败
        const failResult = markFailed(op, ctx.tick, "max retries exceeded");
        if (!failResult.ok) {
          // 释放 reservation
          reservations = releaseReservation(reservations, op.id);
        }
        return failResult.op;
      }
      return op;
    });

    // ── 6. 构建 Room Registry ──
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
      // 少于 2 房 — 无跨房调拨可能
      saveOperations(operations);
      saveReservations(reservations);
      return;
    }

    // ── 7. 计算各房可调拨量（考虑活跃预留）──
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

    // ── 9. 检测 surplus / deficit ──
    const surplusRooms = getSurplusRooms(registry);
    const deficitRooms = getDeficitRooms(registry);

    if (surplusRooms.length === 0 || deficitRooms.length === 0) {
      // 无 surplus 或无 deficit — 跳过分配
      // 清理终态 Operation
      operations = pruneTerminal(operations);
      saveOperations(operations);
      saveReservations(reservations);
      return;
    }

    // ── 10. 计算在途量（排除已在调拨中的 deficit）──
    const inTransitByTarget = new Map<string, number>();
    for (const op of operations) {
      if (isActive(op) && (op.status === "running" || op.status === "verifying" || op.status === "ready")) {
        const current = inTransitByTarget.get(op.targetRoom) ?? 0;
        inTransitByTarget.set(op.targetRoom, current + (op.requestedAmount - op.deliveredAmount));
      }
    }

    // ── 11. 分配策略（多对多贪心）──
    const plans = allocateMultiRoom(surplusRooms, deficitRooms, inTransitByTarget);

    // ── 12. 为新计划创建 Operation（幂等去重）──
    for (const plan of plans) {
      // 检查是否已存在同 key 的活跃 Operation
      if (hasActiveOperation(operations, plan.sourceRoom, plan.targetRoom, "energy")) {
        continue;
      }

      // 检查 source 仍有足够可调拨量
      const sourceEntry = registry.get(plan.sourceRoom);
      if (!sourceEntry || sourceEntry.transferable < plan.amount) {
        continue;
      }

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

      // planned → ready（资源已确认可预留）
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
      }
    }

    // ── 13. 路由计算 + carrier spawn 请求 ──
    for (const op of operations) {
      if (op.status !== "ready") continue;

      const route = computeRoute(op.sourceRoom, op.targetRoom);
      if (!route.reachable) {
        // 路由不可达 → 标记 blocked
        const blockedResult = markBlocked(op, ctx.tick, "route unreachable");
        if (blockedResult.ok) {
          const idx = operations.indexOf(op);
          if (idx >= 0) operations[idx] = blockedResult.op;
        }
        continue;
      }

      // 检查 source 仍有 storage
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

      // 提交 carrier spawn 请求
      const sourceRcl = registry.get(op.sourceRoom)?.rcl ?? 1;
      submitCarrierSpawn(op, sourceRcl, ctx.tick);

      // ready → running（carrier 请求已提交）
      // 同时记录 target storage baseline
      const targetSnapshot = ctx.getSnapshot(op.targetRoom);
      const targetStorage = targetSnapshot?.storage;
      const baseline = targetStorage
        ? targetStorage.store.getUsedCapacity(RESOURCE_ENERGY)
        : 0;

      const runningResult = markRunning(op, ctx.tick);
      if (runningResult.ok) {
        const idx = operations.indexOf(op);
        if (idx >= 0) {
          operations[idx] = runningResult.op;
          operations[idx].baselineEnergy = baseline;
        }
      }
    }

    // ── 14. 验证 running Operation 的送达情况 ──
    for (const op of operations) {
      if (op.status !== "running") continue;

      // 检查 carrier 是否存在
      const carrierExists = hasCarrierForOp(op);
      if (!carrierExists) {
        // Carrier 未孵化或已死亡 — 检查 spawn queue
        // 如果 spawn queue 中无请求且无 carrier，标记 blocked
        const roomMem = Memory.rooms[op.sourceRoom];
        const spawnKey = `carrier:${op.id}`;
        const inQueue = roomMem?.spawnQueue?.some(r => r.key === spawnKey) ?? false;
        if (!inQueue && !op.carrierName) {
          // spawn 请求可能被清理了 — 重新提交
          submitCarrierSpawn(op, registry.get(op.sourceRoom)?.rcl ?? 1, ctx.tick);
        }
        continue;
      }

      // 记录 carrier name（如果已孵化但未记录）
      if (!op.carrierName) {
        for (const [name, creep] of Object.entries(Game.creeps)) {
          if (creep.memory.assignment?.id === op.id) {
            const idx = operations.indexOf(op);
            if (idx >= 0) operations[idx]!.carrierName = name;
            break;
          }
        }
      }

      // 检查 carrier 是否到达 target room
      const carrierName = op.carrierName;
      if (carrierName) {
        const carrier = Game.creeps[carrierName];
        if (carrier && !carrier.spawning) {
          // carrier 在 target room 且空载 → 能量已卸完
          if (carrier.room.name === op.targetRoom && carrier.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
            // carrier 已卸能 — 进入验证阶段
            const targetSnapshot = ctx.getSnapshot(op.targetRoom);
            const targetStorage = targetSnapshot?.storage;
            if (targetStorage) {
              const currentEnergy = targetStorage.store.getUsedCapacity(RESOURCE_ENERGY);
              const baseline = op.baselineEnergy ?? 0;
              const verify = verifyTransfer(op, currentEnergy, baseline, ctx.tick);

              if (verify.verified) {
                const completedResult = markCompleted(op, ctx.tick);
                if (completedResult.ok) {
                  const idx = operations.indexOf(op);
                  if (idx >= 0) operations[idx] = reportDelivery(completedResult.op, op.requestedAmount, ctx.tick);
                  reservations = releaseReservation(reservations, op.id);
                }
              } else if (verify.actualDelta > 0) {
                // 部分送达
                const idx = operations.indexOf(op);
                if (idx >= 0) {
                  operations[idx] = reportDelivery(op, verify.actualDelta, ctx.tick);
                  // 转入验证阶段
                  const verifyingResult = markVerifying(operations[idx], ctx.tick);
                  if (verifyingResult.ok) operations[idx] = verifyingResult.op;
                }
              } else {
                // actualDelta = 0 — carrier 卸了但 target 消耗了
                // 给予宽限：deadline 前继续等待
                // 如果 carrier 已卸完且空载，但增量=0，可能是 target 在持续消耗
                // 在这种情况下，认为 carrier 完成了一次搬运
                const idx = operations.indexOf(op);
                if (idx >= 0) {
                  // carrier 报告卸能完成 — 假设送达量 = carrier carry 容量
                  // 用 carrier 实际卸载量更新 deliveredAmount
                  const carrierCapacity = carrier.store.getCapacity(RESOURCE_ENERGY);
                  operations[idx] = reportDelivery(op, carrierCapacity, ctx.tick);
                  const verifyingResult = markVerifying(operations[idx], ctx.tick);
                  if (verifyingResult.ok) operations[idx] = verifyingResult.op;
                }
              }
            }
          }
        }
      }
    }

    // ── 15. 清理终态 Operation（归档后删除）──
    operations = pruneTerminal(operations);

    // ── 16. 保存状态 ──
    saveOperations(operations);
    saveReservations(reservations);

    // ── 17. 可观测性 ──
    const metrics = computeOperationMetrics(operations, ctx.tick);
    const g = globalCache();
    g.agendaMetrics = metrics;

    if (metrics.activeCount > 0 || metrics.terminalCount > 0) {
      console.log(formatOperationMetrics(metrics));
    }
  },
};
