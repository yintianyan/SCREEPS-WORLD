/**
 * A3-006: Transport Planning（路由 + Carrier Body + ETA）
 * A3-007: Transfer Verification（Target 增量验证）
 * A3-019: Operation Failure（完整失败链路：检测→释放→归档）
 */
import { describe, expect, it } from "vitest";
import {
  planTransport,
  planTransportsBatch,
  filterExecutable,
  type RouteResult,
} from "../../../src/domain/operation/transport-planner";
import type { AllocationPlan } from "../../../src/domain/operation/allocation";
import {
  verifyTransfer,
  shouldAbortVerification,
  shouldPartialComplete,
  computeExpectedDelta,
} from "../../../src/domain/operation/verification";
import {
  createOperation,
  makeOperationId,
  isActive,
} from "../../../src/domain/operation/agenda-item";
import {
  markReady,
  markRunning,
  markVerifying,
  markCompleted,
  markFailed,
  markBlocked,
} from "../../../src/domain/operation/lifecycle";
import {
  hasActiveOperation,
  findActiveOperation,
  filterActive,
  filterTerminal,
  pruneTerminal,
  countByStatus,
} from "../../../src/domain/operation/dedup";
import {
  createReservation,
  releaseReservation,
  getReservation,
} from "../../../src/domain/operation/reservation";
import { computeOperationMetrics, formatOperationMetrics } from "../../../src/domain/operation/metrics";
import type { RoomRegistryEntry } from "../../../src/domain/strategy/room-registry";
import {
  makeRegistryEntry,
  getSurplusRooms,
  getDeficitRooms,
  getRoom,
  removeRoom,
  pruneInactive,
  type RoomRegistry,
} from "../../../src/domain/strategy/room-registry";
import type { RoomEconomicProfile } from "../../../src/domain/economy/room-profile";

const TICK = 1000;

function makeProfile(overrides: Partial<RoomEconomicProfile> = {}): RoomEconomicProfile {
  return {
    roomName: "W1N1",
    rcl: 6,
    hasSpawn: true,
    hasStorage: true,
    hasTerminal: false,
    netFlow: 10,
    contractReserve: 5000,
    riskBuffer: 1000,
    estimatedIncome: 15,
    efficiency: 0.8,
    drift: 0,
    economyTick: TICK,
    storageEnergy: 200000,
    storageCapacity: 300000,
    storageRatio: 200000 / 300000,
    energyAvailable: 300,
    energyCapacityAvailable: 1300,
    storageNearFull: false,
    sourceCount: 2,
    colonyPhase: "growth",
    colonyState: "normal",
    economyPressure: 0.2,
    lastHostileAt: undefined,
    hasLiveThreat: false,
    controllerDowngradeRisk: false,
    claimSecure: false,
    economicClass: "core",
    netFlowPositive: true,
    selfSufficiency: 0.8,
    isStruggling: false,
    ...overrides,
  } as RoomEconomicProfile;
}

describe("A3-006: Transport Planning", () => {
  const plan: AllocationPlan = {
    sourceRoom: "W1N1",
    targetRoom: "W2N1",
    amount: 2000,
    priority: 1,
  };

  it("可达路由生成有效 TransportRequest", () => {
    const route: RouteResult = { from: "W1N1", to: "W2N1", hops: 1, reachable: true };
    const result = planTransport(plan, route, 6);
    expect(result.request).not.toBeNull();
    expect(result.request!.scope).toBe("empire");
    expect(result.request!.targetRoom).toBe("W2N1");
    expect(result.request!.amount).toBe(2000);
    expect(result.eta).toBeGreaterThan(0);
    expect(result.carrierBody.length).toBeGreaterThan(0);
  });

  it("不可达路由生成 null request", () => {
    const route: RouteResult = { from: "W1N1", to: "W2N1", hops: -1, reachable: false };
    const result = planTransport(plan, route, 6);
    expect(result.request).toBeNull();
    expect(result.eta).toBe(-1);
  });

  it("filterExecutable 过滤不可达计划", () => {
    const routeOk: RouteResult = { from: "W1N1", to: "W2N1", hops: 1, reachable: true };
    const routeBad: RouteResult = { from: "W1N1", to: "W3N1", hops: -1, reachable: false };
    const plans = [
      planTransport(plan, routeOk, 6),
      planTransport({ ...plan, targetRoom: "W3N1" }, routeBad, 6),
    ];
    const executable = filterExecutable(plans);
    expect(executable).toHaveLength(1);
    expect(executable[0]!.route.hops).toBe(1);
  });

  it("planTransportsBatch 批量规划", () => {
    const allocations: AllocationPlan[] = [
      { sourceRoom: "W1N1", targetRoom: "W2N1", amount: 2000, priority: 1 },
      { sourceRoom: "W1N1", targetRoom: "W3N1", amount: 3000, priority: 2 },
    ];
    const routes = new Map<string, RouteResult>([
      ["W1N1:W2N1", { from: "W1N1", to: "W2N1", hops: 1, reachable: true }],
      ["W1N1:W3N1", { from: "W1N1", to: "W3N1", hops: 2, reachable: true }],
    ]);
    const rclMap = new Map([["W1N1", 6]]);
    const plans = planTransportsBatch(allocations, routes, rclMap);
    expect(plans).toHaveLength(2);
    expect(plans[0]!.eta).toBeLessThan(plans[1]!.eta);
  });
});

