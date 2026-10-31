/** R678：lab 搬运/矿物补仓的目标级配额（每 tick 每目标 1 人）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { haulMineralTopUp, supplyLabs } from "../../../src/creeps/engine/actions/industry";
import { claimTaskTarget, taskTargetClaimedByOther } from "../../../src/creeps/support/task-claims";
import { globalCache } from "../../../src/kernel/global-cache";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

function ac(creep: any, snapshot: any): any {
  return {
    creep,
    snapshot,
    assignment: undefined,
    budget: { tier: "healthy" },
    ctx: mockContext(snapshot),
  };
}

beforeEach(() => resetGlobals());

describe("task-claims — 基础语义", () => {
  it("同一 tick 他人已占用 ⇒ 返回 true；本人复用不算被占；换 tick 自动清空", () => {
    claimTaskTarget("lab", "L1:energy", "a");
    expect(taskTargetClaimedByOther("lab", "L1:energy", "b")).toBe(true);
    expect(taskTargetClaimedByOther("lab", "L1:energy", "a")).toBe(false);
    (globalThis as any).Game.time += 1;
    expect(taskTargetClaimedByOther("lab", "L1:energy", "b")).toBe(false);
  });
});

describe("supplyLabs — 同一 lab+资源每 tick 只派一人", () => {
  function setup() {
    const lab = mockStructure("lab", { id: "lab1", energy: 0, capacity: 2000 });
    const storage = mockStructure("storage", { id: "st", energy: 10000, capacity: 100000 });
    const snap = mockSnapshot({ labs: [lab], storage });
    globalCache().labDemands = {
      tick: (globalThis as any).Game.time,
      byRoom: {
        W7N4: { loads: [{ labId: "lab1", resource: "energy", amount: 200 }], unloads: [] },
      },
    };
    const a = mockCreep({ name: "a", role: "hauler", used: 50, capacity: 100 });
    const b = mockCreep({ name: "b", role: "hauler", used: 50, capacity: 100 });
    return { snap, a, b };
  }

  it("第一个 creep 占用后，第二个同 tick 解析不到该需求；下一 tick 恢复", () => {
    const { snap, a, b } = setup();
    const action = supplyLabs();
    const ta = action.resolve!(ac(a, snap));
    expect(ta).toBeDefined();
    action.execute!(ac(a, snap), ta!);

    expect(action.resolve!(ac(b, snap))).toBeUndefined();

    (globalThis as any).Game.time += 1;
    expect(action.resolve!(ac(b, snap))).toBeDefined();
  });
});

describe("haulMineralTopUp — 同一矿物容器每 tick 只派一人", () => {
  function setup() {
    const c = mockStructure("container", { id: "mc", energy: 0, capacity: 2000 });
    (c as any).store = {
      H: 1500,
      getUsedCapacity: (r?: string) => (r === undefined ? 1500 : r === "H" ? 1500 : 0),
      getFreeCapacity: () => 500,
      getCapacity: () => 2000,
    };
    const storage = mockStructure("storage", { id: "st", energy: 10000, capacity: 100000 });
    const snap = mockSnapshot({ containers: [c], storage });
    return {
      snap,
      a: mockCreep({ name: "a", role: "hauler", used: 50, capacity: 100 }),
      b: mockCreep({ name: "b", role: "hauler", used: 50, capacity: 100 }),
    };
  }

  it("第一个 creep 执行后，第二个同 tick 不再选同一容器；下一 tick 恢复", () => {
    const { snap, a, b } = setup();
    const action = haulMineralTopUp();
    const ta = action.resolve!(ac(a, snap));
    expect(ta).toBeDefined();
    action.execute!(ac(a, snap), ta as any);

    expect(action.resolve!(ac(b, snap))).toBeUndefined();

    (globalThis as any).Game.time += 1;
    expect(action.resolve!(ac(b, snap))).toBeDefined();
  });
});
