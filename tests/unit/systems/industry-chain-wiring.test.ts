/** 工业链接线测试（TD-023 ~ TD-028）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { supplyLabs } from "../../../src/creeps/engine/actions/industry";
import { computeLabDemands } from "../../../src/systems/lab-system";
import { reclaimExpeditionCreeps } from "../../../src/systems/expansion-manager";
import { syncTaskStates } from "../../../src/domain/construction/queue";
import type { LabPlan } from "../../../src/domain/industry/types";

// ── 受限 store mock（复现引擎语义）────────────────────────────
// lab 的 store 是受限 store：无参 getFreeCapacity() 返回 null。
// 用普通对象 mock 会把这个坑抹平 — 必须显式还原。
function makeLabStore(contents: Record<string, number>): Record<string, unknown> {
  const MINERAL_CAP = 3000;
  const ENERGY_CAP = 2000;
  const store: Record<string, unknown> = { ...contents };
  Object.defineProperty(store, "getFreeCapacity", {
    enumerable: false,
    value: (resource?: string) => {
      if (resource === undefined) return null; // 引擎行为：受限 store 无参返回 null
      const used = (contents[resource] ?? 0);
      return resource === "energy" ? ENERGY_CAP - used : MINERAL_CAP - used;
    },
  });
  Object.defineProperty(store, "getUsedCapacity", {
    enumerable: false,
    value: (resource?: string) => (resource === undefined ? null : contents[resource] ?? 0),
  });
  return store;
}

/** 通用 store mock（storage/terminal/creep — 无限制 store）。 */
function makeStore(contents: Record<string, number>, capacity = 2000): Record<string, unknown> {
  const store: Record<string, unknown> = { ...contents };
  const total = (): number => Object.values(contents).reduce((s, v) => s + v, 0);
  Object.defineProperty(store, "getFreeCapacity", {
    enumerable: false,
    value: () => capacity - total(),
  });
  Object.defineProperty(store, "getUsedCapacity", {
    enumerable: false,
    value: (resource?: string) => (resource === undefined ? total() : contents[resource] ?? 0),
  });
  return store;
}

function makeLab(id: string, contents: Record<string, number>): Record<string, unknown> {
  return { id, store: makeLabStore(contents), structureType: "lab", pos: { x: 25, y: 25 } };
}

const g = globalThis as Record<string, unknown>;

describe("computeLabDemands — 需求表推导（TD-024/025）", () => {
  let labById: Record<string, unknown>;

  beforeEach(() => {
    labById = {};
    g.Game = { time: 100, creeps: {}, getObjectById: (id: string) => labById[id] ?? null };
  });

  it("boost lab 空仓：发布化合物（parts×30）与能量（parts×20）装料需求", () => {
    labById.L1 = makeLab("L1", {});
    const plan: LabPlan = {
      assignments: [{ labId: "L1", role: "boost", boostTarget: "c1", boostCompound: "XUH2O", boostParts: 5 }],
    };
    const table = computeLabDemands(plan);
    expect(table.loads).toContainEqual({ labId: "L1", resource: "XUH2O", amount: 150 });
    expect(table.loads).toContainEqual({ labId: "L1", resource: "energy", amount: 100 });
    expect(table.unloads).toHaveLength(0);
  });

  it("boost lab 装错矿：发布卸料需求且不发化合物装料（先清位再装）", () => {
    labById.L1 = makeLab("L1", { GH: 500 });
    const plan: LabPlan = {
      assignments: [{ labId: "L1", role: "boost", boostTarget: "c1", boostCompound: "XUH2O", boostParts: 5 }],
    };
    const table = computeLabDemands(plan);
    expect(table.unloads).toContainEqual({ labId: "L1", resource: "GH" });
    expect(table.loads.some(l => l.resource === "XUH2O")).toBe(false);
  });

  it("input lab 按反应原料发布装料需求到批次目标量", () => {
    labById.L1 = makeLab("L1", { U: 100 });
    labById.L2 = makeLab("L2", {});
    const plan: LabPlan = {
      assignments: [
        { labId: "L1", role: "input1" },
        { labId: "L2", role: "input2" },
      ],
      reaction: { input1: "U", input2: "H", output: "UH", amount: 5 },
    };
    const table = computeLabDemands(plan);
    expect(table.loads).toContainEqual({ labId: "L1", resource: "U", amount: 200 });
    expect(table.loads).toContainEqual({ labId: "L2", resource: "H", amount: 300 });
  });

  it("output lab 产物攒批：低于阈值不回收，达到阈值发布卸料", () => {
    labById.L1 = makeLab("L1", { UH: 50 });
    labById.L2 = makeLab("L2", { UH: 150 });
    const reaction = { input1: "U", input2: "H", output: "UH", amount: 5 } as const;
    const below = computeLabDemands({ assignments: [{ labId: "L1", role: "output" }], reaction });
    const above = computeLabDemands({ assignments: [{ labId: "L2", role: "output" }], reaction });
    expect(below.unloads).toHaveLength(0);
    expect(above.unloads).toContainEqual({ labId: "L2", resource: "UH" });
  });

  it("idle lab 残留矿物立即发布卸料需求", () => {
    labById.L1 = makeLab("L1", { ZK: 80 });
    const table = computeLabDemands({ assignments: [{ labId: "L1", role: "idle" }] });
    expect(table.unloads).toContainEqual({ labId: "L1", resource: "ZK" });
  });
});

