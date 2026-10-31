/** R672：施工优先供能 —— hauler→低能 builder transfer / 工地旁 drop。 */
import { describe, expect, it, vi } from "vitest";
import {
  dropNearConstruction,
  transferToLowBuilder,
} from "../../../src/creeps/engine/actions/feed";

function builder(role: string, free: number, range: number) {
  return {
    memory: { role },
    spawning: false,
    store: { getFreeCapacity: () => free },
    pos: {},
    range,
  };
}

function makeAc(opts: {
  sites: number;
  energy: number;
  nearby?: any[];
  siteRange?: number;
  piles?: any[];
  coreFree?: number;
  coreCap?: number;
}) {
  const site = { pos: {} };
  const creep = {
    memory: {},
    store: { getUsedCapacity: () => opts.energy },
    pos: {
      getRangeTo: (t: any) => (t === site ? (opts.siteRange ?? 99) : t.range),
      isEqualTo: () => false,
    },
    room: { find: () => opts.nearby ?? [] },
    transfer: () => OK,
    drop: () => OK,
  };
  const coreCap = opts.coreCap ?? 300;
  const coreFree = opts.coreFree ?? 0;
  const ac: any = {
    creep,
    snapshot: {
      myConstructionSites: Array.from({ length: opts.sites }, () => site),
      droppedEnergy: opts.piles ?? [],
      // 默认：核心已满（free=0 ⇒ 不在 fillTargets 里；按生产口径空数组也满足门控）。
      fillTargets:
        coreFree > 0
          ? [
              {
                structureType: "spawn",
                store: {
                  getFreeCapacity: () => coreFree,
                  getCapacity: () => coreCap,
                },
              },
            ]
          : [],
    },
    budget: { tier: "healthy" },
  };
  return { ac, site };
}

describe("transferToLowBuilder — R672", () => {
  it("4 格内缺能 builder 且携能 ⇒ 选中它", () => {
    const b = builder("builder", 50, 2);
    const { ac } = makeAc({ sites: 1, energy: 50, nearby: [b] });
    expect(transferToLowBuilder().resolve!(ac)).toBe(b);
  });

  it("无在建工地 ⇒ 不生效（成熟房行为不变）", () => {
    const b = builder("builder", 50, 1);
    const { ac } = makeAc({ sites: 0, energy: 50, nearby: [b] });
    expect(transferToLowBuilder().resolve!(ac)).toBeUndefined();
  });

  it("附近 builder 已接近满 ⇒ 不抢它的补给", () => {
    const b = builder("builder", 10, 1);
    const { ac } = makeAc({ sites: 1, energy: 50, nearby: [b] });
    expect(transferToLowBuilder().resolve!(ac)).toBeUndefined();
  });

  it("空载 hauler ⇒ 不生效", () => {
    const b = builder("builder", 50, 1);
    const { ac } = makeAc({ sites: 1, energy: 0, nearby: [b] });
    expect(transferToLowBuilder().resolve!(ac)).toBeUndefined();
  });

  it("核心（spawn/extension）还空着 ⇒ 先填核心，不喂 builder（R672b 门控）", () => {
    const b = builder("builder", 50, 1);
    const { ac } = makeAc({
      sites: 1,
      energy: 50,
      nearby: [b],
      coreFree: 300,
      coreCap: 300,
    });
    expect(transferToLowBuilder().resolve!(ac)).toBeUndefined();
  });

  it("核心空闲 ≤25% ⇒ 放行供建造", () => {
    const b = builder("builder", 50, 1);
    const { ac } = makeAc({
      sites: 1,
      energy: 50,
      nearby: [b],
      coreFree: 50,
      coreCap: 300,
    });
    expect(transferToLowBuilder().resolve!(ac)).toBe(b);
  });
});

describe("dropNearConstruction — R672", () => {
  it("2 格内在建工地且脚下无堆 ⇒ drop", () => {
    const { ac } = makeAc({ sites: 1, energy: 50, siteRange: 2 });
    expect(dropNearConstruction().resolve!(ac)).toBeDefined();
  });

  it("离工地 >2 格 ⇒ 不乱丢", () => {
    const { ac } = makeAc({ sites: 1, energy: 50, siteRange: 5 });
    expect(dropNearConstruction().resolve!(ac)).toBeUndefined();
  });

  it("脚下已有能量堆 ⇒ 不叠加", () => {
    const pile = { pos: {}, range: 0 };
    const { ac } = makeAc({ sites: 1, energy: 50, siteRange: 1, piles: [pile] });
    expect(dropNearConstruction().resolve!(ac)).toBeUndefined();
  });

  it("核心还空着 ⇒ 不往工地丢（R672b 门控）", () => {
    const { ac } = makeAc({
      sites: 1,
      energy: 50,
      siteRange: 1,
      coreFree: 200,
      coreCap: 300,
    });
    expect(dropNearConstruction().resolve!(ac)).toBeUndefined();
  });
});

import { haulerRole } from "../../../src/creeps/roles/hauler";
import {
  mockContext,
  mockCreep,
  mockPos,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

describe("施工期 hauler 填充顺序 — R672", () => {
  function run(hasSites: boolean) {
    resetGlobals();
    const cc = mockStructure("container", { id: "cc1", energy: 100, capacity: 2000 });
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({
      controllerContainer: cc,
      fillTargets: [spawn, cc],
      myConstructionSites: hasSites
        ? [mockStructure("extension", { id: "ext1", energy: 0, capacity: 50 })]
        : [],
    });
    const creep = mockCreep({
      name: "hauler_x",
      role: "hauler",
      used: 80,
      capacity: 100,
      mode: "work",
    });
    haulerRole.run(creep, mockContext(snap));
    return { creep, cc, spawn };
  }

  it("有在建工地：即使 CC 低于半满，也先填 spawn（不被 CC 锁死）", () => {
    const { creep, cc, spawn } = run(true);
    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
    expect(creep.transfer).not.toHaveBeenCalledWith(cc, "energy");
  });

  it("无在建工地：保留原行为（CC 低于半满优先补给）", () => {
    const { creep, cc } = run(false);
    expect(creep.transfer).toHaveBeenCalledWith(cc, "energy");
  });

  it("核心接近满 + 附近缺能 builder ⇒ 链上真的轮到 feed 车道（可达性）", () => {
    resetGlobals();
    const cc = mockStructure("container", { id: "cc1", energy: 100, capacity: 2000 });
    // spawn 280/300：空闲 20 ≤ 25% 容量 ⇒ 门控放行。
    const spawn = mockStructure("spawn", { id: "sp1", energy: 280, capacity: 300 });
    const snap = mockSnapshot({
      controllerContainer: cc,
      fillTargets: [spawn, cc],
      myConstructionSites: [mockStructure("extension", { id: "ext1", energy: 0, capacity: 50 })],
    });
    const mate = {
      name: "builder_x",
      memory: { role: "builder", home: "W7N4" },
      spawning: false,
      store: { getFreeCapacity: () => 50 },
      pos: mockPos(26, 25),
    };
    const pos = mockPos(25, 25);
    const creep = mockCreep({
      name: "hauler_x",
      role: "hauler",
      used: 80,
      capacity: 100,
      mode: "work",
      pos,
    });
    (creep.room as any).find = vi.fn(() => [mate]);

    haulerRole.run(creep, mockContext(snap));

    expect(creep.transfer).toHaveBeenCalledWith(mate, "energy");
    expect(creep.transfer).not.toHaveBeenCalledWith(cc, "energy");
  });
});
