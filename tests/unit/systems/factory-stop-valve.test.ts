/** Phase C：factory-manager 停止阀（commodity 无出口/产物上限、battery 压缩上限）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { factoryManagerSystem } from "../../../src/systems/room/factory-manager";
import { globalCache } from "../../../src/kernel/global-cache";
import { mockBudget, mockSnapshot, resetGlobals } from "../../support/factories";

function multiStore(resources: Record<string, number>): any {
  return {
    ...resources,
    getUsedCapacity: vi.fn((r?: string) => (r ? (resources[r] ?? 0) : 0)),
    getFreeCapacity: vi.fn(() => 50000),
  };
}

function factoryMock(resources: Record<string, number>, level = 0): any {
  return {
    cooldown: 0,
    level,
    store: multiStore(resources),
    produce: vi.fn(() => OK),
  };
}

function makeContext(snapshot: any): any {
  return {
    tick: (globalThis as any).Game.time,
    budget: mockBudget("healthy"),
    globalSiteCount: 0,
    getSnapshot: vi.fn(() => snapshot),
    snapshots: vi.fn(function* () {
      yield snapshot;
    }),
  };
}

/** 写入新鲜订单缓存；不传 orders 表示「缓存新鲜但无买单」。 */
function marketCache(
  orders: Record<string, { id: string; price: number; amount: number; roomName: string }[]> = {},
): void {
  globalCache().marketOrderCache = { tick: (globalThis as any).Game.time, orders };
}

function exportNeed(roomName: string, resource: string, amount = 5000): void {
  globalCache().exportNeeds = {
    tick: (globalThis as any).Game.time,
    byRoom: {
      [roomName]: [
        {
          resource,
          amount,
          deadline: (globalThis as any).Game.time + 400,
        },
      ],
    },
  };
}

beforeEach(() => {
  resetGlobals();
  (globalThis as any).COMMODITIES = {
    wire: { level: 0, components: { U: 10, energy: 30 } },
    battery: { level: 0, components: { energy: 600 } },
    U: { level: 0, amount: 1 },
  };
  (globalThis as any).Memory = { rooms: {}, kernel: {} };
});

describe("factory-manager — commodity 停止阀", () => {
  it("缓存新鲜但无买盘 → 不 produce、清掉 factoryTargets 锚", () => {
    marketCache();
    const factory = factoryMock({ U: 10, energy: 6000 });
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).not.toHaveBeenCalled();
    expect(globalCache().factoryTargets?.["W7N4"]).toBeUndefined();
  });

  it("有真实买盘 → 正常 produce（控制组）", () => {
    marketCache({
      "buy/wire": [{ id: "w1", price: 10, amount: 1000, roomName: "W1N1" }],
    });
    const factory = factoryMock({ U: 10, energy: 6000 });
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("wire");
  });

  it("有跨房出口票（无买盘）→ 正常 produce", () => {
    marketCache();
    exportNeed("W7N4", "wire");
    const factory = factoryMock({ U: 10, energy: 6000 });
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("wire");
  });

  it("产物库存达到高水位（30K）→ 停止生产", () => {
    marketCache({
      "buy/wire": [{ id: "w1", price: 10, amount: 1000, roomName: "W1N1" }],
    });
    const factory = factoryMock({ U: 10, energy: 6000 });
    const storage = { store: multiStore({ wire: 30000 }) } as any;
    const snap = mockSnapshot({ roomName: "W7N4", factory, storage });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).not.toHaveBeenCalled();
  });

  it("缓存缺失/过期 → unknown，保持旧行为（不拦）", () => {
    const factory = factoryMock({ U: 10, energy: 6000 });
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("wire");
  });
});

describe("factory-manager — battery 压缩停止阀", () => {
  it("battery 总量达到硬上限 150K → 无条件停止压缩", () => {
    (globalThis as any).Memory.rooms["W7N4"] = { storageNearFull: true };
    const factory = factoryMock({ energy: 600 });
    const storage = { store: multiStore({ battery: 150000 }) } as any;
    const snap = mockSnapshot({ roomName: "W7N4", factory, storage });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).not.toHaveBeenCalled();
  });

  it("battery 总量 ≥ 软上限 100K 且明确无出口 → 停止压缩", () => {
    (globalThis as any).Memory.rooms["W7N4"] = { storageNearFull: true };
    marketCache();
    const factory = factoryMock({ energy: 600 });
    const storage = { store: multiStore({ battery: 120000 }) } as any;
    const snap = mockSnapshot({ roomName: "W7N4", factory, storage });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).not.toHaveBeenCalled();
  });

  it("battery 总量 ≥ 软上限但有真实买盘 → 允许压缩（控制组）", () => {
    (globalThis as any).Memory.rooms["W7N4"] = { storageNearFull: true };
    marketCache({
      "buy/battery": [{ id: "b1", price: 1, amount: 10000, roomName: "W1N1" }],
    });
    const factory = factoryMock({ energy: 600 });
    const storage = { store: multiStore({ battery: 120000 }) } as any;
    const snap = mockSnapshot({ roomName: "W7N4", factory, storage });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("battery");
  });
});
