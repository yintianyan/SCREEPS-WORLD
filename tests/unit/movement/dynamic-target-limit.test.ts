/**
 * P1-E：动态目标寻路限频三档单测（plan.md §5.7.5，remediation P1-E）。
 *
 * 档 1 quantizeBlockKey：3×3 区块 key 量化 — 目标在区块内移动不触发重寻路。
 * 档 2 dynamicRepathInterval：重寻路冷却 — 冷却内沿旧路径/直走降级。
 * 档 3 maxSearchesPerRoomPerTick：每房每 tick 寻路预算 — 超预算降级让行。
 *
 * 纯函数测试 + 通过 stepToward 的集成测试（mock PathFinder.search 计数）。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { stepToward } from "../../../src/creeps/movement";
import { preloadStructureCache } from "../../../src/creeps/movement";
import { quantizeBlockKey, acquirePathBudget } from "../../../src/creeps/movement/pathfinding";
import { CONFIG } from "../../../src/config";
import { globalCache } from "../../../src/kernel/global-cache";
import { mockCreep, resetGlobals } from "../../role-helpers";

const G = (): any => globalThis;

// 保存原始 movement 配置 — 测试覆盖后恢复，避免污染其他测试。
const origMovement = { ...CONFIG.movement };

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  // 恢复配置（上一测试可能覆盖）。
  Object.assign(CONFIG.movement as any, origMovement);
  // 显式开启 traffic 模式 — traffic-manager.test.ts 的 afterEach 会把
  // trafficManager 设为 false 且不恢复，全局 CONFIG 单例被污染。
  // 本文件所有集成测试依赖 traffic 模式走 registerStepViaPathfinder 路径。
  (CONFIG.movement as any).trafficManager = true;
});

afterEach(() => {
  Object.assign(CONFIG.movement as any, origMovement);
});

// ─── 档 1：quantizeBlockKey 纯函数 ──────────────────────────

describe("P1-E 档 1 — quantizeBlockKey 3×3 区块量化", () => {
  /** 辅助：将 (x,y) 转 packed 再量化。 */
  const q = (x: number, y: number): number => quantizeBlockKey(x * 50 + y);

  it("(0,0) 与 (2,2) 同属区块 (0,0) — 量化后 key 相同", () => {
    expect(q(0, 0)).toBe(q(2, 2));
    expect(q(0, 0)).toBe(0 * 50 + 0);
  });

  it("(3,3) 属区块 (1,1) — 与 (2,2) 不同区块", () => {
    expect(q(3, 3)).not.toBe(q(2, 2));
    expect(q(3, 3)).toBe(1 * 50 + 1);
  });

  it("(33,33)/(34,34)/(35,35) 同属区块 (11,11)", () => {
    const k33 = q(33, 33);
    const k34 = q(34, 34);
    const k35 = q(35, 35);
    expect(k33).toBe(k34);
    expect(k34).toBe(k35);
    expect(k35).toBe(11 * 50 + 11);
  });

  it("(35,35) 与 (36,36) 跨区块边界 — key 不同", () => {
    expect(q(35, 35)).not.toBe(q(36, 36));
  });

  it("(49,49) 属区块 (16,16) — 角落边界值", () => {
    expect(q(49, 49)).toBe(16 * 50 + 16);
  });

  it("x/y 轴独立量化 — (3,0) 与 (0,3) 不同区块", () => {
    expect(q(3, 0)).toBe(1 * 50 + 0);
    expect(q(0, 3)).toBe(0 * 50 + 1);
    expect(q(3, 0)).not.toBe(q(0, 3));
  });
});

// ─── 档 3：acquirePathBudget 纯函数 ─────────────────────────

describe("P1-E 档 3 — acquirePathBudget 每房每 tick 计数", () => {
  beforeEach(() => {
    G().Game.time = 1000;
  });

  it("预算内：前 N 次返回 true，计数递增", () => {
    expect(acquirePathBudget("W1N1", 2)).toBe(true);
    expect(acquirePathBudget("W1N1", 2)).toBe(true);
  });

  it("超预算：第 N+1 次返回 false", () => {
    acquirePathBudget("W1N1", 2);
    acquirePathBudget("W1N1", 2);
    expect(acquirePathBudget("W1N1", 2)).toBe(false);
  });

  it("tick 变化：计数器重置", () => {
    acquirePathBudget("W1N1", 1);
    expect(acquirePathBudget("W1N1", 1)).toBe(false);
    G().Game.time = 1001;
    expect(acquirePathBudget("W1N1", 1)).toBe(true);
  });

  it("不同房独立计数 — W1N1 耗尽不影响 W2N1", () => {
    acquirePathBudget("W1N1", 1);
    expect(acquirePathBudget("W1N1", 1)).toBe(false);
    expect(acquirePathBudget("W2N1", 1)).toBe(true);
  });

  it("max=0：始终返回 false（但调用方用 budgetMax>0 守卫，不直接调此函数）", () => {
    expect(acquirePathBudget("W1N1", 0)).toBe(false);
  });
});

