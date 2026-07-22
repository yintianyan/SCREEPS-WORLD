/**
 * Upgrader 角色场景测试。
 *
 * 覆盖：能量地板门禁、紧急覆盖（ticksToDowngrade）、站桩升级取能链
 *（controller link → controller container → storage → richest container → harvest）、
 * 满载 upgrader 不被地板阻止、flee。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upgraderRole } from "../src/creeps/upgrader";
import {
  mockContext,
  mockController,
  mockCreep,
  mockHostile,
  mockSnapshot,
  mockSource,
  mockStructure,
  resetGlobals,
} from "./role-helpers";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("upgrader — work 模式", () => {
  it("满载时升级控制器", () => {
    const controller = mockController();
    const snap = mockSnapshot({ controller });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });

  it("ERR_NOT_IN_RANGE 时移动到控制器", () => {
    const controller = mockController();
    const snap = mockSnapshot({ controller });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 50, capacity: 50, mode: "work" });
    creep.upgradeController.mockReturnValue(-9); // ERR_NOT_IN_RANGE
    creep.pos.getRangeTo.mockReturnValue(5); // 不在范围内 → 走 moveTo 路径
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    expect(creep.moveTo).toHaveBeenCalled();
  });

  it("无控制器时 idle", () => {
    const snap = mockSnapshot({ controller: undefined });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
  });
});

describe("upgrader — 能量地板门禁（U-02）", () => {
  it("RCL1-3：energyAvailable < floor 时 acquire 被阻止 → idle", () => {
    const controller = mockController();
    const source = mockSource("s1");
    const snap = mockSnapshot({
      controller,
      rcl: 3,
      energyAvailable: 100, // < upgradeEnergyFloor (300)
      storage: undefined,
      sources: [source],
      sourceOccupancy: new Map([["s1", 0]]),
    });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 0, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
    expect(creep.harvest).not.toHaveBeenCalled();
    expect(creep.withdraw).not.toHaveBeenCalled();
  });

  it("RCL4+：storage 能量 < floorStorage 且无 container 能量时 acquire 被阻止", () => {
    const controller = mockController();
    const storage = mockStructure("storage", { id: "st1", energy: 500, capacity: 100000 }); // < 1000
    const snap = mockSnapshot({
      controller,
      rcl: 4,
      storage,
      containers: [], // 无替代能量源 — upgrader 只能直接采集，应被阻止
      links: [],
      energyAvailable: 800,
    });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 0, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
  });

  it("满载 upgrader 不被地板阻止（work 模式正常交付）", () => {
    const controller = mockController();
    const snap = mockSnapshot({
      controller,
      rcl: 3,
      energyAvailable: 100, // 低于 floor
      storage: undefined,
    });
    // 满载 → updateMode 将 acquire→work。
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 50, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    // updateMode: free===0 → work。belowFloor 只阻止 acquire，不阻止 work。
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });
});

describe("upgrader — 紧急覆盖（防降级）", () => {
  it("ticksToDowngrade < threshold 时即使低于地板也强制 acquire", () => {
    const controller = mockController({ ticksToDowngrade: 5000 }); // < 10000
    const source = mockSource("s1");
    const snap = mockSnapshot({
      controller,
      rcl: 3,
      energyAvailable: 100, // 低于 floor
      storage: undefined,
      sources: [source],
      sourceOccupancy: new Map([["s1", 0]]),
      containers: [],
      links: [],
    });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 0, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    // 紧急状态 → 不阻止 acquire → 应尝试取能（harvest 作为最后回退）。
    expect(creep.memory.mode).not.toBe("idle");
    expect(creep.harvest).toHaveBeenCalledWith(source);
  });
});

describe("upgrader — 站桩升级取能链", () => {
  it("优先级 1：controller link 有能量时从 link withdraw", () => {
    const controller = mockController();
    const link = mockStructure("link", { id: "ctrl_link", energy: 600, capacity: 800 });
    link.pos.getRangeTo = vi.fn(() => 1); // 在 controller 旁
    const snap = mockSnapshot({
      controller,
      links: [link],
      energyAvailable: 500,
    });
    // 让 link.pos.getRangeTo(controller) <= 2。
    link.pos.getRangeTo = vi.fn(() => 1);
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 0, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    expect(creep.withdraw).toHaveBeenCalledWith(link, "energy");
  });

  it("优先级 2：无 controller link 时从 controller container withdraw", () => {
    const controller = mockController();
    const cc = mockStructure("container", { id: "cc1", energy: 1000, capacity: 2000 });
    const snap = mockSnapshot({
      controller,
      controllerContainer: cc,
      links: [],
      energyAvailable: 500,
    });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 0, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    expect(creep.withdraw).toHaveBeenCalledWith(cc, "energy");
  });

  it("优先级 3：无 controller container 时从 storage withdraw", () => {
    const controller = mockController();
    const storage = mockStructure("storage", { id: "st1", energy: 5000, capacity: 100000 });
    const snap = mockSnapshot({
      controller,
      controllerContainer: undefined,
      links: [],
      storage,
      rcl: 4,
      energyAvailable: 500,
    });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 0, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy");
  });

  it("优先级 4：回退到最满 container", () => {
    const controller = mockController();
    const c1 = mockStructure("container", { id: "c1", energy: 800, capacity: 2000 });
    c1.pos.getRangeTo.mockReturnValue(5); // 非 source 相邻 container
    const snap = mockSnapshot({
      controller,
      controllerContainer: undefined,
      links: [],
      storage: undefined,
      containers: [c1],
      energyAvailable: 500,
    });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 0, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    expect(creep.withdraw).toHaveBeenCalledWith(c1, "energy");
  });

  it("优先级 5：最终回退到 harvest", () => {
    const controller = mockController();
    const source = mockSource("s1");
    const snap = mockSnapshot({
      controller,
      controllerContainer: undefined,
      links: [],
      storage: undefined,
      containers: [],
      sources: [source],
      sourceOccupancy: new Map([["s1", 0]]),
      energyAvailable: 500,
    });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 0, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    expect(creep.harvest).toHaveBeenCalledWith(source);
  });
});

describe("upgrader — flee", () => {
  it("有敌人时 flee 且不升级", () => {
    const hostile = mockHostile();
    const controller = mockController();
    const snap = mockSnapshot({ hostileCreeps: [hostile], controller });
    const creep = mockCreep({ name: "upgrader_1", role: "upgrader", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    upgraderRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("flee");
    expect(creep.upgradeController).not.toHaveBeenCalled();
  });
});
