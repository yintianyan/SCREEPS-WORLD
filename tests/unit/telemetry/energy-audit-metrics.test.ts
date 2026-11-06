import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";

const mockGlobal: Record<string, unknown> = {};

vi.mock("../../../src/kernel/global-cache", () => ({
  globalCache: () => mockGlobal,
}));

vi.stubGlobal("FIND_STRUCTURES", 101);
vi.stubGlobal("FIND_DROPPED_RESOURCES", 102);
vi.stubGlobal("FIND_TOMBSTONES", 103);
vi.stubGlobal("FIND_RUINS", 104);
vi.stubGlobal("RESOURCE_ENERGY", "energy");
vi.stubGlobal("STRUCTURE_CONTAINER", "container");
vi.stubGlobal("STRUCTURE_STORAGE", "storage");
vi.stubGlobal("STRUCTURE_TERMINAL", "terminal");
vi.stubGlobal("STRUCTURE_LINK", "link");
vi.stubGlobal("STRUCTURE_TOWER", "tower");
vi.stubGlobal("STRUCTURE_SPAWN", "spawn");
vi.stubGlobal("STRUCTURE_EXTENSION", "extension");
vi.stubGlobal("STRUCTURE_LAB", "lab");
vi.stubGlobal("STRUCTURE_FACTORY", "factory");
vi.stubGlobal("STRUCTURE_POWER_SPAWN", "powerSpawn");
vi.stubGlobal("STRUCTURE_NUKER", "nuker");
vi.stubGlobal("STRUCTURE_ROAD", "road");

const game = {
  time: 1000,
  rooms: {} as Record<string, unknown>,
  creeps: {} as Record<string, unknown>,
};
vi.stubGlobal("Game", game);

import {
  registerEnergyAuditMetrics,
  collectEnergyAuditMetrics,
} from "../../../src/telemetry/metrics/EnergyAuditMetrics";
import { snapshotMetrics } from "../../../src/telemetry/MetricRegistry";

function energy(amount: number) {
  return {
    store: {
      getUsedCapacity: () => amount,
    },
  };
}

function makeRoom(spec: {
  structures?: Array<{ structureType: string; amount: number }>;
  dropped?: number;
  tombstone?: number;
  tombs?: Array<{ amount: number; mine: boolean }>;
  ruin?: number;
}) {
  const tombs = [
    ...(spec.tombstone ? [{ amount: spec.tombstone, mine: false }] : []),
    ...(spec.tombs ?? []),
  ];
  return {
    find: (kind: number) => {
      if (kind === 101) {
        return (spec.structures ?? []).map(s => ({
          structureType: s.structureType,
          store: { getUsedCapacity: () => s.amount },
        }));
      }
      if (kind === 102)
        return spec.dropped ? [{ resourceType: "energy", amount: spec.dropped }] : [];
      if (kind === 103)
        return tombs.map(t => ({
          store: { getUsedCapacity: () => t.amount },
          creep: { my: t.mine },
        }));
      if (kind === 104) return spec.ruin ? [energy(spec.ruin)] : [];
      return [];
    },
  };
}

function entry(name: string, room: string): number | undefined {
  const metric = snapshotMetrics().find(m => m.name === name);
  return metric?.entries.find(e => e.labels.room === room)?.value;
}

beforeAll(() => {
  registerEnergyAuditMetrics();
});

beforeEach(() => {
  delete (mockGlobal as any).energyLedger;
  delete (mockGlobal as any).__energyAuditSeen;
  game.rooms = {};
  game.creeps = {};
});

