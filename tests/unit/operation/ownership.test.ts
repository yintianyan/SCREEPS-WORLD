/** A3-002: Room Economic Profile → Transferable 计算 */
import { describe, expect, it } from "vitest";
import {
  computeTransferable,
  computeTransferableBulk,
  computeSafetyReserve,
  computeRemainingDeficit,
} from "../../../src/domain/economy/ownership";
import type { RoomEconomicProfile } from "../../../src/domain/economy/room-profile";

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
    economyTick: 1000,
    storageEnergy: 50000,
    storageCapacity: 300000,
    storageRatio: 50000 / 300000,
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

describe("A3-002: computeTransferable", () => {
  it("正常 core 房间有正 transferable", () => {
    // 抬到 100000：原 fixture 的 50000 低于安全储备(60000)，这条顶着「有正
    // transferable」的标题断的是 0 —— 标题与断言相反，扣减口径写错也永远测不到。
    const profile = makeProfile({ storageEnergy: 100000, storageCapacity: 300000 });
    const result = computeTransferable(profile, 0);
    // 100000 - safetyReserve(max(300000*0.2, 5000)=60000) = 40000
    expect(result).toBe(40000);
  });

  it("水位低于安全储备时不调拨", () => {
    const profile = makeProfile(); // storageEnergy 50000 < safety 60000
    expect(computeTransferable(profile, 0)).toBe(0);
  });

  it("contractReserve 按生产恒等式装配时仍可正调拨", () => {
    // 生产中 contractReserve = storage + terminal + links（accounting.contractReserveOf），
    // 即 storageEnergy 是它的子集。曾经 computeTransferable 把它当对外债权再减一次，
    // 结果恒 ≤0 → 跨房调拨稳态零产出。而本文件旧 fixture 把两个字段脱钩
    // （contractReserve=5000 / storageEnergy=50000），所以这个恒 0 在测试里不可见。
    const storageEnergy = 200000;
    const profile = makeProfile({
      storageEnergy,
      storageCapacity: 300000,
      contractReserve: storageEnergy + 1000 + 500,
    });
    expect(computeTransferable(profile, 0)).toBe(140000);
  });

  it("高储备房有正 transferable", () => {
    const profile = makeProfile({ storageEnergy: 200000, storageCapacity: 300000 });
    const result = computeTransferable(profile, 0);
    // 200000 - 60000 = 140000
    expect(result).toBe(140000);
  });

  it("struggling 房间 transferable = 0", () => {
    const profile = makeProfile({ isStruggling: true, storageEnergy: 200000 });
    const result = computeTransferable(profile, 0);
    expect(result).toBe(0);
  });

  it("无 storage 房间 transferable = 0", () => {
    const profile = makeProfile({ hasStorage: false, storageEnergy: 0, storageCapacity: 0 });
    const result = computeTransferable(profile, 0);
    expect(result).toBe(0);
  });

  it("activeReservations 扣减可调拨量", () => {
    const profile = makeProfile({ storageEnergy: 200000, storageCapacity: 300000 });
    const result = computeTransferable(profile, 50000);
    // 200000 - 60000 - 50000 = 90000
    expect(result).toBe(90000);
  });
});

describe("A3-016: Safety Reserve Protection", () => {
  it("computeSafetyReserve 使用比例", () => {
    const result = computeSafetyReserve(300000, 0.2);
    expect(result).toBe(60000);
  });

  it("computeSafetyReserve 使用最低绝对值", () => {
    const result = computeSafetyReserve(10000, 0.2);
    // max(10000*0.2, 5000) = max(2000, 5000) = 5000
    expect(result).toBe(5000);
  });

  it("computeSafetyReserve 无 storage 为 0", () => {
    expect(computeSafetyReserve(0)).toBe(0);
  });

  it("不抽干：即使有大量 reservation，结果不为负", () => {
    const profile = makeProfile({ storageEnergy: 200000, storageCapacity: 300000 });
    const result = computeTransferable(profile, 200000);
    // 200000 - 60000 - 200000 = -60000 → max(0, -60000) = 0
    expect(result).toBe(0);
  });
});

describe("computeTransferableBulk", () => {
  it("批量计算各房可调拨量", () => {
    const profiles = [
      makeProfile({ roomName: "W1N1", storageEnergy: 200000 }),
      makeProfile({ roomName: "W2N1", storageEnergy: 50000 }),
    ];
    const reservations = new Map([["W1N1", 30000]]);
    const result = computeTransferableBulk(profiles, reservations);
    // W1N1: 200000 - 60000 - 30000 = 110000
    expect(result.get("W1N1")).toBe(110000);
    // W2N1: 50000 - 60000 = -10000 → 0
    expect(result.get("W2N1")).toBe(0);
  });
});

describe("computeRemainingDeficit", () => {
  it("正常计算剩余缺口", () => {
    expect(computeRemainingDeficit(2000, 500)).toBe(1500);
  });

  it("已在途量超过缺口时返回 0", () => {
    expect(computeRemainingDeficit(2000, 3000)).toBe(0);
  });
});
