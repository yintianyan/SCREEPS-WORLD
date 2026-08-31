/** P0-4 upgrader storage 净流失率门禁 — 场景测试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upgraderRole } from "../../../src/creeps/roles/upgrader";
import {
  mockContext,
  mockController,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

/** 构造 acquire 模式 upgrader（空载 50 容量）。 */
function mockAcquireCreep(): any {
  return mockCreep({
    name: "upgrader_drain",
    role: "upgrader",
    used: 0,
    capacity: 50,
    mode: "acquire",
  });
}

/** 设置 W7N4（mockSnapshot 默认 roomName）上一 tick storage 能量。 */
function setStorageEnergyPrev(prev: number): void {
  const rooms = (globalThis as any).Memory.rooms;
  if (!rooms.W7N4) rooms.W7N4 = {};
  if (!rooms.W7N4.phase) rooms.W7N4.phase = {};
  rooms.W7N4.phase.storageEnergyPrev = prev;
}

/** 清除 W7N4 phase（模拟首次运行 / storageEnergyPrev 缺失）。 */
function clearStorageEnergyPrev(): void {
  const rooms = (globalThis as any).Memory.rooms;
  if (rooms.W7N4?.phase) delete rooms.W7N4.phase.storageEnergyPrev;
}

describe("P0-4 upgrader storage 流失率门禁 — 正常路径", () => {
  it("high water + no drain → withdraw allowed (normal uptake)", () => {
    // 高水位 60000 + 无流失（prev=cur）→ dynamicStorageLimit 返回 carry 满载，正常取能。
    setStorageEnergyPrev(60000);
    const storage = mockStructure("storage", { id: "st", energy: 60000, capacity: 1000000 });
    const snap = mockSnapshot({ storage, rcl: 6 });
    const creep = mockAcquireCreep();

    upgraderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", expect.any(Number));
  });

  it("drain rate > limit + low water → withdraw blocked (stop uptake)", () => {
    // 流失率 = 10000-9000 = 1000 > 5，且 9000 < sustainedStorage*2(20000) → 返回 0，停止取能。
    setStorageEnergyPrev(10000);
    const storage = mockStructure("storage", { id: "st", energy: 9000, capacity: 1000000 });
    const snap = mockSnapshot({ storage, rcl: 6 });
    const creep = mockAcquireCreep();

    upgraderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).not.toHaveBeenCalled();
  });

  it("draining but high water → not blocked (surplus drain allowed)", () => {
    // 流失率 = 100000-95000 = 5000 > 5，但 95000 >= sustainedStorage*2(20000) → 高水位期允许流失（盈余消化）。
    setStorageEnergyPrev(100000);
    const storage = mockStructure("storage", { id: "st", energy: 95000, capacity: 1000000 });
    const snap = mockSnapshot({ storage, rcl: 6 });
    const creep = mockAcquireCreep();

    upgraderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", expect.any(Number));
  });
});

describe("P0-4 upgrader storage 流失率门禁 — 边界条件", () => {
  it("drain rate exactly equals limit (5) → not blocked (> triggers only)", () => {
    // drainRate 恰好 = 5（边界）→ 严格 > 才触发，等于不拦截。
    setStorageEnergyPrev(10005);
    const storage = mockStructure("storage", { id: "st", energy: 10000, capacity: 1000000 });
    const snap = mockSnapshot({ storage, rcl: 6 });
    const creep = mockAcquireCreep();

    upgraderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", expect.any(Number));
  });

  it("no storage (RCL1-3) → skip drain rate check (legacy path)", () => {
    // 无 storage → dynamicStorageLimit 早期返回 perTickWithdrawLimit，不走流失率检查。
    const snap = mockSnapshot({ storage: undefined, rcl: 3 });
    const creep = mockAcquireCreep();

    expect(() => upgraderRole.run(creep, mockContext(snap))).not.toThrow();
  });

  it("storageEnergyPrev missing (first run) → drainRate=0, not blocked", () => {
    // 首次运行（prev 缺失）→ 用 cur 兜底 → drainRate=0，避免假流失。
    clearStorageEnergyPrev();
    const storage = mockStructure("storage", { id: "st", energy: 5000, capacity: 1000000 });
    const snap = mockSnapshot({ storage, rcl: 6 });
    const creep = mockAcquireCreep();

    upgraderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", expect.any(Number));
  });

  it("water exactly at sustainedStorage*2 (prev) → blocked (< releases only)", () => {
    // prev=20000（恰好 = sustainedStorage*2 边界），cur=19000 → drainRate=1000 > 5，
    // 且 cur=19000 < 20000 → 低水位 → 触发拦截。验证 < 才放行（<= 不放行）。
    setStorageEnergyPrev(20000);
    const storage = mockStructure("storage", { id: "st", energy: 19000, capacity: 1000000 });
    const snap = mockSnapshot({ storage, rcl: 6 });
    const creep = mockAcquireCreep();

    upgraderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).not.toHaveBeenCalled();
  });
});

