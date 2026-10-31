/** R675：hauler/distributor 接入任务账本 — lab 供料不再被 storage/fillTarget 永久遮蔽。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { distributorRole } from "../../../src/creeps/roles/distributor";
import { haulerRole } from "../../../src/creeps/roles/hauler";
import { globalCache } from "../../../src/kernel/global-cache";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

function setLabLoads(room: string, labIds: string[], tick = (globalThis as any).Game.time) {
  globalCache().labDemands = {
    tick,
    byRoom: {
      [room]: {
        loads: labIds.map(id => ({ labId: id, resource: "energy", amount: 200 })),
        unloads: [],
      },
    },
  };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("hauler — lab 供料 vs storage", () => {
  function setup(loadCount: number, tickOffset = 0) {
    const labs = [
      mockStructure("lab", { id: "lab1", energy: 0, capacity: 2000 }),
      mockStructure("lab", { id: "lab2", energy: 0, capacity: 2000 }),
    ];
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 100000 });
    const snap = mockSnapshot({ labs, storage, fillTargets: [] });
    setLabLoads(
      "W7N4",
      labs.slice(0, Math.min(loadCount, 2)).map(l => l.id),
      (globalThis as any).Game.time + tickOffset,
    );
    const creep = mockCreep({
      name: "hauler_1",
      role: "hauler",
      used: 80,
      capacity: 100,
      mode: "work",
    });
    return { labs, storage, snap, creep, ctx: mockContext(snap) };
  }

  it("storage 永远有空位时，2 条 lab 搬运需求仍会被服务（结构性修复）", () => {
    const { labs, storage, creep, ctx } = setup(2);
    haulerRole.run(creep, ctx);
    expect(creep.transfer).toHaveBeenCalledWith(labs[0], "energy");
    expect(creep.transfer).not.toHaveBeenCalledWith(storage, "energy");
  });

  it("lab 需求表过期 10 拍仍在 TTL 内可用（修复 1/10 断供）", () => {
    const { labs, creep, ctx } = setup(2, -10);
    haulerRole.run(creep, ctx);
    expect(creep.transfer).toHaveBeenCalledWith(labs[0], "energy");
  });

  it("需求表过期 30 拍：供料候选失效，回退 storage", () => {
    const { storage, creep, ctx } = setup(2, -30);
    haulerRole.run(creep, ctx);
    expect(creep.transfer).toHaveBeenCalledWith(storage, "energy");
  });
});

describe("hauler — R680 crisis 时 CC 不再锁死核心填充", () => {
  it("crisis 期 spawn 与低半满 CC 同时存在 ⇒ 先填 spawn", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const cc = mockStructure("container", { id: "cc1", energy: 100, capacity: 2000 });
    const snap = mockSnapshot({ fillTargets: [spawn, cc], controllerContainer: cc });
    (Memory.rooms.W7N4 as any).phase = { phase: "crisis" };
    const creep = mockCreep({
      name: "hauler_1",
      role: "hauler",
      used: 80,
      capacity: 100,
      mode: "work",
    });
    haulerRole.run(creep, mockContext(snap));
    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
    expect(creep.transfer).not.toHaveBeenCalledWith(cc, "energy");
  });
});

describe("distributor — lab 供料 vs spawn", () => {
  function setup(loadCount: number) {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 0, capacity: 300 });
    const labs = [
      mockStructure("lab", { id: "lab1", energy: 0, capacity: 2000 }),
      mockStructure("lab", { id: "lab2", energy: 0, capacity: 2000 }),
    ];
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 100000 });
    const snap = mockSnapshot({ spawns: [spawn], labs, storage, fillTargets: [spawn] });
    setLabLoads(
      "W7N4",
      labs.slice(0, Math.min(loadCount, 2)).map(l => l.id),
    );
    const creep = mockCreep({
      name: "distributor_1",
      role: "distributor",
      used: 80,
      capacity: 100,
      mode: "work",
    });
    return { spawn, labs, creep, ctx: mockContext(snap) };
  }

  it("少量 lab 需求（2 条）时 spawn 优先（生命线不被工业抢走）", () => {
    const { spawn, creep, ctx } = setup(2);
    distributorRole.run(creep, ctx);
    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });
});
