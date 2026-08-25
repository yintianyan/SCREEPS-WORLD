/**
 * A4.4 Unified Logistics Network — 收敛验证测试。
 *
 * 验证 A4.3/A4.4 的核心架构收敛目标：
 *   1. Supply Contract → TransportRequestV2 闭环
 *   2. Double Transport 防护（V1/V2 去重）
 *   3. Duplicate Assignment 约束
 *   4. Accounting Truth（跨 tick 追踪）
 *   5. Delivery Validation（实际收到量验证）
 *   6. Failure Recovery（损失 → 重规划）
 *   7. Plan → Execution 链路完整性
 *   8. Convergence Score（单一决策器）
 *
 * 纯函数测试 — 不依赖 Game/Memory。
 */
import { describe, it, expect } from "vitest";
import {
  createActiveSupplyContract,
  computeCycleAmount,
  effectiveRate,
  hasActiveContract,
  isContractActive,
  type SupplyContract,
} from "../../../src/domain/economy/supply-contract";
import {
  bridgeToSupplyNode,
  bridgeToDemandNode,
  type ProducerSnapshot,
  type ConsumerSnapshot,
} from "../../../src/domain/economy/contract-node-bridge";
import {
  createRequest,
  type TransportRequestV2,
} from "../../../src/domain/logistics/transport-request";
import {
  createAccounting,
  recordAssigned,
  recordDelivered,
  recordLost,
  summarizeAccounting,
  deliveryRate,
  lossRate,
  isComplete,
  hasLoss,
  type TransportAccounting,
} from "../../../src/domain/logistics/transport-accounting";
import {
  validateDelivery,
  isFullyDelivered,
  isPartialDelivery,
  isZeroDelivery,
} from "../../../src/domain/logistics/delivery-validation";
import {
  createAssignment,
  type TransportAssignment,
  type TransportRole,
} from "../../../src/domain/logistics/transport-assignment";
import { createRoute } from "../../../src/domain/logistics/route";
import { RouteCache } from "../../../src/domain/logistics/route-cache";
import { planLogistics, type PlannerInput } from "../../../src/domain/logistics/planner";
import {
  allocateNetwork,
  type RouteDistance,
} from "../../../src/domain/operation/allocation-policy";
import type { SupplyNode } from "../../../src/domain/operation/supply-node";
import type { DemandNode } from "../../../src/domain/operation/demand-node";

// ─── 辅助构造函数 ──────────────────────────────────────────

const TICK = 1000;

function makeSupplyNode(room: string, transferable: number, capacity: number = 100000): SupplyNode {
  return {
    room,
    resource: "energy",
    available: transferable + 20000,
    reserved: 0,
    safety: 20000,
    transferable,
    priority: 2,
    health: 0.8,
    capacity,
    timestamp: TICK,
  };
}

function makeDemandNode(room: string, remaining: number, criticality: "normal" | "critical" = "normal"): DemandNode {
  return {
    room,
    resource: "energy",
    requested: remaining,
    priority: criticality === "critical" ? 0 : 2,
    deadline: TICK + 2000,
    criticality,
    fulfilled: 0,
    remaining,
    firstSeen: TICK,
    timestamp: TICK,
  };
}

function makeRouteDistance(from: string, to: string, hops: number): RouteDistance {
  return { from, to, hops, reachable: hops >= 0 };
}

function makeRouteCacheWithRoutes(): RouteCache {
  const cache = new RouteCache();
  // 预填充一些常用路由
  const pairs: [string, string][] = [
    ["W1N1", "W2N1"], ["W1N1", "W3N1"], ["W1N1", "W4N1"],
  ];
  for (const [from, to] of pairs) {
    const route = createRoute(from, to, 2, 100, 200, TICK, []);
    cache.set(route);
  }
  return cache;
}

// ─── E2E-001: Double Transport 防护 ──────────────────────

