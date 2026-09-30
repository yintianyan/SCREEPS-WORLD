import { beforeEach, describe, expect, it, vi } from "vitest";
import { stationaryMine } from "../../../src/creeps/engine/actions/harvest";
import { getIntentLedger } from "../../../src/creeps/movement/intent";
import { resetGlobals } from "../../support/factories";

/**
 * 债单 #41：无下游出口时不得把背包倒在地上。
 * drop 的触发条件本身就是「本房消化不了这度电」的时候 —— 落地即衰减，再被 hauler 捡回来走一趟。
 */
function makeAc(opts: {
  carryFree: number;
  carryUsed: number;
  containerFree: number;
  storage?: unknown;
}) {
  const container = {
    id: "c1",
    hits: 25000,
    hitsMax: 25000,
    pos: { x: 5, y: 5, roomName: "W8N8" },
    store: {
      getFreeCapacity: vi.fn(() => opts.containerFree),
      getUsedCapacity: vi.fn(() => 2000),
    },
  };
  const source = { id: "s1", pos: { x: 5, y: 5, roomName: "W8N8" } };
  const pos = {
    x: 5,
    y: 5,
    roomName: "W8N8",
    getRangeTo: vi.fn(() => 0),
    getDirectionTo: vi.fn(() => 3),
    isEqualTo: vi.fn(() => true),
  };
  const creep = {
    name: "harvester.W8N8.1",
    pos,
    memory: { home: "W8N8", role: "harvester" },
    store: {
      getFreeCapacity: vi.fn(() => opts.carryFree),
      getUsedCapacity: vi.fn(() => opts.carryUsed),
    },
    harvest: vi.fn(() => OK),
    transfer: vi.fn(() => OK),
    drop: vi.fn(() => OK),
    move: vi.fn(() => OK),
  };
  const ac = {
    creep,
    snapshot: {
      roomName: "W8N8",
      storage: opts.storage,
      sources: [source],
      structures: [container],
      myStructures: [container],
      containers: [container],
      droppedEnergy: [],
      tombstones: [],
      ruins: [],
      find: vi.fn(() => []),
      hasVisual: true,
    },
    room: { find: vi.fn(() => []), energyAvailable: 300, energyCapacityAvailable: 550 },
    controller: { my: true, level: 3 },
    spawn: {},
    pathfindingCache: {},
  };
  return {
    ac,
    creep,
    container: container as unknown as StructureContainer,
    source: source as unknown as Source,
  };
}

describe("stationaryMine — 下游全满且无 storage 时保持背包（#41）", () => {
  beforeEach(() => {
    resetGlobals();
    getIntentLedger();
  });

  it("幼房（无 storage + container 满 + 背包满）：不 drop、不再签发 harvest，能量留在背包里", () => {
    const { ac, creep, container, source } = makeAc({
      carryFree: 0,
      carryUsed: 200,
      containerFree: 0,
      storage: undefined,
    });

    stationaryMine().execute!(ac as any, { source, container, link: undefined } as any);

    expect(creep.drop).not.toHaveBeenCalled();
    expect(creep.harvest).not.toHaveBeenCalled();
    expect(creep.store.getUsedCapacity()).toBe(200);
  });

  it("container 被消费侧排空后同一判据自动恢复采集", () => {
    const { ac, creep, container, source } = makeAc({
      carryFree: 0,
      carryUsed: 200,
      containerFree: 500,
      storage: undefined,
    });

    stationaryMine().execute!(ac as any, { source, container, link: undefined } as any);

    expect(creep.harvest).toHaveBeenCalled();
  });

  it("成熟房（有 storage）：container 暂满仍按旧行为 drop 继续采 —— 吞吐换损耗是对的", () => {
    const { ac, creep, container, source } = makeAc({
      carryFree: 0,
      carryUsed: 200,
      containerFree: 0,
      storage: { id: "st1", pos: { x: 10, y: 10, roomName: "W8N8" }, store: {} },
    });

    stationaryMine().execute!(ac as any, { source, container, link: undefined } as any);

    expect(creep.drop).toHaveBeenCalled();
  });

  it("背包仍有空位时不受影响（本来就不会走 drop 分支）", () => {
    const { ac, creep, container, source } = makeAc({
      carryFree: 150,
      carryUsed: 50,
      containerFree: 0,
      storage: undefined,
    });

    stationaryMine().execute!(ac as any, { source, container, link: undefined } as any);

    expect(creep.harvest).toHaveBeenCalled();
    expect(creep.drop).not.toHaveBeenCalled();
  });
});
