/**
 * Link 分配策略测试 — 验证 RCL5+ 的 link 角色优先级分配。
 *
 * 核心策略（CONTROLLER_STRUCTURES link 上限：RCL5=2, RCL6=3, RCL7=4, RCL8=6）:
 *   RCL5 (2 links): source(1) + storage   → 最小可用 link 网络
 *   RCL6 (3 links): + controller           → 站桩升级链打通
 *   RCL7 (4 links): + source(2)            → 双 source 全覆盖
 *
 * 验证目标：
 *   - createSourceLinkTasks 的 maxNew 参数正确限制数量
 *   - createSourceLinkTasks 的 queuedLinkCount 正确扣减槽位
 *   - createStorageLinkTask 在 storage 附近创建 link
 *   - createControllerLinkTask 的 queuedLinkCount 正确扣减槽位
 *   - RCL5 场景：仅 source + storage，controller 无法获取槽位
 *   - RCL6 场景：source + storage + controller 全部就位
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSourceLinkTasks,
  createStorageLinkTask,
  createControllerLinkTask,
} from "../../../src/domain/layout/task-factory";
import { buildObstaclePositionSet, type ValidationOptions } from "../../../src/domain/layout/validation";
import { mockPos, resetGlobals } from "../../role-helpers";
import type { RoomSnapshot } from "../../../src/kernel/contracts";

beforeEach(() => {
  resetGlobals();
});

// ─── 地形 mock ──────────────────────────────────────────────

/** 无墙地形（所有格子可建造）。 */
const flatTerrain = { get: (_x: number, _y: number) => 0 } as unknown as RoomTerrain;

function roomWith(terrain: RoomTerrain = flatTerrain): Room {
  return { getTerrain: () => terrain } as unknown as Room;
}

// ─── 位置布局 ───────────────────────────────────────────────
//
// 房间布局（25×25 锚点附近）：
//   source A: (10, 10)  — 远离核心
//   source B: (40, 40)  — 远离核心，远离 source A
//   controller: (40, 10) — 远离 source 和 storage
//   storage:   (26, 25)  — 核心区
//
// 这样 link 放在 source 旁不会误判为 storage/controller link。

function snapshotAt(rcl: number, overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  const snap: RoomSnapshot = {
    roomName: "W7N4",
    rcl,
    controller: {
      id: "ctrl1",
      my: true,
      level: rcl,
      progress: 0,
      ticksToDowngrade: 20000,
      pos: mockPos(40, 10),
      structureType: "controller",
    } as any,
    spawns: [{ id: "spawn1", pos: mockPos(25, 25), structureType: "spawn", store: { getUsedCapacity: () => 0, getFreeCapacity: () => 300, getCapacity: () => 300, energy: 0 } as any, my: true } as any],
    extensions: [],
    towers: [],
    containers: [],
    roads: [],
    walls: [],
    ramparts: [],
    storage: {
      id: "storage1",
      pos: mockPos(26, 25),
      structureType: "storage",
      store: { getUsedCapacity: () => 0, getFreeCapacity: () => 1000000, getCapacity: () => 1000000, energy: 0 } as any,
      my: true,
    } as any,
    controllerContainer: undefined,
    links: [],
    sources: [
      { id: "src1", pos: mockPos(10, 10), energy: 3000 } as any,
      { id: "src2", pos: mockPos(40, 40), energy: 3000 } as any,
    ],
    constructionSites: [],
    myConstructionSites: [],
    hostileCreeps: [],
    threatCreeps: [],
    squadThreat: false,
    energyAvailable: 1800,
    energyCapacityAvailable: 1800,
    fillTargets: [],
    needsRecovery: false,
    sourceOccupancy: new Map(),
    pendingHarvesters: 0,
    minerals: [],
    labs: [],
    terminal: undefined,
    extractor: undefined,
    factory: undefined,
    droppedEnergy: [],
    tombstones: [],
    ruins: [],
    ...overrides,
  };
  return snap;
}

function optionsFor(snapshot: RoomSnapshot): ValidationOptions {
  return {
    completedKeys: new Set(),
    globalSiteCount: 0,
    maxGlobalSites: 7,
    obstacleSet: buildObstaclePositionSet(snapshot),
  };
}

// ─── 测试 ───────────────────────────────────────────────────

