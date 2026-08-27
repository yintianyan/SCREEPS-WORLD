/** Factory Manager commodity 集成测试（审计缺口 6 执行层）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { factoryManagerSystem } from "../../../src/systems/factory-manager";
import { mockBudget, mockSnapshot, resetGlobals } from "../../role-helpers";

/** 多资源 store mock（键值映射 + 容量方法）。 */
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

beforeEach(() => {
  resetGlobals();
  // T1 wire（U 10 + energy 30）+ T2 circuit（wire 10 + X 10 + energy 100，level 1）。
  (globalThis as any).COMMODITIES = {
    wire: { level: 0, components: { U: 10, energy: 30 } },
    circuit: { level: 1, components: { wire: 10, X: 10, energy: 100 } },
    battery: { level: 0, components: { energy: 600 } },
    // 原料类（无 components）应被跳过。
    U: { level: 0, amount: 1 },
  };
  (globalThis as any).Memory = { rooms: {}, kernel: {} };
});

describe("factory-manager — commodity 升级链", () => {
  it("factory 内原料齐 → produce 目标 + 写 globalCache 锚", () => {
    // energy 6000 - 储备地板 5000 = 1000 ≥ 配方 30。
    const factory = factoryMock({ U: 10, energy: 6000 });
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("wire");
  });

  it("T2 原料齐且 level 达标 → 优先产 T2", () => {
    const factory = factoryMock({ wire: 10, X: 10, energy: 6000 }, 1);
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("circuit");
  });

  it("factory 原料不齐但 storage+factory 合计齐 → 不 produce（等 distributor 补料）但写锚", () => {
    const factory = factoryMock({ U: 5, energy: 6000 });
    const storage = { store: multiStore({ U: 5 }) } as any;
    const snap = mockSnapshot({ roomName: "W7N4", factory, storage });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).not.toHaveBeenCalled();
  });

  it("无 COMMODITIES（私服/旧环境）→ 静默跳过不炸", () => {
    delete (globalThis as any).COMMODITIES;
    const factory = factoryMock({ U: 10, energy: 6000 });
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    expect(() => factoryManagerSystem.run(makeContext(snap))).not.toThrow();
    expect(factory.produce).not.toHaveBeenCalled();
  });

  it("battery 满仓压缩链无回归：storageNearFull + 能量足 → produce battery", () => {
    // commodity 链因 U 不足不产；满仓信号触发压缩链。
    (globalThis as any).Memory.rooms["W7N4"] = { storageNearFull: true };
    const factory = factoryMock({ energy: 600 });
    const snap = mockSnapshot({ roomName: "W7N4", factory });

    factoryManagerSystem.run(makeContext(snap));

    expect(factory.produce).toHaveBeenCalledWith("battery");
  });
});
