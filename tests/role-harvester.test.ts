/**
 * Harvester 角色场景测试。
 *
 * 覆盖：站桩优先级链（link > container > container site > fillTarget > emptiest > build > upgrade）、
 * flee 与恢复、source 拥挤迁移、assignment 过期重分配、source 耗尽。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { harvesterRole } from "../src/creeps/harvester";
import {
  mockBudget,
  mockConstructionSite,
  mockContext,
  mockController,
  mockCreep,
  mockHostile,
  mockPos,
  mockSnapshot,
  mockSource,
  mockStructure,
  resetGlobals,
} from "./role-helpers";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("harvester — acquire 模式", () => {
  it("正常采集：空载时 harvest source", () => {
    const source = mockSource("s1");
    const snap = mockSnapshot({ sources: [source], sourceOccupancy: new Map([["s1", 1]]) });
    const creep = mockCreep({ used: 0, capacity: 50, sourceId: "s1" });
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.harvest).toHaveBeenCalledWith(source);
    expect(creep.memory.mode).toBe("acquire");
  });

  it("source 耗尽时进入 idle", () => {
    const source = mockSource("s1");
    const snap = mockSnapshot({ sources: [source], sourceOccupancy: new Map([["s1", 1]]) });
    const creep = mockCreep({ used: 0, capacity: 50, sourceId: "s1" });
    creep.harvest.mockReturnValue(-6); // ERR_NOT_ENOUGH_RESOURCES
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
  });

  it("拥挤迁移：当前 source 超过公平份额时重分配到更空闲的 source", () => {
    const s1 = mockSource("s1");
    const s2 = mockSource("s2");
    // s1 有 3 个 creep，s2 有 0 个 → fairShare = ceil(3/2) = 2，s1 超过 → 迁移。
    const snap = mockSnapshot({
      sources: [s1, s2],
      sourceOccupancy: new Map([["s1", 3], ["s2", 0]]),
    });
    const creep = mockCreep({ used: 0, capacity: 50, sourceId: "s1" });
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    // 应迁移到 s2（占用最少）。
    expect(creep.memory.sourceId).toBe("s2");
    expect(creep.harvest).toHaveBeenCalledWith(s2);
  });

  it("单 source 不触发拥挤迁移", () => {
    const s1 = mockSource("s1");
    const snap = mockSnapshot({
      sources: [s1],
      sourceOccupancy: new Map([["s1", 5]]),
    });
    const creep = mockCreep({ used: 0, capacity: 50, sourceId: "s1" });
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.memory.sourceId).toBe("s1");
    expect(creep.harvest).toHaveBeenCalledWith(s1);
  });

  it("满载时 updateMode 切为 work（不执行 harvest）", () => {
    const source = mockSource("s1");
    const snap = mockSnapshot({ sources: [source], sourceOccupancy: new Map([["s1", 1]]) });
    const creep = mockCreep({ used: 50, capacity: 50, sourceId: "s1", mode: "acquire" });
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    // updateMode 应将 acquire→work（free===0），然后走 work 分支。
    expect(creep.memory.mode).toBe("work");
    expect(creep.harvest).not.toHaveBeenCalled();
  });
});

describe("harvester — work 模式优先级链", () => {
  it("优先级 1：身边 link（range<=2）优先于一切", () => {
    const link = mockStructure("link", { id: "link_1", energy: 0, capacity: 800 });
    const container = mockStructure("container", { id: "c1", energy: 0, capacity: 2000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 0, capacity: 300 });
    const snap = mockSnapshot({
      links: [link],
      containers: [container],
      fillTargets: [spawn],
    });
    const creep = mockCreep({ used: 50, capacity: 50, mode: "work" });
    creep.pos.getRangeTo.mockReturnValue(1); // range <= 2
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(link, "energy");
    expect(creep.transfer).not.toHaveBeenCalledWith(container, "energy");
    expect(creep.transfer).not.toHaveBeenCalledWith(spawn, "energy");
  });

  it("优先级 1.5：link 满时回退到身边 container（range<=2）", () => {
    const link = mockStructure("link", { id: "link_1", energy: 800, capacity: 800 }); // 满
    const container = mockStructure("container", { id: "c1", energy: 0, capacity: 2000 });
    const snap = mockSnapshot({ links: [link], containers: [container] });
    const creep = mockCreep({ used: 50, capacity: 50, mode: "work" });
    creep.pos.getRangeTo.mockReturnValue(2); // range <= 2
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(container, "energy");
  });

  it("优先级 1.5 紧急恢复：身边 container 在建 site（range<=3）优先建造", () => {
    const containerSite = mockConstructionSite("container", { id: "cs1" });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 0, capacity: 300 });
    const snap = mockSnapshot({
      containers: [], // 无已建 container
      myConstructionSites: [containerSite],
      fillTargets: [spawn],
    });
    const creep = mockCreep({ used: 50, capacity: 50, mode: "work" });
    creep.pos.getRangeTo.mockReturnValue(2); // range <= 3
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.build).toHaveBeenCalledWith(containerSite);
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("优先级 2：无身边 container 时送 fillTarget（spawn/extension）", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({
      containers: [],
      links: [],
      myConstructionSites: [],
      fillTargets: [spawn],
    });
    const creep = mockCreep({ used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("优先级 3：fillTargets 全满时倒入最空 container", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 1500, capacity: 2000 });
    const c2 = mockStructure("container", { id: "c2", energy: 200, capacity: 2000 });
    const snap = mockSnapshot({
      containers: [c1, c2],
      links: [],
      fillTargets: [], // 全满
      myConstructionSites: [],
    });
    const creep = mockCreep({ used: 50, capacity: 50, mode: "work" });
    // 让近距离检查（range<=2）失败，触发优先级 3 的 findEmptiestContainer。
    creep.pos.getRangeTo.mockReturnValue(5);
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    // findEmptiestContainer 应选 c2（free=1800 > c1.free=500）。
    expect(creep.transfer).toHaveBeenCalledWith(c2, "energy");
  });

  it("优先级 4：全满无 container 时建造最近 site", () => {
    const site = mockConstructionSite("extension", { id: "ext_site" });
    const snap = mockSnapshot({
      containers: [],
      links: [],
      fillTargets: [],
      myConstructionSites: [site],
    });
    const creep = mockCreep({ used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.build).toHaveBeenCalledWith(site);
  });

  it("优先级 5：全部已满且无 site 时升级控制器", () => {
    const controller = mockController();
    const snap = mockSnapshot({
      controller,
      containers: [],
      links: [],
      fillTargets: [],
      myConstructionSites: [],
    });
    const creep = mockCreep({ used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });

  it("ERR_NOT_IN_RANGE 时调用 moveToTarget", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ containers: [], links: [], fillTargets: [spawn], myConstructionSites: [] });
    const creep = mockCreep({ used: 50, capacity: 50, mode: "work" });
    creep.transfer.mockReturnValue(-9); // ERR_NOT_IN_RANGE
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.moveTo).toHaveBeenCalled();
  });
});

describe("harvester — flee 与恢复", () => {
  it("有敌人时进入 flee 模式并释放 assignment", () => {
    const hostile = mockHostile();
    const snap = mockSnapshot({ hostileCreeps: [hostile] });
    const creep = mockCreep({
      used: 30,
      capacity: 50,
      mode: "work",
      assignment: { id: "t1", kind: "harvest", leaseUntil: 2000 },
    });
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("flee");
    expect(creep.memory.assignment).toBeUndefined();
    expect(creep.harvest).not.toHaveBeenCalled();
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("敌人离开后 flee 恢复为 work（有能量时）", () => {
    const container = mockStructure("container", { id: "c1", energy: 0, capacity: 2000 });
    const snap = mockSnapshot({ hostileCreeps: [], containers: [container] });
    const creep = mockCreep({ used: 30, capacity: 50, mode: "flee" });
    creep.pos.getRangeTo.mockReturnValue(1);
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    // updateMode: flee + used>0 → work。
    expect(creep.memory.mode).toBe("work");
  });

  it("敌人离开后 flee 恢复为 acquire（空载时）", () => {
    const source = mockSource("s1");
    const snap = mockSnapshot({ hostileCreeps: [], sources: [source], sourceOccupancy: new Map([["s1", 1]]) });
    const creep = mockCreep({ used: 0, capacity: 50, mode: "flee", sourceId: "s1" });
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    // updateMode: flee + used===0 → acquire。
    expect(creep.memory.mode).toBe("acquire");
    expect(creep.harvest).toHaveBeenCalledWith(source);
  });
});

describe("harvester — 边界情况", () => {
  it("无 home 时设置 home 为当前房间", () => {
    const source = mockSource("s1");
    const snap = mockSnapshot({ sources: [source], sourceOccupancy: new Map([["s1", 1]]) });
    const creep = mockCreep({ used: 0, capacity: 50, home: undefined as any });
    creep.memory.home = undefined;
    creep.room.name = "W7N4";
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    expect(creep.memory.home).toBe("W7N4");
  });

  it("不在 home 房间时向 home 移动并返回", () => {
    const snap = mockSnapshot();
    const creep = mockCreep({ used: 0, capacity: 50, home: "W7N4" });
    creep.room.name = "W6N4"; // 不在 home
    const ctx = mockContext(snap);

    harvesterRole.run(creep, ctx);

    // ensureHome 返回 false → mode = idle。
    expect(creep.memory.mode).toBe("idle");
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("snapshot 不存在时安全返回", () => {
    const creep = mockCreep({ used: 0, capacity: 50 });
    const ctx = mockContext();
    (ctx.getSnapshot as any).mockReturnValue(undefined);

    harvesterRole.run(creep, ctx);

    expect(creep.harvest).not.toHaveBeenCalled();
  });
});