describe("Link 分配策略 — createSourceLinkTasks", () => {
  it("RCL5 maxNew=1 时只返回 1 个 source link（即使有 2 个 source）", () => {
    const snap = snapshotAt(5);
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidates = createSourceLinkTasks(snap, room, opts, 0, 1);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.structureType).toBe(STRUCTURE_LINK);
    expect(candidates[0]!.key).toContain("logistics.link.source.");
  });

  it("RCL5 maxNew=∞ 时返回 2 个 source link（2 个 source 都没有 link）", () => {
    const snap = snapshotAt(5);
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidates = createSourceLinkTasks(snap, room, opts, 0);

    // RCL5 maxLinks=2，2 个 source 都没有 link → 2 个候选
    expect(candidates).toHaveLength(2);
  });

  it("queuedLinkCount=1 时 RCL5 只剩 1 个槽位 → 最多 1 个候选", () => {
    const snap = snapshotAt(5);
    const room = roomWith();
    const opts = optionsFor(snap);

    // 模拟已有 1 个 link 任务在队列中
    const candidates = createSourceLinkTasks(snap, room, opts, 1, Infinity);

    // RCL5 maxLinks=2, queued=1, 剩余 1 槽位 → 1 个候选
    expect(candidates).toHaveLength(1);
  });

  it("queuedLinkCount=2 时 RCL5 无槽位 → 返回空", () => {
    const snap = snapshotAt(5);
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidates = createSourceLinkTasks(snap, room, opts, 2, Infinity);

    expect(candidates).toHaveLength(0);
  });

  it("已有 link 紧邻 source 时跳过该 source", () => {
    // source A (10,10) 旁已有 link (11,10)
    const existingLink = {
      id: "link1",
      pos: mockPos(11, 10),
      structureType: STRUCTURE_LINK,
      store: { getUsedCapacity: () => 0, getFreeCapacity: () => 800, getCapacity: () => 800, energy: 0 } as any,
      cooldown: 0,
      my: true,
    } as any;

    const snap = snapshotAt(7, { links: [existingLink] });
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidates = createSourceLinkTasks(snap, room, opts, 0);

    // source A 已有 link，source B 没有 → 1 个候选
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.key).toContain("src2");
  });

  it("RCL < 5 时返回空", () => {
    const snap = snapshotAt(4);
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidates = createSourceLinkTasks(snap, room, opts);

    expect(candidates).toHaveLength(0);
  });
});

describe("Link 分配策略 — createStorageLinkTask", () => {
  it("RCL5 有 storage 时在 storage 附近创建 link", () => {
    const snap = snapshotAt(5);
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidate = createStorageLinkTask(snap, room, opts);

    expect(candidate).toBeDefined();
    expect(candidate!.structureType).toBe(STRUCTURE_LINK);
    expect(candidate!.key).toBe("logistics.link.storage");
    expect(candidate!.priority).toBe(1);
    // 位置应在 storage (26,25) 附近 1 格内
    const dist = Math.max(
      Math.abs(candidate!.pos.x - 26),
      Math.abs(candidate!.pos.y - 25),
    );
    expect(dist).toBeLessThanOrEqual(1);
  });

  it("无 storage 时返回 undefined", () => {
    const snap = snapshotAt(5, { storage: undefined });
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidate = createStorageLinkTask(snap, room, opts);

    expect(candidate).toBeUndefined();
  });

  it("storage 旁已有 link 时返回 undefined", () => {
    const existingLink = {
      id: "link1",
      pos: mockPos(27, 25), // storage (26,25) 旁
      structureType: STRUCTURE_LINK,
      store: { getUsedCapacity: () => 0, getFreeCapacity: () => 800, getCapacity: () => 800, energy: 0 } as any,
      cooldown: 0,
      my: true,
    } as any;

    const snap = snapshotAt(5, { links: [existingLink] });
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidate = createStorageLinkTask(snap, room, opts);

    expect(candidate).toBeUndefined();
  });

  it("queuedLinkCount 达上限时返回 undefined", () => {
    const snap = snapshotAt(5);
    const room = roomWith();
    const opts = optionsFor(snap);

    // RCL5 maxLinks=2, queued=2 → 无槽位
    const candidate = createStorageLinkTask(snap, room, opts, 2);

    expect(candidate).toBeUndefined();
  });

  it("RCL < 5 时返回 undefined", () => {
    const snap = snapshotAt(4);
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidate = createStorageLinkTask(snap, room, opts);

    expect(candidate).toBeUndefined();
  });
});