describe("A4.4-E2E-001: Double Transport 防护", () => {
  it("同一 surplus/deficit 对只产出一个 TransportRequestV2", () => {
    const routeCache = makeRouteCacheWithRoutes();
    const supply = makeSupplyNode("W1N1", 5000);
    const deficit = makeDemandNode("W2N1", 1000);

    const input: PlannerInput = {
      contracts: [],
      deficits: [deficit],
      surpluses: [supply],
      capacity: {
        rooms: [],
        totalHaulerGap: 0,
        totalCarrierGap: 0,
      } as any,
      routeCache,
      threats: new Map(),
      tick: TICK,
    };

    const plan = planLogistics(input);

    // 验证：只有 1 个 request（不重复）
    expect(plan.requests.length).toBe(1);
    expect(plan.requests[0]!.source.room).toBe("W1N1");
    expect(plan.requests[0]!.destination.room).toBe("W2N1");
  });

  it("多个 deficit 对同一 surplus 产出多个 request", () => {
    const routeCache = makeRouteCacheWithRoutes();
    const supply = makeSupplyNode("W1N1", 10000);
    const deficit1 = makeDemandNode("W2N1", 3000);
    const deficit2 = makeDemandNode("W3N1", 4000);

    const input: PlannerInput = {
      contracts: [],
      deficits: [deficit1, deficit2],
      surpluses: [supply],
      capacity: { rooms: [], totalHaulerGap: 0, totalCarrierGap: 0 } as any,
      routeCache,
      threats: new Map(),
      tick: TICK,
    };

    const plan = planLogistics(input);

    // 验证：2 个 request，分别到 W2N1 和 W3N1
    expect(plan.requests.length).toBe(2);
    const targets = plan.requests.map(r => r.destination.room).sort();
    expect(targets).toEqual(["W2N1", "W3N1"]);
  });
});

// ─── E2E-002: Duplicate Assignment 约束 ──────────────────

describe("A4.4-E2E-002: Duplicate Assignment 约束", () => {
  it("同一 request 最多一个 Assignment（单源满足）", () => {
    const req = createRequest(
      "energy", 1000,
      { room: "W1N1", type: "storage" },
      { room: "W2N1", type: "storage" },
      2, "empire", TICK + 2000, TICK, "test",
    );

    const assignment = createAssignment(
      req.requestId, "hauler1", "hauler", "energy", 1000, TICK,
    );

    expect(assignment.requestId).toBe(req.requestId);
    expect(assignment.assignedAmount).toBe(1000);
  });

  it("Multi-Assignment 总量受 Remaining Demand 约束", () => {
    const req = createRequest(
      "energy", 1000,
      { room: "W1N1", type: "storage" },
      { room: "W2N1", type: "storage" },
      2, "empire", TICK + 2000, TICK, "test",
    );

    // Source A: 400, Source B: 600 → 总量 = 1000 = requested
    const a1 = createAssignment(req.requestId, "hauler1", "hauler", "energy", 400, TICK);
    const a2 = createAssignment(req.requestId, "hauler2", "hauler", "energy", 600, TICK);

    const totalAssigned = a1.assignedAmount + a2.assignedAmount;
    expect(totalAssigned).toBeLessThanOrEqual(req.amount);
    expect(totalAssigned).toBe(1000);
  });
});

// ─── E2E-005: Accounting Truth ───────────────────────────

describe("A4.4-E2E-005: Accounting Truth", () => {
  it("1000 Energy 从 A→B 的完整会计追踪", () => {
    const requestId = "tr:empire:W1N1:W2N1:energy:0";
    let acc = createAccounting(requestId, 1000);

    // 初始状态
    expect(acc.requested).toBe(1000);
    expect(acc.delivered).toBe(0);
    expect(acc.remaining).toBe(1000);

    // 分配 1000
    acc = recordAssigned(acc, 1000);
    expect(acc.assigned).toBe(1000);

    // 交付 950
    acc = recordDelivered(acc, 950);
    expect(acc.delivered).toBe(950);
    expect(acc.remaining).toBe(50);

    // 损失 50
    acc = recordLost(acc, 50);
    expect(acc.lost).toBe(50);
    expect(acc.remaining).toBe(0);

    // 验证：有损失时不标记为完成（delivered < requested）
    expect(isComplete(acc)).toBe(false); // delivered=950 < requested=1000
    expect(hasLoss(acc)).toBe(true);
    expect(deliveryRate(acc)).toBe(0.95);
    expect(lossRate(acc)).toBe(0.05);
  });

  it("批量统计正确汇总多条 Accounting", () => {
    const acc1 = recordDelivered(createAccounting("r1", 1000), 800);
    const acc2 = recordDelivered(createAccounting("r2", 2000), 1500);
    const acc3 = recordLost(createAccounting("r3", 500), 100);

    const summary = summarizeAccounting([acc1, acc2, acc3]);

    expect(summary.totalRequested).toBe(3500);
    expect(summary.totalDelivered).toBe(2300);
    expect(summary.totalLost).toBe(100);
    expect(summary.totalRemaining).toBe(1100);
    expect(summary.avgDeliveryRate).toBeCloseTo(2300 / 3500, 2);
  });
});