describe("supplyLabs — 按需求表搬运（TD-023 回归 + TD-024）", () => {
  let labById: Record<string, unknown>;

  function makeAc(opts: {
    creepStore: Record<string, number>;
    storageStore?: Record<string, number>;
    terminalStore?: Record<string, number>;
    labs?: unknown[];
  }): Record<string, unknown> {
    const storage = { id: "storage1", store: makeStore(opts.storageStore ?? {}, 100000), structureType: "storage" };
    const terminal = opts.terminalStore
      ? { id: "terminal1", store: makeStore(opts.terminalStore, 100000), structureType: "terminal" }
      : undefined;
    return {
      creep: { name: "c1", store: makeStore(opts.creepStore, 200) },
      snapshot: {
        roomName: "W1N1",
        labs: opts.labs ?? [labById.L1],
        storage,
        terminal,
      },
    };
  }

  function setDemands(loads: unknown[], unloads: unknown[] = [], tick = 100): void {
    g.labDemands = { tick, byRoom: { W1N1: { loads, unloads } } };
  }

  beforeEach(() => {
    labById = { L1: makeLab("L1", {}) };
    g.Game = { time: 100, creeps: {}, getObjectById: (id: string) => labById[id] ?? null };
    delete g.__objCache; // 清 obj-cache，防跨用例污染
    delete g.labDemands;
  });

  it("P0 回归：携带化合物 + lab 为受限 store（无参 getFreeCapacity 返回 null）仍能解析出 deposit", () => {
    setDemands([{ labId: "L1", resource: "XUH2O", amount: 150 }]);
    const ac = makeAc({ creepStore: { XUH2O: 100 } });
    const target = supplyLabs().resolve!(ac as never) as Record<string, unknown>;
    expect(target).toBeDefined();
    expect(target.phase).toBe("deposit");
    expect((target.dest as { id: string }).id).toBe("L1");
    expect(target.resource).toBe("XUH2O");
  });

  it("携带化合物但无 lab 需要：倒回 storage 解堵（dump 相）", () => {
    setDemands([{ labId: "L1", resource: "GH", amount: 150 }]);
    const ac = makeAc({ creepStore: { XUH2O: 100 } });
    const target = supplyLabs().resolve!(ac as never) as Record<string, unknown>;
    expect(target.phase).toBe("dump");
    expect((target.dest as { structureType: string }).structureType).toBe("storage");
  });

  it("空载 + 装料需求 + storage 有货：从 storage 取料（withdraw 相）", () => {
    setDemands([{ labId: "L1", resource: "XUH2O", amount: 150 }]);
    const ac = makeAc({ creepStore: {}, storageStore: { XUH2O: 500 } });
    const target = supplyLabs().resolve!(ac as never) as Record<string, unknown>;
    expect(target.phase).toBe("withdraw");
    expect((target.source as { id: string }).id).toBe("storage1");
    expect(target.amount).toBe(150);
  });

  it("空载 + storage 无货但 terminal 有货：回退 terminal（市场买入原料入链）", () => {
    setDemands([{ labId: "L1", resource: "X", amount: 100 }]);
    const ac = makeAc({ creepStore: {}, storageStore: {}, terminalStore: { X: 300 } });
    const target = supplyLabs().resolve!(ac as never) as Record<string, unknown>;
    expect(target.phase).toBe("withdraw");
    expect((target.source as { id: string }).id).toBe("terminal1");
  });

  it("空载 + 卸料需求优先于装料：先清错矿（unload 相）", () => {
    labById.L1 = makeLab("L1", { GH: 400 });
    setDemands([{ labId: "L2", resource: "U", amount: 300 }], [{ labId: "L1", resource: "GH" }]);
    const ac = makeAc({ creepStore: {}, storageStore: { U: 500 } });
    const target = supplyLabs().resolve!(ac as never) as Record<string, unknown>;
    expect(target.phase).toBe("unload");
    expect((target.source as { id: string }).id).toBe("L1");
    expect(target.resource).toBe("GH");
  });

  it("携带能量 + lab 有能量缺口：直接投喂（boost 能量补给通道）", () => {
    setDemands([{ labId: "L1", resource: "energy", amount: 100 }]);
    const ac = makeAc({ creepStore: { energy: 150 } });
    const target = supplyLabs().resolve!(ac as never) as Record<string, unknown>;
    expect(target.phase).toBe("deposit");
    expect(target.resource).toBe("energy");
  });

  it("需求表 tick 过期：不动作（防陈旧需求驱动搬运）", () => {
    setDemands([{ labId: "L1", resource: "XUH2O", amount: 150 }], [], 99);
    const ac = makeAc({ creepStore: { XUH2O: 100 } });
    expect(supplyLabs().resolve!(ac as never)).toBeUndefined();
  });
});

