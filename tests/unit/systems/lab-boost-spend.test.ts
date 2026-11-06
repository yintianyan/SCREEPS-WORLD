/** lab boost 工业消耗桶接线测试（四写点之一）。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { labSystem } from "../../../src/systems/room/lab-system";
import { globalCache } from "../../../src/kernel/global-cache";
import { mockContext, mockSnapshot, resetGlobals } from "../../support/factories";

function storeOf(resources: Record<string, number>): any {
  const store: Record<string, any> = { ...resources };
  const used = (r?: string): number =>
    r === undefined ? Object.values(resources).reduce((a, b) => a + b, 0) : (resources[r] ?? 0);
  Object.defineProperty(store, "getUsedCapacity", { enumerable: false, value: used });
  Object.defineProperty(store, "getFreeCapacity", {
    enumerable: false,
    value: (r?: string) => (r === "energy" ? 2000 - used(r) : 3000 - used(r ?? "")),
  });
  return store;
}

beforeEach(() => resetGlobals());
afterEach(() => {
  globalCache().creepRefs = undefined;
});

describe("lab-manager — boost 工业消耗桶", () => {
  it("boostCreep 成功 → industrialSpend += parts × 20", () => {
    const g = globalThis as any;
    const boostCreep = vi.fn(() => OK);
    const lab = {
      id: "lab1",
      cooldown: 0,
      pos: { x: 25, y: 25 },
      store: storeOf({ XUHO2: 200, energy: 200 }),
      boostCreep,
    };
    g.Game.rooms = { W7N4: {} };
    g.Game.getObjectById = (id: string) => (id === "lab1" ? lab : null);
    const body = [{ type: WORK }, { type: WORK }, { type: WORK }, { type: WORK }, { type: WORK }];
    g.Game.creeps = {
      c1: { name: "c1", body, pos: { getRangeTo: () => 1 }, memory: {} },
    };
    g.Memory.rooms.W7N4.industry = {};
    globalCache().creepRefs = [
      {
        name: "c1",
        role: "harvester",
        home: "W7N4",
        spawning: false,
        recycle: false,
        ticksToLive: 1500,
        bodyLength: body.length,
        body,
        roomName: "W7N4",
        x: 24,
        y: 25,
      } as any,
    ];

    const snap = mockSnapshot({
      roomName: "W7N4",
      rcl: 6,
      labs: [lab as any],
      storage: { store: storeOf({ XUHO2: 200 }) } as any,
    });

    labSystem.run(mockContext(snap));

    expect(boostCreep).toHaveBeenCalledWith(g.Game.creeps.c1, 5);
    expect(g.energyLedger?.rooms?.W7N4?.industrialSpend).toBe(100);
  });

  it("boostCreep 被拒 → 不记工业桶", () => {
    const g = globalThis as any;
    const boostCreep = vi.fn(() => ERR_NOT_ENOUGH_RESOURCES);
    const lab = {
      id: "lab1",
      cooldown: 0,
      pos: { x: 25, y: 25 },
      store: storeOf({ XUHO2: 200, energy: 200 }),
      boostCreep,
    };
    g.Game.rooms = { W7N4: {} };
    g.Game.getObjectById = (id: string) => (id === "lab1" ? lab : null);
    const body = [{ type: WORK }];
    g.Game.creeps = {
      c1: { name: "c1", body, pos: { getRangeTo: () => 1 }, memory: {} },
    };
    g.Memory.rooms.W7N4.industry = {};
    globalCache().creepRefs = [
      {
        name: "c1",
        role: "harvester",
        home: "W7N4",
        spawning: false,
        recycle: false,
        ticksToLive: 1500,
        bodyLength: body.length,
        body,
        roomName: "W7N4",
        x: 24,
        y: 25,
      } as any,
    ];

    const snap = mockSnapshot({
      roomName: "W7N4",
      rcl: 6,
      labs: [lab as any],
      storage: { store: storeOf({ XUHO2: 200 }) } as any,
    });

    labSystem.run(mockContext(snap));

    expect(boostCreep).toHaveBeenCalled();
    expect(g.energyLedger?.rooms?.W7N4?.industrialSpend).toBeUndefined();
  });
});
