/**
 * A4.0 Phase 2 — Supply Contract 单元测试。
 *
 * 覆盖：
 * - supply-contract.ts：Contract Model、ID 生成、创建、有效速率、周期量、交付记录、序列化
 * - contract-lifecycle.ts：状态机转换、故障检测、归档清理
 * - transport-cost.ts：距离/Body/能量/时间成本、总成本
 * - route-efficiency.ts：效率比率、等级判定、建议动作、最优 Producer 选择
 * - contract-node-bridge.ts：Contract→SupplyNode/DemandNode 转换、节点合并
 */
import { describe, it, expect } from "vitest";
import {
  createSupplyContract,
  createActiveSupplyContract,
  makeContractId,
  effectiveRate,
  computeCycleAmount,
  recordDelivery,
  findActiveContract,
  hasActiveContract,
  filterActiveContracts,
  filterTerminalContracts,
  getContractsBySource,
  getContractsByTarget,
  serializeContract,
  deserializeContract,
  isContractActive,
  isContractTerminal,
  CONTRACT_STATUSES,
  type SupplyContract,
} from "../../../src/domain/economy/supply-contract";
import {
  canTransition,
  transitionContract,
  activateContract,
  degradeContract,
  recoverContract,
  suspendContract,
  completeContract,
  cancelContract,
  detectFault,
  summarizeHealth,
  canArchive,
  filterArchivable,
  type ProducerState,
  type ConsumerState,
} from "../../../src/domain/economy/contract-lifecycle";
import {
  computeDistanceCost,
  computeBodyCost,
  computeEnergyCost,
  computeTimeCost,
  computeTransportCost,
  quickTransportCost,
  type HaulerBodyConfig,
  type TransportCostInput,
} from "../../../src/domain/economy/transport-cost";
import {
  evaluateRouteEfficiency,
  batchEvaluateEfficiency,
  gradeEfficiency,
  recommendAction,
  selectBestProducer,
  type ProducerCandidate,
} from "../../../src/domain/economy/route-efficiency";
import {
  bridgeToSupplyNode,
  bridgeToDemandNode,
  bridgeContracts,
  mergeSupplyNodes,
  mergeDemandNodes,
  isContractSupplyNode,
  isContractDemandNode,
  type ProducerSnapshot,
  type ConsumerSnapshot,
} from "../../../src/domain/economy/contract-node-bridge";
import type { SupplyNode } from "../../../src/domain/operation/supply-node";
import type { DemandNode } from "../../../src/domain/operation/demand-node";

// ─── 辅助构造函数 ─────────────────────────────────────────

function makeContract(over?: Partial<SupplyContract>): SupplyContract {
  return {
    id: "contract:W7N4:W8N4:energy",
    sourceRoom: "W7N4",
    targetRoom: "W8N4",
    resource: "energy",
    targetRate: 5,
    minimumReserve: 10000,
    priority: 2,
    status: "active",
    createdAt: 1000,
    updatedAt: 1000,
    activatedAt: 1000,
    terminatedAt: undefined,
    totalDelivered: 0,
    lastInjectionTick: undefined,
    consecutiveShortfall: 0,
    degradedRateMultiplier: 0.5,
    sourceRole: "core",
    targetRole: "production",
    reason: "role-based-specialization",
    ...over,
  };
}

function makeProducerState(over?: Partial<ProducerState>): ProducerState {
  return {
    room: "W7N4",
    storageEnergy: 50000,
    storageCapacity: 300000,
    isOwned: true,
    deliveredThisCycle: 500,
    ...over,
  };
}

function makeConsumerState(over?: Partial<ConsumerState>): ConsumerState {
  return {
    room: "W8N4",
    storageEnergy: 10000,
    storageCapacity: 300000,
    isOwned: true,
    needsAid: true,
    riskBuffer: 500,
    ...over,
  };
}

function makeProducerSnapshot(over?: Partial<ProducerSnapshot>): ProducerSnapshot {
  return {
    room: "W7N4",
    storageEnergy: 50000,
    storageCapacity: 300000,
    transferable: 40000,
    reserved: 0,
    ...over,
  };
}

function makeConsumerSnapshot(over?: Partial<ConsumerSnapshot>): ConsumerSnapshot {
  return {
    room: "W8N4",
    storageEnergy: 10000,
    storageCapacity: 300000,
    deficitAmount: 500,
    criticality: "normal",
    firstSeen: 1000,
    ...over,
  };
}

function makeHaulerBody(over?: Partial<HaulerBodyConfig>): HaulerBodyConfig {
  return {
    carryParts: 10,
    moveParts: 5,
    spawnCost: 250,
    capacity: 500,
    ...over,
  };
}

function makeRegistrySupplyNode(over?: Partial<SupplyNode>): SupplyNode {
  return {
    room: "W7N4",
    resource: "energy",
    available: 50000,
    reserved: 0,
    safety: 10000,
    transferable: 30000,
    priority: 3,
    health: 0.8,
    capacity: 300000,
    timestamp: 1000,
    ...over,
  };
}