// ─── 集成测试：通过 stepToward 验证三档限频 ──────────────────

/**
 * 构建集成测试 creep mock — pos 在 (cx,cy)，getRangeTo 始终返回远距离（>1），
 * getDirectionTo 返回 RIGHT(3)。
 */
function makeCreep(name: string, cx: number, cy: number): any {
  const creep = mockCreep({ name, role: "hauler", mode: "commute", home: "W7N4" });
  creep.pos = {
    x: cx,
    y: cy,
    roomName: "W7N4",
    getRangeTo: vi.fn(() => 10),
    getDirectionTo: vi.fn(() => 3),
    isEqualTo: vi.fn(() => false),
  };
  creep.room = { name: "W7N4" };
  creep.fatigue = 0;
  creep.move = vi.fn(() => 0);
  return creep;
}

/** 构建目标位置。 */
function target(x: number, y: number): any {
  return { x, y, roomName: "W7N4" };
}

/**
 * PathFinder.search mock — 真实引擎语义：返回的 path **不含起点**。
 * （官服实测：search((25,25)→(30,25)).path[0]=(26,26)≠origin — 2026-08-18 契约修复的
 * 依据。computeAndPersistPath 现负责 prepend creep.pos，nextDirFromPath 才能定位自己。）
 */
function setupPathFinderMock(): void {
  const pf = G().PathFinder;
  pf.search = vi.fn((origin: any) => ({
    path: [
      { x: origin.x + 1, y: origin.y, roomName: "W7N4" },
      { x: origin.x + 2, y: origin.y, roomName: "W7N4" },
      { x: origin.x + 3, y: origin.y, roomName: "W7N4" },
    ],
    incomplete: false,
    ops: 10,
    cost: 20,
  }));
  pf.CostMatrix = class {
    private _data = new Uint8Array(2500);
    set(x: number, y: number, cost: number) { this._data[x * 50 + y] = cost; }
    get(x: number, y: number) { return this._data[x * 50 + y] ?? 0; }
  };
}

/** 预热结构缓存（空结构），确保 ensureStructureCache 返回有效 entry。 */
function preloadEmptyStructures(): void {
  preloadStructureCache("W7N4", [], []);
}

/** 覆盖 movement 配置。 */
function cfg(overrides: Record<string, unknown>): void {
  Object.assign(CONFIG.movement as any, overrides);
}