describe("syncTaskStates — rampart/road 建成判定（TD-028）", () => {
  function makeSnapshot(overrides: Record<string, unknown>): never {
    return {
      spawns: [], extensions: [], towers: [], containers: [], links: [],
      ramparts: [], walls: [], roads: [], labs: [],
      storage: undefined, terminal: undefined, extractor: undefined,
      myConstructionSites: [],
      ...overrides,
    } as never;
  }

  function makeTask(overrides: Partial<BuildTask>): BuildTask {
    return {
      key: "defense.mincut.10.10",
      pos: { x: 10, y: 10, roomName: "W1N1" },
      structureType: "rampart" as BuildableStructureConstant,
      priority: 2,
      state: "queued",
      attempts: 0,
      retryAt: 0,
      ...overrides,
    };
  }

  it("rampart site 消失且结构已建成 → done（旧实现回退 queued 形成幽灵循环）", () => {
    const queue = [makeTask({ state: "site" })];
    const snapshot = makeSnapshot({
      ramparts: [{ pos: { x: 10, y: 10 }, structureType: "rampart" }],
    });
    syncTaskStates(queue, snapshot);
    expect(queue[0]!.state).toBe("done");
  });

  it("rampart queued 但已建成 → done（规划器再生成的存量任务自然出队）", () => {
    const queue = [makeTask({ state: "queued" })];
    const snapshot = makeSnapshot({
      ramparts: [{ pos: { x: 10, y: 10 }, structureType: "rampart" }],
    });
    syncTaskStates(queue, snapshot);
    expect(queue[0]!.state).toBe("done");
  });

  it("共格隔离：extension 已建而同格 rampart 未建 → rampart 保持 queued", () => {
    const queue = [
      makeTask({ key: "core.ext.10.10", structureType: "extension" as BuildableStructureConstant, state: "site" }),
      makeTask({ key: "defense.core.rampart.10.10", state: "queued" }),
    ];
    const snapshot = makeSnapshot({
      extensions: [{ pos: { x: 10, y: 10 }, structureType: "extension" }],
    });
    syncTaskStates(queue, snapshot);
    expect(queue[0]!.state).toBe("done");
    expect(queue[1]!.state).toBe("queued");
  });

  it("road site 消失且已建成 → done（road 同属旧实现的判定盲区）", () => {
    const queue = [makeTask({ key: "road.10.10", structureType: "road" as BuildableStructureConstant, state: "site" })];
    const snapshot = makeSnapshot({
      roads: [{ pos: { x: 10, y: 10 }, structureType: "road" }],
    });
    syncTaskStates(queue, snapshot);
    expect(queue[0]!.state).toBe("done");
  });
});

describe("reclaimExpeditionCreeps — 扩张失败编队召回（TD-027）", () => {
  beforeEach(() => {
    (globalThis as unknown as { Memory: { rooms: Record<string, unknown> } }).Memory = {
      rooms: {
        W1N1: {
          spawnQueue: [
            { key: "expansion:worker:W2N2:0", role: "worker", home: "W2N2" },
            { key: "harvester:W1N1:0", role: "harvester", home: "W1N1" },
          ],
        },
      },
    } as never;
  });

  it("拓荒者 home 改回 sponsor、标记 recycle、清空 remoteTarget/assignment", () => {
    const pioneer = { memory: { role: "worker", home: "W2N2", assignment: { id: "t1" } } as Record<string, unknown> };
    g.Game = { time: 100, creeps: { p1: pioneer } };
    reclaimExpeditionCreeps("W2N2", "W1N1");
    expect(pioneer.memory.home).toBe("W1N1");
    expect(pioneer.memory.recycle).toBe(true);
    expect(pioneer.memory.assignment).toBeUndefined();
  });

  it("claimer（home=sponsor + remoteTarget=目标房）同样被召回", () => {
    const claimer = { memory: { role: "claimer", home: "W1N1", remoteTarget: "W2N2" } as Record<string, unknown> };
    g.Game = { time: 100, creeps: { c1: claimer } };
    reclaimExpeditionCreeps("W2N2", "W1N1");
    expect(claimer.memory.recycle).toBe(true);
    expect(claimer.memory.remoteTarget).toBeUndefined();
  });

  it("无关 creep 不受影响，sponsor 队列中目标房的 pending 请求被清除", () => {
    const local = { memory: { role: "hauler", home: "W1N1" } };
    g.Game = { time: 100, creeps: { h1: local } };
    reclaimExpeditionCreeps("W2N2", "W1N1");
    expect(local.memory).not.toHaveProperty("recycle", true);
    const queue = (Memory.rooms.W1N1 as { spawnQueue: { home: string }[] }).spawnQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0]!.home).toBe("W1N1");
  });
});