function makeRegistryDemandNode(over?: Partial<DemandNode>): DemandNode {
  return {
    room: "W8N4",
    resource: "energy",
    requested: 1000,
    priority: 2,
    deadline: 3000,
    criticality: "normal",
    fulfilled: 0,
    remaining: 1000,
    firstSeen: 1000,
    timestamp: 1000,
    ...over,
  };
}

// ═════════════════════════════════════════════════════════
// §1  supply-contract.ts
// ═════════════════════════════════════════════════════════

describe("supply-contract.ts", () => {
  describe("isContractActive / isContractTerminal", () => {
    it("active 和 degraded 是活跃状态", () => {
      expect(isContractActive("active")).toBe(true);
      expect(isContractActive("degraded")).toBe(true);
    });
    it("proposed/suspended 不是活跃状态", () => {
      expect(isContractActive("proposed")).toBe(false);
      expect(isContractActive("suspended")).toBe(false);
    });
    it("completed 和 cancelled 是终态", () => {
      expect(isContractTerminal("completed")).toBe(true);
      expect(isContractTerminal("cancelled")).toBe(true);
    });
    it("active 不是终态", () => {
      expect(isContractTerminal("active")).toBe(false);
    });
  });

  describe("CONTRACT_STATUSES", () => {
    it("包含全部 6 个状态", () => {
      expect(CONTRACT_STATUSES).toHaveLength(6);
      expect(CONTRACT_STATUSES).toContain("proposed");
      expect(CONTRACT_STATUSES).toContain("active");
      expect(CONTRACT_STATUSES).toContain("degraded");
      expect(CONTRACT_STATUSES).toContain("suspended");
      expect(CONTRACT_STATUSES).toContain("completed");
      expect(CONTRACT_STATUSES).toContain("cancelled");
    });
  });

  describe("makeContractId", () => {
    it("生成正确格式的 ID", () => {
      expect(makeContractId("W7N4", "W8N4", "energy")).toBe("contract:W7N4:W8N4:energy");
    });
    it("不同参数生成不同 ID", () => {
      expect(makeContractId("W7N4", "W8N4", "energy")).not.toBe(makeContractId("W7N4", "W9N4", "energy"));
    });
  });

  describe("createSupplyContract", () => {
    it("创建初始状态为 proposed 的 Contract", () => {
      const c = createSupplyContract("W7N4", "W8N4", "energy", 5, 10000, 2, 1000);
      expect(c.id).toBe("contract:W7N4:W8N4:energy");
      expect(c.status).toBe("proposed");
      expect(c.targetRate).toBe(5);
      expect(c.minimumReserve).toBe(10000);
      expect(c.activatedAt).toBeUndefined();
      expect(c.totalDelivered).toBe(0);
    });
    it("带 role 和 reason 参数", () => {
      const c = createSupplyContract("W7N4", "W8N4", "energy", 5, 10000, 2, 1000, "core", "production", "test");
      expect(c.sourceRole).toBe("core");
      expect(c.targetRole).toBe("production");
      expect(c.reason).toBe("test");
    });
  });

  describe("createActiveSupplyContract", () => {
    it("创建初始状态为 active", () => {
      const c = createActiveSupplyContract("W7N4", "W8N4", "energy", 5, 10000, 2, 1000);
      expect(c.status).toBe("active");
      expect(c.activatedAt).toBe(1000);
    });
  });

  describe("effectiveRate", () => {
    it("active 返回 targetRate", () => {
      expect(effectiveRate(makeContract({ status: "active", targetRate: 7 }))).toBe(7);
    });
    it("degraded 返回 targetRate × multiplier", () => {
      expect(effectiveRate(makeContract({ status: "degraded", targetRate: 10, degradedRateMultiplier: 0.5 }))).toBe(5);
    });
    it("非活跃返回 0", () => {
      expect(effectiveRate(makeContract({ status: "proposed" }))).toBe(0);
      expect(effectiveRate(makeContract({ status: "suspended" }))).toBe(0);
      expect(effectiveRate(makeContract({ status: "completed" }))).toBe(0);
    });
  });

  describe("computeCycleAmount", () => {
    it("active = targetRate × intervalTicks", () => {
      expect(computeCycleAmount(makeContract({ status: "active", targetRate: 5 }), 100)).toBe(500);
    });
    it("degraded = targetRate × multiplier × intervalTicks", () => {
      expect(computeCycleAmount(makeContract({ status: "degraded", targetRate: 10, degradedRateMultiplier: 0.5 }), 100)).toBe(500);
    });
    it("非活跃 = 0", () => {
      expect(computeCycleAmount(makeContract({ status: "suspended" }), 100)).toBe(0);
    });
    it("默认 intervalTicks=100", () => {
      expect(computeCycleAmount(makeContract({ status: "active", targetRate: 3 }))).toBe(300);
    });
  });

  describe("recordDelivery", () => {
    it("正常交付重置 shortfall", () => {
      const c = makeContract({ targetRate: 5, totalDelivered: 1000, consecutiveShortfall: 2 });
      const u = recordDelivery(c, 500, 1100);
      expect(u.totalDelivered).toBe(1500);
      expect(u.consecutiveShortfall).toBe(0);
      expect(u.lastInjectionTick).toBe(1100);
    });
    it("短缺交付累加 shortfall", () => {
      const c = makeContract({ targetRate: 5, consecutiveShortfall: 0 });
      expect(recordDelivery(c, 200, 1100).consecutiveShortfall).toBe(1);
    });
    it("不可变——不修改原对象", () => {
      const c = makeContract({ totalDelivered: 1000 });
      recordDelivery(c, 500, 1100);
      expect(c.totalDelivered).toBe(1000);
    });
  });

  describe("findActiveContract / hasActiveContract", () => {
    const contracts = [
      makeContract({ id: "contract:W7N4:W8N4:energy", status: "active" }),
      makeContract({ id: "contract:W7N4:W9N4:energy", status: "completed" }),
    ];
    it("找到非终态 Contract", () => {
      expect(findActiveContract(contracts, "W7N4", "W8N4", "energy")?.status).toBe("active");
    });
    it("终态不算活跃", () => {
      expect(findActiveContract(contracts, "W7N4", "W9N4", "energy")).toBeUndefined();
    });
    it("hasActiveContract 返回 boolean", () => {
      expect(hasActiveContract(contracts, "W7N4", "W8N4", "energy")).toBe(true);
      expect(hasActiveContract(contracts, "W7N4", "W9N4", "energy")).toBe(false);
    });
  });

  describe("filterActiveContracts", () => {
    it("只返回 active + degraded", () => {
      const cs = [
        makeContract({ status: "active" }),
        makeContract({ status: "completed" }),
        makeContract({ status: "degraded" }),
        makeContract({ status: "proposed" }),
      ];
      expect(filterActiveContracts(cs)).toHaveLength(2);
    });
  });

  describe("filterTerminalContracts", () => {
    it("只返回 completed + cancelled", () => {
      const cs = [
        makeContract({ status: "active" }),
        makeContract({ status: "completed" }),
        makeContract({ status: "cancelled" }),
      ];
      expect(filterTerminalContracts(cs)).toHaveLength(2);
    });
  });

  describe("getContractsBySource / getContractsByTarget", () => {
    const cs = [
      makeContract({ sourceRoom: "W7N4", targetRoom: "W8N4", status: "active" }),
      makeContract({ sourceRoom: "W7N4", targetRoom: "W9N4", status: "active" }),
      makeContract({ sourceRoom: "W7N3", targetRoom: "W8N4", status: "active" }),
    ];
    it("bySource", () => { expect(getContractsBySource(cs, "W7N4")).toHaveLength(2); });
    it("byTarget", () => { expect(getContractsByTarget(cs, "W8N4")).toHaveLength(2); });
    it("不返回非活跃", () => {
      const cs2 = [makeContract({ sourceRoom: "W7N4", targetRoom: "W8N4", status: "completed" })];
      expect(getContractsBySource(cs2, "W7N4")).toHaveLength(0);
    });
  });

  describe("serializeContract / deserializeContract", () => {
    it("往返一致", () => {
      const original = makeContract({
        status: "degraded", targetRate: 7.5, totalDelivered: 12345,
        consecutiveShortfall: 3, activatedAt: 2000,
      });
      const restored = deserializeContract(serializeContract(original));
      expect(restored.id).toBe(original.id);
      expect(restored.status).toBe("degraded");
      expect(restored.targetRate).toBeCloseTo(7.5, 1);
      expect(restored.totalDelivered).toBe(12345);
      expect(restored.sourceRole).toBe("core");
    });
    it("终态正确序列化", () => {
      const r = deserializeContract(serializeContract(makeContract({ status: "completed", terminatedAt: 5000 })));
      expect(r.status).toBe("completed");
      expect(r.terminatedAt).toBe(5000);
    });
    it("undefined role 正确处理", () => {
      const r = deserializeContract(serializeContract(makeContract({ sourceRole: undefined, targetRole: undefined })));
      expect(r.sourceRole).toBeUndefined();
      expect(r.targetRole).toBeUndefined();
    });
  });
});

