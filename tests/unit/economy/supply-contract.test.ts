/**  */
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
  computeDistanceCost,
  computeBodyCost,
  computeEnergyCost,
  computeTimeCost,
  computeTransportCost,
  quickTransportCost,
  type HaulerBodyConfig,
  type TransportCostInput,
} from "../../../src/domain/economy/transport-cost";

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

function makeHaulerBody(over?: Partial<HaulerBodyConfig>): HaulerBodyConfig {
  return {
    carryParts: 10,
    moveParts: 5,
    spawnCost: 250,
    capacity: 500,
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
      expect(makeContractId("W7N4", "W8N4", "energy")).not.toBe(
        makeContractId("W7N4", "W9N4", "energy"),
      );
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
      const c = createSupplyContract(
        "W7N4",
        "W8N4",
        "energy",
        5,
        10000,
        2,
        1000,
        "core",
        "production",
        "test",
      );
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
      expect(
        effectiveRate(
          makeContract({ status: "degraded", targetRate: 10, degradedRateMultiplier: 0.5 }),
        ),
      ).toBe(5);
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
      expect(
        computeCycleAmount(
          makeContract({ status: "degraded", targetRate: 10, degradedRateMultiplier: 0.5 }),
          100,
        ),
      ).toBe(500);
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
    it("bySource", () => {
      expect(getContractsBySource(cs, "W7N4")).toHaveLength(2);
    });
    it("byTarget", () => {
      expect(getContractsByTarget(cs, "W8N4")).toHaveLength(2);
    });
    it("不返回非活跃", () => {
      const cs2 = [makeContract({ sourceRoom: "W7N4", targetRoom: "W8N4", status: "completed" })];
      expect(getContractsBySource(cs2, "W7N4")).toHaveLength(0);
    });
  });

  describe("serializeContract / deserializeContract", () => {
    it("往返一致", () => {
      const original = makeContract({
        status: "degraded",
        targetRate: 7.5,
        totalDelivered: 12345,
        consecutiveShortfall: 3,
        activatedAt: 2000,
      });
      const restored = deserializeContract(serializeContract(original));
      expect(restored.id).toBe(original.id);
      expect(restored.status).toBe("degraded");
      expect(restored.targetRate).toBeCloseTo(7.5, 1);
      expect(restored.totalDelivered).toBe(12345);
      expect(restored.sourceRole).toBe("core");
    });
    it("终态正确序列化", () => {
      const r = deserializeContract(
        serializeContract(makeContract({ status: "completed", terminatedAt: 5000 })),
      );
      expect(r.status).toBe("completed");
      expect(r.terminatedAt).toBe(5000);
    });
    it("undefined role 正确处理", () => {
      const r = deserializeContract(
        serializeContract(makeContract({ sourceRole: undefined, targetRole: undefined })),
      );
      expect(r.sourceRole).toBeUndefined();
      expect(r.targetRole).toBeUndefined();
    });
  });
});

// ═════════════════════════════════════════════════════════
// §2  contract-lifecycle.ts
// ═════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════
// §3  transport-cost.ts
// ═════════════════════════════════════════════════════════

describe("transport-cost.ts", () => {
  describe("computeDistanceCost", () => {
    it("距离×权重", () => {
      expect(computeDistanceCost(5, 10)).toBe(50);
    });
    it("默认权重10", () => {
      expect(computeDistanceCost(3)).toBe(30);
    });
    it("零距离=0", () => {
      expect(computeDistanceCost(0)).toBe(0);
    });
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
        amount: 1000,
        linearDistance: 5,
        body: makeHaulerBody({ spawnCost: 250, capacity: 500 }),
        hasRoad: true,
        decayPerTrip: 10,
        haulerLifespan: 1000,
        distanceWeight: 10,
        costPerSpawnEnergy: 1,
        cpuTimeValue: 0.1,
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

// ═════════════════════════════════════════════════════════
// §5  contract-node-bridge.ts
// ═════════════════════════════════════════════════════════