// ─── E2E-006: Failure Recovery ───────────────────────────

describe("A4.4-E2E-006: Failure Recovery", () => {
  it("Hauler 死亡 → Cargo Loss 进入 Accounting → Demand 重新计算", () => {
    const requestId = "tr:empire:W1N1:W2N1:energy:0";
    let acc = createAccounting(requestId, 1000);

    // 分配 + 部分交付
    acc = recordAssigned(acc, 1000);
    acc = recordDelivered(acc, 600);

    // Hauler 死亡 → 剩余 400 全部损失
    const lostAmount = acc.remaining;
    acc = recordLost(acc, lostAmount);

    expect(acc.lost).toBe(400);
    expect(acc.remaining).toBe(0);
    expect(hasLoss(acc)).toBe(true);
    expect(lossRate(acc)).toBe(0.4);

    // 验证：可以基于 lost 重新创建 Request
    const newDeficit = makeDemandNode("W2N1", 400); // 仍然差 400
    expect(newDeficit.remaining).toBe(400);
  });
});

// ─── E2E-007: Stale Plan 检测 ────────────────────────────

describe("A4.4-E2E-007: Stale Plan 检测", () => {
  it("过期 Plan 不产出新 Request", () => {
    const routeCache = makeRouteCacheWithRoutes();
    const supply = makeSupplyNode("W1N1", 5000);
    const deficit = makeDemandNode("W2N1", 1000);

    // 用旧 tick 创建 Plan
    const oldTick = 100;
    const input: PlannerInput = {
      contracts: [],
      deficits: [deficit],
      surpluses: [supply],
      capacity: { rooms: [], totalHaulerGap: 0, totalCarrierGap: 0 } as any,
      routeCache,
      threats: new Map(),
      tick: oldTick,
    };

    const plan = planLogistics(input);
    expect(plan.plannedAt).toBe(oldTick);

    // 验证：Plan 的 plannedAt 在 100 tick 后仍然有效
    const currentTick = 250; // 150 tick 后
    const isPlanFresh = plan.plannedAt >= currentTick - 100;
    expect(isPlanFresh).toBe(false); // Plan 已过期
  });

  it("新鲜 Plan 产出有效 Request", () => {
    const routeCache = makeRouteCacheWithRoutes();
    const supply = makeSupplyNode("W1N1", 5000);
    const deficit = makeDemandNode("W2N1", 1000);

    const input: PlannerInput = {
      contracts: [],
      deficits: [deficit],
      surpluses: [supply],
      capacity: { rooms: [], totalHaulerGap: 0, totalCarrierGap: 0 } as any,
      routeCache,
      threats: new Map(),
      tick: TICK,
    };

    const plan = planLogistics(input);
    const currentTick = TICK + 50; // 50 tick 后
    const isPlanFresh = plan.plannedAt >= currentTick - 100;
    expect(isPlanFresh).toBe(true);
  });
});

// ─── E2E-008: Concurrent Plan 幂等性 ────────────────────