describe("EnergyAuditMetrics — ε 结算的 segment 出口", () => {
  it("账本 15 列与四类物理池按房写入注册指标", () => {
    game.time = 2000;
    game.rooms = {
      W1N1: makeRoom({
        structures: [
          { structureType: "storage", amount: 500 },
          { structureType: "container", amount: 100 },
          { structureType: "lab", amount: 200 },
          { structureType: "tower", amount: 0 },
          { structureType: "road", amount: 999 },
        ],
        dropped: 50,
        tombstone: 30,
        ruin: 20,
      }),
      W2N2: makeRoom({
        structures: [
          { structureType: "terminal", amount: 400 },
          { structureType: "factory", amount: 60 },
        ],
      }),
    };
    game.creeps = {
      a: { memory: { home: "W1N1" }, store: { getUsedCapacity: () => 75 } },
      b: { memory: { home: "W2N2" }, store: { getUsedCapacity: () => 25 } },
    };
    (mockGlobal as any).energyLedger = {
      tick: 1,
      rooms: {
        W1N1: {
          harvested: 1000,
          pickedUp: 40,
          spawned: 300,
          recycledRefund: 7,
          upgraded: 80,
          built: 11,
          repaired: 13,
          towerSpent: 17,
          bought: 19,
          sold: 23,
          imported: 29,
          exported: 31,
          tradeFee: 37,
          industrialSpend: 41,
          nukeSpend: 43,
        },
      },
    };

    collectEnergyAuditMetrics();

    expect(
      snapshotMetrics().find(m => m.name === "screeps_economy_audit_tick")?.entries[0]?.value,
    ).toBe(2000);
    expect(entry("screeps_economy_audit_pool_general", "W1N1")).toBe(600);
    expect(entry("screeps_economy_audit_pool_industrial", "W1N1")).toBe(200);
    expect(entry("screeps_economy_audit_pool_loose", "W1N1")).toBe(100);
    expect(entry("screeps_economy_audit_pool_tomb_own", "W1N1")).toBe(0);
    expect(entry("screeps_economy_audit_pool_tomb_foreign", "W1N1")).toBe(30);
    expect(entry("screeps_economy_audit_pool_carry", "W1N1")).toBe(75);
    expect(entry("screeps_economy_audit_pool_general", "W2N2")).toBe(400);
    expect(entry("screeps_economy_audit_pool_industrial", "W2N2")).toBe(60);
    expect(entry("screeps_economy_audit_pool_loose", "W2N2")).toBe(0);
    expect(entry("screeps_economy_audit_pool_carry", "W2N2")).toBe(25);
    expect(entry("screeps_economy_audit_seen", "W1N1")).toBe(1);
    expect(entry("screeps_economy_audit_seen", "W2N2")).toBe(1);

    for (const field of [
      "harvested",
      "pickedUp",
      "spawned",
      "recycledRefund",
      "upgraded",
      "built",
      "repaired",
      "towerSpent",
      "bought",
      "sold",
      "imported",
      "exported",
      "tradeFee",
      "industrialSpend",
      "nukeSpend",
    ]) {
      expect(entry(`screeps_economy_audit_${field}`, "W1N1")).toBe(
        (mockGlobal as any).energyLedger.rooms.W1N1[field],
      );
    }
  });

  it("墓碑按 creep.my 拆成我方/非我方两档，两档都是 loose 的子集", () => {
    game.time = 2500;
    game.rooms = {
      W5N5: makeRoom({
        dropped: 10,
        tombs: [
          { amount: 300, mine: true },
          { amount: 582, mine: false },
        ],
      }),
    };

    collectEnergyAuditMetrics();

    expect(entry("screeps_economy_audit_pool_loose", "W5N5")).toBe(892);
    expect(entry("screeps_economy_audit_pool_tomb_own", "W5N5")).toBe(300);
    expect(entry("screeps_economy_audit_pool_tomb_foreign", "W5N5")).toBe(582);
  });

  it("房间失去视野后 seen 归 0：旧池值不许当当前样本", () => {
    game.time = 3000;
    game.rooms = { W3N3: makeRoom({ structures: [{ structureType: "storage", amount: 123 }] }) };
    collectEnergyAuditMetrics();
    expect(entry("screeps_economy_audit_pool_general", "W3N3")).toBe(123);
    expect(entry("screeps_economy_audit_seen", "W3N3")).toBe(1);

    game.time = 3010;
    game.rooms = {};
    collectEnergyAuditMetrics();
    expect(entry("screeps_economy_audit_seen", "W3N3")).toBe(0);
    expect(entry("screeps_economy_audit_pool_general", "W3N3")).toBe(123);
  });

  it("未注册结构类型不计入任何池（road/wall 之类）", () => {
    game.time = 4000;
    game.rooms = {
      W4N4: makeRoom({
        structures: [
          { structureType: "road", amount: 999 },
          { structureType: "container", amount: 5 },
          { structureType: "nuker", amount: 7 },
        ],
      }),
    };
    collectEnergyAuditMetrics();
    expect(entry("screeps_economy_audit_pool_general", "W4N4")).toBe(5);
    expect(entry("screeps_economy_audit_pool_industrial", "W4N4")).toBe(7);
  });

  it("无 home 的 creep carry 按所在房单列，下一发归零", () => {
    game.time = 5000;
    game.rooms = {
      W5N5: makeRoom({ structures: [{ structureType: "storage", amount: 100 }] }),
      W6N6: makeRoom({ structures: [] }),
    };
    game.creeps = {
      homed: {
        memory: { home: "W5N5" },
        room: { name: "W5N5" },
        store: { getUsedCapacity: () => 40 },
      },
      orphanLoaded: {
        memory: {},
        room: { name: "W5N5" },
        store: { getUsedCapacity: () => 75 },
      },
      orphanEmpty: {
        memory: {},
        room: { name: "W5N5" },
        store: { getUsedCapacity: () => 0 },
      },
      orphanElsewhere: {
        memory: {},
        room: { name: "W6N6" },
        store: { getUsedCapacity: () => 12 },
      },
      unseenHome: {
        memory: { home: "W9N9" },
        room: { name: "W6N6" },
        store: { getUsedCapacity: () => 33 },
      },
    };
    collectEnergyAuditMetrics();

    expect(entry("screeps_economy_audit_pool_carry", "W5N5")).toBe(40);
    expect(entry("screeps_economy_audit_unhomed_carry", "W5N5")).toBe(75);
    expect(entry("screeps_economy_audit_unhomed_creeps", "W5N5")).toBe(2);
    expect(entry("screeps_economy_audit_unhomed_carry", "W6N6")).toBe(12);
    expect(entry("screeps_economy_audit_unhomed_creeps", "W6N6")).toBe(1);
    // home 不可见：carry 仍按 home 导出（分析器据此纳入 P）
    expect(entry("screeps_economy_audit_pool_carry", "W9N9")).toBe(33);

    game.time = 5010;
    game.creeps = {
      homed: {
        memory: { home: "W5N5" },
        room: { name: "W5N5" },
        store: { getUsedCapacity: () => 40 },
      },
    };
    collectEnergyAuditMetrics();
    expect(entry("screeps_economy_audit_unhomed_carry", "W5N5")).toBe(0);
    expect(entry("screeps_economy_audit_unhomed_creeps", "W5N5")).toBe(0);
  });
});
