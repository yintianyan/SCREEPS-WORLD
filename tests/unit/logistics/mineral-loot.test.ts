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
import { harvestMineral } from "../../../src/creeps/engine/actions/harvest";
import { mockCreep, mockContext, mockSnapshot, mockStructure, resetGlobals } from "../../role-helpers";

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
    // 需有 storage/terminal 作矿物卸货出口，否则门禁不取矿物（防无处倒而冻结）。
    const snap = mockSnapshot({ tombstones: [t] as never, storage: mockStructure("storage", { id: "st", energy: 0, capacity: 1000000 }) });
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

describe("harvestMineral — 站位以贴 mineral 的 container 为通勤终点（防穿梭）", () => {
  it("mineral 旁有 container → 通勤终点是 container（站上去零穿梭），非 mineral 本体", () => {
    const mineral = { id: "min1", mineralType: "Z", mineralAmount: 50000, pos: { x: 7, y: 33, getRangeTo: () => 1 } };
    const container = mockStructure("container", { id: "mc", energy: 0, capacity: 2000 });
    container.pos = { x: 6, y: 33, getRangeTo: () => 1 } as never; // 贴 mineral（range 1）
    const extractor = mockStructure("extractor", { id: "ext1" });
    const snap = mockSnapshot({
      minerals: [mineral] as never,
      containers: [container],
      extractor: extractor as never,
    });
    // creep 离 mineral 远 → harvest 返回 ERR_NOT_IN_RANGE → 朝站位移动。
    const creep = mockCreep({ name: "mineralMiner_0", role: "mineralMiner", used: 0, capacity: 50, mode: "acquire" });
    (creep.harvest as any).mockReturnValue(ERR_NOT_IN_RANGE);
    creep.pos.getRangeTo.mockReturnValue(5); // 离站位远 → moveToTarget 走 moveTo（非 range<=1 短路）
    const ctx = mockContext(snap);

    const action = harvestMineral();
    const ac = { creep, snapshot: snap, budget: ctx.budget, ctx } as never;
    const target = action.resolve!(ac);
    action.execute(ac, target as never);

    // 通勤终点是 container 的 pos（站上去 range0 倒 + range1 采），而非 mineral 本体。
    expect(creep.moveTo).toHaveBeenCalledWith(container.pos, expect.anything());
  });
});

