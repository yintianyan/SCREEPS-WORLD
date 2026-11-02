/** R674b：容器修复效用缩放 + 同 tick 目标占用。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { builderRole } from "../../../src/creeps/roles/builder";
import {
  mockConstructionSite,
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

function setup(containerHits: number) {
  const site = mockConstructionSite("extension", { id: "site_1" });
  const container = mockStructure("container", {
    id: "c1",
    hits: containerHits,
    hitsMax: 5000,
  });
  const snap = mockSnapshot({
    myConstructionSites: [site],
    containers: [container],
    fillTargets: [],
  });
  const creep = mockCreep({
    name: "builder_1",
    role: "builder",
    used: 50,
    capacity: 50,
    mode: "work",
  });
  return { site, container, snap, creep, ctx: mockContext(snap) };
}

describe("builder 效用 — 容器修复按缺口缩放", () => {
  it("刚跌破 80%：建造优先（容器不因阈值擦边压过工地）", () => {
    const { site, container, creep, ctx } = setup(3900); // 78% < 80%
    builderRole.run(creep, ctx);
    expect(creep.build).toHaveBeenCalledWith(site);
    expect(creep.repair).not.toHaveBeenCalledWith(container);
  });

  it("跌破 50%：容器修复优先于建造", () => {
    const { site, container, creep, ctx } = setup(2000); // 40%
    builderRole.run(creep, ctx);
    expect(creep.repair).toHaveBeenCalledWith(container);
    expect(creep.build).not.toHaveBeenCalledWith(site);
  });
});

describe("builder 效用 — 同 tick 修复目标占用", () => {
  it("两名 builder 不会同时修同一个容器，第二人回落建造", () => {
    const { site, container, snap, ctx } = setup(2000); // 40%：容器效用 85 > 建造 50
    const a = mockCreep({
      name: "builder_a",
      role: "builder",
      used: 50,
      capacity: 50,
      mode: "work",
    });
    const b = mockCreep({
      name: "builder_b",
      role: "builder",
      used: 50,
      capacity: 50,
      mode: "work",
    });

    builderRole.run(a, ctx);
    builderRole.run(b, mockContext(snap));

    expect(a.repair).toHaveBeenCalledWith(container);
    expect(b.repair).not.toHaveBeenCalledWith(container);
    expect(b.build).toHaveBeenCalledWith(site);
  });
});

describe("builder 效用 — R681 storage 工地优先", () => {
  it("无 storage 时，storage 工地（150）压过常规修路", () => {
    const site = mockConstructionSite("storage", { id: "st_site" });
    const road = mockStructure("road", { id: "r1", hits: 1000, hitsMax: 5000 }); // 20%
    const snap = mockSnapshot({
      rcl: 4,
      storage: undefined,
      myConstructionSites: [site],
      roads: [road],
      fillTargets: [],
    });
    const creep = mockCreep({
      name: "builder_1",
      role: "builder",
      used: 50,
      capacity: 50,
      mode: "work",
    });
    builderRole.run(creep, mockContext(snap));
    expect(creep.build).toHaveBeenCalledWith(site);
    expect(creep.repair).not.toHaveBeenCalledWith(road);
  });

  it("濒死 fresh rampart（180）仍压过 storage 工地，急救不被抢", () => {
    const site = mockConstructionSite("storage", { id: "st_site" });
    const rampart = mockStructure("rampart", { id: "rp1", hits: 1, hitsMax: 300000 });
    const snap = mockSnapshot({
      rcl: 4,
      storage: undefined,
      myConstructionSites: [site],
      ramparts: [rampart],
      fillTargets: [],
    });
    const creep = mockCreep({
      name: "builder_1",
      role: "builder",
      used: 50,
      capacity: 50,
      mode: "work",
    });
    builderRole.run(creep, mockContext(snap));
    expect(creep.repair).toHaveBeenCalledWith(rampart);
    expect(creep.build).not.toHaveBeenCalledWith(site);
  });
});
