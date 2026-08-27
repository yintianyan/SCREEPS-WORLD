/** Capacity Model + Empire Resource View 单测 */
import { describe, it, expect } from "vitest";
import {
  buildRoomCapacityProfile,
  type RoomCapacityProfile,
} from "../../../src/domain/economy/capacity-profile";
import type { RoomEconomicProfile } from "../../../src/domain/economy/room-profile";
import { NOMINAL_INCOME_PER_SOURCE } from "../../../src/domain/economy/accounting";
import {
  buildEmpireResourceView,
} from "../../../src/domain/strategy/resource-view";

// ─── 辅助 ─────────────────────────────────────────────────

function makeProfile(over?: Partial<RoomEconomicProfile>): RoomEconomicProfile {
  return {
    roomName: "W7N4",
    rcl: 7, hasSpawn: true, hasStorage: true, hasTerminal: true,
    netFlow: 5, contractReserve: 50000, riskBuffer: 1000,
    estimatedIncome: 14, efficiency: 0.7, drift: 0, economyTick: 1000,
    storageEnergy: 50000, storageCapacity: 1_000_000, storageRatio: 0.5,
    energyAvailable: 500, energyCapacityAvailable: 1000,
    storageNearFull: false, sourceCount: 2,
    colonyPhase: "growth", colonyState: "normal",
    economyPressure: 0.1, lastHostileAt: undefined, hasLiveThreat: false,
    controllerDowngradeRisk: false, claimSecure: false,
    economicClass: "core", netFlowPositive: true,
    selfSufficiency: 0.64, isStruggling: false,
    ...over,
  };
}

// ─── Capacity Model ───────────────────────────────────────

describe("buildRoomCapacityProfile", () => {
  it("完整组装：2 source + storage + 正净流", () => {
    const p = makeProfile();
    const cap = buildRoomCapacityProfile(p, 3, 2, 30000, 2000, 1, 300);

    expect(cap.roomName).toBe("W7N4");
    expect(cap.sourceCount).toBe(2);
    expect(cap.nominalCapacity).toBe(2 * NOMINAL_INCOME_PER_SOURCE);
    expect(cap.efficiency).toBeCloseTo(0.7, 5);
    expect(cap.effectiveCapacity).toBe(14);
    expect(cap.utilization).toBeCloseTo(0.7, 5);

    expect(cap.storageCapacity).toBe(1_000_000);
    expect(cap.terminalCapacity).toBe(30000);
    expect(cap.linkCapacity).toBe(2000);
    expect(cap.totalReserveCapacity).toBe(1_032_000);
    expect(cap.reserveUtilization).toBeCloseTo(50000 / 1_032_000, 5);

    expect(cap.spawnCapacity).toBe(1000);
    expect(cap.spawnUtilization).toBeCloseTo(0.5, 5);
    expect(cap.spawnCount).toBe(1);

    expect(cap.haulerCount).toBe(3);
    expect(cap.referenceCarry).toBe(300);
    expect(cap.logisticsThroughput).toBe(Math.round(900 / 50));
    expect(cap.builderCount).toBe(2);
    expect(cap.constructionThroughput).toBe(100);

    // efficiency=0.7 >= 0.5 → 不是 production 瓶颈
    // reserveUtilization < 0.9 → 不是 storage 瓶颈
    // spawnUtilization=0.5 >= 0.2 → 不是 spawn 瓶颈
    // logisticsThroughput=18 >= effectiveCapacity=14 → 不是 logistics 瓶颈
    // constructionThroughput=100 >= 14 → 不是 construction 瓶颈
    expect(cap.bottleneck).toBe("none");
  });

  it("效率低 → production 瓶颈", () => {
    const p = makeProfile({ efficiency: 0.3, estimatedIncome: 6 });
    const cap = buildRoomCapacityProfile(p, 3, 2, 30000, 2000, 1, 300);
    expect(cap.bottleneck).toBe("production");
  });

  it("储备满 → storage 瓶颈", () => {
    const p = makeProfile({
      contractReserve: 950000,
      storageCapacity: 1_000_000,
      efficiency: 0.7,
    });
    const cap = buildRoomCapacityProfile(p, 3, 2, 0, 0, 1, 300);
    expect(cap.reserveUtilization).toBeCloseTo(0.95, 2);
    expect(cap.bottleneck).toBe("storage");
  });

  it("spawn 空 → spawn 瓶颈", () => {
    const p = makeProfile({
      energyAvailable: 100,
      energyCapacityAvailable: 1000,
      efficiency: 0.7,
    });
    const cap = buildRoomCapacityProfile(p, 3, 2, 30000, 2000, 1, 300);
    expect(cap.spawnUtilization).toBeCloseTo(0.1, 2);
    expect(cap.bottleneck).toBe("spawn");
  });

  it("物流不足 → logistics 瓶颈", () => {
    const p = makeProfile({ efficiency: 0.7, estimatedIncome: 14 });
    // haulerCount=0 → logisticsThroughput=0 < 14
    const cap = buildRoomCapacityProfile(p, 0, 2, 30000, 2000, 1, 300);
    expect(cap.bottleneck).toBe("logistics");
  });

  it("建造不足 → construction 瓶颈", () => {
    const p = makeProfile({ efficiency: 0.7, estimatedIncome: 14 });
    // haulerCount=3 → logistics=18 >= 14, builderCount=0 → construction=0 < 14
    const cap = buildRoomCapacityProfile(p, 3, 0, 30000, 2000, 1, 300);
    expect(cap.bottleneck).toBe("construction");
  });

  it("无 source → nominalCapacity=0, utilization=0", () => {
    const p = makeProfile({ sourceCount: 0, estimatedIncome: 0, efficiency: 0 });
    const cap = buildRoomCapacityProfile(p, 1, 1, 0, 0, 1, 300);
    expect(cap.nominalCapacity).toBe(0);
    expect(cap.utilization).toBe(0);
    expect(cap.bottleneck).toBe("none");
  });
});