describe("P0-4 upgrader storage 流失率门禁 — 异常情况", () => {
  it("storage.store read throws → degrade gracefully (no throw)", () => {
    // storage.store.getUsedCapacity 抛错 → dynamicStorageLimit try/catch 退化为返回 0，
    // role.run 不抛错。
    // 调用顺序：withdrawStorageCapped.resolve 先读一次（<=0 检查），通过后才调
    // dynamicStorageLimit（第二次读）。故 mock 首次返回 5000 让外层检查通过，
    // 第二次抛错触发 dynamicStorageLimit 的 try/catch。gate 走 energyAvailable 分支（rcl=3）。
    const storage = mockStructure("storage", { id: "st", energy: 5000, capacity: 1000000 });
    let callCount = 0;
    storage.store.getUsedCapacity = vi.fn(() => {
      callCount++;
      if (callCount <= 1) return 5000; // withdrawStorageCapped 的 <=0 检查通过
      throw new Error("read error"); // dynamicStorageLimit 内读取抛错
    });
    const snap = mockSnapshot({ storage, rcl: 3, energyAvailable: 500 });
    const creep = mockAcquireCreep();

    expect(() => upgraderRole.run(creep, mockContext(snap))).not.toThrow();
  });

  it("downgrade risk (ticksToDowngrade < threshold) → gate exempted (priority: prevent downgrade)", () => {
    // 降级风险（ticksToDowngrade=9000 < 10000）→ 豁免流失率门禁，保级优先。
    // acquire 模式下 role-runner 单 tick 只跑一个 action，withdraw 被调用即证明门禁豁免。
    setStorageEnergyPrev(10000);
    const ctrl = mockController({ ticksToDowngrade: 9000 });
    const storage = mockStructure("storage", { id: "st", energy: 9000, capacity: 1000000 });
    const snap = mockSnapshot({ controller: ctrl, storage, rcl: 6 });
    const creep = mockAcquireCreep();

    upgraderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", expect.any(Number));
  });

  it("storage recovers (drainRate turns negative) → resume uptake immediately (no residual gate)", () => {
    // 跨 tick 模拟：tick1 流失触发门禁（不取能），tick2 storage 回正（drainRate<0）→ 立即恢复取能。
    // 门禁无状态（每 tick 从 Memory 重算），不残留。

    // tick 1：流失 1000 > 5 + 低水位 9000 < 20000 → 门禁触发。
    setStorageEnergyPrev(10000);
    const snap1 = mockSnapshot({
      storage: mockStructure("storage", { id: "st1", energy: 9000, capacity: 1000000 }),
      rcl: 6,
    });
    const creep1 = mockAcquireCreep();
    upgraderRole.run(creep1, mockContext(snap1));
    expect(creep1.withdraw).not.toHaveBeenCalled();

    // tick 2：room-state 已更新 prev=9000，cur=9500 → drainRate=-500（回正）→ 立即恢复取能。
    setStorageEnergyPrev(9000);
    const snap2 = mockSnapshot({
      storage: mockStructure("storage", { id: "st2", energy: 9500, capacity: 1000000 }),
      rcl: 6,
    });
    const creep2 = mockAcquireCreep();
    upgraderRole.run(creep2, mockContext(snap2));
    expect(creep2.withdraw).toHaveBeenCalledWith(snap2.storage, "energy", expect.any(Number));
  });
});
