/**
 * 移动缓存与让路测试（Batch 4 — MV-2/MV-3/MV-4 回归）。
 *
 * MV-2：持久化路径按路网 revision 失效（布局指纹变化才失效，非结构总数）
 * MV-3：yield 请求带 TTL（过期丢弃）+ parked creep 响应让路
 * MV-4：跨房出口缓存 TTL
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  preloadStructureCache,
  checkAndExecuteYield,
  tryPullBlocker,
  parkIdleCreep,
} from "../../../src/creeps/movement";
import { pruneDeadCreepCache } from "../../../src/creeps/movement/pathfinding";
import { globalCache } from "../../../src/kernel/global-cache";
import { mockSnapshot, resetGlobals } from "../../role-helpers";

const g = (): any => globalThis as any;

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

// ─── MV-2：路网 revision 失效键 ──────────────────────────────

describe("MV-2 — structCache revision（布局指纹失效）", () => {
  function road(x: number, y: number): any {
    return { structureType: "road", pos: { x, y } };
  }

  it("布局不变：revision 稳定（缓存命中率不因无关刷新下降）", () => {
    preloadStructureCache("W1N1", [road(10, 10), road(11, 10)], []);
    const rev1 = (globalCache() as any).__structCache.W1N1.revision;
    // 同一布局再次预热（下一 tick）。
    preloadStructureCache("W1N1", [road(10, 10), road(11, 10)], []);
    const rev2 = (globalCache() as any).__structCache.W1N1.revision;
    expect(rev2).toBe(rev1);
  });

  it("布局变化（一拆一建，总数不变）：revision 递增 — 修复总数键盲区", () => {
    preloadStructureCache("W1N1", [road(10, 10), road(11, 10)], []);
    const rev1 = (globalCache() as any).__structCache.W1N1.revision;
    // 拆 (11,10) 建 (12,10) — 总数仍是 2，但布局变了。
    preloadStructureCache("W1N1", [road(10, 10), road(12, 10)], []);
    const rev2 = (globalCache() as any).__structCache.W1N1.revision;
    expect(rev2).toBeGreaterThan(rev1);
  });

  it("新增结构：revision 递增", () => {
    preloadStructureCache("W1N1", [road(10, 10)], []);
    const rev1 = (globalCache() as any).__structCache.W1N1.revision;
    preloadStructureCache("W1N1", [road(10, 10), road(11, 10)], []);
    const rev2 = (globalCache() as any).__structCache.W1N1.revision;
    expect(rev2).toBeGreaterThan(rev1);
  });
});

// ─── MV-3：yield TTL + 过期丢弃 ─────────────────────────────

describe("MV-3 — yield 请求 TTL", () => {
  function mockMover(name: string, dir = 3): any {
    return {
      name,
      pos: { x: 25, y: 25, getDirectionTo: vi.fn(() => dir) },
      room: { lookForAt: vi.fn(() => []) },
      move: vi.fn(() => 0),
      fatigue: 0,
    };
  }

  it("新鲜请求：目标 creep 执行让路移动", () => {
    const blocker = mockMover("blocker");
    // 请求方推 blocker 沿方向 3。
    const requester = {
      pos: {
        x: 25, y: 25,
        getDirectionTo: vi.fn(() => 3),
      },
      room: { lookForAt: vi.fn(() => [blocker]) },
    };
    tryPullBlocker(requester as any, { x: 26, y: 25 } as any);

    // blocker 下次调用 checkAndExecuteYield → 执行移动。
    const handled = checkAndExecuteYield(blocker as any);
    expect(handled).toBe(true);
    expect(blocker.move).toHaveBeenCalled();
  });

  it("过期请求（> 2 tick）：丢弃不执行", () => {
    const blocker = mockMover("blocker");
    g().__yieldRequests = { blocker: { dir: 3, tick: g().Game.time - 5 } };

    const handled = checkAndExecuteYield(blocker as any);
    expect(handled).toBe(false);
    expect(blocker.move).not.toHaveBeenCalled();
  });

  it("兼容旧格式（纯数字，global reset 前残留）：当 tick 执行", () => {
    const blocker = mockMover("blocker");
    g().__yieldRequests = { blocker: 3 };

    const handled = checkAndExecuteYield(blocker as any);
    expect(handled).toBe(true);
  });
});

// ─── MV-3：parked creep 响应让路 ────────────────────────────

describe("MV-3 — parked creep 响应让路请求", () => {
  it("parkIdleCreep 开头执行 yield — 静止 creep 不再让路失效", () => {
    const snap = mockSnapshot();
    const parked: any = {
      name: "parked_1",
      pos: { x: 25, y: 25, getDirectionTo: vi.fn(() => 3) },
      room: {
        name: "W7N4",
        getTerrain: () => ({ get: () => 0 }),
        lookForAt: vi.fn(() => []),
        getPositionAt: (x: number, y: number) => ({ x, y }),
      },
      move: vi.fn(() => 0),
      fatigue: 0,
    };
    // 预置让路请求。
    g().__yieldRequests = { parked_1: { dir: 3, tick: g().Game.time } };

    parkIdleCreep(parked, snap);

    expect(parked.move).toHaveBeenCalledWith(3);
  });
});

// ─── P2-L：__creepPathCache 死 creep 清理 ────────────────────
describe("P2-L — pruneDeadCreepCache 清理死 creep 残留", () => {
  /** 直接写 __creepPathCache 条目（绕过 pathfinding 内部写入逻辑）。 */
  function seedCache(entries: Record<string, any>): void {
    (globalCache() as any).__creepPathCache = { ...entries };
  }

  it("cache 含死 creep + 活 creep → 只删死 creep，返回清理数", () => {
    g().Game.creeps = { alive1: { name: "alive1" }, alive2: { name: "alive2" } };
    seedCache({
      alive1: { targetKey: 1, structRevision: 0, path: [] },
      dead1: { targetKey: 2, structRevision: 0, path: [] },
      alive2: { targetKey: 3, structRevision: 0, path: [] },
      dead2: { targetKey: 4, structRevision: 0, path: [] },
    });

    const pruned = pruneDeadCreepCache();

    expect(pruned).toBe(2);
    const cache = (globalCache() as any).__creepPathCache;
    expect(Object.keys(cache).sort()).toEqual(["alive1", "alive2"]);
  });

  it("cache 为空 → 返回 0（无异常）", () => {
    g().Game.creeps = {};
    seedCache({});
    expect(pruneDeadCreepCache()).toBe(0);
  });

  it("所有 creep 都活着 → 返回 0，cache 不变", () => {
    g().Game.creeps = { a: { name: "a" }, b: { name: "b" } };
    seedCache({
      a: { targetKey: 1, structRevision: 0, path: [] },
      b: { targetKey: 2, structRevision: 0, path: [] },
    });
    const before = (globalCache() as any).__creepPathCache;
    expect(pruneDeadCreepCache()).toBe(0);
    const after = (globalCache() as any).__creepPathCache;
    expect(Object.keys(after).sort()).toEqual(["a", "b"]);
    // 引用不变 — 没有删除操作时不重建对象。
    expect(after).toBe(before);
  });

  it("所有 creep 都死了 → 全部清理，返回总数", () => {
    g().Game.creeps = {};
    seedCache({
      dead1: { targetKey: 1, structRevision: 0, path: [] },
      dead2: { targetKey: 2, structRevision: 0, path: [] },
      dead3: { targetKey: 3, structRevision: 0, path: [] },
    });
    expect(pruneDeadCreepCache()).toBe(3);
    expect(Object.keys((globalCache() as any).__creepPathCache)).toHaveLength(0);
  });

  it("幂等：连续调用第二次返回 0（第一次已清完）", () => {
    g().Game.creeps = { alive: { name: "alive" } };
    seedCache({
      alive: { targetKey: 1, structRevision: 0, path: [] },
      dead: { targetKey: 2, structRevision: 0, path: [] },
    });
    expect(pruneDeadCreepCache()).toBe(1);
    expect(pruneDeadCreepCache()).toBe(0);
  });

  it("cache 未初始化（global reset 后）→ 返回 0（getCreepPathCache 惰性创建）", () => {
    g().Game.creeps = { a: { name: "a" } };
    // 不调 seedCache — __creepPathCache 不存在。
    delete (globalCache() as any).__creepPathCache;
    expect(pruneDeadCreepCache()).toBe(0);
  });
});
