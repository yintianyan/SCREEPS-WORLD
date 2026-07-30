/**
 * 矿物搬运链修复测试（updateMode 总量口径 + lootRemains 全资源）。
 *
 * 回归两个线上 bug：
 *   1. updateMode 用纯能量口径判满/空 → 满背包矿物的 creep（mineralMiner 采满 Z）
 *      被误判"空载"，work 模式只活 1 tick 即被踢回 acquire，永久冻结至老死。
 *   2. lootRemains 硬编码只 withdraw 能量 → tombstone 里的矿物无人搬（用户实证：
 *      "带 mineral 的尸体 hauler 只搬能量"）。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { updateMode } from "../../../src/creeps/engine/lifecycle";
import { lootRemains } from "../../../src/creeps/engine/actions/pickup";
import { mockCreep, mockContext, mockSnapshot, resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

/** 多资源 store：getUsedCapacity() 返总量，getUsedCapacity(res) 返该资源量。 */
function multiStore(resources: Record<string, number>, capacity = 50) {
  const total = Object.values(resources).reduce((a, b) => a + b, 0);
  return {
    ...resources,
    getUsedCapacity: (r?: string) => (r === undefined ? total : (resources[r] ?? 0)),
    getFreeCapacity: (_r?: string) => capacity - total,
    getCapacity: (_r?: string) => capacity,
  };
}

describe("updateMode — 总量口径（携矿不误判空载）", () => {
  it("满背包矿物(Z=50,energy=0) + work 模式 → 保持 work（不被踢回 acquire）", () => {
    const creep = mockCreep({ name: "miner", role: "mineralMiner", mode: "work" });
    creep.store = multiStore({ energy: 0, Z: 50 }) as never;
    updateMode(creep);
    // 旧 bug：used(energy)=0 → 切回 acquire；修复后 used(total)=50 → 保持 work。
    expect(creep.memory.mode).toBe("work");
  });

  it("满背包矿物 + acquire 模式 → 切 work（去倒矿）", () => {
    const creep = mockCreep({ name: "miner", role: "mineralMiner", mode: "acquire" });
    creep.store = multiStore({ energy: 0, Z: 50 }) as never;
    updateMode(creep);
    expect(creep.memory.mode).toBe("work");
  });

  it("空背包 + idle 恢复 → acquire（去采集）", () => {
    const creep = mockCreep({ name: "miner", role: "mineralMiner", mode: "idle" });
    creep.store = multiStore({ energy: 0 }) as never;
    updateMode(creep);
    expect(creep.memory.mode).toBe("acquire");
  });

  it("纯能量角色行为不变：满能量 + work → 保持 work", () => {
    const creep = mockCreep({ name: "hauler", role: "hauler", mode: "work" });
    creep.store = multiStore({ energy: 50 }) as never;
    updateMode(creep);
    expect(creep.memory.mode).toBe("work");
  });
});

describe("lootRemains — 搬运尸体内矿物（不只搬能量）", () => {
  /** 造带指定资源的 tombstone，range 1。 */
  function tomb(resources: Record<string, number>) {
    const store = multiStore(resources, 2000);
    return {
      id: "tomb1",
      store,
      pos: { x: 25, y: 25, getRangeTo: () => 1 },
    };
  }

  it("尸体只有矿物(Z=200,无能量)→ withdraw 矿物 Z（旧 bug：只搬 energy 忽略矿物）", () => {
    const t = tomb({ Z: 200 });
    const snap = mockSnapshot({ tombstones: [t] as never });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 800, mode: "acquire" });
    const ctx = mockContext(snap);

    const action = lootRemains(1);
    const ac = { creep, snapshot: snap, budget: ctx.budget, ctx } as never;
    const target = action.resolve!(ac);
    expect(target).toBeTruthy();
    action.execute(ac, target as never);
    expect(creep.withdraw).toHaveBeenCalledWith(t, "Z", 200);
  });

  it("尸体有能量+矿物 → 能量优先 withdraw energy", () => {
    const t = tomb({ energy: 300, Z: 200 });
    const snap = mockSnapshot({ tombstones: [t] as never });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 800, mode: "acquire" });
    const ctx = mockContext(snap);

    const action = lootRemains(1);
    const target = action.resolve!({ creep, snapshot: snap, budget: ctx.budget, ctx } as never);
    action.execute({ creep, snapshot: snap, budget: ctx.budget, ctx } as never, target as never);
    expect(creep.withdraw).toHaveBeenCalledWith(t, "energy", 300);
  });
});
