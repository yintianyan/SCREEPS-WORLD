/** Room Economic Contract 单测 */
import { describe, it, expect } from "vitest";
import {
  classifyRoomEconomic,
  computeSelfSufficiency,
  buildRoomEconomicProfile,
  canExportEnergy,
  needsEnergyAid,
  type RoomEconomicProfile,
  type RoomEconomicMemory,
} from "../../../src/domain/economy/room-profile";
import type { EconomyQueryInput } from "../../../src/domain/economy/room-profile";
import { mockSnapshot, mockStore, mockSource } from "../../role-helpers";

// ─── 辅助构造器 ─────────────────────────────────────────────

function makeEconomy(over?: Partial<EconomyQueryInput>): EconomyQueryInput {
  return {
    tick: 1000,
    netFlow: 5,
    contractReserve: 30000,
    riskBuffer: 600,
    drift: 0,
    estimatedIncome: 14,
    efficiency: 0.7,
    ...over,
  };
}

function makeRoomMem(over?: Partial<RoomEconomicMemory>): RoomEconomicMemory {
  return {
    colonyState: "normal",
    economyPressure: 0.2,
    lastHostileAt: undefined,
    controllerDowngradeRisk: false,
    claimSecure: false,
    storageNearFull: false,
    phase: {
      phase: "growth",
      reserve: 30000,
      reserveDelta: 100,
      drainScore: 0,
      liquidityScore: 0,
      harvesterCount: 2,
      sourceCount: 2,
      rcl: 6,
    },
    economy: {
      t: 1000, nf: 500, cr: 30000, rb: 6000, dr: 0, ei: 140, ef: 70,
    },
    ...over,
  };
}

function makeStorageMock(used: number, capacity = 1_000_000) {
  return {
    store: mockStore(used, capacity),
    pos: { x: 25, y: 25, roomName: "W7N4" },
  } as any;
}

// ─── classifyRoomEconomic ──────────────────────────────────

describe("classifyRoomEconomic", () => {
  it("RCL≥6 + storage + normal → core", () => {
    expect(classifyRoomEconomic(6, true, "normal")).toBe("core");
    expect(classifyRoomEconomic(8, true, "normal")).toBe("core");
  });

  it("RCL4-5 + storage + normal → production", () => {
    expect(classifyRoomEconomic(4, true, "normal")).toBe("production");
    expect(classifyRoomEconomic(5, true, "normal")).toBe("production");
  });

  it("RCL<4 或无 storage → candidate", () => {
    expect(classifyRoomEconomic(3, false, "normal")).toBe("candidate");
    expect(classifyRoomEconomic(3, true, "normal")).toBe("candidate");
    expect(classifyRoomEconomic(1, false, "normal")).toBe("candidate");
  });

  it("colonyState 为 bootstrap/recovery/defense → struggling（最高优先级）", () => {
    expect(classifyRoomEconomic(8, true, "bootstrap")).toBe("struggling");
    expect(classifyRoomEconomic(8, true, "recovery")).toBe("struggling");
    expect(classifyRoomEconomic(8, true, "defense")).toBe("struggling");
    // 即使 RCL 低也是 struggling（优先级高于 candidate）
    expect(classifyRoomEconomic(2, false, "recovery")).toBe("struggling");
  });
});

// ─── computeSelfSufficiency ────────────────────────────────

describe("computeSelfSufficiency", () => {
  it("净流接近 0 → 自给度高", () => {
    expect(computeSelfSufficiency(0, 14)).toBeCloseTo(1, 5);
    expect(computeSelfSufficiency(0.1, 14)).toBeGreaterThan(0.99);
  });

  it("净流远偏离 0 → 自给度低", () => {
    expect(computeSelfSufficiency(14, 14)).toBeCloseTo(0, 5);
    expect(computeSelfSufficiency(-14, 14)).toBeCloseTo(0, 5);
  });

  it("estimatedIncome ≤ 0 → 自给度为 0", () => {
    expect(computeSelfSufficiency(0, 0)).toBe(0);
    expect(computeSelfSufficiency(5, 0)).toBe(0);
    expect(computeSelfSufficiency(5, -1)).toBe(0);
  });

  it("clamp 到 [0,1] 区间", () => {
    // 超大净流也不超界
    expect(computeSelfSufficiency(100, 14)).toBe(0);
    expect(computeSelfSufficiency(-100, 14)).toBe(0);
  });
});

// ─── buildRoomEconomicProfile ─────────────────────────────

