/** Power Creep Manager 系统测试 — GPL 消费 / 驻留分配 / 孵化 / 运营执行。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { powerCreepManagerSystem } from "../../../src/systems/power-creep-manager";
import { mockBudget, mockSnapshot, registerObject, resetGlobals } from "../../role-helpers";

/** 造一个 PowerCreep mock。 */
function pcMock(overrides: Record<string, any> = {}): any {
  return {
    name: "pc-op-0",
    level: 1,
    powers: { 1: { level: 1, cooldown: 0 } },
    ticksToLive: 5000,
    store: { ops: 500 },
    pos: { getRangeTo: () => 1, x: 25, y: 25, roomName: "W7N4" },
    room: { name: "W7N4" },
    spawn: vi.fn(() => OK),
    upgrade: vi.fn(() => OK),
    usePower: vi.fn(() => OK),
    renew: vi.fn(() => OK),
    enableRoom: vi.fn(() => OK),
    moveTo: vi.fn(() => OK),
    ...overrides,
  };
}

function snapshotWithPowerSpawn(overrides: Record<string, any> = {}): any {
  return mockSnapshot({
    roomName: "W7N4",
    powerSpawn: { id: "ps1", pos: { x: 26, y: 25 } } as any,
    spawns: [{ id: "spawn1", effects: [], pos: { x: 24, y: 25 } } as any],
    controller: { isPowerEnabled: true } as any,
    storage: { id: "storage1", store: { getUsedCapacity: () => 100000 } } as any,
    ...overrides,
  });
}

function setupPowerGame(pcs: Record<string, any>, gplLevel = 0): void {
  const g = globalThis as any;
  g.Game.powerCreeps = pcs;
  g.Game.gpl = { level: gplLevel, progress: 0, progressTotal: 1000 };
  g.PowerCreep = { create: vi.fn(() => OK) };
}

