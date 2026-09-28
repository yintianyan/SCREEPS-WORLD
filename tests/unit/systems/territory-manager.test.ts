/**
 * 领土处置执行链 — 排空 → unclaim → 清账 → 事后清扫 的顺序性与幂等性。
 *
 * 立案依据：这些副作用分散在 op 账本、孵化队列、creep 编制、调参账本、重占排除表五处，
 * 少一处就留下一间「不再属于我们、却仍在全帝国账本里当自有房」的幽灵房：site 计数继续
 * 占全帝国配额、prospect/war 继续把它的远矿目标算作已占用、home 指向它的 creep 永久冻结。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "../../../src/config";
import { territoryManagerSystem } from "../../../src/systems/empire/territory-manager";
import { REMOTE_ABANDON } from "../../../src/domain/remote/op-outcome";
import { mockBudget, mockSnapshot, resetGlobals } from "../../support/factories";

const CORE = "W37S58";
const DOOMED = "W37S55";

/** 自有房集合驱动 ctx.snapshots()（territory-manager 的「房还在手里」唯一口径）。 */
function makeCtx(ownedRooms: string[]): any {
  return {
    tick: (globalThis as any).Game.time,
    budget: mockBudget("healthy"),
    getSnapshot: (name: string) =>
      ownedRooms.includes(name) ? mockSnapshot({ roomName: name }) : undefined,
    *snapshots() {
      for (const roomName of ownedRooms) yield mockSnapshot({ roomName });
    },
  };
}

function installMemory(overrides: { startedAt?: number; unclaimAttempts?: number } = {}): void {
  const startedAt = overrides.startedAt ?? 900;
  (globalThis as any).Memory = {
    schemaVersion: CONFIG.memory.schemaVersion,
    creeps: {},
    rooms: {
      [CORE]: { spawnQueue: [], buildQueue: [] },
      [DOOMED]: {
        spawnQueue: [{ key: "hauler:W37S55", role: "hauler", home: DOOMED }],
        buildQueue: [],
        remoteOps: {
          W37S54: {
            state: "active",
            createdAt: 100,
            lastSeen: 900,
            siteCount: 5,
            roadSiteCount: 3,
          },
          W37S56: {
            state: "abandoned",
            createdAt: 50,
            lastSeen: 800,
            siteCount: 0,
            roadSiteCount: 0,
          },
        },
      },
    },
    kernel: {
      roomRelease: {
        [DOOMED]: { startedAt, reason: 0, unclaimAttempts: overrides.unclaimAttempts },
      },
      tuning: {
        rooms: { [DOOMED]: { roleBounds: { "hauler.maxCount": 3 } } },
        lastEval: { [DOOMED]: { at: 800 } },
      },
      powerCreeps: { homeAssignments: { pc1: DOOMED, pc2: CORE } },
    },
  };
}

