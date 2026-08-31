/** Hauler 顺路卸能测试 — acquire 途中路过 storage 时把残余能量顺手存入。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { haulerRole } from "../../../src/creeps/roles/hauler";
import { globalCache } from "../../../src/kernel/global-cache";
import {
  mockContext,
  mockCreep,
  mockPos,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  globalCache().distributorRooms = undefined;
});

/** 标准场景：携能 acquire hauler + 邻近 storage + 有能量 container（取货目标）。 */
function scenario(overrides: { storageEnergy?: number; storageCap?: number } = {}) {
  const storage = mockStructure("storage", {
    id: "st",
    energy: overrides.storageEnergy ?? 30000,
    capacity: overrides.storageCap ?? 1000000,
  });
  const container = mockStructure("container", { id: "c1", energy: 1500, capacity: 2000 });
  const snap = mockSnapshot({ storage, containers: [container] });
  const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 200, capacity: 800, mode: "acquire" });
  return { storage, container, snap, creep };
}

describe("hauler — 顺路卸能（gate 伴随动作）", () => {
  it("acquire 携能路过 storage：顺手存入，且取货候选链照常执行（零 tick 成本）", () => {
    const { storage, container, snap, creep } = scenario();

    haulerRole.run(creep, mockContext(snap));

    // 伴随动作：transfer 进 storage；主链：withdraw container 同 tick 照常。
    expect(creep.transfer).toHaveBeenCalledWith(storage, "energy");
    expect(creep.withdraw).toHaveBeenCalledWith(container, "energy", expect.any(Number));
  });

  it("空载时不卸（无能量可存）", () => {
    const { storage, snap } = scenario();
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 800, mode: "acquire" });

    haulerRole.run(creep, mockContext(snap));

    expect(creep.transfer).not.toHaveBeenCalledWith(storage, "energy");
  });

  it("work 模式不经 gate 卸货（卸货由 work 链的 fillStorage 负责）", () => {
    const { storage, snap } = scenario();
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 800, capacity: 800, mode: "work" });

    haulerRole.run(creep, mockContext(snap));

    // work 链 fillStorage 会 transfer — 但那是候选链行为；此处仅验证不重复。
    // gate 的 acquire 判据保证 work 模式下伴随动作不触发（单次 transfer）。
    expect(creep.transfer).toHaveBeenCalledTimes(1);
  });

  it("不在 storage 旁（range > 1）不卸", () => {
    const { storage, snap, creep } = scenario();
    creep.pos.getRangeTo = vi.fn(() => 5);

    haulerRole.run(creep, mockContext(snap));

    expect(creep.transfer).not.toHaveBeenCalledWith(storage, "energy");
  });

  it("威胁在场不卸（能量应直送 tower，与 fillStorage 战时让位同口径）", () => {
    const { storage, snap, creep } = scenario();
    const hostile = { id: "h1", name: "h1", pos: mockPos(10, 10), owner: { username: "enemy" } };
    (snap as any).threatCreeps = [hostile];
    // 威胁在 flee 半径外（shouldFlee 以 t.pos 计距）— 不走 flee 分支，
    // 才能真正命中 gate 的威胁守卫路径。
    creep.pos.getRangeTo = vi.fn((t: any) => (t === hostile.pos ? 20 : 1));

    haulerRole.run(creep, mockContext(snap));

    expect(creep.transfer).not.toHaveBeenCalledWith(storage, "energy");
    // 佐证未走 flee：候选链照常执行（取货动作发生）。
    expect(creep.withdraw).toHaveBeenCalled();
  });

  it("泵断供不卸（锁进 storage 即无人能取，不得对冲断供兜底）", () => {
    const { storage, snap, creep } = scenario();
    globalCache().distributorRooms = new Set(); // 集合存在但不含本房 = 断供。

    haulerRole.run(creep, mockContext(snap));

    expect(creep.transfer).not.toHaveBeenCalledWith(storage, "energy");
  });

  it("storage 满不卸（不发无效意图）", () => {
    const { storage, snap, creep } = scenario({ storageEnergy: 1000000, storageCap: 1000000 });

    haulerRole.run(creep, mockContext(snap));

    expect(creep.transfer).not.toHaveBeenCalledWith(storage, "energy");
  });
});
