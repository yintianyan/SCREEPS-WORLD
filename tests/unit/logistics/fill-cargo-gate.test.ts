/** fill 动作携非能量 cargo 放行门禁测试（回归）。 */
import { describe, expect, it, beforeEach } from "vitest";
import { distributorFillTarget, haulFillTarget } from "../../../src/creeps/engine/actions/fill";
import { mockCreep, mockContext, mockSnapshot, mockStructure, resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

/** 多资源 store：getUsedCapacity() 返总量，getUsedCapacity(res) 返该资源量。 */
function multiStore(resources: Record<string, number>, capacity = 100) {
  const total = Object.values(resources).reduce((a, b) => a + b, 0);
  return {
    ...resources,
    getUsedCapacity: (r?: string) => (r === undefined ? total : (resources[r] ?? 0)),
    getFreeCapacity: (_r?: string) => capacity - total,
    getCapacity: (_r?: string) => capacity,
  };
}

describe("fill 动作 — 携非能量 cargo 放行门禁（防 updateMode 总量口径冻结）", () => {
  function snapWithTarget() {
    const spawn = mockStructure("spawn", { id: "sp", energy: 0, capacity: 300 });
    return mockSnapshot({ fillTargets: [spawn] as never });
  }

  it("distributorFillTarget：携化合物(GH=50)无能量 → resolve 返回 undefined（放行卸货）", () => {
    const snap = snapWithTarget();
    const creep = mockCreep({ name: "dist_1", role: "distributor", mode: "work" });
    creep.store = multiStore({ energy: 0, GH: 50 }) as never;
    const ctx = mockContext(snap);
    const target = distributorFillTarget().resolve!({ creep, snapshot: snap, budget: ctx.budget, ctx } as never);
    expect(target).toBeUndefined();
  });

  it("distributorFillTarget：携能量正常 → resolve 命中目标（行为不变）", () => {
    const snap = snapWithTarget();
    const creep = mockCreep({ name: "dist_1", role: "distributor", mode: "work" });
    creep.store = multiStore({ energy: 50 }) as never;
    creep.memory.distributorTier = 0;
    const ctx = mockContext(snap);
    const target = distributorFillTarget().resolve!({ creep, snapshot: snap, budget: ctx.budget, ctx } as never);
    expect(target).toBeTruthy();
  });

  it("haulFillTarget：携矿物(Z=50)无能量 → resolve 返回 undefined（放行卸货）", () => {
    const snap = snapWithTarget();
    const creep = mockCreep({ name: "hauler_1", role: "hauler", mode: "work" });
    creep.store = multiStore({ energy: 0, Z: 50 }) as never;
    const ctx = mockContext(snap);
    const target = haulFillTarget().resolve!({ creep, snapshot: snap, budget: ctx.budget, ctx } as never);
    expect(target).toBeUndefined();
  });
});