function installGame(opts: { ownedHere?: boolean; unclaimCode?: number } = {}): void {
  const ownedHere = opts.ownedHere ?? true;
  (globalThis as any).Game.rooms = {
    [CORE]: { name: CORE, controller: { my: true } },
    [DOOMED]: ownedHere
      ? {
          name: DOOMED,
          controller: {
            my: true,
            unclaim: vi.fn(() => opts.unclaimCode ?? OK),
          },
        }
      : undefined,
  };
  (globalThis as any).Game.creeps = {
    "hauler-W37S55-a": {
      name: "hauler-W37S55-a",
      memory: { home: DOOMED, role: "hauler" },
      room: { name: DOOMED },
    },
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("territory-manager — 排空阶段", () => {
  it("先把 op 弃净、编队送进回收、打上 releaseAt，且本轮不 unclaim", () => {
    installMemory();
    installGame();
    territoryManagerSystem.run(makeCtx([CORE, DOOMED]));

    const doomed = (globalThis as any).Memory.rooms[DOOMED];
    expect(doomed.releaseAt).toBe(900);
    const op = doomed.remoteOps.W37S54;
    expect(op.state).toBe("abandoned");
    // 计数就地归零：唯一会清零它们的 road-planner 只对自有主房跑，房一失主就再没人清账。
    expect(op.siteCount).toBe(0);
    expect(op.roadSiteCount).toBe(0);
    // 墓碑可归因（否则「为什么少了个矿点」事后无从回答）。
    expect(doomed.remoteGraveyard).toHaveLength(1);
    expect(doomed.remoteGraveyard[0].r).toBe(REMOTE_ABANDON.HomeReleased);
    expect(doomed.remoteGraveyard[0].t).toBe("W37S54");

    // 本房 creep 全部进回收通道（home 仍在手里的房，recyclePass 照常接管）。
    for (const creep of Object.values((globalThis as any).Game.creeps) as any[]) {
      if (creep.memory.home === DOOMED) expect(creep.memory.recycle).toBe(true);
    }

    // 未排空（还剩 1 只 creep）⇒ 不许 unclaim。
    expect((globalThis as any).Game.rooms[DOOMED].controller.unclaim).not.toHaveBeenCalled();
  });

  it("排空判据齐了才喊 unclaim，且只喊一次并记账", () => {
    installMemory();
    installGame();
    const mem = (globalThis as any).Memory;
    mem.rooms[DOOMED].spawnQueue = [];
    (globalThis as any).Game.creeps = {};
    for (const op of Object.values(mem.rooms[DOOMED].remoteOps) as any[]) {
      op.state = "abandoned";
    }

    territoryManagerSystem.run(makeCtx([CORE, DOOMED]));

    const controller = (globalThis as any).Game.rooms[DOOMED].controller;
    expect(controller.unclaim).toHaveBeenCalledTimes(1);
    expect(mem.kernel.roomRelease[DOOMED].unclaimAttempts).toBe(1);
    expect(mem.kernel.roomRelease[DOOMED].lastUnclaimCode).toBe(OK);
    // 还没收尾：房仍在手里的这一拍不清账（清账要等它真的不在 snapshots 里）。
    expect(mem.rooms[DOOMED]).toBeDefined();
  });

  it("排空超截止时刻：带着残余 creep 也要 unclaim", () => {
    installMemory({ startedAt: (globalThis as any).Game.time ?? 1000 });
    installGame();
    const mem = (globalThis as any).Memory;
    mem.kernel.roomRelease[DOOMED].startedAt =
      (globalThis as any).Game.time - CONFIG.territory.drainDeadlineTicks;

    territoryManagerSystem.run(makeCtx([CORE, DOOMED]));

    expect((globalThis as any).Game.rooms[DOOMED].controller.unclaim).toHaveBeenCalledTimes(1);
    // 残余 op 不该被跳过：超期也不等于放弃排空动作本身。
    expect(mem.rooms[DOOMED].remoteOps.W37S54.state).toBe("abandoned");
  });

  it("unclaim 连续未成交达上限 → 本轮收手但保留指令与房间账本", () => {
    installMemory({ unclaimAttempts: CONFIG.territory.maxUnclaimAttempts });
    installGame();
    const mem = (globalThis as any).Memory;
    mem.rooms[DOOMED].spawnQueue = [];
    (globalThis as any).Game.creeps = {};
    for (const op of Object.values(mem.rooms[DOOMED].remoteOps) as any[]) {
      op.state = "abandoned";
    }

    territoryManagerSystem.run(makeCtx([CORE, DOOMED]));

    expect((globalThis as any).Game.rooms[DOOMED].controller.unclaim).not.toHaveBeenCalled();
    expect(mem.kernel.roomRelease[DOOMED].unclaimAttempts).toBe(0);
    expect(mem.rooms[DOOMED]).toBeDefined();
    expect(mem.kernel.releasedRooms).toBeUndefined();
  });
});

describe("territory-manager — 收尾清账", () => {
  it("房不在手里即清账：排除表登记 + RoomMemory/调参/失守记录/power creep 驻留一并删除", () => {
    installMemory();
    installGame();
    const mem = (globalThis as any).Memory;
    territoryManagerSystem.run(makeCtx([CORE, DOOMED])); // 先排空

    installGame({ ownedHere: false });
    territoryManagerSystem.run(makeCtx([CORE])); // 房已不在手里

    const tick = (globalThis as any).Game.time;
    expect(mem.kernel.releasedRooms[DOOMED]).toBe(tick);
    expect(mem.rooms[DOOMED]).toBeUndefined();
    expect(mem.kernel.tuning.rooms[DOOMED]).toBeUndefined();
    expect(mem.kernel.tuning.lastEval[DOOMED]).toBeUndefined();
    expect(mem.kernel.lostRooms?.[DOOMED]).toBeUndefined();
    expect(mem.kernel.powerCreeps.homeAssignments[DOOMED]).toBeUndefined();
    expect(mem.kernel.powerCreeps.homeAssignments.pc2).toBe(CORE);
    expect(mem.kernel.roomRelease[DOOMED]).toBeUndefined();
    // 核心房一根手指都没碰到。
    expect(mem.rooms[CORE]).toBeDefined();
  });

  it("已在排除表里的房不再挂在在途指令表（防指令与历史重复）", () => {
    installMemory();
    installGame();
    const mem = (globalThis as any).Memory;
    mem.kernel.releasedRooms = { [DOOMED]: 500 };
    territoryManagerSystem.run(makeCtx([CORE, DOOMED]));
    expect(mem.kernel.roomRelease[DOOMED]).toBeUndefined();
    expect(mem.rooms[DOOMED]).toBeDefined(); // 不再清第二次的账
  });

  it("排除表过期即放手，不再无限期否决重占", () => {
    installMemory();
    installGame();
    const mem = (globalThis as any).Memory;
    const stale = (globalThis as any).Game.time - CONFIG.territory.releasedExclusionTicks - 1;
    mem.kernel.releasedRooms = { W9S9: stale, [DOOMED]: (globalThis as any).Game.time };
    territoryManagerSystem.run(makeCtx([CORE, DOOMED]));
    expect(mem.kernel.releasedRooms.W9S9).toBeUndefined();
    expect(mem.kernel.releasedRooms[DOOMED]).toBeDefined();
  });
});

describe("territory-manager — 事后清扫无家 creep", () => {
  it("home 指向已释放房的 creep：改锚到当前所在自有房并送回收（否则永久冻结）", () => {
    installMemory();
    installGame();
    const mem = (globalThis as any).Memory;
    mem.kernel.releasedRooms = { [DOOMED]: (globalThis as any).Game.time - 10 };
    mem.kernel.roomRelease = undefined;
    (globalThis as any).Game.creeps = {
      "remoteHa-W37S55-b": {
        name: "remoteHa-W37S55-b",
        memory: { home: DOOMED, role: "remoteHauler" },
        room: { name: CORE },
      },
    };

    territoryManagerSystem.run(makeCtx([CORE]));

    const creep = (globalThis as any).Game.creeps["remoteHa-W37S55-b"];
    expect(creep.memory.home).toBe(CORE);
    expect(creep.memory.recycle).toBe(true);
  });

  it("身处无主房（远矿房）的无家 creep 不动它 —— 引导跨房移动不是本系统的职责", () => {
    installMemory();
    installGame();
    const mem = (globalThis as any).Memory;
    mem.kernel.releasedRooms = { [DOOMED]: (globalThis as any).Game.time - 10 };
    mem.kernel.roomRelease = undefined;
    (globalThis as any).Game.creeps = {
      "remoteHa-W37S55-c": {
        name: "remoteHa-W37S55-c",
        memory: { home: DOOMED, role: "remoteHauler" },
        room: { name: "W37S54" },
      },
    };

    territoryManagerSystem.run(makeCtx([CORE]));

    expect((globalThis as any).Game.creeps["remoteHa-W37S55-c"].memory.home).toBe(DOOMED);
  });

  it("清扫窗口外不再遍历 Game.creeps（历史释放不构成长期成本）", () => {
    installMemory();
    installGame();
    const mem = (globalThis as any).Memory;
    mem.kernel.releasedRooms = {
      [DOOMED]: (globalThis as any).Game.time - CONFIG.territory.homelessSweepTicks - 1,
    };
    mem.kernel.roomRelease = undefined;
    const creep = {
      name: "remoteHa-W37S55-d",
      memory: { home: DOOMED, role: "remoteHauler" },
      room: { name: CORE },
    };
    (globalThis as any).Game.creeps = { [creep.name]: creep };

    territoryManagerSystem.run(makeCtx([CORE]));

    expect(creep.memory.home).toBe(DOOMED);
  });
});
