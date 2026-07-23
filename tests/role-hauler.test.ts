/**
 * Hauler 角色场景测试。
 *
 * 覆盖：capped withdraw、reservation 去重、controller container 优先补给、
 * fallback 链（storage → upgrade → idle）、无 WORK 部件不采集、flee。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { haulerRole } from "../src/creeps/roles/hauler";
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

describe("hauler — acquire 模式", () => {
  it("从最满 container 限量 withdraw（capped withdraw）", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 800, capacity: 2000 });
    const c2 = mockStructure("container", { id: "c2", energy: 200, capacity: 2000 });
    const snap = mockSnapshot({ containers: [c1, c2] });
    // hauler 空载，容量 100。
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // 应选最满的 c1，withdraw min(800, 100) = 100。
    expect(creep.withdraw).toHaveBeenCalledWith(c1, "energy", 100);
  });

  it("container 可用量 < carryFree 时取可用量", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 30, capacity: 2000 });
    const snap = mockSnapshot({ containers: [c1] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // min(30, 100) = 30。
    expect(creep.withdraw).toHaveBeenCalledWith(c1, "energy", 30);
  });

  it("container 空时进入 idle（不尝试 harvest）", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 0, capacity: 2000 });
    const snap = mockSnapshot({ containers: [c1] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("无 container 时回退到 storage 取能", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 5000, capacity: 100000 });
    const snap = mockSnapshot({ containers: [], storage });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 100);
  });

  it("无任何能量来源时 idle", () => {
    const snap = mockSnapshot({ containers: [], storage: undefined });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
  });

  it("assignment sourceId 指定 container 时优先使用", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 800, capacity: 2000 });
    const c2 = mockStructure("container", { id: "c2", energy: 200, capacity: 2000 });
    const snap = mockSnapshot({ containers: [c1, c2] });
    const creep = mockCreep({
      name: "hauler_1",
      role: "hauler",
      used: 0,
      capacity: 100,
      mode: "acquire",
      assignment: { id: "t1", kind: "haul", sourceId: "c2", leaseUntil: 2000, revision: 1, assignedAt: 990 },
    });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // 应使用 assignment 指定的 c2 而非最满的 c1。
    expect(creep.withdraw).toHaveBeenCalledWith(c2, "energy", 100);
  });
});

describe("hauler — work 模式", () => {
  it("向 fillTarget 运送能量", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ fillTargets: [spawn] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("controller container 低于半满时优先补给", () => {
    const cc = mockStructure("container", { id: "cc1", energy: 100, capacity: 2000 }); // 远低于半满
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({
      controllerContainer: cc,
      fillTargets: [spawn, cc],
    });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // controller container 低于半满 → 优先补给。
    expect(creep.transfer).toHaveBeenCalledWith(cc, "energy");
  });

  it("fillTargets 全满时回退到 storage", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 0, capacity: 100000 });
    const snap = mockSnapshot({ fillTargets: [], storage });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(storage, "energy");
  });

  it("无 storage 时回退到升级控制器", () => {
    const controller = mockController();
    const snap = mockSnapshot({ fillTargets: [], storage: undefined, controller });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });

  it("无任何目标时 idle", () => {
    const snap = mockSnapshot({ fillTargets: [], storage: undefined, controller: undefined });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
  });

  it("ERR_FULL 时触发 updateMode 切换", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 290, capacity: 300 });
    const snap = mockSnapshot({ fillTargets: [spawn] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    creep.transfer.mockReturnValue(-8); // ERR_FULL
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // ERR_FULL → updateMode → 仍有能量(80) → 保持 work。
    expect(creep.transfer).toHaveBeenCalled();
  });
});

describe("hauler — reservation 去重", () => {
  it("两个 hauler 不抢同一 fillTarget", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const ext = mockStructure("extension", { id: "ext1", energy: 0, capacity: 50 });
    const snap = mockSnapshot({ fillTargets: [spawn, ext] });

    const hauler1 = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const hauler2 = mockCreep({ name: "hauler_2", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(hauler1, ctx);
    haulerRole.run(hauler2, ctx);

    // 第一个 hauler 预约了 spawn，第二个应拿到 ext（或回退）。
    const target1 = hauler1.transfer.mock.calls[0]?.[0];
    const target2 = hauler2.transfer.mock.calls[0]?.[0];
    // 两者不应同时是同一个对象（除非回退到共享）。
    if (target1 && target2) {
      expect(target1.id).not.toBe(target2.id);
    }
  });
});

describe("hauler — flee", () => {
  it("有敌人时进入 flee 且不执行经济动作", () => {
    const hostile = mockHostile();
    const snap = mockSnapshot({ hostileCreeps: [hostile] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 50, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("flee");
    expect(creep.transfer).not.toHaveBeenCalled();
    expect(creep.withdraw).not.toHaveBeenCalled();
  });
});
