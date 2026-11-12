/** Phase C-B：distributor 满载回吐 storage（sink 全满 + 低储时）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { returnEnergyToStorage } from "../../../src/creeps/engine/actions/fill";
import type { ActionContext } from "../../../src/creeps/engine/action-types";
import { mockCreep, mockPos, mockSnapshot, resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  (globalThis as any).Memory = { rooms: {} };
});

function makeStore(resources: Record<string, number>, capacity: number) {
  const used = (resource?: string): number =>
    resource === undefined
      ? Object.values(resources).reduce((sum, amount) => sum + amount, 0)
      : (resources[resource] ?? 0);
  return {
    ...resources,
    getUsedCapacity: used,
    getFreeCapacity: (resource?: string) => capacity - used(resource),
    getCapacity: () => capacity,
  };
}

function makeAc(opts: {
  storageEnergy?: number;
  carried?: number;
  fillTargets?: any[];
}): ActionContext {
  const creep = mockCreep({
    name: "dist-1",
    role: "distributor",
    used: opts.carried ?? 0,
    capacity: 400,
    mode: "work",
  });
  const snapshot = mockSnapshot({
    roomName: "W8N3",
    storage:
      opts.storageEnergy === undefined
        ? undefined
        : ({ store: makeStore({ energy: opts.storageEnergy }, 1000000) } as any),
    fillTargets: opts.fillTargets ?? [],
  });
  return { creep, snapshot, assignment: undefined, budget: {} as any, ctx: {} as any };
}

describe("returnEnergyToStorage", () => {
  it("携带能量 + sink 全满 + storage 48K（低储）→ 回吐 storage", () => {
    const ac = makeAc({ storageEnergy: 48000, carried: 400 });
    const target = returnEnergyToStorage().resolve(ac);
    expect(target).toBeDefined();
    expect((target as any).store.getUsedCapacity("energy")).toBe(48000);
  });

  it("storage 120K（高于恢复线）→ 不回吐（满载属正常波动）", () => {
    const ac = makeAc({ storageEnergy: 120000, carried: 400 });
    expect(returnEnergyToStorage().resolve(ac)).toBeUndefined();
  });

  it("仍有未填满的 sink → 让 distributorFillTarget 处理", () => {
    const ac = makeAc({
      storageEnergy: 48000,
      carried: 400,
      fillTargets: [{ structureType: "extension", pos: mockPos(20, 20) }],
    });
    expect(returnEnergyToStorage().resolve(ac)).toBeUndefined();
  });

  it("空手 → 不回吐", () => {
    const ac = makeAc({ storageEnergy: 48000, carried: 0 });
    expect(returnEnergyToStorage().resolve(ac)).toBeUndefined();
  });

  it("无 storage → undefined", () => {
    const ac = makeAc({ carried: 400 });
    expect(returnEnergyToStorage().resolve(ac)).toBeUndefined();
  });

  it("storage 满仓（无空闲）→ undefined", () => {
    const ac = makeAc({ storageEnergy: 1000000, carried: 400 });
    expect(returnEnergyToStorage().resolve(ac)).toBeUndefined();
  });
});
