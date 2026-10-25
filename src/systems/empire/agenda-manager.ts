/** Agenda Manager 系统 */
import type { Priority, System, TickContext } from "../../kernel/contracts";
import { globalCache, querySquad } from "../../kernel/global-cache";
import { queryEconomy, type EconomyQuery } from "../room/economy";
import {
  buildRoomEconomicProfile,
  canExportEnergy,
  needsEnergyAid,
  type RoomEconomicProfile,
  type RoomEconomicMemory,
} from "../../domain/economy/room-profile";
import { computeTransferableBulk } from "../../domain/economy/ownership";
import {
  makeRegistryEntry,
  getSurplusRooms,
  getDeficitRooms,
  type RoomRegistry,
} from "../../domain/strategy/room-registry";
import {
  createOperation,
  isActive,
  isTerminalStatus,
  type OperationContext,
} from "../../domain/operation/agenda-item";
import {
  markReady,
  markRunning,
  markCompleted,
  markBlocked,
  markFailed,
  retryFromBlocked,
  checkExpiry,
  applyDelivery,
  capRequestToCarrier,
} from "../../domain/operation/lifecycle";
import {
  createReservation,
  releaseReservation,
  heartbeatReservation,
  adjustReservationAmount,
  sweepExpired,
  sumReservationsByRoom,
  type ReservationTable,
} from "../../domain/operation/reservation";
import { capSupplyToCarrier } from "../../domain/operation/supply-sizing";
import {
  shouldAbortVerification,
  shouldPartialComplete,
} from "../../domain/operation/verification";
import { hasActiveOperation, pruneTerminal } from "../../domain/operation/dedup";
import { computeOperationMetrics, formatOperationMetrics } from "../../domain/operation/metrics";
import { recordExecution } from "../../telemetry";
import { submitRequest, hasRequest } from "../../domain/spawn/queue";
import { selectBody } from "../../config/bodies";

// A3.1 imports
import { buildSupplyNodes } from "../../domain/operation/supply-node";
import { buildDemandNodes } from "../../domain/operation/demand-node";
import { buildNetworkSnapshot } from "../../domain/operation/network-snapshot";
import {
  allocateNetwork,
  type RouteDistance,
  type ExplainableAllocationResult,
} from "../../domain/operation/allocation-policy";
import { MAX_GLOBAL_OPERATIONS } from "../../domain/operation/allocation-policy";
import { computeNetworkHealth } from "../../domain/operation/network-health";
import { RebalanceState, decideRebalance, markRebalanced } from "../../domain/operation/rebalance";
import { log } from "../../kernel/log";
import { pruneStaleCarrierBinding } from "../../domain/operation/op-binding";

/** 默认 Operation 超时（tick）。2000 tick ≈ 运输 + 验证 + 重试。 */
const DEFAULT_OPERATION_DEADLINE = 2000;

/** 归档终态 Operation 的延迟（tick）。终态保留 N tick 后清理。 */
const TERMINAL_RETENTION = 1000;

/** 路由缓存（heap，跨 tick 不持久 — 失效后下次重算）。
 * A4.4 修复 DUPLICATE-005：添加 TTL 失效条件。
 * 旧逻辑：routeCache 永不失效（除非 global reset），与 logistics-planner 的 RouteCache（TTL=5000）不一致。
 * 修复后：routeCache 条目带 timestamp，超过 ROUTE_CACHE_TTL 后失效重算。 */
const ROUTE_CACHE_TTL = 5000; // 与 logistics-planner RouteCache TTL 一致
const routeCache = new Map<
  string,
  { from: string; to: string; hops: number; reachable: boolean; cachedAt: number }
>();

/** Rebalance 状态（heap，跨 tick 持久 — 跟随 agenda-manager 生命周期）。 */
const rebalanceState = new RebalanceState();

/**
 * 执行 Game.map.findRoute 并缓存结果（带 TTL）。
 * 失败/不可达时返回 hops=-1。
 * A4.4 修复 DUPLICATE-005：添加 TTL 失效条件，与 logistics-planner RouteCache 一致。
 */