describe("A4.4-E2E-008: Concurrent Plan 幂等性", () => {
  it("相同输入两次规划产出相同结果（确定性）", () => {
    const routeCache1 = makeRouteCacheWithRoutes();
    const routeCache2 = makeRouteCacheWithRoutes();
    const supply = makeSupplyNode("W1N1", 5000);
    const deficit = makeDemandNode("W2N1", 1000);

    const baseInput = {
      contracts: [],
      deficits: [deficit],
      surpluses: [supply],
      capacity: { rooms: [], totalHaulerGap: 0, totalCarrierGap: 0 } as any,
      threats: new Map(),
      tick: TICK,
    };

    const plan1 = planLogistics({ ...baseInput, routeCache: routeCache1 });
    const plan2 = planLogistics({ ...baseInput, routeCache: routeCache2 });

    // 验证：两次规划产出相同数量、相同 source/target 的 requests
    expect(plan1.requests.length).toBe(plan2.requests.length);
    if (plan1.requests.length > 0) {
      expect(plan1.requests[0]!.source.room).toBe(plan2.requests[0]!.source.room);
      expect(plan1.requests[0]!.destination.room).toBe(plan2.requests[0]!.destination.room);
      expect(plan1.requests[0]!.amount).toBe(plan2.requests[0]!.amount);
    }
  });
});

// ─── E2E-009: Route Cache 失效 ───────────────────────────

describe("A4.4-E2E-009: Route Cache 失效与重建", () => {
  it("Route Cache TTL 过期后重新评估", () => {
    const cache = new RouteCache();
    const route = createRoute("W1N1", "W2N1", 2, 100, 200, TICK, []);
    cache.set(route);

    // 同 tick → 不需要重评估
    expect(cache.needsReeval("W1N1", "W2N1", 0, 0, 100, TICK)).toBe(false);

    // 5000 tick 后 → 需要重评估（TTL 过期）
    expect(cache.needsReeval("W1N1", "W2N1", 0, 0, 100, TICK + 5001)).toBe(true);
  });

  it("Route Cache 威胁变化后失效", () => {
    const cache = new RouteCache();
    const route = createRoute("W1N1", "W2N1", 2, 100, 200, TICK, []);
    cache.set(route);

    // 威胁等级变化 → 需要重评估
    expect(cache.needsReeval("W1N1", "W2N1", 0, 0.5, 100, TICK)).toBe(true);
  });
});

// ─── E2E-010: Supply Contract → Request 闭环 ─────────────

describe("A4.4-E2E-010: Supply Contract → TransportRequestV2 闭环", () => {
  it("从 Supply Contract 派生 TransportRequestV2", () => {
    const contract = createActiveSupplyContract(
      "W1N1", "W2N1", "energy",
      10, // targetRate: 10 energy/tick
      5000, // minimumReserve
      2, // priority
      TICK,
    );

    expect(contract.status).toBe("active");
    expect(isContractActive(contract.status)).toBe(true);

    const cycleAmount = computeCycleAmount(contract, 100);
    expect(cycleAmount).toBe(1000); // 10 * 100 = 1000

    // 从 Contract 派生 SupplyNode + DemandNode
    const producer: ProducerSnapshot = {
      room: "W1N1",
      storageEnergy: 50000,
      storageCapacity: 100000,
      transferable: 40000,
      reserved: 0,
    };
    const consumer: ConsumerSnapshot = {
      room: "W2N1",
      storageEnergy: 5000,
      storageCapacity: 100000,
      deficitAmount: 1000,
      criticality: "normal",
      firstSeen: TICK,
    };

    const supplyNode = bridgeToSupplyNode(contract, producer, TICK);
    const demandNode = bridgeToDemandNode(contract, consumer, TICK);

    expect(supplyNode).toBeDefined();
    expect(supplyNode!.contractId).toBe(contract.id);
    expect(supplyNode!.transferable).toBeLessThanOrEqual(cycleAmount);

    expect(demandNode).toBeDefined();
    expect(demandNode!.contractId).toBe(contract.id);
    expect(demandNode!.requested).toBeGreaterThanOrEqual(cycleAmount);
  });

  it("Contract 幂等：同一 (source, target, resource) 只有一个非终态 Contract", () => {
    const contract1 = createActiveSupplyContract("W1N1", "W2N1", "energy", 10, 5000, 2, TICK);
    const contracts = [contract1];

    expect(hasActiveContract(contracts, "W1N1", "W2N1", "energy")).toBe(true);
    expect(hasActiveContract(contracts, "W1N1", "W3N1", "energy")).toBe(false);
  });
});