// ═════════════════════════════════════════════════════════
// §2  contract-lifecycle.ts
// ═════════════════════════════════════════════════════════

describe("contract-lifecycle.ts", () => {
  describe("canTransition", () => {
    it("proposed→active 合法", () => { expect(canTransition("proposed", "active")).toBe(true); });
    it("proposed→cancelled 合法", () => { expect(canTransition("proposed", "cancelled")).toBe(true); });
    it("proposed→degraded 非法", () => { expect(canTransition("proposed", "degraded")).toBe(false); });
    it("active→degraded 合法", () => { expect(canTransition("active", "degraded")).toBe(true); });
    it("active→suspended 合法", () => { expect(canTransition("active", "suspended")).toBe(true); });
    it("active→completed 合法", () => { expect(canTransition("active", "completed")).toBe(true); });
    it("degraded→active 合法", () => { expect(canTransition("degraded", "active")).toBe(true); });
    it("suspended→active 合法", () => { expect(canTransition("suspended", "active")).toBe(true); });
    it("completed→active 非法", () => { expect(canTransition("completed", "active")).toBe(false); });
    it("cancelled→active 非法", () => { expect(canTransition("cancelled", "active")).toBe(false); });
    it("自转换合法", () => { expect(canTransition("active", "active")).toBe(true); });
  });

  describe("transitionContract", () => {
    it("执行合法转换", () => {
      const u = transitionContract(makeContract({ status: "proposed", activatedAt: undefined }), "active", 1100);
      expect(u.status).toBe("active");
      expect(u.activatedAt).toBe(1100);
    });
    it("非法转换抛出", () => {
      expect(() => transitionContract(makeContract({ status: "proposed" }), "degraded", 1100)).toThrow();
    });
    it("自转换幂等", () => {
      const c = makeContract({ status: "active" });
      expect(transitionContract(c, "active", 1100)).toBe(c);
    });
    it("终态设置 terminatedAt", () => {
      expect(transitionContract(makeContract({ status: "active" }), "completed", 2000).terminatedAt).toBe(2000);
    });
  });

  describe("便捷转换", () => {
    it("activateContract", () => {
      expect(activateContract(makeContract({ status: "proposed", activatedAt: undefined }), 1100).status).toBe("active");
    });
    it("degradeContract", () => {
      expect(degradeContract(makeContract({ status: "active" }), 1100).status).toBe("degraded");
    });
    it("recoverContract 重置 shortfall", () => {
      const u = recoverContract(makeContract({ status: "degraded", consecutiveShortfall: 3 }), 1100);
      expect(u.status).toBe("active");
      expect(u.consecutiveShortfall).toBe(0);
    });
    it("suspendContract", () => {
      expect(suspendContract(makeContract({ status: "active" }), 1100).status).toBe("suspended");
    });
    it("completeContract", () => {
      const u = completeContract(makeContract({ status: "active" }), 1100);
      expect(u.status).toBe("completed");
      expect(u.terminatedAt).toBe(1100);
    });
    it("cancelContract", () => {
      const u = cancelContract(makeContract({ status: "active" }), 1100);
      expect(u.status).toBe("cancelled");
      expect(u.terminatedAt).toBe(1100);
    });
  });

  describe("detectFault", () => {
    it("终态不检测", () => {
      const r = detectFault(makeContract({ status: "completed" }), makeProducerState(), makeConsumerState());
      expect(r.changed).toBe(false);
    });
    it("Producer 失守→CANCELLED", () => {
      const r = detectFault(makeContract({ status: "active" }), makeProducerState({ isOwned: false }), makeConsumerState());
      expect(r.newStatus).toBe("cancelled");
      expect(r.reason).toContain("lost");
    });
    it("Consumer 失守→CANCELLED", () => {
      const r = detectFault(makeContract({ status: "active" }), makeProducerState(), makeConsumerState({ isOwned: false }));
      expect(r.newStatus).toBe("cancelled");
    });
    it("PROPOSED 不检测", () => {
      const r = detectFault(makeContract({ status: "proposed" }), makeProducerState(), makeConsumerState());
      expect(r.changed).toBe(false);
    });
    it("Producer 短缺超阈值→DEGRADED", () => {
      const c = makeContract({ status: "active", minimumReserve: 10000, consecutiveShortfall: 2 });
      const r = detectFault(c, makeProducerState({ storageEnergy: 5000 }), makeConsumerState());
      expect(r.newStatus).toBe("degraded");
      expect(r.changed).toBe(true);
    });
    it("Producer 短缺未达阈值→保持 ACTIVE", () => {
      const c = makeContract({ status: "active", minimumReserve: 10000, consecutiveShortfall: 1 });
      const r = detectFault(c, makeProducerState({ storageEnergy: 5000 }), makeConsumerState());
      expect(r.newStatus).toBe("active");
    });
    it("Consumer 不需要→COMPLETED", () => {
      const r = detectFault(makeContract({ status: "active" }), makeProducerState(), makeConsumerState({ needsAid: false }));
      expect(r.newStatus).toBe("completed");
    });
    it("DEGRADED 持续短缺→SUSPENDED", () => {
      const c = makeContract({ status: "degraded", minimumReserve: 10000, consecutiveShortfall: 3 });
      const r = detectFault(c, makeProducerState({ storageEnergy: 5000 }), makeConsumerState());
      expect(r.newStatus).toBe("suspended");
    });
    it("DEGRADED 恢复→ACTIVE", () => {
      const c = makeContract({ status: "degraded", minimumReserve: 10000, consecutiveShortfall: 0 });
      const r = detectFault(c, makeProducerState({ storageEnergy: 50000 }), makeConsumerState());
      expect(r.newStatus).toBe("active");
    });
    it("SUSPENDED 恢复→ACTIVE", () => {
      const c = makeContract({ status: "suspended", minimumReserve: 10000 });
      const r = detectFault(c, makeProducerState({ storageEnergy: 50000 }), makeConsumerState({ needsAid: true }));
      expect(r.newStatus).toBe("active");
    });
    it("健康保持不变", () => {
      const c = makeContract({ status: "active", minimumReserve: 10000, consecutiveShortfall: 0 });
      const r = detectFault(c, makeProducerState({ storageEnergy: 50000 }), makeConsumerState());
      expect(r.changed).toBe(false);
      expect(r.reason).toBe("healthy");
    });
  });

  describe("summarizeHealth", () => {
    it("生成正确摘要", () => {
      const c = makeContract({ totalDelivered: 5000, consecutiveShortfall: 1, activatedAt: 1000, updatedAt: 1500, targetRate: 5 });
      const s = summarizeHealth(c, 2000, (ct) => effectiveRate(ct));
      expect(s.isActive).toBe(true);
      expect(s.totalDelivered).toBe(5000);
      expect(s.ageTicks).toBe(1000);
    });
  });

  describe("canArchive / filterArchivable", () => {
    it("终态超期可归档", () => {
      expect(canArchive(makeContract({ status: "completed", terminatedAt: 1000 }), 2001)).toBe(true);
    });
    it("终态未超期不可归档", () => {
      expect(canArchive(makeContract({ status: "completed", terminatedAt: 1000 }), 1999)).toBe(false);
    });
    it("非终态不可归档", () => {
      expect(canArchive(makeContract({ status: "active" }), 5000)).toBe(false);
    });
    it("filterArchivable 只返回可归档的", () => {
      const cs = [
        makeContract({ status: "completed", terminatedAt: 500 }),
        makeContract({ status: "completed", terminatedAt: 1500 }),
        makeContract({ status: "active" }),
      ];
      expect(filterArchivable(cs, 2000)).toHaveLength(1);
    });
  });
});