// ─── Empire Resource View ─────────────────────────────────

describe("buildEmpireResourceView", () => {
  it("空数组 → 安全默认值", () => {
    const v = buildEmpireResourceView([], 1000);
    expect(v.roomCount).toBe(0);
    expect(v.totalEnergy).toBe(0);
    expect(v.totalNetFlow).toBe(0);
    expect(v.empireNetFlowPositive).toBe(false);
    expect(v.empireSelfSufficiency).toBe(0);
    expect(v.surplusRooms).toHaveLength(0);
    expect(v.deficitRooms).toHaveLength(0);
    expect(v.hasImbalance).toBe(false);
    expect(v.minRiskBuffer).toBe(0);
  });

  it("单房 core → 聚合正确", () => {
    const p = makeProfile();
    const v = buildEmpireResourceView([p], 1000);
    expect(v.roomCount).toBe(1);
    expect(v.totalEnergy).toBe(50000);
    expect(v.totalProduction).toBe(14);
    expect(v.totalNetFlow).toBe(5);
    expect(v.totalReserve).toBe(50000);
    expect(v.minRiskBuffer).toBe(1000);
    expect(v.avgEfficiency).toBeCloseTo(0.7, 5);
    expect(v.coreRooms).toBe(1);
    expect(v.empireNetFlowPositive).toBe(true);
    expect(v.hasStruggling).toBe(false);
  });

  it("多房混合分类", () => {
    const core = makeProfile({ roomName: "core1", economicClass: "core" });
    const prod = makeProfile({
      roomName: "prod1", rcl: 5,
      economicClass: "production",
      netFlow: 2, estimatedIncome: 10,
    });
    const cand = makeProfile({
      roomName: "cand1", rcl: 2, hasStorage: false,
      storageEnergy: 0, storageCapacity: 0, storageRatio: 0,
      economicClass: "candidate",
      netFlow: 0, estimatedIncome: 5, contractReserve: 200,
      riskBuffer: 0,
    });
    const strug = makeProfile({
      roomName: "strug1", rcl: 7,
      colonyState: "recovery", economicClass: "struggling",
      netFlow: -3, estimatedIncome: 8, economyPressure: 0.8,
      isStruggling: true, netFlowPositive: false,
    });

    const v = buildEmpireResourceView([core, prod, cand, strug], 1000);

    expect(v.roomCount).toBe(4);
    expect(v.coreRooms).toBe(1);
    expect(v.productionRooms).toBe(1);
    expect(v.candidateRooms).toBe(1);
    expect(v.strugglingRooms).toBe(1);
    expect(v.hasStruggling).toBe(true);
    expect(v.maxPressure).toBeCloseTo(0.8, 2);
    expect(v.totalNetFlow).toBe(5 + 2 + 0 - 3); // 4
    expect(v.empireNetFlowPositive).toBe(true);
    expect(v.minRiskBuffer).toBe(0); // cand 的 riskBuffer=0
  });

  it("surplus + deficit 同时存在 → hasImbalance=true", () => {
    // surplus: core + netFlow+ + storageRatio 0.5
    const surplus = makeProfile({ roomName: "surplus1" });
    // deficit: struggling → needsEnergyAid=true
    const deficit = makeProfile({
      roomName: "deficit1",
      colonyState: "recovery", economicClass: "struggling",
      isStruggling: true, netFlowPositive: false,
    });

    const v = buildEmpireResourceView([surplus, deficit], 1000);

    expect(v.surplusRooms).toContain("surplus1");
    expect(v.deficitRooms).toContain("deficit1");
    expect(v.hasImbalance).toBe(true);
  });

  it("只有 surplus 无 deficit → hasImbalance=false", () => {
    const p = makeProfile({ roomName: "r1" });
    const v = buildEmpireResourceView([p], 1000);
    expect(v.surplusRooms).toContain("r1");
    expect(v.deficitRooms).toHaveLength(0);
    expect(v.hasImbalance).toBe(false);
  });

  it("hasLiveThreat 传递", () => {
    const safe = makeProfile({ roomName: "safe" });
    const threat = makeProfile({
      roomName: "threat1",
      hasLiveThreat: true,
      colonyState: "defense",
      economicClass: "struggling",
      isStruggling: true,
    });
    const v = buildEmpireResourceView([safe, threat], 1000);
    expect(v.hasLiveThreat).toBe(true);
  });

  it("empireSelfSufficiency：净流接近 0 → 高自给度", () => {
    const p = makeProfile({ netFlow: 0, estimatedIncome: 14 });
    const v = buildEmpireResourceView([p], 1000);
    expect(v.empireSelfSufficiency).toBeCloseTo(1, 5);
  });

  it("empireSelfSufficiency：净流远偏离 0 → 低自给度", () => {
    const p = makeProfile({ netFlow: 14, estimatedIncome: 14 });
    const v = buildEmpireResourceView([p], 1000);
    expect(v.empireSelfSufficiency).toBeCloseTo(0, 5);
  });

  it("avgEfficiency 排除 estimatedIncome=0 + efficiency=0 的房", () => {
    const healthy = makeProfile({ efficiency: 0.7 });
    const dead = makeProfile({ efficiency: 0, estimatedIncome: 0 });
    const v = buildEmpireResourceView([healthy, dead], 1000);
    // 只 healthy 计入：0.7 / 1 = 0.7
    expect(v.avgEfficiency).toBeCloseTo(0.7, 5);
  });
});