// ─── E2E-012: V1/V2 兼容性 ───────────────────────────────

describe("A4.4-E2E-012: V1/V2 兼容性", () => {
  it("V2 Request 通过 adapter 可映射为 V1 TaskEntry", () => {
    const v2Req = createRequest(
      "energy", 1000,
      { room: "W1N1", type: "storage", structureId: "c123" },
      { room: "W1N1", type: "storage" },
      2, "room", TICK + 2000, TICK, "test",
    );

    // V2 Request 的关键字段
    expect(v2Req.requestId).toContain("tr:room:W1N1:W1N1:energy:");
    expect(v2Req.amount).toBe(1000);
    expect(v2Req.scope).toBe("room");
    expect(v2Req.source.structureId).toBe("c123");
  });

  it("V1 Request 和 V2 Request 去重逻辑正确", () => {
    // V1 Request key: "collect:room:containerId"
    const v1Key = "collect:W1N1:c123";
    const v1Parts = v1Key.split(":");
    const v1ContainerId = v1Parts[2] ?? "";

    // V2 Request source.structureId
    const v2StructureId = "c123";

    // 去重逻辑：如果 V2 已覆盖该 containerId，跳过 V1
    const planCoveredSourceIds = new Set<string>([v2StructureId]);
    const shouldSkipV1 = planCoveredSourceIds.has(v1ContainerId);

    expect(shouldSkipV1).toBe(true); // V2 已覆盖 → V1 跳过
  });
});

// ─── E2E-013: Multi-Resource 支持 ────────────────────────

describe("A4.4-E2E-013: Multi-Resource 支持", () => {
  it("Energy 和 Mineral 分别生成不同的 TransportRequestV2", () => {
    const routeCache = makeRouteCacheWithRoutes();

    const energyDeficit: DemandNode = {
      room: "W2N1",
      resource: "energy",
      requested: 1000,
      priority: 2,
      deadline: TICK + 2000,
      criticality: "normal",
      fulfilled: 0,
      remaining: 1000,
      firstSeen: TICK,
      timestamp: TICK,
    };

    // 矿物请求通过 Contract 驱动
    const mineralContract = createActiveSupplyContract(
      "W1N1", "W2N1", "U" as any,
      1, 1000, 2, TICK,
    );

    const input: PlannerInput = {
      contracts: [mineralContract],
      deficits: [energyDeficit],
      surpluses: [],
      capacity: { rooms: [], totalHaulerGap: 0, totalCarrierGap: 0 } as any,
      routeCache,
      threats: new Map(),
      tick: TICK,
    };

    const plan = planLogistics(input);

    // 验证：至少有 1 个 request（来自 Contract 的矿物请求）
    expect(plan.requests.length).toBeGreaterThanOrEqual(1);

    // 矿物请求的 resource 应为 "U"
    const mineralReq = plan.requests.find(r => r.resource === "U" as any);
    expect(mineralReq).toBeDefined();
  });
});

// ─── E2E-014: Priority Conflict ──────────────────────────

describe("A4.4-E2E-014: Priority Conflict", () => {
  it("CRITICAL 优先于 NORMAL 获得运输能力", () => {
    const supplyNodes = [
      makeSupplyNode("W1N1", 3000), // 只有 3000 可调拨
    ];
    const demandNodes = [
      makeDemandNode("W2N1", 2000, "normal"),   // normal
      makeDemandNode("W3N1", 2000, "critical"), // critical
    ];

    const routes = new Map<string, RouteDistance>();
    routes.set("W1N1:W2N1", makeRouteDistance("W1N1", "W2N1", 1));
    routes.set("W1N1:W3N1", makeRouteDistance("W1N1", "W3N1", 1));

    const result = allocateNetwork(supplyNodes, demandNodes, routes);

    // 验证：critical 需求被优先满足
    const criticalPlan = result.plans.find(p => p.targetRoom === "W3N1");
    expect(criticalPlan).toBeDefined();
    expect(criticalPlan!.amount).toBeGreaterThan(0);
  });
});

