/** 远矿 hauler container 就近优先选择测试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findRemoteContainer } from "../../../src/creeps/roles/remote-hauler";
import { mockCreep, resetGlobals } from "../../support/factories";

const targetRoom = "W2N1";

beforeEach(() => {
  resetGlobals();
});

function mockContainer(id: string, energy: number, range: number) {
  return {
    id,
    structureType: STRUCTURE_CONTAINER,
    store: {
      getUsedCapacity: (_r?: unknown) => energy,
      getFreeCapacity: (_r?: unknown) => 2000 - energy,
    },
    pos: { x: 10, y: 10, roomName: targetRoom, __range: range },
  };
}

function makeHauler(name: string, containers: unknown[], used = 0, capacity = 100) {
  const creep = mockCreep({ name, role: "remoteHauler", used, capacity });
  creep.memory.remoteTarget = targetRoom;
  creep.room = {
    name: targetRoom,
    find: vi.fn((t: number) => (t === FIND_STRUCTURES ? containers : [])),
  };
  // 按各 container 的 __range 返回距离
  creep.pos.getRangeTo = vi.fn((target: any) => target?.pos?.__range ?? 1);
  return creep;
}

describe("remote-hauler — findRemoteContainer 就近优先", () => {
  it("Round 1：近处够满载时选近处，即使远处更满", () => {
    const g = globalThis as any;
    // 近处 100 能量（够满载 carryFree=100），远处 2000 能量。
    const near = mockContainer("c-near", 100, 3);
    const far = mockContainer("c-far", 2000, 20);
    const hauler = makeHauler("rhaul-1", [far, near]);
    g.Game.creeps = { "rhaul-1": hauler };

    const picked = findRemoteContainer(hauler);
    expect(picked?.id).toBe("c-near");
  });

  it("Round 1：近处不够满载但远处够时选远处一次取满", () => {
    const g = globalThis as any;
    // carryFree=100，近处 80（不够满载），远处 2000（够满载）。
    // Round 1 命中远处 — 一次取满比近处取 80 再跑远处补 20 更快。
    const near = mockContainer("c-near", 80, 3);
    const far = mockContainer("c-far", 2000, 20);
    const hauler = makeHauler("rhaul-1", [far, near]);
    g.Game.creeps = { "rhaul-1": hauler };

    const picked = findRemoteContainer(hauler);
    expect(picked?.id).toBe("c-far");
  });

  it("Round 2：无够满载源时选最近的值得专程的 container", () => {
    const g = globalThis as any;
    // carryFree=100，worthwhile=30。近处 40（≥30 但 < 100），远处 80（≥30 但 < 100）。
    // Round 1 都不够满载 → Round 2 选最近的值得专程的 → 近处。
    const near = mockContainer("c-near", 40, 3);
    const far = mockContainer("c-far", 80, 20);
    const hauler = makeHauler("rhaul-1", [far, near]);
    g.Game.creeps = { "rhaul-1": hauler };

    const picked = findRemoteContainer(hauler);
    expect(picked?.id).toBe("c-near");
  });

  it("Round 2：近处低于值得专程阈值时跳到远处", () => {
    const g = globalThis as any;
    // carryFree=100，worthwhile=30。近处 20（< 30），远处 50（≥ 30 且 < 100）。
    // Round 1 都不够满载 → Round 2 近处 20 < 30 不值得 → 远处 50 ≥ 30 → 选远处。
    const near = mockContainer("c-near", 20, 3);
    const far = mockContainer("c-far", 50, 20);
    const hauler = makeHauler("rhaul-1", [far, near]);
    g.Game.creeps = { "rhaul-1": hauler };

    const picked = findRemoteContainer(hauler);
    expect(picked?.id).toBe("c-far");
  });

  it("Round 3：所有 container 都不值得专程时选能量最大的", () => {
    const g = globalThis as any;
    // carryFree=100，worthwhile=30。近处 5，远处 15（都 < 30）。
    const near = mockContainer("c-near", 5, 3);
    const far = mockContainer("c-far", 15, 20);
    const hauler = makeHauler("rhaul-1", [far, near]);
    g.Game.creeps = { "rhaul-1": hauler };

    const picked = findRemoteContainer(hauler);
    expect(picked?.id).toBe("c-far");
  });

  it("空 container 列表返回 undefined", () => {
    const g = globalThis as any;
    const hauler = makeHauler("rhaul-1", []);
    g.Game.creeps = { "rhaul-1": hauler };

    expect(findRemoteContainer(hauler)).toBeUndefined();
  });

  it("背包已满（carryFree=0）时返回 undefined", () => {
    const g = globalThis as any;
    const container = mockContainer("c1", 1000, 1);
    // used=100, capacity=100 → carryFree=0
    const hauler = makeHauler("rhaul-1", [container], 100, 100);
    g.Game.creeps = { "rhaul-1": hauler };

    expect(findRemoteContainer(hauler)).toBeUndefined();
  });

  it("同距时 Round 1 选数组中第一个够满载的", () => {
    const g = globalThis as any;
    // 两个 container 距离相同（range=5），都够满载（carryFree=50）。
    const a = mockContainer("c-a", 200, 5);
    const b = mockContainer("c-b", 200, 5);
    const hauler = makeHauler("rhaul-1", [a, b]);
    g.Game.creeps = { "rhaul-1": hauler };

    const picked = findRemoteContainer(hauler);
    expect(picked?.id).toBe("c-a");
  });
});
