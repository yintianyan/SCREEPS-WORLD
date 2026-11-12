/** Phase C-A：低储期常规修路收紧（storage < 50K 只修 <30% 的道路，急救档不受限）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { repairRoads, repairUrgentRoads } from "../../../src/creeps/engine/actions/repair";
import type { ActionContext } from "../../../src/creeps/engine/action-types";
import { CONFIG } from "../../../src/config";
import {
  mockBudget,
  mockCreep,
  mockPos,
  mockSnapshot,
  resetGlobals,
} from "../../support/factories";

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

function road(id: string, ratio: number): any {
  return {
    id,
    structureType: "road",
    pos: mockPos(25, 25),
    hits: Math.round(5000 * ratio),
    hitsMax: 5000,
  };
}

function makeAc(opts: {
  storageEnergy?: number;
  roads: any[];
  cachedRoadId?: string;
  tier?: string;
}): ActionContext {
  const creep = mockCreep({
    name: "builder_1",
    role: "builder",
    used: 200,
    capacity: 250,
    mode: "work",
  });
  if (opts.cachedRoadId !== undefined) {
    (creep.memory as any).repairTargetId = opts.cachedRoadId;
  }
  const snapshot = mockSnapshot({
    roomName: "W8N3",
    storage:
      opts.storageEnergy === undefined
        ? undefined
        : ({ store: makeStore({ energy: opts.storageEnergy }, 1000000) } as any),
    roads: opts.roads,
  });
  return {
    creep,
    snapshot,
    assignment: undefined,
    budget: mockBudget((opts.tier ?? "healthy") as any),
    ctx: {} as any,
  };
}

describe("repairRoads — 低储期收紧", () => {
  it("storage 48K（低储）+ 道路 40% → 不接（旧行为会修）", () => {
    const ac = makeAc({ storageEnergy: 48000, roads: [road("r40", 0.4)] });
    expect(repairRoads().resolve(ac)).toBeUndefined();
  });

  it("storage 48K + 道路 25% → 仍修（低于 30% 低储进场线）", () => {
    const ac = makeAc({ storageEnergy: 48000, roads: [road("r25", 0.25)] });
    const target = repairRoads().resolve(ac) as any;
    expect(target?.id).toBe("r25");
  });

  it("storage 60K（非低储）+ 道路 39% → 正常修", () => {
    const ac = makeAc({ storageEnergy: 60000, roads: [road("r40", 0.39)] });
    const target = repairRoads().resolve(ac) as any;
    expect(target?.id).toBe("r40");
  });

  it("低储 + 缓存目标 40% → 清缓存后不接（防止旧目标继续吃 16 e/t）", () => {
    const ac = makeAc({
      storageEnergy: 48000,
      roads: [road("r40", 0.4)],
      cachedRoadId: "r40",
    });
    expect(repairRoads().resolve(ac)).toBeUndefined();
    expect((ac.creep.memory as any).repairTargetId).toBeUndefined();
  });

  it("低储 + 缓存目标 20% → 继续修", () => {
    const ac = makeAc({
      storageEnergy: 48000,
      roads: [road("r20", 0.2)],
      cachedRoadId: "r20",
    });
    const target = repairRoads().resolve(ac) as any;
    // 缓存对象由 getObjectById 解析；测试环境无缓存 → 回落到最低血量道路。
    expect(target?.id).toBe("r20");
  });

  it("低储但无 storage（早期房）→ 不受限，正常修", () => {
    const ac = makeAc({ roads: [road("r40", 0.39)] });
    const target = repairRoads().resolve(ac) as any;
    expect(target?.id).toBe("r40");
  });

  it("recovery tier → 恒跳过（原有门禁不变）", () => {
    const ac = makeAc({ storageEnergy: 60000, roads: [road("r20", 0.2)], tier: "recovery" });
    expect(repairRoads().resolve(ac)).toBeUndefined();
  });
});

describe("repairUrgentRoads — 急救档不受低储收紧", () => {
  it("storage 48K + 道路 10% → 急救照修", () => {
    const ac = makeAc({ storageEnergy: 48000, roads: [road("r10", 0.1)] });
    const target = repairUrgentRoads().resolve(ac) as any;
    expect(target?.id).toBe("r10");
  });

  it("低储进场线与常规线的关系：0.3 < 0.4 < 0.9", () => {
    expect(CONFIG.construction.lowStorageRoadHits).toBeLessThan(
      CONFIG.construction.roadRepairThreshold,
    );
  });
});
