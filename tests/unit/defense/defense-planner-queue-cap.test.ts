/** defense-planner buildQueue 积压回归测试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetGlobals } from "../../support/factories";
import { CONFIG } from "../../../src/config";

// defense-planner 不是纯函数模块 — addCoreRampartCoverage 内部直接操作 queue。
// 通过 mock Game + Memory 测试其入队行为是否遵守 maxBackgroundQueuedPerRoom 和 queuedAt。

const MAX_BG = CONFIG.construction.maxBackgroundQueuedPerRoom;

function makeSnapshot(rcl = 7): any {
  return {
    roomName: "W7N4",
    rcl,
    sources: [{ id: "s1", pos: { x: 20, y: 20 } }],
    controller: { pos: { x: 30, y: 30 } },
    spawns: [{ pos: { x: 25, y: 25 }, id: "sp1" }],
    extensions: Array.from({ length: 50 }, (_, i) => ({ pos: { x: 26 + (i % 10), y: 26 + Math.floor(i / 10) } })),
    towers: [{ pos: { x: 24, y: 24 }, id: "tw1" }],
    containers: [{ pos: { x: 21, y: 20 }, id: "c1" }],
    roads: [],
    walls: [],
    ramparts: [],
    labs: [],
    links: [{ pos: { x: 23, y: 23 }, id: "l1" }],
    storage: { pos: { x: 22, y: 22 }, id: "st1" },
    constructionSites: [],
    myConstructionSites: [],
    threatCreeps: [],
  };
}

describe("defense-planner — buildQueue 积压防护", () => {
  beforeEach(() => {
    resetGlobals();
    (globalThis as any).RawMemory = { segments: {} };
    (globalThis as any).Game.time = 82812000;
  });

  it("addCoreRampartCoverage 设置 queuedAt", async () => {
    // 直接验证 defense-planner 模块的入队行为
    const { defensePlannerSystem } = await import("../../../src/systems/defense-planner");
    const snapshot = makeSnapshot(7);
    (globalThis as any).Game.rooms = {
      W7N4: {
        getTerrain: () => ({ get: () => 0 }),
        find: () => [],
        lookForAt: () => [],
      },
    };
    (globalThis as any).Memory = {
      rooms: { W7N4: { buildQueue: [], layout: { anchor: 25 * 50 + 25 } } },
      kernel: {},
    };
    // P3 系统在 healthy 下运行
    const ctx: any = {
      snapshots: () => [snapshot],
      globalSiteCount: 0,
      budget: { tier: "healthy" },
    };
    (globalThis as any).Game.cpu.bucket = 10000;

    defensePlannerSystem.run(ctx);

    const queue = (globalThis as any).Memory.rooms.W7N4.buildQueue;
    expect(queue.length).toBeGreaterThan(0);
    // 每个入队的任务必须有 queuedAt
    for (const task of queue) {
      expect(task.queuedAt).toBeDefined();
      expect(typeof task.queuedAt).toBe("number");
      expect(task.queuedAt).toBe((globalThis as any).Game.time);
    }
  });

  it("addCoreRampartCoverage 遵守 maxBackgroundQueuedPerRoom 上限", async () => {
    const { defensePlannerSystem } = await import("../../../src/systems/defense-planner");
    const snapshot = makeSnapshot(7);
    (globalThis as any).Game.rooms = {
      W7N4: {
        getTerrain: () => ({ get: () => 0 }),
        find: () => [],
        lookForAt: () => [],
      },
    };
    // 预填充队列到上限
    const preFilled = Array.from({ length: MAX_BG }, (_, i) => ({
      key: `existing.rampart.${i}`,
      pos: { x: 1 + i, y: 1, roomName: "W7N4" },
      structureType: "rampart",
      priority: 2,
      state: "queued" as const,
      attempts: 0,
      retryAt: 0,
      queuedAt: 1000,
    }));
    (globalThis as any).Memory = {
      rooms: { W7N4: { buildQueue: preFilled, layout: { anchor: 25 * 50 + 25 } } },
      kernel: {},
    };
    (globalThis as any).Game.cpu.bucket = 10000;

    const ctx: any = {
      snapshots: () => [snapshot],
      globalSiteCount: 0,
      budget: { tier: "healthy" },
    };

    defensePlannerSystem.run(ctx);

    const queue = (globalThis as any).Memory.rooms.W7N4.buildQueue;
    // 不应超过 maxBackgroundQueuedPerRoom + 已有的非背景任务数（此处全为背景）
    const bgQueued = queue.filter(
      (t: any) => (t.state === "queued" || t.state === "blocked") && t.priority >= 2,
    ).length;
    expect(bgQueued).toBeLessThanOrEqual(MAX_BG);
  });
});