describe("buildRoomEconomicProfile", () => {
  it("组装完整 Profile：RCL6 + storage + 正净流", () => {
    const snap = mockSnapshot({
      rcl: 6,
      spawns: [{} as never],
      storage: makeStorageMock(50000),
      sources: [mockSource("s1"), mockSource("s2")],
    });
    const mem = makeRoomMem();
    const econ = makeEconomy({ netFlow: 5, estimatedIncome: 14 });

    const p = buildRoomEconomicProfile(snap, mem, econ, 1000);

    expect(p.roomName).toBe("W7N4");
    expect(p.rcl).toBe(6);
    expect(p.hasSpawn).toBe(true);
    expect(p.hasStorage).toBe(true);
    expect(p.hasTerminal).toBe(false);

    // Economy 三指标
    expect(p.netFlow).toBe(5);
    expect(p.contractReserve).toBe(30000);
    expect(p.riskBuffer).toBe(600);
    expect(p.estimatedIncome).toBe(14);
    expect(p.efficiency).toBeCloseTo(0.7, 5);
    expect(p.economyTick).toBe(1000);

    // 储备
    expect(p.storageEnergy).toBe(50000);
    expect(p.storageCapacity).toBe(1_000_000);
    expect(p.storageRatio).toBeCloseTo(0.05, 5);
    expect(p.sourceCount).toBe(2);

    // 派生
    expect(p.economicClass).toBe("core");
    expect(p.netFlowPositive).toBe(true);
    expect(p.isStruggling).toBe(false);
    expect(p.selfSufficiency).toBeGreaterThan(0.6);
  });

  it("无 storage 房间 → candidate 分类 + storageRatio=0", () => {
    const snap = mockSnapshot({ rcl: 2, storage: undefined });
    const mem = makeRoomMem({
      colonyState: "normal",
      phase: { phase: "growth", reserve: 500, reserveDelta: 10, drainScore: 0, liquidityScore: 0, harvesterCount: 1, sourceCount: 1, rcl: 2 },
    });
    const econ = makeEconomy({ netFlow: 2, estimatedIncome: 10 });

    const p = buildRoomEconomicProfile(snap, mem, econ, 1000);

    expect(p.hasStorage).toBe(false);
    expect(p.storageEnergy).toBe(0);
    expect(p.storageCapacity).toBe(0);
    expect(p.storageRatio).toBe(0);
    expect(p.economicClass).toBe("candidate");
  });

  it("recovery 态房间 → struggling 分类 + isStruggling=true", () => {
    const snap = mockSnapshot({ rcl: 7, storage: makeStorageMock(1000) });
    const mem = makeRoomMem({
      colonyState: "recovery",
      economyPressure: 0.8,
      phase: { phase: "recovery", reserve: 1000, reserveDelta: -50, drainScore: 100, liquidityScore: 0, harvesterCount: 1, sourceCount: 2, rcl: 7 },
    });
    const econ = makeEconomy({ netFlow: -3, estimatedIncome: 10 });

    const p = buildRoomEconomicProfile(snap, mem, econ, 1000);

    expect(p.economicClass).toBe("struggling");
    expect(p.isStruggling).toBe(true);
    expect(p.netFlowPositive).toBe(false);
  });

  it("有 live threat → hasLiveThreat=true", () => {
    const snap = mockSnapshot({
      rcl: 6,
      storage: makeStorageMock(50000),
      threatCreeps: [{ id: "h1", owner: { username: "enemy" } } as never],
    });
    const mem = makeRoomMem({ colonyState: "defense", lastHostileAt: 1000 });
    const econ = makeEconomy();

    const p = buildRoomEconomicProfile(snap, mem, econ, 1000);

    expect(p.hasLiveThreat).toBe(true);
    expect(p.colonyState).toBe("defense");
    expect(p.isStruggling).toBe(true);
  });

  it("economy 为 undefined → 三指标回退为 0", () => {
    const snap = mockSnapshot({ rcl: 4, storage: makeStorageMock(5000) });
    const mem = makeRoomMem();
    const econ = undefined;

    const p = buildRoomEconomicProfile(snap, mem, econ, 1000);

    expect(p.netFlow).toBe(0);
    expect(p.contractReserve).toBe(0);
    expect(p.riskBuffer).toBe(0);
    expect(p.estimatedIncome).toBe(0);
    expect(p.efficiency).toBe(0);
    expect(p.economyTick).toBe(0);
    expect(p.netFlowPositive).toBe(false);
    expect(p.selfSufficiency).toBe(0);
  });

  it("storageNearFull 从 RoomMemory 透传", () => {
    const snap = mockSnapshot({ rcl: 8, storage: makeStorageMock(950000) });
    const mem = makeRoomMem({ storageNearFull: true });
    const econ = makeEconomy();

    const p = buildRoomEconomicProfile(snap, mem, econ, 1000);

    expect(p.storageNearFull).toBe(true);
    expect(p.storageRatio).toBeCloseTo(0.95, 2);
  });
});

