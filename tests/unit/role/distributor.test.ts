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
import { CONFIG } from "../../../src/config";
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
    // spawn/extension 在所有水位档位都可服务，两 creep 应通过预约各占一个目标。
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

describe("distributor — 水位分级调度（绝对能量阈值）", () => {
  // 刻度口径的教训：分级曾用 energy/capacity 比例，而真实 storage 容量是
  // 1,000,000（本文件旧 mock 用 capacity:100000，与引擎常量脱节 10 倍，
  // 测试全绿掩盖了「发展期房间永久 tier 3、extension 断供」的线上事故）。
  // 现改为绝对阈值（CONFIG.economy.distributorTiers），断言输入引用 CONFIG 防漂移。
  const TIERS = CONFIG.economy.distributorTiers;

  it("tier 0（库存 ≥ full）：满载取能，所有 fillTarget 可服务", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: TIERS.full + 10000, capacity: 1000000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn, tower] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 200, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 满载取能：min(库存, 200) = 200
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 200);
    expect(creep.memory.distributorTier).toBe(0);
  });

  it("tier 0：work 阶段可填充 tower", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: TIERS.full, capacity: 1000000 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const snap = mockSnapshot({ storage, fillTargets: [tower] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // tier 0 允许填充 tower
    expect(creep.transfer).toHaveBeenCalledWith(tower, "energy");
  });

  it("tier 1（sustained ≤ 库存 < full）：满载取能", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 30000, capacity: 1000000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 200, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 满载取能（tier 1 不限制取能量）
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 200);
    expect(creep.memory.distributorTier).toBe(1);
  });

  it("tier 1：仅剩 tower 需求时不取能（取能与投放同一口径，防携能 idle）", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 30000, capacity: 1000000 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const snap = mockSnapshot({ storage, fillTargets: [tower] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 200, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // tier 1 投放阶段会跳过 tower — 若此处取能，能量将滞留背包。
    expect(creep.withdraw).not.toHaveBeenCalled();
  });

  it("tier 1：work 阶段跳过 tower，填充 spawn", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: TIERS.sustained, capacity: 1000000 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [tower, spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("tier 2（low ≤ 库存 < sustained）：限取 400/tick，extension 仍可服务（发展期回归 — 用户症状）", () => {
    // 5000 库存在旧比例口径下是 tier 3（extension 断供），绝对口径下应为 tier 2。
    const storage = mockStructure("storage", { id: "storage_1", energy: 5000, capacity: 1000000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 500, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 限取 400：min(5000, 500, 400) = 400
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 400);
    expect(creep.memory.distributorTier).toBe(2);
  });

  it("tier 2：work 填充 extension（不再被锁死在仅 spawn 模式）", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: TIERS.low, capacity: 1000000 });
    const extension = mockStructure("extension", { id: "ext1", energy: 0, capacity: 50 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const snap = mockSnapshot({ storage, fillTargets: [tower, extension] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // tier 2 跳过 tower，但 extension 正常服务。
    expect(creep.transfer).toHaveBeenCalledWith(extension, "energy");
  });

  it("tier 3（库存 < low）：限取 200/tick", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: TIERS.low - 500, capacity: 1000000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 500, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // 限取 200：min(1500, 500, 200) = 200
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 200);
    expect(creep.memory.distributorTier).toBe(3);
  });

  it("tier 3：仅剩 extension 需求时仍取能（低水位 extension 断供回归 — 用户症状）", () => {
    // 曾经 tier 3 目标集排除 extension：门禁看到 extension 需求放行取能，
    // 投放阶段却拒绝服务 → 携能 idle，extension 长期断供、energyAvailable 锁死。
    const storage = mockStructure("storage", { id: "storage_1", energy: 1600, capacity: 1000000 });
    const extension = mockStructure("extension", { id: "ext1", energy: 0, capacity: 50 });
    const snap = mockSnapshot({ storage, fillTargets: [extension] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 0, capacity: 500, mode: "acquire" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // extension 属于孵化能量池，tier 3 仍需服务：限取 min(1600, 500, 200) = 200。
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 200);
    expect(creep.memory.distributorTier).toBe(3);
  });

  it("tier 3：work 填充 extension，仅跳过 tower（节流靠限额而非裁剪目标）", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 1500, capacity: 1000000 });
    const extension = mockStructure("extension", { id: "ext1", energy: 0, capacity: 50 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const snap = mockSnapshot({ storage, fillTargets: [tower, extension] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    // extension 里的能量只能被 spawnCreep 消费，与 spawn 同池 —
    // 排除它不保护储备，只会把孵化能量上限锁死在 spawn 容量。
    expect(creep.transfer).toHaveBeenCalledWith(extension, "energy");
  });

  it("tier 3：work 仍优先填充 spawn", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 1500, capacity: 1000000 });
    const tower = mockStructure("tower", { id: "tw1", energy: 100, capacity: 1000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ storage, fillTargets: [tower, spawn] });
    const creep = mockCreep({ name: "dist_1", role: "distributor", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    distributorRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });
});
