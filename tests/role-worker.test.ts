/**
 * Worker 角色场景测试。
 *
 * 覆盖：P0 恢复角色基本循环（harvest → fill）、fallback 到 upgrade、
 * assignment sourceId 使用、flee、边界情况。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workerRole } from "../src/creeps/roles/worker";
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

describe("worker — acquire 模式", () => {
  it("从 source 采集", () => {
    const source = mockSource("s1");
    const snap = mockSnapshot({ sources: [source], sourceOccupancy: new Map([["s1", 1]]) });
    const creep = mockCreep({ name: "worker_1", role: "worker", used: 0, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.harvest).toHaveBeenCalledWith(source);
  });

  it("使用 assignment sourceId 指定的 source", () => {
    const s1 = mockSource("s1");
    const s2 = mockSource("s2");
    const snap = mockSnapshot({ sources: [s1, s2], sourceOccupancy: new Map([["s1", 2], ["s2", 0]]) });
    const creep = mockCreep({
      name: "worker_1",
      role: "worker",
      used: 0,
      capacity: 50,
      mode: "acquire",
      assignment: { id: "t1", kind: "harvest", sourceId: "s2", leaseUntil: 2000, revision: 1, assignedAt: 990 },
    });
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.harvest).toHaveBeenCalledWith(s2);
    expect(creep.memory.sourceId).toBe("s2");
  });

  it("source 耗尽时 idle", () => {
    const source = mockSource("s1");
    const snap = mockSnapshot({ sources: [source], sourceOccupancy: new Map([["s1", 1]]) });
    const creep = mockCreep({ name: "worker_1", role: "worker", used: 0, capacity: 50, mode: "acquire" });
    creep.harvest.mockReturnValue(-6); // ERR_NOT_ENOUGH_RESOURCES
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
  });

  it("满载时 updateMode 切为 work", () => {
    const source = mockSource("s1");
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ sources: [source], sourceOccupancy: new Map([["s1", 1]]), fillTargets: [spawn] });
    const creep = mockCreep({ name: "worker_1", role: "worker", used: 50, capacity: 50, mode: "acquire" });
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("work");
    expect(creep.harvest).not.toHaveBeenCalled();
    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });
});

describe("worker — work 模式", () => {
  it("向 fillTarget 运送能量", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ fillTargets: [spawn] });
    const creep = mockCreep({ name: "worker_1", role: "worker", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("使用 assignment targetId 指定的目标", () => {
    const ext = mockStructure("extension", { id: "ext1", energy: 0, capacity: 50 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ fillTargets: [spawn, ext] });
    const creep = mockCreep({
      name: "worker_1",
      role: "worker",
      used: 50,
      capacity: 50,
      mode: "work",
      assignment: { id: "t1", kind: "fill", targetId: "ext1", leaseUntil: 2000, revision: 1, assignedAt: 990 },
    });
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(ext, "energy");
  });

  it("无 fillTarget 时回退到升级控制器", () => {
    const controller = mockController();
    const snap = mockSnapshot({ fillTargets: [], controller });
    const creep = mockCreep({ name: "worker_1", role: "worker", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });

  it("无 fillTarget 无控制器时 idle", () => {
    const snap = mockSnapshot({ fillTargets: [], controller: undefined });
    const creep = mockCreep({ name: "worker_1", role: "worker", used: 50, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
  });

  it("ERR_FULL 时触发 updateMode", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 295, capacity: 300 });
    const snap = mockSnapshot({ fillTargets: [spawn] });
    const creep = mockCreep({ name: "worker_1", role: "worker", used: 50, capacity: 50, mode: "work" });
    creep.transfer.mockReturnValue(-8); // ERR_FULL
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalled();
  });
});

describe("worker — flee", () => {
  it("有敌人时 flee 且不执行经济动作", () => {
    const hostile = mockHostile();
    const snap = mockSnapshot({ hostileCreeps: [hostile] });
    const creep = mockCreep({ name: "worker_1", role: "worker", used: 30, capacity: 50, mode: "work" });
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("flee");
    expect(creep.transfer).not.toHaveBeenCalled();
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("flee 恢复后继续工作", () => {
    const source = mockSource("s1");
    const snap = mockSnapshot({ hostileCreeps: [], sources: [source], sourceOccupancy: new Map([["s1", 1]]) });
    const creep = mockCreep({ name: "worker_1", role: "worker", used: 0, capacity: 50, mode: "flee", sourceId: "s1" });
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    // flee + used===0 → acquire → harvest。
    expect(creep.memory.mode).toBe("acquire");
    expect(creep.harvest).toHaveBeenCalledWith(source);
  });
});

describe("worker — 边界情况", () => {
  it("无 home 时自动设置", () => {
    const source = mockSource("s1");
    const snap = mockSnapshot({ sources: [source], sourceOccupancy: new Map([["s1", 1]]) });
    const creep = mockCreep({ name: "worker_1", role: "worker", used: 0, capacity: 50 });
    creep.memory.home = undefined;
    creep.room.name = "W7N4";
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.memory.home).toBe("W7N4");
  });

  it("不在 home 时 idle 并尝试回房", () => {
    const snap = mockSnapshot();
    const creep = mockCreep({ name: "worker_1", role: "worker", used: 0, capacity: 50, home: "W7N4" });
    creep.room.name = "W6N4";
    const ctx = mockContext(snap);

    workerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
    expect(creep.harvest).not.toHaveBeenCalled();
  });
});
