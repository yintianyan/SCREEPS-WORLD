/** Phase B：distributor 的 terminal 出口车道动作（resolve 分支）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { terminalExportLane } from "../../../src/creeps/engine/actions/industry";
import type { ActionContext } from "../../../src/creeps/engine/action-types";
import { globalCache } from "../../../src/kernel/global-cache";
import { mockPos, mockSnapshot, resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  delete (globalThis as any).marketOrderCache;
  delete (globalThis as any).exportNeeds;
  delete (globalThis as any).surplusCompounds;
});

/** 按资源维度的 store mock（Object.entries 可直接读到资源键）。 */
function makeStore(resources: Record<string, number>, capacity: number) {
  const used = (resource?: string): number =>
    resource === undefined
      ? Object.values(resources).reduce((sum, amount) => sum + amount, 0)
      : (resources[resource] ?? 0);
  return {
    ...resources,
    getUsedCapacity: used,
    getFreeCapacity: (resource?: string) => capacity - used(resource),
    getCapacity: () => capacity,
  };
}

/** 让订单缓存里出现指定资源的买盘。 */
function withBuyOrders(resources: string[]): void {
  const orders: Record<string, { id: string; price: number; amount: number; roomName: string }[]> =
    {};
  for (const resource of resources) {
    orders[`buy/${resource}`] = [
      { id: `o-${resource}`, price: 10, amount: 100000, roomName: "W7N3" },
    ];
  }
  globalCache().marketOrderCache = { tick: 1000, orders };
}

function makeAc(opts: {
  storage?: Record<string, number>;
  terminal?: Record<string, number>;
  terminalCapacity?: number;
  carried?: Record<string, number>;
  carryCapacity?: number;
  homeMineral?: string;
  fillTargets?: any[];
}): ActionContext {
  const storage = makeStore(opts.storage ?? {}, 1000000);
  const terminal = makeStore(opts.terminal ?? {}, opts.terminalCapacity ?? 300000);
  const creep = {
    name: "dist-1",
    store: makeStore({ ...(opts.carried ?? {}) }, opts.carryCapacity ?? 300),
    memory: { role: "distributor", home: "W7N4" },
    pos: mockPos(25, 25),
    room: { name: "W7N4" },
  } as unknown as Creep;
  const snapshot = mockSnapshot({
    storage: { store: storage } as any,
    terminal: { store: terminal } as any,
    minerals: opts.homeMineral
      ? [{ mineralType: opts.homeMineral, mineralAmount: 5000 } as any]
      : [],
    fillTargets: (opts.fillTargets ?? []) as any,
  });
  return { creep, snapshot, assignment: undefined, budget: {} as any, ctx: {} as any };
}

describe("terminalExportLane.resolve — trim", () => {
  it("terminal battery 超配额 + 空载 → 去 terminal 取超出的部分", () => {
    const ac = makeAc({
      storage: { battery: 50000 },
      terminal: { battery: 210423 },
    });
    const target = terminalExportLane().resolve(ac) as any;
    expect(target.phase).toBe("trim-withdraw");
    expect(target.resource).toBe("battery");
    expect(target.amount).toBe(160423);
  });

  it("携带超配额资源 → 送回 storage", () => {
    const ac = makeAc({
      storage: { battery: 50000 },
      terminal: { battery: 210423 },
      carried: { battery: 300 },
    });
    const target = terminalExportLane().resolve(ac) as any;
    expect(target.phase).toBe("trim-deposit");
    expect(target.resource).toBe("battery");
  });

  it("携带能量的 distributor → undefined（让位给 spawn/extension 填充）", () => {
    const ac = makeAc({
      storage: { battery: 50000 },
      terminal: { battery: 210423 },
      carried: { energy: 200 },
    });
    expect(terminalExportLane().resolve(ac)).toBeUndefined();
  });

  it("配额内且无 ticket → undefined", () => {
    const ac = makeAc({ storage: { H: 71393 }, terminal: { battery: 1000 } });
    expect(terminalExportLane().resolve(ac)).toBeUndefined();
  });

  it("spawn/extension 有空位 → 让位给补能（生命线守卫）", () => {
    const ac = makeAc({
      storage: { battery: 50000 },
      terminal: { battery: 210423 },
      fillTargets: [{ structureType: "extension", pos: mockPos(20, 20) }],
    });
    expect(terminalExportLane().resolve(ac)).toBeUndefined();
  });

  it("只有 tower 缺口（无 spawn/extension）→ trim 仍然执行", () => {
    const ac = makeAc({
      storage: { battery: 50000 },
      terminal: { battery: 210423 },
      fillTargets: [{ structureType: "tower", pos: mockPos(20, 20) }],
    });
    const target = terminalExportLane().resolve(ac) as any;
    expect(target.phase).toBe("trim-withdraw");
  });
});

describe("terminalExportLane.resolve — export", () => {
  it("storage 有 home mineral + 买盘 → 去 storage 取货", () => {
    withBuyOrders(["H"]);
    const ac = makeAc({ storage: { H: 71393 }, homeMineral: "H" });
    const target = terminalExportLane().resolve(ac) as any;
    expect(target.phase).toBe("export-withdraw");
    expect(target.resource).toBe("H");
    // H terminal 配额 20,000。
    expect(target.amount).toBe(20000);
  });

  it("无买盘、无 aid → 不搬", () => {
    const ac = makeAc({ storage: { H: 71393 }, homeMineral: "H" });
    expect(terminalExportLane().resolve(ac)).toBeUndefined();
  });

  it("有跨房 aid 需求（无买盘）→ 仍然搬", () => {
    globalCache().exportNeeds = {
      tick: 1000,
      byRoom: { W7N4: [{ resource: "H", amount: 5000, deadline: 1200 }] },
    };
    const ac = makeAc({ storage: { H: 71393 }, homeMineral: "H" });
    const target = terminalExportLane().resolve(ac) as any;
    expect(target.phase).toBe("export-withdraw");
    expect(target.resource).toBe("H");
    expect(target.amount).toBe(5000);
  });

  it("携带导出资源 → 送 terminal", () => {
    withBuyOrders(["wire"]);
    const ac = makeAc({
      storage: { wire: 8000 },
      carried: { wire: 300 },
    });
    const target = terminalExportLane().resolve(ac) as any;
    expect(target.phase).toBe("export-deposit");
    expect(target.resource).toBe("wire");
  });

  it("订单缓存过期 → 视为无买盘", () => {
    withBuyOrders(["H"]);
    globalCache().marketOrderCache = { tick: 0, orders: globalCache().marketOrderCache!.orders };
    const ac = makeAc({ storage: { H: 71393 }, homeMineral: "H" });
    expect(terminalExportLane().resolve(ac)).toBeUndefined();
  });

  it("aid 需求过期 → 不搬", () => {
    globalCache().exportNeeds = {
      tick: 1000,
      byRoom: { W7N4: [{ resource: "H", amount: 5000, deadline: 999 }] },
    };
    const ac = makeAc({ storage: { H: 71393 }, homeMineral: "H" });
    expect(terminalExportLane().resolve(ac)).toBeUndefined();
  });
});
