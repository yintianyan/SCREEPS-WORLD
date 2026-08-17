/**
 * Distributor nuke 资产抢救搬运链测试（审计缺口 3 的 distributor 侧）。
 *
 * 覆盖：
 *   - 警报房空载 → withdraw storage 中存量最大的非能量资源（价值密度优先）
 *   - 警报房携能 → deposit 到 terminal（支撑 terminal-manager 逐轮 send）
 *   - storage 只有能量 → withdraw 能量兜底
 *   - 无警报 → 动作不激活（常态零行为，走正常分发链）
 *   - terminal 满 → 不激活（无处可放）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { distributorRole } from "../../../src/creeps/roles/distributor";
import { mockContext, mockCreep, mockSnapshot, resetGlobals } from "../../role-helpers";

const room = "W7N4";

/** 多资源 storage store mock（真实键值映射，供 Object.entries 枚举）。 */
function storageMock(resources: Record<string, number>): any {
  return {
    store: {
      ...resources,
      getUsedCapacity: vi.fn((r?: string) => (r ? (resources[r] ?? 0)
        : Object.values(resources).reduce((a, b) => a + b, 0))),
      getFreeCapacity: vi.fn(() => 1000000),
      getCapacity: vi.fn(() => 1000000),
    },
  };
}

function terminalMock(freeCapacity = 300000): any {
  return {
    store: {
      getFreeCapacity: vi.fn(() => freeCapacity),
      getUsedCapacity: vi.fn(() => 0),
    },
  };
}

function nukeMock(): any {
  return { id: "n1", timeToLand: 40000, launchRoomName: "W9N9", pos: { x: 25, y: 25 } };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("distributor — nuke 资产抢救搬运链", () => {
  it("警报房空载 → withdraw storage 中存量最大的非能量资源", () => {
    const creep = mockCreep({ name: "dis-1", role: "distributor", used: 0, capacity: 1000 });
    creep.memory.home = room;
    creep.pos.getRangeTo = vi.fn(() => 1);
    const snap = mockSnapshot({
      roomName: room,
      storage: storageMock({ U: 5000, Z: 2000, energy: 900000 }),
      terminal: terminalMock(),
      incomingNukes: [nukeMock()],
    });
    // fillTargets 为空 → withdrawStorageForDistribution 需求门禁不取能，
    // 抢救动作（链首）接管本 tick。
    (snap as any).fillTargets = [];

    distributorRole.run(creep, mockContext(snap));

    // U(5000) > Z(2000) → 取 U；能量虽然最多但优先级垫底。
    expect(creep.withdraw).toHaveBeenCalledWith(
      expect.anything(),
      "U",
    );
  });

  it("警报房携能 → deposit 到 terminal", () => {
    const creep = mockCreep({ name: "dis-1", role: "distributor", used: 500, capacity: 1000 });
    creep.memory.home = room;
    creep.pos.getRangeTo = vi.fn(() => 1);
    const terminal = terminalMock();
    const snap = mockSnapshot({
      roomName: room,
      storage: storageMock({ energy: 900000 }),
      terminal,
      incomingNukes: [nukeMock()],
    });
    (snap as any).fillTargets = [];

    distributorRole.run(creep, mockContext(snap));

    expect(creep.transfer).toHaveBeenCalledWith(terminal, "energy");
  });

  it("storage 只有能量 → withdraw 能量兜底", () => {
    const creep = mockCreep({ name: "dis-1", role: "distributor", used: 0, capacity: 1000 });
    creep.memory.home = room;
    creep.pos.getRangeTo = vi.fn(() => 1);
    const snap = mockSnapshot({
      roomName: room,
      storage: storageMock({ energy: 500000 }),
      terminal: terminalMock(),
      incomingNukes: [nukeMock()],
    });
    (snap as any).fillTargets = [];

    distributorRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(expect.anything(), "energy");
  });

  it("无警报 → 动作不激活（常态零行为）", () => {
    const creep = mockCreep({ name: "dis-1", role: "distributor", used: 0, capacity: 1000 });
    creep.memory.home = room;
    creep.pos.getRangeTo = vi.fn(() => 1);
    const snap = mockSnapshot({
      roomName: room,
      storage: storageMock({ U: 5000, energy: 900000 }),
      terminal: terminalMock(),
      incomingNukes: [],
    });
    (snap as any).fillTargets = [];

    distributorRole.run(creep, mockContext(snap));

    // 抢救动作不取 U — 无 withdraw 或只可能来自其他动作（fillTargets 空 → 无）。
    expect(creep.withdraw).not.toHaveBeenCalledWith(expect.anything(), "U");
  });

  it("terminal 满 → 不激活（无处可放）", () => {
    const creep = mockCreep({ name: "dis-1", role: "distributor", used: 0, capacity: 1000 });
    creep.memory.home = room;
    creep.pos.getRangeTo = vi.fn(() => 1);
    const snap = mockSnapshot({
      roomName: room,
      storage: storageMock({ U: 5000, energy: 900000 }),
      terminal: terminalMock(0),
      incomingNukes: [nukeMock()],
    });
    (snap as any).fillTargets = [];

    distributorRole.run(creep, mockContext(snap));

    expect(creep.withdraw).not.toHaveBeenCalledWith(expect.anything(), "U");
  });
});
