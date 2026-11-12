/** Phase C：factory 能量回收阀（crisis 全搬 / 运营上限只搬超出 stockTarget 的部分）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reclaimFactoryOutput } from "../../../src/creeps/engine/actions/industry";
import type { ActionContext } from "../../../src/creeps/engine/action-types";
import { CONFIG } from "../../../src/config";
import { mockPos, mockSnapshot, resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

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

function makeAc(opts: {
  storage?: Record<string, number>;
  factory?: Record<string, number>;
  carried?: Record<string, number>;
}): ActionContext {
  const creep = {
    name: "dist-1",
    store: makeStore({ ...(opts.carried ?? {}) }, 300),
    memory: { role: "distributor", home: "W8N3" },
    pos: mockPos(25, 25),
    room: { name: "W8N3" },
  } as unknown as Creep;
  const snapshot = mockSnapshot({
    roomName: "W8N3",
    storage: { store: makeStore(opts.storage ?? {}, 1000000) } as any,
    factory: { store: makeStore(opts.factory ?? {}, 50000), cooldown: 0 } as any,
  });
  return { creep, snapshot, assignment: undefined, budget: {} as any, ctx: {} as any };
}

describe("reclaimFactoryOutput — 运营上限回收", () => {
  it("factory energy 超 stockTarget 且 storage <300K（解压期）→ 只搬超出 stockTarget 的部分", () => {
    const ac = makeAc({ storage: { energy: 84000 }, factory: { energy: 49865 } });
    const target = reclaimFactoryOutput().resolve(ac) as any;
    expect(target.phase).toBe("withdraw");
    expect(target.resource).toBe("energy");
    expect(target.amount).toBe(49865 - CONFIG.factory.stockTarget);
  });

  it("factory energy 未超运营水位（< stockTarget）→ 不回收（保留生产原料）", () => {
    const ac = makeAc({ storage: { energy: 84000 }, factory: { energy: 2000 } });
    expect(reclaimFactoryOutput().resolve(ac)).toBeUndefined();
  });

  it("storage 已达解压目标（300K）→ 不回收（storage 不缺能）", () => {
    const ac = makeAc({ storage: { energy: 310000 }, factory: { energy: 49865 } });
    expect(reclaimFactoryOutput().resolve(ac)).toBeUndefined();
  });

  it("crisis（storage <20K）→ 全搬，不保留 stockTarget", () => {
    const ac = makeAc({ storage: { energy: 10000 }, factory: { energy: 5000 } });
    const target = reclaimFactoryOutput().resolve(ac) as any;
    expect(target.phase).toBe("withdraw");
    expect(target.amount).toBeUndefined();
  });

  it("携带能量 + 超运营上限 → 送 storage", () => {
    const ac = makeAc({
      storage: { energy: 84000 },
      factory: { energy: 49865 },
      carried: { energy: 200 },
    });
    const target = reclaimFactoryOutput().resolve(ac) as any;
    expect(target.phase).toBe("deposit");
    expect(target.resource).toBe("energy");
  });

  it("回归：amount 超出背包容量时必须截断（否则 withdraw 返 ERR_FULL，一格都取不到）", () => {
    // resolve 给的是库存口径（49,865 − 3,000 = 46,865），而 creep 容量只有 300。
    // 直接把 46,865 传给 withdraw ⇒ 引擎判 ERR_FULL ⇒ 7 只空仓 distributor
    // 围着 factory 转上千拍而库存纹丝不动（W8N3 实测）。
    const ac = makeAc({ storage: { energy: 84000 }, factory: { energy: 49865 } });
    const target = reclaimFactoryOutput().resolve(ac) as any;
    expect(target.amount).toBe(46865);

    const creep = ac.creep as any;
    creep.withdraw = vi.fn(() => OK);
    reclaimFactoryOutput().execute(ac, target);
    expect(creep.withdraw).toHaveBeenCalledWith(expect.anything(), "energy", 300);
  });
});
