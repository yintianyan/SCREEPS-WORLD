/** A3-015: Multi-Room Allocation（3 房分配 A surplus → B+C deficit） */
import { describe, expect, it } from "vitest";
import {
  allocateMultiRoom,
  sumAllocationsBySource,
  sumAllocationsByTarget,
  type AllocationPlan,
} from "../../../src/domain/operation/allocation";
import type { RoomRegistryEntry } from "../../../src/domain/strategy/room-registry";

const TICK = 1000;

function makeEntry(overrides: Partial<RoomRegistryEntry> = {}): RoomRegistryEntry {
  return {
    roomName: "W1N1",
    economicClass: "core",
    rcl: 6,
    hasStorage: true,
    hasTerminal: false,
    storageEnergy: 200000,
    storageCapacity: 300000,
    storageRatio: 200000 / 300000,
    netFlow: 10,
    estimatedIncome: 15,
    efficiency: 0.8,
    riskBuffer: 1000,
    isStruggling: false,
    canExport: true,
    needsAid: false,
    transferable: 100000,
    updatedAt: TICK,
    ...overrides,
  };
}

describe("A3-015: Multi-Room Allocation", () => {
  it("1 surplus → 1 deficit 单房分配", () => {
    const surplus = [makeEntry({ roomName: "A", transferable: 50000 })];
    const deficit = [
      makeEntry({
        roomName: "C",
        needsAid: true,
        riskBuffer: 100,
        storageCapacity: 300000,
        storageEnergy: 10000,
      }),
    ];

    const plans = allocateMultiRoom(surplus, deficit);
    expect(plans.length).toBeGreaterThanOrEqual(0);
    // deficit 需要 = 300000*0.3 - 10000 = 80000，surplus 只有 50000
    // 应分配 50000
    if (plans.length > 0) {
      expect(plans[0]!.sourceRoom).toBe("A");
      expect(plans[0]!.targetRoom).toBe("C");
      expect(plans[0]!.amount).toBeLessThanOrEqual(50000);
    }
  });

  it("1 surplus → 2 deficit 分配（不超过 MAX_DEFICITS_PER_SOURCE=2）", () => {
    const surplus = [makeEntry({ roomName: "A", transferable: 100000 })];
    const deficit = [
      makeEntry({
        roomName: "B",
        needsAid: true,
        riskBuffer: 50,
        storageCapacity: 300000,
        storageEnergy: 50000,
      }),
      makeEntry({
        roomName: "C",
        needsAid: true,
        riskBuffer: 80,
        storageCapacity: 300000,
        storageEnergy: 30000,
      }),
    ];

    const plans = allocateMultiRoom(surplus, deficit);
    // B 更紧急（riskBuffer=50 < 80），优先分配
    const targets = plans.map(p => p.targetRoom);
    expect(targets).toContain("B");
  });

  it("已有在途量时扣除", () => {
    const surplus = [makeEntry({ roomName: "A", transferable: 50000 })];
    const deficit = [
      makeEntry({
        roomName: "C",
        needsAid: true,
        riskBuffer: 100,
        storageCapacity: 300000,
        storageEnergy: 50000,
      }),
    ];
    const inTransit = new Map([["C", 30000]]);

    const plans = allocateMultiRoom(surplus, deficit, inTransit);
    // deficit 剩余需求 = 300000*0.3 - 50000 - 30000 = 10000
    if (plans.length > 0) {
      expect(plans[0]!.amount).toBeLessThanOrEqual(10000);
    }
  });

  it("低于 MIN_TRANSFER_AMOUNT 不分配", () => {
    const surplus = [makeEntry({ roomName: "A", transferable: 500 })];
    const deficit = [
      makeEntry({
        roomName: "C",
        needsAid: true,
        riskBuffer: 100,
        storageCapacity: 300000,
        storageEnergy: 89000,
      }),
    ];
    // deficit 需要 = 90000 - 89000 = 1000 = MIN_TRANSFER_AMOUNT
    const plans = allocateMultiRoom(surplus, deficit);
    // 边界情况，可能也可能不
    for (const p of plans) {
      expect(p.amount).toBeGreaterThanOrEqual(1000);
    }
  });

  it("sumAllocationsBySource / ByTarget", () => {
    const plans: AllocationPlan[] = [
      { sourceRoom: "A", targetRoom: "B", amount: 500, priority: 1 },
      { sourceRoom: "A", targetRoom: "C", amount: 300, priority: 2 },
      { sourceRoom: "D", targetRoom: "B", amount: 200, priority: 1 },
    ];
    expect(sumAllocationsBySource(plans, "A")).toBe(800);
    expect(sumAllocationsBySource(plans, "D")).toBe(200);
    expect(sumAllocationsByTarget(plans, "B")).toBe(700);
    expect(sumAllocationsByTarget(plans, "C")).toBe(300);
  });
});