// ═════════════════════════════════════════════════════════
// §3  transport-cost.ts
// ═════════════════════════════════════════════════════════

describe("transport-cost.ts", () => {
  describe("computeDistanceCost", () => {
    it("距离×权重", () => { expect(computeDistanceCost(5, 10)).toBe(50); });
    it("默认权重10", () => { expect(computeDistanceCost(3)).toBe(30); });
    it("零距离=0", () => { expect(computeDistanceCost(0)).toBe(0); });
  });

  describe("computeBodyCost", () => {
    it("spawnCost/lifespan", () => {
      expect(computeBodyCost(makeHaulerBody({ spawnCost: 250 }), 1000, 1)).toBe(0.25);
    });
    it("零寿命返回全额", () => {
      expect(computeBodyCost(makeHaulerBody({ spawnCost: 250 }), 0, 1)).toBe(250);
    });
  });

  describe("computeEnergyCost", () => {
    it("有 decay 计算损耗", () => {
      expect(computeEnergyCost(1000, makeHaulerBody({ capacity: 500 }), 5, 10)).toBe(20);
    });
    it("零 decay=0", () => {
      expect(computeEnergyCost(1000, makeHaulerBody({ capacity: 500 }), 5, 0)).toBe(0);
    });
    it("零 amount=0", () => {
      expect(computeEnergyCost(0, makeHaulerBody({ capacity: 500 }), 5, 10)).toBe(0);
    });
  });

  describe("computeTimeCost", () => {
    it("有路 moveSpeed=1", () => {
      expect(computeTimeCost(1000, makeHaulerBody({ capacity: 500 }), 5, 0.1, true)).toBe(2);
    });
    it("无路 moveSpeed=0.5", () => {
      expect(computeTimeCost(1000, makeHaulerBody({ capacity: 500 }), 5, 0.1, false)).toBe(4);
    });
  });

  describe("computeTransportCost", () => {
    it("总成本=distance+body+energy+time", () => {
      const input: TransportCostInput = {
        amount: 1000, linearDistance: 5,
        body: makeHaulerBody({ spawnCost: 250, capacity: 500 }),
        hasRoad: true, decayPerTrip: 10, haulerLifespan: 1000,
        distanceWeight: 10, costPerSpawnEnergy: 1, cpuTimeValue: 0.1,
      };
      const r = computeTransportCost(input);
      expect(r.distance).toBe(50);
      expect(r.body).toBe(0.25);
      expect(r.energy).toBe(20);
      expect(r.time).toBe(2);
      expect(r.total).toBeCloseTo(72.25, 2);
      expect(r.roundTrips).toBe(2);
    });
  });

  describe("quickTransportCost", () => {
    it("使用默认参数", () => {
      const r = quickTransportCost(500, 3, makeHaulerBody({ capacity: 500 }));
      expect(r.distance).toBe(30);
      expect(r.roundTrips).toBe(1);
    });
    it("支持覆盖", () => {
      const r = quickTransportCost(500, 3, makeHaulerBody({ capacity: 500 }), { hasRoad: false });
      expect(r.time).toBeCloseTo(1.2, 5);
    });
  });
});

