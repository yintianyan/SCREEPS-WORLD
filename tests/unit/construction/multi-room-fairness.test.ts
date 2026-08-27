/**
 * Phase R2 验收加固 — 多房间建造公平性单元测试。
 *
 * 证明（任务书三.3）：
 *   - 单房间无法无限占用全局 normal site 槽位：每房配额（3 normal）把单房
 *     占用限制在其自身配额内，配额满后立即让出槽位；
 *   - 其他房间不会建设饥饿：让出后的下一个 tick 即获得 normal 槽位；
 *   - 全局 site cap 由 lane/门禁双路检查（unit 见 rcl2-development-lane.test.ts
 *     「global-site-cap」用例），每房 cap 由 tryCreateSite 配额检查强制。
 *
 * 直接驱动 constructionManagerSystem.run()（双房间快照，逐 tick 推进 Game.time）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { constructionManagerSystem } from "../../../src/systems/construction-manager";
import { resetGlobals } from "../../role-helpers";
import type { RoomSnapshot, TickContext } from "../../../src/kernel/contracts";

beforeEach(() => {
  resetGlobals();
  (globalThis as any).RawMemory = { segments: {} };
});

function makeSnapshot(roomName: string): RoomSnapshot {
  return {
    roomName,
    rcl: 2,
    sources: [{ id: `s-${roomName}`, pos: { x: 20, y: 20 } }],
    controller: { pos: { x: 30, y: 30 } },
    spawns: [],
    extensions: [],
    towers: [],
    containers: [],
    roads: [],
    walls: [],
    ramparts: [],
    labs: [],
    links: [],
    storage: undefined,
    constructionSites: [],
    myConstructionSites: [],
    threatCreeps: [],
    energyAvailable: 500,
    energyCapacityAvailable: 800,
    hostileCreeps: [],
    fillTargets: [],
    needsRecovery: false,
    sourceOccupancy: new Map(),
    pendingHarvesters: 0,
    minerals: [],
  } as unknown as RoomSnapshot;
}

function makeExtensionTask(key: string, roomName: string, x: number, y: number): BuildTask {
  return {
    key,
    pos: { x, y, roomName },
    structureType: "extension",
    priority: 1,
    state: "queued",
    attempts: 0,
    retryAt: 0,
    queuedAt: 1000,
  };
}

describe("多房间公平性 — 全局 normal 槽位不被单房霸占", () => {
  it("房间 A 配额满(3 normal)后立即让位，房间 B 在下一 tick 获得 normal 槽位", () => {
    const g = globalThis as any;
    g.Memory.rooms.W7N4 = { buildQueue: [
      makeExtensionTask("a.ext.1", "W7N4", 25, 26),
      makeExtensionTask("a.ext.2", "W7N4", 26, 24),
      makeExtensionTask("a.ext.3", "W7N4", 24, 24),
      makeExtensionTask("a.ext.4", "W7N4", 27, 25),
    ] };
    g.Memory.rooms.W7N3 = { buildQueue: [
      makeExtensionTask("b.ext.1", "W7N3", 25, 26),
    ] };

    const snapA = makeSnapshot("W7N4");
    const snapB = makeSnapshot("W7N3");

    // mock room：创建 site 成功并把 site 记入对应 snapshot（驱动每房配额判定）。
    const mkRoom = (snap: RoomSnapshot) => ({
      createConstructionSite: vi.fn((x: number, y: number, type: string) => {
        (snap.myConstructionSites as any[]).push({
          pos: { x, y },
          structureType: type,
        });
        return 0;
      }),
    });
    const roomA = mkRoom(snapA);
    const roomB = mkRoom(snapB);
    g.Game.rooms = { W7N4: roomA, W7N3: roomB };

    const ctx = {
      get tick() { return g.Game.time; },
      budget: { tier: "healthy", softLimit: 17, hardLimit: 19, canStart: () => true, isExhausted: () => false, spent: () => 0 },
      globalSiteCount: 0,
      getSnapshot: (_r: string) => snapA,
      snapshots: function* () { yield snapA; yield snapB; },
    } as unknown as TickContext;

    // tick 1–3：A 先迭代并占据 normal 槽位（各建 1 个 extension，共 3 = 每房配额）。
    for (let i = 1; i <= 3; i++) {
      g.Game.time = 1000 + i;
      constructionManagerSystem.run(ctx);
    }
    expect(snapA.myConstructionSites).toHaveLength(3);
    expect(snapB.myConstructionSites).toHaveLength(0);

    // tick 4：A 配额满（normalSites=3）→ 配额拒绝让位 → B 获得 normal 槽位。
    g.Game.time = 1004;
    constructionManagerSystem.run(ctx);
    expect(snapA.myConstructionSites).toHaveLength(3); // A 不再超建
    expect(snapB.myConstructionSites).toHaveLength(1);
    expect(roomB.createConstructionSite).toHaveBeenCalledTimes(1);

    // 总量 4 < 全局上限 7；B 未被永久饥饿。
    expect(snapA.myConstructionSites.length + snapB.myConstructionSites.length).toBeLessThanOrEqual(7);
  });
});