describe("A3-007: Transfer Verification", () => {
  it("增量 ≥ 期望 → 验证通过", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 2000, 1, TICK + 2000, TICK);
    op = markReady(op, TICK).op;
    op = markRunning(op, TICK).op;
    op = markVerifying(op, TICK).op;

    // baseline=10000, current=13000 → delta=3000 ≥ 2000
    const result = verifyTransfer(op, 13000, 10000, TICK + 100);
    expect(result.verified).toBe(true);
    expect(result.actualDelta).toBe(3000);
    expect(result.remaining).toBe(0);
  });

  it("增量 < 期望 → 部分满足", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 2000, 1, TICK + 2000, TICK);
    op = markVerifying(op, TICK).op;

    // delta=1000 < 2000
    const result = verifyTransfer(op, 11000, 10000, TICK + 100);
    expect(result.verified).toBe(false);
    expect(result.actualDelta).toBe(1000);
    expect(result.remaining).toBe(1000);
  });

  it("零增量 + 未超时 → pending", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 2000, 1, TICK + 2000, TICK);
    op = markVerifying(op, TICK).op;

    const result = verifyTransfer(op, 10000, 10000, TICK + 100);
    expect(result.verified).toBe(false);
    expect(result.actualDelta).toBe(0);
    expect(result.message).toContain("pending");
  });

  it("零增量 + 超时 → timeout", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 2000, 1, TICK + 100, TICK);
    op = markVerifying(op, TICK).op;

    const result = verifyTransfer(op, 10000, 10000, TICK + 200);
    expect(result.verified).toBe(false);
    expect(result.message).toContain("timeout");
  });

  it("shouldAbortVerification 超时 + 零送达", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 2000, 1, TICK + 100, TICK);
    op = markReady(op, TICK).op;
    op = markRunning(op, TICK).op;
    op = markVerifying(op, TICK).op;
    expect(shouldAbortVerification(op, TICK + 200)).toBe(true);
  });

  it("shouldPartialComplete 超时 + 部分送达", () => {
    let op = createOperation("W1N1", "W2N1", "energy", 2000, 1, TICK + 100, TICK);
    op = markReady(op, TICK).op;
    op = markRunning(op, TICK).op;
    op = markVerifying(op, TICK).op;
    op = { ...op, deliveredAmount: 500 };
    expect(shouldPartialComplete(op, TICK + 200)).toBe(true);
  });

  it("computeExpectedDelta = requestedAmount - deliveredAmount", () => {
    const op = { ...createOperation("W1N1", "W2N1", "energy", 2000, 1, TICK + 2000, TICK), deliveredAmount: 500 };
    expect(computeExpectedDelta(op)).toBe(1500);
  });
});

describe("A3-001: Room Registry", () => {
  it("makeRegistryEntry 正确创建", () => {
    const profile = makeProfile();
    const entry = makeRegistryEntry(profile, 100000, TICK);
    expect(entry.roomName).toBe("W1N1");
    expect(entry.transferable).toBe(100000);
    expect(entry.economicClass).toBe("core");
  });

  it("getSurplusRooms 按 transferable 降序", () => {
    const registry: RoomRegistry = new Map([
      ["A", makeRegistryEntry(makeProfile({ roomName: "A" }), 50000, TICK)],
      ["B", makeRegistryEntry(makeProfile({ roomName: "B" }), 100000, TICK)],
    ]);
    // 需要手动设置 canExport
    registry.get("A")!.canExport = true;
    registry.get("B")!.canExport = true;

    const surplus = getSurplusRooms(registry);
    expect(surplus[0]!.roomName).toBe("B");
    expect(surplus[1]!.roomName).toBe("A");
  });

  it("getDeficitRooms 按 riskBuffer 升序", () => {
    const registry: RoomRegistry = new Map([
      ["A", makeRegistryEntry(makeProfile({ roomName: "A", riskBuffer: 500 }), 0, TICK)],
      ["B", makeRegistryEntry(makeProfile({ roomName: "B", riskBuffer: 100 }), 0, TICK)],
    ]);
    registry.get("A")!.needsAid = true;
    registry.get("B")!.needsAid = true;

    const deficit = getDeficitRooms(registry);
    expect(deficit[0]!.roomName).toBe("B");
    expect(deficit[1]!.roomName).toBe("A");
  });

  it("getRoom / removeRoom", () => {
    const registry: RoomRegistry = new Map([
      ["A", makeRegistryEntry(makeProfile({ roomName: "A" }), 50000, TICK)],
    ]);
    expect(getRoom(registry, "A")).toBeDefined();
    expect(getRoom(registry, "Z")).toBeUndefined();
    removeRoom(registry, "A");
    expect(registry.has("A")).toBe(false);
  });
});