// ═════════════════════════════════════════════════════════
// §4  route-efficiency.ts
// ═════════════════════════════════════════════════════════

describe("route-efficiency.ts", () => {
  describe("gradeEfficiency", () => {
    it(">=10 → excellent", () => { expect(gradeEfficiency(10)).toBe("excellent"); });
    it(">=5 → good", () => { expect(gradeEfficiency(5)).toBe("good"); });
    it(">=2 → fair", () => { expect(gradeEfficiency(2)).toBe("fair"); });
    it(">=1 → poor", () => { expect(gradeEfficiency(1)).toBe("poor"); });
    it("<1 → bad", () => { expect(gradeEfficiency(0.5)).toBe("bad"); });
  });

  describe("evaluateRouteEfficiency", () => {
    it("正常计算 ratio", () => {
      const c = makeContract();
      const cost = quickTransportCost(500, 3, makeHaulerBody({ capacity: 500 }));
      const eff = evaluateRouteEfficiency(c, 500, cost);
      expect(eff.contractId).toBe(c.id);
      expect(eff.ratio).toBeGreaterThan(0);
      expect(eff.shouldMaintain).toBe(true);
    });
    it("零成本+有交付=Infinity", () => {
      const c = makeContract();
      // 使用 body spawnCost=0 使 total=0
      const cost = quickTransportCost(0, 0, makeHaulerBody({ spawnCost: 0, capacity: 500 }));
      const eff = evaluateRouteEfficiency(c, 100, cost);
      expect(eff.ratio).toBe(Infinity);
      expect(eff.grade).toBe("excellent");
    });
    it("零交付=0", () => {
      const c = makeContract();
      const cost = quickTransportCost(500, 3, makeHaulerBody({ capacity: 500 }));
      const eff = evaluateRouteEfficiency(c, 0, cost);
      expect(eff.ratio).toBe(0);
      expect(eff.grade).toBe("bad");
    });
  });

  describe("batchEvaluateEfficiency", () => {
    it("按 ratio 降序排列", () => {
      const c = makeContract();
      const cost1 = quickTransportCost(100, 1, makeHaulerBody({ capacity: 500 }));
      const cost2 = quickTransportCost(100, 5, makeHaulerBody({ capacity: 500 }));
      const results = batchEvaluateEfficiency([
        { contract: c, delivered: 100, cost: cost2 },
        { contract: c, delivered: 100, cost: cost1 },
      ]);
      expect(results[0]!.ratio).toBeGreaterThanOrEqual(results[1]!.ratio);
    });
  });

  describe("recommendAction", () => {
    it("bad → cancel", () => {
      const c = makeContract({ status: "active" });
      const eff = { contractId: c.id, delivered: 10, cost: quickTransportCost(10, 10, makeHaulerBody({ capacity: 500 })), ratio: 0.1, grade: "bad" as const, shouldMaintain: false };
      expect(recommendAction(eff, c).action).toBe("cancel");
    });
    it("poor → renegotiate", () => {
      const c = makeContract({ status: "active" });
      const eff = { contractId: c.id, delivered: 100, cost: quickTransportCost(100, 10, makeHaulerBody({ capacity: 500 })), ratio: 1.2, grade: "poor" as const, shouldMaintain: false };
      expect(recommendAction(eff, c).action).toBe("renegotiate");
    });
    it("fair + shortfall → investigate", () => {
      const c = makeContract({ status: "active", consecutiveShortfall: 3 });
      const eff = { contractId: c.id, delivered: 200, cost: quickTransportCost(200, 5, makeHaulerBody({ capacity: 500 })), ratio: 3, grade: "fair" as const, shouldMaintain: true };
      expect(recommendAction(eff, c).action).toBe("investigate");
    });
    it("good/excellent → maintain", () => {
      const c = makeContract({ status: "active" });
      const eff = { contractId: c.id, delivered: 500, cost: quickTransportCost(500, 1, makeHaulerBody({ capacity: 500 })), ratio: 50, grade: "excellent" as const, shouldMaintain: true };
      expect(recommendAction(eff, c).action).toBe("maintain");
    });
    it("终态 → maintain（不做动作）", () => {
      const c = makeContract({ status: "completed" });
      const eff = { contractId: c.id, delivered: 0, cost: quickTransportCost(0, 0, makeHaulerBody({ capacity: 500 })), ratio: 0, grade: "bad" as const, shouldMaintain: false };
      expect(recommendAction(eff, c).action).toBe("maintain");
    });
  });

  describe("selectBestProducer", () => {
    it("选择 ratio 最高的", () => {
      const c = makeContract();
      const candidates: ProducerCandidate[] = [
        { room: "W7N3", expectedDelivered: 100, cost: quickTransportCost(100, 5, makeHaulerBody({ capacity: 500 })) },
        { room: "W7N5", expectedDelivered: 100, cost: quickTransportCost(100, 1, makeHaulerBody({ capacity: 500 })) },
      ];
      const best = selectBestProducer(candidates, c);
      expect(best).toBeDefined();
      expect(best!.best.room).toBe("W7N5");
    });
    it("空列表返回 undefined", () => {
      expect(selectBestProducer([], makeContract())).toBeUndefined();
    });
  });
});

