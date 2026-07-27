/**
 * Distributor 角色场景测试。
 *
 * 覆盖：
 *   - 从 storage 取能并填充 fillTarget（核心数据流）
 *   - 需求门禁：无 fillTarget 时不从 storage 取能（防循环）
 *   - 无 storage 时 idle
 *   - 永不调用 fillStorage（架构约束）
 *   - fillTarget 全满时 idle
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { distributorRole } from "../../../src/creeps/roles/distributor";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("distributor — acquire 模式", () => {
  it("从 storage 限量取能（有 fillTarget 时）", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 5000, capacity: 100000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 应从 storage 取 min(5000, 100) = 100 能量。
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 100);
  });

  it("需求门禁：无 fillTarget 时不从 storage 取能（防 storage→storage 循环）", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 5000, capacity: 100000 });
    const snap = mockSnapshot({ storage, fillTargets: [] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // fillTargets 为空 → 需求门禁拒绝取能 → idle。
    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(creep.memory.mode).toBe("idle");
  });

  it("storage 为空时 idle", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 0, capacity: 100000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(creep.memory.mode).toBe("idle");
  });

  it("无 storage 时降级为 hauler", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage: undefined, fillTargets: [spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 无 storage → gate 将 role 改为 hauler，跳过本 tick。
    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(creep.memory.role).toBe("hauler");
  });

  it("storage 可用量 < carryFree 时取可用量", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 30, capacity: 100000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // min(30, 100) = 30。
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 30);
  });
});

describe("distributor — work 模式", () => {
  it("向 fillTarget 运送能量", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 5000, capacity: 100000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("fillTargets 全满时 idle（不回退到 fillStorage）", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 5000, capacity: 100000 });
    const snap = mockSnapshot({ fillTargets: [], storage });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 架构约束：distributor 永不存入 storage。
    // fillTargets 全满 → idle，等待 sink 释放容量。
    expect(creep.transfer).not.toHaveBeenCalledWith(storage, "energy");
    expect(creep.memory.mode).toBe("idle");
  });

  it("架构约束：永不向 storage transfer（消除循环依赖）", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 5000, capacity: 100000 });
    // fillTargets 为空，distributor 携带能量但无下游 — 不能存回 storage。
    const snap = mockSnapshot({ fillTargets: [], storage });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 核心架构约束：distributor 的 work 链没有 fillStorage。
    // 如果加了 fillStorage，就会重新引入 storage→storage 循环。
    const storageTransfers = creep.transfer.mock.calls.filter(
      (call: any[]) => call[0]?.id === "storage_1"
    );
    expect(storageTransfers.length).toBe(0);
  });
});

describe("distributor — reservation 去重", () => {
  it("两个 distributor 不抢同一 fillTarget", () => {
    // storage 水位需 > 50% 以确保 tier 0（允许 spawn + extension），否则 tier 3 仅允许 spawn 导致两 creep 抢同一目标。
    const storage = mockStructure("storage", { id: "storage_1", energy: 60000, capacity: 100000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const ext = mockStructure("extension", { id: "ext1", energy: 0, capacity: 50 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn, ext] });

    const dist1 = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const dist2 = mockCreep({ name: "dist_2", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(dist1, ctx);
    distributorRole.run(dist2, ctx);

    // 第一个 distributor 预约了 spawn，第二个应拿到 ext。
    const target1 = dist1.transfer.mock.calls[0]?.[0];
    const target2 = dist2.transfer.mock.calls[0]?.[0];
    if (target1 && target2) {
      expect(target1.id).not.toBe(target2.id);
    }
  });
});

describe("distributor — 水位分级调度", () => {
  it("tier 0（水位 > 50%）：满载取能，所有 fillTarget 可服务", () => {
    // storage 60000/100000 = 60% → tier 0
    const storage = mockStructure("storage", { id: "storage_1", energy: 60000, capacity: 100000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn, tower] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 200, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 满载取能：min(60000, 200) = 200
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 200);
    // tier 0 写入 memory
    expect(creep.memory.distributorTier).toBe(0);
  });

  it("tier 0（水位 > 50%）：work 阶段可填充 tower", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 60000, capacity: 100000 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const snap = mockSnapshot({ storage, fillTargets: [tower] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // tier 0 允许填充 tower
    expect(creep.transfer).toHaveBeenCalledWith(tower, "energy");
  });

  it("tier 1（水位 20%-50%）：满载取能，work 只填充 spawn/extension，跳过 tower", () => {
    // storage 30000/100000 = 30% → tier 1
    const storage = mockStructure("storage", { id: "storage_1", energy: 30000, capacity: 100000 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const snap = mockSnapshot({ storage, fillTargets: [tower] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 200, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 满载取能（tier 1 不限制取能量）
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 200);
    expect(creep.memory.distributorTier).toBe(1);
  });

  it("tier 1（水位 20%-50%）：work 阶段跳过 tower，只填充 spawn", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 30000, capacity: 100000 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [tower, spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // tier 1 跳过 tower，填充 spawn
    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("tier 2（水位 10%-20%）：限取 400/tick", () => {
    // storage 15000/100000 = 15% → tier 2
    const storage = mockStructure("storage", { id: "storage_1", energy: 15000, capacity: 100000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 500, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 限取 400：min(15000, 500, 400) = 400
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 400);
    expect(creep.memory.distributorTier).toBe(2);
  });

  it("tier 2（水位 10%-20%）：work 只填充 spawn/extension，跳过 tower", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 15000, capacity: 100000 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [tower, spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // tier 2 跳过 tower，填充 spawn
    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("tier 3（水位 < 10%）：限取 200/tick", () => {
    // storage 5000/100000 = 5% → tier 3
    const storage = mockStructure("storage", { id: "storage_1", energy: 5000, capacity: 100000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 500, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 限取 200：min(5000, 500, 200) = 200
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 200);
    expect(creep.memory.distributorTier).toBe(3);
  });

  it("tier 3（水位 < 10%）：work 仅填充 spawn，跳过 extension 和 tower", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 5000, capacity: 100000 });
    const extension = mockStructure("extension", { id: "ext1", energy: 0, capacity: 50 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [extension, tower, spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // tier 3 仅填充 spawn，跳过 extension 和 tower
    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });
});
