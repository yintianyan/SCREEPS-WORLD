/** Terminal Manager nuke 资产抢救链测试（审计缺口 3）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { terminalManagerSystem } from "../../../src/systems/terminal-manager";
import type { CpuTier } from "../../../src/kernel/contracts";
import { mockBudget, mockSnapshot, resetGlobals } from "../../role-helpers";

/** 多资源 terminal store mock（引擎语义：store 是资源→数量映射 + 容量方法）。 */
function multiStore(resources: Record<string, number>, capacity = 300000): any {
  return {
    ...resources,
    getUsedCapacity: vi.fn((resource?: string) =>
      resource ? (resources[resource] ?? 0)
        : Object.values(resources).reduce((a, b) => a + b, 0)),
    getFreeCapacity: vi.fn(() => capacity - Object.values(resources).reduce((a, b) => a + b, 0)),
  };
}

function terminalMock(resources: Record<string, number>, cooldown = 0): any {
  return {
    cooldown,
    store: multiStore(resources),
    send: vi.fn(() => OK),
  };
}

function nukeMock(id: string, timeToLand = 40000): any {
  return { id, timeToLand, launchRoomName: "W9N9", pos: { x: 25, y: 25, roomName: "W7N4" } };
}

function roomSnapshot(opts: {
  roomName?: string;
  terminal?: any;
  nukes?: any[];
} = {}): any {
  return mockSnapshot({
    roomName: opts.roomName ?? "W7N4",
    terminal: opts.terminal,
    incomingNukes: opts.nukes ?? [],
  });
}

function makeContext(snapshots: any[], tier: CpuTier = "healthy"): any {
  const map: Record<string, any> = {};
  for (const s of snapshots) map[s.roomName] = s;
  return {
    tick: (globalThis as any).Game.time,
    budget: mockBudget(tier),
    globalSiteCount: 0,
    getSnapshot: vi.fn((name: string) => map[name]),
    snapshots: vi.fn(function* () {
      for (const s of snapshots) yield s;
    }),
  };
}

/** 读取 NukeSalvage 事件（kind=34）。 */
function salvageEvents(): any[] {
  return ((globalThis as any).eventBuffer?.events ?? []).filter((e: any) => e.k === 34);
}

beforeEach(() => {
  resetGlobals();
  (globalThis as any).Game.cpu.bucket = 10000;
  (globalThis as any).Game.market = {
    credits: 1000,
    getAllOrders: vi.fn(() => []),
    calcTransactionCost: vi.fn(() => 100),
    deal: vi.fn(() => OK),
  };
});

describe("terminal-manager — nuke 资产抢救链", () => {
  it("警报房 terminal 库存 → 无警报兄弟房 send（价值密度优先）", () => {
    const alert = roomSnapshot({
      roomName: "W7N4",
      terminal: terminalMock({ power: 500, G: 3000, energy: 10000 }),
      nukes: [nukeMock("n1")],
    });
    const safe = roomSnapshot({ roomName: "W8N4", terminal: terminalMock({}) });

    terminalManagerSystem.run(makeContext([alert, safe]));

    // power 优先于 G/能量 — 一次一笔。
    expect(alert.terminal.send).toHaveBeenCalledWith("power", 500, "W8N4");
    expect(salvageEvents()).toEqual([
      expect.objectContaining({ k: 34, r: "W7N4", d: [0, 500] }),
    ]);
  });

  it("无市场 API（getAllOrders 缺失）时抢救依然执行 — send 不依赖市场", () => {
    (globalThis as any).Game.market = undefined;
    const alert = roomSnapshot({
      roomName: "W7N4",
      terminal: terminalMock({ G: 2000 }),
      nukes: [nukeMock("n1")],
    });
    const safe = roomSnapshot({ roomName: "W8N4", terminal: terminalMock({}) });

    terminalManagerSystem.run(makeContext([alert, safe]));

    expect(alert.terminal.send).toHaveBeenCalledWith("G", 2000, "W8N4");
  });

  it("recovery 降档时抢救依然执行 — 战时 CPU 降档不阻断资产迁移", () => {
    const alert = roomSnapshot({
      roomName: "W7N4",
      terminal: terminalMock({ U: 9000 }),
      nukes: [nukeMock("n1")],
    });
    const safe = roomSnapshot({ roomName: "W8N4", terminal: terminalMock({}) });

    terminalManagerSystem.run(makeContext([alert, safe], "recovery"));

    expect(alert.terminal.send).toHaveBeenCalledWith("U", 9000, "W8N4");
  });

  it("无合格接收房（单房帝国）→ 静默不 send", () => {
    const alert = roomSnapshot({
      roomName: "W7N4",
      terminal: terminalMock({ power: 500 }),
      nukes: [nukeMock("n1")],
    });

    terminalManagerSystem.run(makeContext([alert]));

    expect(alert.terminal.send).not.toHaveBeenCalled();
    expect(salvageEvents()).toHaveLength(0);
  });

  it("terminal 冷却中 → 跳过本轮（下轮自然重试）", () => {
    const alert = roomSnapshot({
      roomName: "W7N4",
      terminal: terminalMock({ power: 500 }, 7),
      nukes: [nukeMock("n1")],
    });
    const safe = roomSnapshot({ roomName: "W8N4", terminal: terminalMock({}) });

    terminalManagerSystem.run(makeContext([alert, safe]));

    expect(alert.terminal.send).not.toHaveBeenCalled();
  });

  it("非能量资源发完后能量兜底（留运费地板）", () => {
    const alert = roomSnapshot({
      roomName: "W7N4",
      terminal: terminalMock({ energy: 10000 }),
      nukes: [nukeMock("n1")],
    });
    const safe = roomSnapshot({ roomName: "W8N4", terminal: terminalMock({}) });

    terminalManagerSystem.run(makeContext([alert, safe]));

    // 10000 - 2000（terminalEnergyReserveFloor）= 8000。
    expect(alert.terminal.send).toHaveBeenCalledWith("energy", 8000, "W8N4");
  });

  it("无警报房不触发抢救（常态零行为）", () => {
    const calm = roomSnapshot({
      roomName: "W7N4",
      terminal: terminalMock({ power: 500 }),
    });
    const safe = roomSnapshot({ roomName: "W8N4", terminal: terminalMock({}) });

    terminalManagerSystem.run(makeContext([calm, safe]));

    expect(calm.terminal.send).not.toHaveBeenCalled();
    expect(salvageEvents()).toHaveLength(0);
  });
});