// ═════════════════════════════════════════════════════════
// §5  contract-node-bridge.ts
// ═════════════════════════════════════════════════════════

describe("contract-node-bridge.ts", () => {
  describe("bridgeToSupplyNode", () => {
    it("从活跃 Contract + Producer 创建 ContractSupplyNode", () => {
      const c = makeContract({ status: "active", targetRate: 5, priority: 2 });
      const p = makeProducerSnapshot({ storageEnergy: 50000, transferable: 40000 });
      const node = bridgeToSupplyNode(c, p, 1000);
      expect(node).toBeDefined();
      expect(node!.contractId).toBe(c.id);
      expect(node!.contractDriven).toBe(true);
      expect(node!.room).toBe("W7N4");
      expect(node!.resource).toBe("energy");
      expect(node!.priority).toBe(2);
      expect(node!.transferable).toBe(500); // min(500, 40000) = 500
    });
    it("非活跃 Contract 返回 undefined", () => {
      const c = makeContract({ status: "proposed" });
      expect(bridgeToSupplyNode(c, makeProducerSnapshot(), 1000)).toBeUndefined();
    });
    it("Producer 容量=0 返回 undefined", () => {
      const c = makeContract({ status: "active" });
      expect(bridgeToSupplyNode(c, makeProducerSnapshot({ storageCapacity: 0 }), 1000)).toBeUndefined();
    });
    it("transferable=0 返回 undefined", () => {
      const c = makeContract({ status: "active" });
      expect(bridgeToSupplyNode(c, makeProducerSnapshot({ transferable: 0 }), 1000)).toBeUndefined();
    });
    it("degraded 状态正常创建节点", () => {
      const c = makeContract({ status: "degraded", targetRate: 10, degradedRateMultiplier: 0.5 });
      const node = bridgeToSupplyNode(c, makeProducerSnapshot({ transferable: 1000 }), 1000);
      expect(node).toBeDefined();
      expect(node!.transferable).toBe(500); // 10×0.5×100=500
    });
  });

  describe("bridgeToDemandNode", () => {
    it("从活跃 Contract + Consumer 创建 ContractDemandNode", () => {
      const c = makeContract({ status: "active", targetRate: 5, priority: 2 });
      const consumer = makeConsumerSnapshot({ deficitAmount: 500, criticality: "normal" });
      const node = bridgeToDemandNode(c, consumer, 1000);
      expect(node).toBeDefined();
      expect(node!.contractId).toBe(c.id);
      expect(node!.contractDriven).toBe(true);
      expect(node!.room).toBe("W8N4");
      expect(node!.requested).toBe(500); // max(500, 500) = 500
      expect(node!.criticality).toBe("normal");
    });
    it("非活跃 Contract 返回 undefined", () => {
      const c = makeContract({ status: "suspended" });
      expect(bridgeToDemandNode(c, makeConsumerSnapshot(), 1000)).toBeUndefined();
    });
    it("Consumer 缺口 > Contract 目标时 requested = 缺口", () => {
      const c = makeContract({ status: "active", targetRate: 5 }); // cycleAmount=500
      const consumer = makeConsumerSnapshot({ deficitAmount: 2000 });
      const node = bridgeToDemandNode(c, consumer, 1000);
      expect(node!.requested).toBe(2000);
    });
    it("Consumer 缺口 < Contract 目标时 requested = Contract 目标", () => {
      const c = makeContract({ status: "active", targetRate: 5 }); // cycleAmount=500
      const consumer = makeConsumerSnapshot({ deficitAmount: 100 });
      const node = bridgeToDemandNode(c, consumer, 1000);
      expect(node!.requested).toBe(500);
    });
    it("优先级取 Contract 和 Consumer 更紧急者", () => {
      const c = makeContract({ status: "active", priority: 3 });
      const consumer = makeConsumerSnapshot({ criticality: "critical" }); // priority=0
      const node = bridgeToDemandNode(c, consumer, 1000);
      expect(node!.priority).toBe(0); // min(3, 0) = 0
    });
  });

  describe("bridgeContracts", () => {
    it("批量桥接多个 Contract", () => {
      const c1 = makeContract({ id: "c1", sourceRoom: "W7N4", targetRoom: "W8N4", status: "active" });
      const c2 = makeContract({ id: "c2", sourceRoom: "W7N3", targetRoom: "W9N4", status: "active" });
      const inputs = [
        { contract: c1, producer: makeProducerSnapshot({ room: "W7N4" }), consumer: makeConsumerSnapshot({ room: "W8N4" }) },
        { contract: c2, producer: makeProducerSnapshot({ room: "W7N3" }), consumer: makeConsumerSnapshot({ room: "W9N4" }) },
      ];
      const { supplyNodes, demandNodes } = bridgeContracts(inputs, 1000);
      expect(supplyNodes).toHaveLength(2);
      expect(demandNodes).toHaveLength(2);
    });
    it("跳过非活跃 Contract", () => {
      const c1 = makeContract({ status: "active" });
      const c2 = makeContract({ status: "proposed" });
      const inputs = [
        { contract: c1, producer: makeProducerSnapshot(), consumer: makeConsumerSnapshot() },
        { contract: c2, producer: makeProducerSnapshot(), consumer: makeConsumerSnapshot() },
      ];
      const { supplyNodes, demandNodes } = bridgeContracts(inputs, 1000);
      expect(supplyNodes).toHaveLength(1);
      expect(demandNodes).toHaveLength(1);
    });
  });

  describe("isContractSupplyNode / isContractDemandNode", () => {
    it("正确识别 Contract 驱动的 SupplyNode", () => {
      const c = makeContract({ status: "active" });
      const node = bridgeToSupplyNode(c, makeProducerSnapshot(), 1000)!;
      expect(isContractSupplyNode(node)).toBe(true);
    });
    it("Registry SupplyNode 不是 Contract 驱动", () => {
      const node = makeRegistrySupplyNode();
      expect(isContractSupplyNode(node)).toBe(false);
    });
    it("正确识别 Contract 驱动的 DemandNode", () => {
      const c = makeContract({ status: "active" });
      const node = bridgeToDemandNode(c, makeConsumerSnapshot(), 1000)!;
      expect(isContractDemandNode(node)).toBe(true);
    });
    it("Registry DemandNode 不是 Contract 驱动", () => {
      const node = makeRegistryDemandNode();
      expect(isContractDemandNode(node)).toBe(false);
    });
  });

  describe("mergeSupplyNodes", () => {
    it("Contract 节点 + Registry 节点合并", () => {
      const c = makeContract({ status: "active" });
      const contractNode = bridgeToSupplyNode(c, makeProducerSnapshot({ room: "W7N4" }), 1000)!;
      const registryNode = makeRegistrySupplyNode({ room: "W9N4" });
      const merged = mergeSupplyNodes([contractNode], [registryNode]);
      expect(merged).toHaveLength(2);
    });
    it("同 key 只保留 Contract 节点", () => {
      const c = makeContract({ status: "active", sourceRoom: "W7N4" });
      const contractNode = bridgeToSupplyNode(c, makeProducerSnapshot({ room: "W7N4" }), 1000)!;
      const registryNode = makeRegistrySupplyNode({ room: "W7N4" }); // 同 room
      const merged = mergeSupplyNodes([contractNode], [registryNode]);
      expect(merged).toHaveLength(1);
      expect(isContractSupplyNode(merged[0]!)).toBe(true);
    });
    it("空输入返回空", () => {
      expect(mergeSupplyNodes([], [])).toHaveLength(0);
    });
  });

  describe("mergeDemandNodes", () => {
    it("Contract 节点 + Registry 节点合并", () => {
      const c = makeContract({ status: "active" });
      const contractNode = bridgeToDemandNode(c, makeConsumerSnapshot({ room: "W8N4" }), 1000)!;
      const registryNode = makeRegistryDemandNode({ room: "W9N4" });
      const merged = mergeDemandNodes([contractNode], [registryNode]);
      expect(merged).toHaveLength(2);
    });
    it("同 key 只保留 Contract 节点", () => {
      const c = makeContract({ status: "active", targetRoom: "W8N4" });
      const contractNode = bridgeToDemandNode(c, makeConsumerSnapshot({ room: "W8N4" }), 1000)!;
      const registryNode = makeRegistryDemandNode({ room: "W8N4" });
      const merged = mergeDemandNodes([contractNode], [registryNode]);
      expect(merged).toHaveLength(1);
      expect(isContractDemandNode(merged[0]!)).toBe(true);
    });
  });
});