// ─── canExportEnergy ───────────────────────────────────────

describe("canExportEnergy", () => {
  function profile(over?: Partial<RoomEconomicProfile>): RoomEconomicProfile {
    return {
      roomName: "W7N4",
      rcl: 7, hasSpawn: true, hasStorage: true, hasTerminal: true,
      netFlow: 5, contractReserve: 50000, riskBuffer: 1000,
      estimatedIncome: 14, efficiency: 0.7, drift: 0, economyTick: 1000,
      storageEnergy: 50000, storageCapacity: 1_000_000, storageRatio: 0.5,
      energyAvailable: 500, energyCapacityAvailable: 800,
      storageNearFull: false, sourceCount: 2,
      colonyPhase: "growth", colonyState: "normal",
      economyPressure: 0.1, lastHostileAt: undefined, hasLiveThreat: false,
      controllerDowngradeRisk: false, claimSecure: false,
      economicClass: "core", netFlowPositive: true,
      selfSufficiency: 0.64, isStruggling: false,
      ...over,
    };
  }

  it("正常 core 房 → true", () => {
    expect(canExportEnergy(profile())).toBe(true);
  });

  it("困难态 → false", () => {
    expect(canExportEnergy(profile({ isStruggling: true }))).toBe(false);
  });

  it("无 storage → false", () => {
    expect(canExportEnergy(profile({ hasStorage: false }))).toBe(false);
  });

  it("净流为负 → false", () => {
    expect(canExportEnergy(profile({ netFlowPositive: false }))).toBe(false);
  });

  it("storage 水位 < 0.3 → false", () => {
    expect(canExportEnergy(profile({ storageRatio: 0.2 }))).toBe(false);
  });

  it("storage 水位 = 0.3 → true（边界）", () => {
    expect(canExportEnergy(profile({ storageRatio: 0.3 }))).toBe(true);
  });
});

// ─── needsEnergyAid ────────────────────────────────────────

describe("needsEnergyAid", () => {
  function profile(over?: Partial<RoomEconomicProfile>): RoomEconomicProfile {
    return {
      roomName: "W7N4",
      rcl: 6, hasSpawn: true, hasStorage: true, hasTerminal: false,
      netFlow: 5, contractReserve: 30000, riskBuffer: 600,
      estimatedIncome: 14, efficiency: 0.7, drift: 0, economyTick: 1000,
      storageEnergy: 30000, storageCapacity: 1_000_000, storageRatio: 0.3,
      energyAvailable: 500, energyCapacityAvailable: 800,
      storageNearFull: false, sourceCount: 2,
      colonyPhase: "growth", colonyState: "normal",
      economyPressure: 0.1, lastHostileAt: undefined, hasLiveThreat: false,
      controllerDowngradeRisk: false, claimSecure: false,
      economicClass: "core", netFlowPositive: true,
      selfSufficiency: 0.64, isStruggling: false,
      ...over,
    };
  }

  it("正常 core 房 → false", () => {
    expect(needsEnergyAid(profile())).toBe(false);
  });

  it("困难态 → true", () => {
    expect(needsEnergyAid(profile({ isStruggling: true }))).toBe(true);
  });

  it("净流为负 + riskBuffer < 400 → true", () => {
    expect(needsEnergyAid(profile({
      netFlowPositive: false,
      riskBuffer: 300,
    }))).toBe(true);
  });

  it("净流为负 + riskBuffer ≥ 400 → false（缓冲足够）", () => {
    expect(needsEnergyAid(profile({
      netFlowPositive: false,
      riskBuffer: 500,
    }))).toBe(false);
  });

  it("storageRatio < 0.1 + estimatedIncome < 5 → true", () => {
    expect(needsEnergyAid(profile({
      storageRatio: 0.05,
      estimatedIncome: 3,
    }))).toBe(true);
  });

  it("storageRatio < 0.1 但 estimatedIncome ≥ 5 → false（有产能）", () => {
    expect(needsEnergyAid(profile({
      storageRatio: 0.05,
      estimatedIncome: 8,
    }))).toBe(false);
  });
});