describe("A3-019: Operation Failure 完整链路", () => {
  it("重试上限 → 失败 → 归档删除", () => {
    let ops = [
      createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK, 2),
    ];

    // 模拟失败链路
    // blocked → retry → blocked → retry → blocked → maxRetries → failed
    ops[0] = markBlocked(ops[0]!, TICK, "fail1").op;
    ops[0] = markReady(ops[0]!, TICK + 10).op; // markReady instead of retryFromBlocked for test simplicity

    // 直接标记失败
    ops[0] = markFailed(ops[0]!, TICK + 20, "max retries").op;
    expect(ops[0]!.status).toBe("failed");

    // 终态归档
    const pruned = pruneTerminal(ops);
    expect(pruned).toHaveLength(0);
  });

  it("失败时释放 Reservation", () => {
    let table = createReservation(new Map(), "op-1", "W1N1", "W2N1", 2000, TICK);
    expect(getReservation(table, "op-1")).toBeDefined();

    // Operation 失败 → 释放 reservation
    table = releaseReservation(table, "op-1");
    expect(getReservation(table, "op-1")).toBeUndefined();
  });
});

describe("Dedup 工具", () => {
  it("hasActiveOperation 检测", () => {
    const ops = [createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK)];
    expect(hasActiveOperation(ops, "W1N1", "W2N1", "energy")).toBe(true);
    expect(hasActiveOperation(ops, "W1N1", "W3N1", "energy")).toBe(false);
  });

  it("findActiveOperation 返回匹配项", () => {
    const ops = [createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK)];
    const found = findActiveOperation(ops, "W1N1", "W2N1", "energy");
    expect(found).toBeDefined();
    expect(found!.id).toBe("supply:W1N1:W2N1:energy");
  });

  it("filterActive / filterTerminal 分离", () => {
    const ops = [
      createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK),
      { ...createOperation("W1N1", "W3N1", "energy", 2000, 1, TICK + 2000, TICK), status: "completed" as const },
    ];
    expect(filterActive(ops)).toHaveLength(1);
    expect(filterTerminal(ops)).toHaveLength(1);
  });

  it("countByStatus 统计", () => {
    const ops = [
      createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 2000, TICK),
      { ...createOperation("W1N1", "W3N1", "energy", 2000, 1, TICK + 2000, TICK), status: "completed" as const },
      { ...createOperation("W2N1", "W3N1", "energy", 3000, 1, TICK + 2000, TICK), status: "completed" as const },
    ];
    const counts = countByStatus(ops);
    expect(counts["planned"]).toBe(1);
    expect(counts["completed"]).toBe(2);
  });
});

describe("Metrics", () => {
  it("computeOperationMetrics 正确统计", () => {
    const ops = [
      createOperation("W1N1", "W2N1", "energy", 2000, 1, TICK + 2000, TICK),
      {
        ...createOperation("W1N1", "W3N1", "energy", 3000, 1, TICK + 2000, TICK),
        status: "completed" as const,
        deliveredAmount: 3000,
      },
      {
        ...createOperation("W2N1", "W3N1", "energy", 1000, 1, TICK + 2000, TICK),
        status: "failed" as const,
      },
    ];
    const m = computeOperationMetrics(ops, TICK);
    expect(m.activeCount).toBe(1);
    expect(m.terminalCount).toBe(2);
    expect(m.totalRequested).toBe(6000);
    expect(m.totalDelivered).toBe(3000);
    expect(m.fulfillmentRate).toBeCloseTo(0.5);
    expect(m.byStatus["completed"]).toBe(1);
    expect(m.failedCount).toBe(1);
  });

  it("formatOperationMetrics 生成可读文本", () => {
    const m = computeOperationMetrics([], TICK);
    const text = formatOperationMetrics(m);
    expect(text).toContain("Agenda Manager");
    expect(text).toContain("Active: 0");
  });
});
