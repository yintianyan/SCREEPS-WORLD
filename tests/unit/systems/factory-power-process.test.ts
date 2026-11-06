/** factory-manager processPower 接线测试 — 调度门禁（domain/economy/power-processing） */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { factoryManagerSystem } from "../../../src/systems/room/factory-manager";
import { CONFIG } from "../../../src/config";
import { mockBudget, mockSnapshot, resetGlobals } from "../../support/factories";

/** 资源感知 store mock（方法不可枚举，与引擎 store 语义一致）。 */
function resStore(resources: Record<string, number>, _capacity = 5000): any {
  const store: Record<string, number> = { ...resources };
  const total = Object.values(resources).reduce((a, b) => a + b, 0);
  Object.defineProperty(store, "getUsedCapacity", {
    enumerable: false,
    value: (r?: string) => (r ? (resources[r] ?? 0) : total),
  });
  return store;
}

function makeCtx(snapshots: any[]): any {
  const map: Record<string, any> = {};
  for (const s of snapshots) map[s.roomName] = s;
  return {
    tick: (globalThis as any).Game.time,
    budget: mockBudget("healthy"),
    global_siteCount: 0,
    getSnapshot: vi.fn((name: string) => map[name]),
    snapshots: vi.fn(function* () {
      for (const s of snapshots) yield s;
    }),
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("factory-manager — processPower 调度接线", () => {
  it("库存充足 + storage 达地板 + 和平 → processPower 被调", () => {
    const processPower = vi.fn(() => OK);
    const room = mockSnapshot({
      powerSpawn: { store: resStore({ power: 50, energy: 1000 }), processPower } as any,
      storage: { store: resStore({ energy: CONFIG.factory.processEnergyFloor }, 1000000) } as any,
    });

    factoryManagerSystem.run(makeCtx([room]));

    expect(processPower).toHaveBeenCalledTimes(1);
    // 实扣能量 50 记入工业桶（只观测，不进消费合计）。
    const ledger = (globalThis as any).energyLedger?.rooms?.W7N4;
    expect(ledger?.industrialSpend).toBe(50);
  });

  it("processPower 返回非 OK → 不记工业桶（没扣到能量）", () => {
    const processPower = vi.fn(() => ERR_NOT_ENOUGH_RESOURCES);
    const room = mockSnapshot({
      powerSpawn: { store: resStore({ power: 50, energy: 1000 }), processPower } as any,
      storage: { store: resStore({ energy: CONFIG.factory.processEnergyFloor }, 1000000) } as any,
    });

    factoryManagerSystem.run(makeCtx([room]));

    expect(processPower).toHaveBeenCalledTimes(1);
    expect((globalThis as any).energyLedger?.rooms?.W7N4?.industrialSpend).toBeUndefined();
  });

  it("storage 低于地板 → 暂停（投资让位 spawn/tower）", () => {
    const processPower = vi.fn(() => OK);
    const room = mockSnapshot({
      powerSpawn: { store: resStore({ power: 50, energy: 1000 }), processPower } as any,
      storage: {
        store: resStore({ energy: CONFIG.factory.processEnergyFloor - 1 }, 1000000),
      } as any,
    });

    factoryManagerSystem.run(makeCtx([room]));

    expect(processPower).not.toHaveBeenCalled();
  });

  it("war 姿态 → 暂停（能量军事优先）", () => {
    (globalThis as any).Memory = {
      kernel: {
        strategy: { posture: "war", since: 0, expansionAllowed: false, newRemoteOpsAllowed: false },
      },
    };
    const processPower = vi.fn(() => OK);
    const room = mockSnapshot({
      powerSpawn: { store: resStore({ power: 50, energy: 1000 }), processPower } as any,
      storage: { store: resStore({ energy: 50000 }, 1000000) } as any,
    });

    factoryManagerSystem.run(makeCtx([room]));

    expect(processPower).not.toHaveBeenCalled();
  });

  it("无 powerSpawn → 安全跳过不报错", () => {
    expect(() => factoryManagerSystem.run(makeCtx([mockSnapshot({})]))).not.toThrow();
  });
});
