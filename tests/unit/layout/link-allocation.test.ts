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
  hasSourceLinkFeedStand,
} from "../../../src/domain/layout/task-factory";
import { classifyLinkRole } from "../../../src/domain/economy/links";
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

  it("候选 link 无可喂站桩格（双贴格全墙，W7N3 病灶）→ 不生成该 source 的候选", () => {
    // 复刻 W7N3 source-2 几何：source (10,10) 的 8 个邻格中 7 个是墙，
    // 唯一可建 link 格 (11,10) 的 7 个非 source 邻格也全是墙 →
    // harvester 永远站不上双贴格（link 建成即死）。
    const deadStandTiles = new Set([
      "9,9", "9,10", "9,11", "10,9", "10,11", "11,9", "11,11", "12,9", "12,10", "12,11",
    ]);
    const terrain = {
      get: (x: number, y: number) => (deadStandTiles.has(`${x},${y}`) ? 1 : 0),
    } as unknown as RoomTerrain;
    const room = roomWith(terrain);
    const snap = snapshotAt(7);
    const opts = optionsFor(snap);

    const candidates = createSourceLinkTasks(snap, room, opts, 0);

    // src1 (10,10) 的候选被可喂性过滤拒掉；src2 (40,40) 地形平坦正常生成。
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.key).toContain("src2");
  });

  describe("hasSourceLinkFeedStand — 可喂站桩格判定（W7N3 病灶回归）", () => {
    const flat = { get: () => 0 } as unknown as RoomTerrain;
    const emptyOcc = new Set<number>();
    const noContainers = new Set<number>();

    it("双贴格全墙 → 不可喂（W7N3 source-2 实证：link (39,7) 的两个双贴格全是墙）", () => {
      // link (11,10) 的 7 个非 source 邻格全是墙，source (10,10) 格本身不可站。
      const wallTiles = new Set(["10,9", "10,11", "11,9", "11,11", "12,9", "12,10", "12,11"]);
      const terrain = {
        get: (x: number, y: number) => (wallTiles.has(`${x},${y}`) ? 1 : 0),
      } as unknown as RoomTerrain;

      expect(hasSourceLinkFeedStand(11, 10, 10, 10, terrain, emptyOcc, noContainers)).toBe(false);
    });

    it("存在可走、贴 source、贴 link 的空格 → 可喂", () => {
      // (10,11)：贴 source (10,10) range1、贴 link (11,10) range1。
      const wallTiles = new Set(["10,9", "11,9", "12,9", "12,10", "12,11", "11,11"]);
      const terrain = {
        get: (x: number, y: number) => (wallTiles.has(`${x},${y}`) ? 1 : 0),
      } as unknown as RoomTerrain;

      expect(hasSourceLinkFeedStand(11, 10, 10, 10, terrain, emptyOcc, noContainers)).toBe(true);
    });

    it("容器格例外：link 贴 source container → 容器格算有效站位（harvester 站容器上灌 link）", () => {
      // 唯一双贴格 (10,11) 被 container 占用：occupiedSet 排除它，但 containerTiles 放行。
      const wallTiles = new Set(["10,9", "11,9", "12,9", "12,10", "12,11", "11,11"]);
      const terrain = {
        get: (x: number, y: number) => (wallTiles.has(`${x},${y}`) ? 1 : 0),
      } as unknown as RoomTerrain;
      const occupied = new Set<number>();
      occupied.add(10 * 50 + 11); // 容器格 (10,11)
      const containers = new Set<number>();
      containers.add(10 * 50 + 11);

      expect(hasSourceLinkFeedStand(11, 10, 10, 10, terrain, occupied, containers)).toBe(true);
    });
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

// ─── 对抗性几何：放置意图 vs 运行时角色分类 ──────────────────
//
// 病灶复现：classifyLinkRole 按「最近锚获胜」（anchorRange=2）分类。
// 当 source 离核心 storage 较近时，source 八邻域中部分格到 storage 比到
// source 更近 → 运行时被判为 storage。旧放置逻辑（findAdjacentBuildable
// 只保证几何相邻）会把 source link 建在这种格上 → harvester 因 role!==source
// 拒灌 → 死 link + 第二个 storage link 惰化。修复后放置侧复用 classifyLinkRole
// 过滤候选格，只接受运行时分类与意图一致的格子。
//
// 注意：snapshotAt 默认 source(10,10)/(40,40) 远离 storage(26,25)，是「安全几何」
// （setup 注释明写刻意拉开距离规避误判）。本组测试反其道而行，构造危险几何。

/** 运行时分类辅助：取候选格在 snapshot 几何下的 link 角色。 */
function runtimeRole(snap: RoomSnapshot, x: number, y: number) {
  return classifyLinkRole(
    { x, y },
    snap.sources.map(s => ({ x: s.pos.x, y: s.pos.y })),
    snap.controller ? { x: snap.controller.pos.x, y: snap.controller.pos.y } : undefined,
    snap.storage ? { x: snap.storage.pos.x, y: snap.storage.pos.y } : undefined,
    2,
  );
}

describe("Link 放置与运行时角色分类闭环（对抗性几何）", () => {
  it("source 距 storage Chebyshev=2：source link 落在运行时分类为 source 的格", () => {
    // source (24,25) 与 storage (26,25) 相距 2。
    // source 八邻域中：(25,*) 到 storage 更近 → 运行时判为 storage（旧实现的陷阱）；
    // (23,25) 到 source=1 < 到 storage=3 → 判为 source（唯一合法落点方向）。
    const snap = snapshotAt(5, {
      sources: [{ id: "srcNear", pos: mockPos(24, 25), energy: 3000 } as any],
    });
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidates = createSourceLinkTasks(snap, room, opts, 0, 1);

    expect(candidates).toHaveLength(1);
    const pos = candidates[0]!.pos;
    // 放置结果在运行时必须分类为 source（闭环验证）。
    expect(runtimeRole(snap, pos.x, pos.y)).toBe("source");
    // 且必须紧邻 source（几何相邻不被破坏）。
    expect(Math.max(Math.abs(pos.x - 24), Math.abs(pos.y - 25))).toBeLessThanOrEqual(1);
  });

  it("source 与 storage 紧邻（Chebyshev=1）：source link 落在远离 storage 一侧（运行时判为 source）", () => {
    // source (25,25) 与 storage (26,25) 紧邻。source 八邻域中靠 storage 一侧的
    // (26,*) 到 storage 更近 → 运行时判为 storage（旧实现的陷阱：findAdjacentBuildable
    // 按 dx 升序遍历，(-1,-1) 起的 (24,*) 虽有站立格，但旧逻辑不校验角色，遇到墙/占用
    // 时会落到 (26,*) 死格）；远离 storage 一侧的 (24,*) 到 source 更近 → 判为 source。
    // 修复后放置侧只接受运行时判为 source 的格 → link 必然落在 source 左侧。
    const snap = snapshotAt(5, {
      sources: [{ id: "srcHugged", pos: mockPos(25, 25), energy: 3000 } as any],
    });
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidates = createSourceLinkTasks(snap, room, opts, 0, 1);

    expect(candidates).toHaveLength(1);
    const pos = candidates[0]!.pos;
    // 闭环验证：运行时分类为 source，且落在 source 远离 storage 的一侧（x <= 25）。
    expect(runtimeRole(snap, pos.x, pos.y)).toBe("source");
    expect(pos.x).toBeLessThanOrEqual(25);
    expect(Math.max(Math.abs(pos.x - 25), Math.abs(pos.y - 25))).toBeLessThanOrEqual(1);
  });

  it("storage 邻近 source：storage link 落在运行时分类为 storage 的格", () => {
    // storage (26,25) 与 source (24,25) 相距 2。storage 八邻域中 (25,*) 会被
    // 判为 source（到 source 更近）；放置侧须避开，选运行时判为 storage 的格。
    const snap = snapshotAt(5, {
      sources: [{ id: "srcNear", pos: mockPos(24, 25), energy: 3000 } as any],
    });
    const room = roomWith();
    const opts = optionsFor(snap);

    const candidate = createStorageLinkTask(snap, room, opts);

    expect(candidate).toBeDefined();
    const pos = candidate!.pos;
    expect(runtimeRole(snap, pos.x, pos.y)).toBe("storage");
    expect(Math.max(Math.abs(pos.x - 26), Math.abs(pos.y - 25))).toBeLessThanOrEqual(1);
  });
});