function computeRoute(
  from: string,
  to: string,
): { from: string; to: string; hops: number; reachable: boolean } {
  const key = `${from}:${to}`;
  const tick = Game.time;
  const cached = routeCache.get(key);
  // A4.4：TTL 检查 — 超过 ROUTE_CACHE_TTL 的条目失效重算
  if (cached && tick - cached.cachedAt < ROUTE_CACHE_TTL) {
    return { from: cached.from, to: cached.to, hops: cached.hops, reachable: cached.reachable };
  }

  try {
    const route = Game.map.findRoute(from, to);
    if (route === ERR_NO_PATH || (typeof route === "number" && route < 0)) {
      const result = { from, to, hops: -1, reachable: false, cachedAt: tick };
      routeCache.set(key, result);
      return { from, to, hops: -1, reachable: false };
    }
    const hops = Array.isArray(route) ? route.length : -1;
    const result = { from, to, hops, reachable: hops >= 0, cachedAt: tick };
    routeCache.set(key, result);
    return { from, to, hops, reachable: hops >= 0 };
  } catch {
    const result = { from, to, hops: -1, reachable: false, cachedAt: tick };
    routeCache.set(key, result);
    return { from, to, hops: -1, reachable: false };
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
    // 跨房援运：急着要能量的是**别的房**。priority 沿用 op.priority 只表达排队顺序，
    // 绝不能顺带拿到捐出方的停建/停孵否决权（A14 拆的就是这两件事）。
    survival: false,
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
 * 失联载体：活着、空载 idle、却在 source/target 之外的房间 —— 既不会交付、也不会自己回家
 * （线上实证：W38S58 卡 1,069 拍）。这种个体不得计入「本 op 已有载体」，也不得被兜底重绑，
 * 否则摘掉悬挂名后立刻又绑回同一只，等于永不补员。
 */
function isLostCarrier(creep: Creep, op: OperationContext): boolean {
  if (creep.memory.mode !== "idle") return false;
  const cur = roomCoord(creep.room.name);
  const src = roomCoord(op.sourceRoom);
  const dst = roomCoord(op.targetRoom);
  // 解析不了（测试房名/异形）⇒ 保守不判失联。
  if (!cur || !src || !dst) return false;
  // 现场反证（R584）：W38S58 在 source→target 的邻域/绕路路径上，载体 idle 了 1,069 拍
  // 后仍自行回程并交付 ⇒ 只有「距两端都 ≥2 房」才算失联，邻房与中间房一律豁免。
  const far = (a: { x: number; y: number }): boolean =>
    Math.max(Math.abs(cur.x - a.x), Math.abs(cur.y - a.y)) > 1;
  return far(src) && far(dst);
}

/** W37S58 → { x: -37, y: -58 }；解析失败返回 undefined。 */
function roomCoord(name: string): { x: number; y: number } | undefined {
  const m = /^([WE])(\d+)([NS])(\d+)$/.exec(name);
  if (!m) return undefined;
  return {
    x: m[1] === "W" ? -Number(m[2]) : Number(m[2]),
    y: m[3] === "N" ? -Number(m[4]) : Number(m[4]),
  };
}

/**
 * 检查 Operation 是否已有可用 carrier 在场。
 */
function hasCarrierForOp(op: OperationContext): boolean {
  if (op.carrierName) {
    const creep = Game.creeps[op.carrierName];
    if (creep && !creep.spawning && !creep.memory.recycle && !isLostCarrier(creep, op)) return true;
  }
  const roomMem = Memory.rooms[op.sourceRoom];
  if (roomMem?.spawnQueue) {
    const spawnKey = `carrier:${op.id}`;
    if (hasRequest(roomMem.spawnQueue, spawnKey)) return true;
  }
  // 按 role/home/remoteTarget 兜底匹配。assignment 租约会被 assignment-adapter 清除
  // （操作直派任务不在任务池内 → failReason 4「任务已出池」），只认 carrierName 与
  // 队列时，清租约后的在场 carrier 会「查无此人」→ 每 100t 重孵一只、满载旧 carrier
  // 原地堆积（线上实证：单 op 叠出 6 只 1200/1200 满载 carrier）。carrier 与 op 的
  // 稳定绑定是 spawn 时写入的 home/remoteTarget，租约清理不动它们。
  // 在孵个体仍计入「已有载体」（补404 的既有契约），只排除失联个体。
  return querySquad({ role: "carrier", home: op.sourceRoom, remoteTarget: op.targetRoom }).some(
    e => {
      const c = Game.creeps[e.name];
      return c !== undefined && !c.memory.recycle && !isLostCarrier(c, op);
    },
  );
}

/**
 * 孤儿载体退役：carrier 按 home/remoteTarget 自行取送、从不读 op，供给 op 结束后
 * 仍会继续从 home 取能送往 target（线上实证：op 间隙里多只 carrier 持续满载搬运，
 * 幼房存量被推到 87K）。无活跃 supply op 匹配它的 home→target 时，空载者标记回收；
 * 载货/在孵/已标记的不动——先把这一趟送完（回收会销毁随身货物）。
 */
function retireOrphanCarriers(operations: readonly OperationContext[]): void {
  for (const entry of querySquad({ role: "carrier" })) {
    const creep = Game.creeps[entry.name];
    if (!creep || creep.spawning || creep.memory.recycle) continue;
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) continue;
    const home = creep.memory.home;
    const target = creep.memory.remoteTarget;
    if (!home || !target) continue;
    const hasOp = operations.some(
      op =>
        op.type === "supply" && isActive(op) && op.sourceRoom === home && op.targetRoom === target,
    );
    if (!hasOp) creep.memory.recycle = true;
  }
}

/**
 * 复活“已标记回收”的空载 carrier：新供给 op 出现时，撤销我们自己的回收标记并绑名，
 * 而不是新孵一只。线上实证（t=83,865,401）：74-avh 空载 idle、recycle=1 归航途中，
 * 同刻新 op 触发补孵 74-avz ⇒ 回收返还 ~760 + 新孵 1,650，净烧 ~890 能量/次。
 * 只取空载、非在孵、同 home→target 的个体；载货者不复活（它该先把这趟送完）。
 */
function tryReactivateCarrier(op: OperationContext): boolean {
  const matches = (c: Creep | undefined): c is Creep =>
    c !== undefined &&
    !c.spawning &&
    c.memory.role === "carrier" &&
    c.memory.recycle === true &&
    c.memory.home === op.sourceRoom &&
    c.memory.remoteTarget === op.targetRoom &&
    c.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
  // 先走编队索引（O(k)）；索引缺项时回退全量扫（只在“op 缺载体”这趟发生，
  // 频率 ~1/100 拍）。R611 现场：op 活跃、74-ay3 空载且 recycle=1 却未被复用，
  // 时间线无法排除索引漏项 ⇒ 用这条兜底把“索引有没有这个人”从正确性前提里摘掉。
  let candidate = querySquad({
    role: "carrier",
    home: op.sourceRoom,
    remoteTarget: op.targetRoom,
  })
    .map(e => Game.creeps[e.name])
    .find(matches);
  if (!candidate) {
    candidate = Object.values(Game.creeps).find(matches);
  }
  if (!candidate) return false;
  delete candidate.memory.recycle;
  op.carrierName = candidate.name;
  return true;
}

export const agendaManagerSystem: System = {
  name: "agenda-manager",
  priority: 1 as Priority,
  interval: 100,
  run(ctx: TickContext): void {
    // ── 0. 加载状态 ──
    let operations = loadOperations();
    let reservations = loadReservations();

    // ── 2. 超时检查 ──
    // 供给 op 的 2,000 拍 deadline 短于「排队孵化 + 跨房往返」的实际时延（线上实测：op
    // 到期时载体才刚出孵，随后 op 被反复重建、重复配送）。只要载体还活着（含在孵）或
    // 孵化请求还在队里，就把 deadline 顶到当前+500；总寿命封顶 6,000 拍，防悬挂。
    operations = operations.map(op => {
      if (op.type === "supply" && isActive(op) && ctx.tick - op.createdAt < 6000) {
        const carrier = op.carrierName ? Game.creeps[op.carrierName] : undefined;
        const queued =
          carrier !== undefined ||
          (Memory.rooms[op.sourceRoom]?.spawnQueue ?? []).some(r => r.key === `carrier:${op.id}`);
        if (queued && op.deadline < ctx.tick + 500) {
          op = { ...op, deadline: ctx.tick + 500 };
        }
      }
      const expiry = checkExpiry(op, ctx.tick);
      return expiry.op;
    });

    // ── 3. Reservation TTL 清扫 ──
    // 500 拍 TTL 短于跨房往返（实测 ≈900 拍）；活跃 op 每趟续期，避免运输途中被判过期。
    // verifying 也要续期：入账后到终态之间仍由同一载体在途，清扫会把它打回 blocked→retry，
    // 造成同一笔需求重复配送（over-delivery）。
    for (const op of operations) {
      if (
        (op.status === "ready" || op.status === "running" || op.status === "verifying") &&
        reservations.has(op.id)
      ) {
        reservations = heartbeatReservation(reservations, op.id, ctx.tick);
      }
    }
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
        recordExecution("carrier", "failed");
        return result.op;
      }
      if (shouldPartialComplete(op, ctx.tick)) {
        const result = markCompleted(op, ctx.tick);
        recordExecution("carrier", "completed");
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
        recordExecution("carrier", "failed");
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
      if (
        isActive(op) &&
        (op.status === "running" || op.status === "verifying" || op.status === "ready")
      ) {
        const current = inTransitByTarget.get(op.targetRoom) ?? 0;
        inTransitByTarget.set(op.targetRoom, current + (op.requestedAmount - op.deliveredAmount));
      }
    }

    const supplyNodes = buildSupplyNodes(surplusRooms, reservationsByRoom, ctx.tick);
    const demandNodes = buildDemandNodes(deficitRooms, inTransitByTarget, ctx.tick);

    // ── 10. 构建 Network Snapshot ──

    // ── 11. Rebalance 判定（A3.1 新增）──
    const rebalanceDecision = decideRebalance(rebalanceState, ctx.tick);
    const shouldDoRebalance = rebalanceDecision.shouldRebalance;

    // A4.4 修复 DUPLICATE-001：提前读取 logisticsPlan，供步 12 判断 Decision Authority。
    const logisticsPlan = globalCache().logisticsPlan?.plan;

    // ── 12. 分配策略（A3.1 Allocation Policy v2）──
    // A4.4 修复 DUPLICATE-001：Plan 存在时，allocateNetwork 降级为 DEGRADED MODE fallback。
    // 旧逻辑：步 12 (allocateNetwork) 和步 13.5 (Plan 驱动) 并行运行，两个决策器可能同时创建 Operation。
    // 修复后：Plan 存在且有效时，allocateNetwork 不执行（Plan 拥有 Decision Authority）。
    // Plan 不存在时（非 100t tick），allocateNetwork 作为 DEGRADED MODE 执行。
    const planIsActive = logisticsPlan && logisticsPlan.plannedAt >= ctx.tick - 100;
    let allocResult: ExplainableAllocationResult | undefined;

    if (!planIsActive && shouldDoRebalance && supplyNodes.length > 0 && demandNodes.length > 0) {
      // DEGRADED MODE：Plan 不可用，allocateNetwork 作为 fallback。
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
    } else if (planIsActive && shouldDoRebalance) {
      // Plan 存在且有效 — Plan 拥有 Decision Authority。
      // allocateNetwork 跳过，由步 13.5 的 Plan 驱动 Operation 创建。
      // 仍然标记 rebalance 完成（避免下个周期不必要的重算）。
      markRebalanced(rebalanceState, ctx.tick);
      if (supplyNodes.length > 0 && demandNodes.length > 0) {
        log.info(
          "agenda-manager",
          `agenda: Plan active (plannedAt=${logisticsPlan!.plannedAt}), allocateNetwork skipped in favor of Plan-driven operations`,
        );
      }
    }

    const capFor = (roomName: string): number =>
      ctx.getSnapshot(roomName)?.energyCapacityAvailable ??
      Game.rooms[roomName]?.energyCapacityAvailable ??
      300;

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

        // TOCTOU 防护：本地 Map 检查 + 递减；请求量再夹到单载容量，避免一次卸货只记满容量。
        const localAvail = sourceTransferable.get(plan.sourceRoom) ?? 0;
        const amount = Math.min(
          capSupplyToCarrier(plan.amount, capFor(plan.sourceRoom)),
          localAvail,
        );
        if (amount <= 0) continue;

        const deadline = ctx.tick + DEFAULT_OPERATION_DEADLINE;
        const op = createOperation(
          plan.sourceRoom,
          plan.targetRoom,
          "energy",
          amount,
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
            amount,
            ctx.tick,
          );
          // TOCTOU 防护：递减本地可调拨量
          sourceTransferable.set(plan.sourceRoom, localAvail - amount);
        }
      }
    }

    // ── 13.5 A4.3：Plan 驱动的 Operation 创建 ──
    // 从 logistics-planner 产出的 Transport Plan 中筛选 scope="empire" 的请求，
    // 为尚未有活跃 Operation 的 (source, target, resource) 三元组创建新 Operation。
    // 这补充了 allocation-policy 只处理 energy 的局限——Plan 可产出矿物等非能量资源的跨房请求。
    // A4.4：logisticsPlan 已在步 11 提前读取，此处直接复用。
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

        // TOCTOU 防护 + 单载容量上限（同 allocation 分支）
        const localAvail = sourceTransferablePlan.get(req.source.room) ?? 0;
        const amount = Math.min(
          capSupplyToCarrier(req.amount, capFor(req.source.room)),
          localAvail,
        );
        if (amount <= 0) continue;

        const deadline = Math.min(req.deadline, ctx.tick + DEFAULT_OPERATION_DEADLINE);
        const op = createOperation(
          req.source.room,
          req.destination.room,
          req.resource,
          amount,
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
            amount,
            ctx.tick,
          );
          sourceTransferablePlan.set(req.source.room, localAvail - amount);
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

    // #181：本趟算一次"可用载体名"，供循环内清洗悬挂绑定。口径与 hasCarrierForOp 的或项①一致
    // （在场且 !spawning）——否则会抖成"这趟清掉、下趟又绑回一只还在孵的"。
    const liveCarrierNames = new Set<string>(
      querySquad({ role: "carrier" })
        .filter(e => {
          const c = Game.creeps[e.name];
          // 已标记回收的个体不再算“活体”：它正被引导回家消融，绑定它只会让 op
          // 空等一趟（R597 退役规则引入后的配套口径）。
          return c !== undefined && !c.spawning && !c.memory.recycle;
        })
        .map(e => e.name),
    );
    // ── 15. 验证 running Operation（Baseline 污染修复）──
    for (const op of operations) {
      if (op.status !== "running") continue;
      // 悬挂绑定清洗（#181）必须走在 hasCarrierForOp 之前：该判定的三个或项里，
      // ①"名字解析到活体"与③"线上还有任意在册载体"在**整线载体都死光**时同时为假，
      // 于是走 `!inQueue && !op.carrierName` 的补孵分支——而悬挂名让 `!op.carrierName` 为假
      // ⇒ 既不补孵也不重绑，直接 continue，任何在其后的清洗都轮不到（＝我在 补331 落点上的
      // 一处自审缺口，roadmap 补341）。清在这里：悬挂名一摘，补孵分支与两段兜底绑定同趟可达。
      pruneStaleCarrierBinding(op, liveCarrierNames);

      // 失联载体：活着、空载 idle、却在 source/target 之外的房间连续两趟 —— 既不会交付
      // 也不会自己回家（线上实证：W38S58 卡 1,069 拍）。摘掉绑定让本趟重绑/补孵；
      // 原载体仍按自己的 flee/ensureHome 走，不额外下发指令。
      const boundCarrier = op.carrierName ? Game.creeps[op.carrierName] : undefined;
      if (
        boundCarrier &&
        !boundCarrier.spawning &&
        boundCarrier.memory.mode === "idle" &&
        boundCarrier.room.name !== op.sourceRoom &&
        boundCarrier.room.name !== op.targetRoom
      ) {
        op.carrierIdleTicks = (op.carrierIdleTicks ?? 0) + 1;
        if (op.carrierIdleTicks >= 2) {
          delete op.carrierName;
          delete op.carrierIdleTicks;
        }
      } else if (op.carrierIdleTicks) {
        delete op.carrierIdleTicks;
      }

      const carrierExists = hasCarrierForOp(op);
      if (!carrierExists) {
        // 先尝试复用已标记回收的空载载体：op 间隙里标记归航的载体常与新 op 的补孵
        // 同时发生，回收返还 + 新孵 = 净烧（线上实测 74-avh 归航中、新孵 74-avz）。
        if (tryReactivateCarrier(op)) continue;
        const roomMem = Memory.rooms[op.sourceRoom];
        const spawnKey = `carrier:${op.id}`;
        const inQueue = roomMem?.spawnQueue?.some(r => r.key === spawnKey) ?? false;
        if (!inQueue && !op.carrierName) {
          submitCarrierSpawn(op, ctx.tick);
        }
        continue;
      }

      // 记录 carrier name：优先按 assignment id 精确匹配；assignment 被租约清理后
      // （操作直派任务不在池内），退回 role/home/remoteTarget 兜底匹配，否则
      // op.carrierName 永不落账、hasCarrierForOp 持续误判缺员。
      if (!op.carrierName) {
        for (const [name, creep] of Object.entries(Game.creeps)) {
          if (
            creep.memory.assignment?.id === op.id &&
            !creep.memory.recycle &&
            !isLostCarrier(creep, op)
          ) {
            const idx = operations.indexOf(op);
            if (idx >= 0) operations[idx]!.carrierName = name;
            break;
          }
        }
      }
      if (!op.carrierName) {
        const bound = querySquad({
          role: "carrier",
          home: op.sourceRoom,
          remoteTarget: op.targetRoom,
        });
        const entry =
          bound.find(e => {
            const c = Game.creeps[e.name];
            return c !== undefined && !c.spawning && !c.memory.recycle && !isLostCarrier(c, op);
          }) ??
          bound.find(e => {
            const c = Game.creeps[e.name];
            // 保留「无健康载体时绑在孵那只」的既有契约（补404），只排除失联个体。
            return c !== undefined && !c.memory.recycle && !isLostCarrier(c, op);
          });
        if (entry) {
          const idx = operations.indexOf(op);
          if (idx >= 0) operations[idx]!.carrierName = entry.name;
        }
      }

      // 卸货回执优先：carrier 在 transfer 成功那拍写入 {amount,tick}。旧口径依赖
      // 「空载且在 target 房」的 100 拍采样窗，卸完立刻回程就永久错过（线上实证：
      // 连续 op dv=0 到 deadline，而 target imported 实际在涨）。
      const receiptCarrier = op.carrierName ? Game.creeps[op.carrierName] : undefined;
      const receipt = (
        receiptCarrier?.memory as { lastDelivery?: { amount: number; tick: number } } | undefined
      )?.lastDelivery;
      if (receiptCarrier && receipt && receipt.amount > 0) {
        // 只认「本 op 创建之后」的交付；旧回执清掉，防止串到将来的 op 造成假完成。
        if (receipt.tick < op.createdAt) {
          delete (receiptCarrier.memory as { lastDelivery?: unknown }).lastDelivery;
        } else {
          const idx = operations.indexOf(op);
          if (idx >= 0) {
            const capped = capRequestToCarrier(op, receipt.amount);
            if (capped !== op) {
              operations[idx] = capped;
              reservations = adjustReservationAmount(reservations, op.id, receipt.amount);
            }
            const delivered = applyDelivery(operations[idx]!, receipt.amount, ctx.tick);
            operations[idx] = delivered;
            if (delivered.status === "completed") {
              reservations = releaseReservation(reservations, op.id);
              recordExecution("carrier", "completed");
            }
          }
          delete (receiptCarrier.memory as { lastDelivery?: unknown }).lastDelivery;
          continue;
        }
      }

      // 检查 carrier 是否到达 target room 且空载
      const carrierName = op.carrierName;
      if (carrierName) {
        const carrier = Game.creeps[carrierName];
        if (carrier && !carrier.spawning) {
          if (
            carrier.room.name === op.targetRoom &&
            carrier.store.getUsedCapacity(RESOURCE_ENERGY) === 0
          ) {
            // A4.4 修复 BYPASS-003：接入 Delivery Validation。
            // 旧逻辑：用 carrier 的 carry 容量作为送达量（行为证据），不验证 target 实际收到量。
            // 新逻辑：用 target storage 的实际增量验证送达量。
            //   1. 读取 target storage 在 carrier 卸载前的能量快照（从 creep memory）
            //   2. 读取 target storage 当前能量
            //   3. actualReceived = current - before - otherContributions
            //   4. 如果 actualReceived >= expectedAmount → verified
            // 如果 target storage 不可读（如无 vision），fallback 到旧的 carrier 容量推断。
            const carrierCapacity = carrier.store.getCapacity(RESOURCE_ENERGY);

            if (carrierCapacity > 0) {
              const idx = operations.indexOf(op);
              if (idx >= 0) {
                // A4.4：尝试用 Delivery Validation 验证实际送达量。
                const targetRoom = Game.rooms[op.targetRoom];
                const targetStorage = targetRoom?.storage;
                const storageBefore = (carrier.memory as { deliverySnapBefore?: number })
                  .deliverySnapBefore;

                let deliveredAmount: number;

                if (targetStorage && storageBefore !== undefined) {
                  // Delivery Validation：用 storage 实际增量验证。
                  const storageAfter = targetStorage.store.getUsedCapacity(RESOURCE_ENERGY);
                  // otherContributions = 其他来源的能量变化（简化：用 0，后续可扩展）
                  const otherContributions = 0;
                  const actualReceived = Math.max(
                    0,
                    storageAfter - storageBefore - otherContributions,
                  );
                  deliveredAmount = Math.min(carrierCapacity, actualReceived);

                  // 清除快照（已消费）
                  delete (carrier.memory as { deliverySnapBefore?: number }).deliverySnapBefore;

                  if (actualReceived < carrierCapacity) {
                    // 部分损失 — carrier 卸载了但 target 没全部收到
                    log.info(
                      "agenda-manager",
                      `agenda: delivery validation ${op.id} ` +
                        `expected=${carrierCapacity}, actual=${actualReceived}, ` +
                        `shortfall=${carrierCapacity - actualReceived}`,
                    );
                  }
                } else {
                  // Fallback：target storage 不可读或无快照 → 用 carrier 容量推断。
                  // 这与旧逻辑一致——carrier 空载 = 已卸完。
                  deliveredAmount = carrierCapacity;
                }

                // 部署前/降级的小载体可能小于房间最大 body：先夹请求量，避免 1,650 只送 1,200 进 verifying。
                const capped = capRequestToCarrier(op, carrierCapacity);
                if (capped !== op) {
                  operations[idx] = capped;
                  reservations = adjustReservationAmount(reservations, op.id, carrierCapacity);
                }
                const delivered = applyDelivery(capped, deliveredAmount, ctx.tick);
                operations[idx] = delivered;
                if (delivered.status === "completed") {
                  reservations = releaseReservation(reservations, op.id);
                  recordExecution("carrier", "completed");
                }
              }
            }
          }
        }
      }
    }

    // ── 16. 清理终态 Operation ──
    operations = pruneTerminal(operations);

    // ── 16b. 孤儿载体退役：终态清理之后再判，completed 行已不在列表里 ──
    retireOrphanCarriers(operations);

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

    // 存储 A3.1 可观测性数据
    g.networkSnapshot = finalSnapshot;
    g.networkHealth = health;

    if (metrics.activeCount > 0 || health.level !== "healthy") {
      log.info("agenda-manager", formatOperationMetrics(metrics));
      log.info(
        "agenda-manager",
        `Network Health: ${health.level} (score=${health.score.toFixed(2)}, supply=${finalSnapshot.totalSupply}, demand=${finalSnapshot.totalRemaining})`,
      );
    }
  },
};