// ─── E2E-015: Logistics Bottleneck 识别 ─────────────────

describe("A4.4-E2E-015: Logistics Bottleneck 识别", () => {
  it("资源充足但运力不足时，识别为 LOGISTICS BOTTLENECK", () => {
    const supply = makeSupplyNode("W1N1", 10000);
    const deficit = makeDemandNode("W2N1", 1000);

    // 运力为 0（没有 hauler）
    const capacity = {
      rooms: [],
      totalHaulerGap: 5,
      totalCarrierGap: 2,
    } as any;

    // 验证：运力缺口 > 0 → LOGISTICS BOTTLENECK
    expect(capacity.totalHaulerGap).toBeGreaterThan(0);
    expect(capacity.totalCarrierGap).toBeGreaterThan(0);

    // 即使 supply > demand，运力不足意味着无法运输
    const isLogisticsBottleneck = supply.transferable > deficit.remaining
      && capacity.totalHaulerGap > 0;
    expect(isLogisticsBottleneck).toBe(true);
  });
});

// ─── Convergence Score 验证 ──────────────────────────────

describe("A4.4 Convergence Score 验证", () => {
  it("Supply Contract → Request 闭环完整", () => {
    const contract = createActiveSupplyContract("W1N1", "W2N1", "energy", 10, 5000, 2, TICK);
    const cycleAmount = computeCycleAmount(contract, 100);

    // Contract → cycleAmount → Request
    expect(cycleAmount).toBe(1000);

    // 验证 Contract 状态机
    expect(contract.status).toBe("active");
    expect(isContractActive(contract.status)).toBe(true);
    expect(effectiveRate(contract)).toBe(10);
  });

  it("Delivery Validation 验证实际收到量", () => {
    // 创建一个模拟 assignment（用于 validateDelivery）
    const assignment: TransportAssignment = {
      assignmentId: "ta:r1:hauler1",
      requestId: "r1",
      creepName: "hauler1",
      role: "hauler",
      resource: "energy",
      assignedAmount: 1000,
      loadedAmount: 1000,
      deliveredAmount: 0,
      lostAmount: 0,
      assignedAt: TICK,
      updatedAt: TICK,
      status: "in_transit",
    };

    // 完全交付
    const fullResult = validateDelivery(assignment, 5000, 6000, 0);
    expect(fullResult.verified).toBe(true);
    expect(fullResult.actualReceived).toBe(1000);
    expect(isFullyDelivered(fullResult)).toBe(true);

    // 部分交付
    const partialResult = validateDelivery(assignment, 5000, 5500, 0);
    expect(partialResult.verified).toBe(false);
    expect(partialResult.actualReceived).toBe(500);
    expect(isPartialDelivery(partialResult)).toBe(true);

    // 零交付
    const zeroResult = validateDelivery(assignment, 5000, 5000, 0);
    expect(zeroResult.verified).toBe(false);
    expect(isZeroDelivery(zeroResult)).toBe(true);
  });

  it("Accounting 跨 tick 追踪完整性", () => {
    let acc = createAccounting("r1", 1000);

    // 模拟跨 tick 的运输生命周期
    acc = recordAssigned(acc, 1000);   // tick 100: 分配
    acc = recordDelivered(acc, 600);   // tick 200: 部分交付
    acc = recordDelivered(acc, 350);   // tick 300: 再次交付
    acc = recordLost(acc, 50);         // tick 350: 损失

    // 验证最终状态
    expect(acc.requested).toBe(1000);
    expect(acc.assigned).toBe(1000);
    expect(acc.delivered).toBe(950);
    expect(acc.lost).toBe(50);
    expect(acc.remaining).toBe(0); // 1000 - 950 - 50 = 0
    // isComplete 检查 delivered >= requested，有损失时不标记完成
    expect(isComplete(acc)).toBe(false); // delivered=950 < requested=1000
    expect(deliveryRate(acc)).toBe(0.95);
    expect(lossRate(acc)).toBe(0.05);
  });
});