describe("P1-E 集成 — 档 1 目标驻留量化（stepToward）", () => {
  beforeEach(() => {
    setupPathFinderMock();
    preloadEmptyStructures();
    // 仅开档 1，关档 2/3 以隔离测试。
    cfg({ quantizeDynamicTarget: true, dynamicRepathInterval: 0, maxSearchesPerRoomPerTick: 0 });
  });

  it("目标在同区块内移动：第二次 cache 命中，PathFinder.search 只调一次", () => {
    const creep = makeCreep("c1", 25, 25);
    // (34,34) → 区块 (11,11)
    stepToward(creep, target(34, 34));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    // creep 沿路径走一步 → (26,25)
    creep.pos.x = 26;
    // (35,35) → 同区块 (11,11) → cache 命中
    stepToward(creep, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);
  });

  it("目标跨区块移动：cache miss，PathFinder.search 调两次", () => {
    const creep = makeCreep("c1", 25, 25);
    // (35,35) → 区块 (11,11)
    stepToward(creep, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    // creep 沿路径走一步 → (26,25)
    creep.pos.x = 26;
    // (36,36) → 区块 (12,12) → cache miss
    stepToward(creep, target(36, 36));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(2);
  });

  it("档 1 关闭（quantizeDynamicTarget=false）：同位置才 cache 命中", () => {
    cfg({ quantizeDynamicTarget: false });
    const creep = makeCreep("c1", 25, 25);
    stepToward(creep, target(34, 34));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    // 同位置 → cache 命中
    creep.pos.x = 26;
    stepToward(creep, target(34, 34));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    // 不同位置（即使同区块）→ cache miss
    stepToward(creep, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(2);
  });
});

describe("P1-E 集成 — 档 2 重寻路冷却（stepToward）", () => {
  beforeEach(() => {
    setupPathFinderMock();
    preloadEmptyStructures();
    // 仅开档 2，关档 1/3 以隔离测试。
    cfg({ quantizeDynamicTarget: false, dynamicRepathInterval: 3, maxSearchesPerRoomPerTick: 0 });
    G().Game.time = 1000;
  });

  it("冷却内 cache miss：不调 PathFinder.search，走 getDirectionTo 直走降级", () => {
    const creep = makeCreep("c1", 25, 25);
    // 第一次：cache miss → search 调用，lastRepathAt = 1000
    stepToward(creep, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);
    expect(creep.memory.lastRepathAt).toBe(1000);

    // 推进 1 tick（仍在 3 tick 冷却内），换不同目标（cache miss）
    G().Game.time = 1001;
    creep.pos.x = 26;
    stepToward(creep, target(36, 36));
    // 冷却内不调 search
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);
    // 走直走降级 — registerMove 返回 OK（getDirectionTo mock 返回 3）
    // （registerMove 在 traffic 模式下登记意图返回 OK，不实际调 creep.move）
  });

  it("冷却过期：cache miss → 重新调 PathFinder.search", () => {
    const creep = makeCreep("c1", 25, 25);
    stepToward(creep, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    // 推进 4 tick（超过 3 tick 冷却），换不同目标
    G().Game.time = 1004;
    creep.pos.x = 26;
    stepToward(creep, target(36, 36));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(2);
  });

  it("冷却内 cache 命中：不受冷却限制，沿旧路径走", () => {
    const creep = makeCreep("c1", 25, 25);
    stepToward(creep, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    // 推进 1 tick（冷却内），同目标 → cache 命中
    G().Game.time = 1001;
    creep.pos.x = 26;
    stepToward(creep, target(35, 35));
    // cache 命中不调 search
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);
  });

  it("档 2 关闭（dynamicRepathInterval=0）：cache miss 即重算，无冷却", () => {
    cfg({ dynamicRepathInterval: 0 });
    const creep = makeCreep("c1", 25, 25);
    stepToward(creep, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    G().Game.time = 1001;
    creep.pos.x = 26;
    stepToward(creep, target(36, 36));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(2);
  });
});

describe("P1-E 集成 — 档 3 每房每 tick 寻路预算（stepToward）", () => {
  beforeEach(() => {
    setupPathFinderMock();
    preloadEmptyStructures();
    // 仅开档 3，关档 1/2 以隔离测试。
    cfg({ quantizeDynamicTarget: false, dynamicRepathInterval: 0, maxSearchesPerRoomPerTick: 1 });
    G().Game.time = 1000;
  });

  it("预算内：第一个 creep 的 search 正常调用", () => {
    const creep = makeCreep("c1", 25, 25);
    stepToward(creep, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);
  });

  it("超预算：第二个 creep 不调 search，走降级，记 movement/path-budget skip", () => {
    const creep1 = makeCreep("c1", 25, 25);
    stepToward(creep1, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    // 同房第二个 creep，不同目标（避免共享缓存）→ cache miss → 预算耗尽
    const creep2 = makeCreep("c2", 30, 30);
    stepToward(creep2, target(40, 40));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1); // 仍为 1

    // skip 记录
    const skipBuffer = (globalCache() as any).skipBuffer;
    expect(skipBuffer?.["movement/path-budget"]).toBe(1);
  });

  it("不同房独立预算：W7N4 耗尽不影响 W7N5", () => {
    const creep1 = makeCreep("c1", 25, 25);
    creep1.room = { name: "W7N4" };
    stepToward(creep1, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    // 另一房的 creep — 但需要预热该房结构缓存
    preloadStructureCache("W7N5", [], []);
    const creep2 = makeCreep("c2", 10, 10);
    creep2.room = { name: "W7N5" };
    creep2.pos.roomName = "W7N5";
    stepToward(creep2, target(20, 20));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(2);
  });

  it("档 3 关闭（maxSearchesPerRoomPerTick=0）：不限制，所有 creep 都调 search", () => {
    cfg({ maxSearchesPerRoomPerTick: 0 });
    const creep1 = makeCreep("c1", 25, 25);
    stepToward(creep1, target(35, 35));
    const creep2 = makeCreep("c2", 30, 30);
    stepToward(creep2, target(40, 40));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(2);
  });
});

// ─── 三档叠加：默认配置（1+2 开、3 关）综合场景 ─────────────

describe("P1-E 综合 — 默认配置（档 1+2 开、档 3 关）", () => {
  beforeEach(() => {
    setupPathFinderMock();
    preloadEmptyStructures();
    // 默认配置：quantize=true, interval=3, budget=0
    cfg({ quantizeDynamicTarget: true, dynamicRepathInterval: 3, maxSearchesPerRoomPerTick: 0 });
    G().Game.time = 1000;
  });

  it("同区块目标移动：cache 命中，无 search", () => {
    const creep = makeCreep("c1", 25, 25);
    stepToward(creep, target(34, 34));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    creep.pos.x = 26;
    G().Game.time = 1001;
    stepToward(creep, target(35, 35)); // 同区块
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);
  });

  it("跨区块 + 冷却内：不调 search，走直走降级", () => {
    const creep = makeCreep("c1", 25, 25);
    stepToward(creep, target(34, 34));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    G().Game.time = 1001;
    creep.pos.x = 26;
    stepToward(creep, target(40, 40)); // 跨区块 + 冷却内
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);
  });

  it("跨区块 + 冷却过期：调 search 重算", () => {
    const creep = makeCreep("c1", 25, 25);
    stepToward(creep, target(34, 34));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    G().Game.time = 1004;
    creep.pos.x = 26;
    stepToward(creep, target(40, 40)); // 跨区块 + 冷却过期
    expect(G().PathFinder.search).toHaveBeenCalledTimes(2);
  });
});

// ─── 路径契约：缓存首格 = creep 当前位置（2026-08-18 契约修复回归锁）─────
//
// 背景：PathFinder.search 返回的 path 不含起点（官服实测），computeAndPersistPath
// 曾直接存 engine path → nextDirFromPath 定位不到当前位置 → 缓存刚存即删 →
// L2 强制重算 creep 每 tick「search→白费→不动」死循环（线上 scout 卡死 stuck 283+）。
// 修复：缓存/返回路径 prepend creep.pos。本组用例锁定该契约防回归。

describe("路径契约 — 缓存首格 = creep 当前位置", () => {
  beforeEach(() => {
    setupPathFinderMock();
    preloadEmptyStructures();
    cfg({ quantizeDynamicTarget: false, dynamicRepathInterval: 0, maxSearchesPerRoomPerTick: 0 });
    G().Game.time = 1000;
  });

  it("search 后缓存路径首格 = creep.pos（prepend 契约）", () => {
    const creep = makeCreep("c1", 25, 25);
    stepToward(creep, target(35, 35));

    const entry = (globalCache() as any).__creepPathCache?.["c1"];
    expect(entry).toBeDefined();
    expect(entry.path[0].x).toBe(25);
    expect(entry.path[0].y).toBe(25);
    expect(entry.path[0].roomName).toBe("W7N4");
    // 引擎返回的 3 步（不含起点）应完整保留在首格之后。
    expect(entry.path.length).toBe(4);
  });

  it("主路径 search 后必须产生移动意图（L2 死循环回归锁）", () => {
    // 修复前：nextDirFromPath 在「不含起点的 engine path」里找不到 creep → undefined
    // → 缓存即删 → ERR_NO_PATH → 本 tick 无移动意图。L2 forceRepath 豁免冷却降级，
    // 每 tick 重演 = 永久钉死（scout 线上实证）。
    const creep = makeCreep("c1", 25, 25);
    const rc = stepToward(creep, target(35, 35));
    expect(rc).toBe(0); // OK — 意图登记成功
    const ledger = (globalCache() as any).__moveIntents;
    expect(ledger?.intents?.get("c1")).toBeDefined();
    const intent = ledger.intents.get("c1");
    expect(intent.to).toBe(26 * 50 + 25); // (25,25)→RIGHT→(26,25)
  });

  it("缓存滚动：creep 走上路径后命中中段，不重算", () => {
    // 防跨用例残留（前两用例同用 "c1" 名注册过缓存/意图）。
    delete (globalCache() as any).__creepPathCache;
    delete (globalCache() as any).__moveIntents;
    const creep = makeCreep("c1", 25, 25);
    stepToward(creep, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1);

    // 走一步到 (26,25)（= engine path 首格），同目标 → 缓存命中中段
    creep.pos.x = 26;
    G().Game.time = 1001;
    // 生产语义：room-snapshot 每 tick 预热结构缓存（checkedTick 随 tick 续期）。
    // 测试环境无 Game.rooms，不续期会走回退路径返回 undefined → 缓存 miss（环境噪声）。
    const structEntry = (globalCache() as any).__structCache?.["W7N4"];
    if (structEntry) structEntry.checkedTick = 1001;
    stepToward(creep, target(35, 35));
    expect(G().PathFinder.search).toHaveBeenCalledTimes(1); // 不重算
    // 且意图指向下一格 (27,25)
    const intent = (globalCache() as any).__moveIntents?.intents?.get("c1");
    expect(intent.to).toBe(27 * 50 + 25);
  });
});
