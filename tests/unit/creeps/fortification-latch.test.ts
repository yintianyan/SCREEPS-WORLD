/** Phase C/D：工事维修的 storage 回差闩锁（Phase D 起恢复线 300K）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { repairFortifications } from "../../../src/creeps/engine/actions/repair";
import type { ActionContext } from "../../../src/creeps/engine/action-types";
import { CONFIG } from "../../../src/config";
import {
  mockBudget,
  mockCreep,
  mockPos,
  mockSnapshot,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  (globalThis as any).Memory = { rooms: {} };
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

/** 一个远低于目标血量的 rampart（RCL8 目标 10M）。 */
function rampart(hits = 100000): any {
  return {
    id: "ramp1",
    structureType: "rampart",
    pos: mockPos(25, 25),
    hits,
    hitsMax: 300000000,
  };
}

function makeAc(opts: {
  storageEnergy?: number;
  richActive?: boolean;
  fortifyActive?: boolean;
  lastHostileAt?: number;
  ramparts?: any[];
  tier?: string;
}): ActionContext {
  const roomMem: any = {};
  if (opts.richActive !== undefined) roomMem.storageRichActive = opts.richActive;
  if (opts.fortifyActive !== undefined) roomMem.fortifyActive = opts.fortifyActive;
  if (opts.lastHostileAt !== undefined) roomMem.lastHostileAt = opts.lastHostileAt;
  (globalThis as any).Memory.rooms["W8N3"] = roomMem;

  const creep = mockCreep({
    name: "builder_1",
    role: "builder",
    used: 250,
    capacity: 250,
    mode: "work",
  });
  const snapshot = mockSnapshot({
    roomName: "W8N3",
    rcl: 8,
    storage:
      opts.storageEnergy === undefined
        ? undefined
        : ({
            pos: mockPos(21, 15),
            store: makeStore({ energy: opts.storageEnergy }, 1000000),
          } as any),
    // rampart 通过 rampart 集合暴露（snapshot.ramparts 由 mockSnapshot 透传）。
    ramparts: opts.ramparts ?? [rampart()],
  });
  return {
    creep,
    snapshot,
    assignment: undefined,
    budget: mockBudget((opts.tier ?? "healthy") as any),
    ctx: {} as any,
  };
}

describe("repairFortifications — storage 回差闩锁", () => {
  it("和平期 + fortify=false + storage 60K（刚过 50K）→ 不修墙（旧行为会修）", () => {
    const ac = makeAc({ storageEnergy: 60000, fortifyActive: false });
    expect(repairFortifications().resolve(ac)).toBeUndefined();
  });

  it("和平期 + fortify=true + storage 60K → 修墙（曾达 300K 恢复线）", () => {
    const ac = makeAc({ storageEnergy: 60000, fortifyActive: true });
    expect(repairFortifications().resolve(ac)).not.toBeUndefined();
  });

  it("和平期 + 无闩锁字段（旧路径/单测）+ storage 60K → 按 50K 门槛放行", () => {
    const ac = makeAc({ storageEnergy: 60000 });
    expect(repairFortifications().resolve(ac)).not.toBeUndefined();
  });

  it("和平期 + 无闩锁字段 + storage 40K → 不修", () => {
    const ac = makeAc({ storageEnergy: 40000 });
    expect(repairFortifications().resolve(ac)).toBeUndefined();
  });

  it("Phase D：storage 200K（已过 100K 但未到 300K）+ fortify=false → 不修墙", () => {
    const ac = makeAc({ storageEnergy: 200000, fortifyActive: false });
    expect(repairFortifications().resolve(ac)).toBeUndefined();
  });

  it("Phase D：fortifyActive 优先于 storageRichActive —— rich=true + fortify=false → 不修墙", () => {
    const ac = makeAc({
      storageEnergy: 200000,
      richActive: true,
      fortifyActive: false,
    });
    expect(repairFortifications().resolve(ac)).toBeUndefined();
  });

  it("受袭记忆 + fortify=false + storage 20K ⇒ 不修（记忆不等于正在挨打）", () => {
    const ac = makeAc({
      storageEnergy: 20000,
      richActive: false,
      fortifyActive: false,
      lastHostileAt: (globalThis as any).Game.time,
    });
    expect(repairFortifications().resolve(ac)).toBeUndefined();
  });

  it("受袭记忆 + fortify=true + storage 60K ⇒ 修（闸开即修，目标血量按受袭升档）", () => {
    const ac = makeAc({
      storageEnergy: 60000,
      fortifyActive: true,
      lastHostileAt: (globalThis as any).Game.time,
    });
    expect(repairFortifications().resolve(ac)).not.toBeUndefined();
  });

  it("受袭记忆 + fortify=true + storage 20K ⇒ 修（全目标档只看 fortifyActive）", () => {
    const ac = makeAc({
      storageEnergy: 20000,
      fortifyActive: true,
      lastHostileAt: (globalThis as any).Game.time,
    });
    expect(repairFortifications().resolve(ac)).not.toBeUndefined();
  });

  it("受袭记忆 + fortify=false + storage 5K ⇒ 不修", () => {
    const ac = makeAc({
      storageEnergy: 5000,
      richActive: false,
      fortifyActive: false,
      lastHostileAt: (globalThis as any).Game.time,
    });
    expect(repairFortifications().resolve(ac)).toBeUndefined();
  });

  it("recovery tier → 恒跳过（原有门禁不变）", () => {
    const ac = makeAc({ storageEnergy: 400000, fortifyActive: true, tier: "recovery" });
    expect(repairFortifications().resolve(ac)).toBeUndefined();
  });
});