function makeContext(snapshots: any[]): any {
  const map: Record<string, any> = {};
  for (const s of snapshots) map[s.roomName] = s;
  return {
    tick: 1000,
    budget: mockBudget("healthy"),
    global_siteCount: 0,
    getSnapshot: (name: string) => map[name],
    snapshots: function* () {
      for (const s of snapshots) yield s;
    },
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("power-creep-manager — 环境守卫", () => {
  it("无 Game.powerCreeps API（私服）→ 空转不 throw", () => {
    const g = globalThis as any;
    delete g.Game.powerCreeps;
    g.PowerCreep = undefined;
    expect(() =>
      powerCreepManagerSystem.run(makeContext([snapshotWithPowerSpawn()])),
    ).not.toThrow();
  });

  it("帝国无 powerSpawn（RCL8 前）→ 不孵化不运营", () => {
    const pc = pcMock({ ticksToLive: undefined });
    setupPowerGame({ "pc-op-0": pc }, 2);
    powerCreepManagerSystem.run(makeContext([mockSnapshot({ roomName: "W7N4" })]));
    expect(pc.spawn).not.toHaveBeenCalled();
  });
});

describe("power-creep-manager — GPL 消费", () => {
  it("GPL1 无 PC → create 确定性命名 operator 类", () => {
    setupPowerGame({}, 1);
    powerCreepManagerSystem.run(makeContext([snapshotWithPowerSpawn()]));
    expect((globalThis as any).PowerCreep.create).toHaveBeenCalledWith("pc-op-0", "operator");
  });

  it("有 PC 有 free level → upgrade build order 下一项（OPERATE_SPAWN）", () => {
    const pc = pcMock({ powers: { 1: { level: 1, cooldown: 0 } } });
    setupPowerGame({ "pc-op-0": pc }, 2);
    powerCreepManagerSystem.run(makeContext([snapshotWithPowerSpawn()]));
    expect(pc.upgrade).toHaveBeenCalledWith(2);
  });

  it("free=0（GPL 已全消费）→ 不 create 不 upgrade", () => {
    const pc = pcMock({ level: 1 });
    setupPowerGame({ "pc-op-0": pc }, 1);
    powerCreepManagerSystem.run(makeContext([snapshotWithPowerSpawn()]));
    expect(pc.upgrade).not.toHaveBeenCalled();
    expect((globalThis as any).PowerCreep.create).not.toHaveBeenCalled();
  });
});

describe("power-creep-manager — 孵化与驻留", () => {
  it("未孵化 PC + 驻留房有 powerSpawn → pc.spawn(powerSpawn)", () => {
    const pc = pcMock({ ticksToLive: undefined });
    setupPowerGame({ "pc-op-0": pc }, 1);
    const snap = snapshotWithPowerSpawn();
    powerCreepManagerSystem.run(makeContext([snap]));
    expect(pc.spawn).toHaveBeenCalledWith(snap.powerSpawn);
  });

  it("首次运营写入驻留粘性（homeAssignments）", () => {
    const pc = pcMock();
    setupPowerGame({ "pc-op-0": pc }, 1);
    powerCreepManagerSystem.run(makeContext([snapshotWithPowerSpawn()]));
    expect((globalThis as any).Memory.kernel.powerCreeps.homeAssignments["pc-op-0"]).toBe("W7N4");
  });

  it("PC 消失 → 驻留死条目被清理", () => {
    (globalThis as any).Memory.kernel.powerCreeps = {
      homeAssignments: { "pc-op-0": "W7N4", "pc-op-9": "W7N4" },
    };
    const pc = pcMock();
    setupPowerGame({ "pc-op-0": pc }, 1);
    powerCreepManagerSystem.run(makeContext([snapshotWithPowerSpawn()]));
    const assignments = (globalThis as any).Memory.kernel.powerCreeps.homeAssignments;
    expect(assignments["pc-op-9"]).toBeUndefined();
    expect(assignments["pc-op-0"]).toBe("W7N4");
  });
});

describe("power-creep-manager — 运营执行", () => {
  it("TTL 低于阈值 + 贴近 powerSpawn → pc.renew", () => {
    const pc = pcMock({ ticksToLive: 800 });
    setupPowerGame({ "pc-op-0": pc }, 1);
    const snap = snapshotWithPowerSpawn();
    powerCreepManagerSystem.run(makeContext([snap]));
    expect(pc.renew).toHaveBeenCalledWith(snap.powerSpawn);
    expect(pc.usePower).not.toHaveBeenCalled();
  });

  it("controller 未启用 power + 贴近 → pc.enableRoom + 里程碑事件", () => {
    const pc = pcMock();
    setupPowerGame({ "pc-op-0": pc }, 1);
    const snap = snapshotWithPowerSpawn({
      controller: { isPowerEnabled: false } as any,
    });
    powerCreepManagerSystem.run(makeContext([snap]));
    expect(pc.enableRoom).toHaveBeenCalledWith(snap.controller);
  });

  it("spawn 效果缺失 + ops 足 → usePower(OPERATE_SPAWN, spawn)", () => {
    const pc = pcMock({ powers: { 1: { level: 1, cooldown: 0 }, 2: { level: 1, cooldown: 0 } } });
    setupPowerGame({ "pc-op-0": pc }, 2);
    const snap = snapshotWithPowerSpawn();
    // operate 目标经 getObjectById 解析 — 须注册进测试对象注册表。
    registerObject("spawn1", snap.spawns[0]);
    powerCreepManagerSystem.run(makeContext([snap]));
    expect(pc.usePower).toHaveBeenCalledWith(2, snap.spawns[0]);
  });

  it("GOPS 冷却 + spawn 效果在 → idle（不签发任何意图）", () => {
    const pc = pcMock({
      powers: {
        1: { level: 1, cooldown: 30 },
        2: { level: 1, cooldown: 0 },
      },
      store: { ops: 50 },
    });
    setupPowerGame({ "pc-op-0": pc }, 2);
    const snap = snapshotWithPowerSpawn({
      spawns: [{ id: "spawn1", effects: [{ effect: 2, level: 1, ticksRemaining: 900 }] } as any],
    });
    powerCreepManagerSystem.run(makeContext([snap]));
    expect(pc.usePower).not.toHaveBeenCalled();
    expect(pc.moveTo).not.toHaveBeenCalled();
  });
});