describe("Link 分配策略 — createControllerLinkTask", () => {
  it("queuedLinkCount 达上限时返回 undefined", () => {
    const snap = snapshotAt(5);
    const room = roomWith();
    const opts = optionsFor(snap);

    // RCL5 maxLinks=2, queued=2 → 无槽位
    const candidate = createControllerLinkTask(snap, room, opts, 2);

    expect(candidate).toBeUndefined();
  });

  it("queuedLinkCount=2 时 RCL6（maxLinks=3）仍有 1 个槽位", () => {
    const snap = snapshotAt(6);
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidate = createControllerLinkTask(snap, room, opts, 2);

    expect(candidate).toBeDefined();
    expect(candidate!.key).toBe("logistics.link.controller");
  });
});

describe("Link 分配策略 — RCL5 完整模拟", () => {
  it("RCL5: source(1) + storage = 2 links, controller 无槽位", () => {
    const snap = snapshotAt(5);
    const room = roomWith();
    const opts = optionsFor(snap);

    // 步骤 1: source link（第一趟，maxNew=1）
    const sourceFirst = createSourceLinkTasks(snap, room, opts, 0, 1);
    expect(sourceFirst).toHaveLength(1);
    let queuedLinks = sourceFirst.length; // 1

    // 步骤 2: storage link
    const storage = createStorageLinkTask(snap, room, opts, queuedLinks);
    expect(storage).toBeDefined();
    queuedLinks++; // 2

    // 步骤 3: controller link — RCL5 maxLinks=2, queued=2 → 无槽位
    const controller = createControllerLinkTask(snap, room, opts, queuedLinks);
    expect(controller).toBeUndefined();

    // 步骤 4: source link（第二趟）— 也无槽位
    const sourceRest = createSourceLinkTasks(snap, room, opts, queuedLinks);
    expect(sourceRest).toHaveLength(0);

    // 总计：2 个 link 任务（source + storage），controller 被正确跳过
    expect(queuedLinks).toBe(2);
  });
});

describe("Link 分配策略 — RCL6 完整模拟", () => {
  it("RCL6: source(1) + storage + controller = 3 links", () => {
    const snap = snapshotAt(6);
    const room = roomWith();
    const opts = optionsFor(snap);

    // 步骤 1: source link（第一趟，maxNew=1）
    const sourceFirst = createSourceLinkTasks(snap, room, opts, 0, 1);
    expect(sourceFirst).toHaveLength(1);
    let queuedLinks = sourceFirst.length; // 1

    // 步骤 2: storage link
    const storage = createStorageLinkTask(snap, room, opts, queuedLinks);
    expect(storage).toBeDefined();
    queuedLinks++; // 2

    // 步骤 3: controller link — RCL6 maxLinks=3, queued=2 → 有 1 个槽位
    const controller = createControllerLinkTask(snap, room, opts, queuedLinks);
    expect(controller).toBeDefined();
    queuedLinks++; // 3

    // 步骤 4: source link（第二趟）— RCL6 maxLinks=3, queued=3 → 无槽位
    const sourceRest = createSourceLinkTasks(snap, room, opts, queuedLinks);
    expect(sourceRest).toHaveLength(0);

    // 总计：3 个 link 任务（source + storage + controller）
    expect(queuedLinks).toBe(3);
  });
});

describe("Link 分配策略 — RCL7 完整模拟", () => {
  it("RCL7: source(1) + storage + controller + source(2) = 4 links", () => {
    const snap = snapshotAt(7);
    const room = roomWith();
    const opts = optionsFor(snap);

    // 步骤 1: source link（第一趟，maxNew=1）
    const sourceFirst = createSourceLinkTasks(snap, room, opts, 0, 1);
    expect(sourceFirst).toHaveLength(1);
    let queuedLinks = sourceFirst.length; // 1

    // 步骤 2: storage link
    const storage = createStorageLinkTask(snap, room, opts, queuedLinks);
    expect(storage).toBeDefined();
    queuedLinks++; // 2

    // 步骤 3: controller link
    const controller = createControllerLinkTask(snap, room, opts, queuedLinks);
    expect(controller).toBeDefined();
    queuedLinks++; // 3

    // 步骤 4: source link（第二趟）— RCL7 maxLinks=4, queued=3 → 有 1 个槽位
    const sourceRest = createSourceLinkTasks(snap, room, opts, queuedLinks);
    expect(sourceRest).toHaveLength(1);
    queuedLinks++; // 4

    // 总计：4 个 link 任务（2 source + storage + controller）
    expect(queuedLinks).toBe(4);
  });
});