describe("Phase D 后：基础防护档（填补 1,500–10,000 死区）", () => {
  it("fortify=false + storage 60K + rampart 5K ⇒ 修（补到 10K 基础线）", () => {
    const ac = makeAc({
      storageEnergy: 60000,
      fortifyActive: false,
      ramparts: [rampart(5000)],
    });
    expect(repairFortifications().resolve(ac)).not.toBeUndefined();
  });

  it("fortify=false + storage 60K + rampart 50K ⇒ 不修（已超基础线，等 300K 闸）", () => {
    const ac = makeAc({
      storageEnergy: 60000,
      fortifyActive: false,
      ramparts: [rampart(50000)],
    });
    expect(repairFortifications().resolve(ac)).toBeUndefined();
  });

  it("fortify=true + storage 400K + rampart 50K ⇒ 修（全目标档接管）", () => {
    const ac = makeAc({
      storageEnergy: 400000,
      fortifyActive: true,
      ramparts: [rampart(50000)],
    });
    expect(repairFortifications().resolve(ac)).not.toBeUndefined();
  });

  it("fortify=false + storage 49,999（低于基础门禁）⇒ 不修", () => {
    const ac = makeAc({
      storageEnergy: 49999,
      fortifyActive: false,
      ramparts: [rampart(5000)],
    });
    expect(repairFortifications().resolve(ac)).toBeUndefined();
  });

  it("水位缩放：storage 20K ⇒ capHits 2K，rampart 1K 修、5K 不修", () => {
    const lowRampart = makeAc({
      storageEnergy: 20000,
      fortifyActive: false,
      ramparts: [rampart(1000)],
    });
    expect(repairFortifications().resolve(lowRampart)).not.toBeUndefined();

    const highRampart = makeAc({
      storageEnergy: 20000,
      fortifyActive: false,
      ramparts: [rampart(5000)],
    });
    expect(repairFortifications().resolve(highRampart)).toBeUndefined();
  });

  it("水位缩放：storage 100K ⇒ capHits 封顶 10K，rampart 9K 修、11K 不修", () => {
    const below = makeAc({
      storageEnergy: 100000,
      fortifyActive: false,
      ramparts: [rampart(9000)],
    });
    expect(repairFortifications().resolve(below)).not.toBeUndefined();

    const above = makeAc({
      storageEnergy: 100000,
      fortifyActive: false,
      ramparts: [rampart(11000)],
    });
    expect(repairFortifications().resolve(above)).toBeUndefined();
  });

  it("低于 sustainedStorage(10K) ⇒ 完全不修（生存优先）", () => {
    const ac = makeAc({
      storageEnergy: 9999,
      fortifyActive: false,
      ramparts: [rampart(500)],
    });
    expect(repairFortifications().resolve(ac)).toBeUndefined();
  });
});

describe("Phase D：分级恢复线的不变量", () => {
  it("停线统一 50K；lab 恢复线最低（成本仅 1–3 e/t），升级 60K，修墙 300K", () => {
    const stop = CONFIG.economy.upgrade.sprintStorage;
    // lab 反应约 1 e/t/trio，比单只升级（15 e/t）低一个量级 ⇒ 应早于升级开闸。
    expect(CONFIG.economy.upgrade.labResumeStorage).toBeGreaterThan(stop);
    expect(CONFIG.economy.upgrade.labResumeStorage).toBeLessThan(
      CONFIG.economy.upgrade.gclResumeStorage,
    );
    expect(CONFIG.economy.upgrade.gclResumeStorage).toBeGreaterThan(stop);
    // 修墙是纯消耗、无直接收益，必须远高于两者。
    expect(CONFIG.defense.fortifyResumeStorage).toBeGreaterThan(
      CONFIG.economy.upgrade.gclResumeStorage,
    );
  });
});
