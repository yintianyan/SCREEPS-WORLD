/** 道路维修链测试 — 危路急救提级与 hysteresis 修满放手。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { builderRole } from "../../../src/creeps/roles/builder";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

function road(id: string, hits: number, hitsMax = 5000): any {
  return { id, hits, hitsMax, structureType: "road", pos: { x: 20, y: 20, getRangeTo: () => 1 } };
}

/** 注册到 obj-cache 供 repairTargetId 复用路径查询。 */
function registerObjects(...objs: any[]) {
  (globalThis as any).Game.getObjectById = vi.fn((id: string) => objs.find(o => o.id === id) ?? null);
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("危路急救 — 提级到建造之前", () => {
  it("有 site 在场时，<15% 危路仍被优先修（修复前建造饿死修路）", () => {
    const dying = road("r1", 200); // 4% — 濒临塌毁。
    const site = { id: "site1", pos: { x: 30, y: 30, getRangeTo: () => 5 }, structureType: "extension", progress: 0, progressTotal: 3000 };
    const snap = mockSnapshot({ roads: [dying] as any, myConstructionSites: [site] as any });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    registerObjects(dying);

    builderRole.run(creep, mockContext(snap));

    expect(creep.repair).toHaveBeenCalledWith(dying);
    expect(creep.build).not.toHaveBeenCalled();
  });

  it("路况在急救线上（>15%）时不打断建造 — 常规维修礼让 site", () => {
    const shabby = road("r2", 1500); // 30% — 破常规线但未到急救线。
    const site = { id: "site1", pos: { x: 30, y: 30, getRangeTo: () => 5 }, structureType: "extension", progress: 0, progressTotal: 3000 };
    const snap = mockSnapshot({ roads: [shabby] as any, myConstructionSites: [site] as any });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    registerObjects(shabby);

    builderRole.run(creep, mockContext(snap));

    expect(creep.build).toHaveBeenCalled();
    expect(creep.repair).not.toHaveBeenCalledWith(shabby);
  });
});

describe("常规修路 — hysteresis 修满放手", () => {
  it("缓存目标已修过 40% 但未到 90%：继续修同一条（不贴线弃修）", () => {
    const halfway = road("r3", 3000); // 60% — 破旧世代阈值但在放手线下。
    const snap = mockSnapshot({ roads: [halfway] as any });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    creep.memory.repairTargetId = "r3" as any;
    registerObjects(halfway);

    builderRole.run(creep, mockContext(snap));

    expect(creep.repair).toHaveBeenCalledWith(halfway);
  });

  it("缓存目标已修到 90% 以上：放手，且无其他破线路时不再修", () => {
    const done = road("r4", 4600); // 92% — 过放手线。
    const snap = mockSnapshot({ roads: [done] as any });
    const creep = mockCreep({ name: "builder_1", role: "builder", used: 50, capacity: 50, mode: "work" });
    creep.memory.repairTargetId = "r4" as any;
    registerObjects(done);

    builderRole.run(creep, mockContext(snap));

    expect(creep.repair).not.toHaveBeenCalledWith(done);
  });
});
