/**
 * P1-3 link 网络演化 fallback 测试（link 槽位 fallback 链）。
 *
 * 验证目标：
 *   - shouldHaveControllerLink / shouldHaveStorageLink 谓词正确区分
 *     「几何放不下」与「正常跳过」（已建成/槽位满/RCL不足）
 *   - linkConstrained 标记逻辑：isLinkConstrained / markLinkConstrained / clearLinkConstrained
 *   - LINK_CONSTRAINED_RETRY_INTERVAL 过期后自动重试
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  shouldHaveControllerLink,
  shouldHaveStorageLink,
} from "../../../src/domain/layout/task-factory";
import {
  isLinkConstrained,
  markLinkConstrained,
  clearLinkConstrained,
  LINK_CONSTRAINED_RETRY_INTERVAL,
} from "../../../src/systems/link-system";
import { globalCache } from "../../../src/kernel/global-cache";
import { mockPos, resetGlobals } from "../../role-helpers";
import type { RoomSnapshot } from "../../../src/kernel/contracts";

beforeEach(() => {
  resetGlobals();
});

// ─── snapshot 工厂 ──────────────────────────────────────────

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

// ─── shouldHaveControllerLink 谓词 ──────────────────────────

describe("P1-3 shouldHaveControllerLink", () => {
  it("RCL4：不应有 controller link（RCL < 5）", () => {
    const snap = snapshotAt(4);
    expect(shouldHaveControllerLink(snap, 0)).toBe(false);
  });

  it("RCL5：无 link 且槽位未满 → 应有 controller link", () => {
    const snap = snapshotAt(5);
    expect(shouldHaveControllerLink(snap, 0)).toBe(true);
  });

  it("RCL5：controller 附近已有 link → 不应有", () => {
    const snap = snapshotAt(5, {
      links: [{
        id: "link1",
        pos: mockPos(41, 10),
        structureType: "link",
        store: { getUsedCapacity: () => 0, getFreeCapacity: () => 800, getCapacity: () => 800, energy: 0 } as any,
        cooldown: 0,
        my: true,
      } as any],
    });
    expect(shouldHaveControllerLink(snap, 0)).toBe(false);
  });

  it("RCL5：槽位满（queuedLinkCount=2）→ 不应有", () => {
    const snap = snapshotAt(5);
    // RCL5 maxLinks=2，queued=2 → 槽位满
    expect(shouldHaveControllerLink(snap, 2)).toBe(false);
  });

  it("RCL5：槽位将满（queuedLinkCount=1）→ 仍应有（剩余 1 槽位）", () => {
    const snap = snapshotAt(5);
    // RCL5 maxLinks=2，queued=1 → 剩余 1 槽位
    expect(shouldHaveControllerLink(snap, 1)).toBe(true);
  });

  it("无 controller → 不应有", () => {
    const snap = snapshotAt(5, { controller: undefined });
    expect(shouldHaveControllerLink(snap, 0)).toBe(false);
  });
});

// ─── shouldHaveStorageLink 谓词 ─────────────────────────────

describe("P1-3 shouldHaveStorageLink", () => {
  it("RCL4：不应有 storage link（RCL < 5）", () => {
    const snap = snapshotAt(4);
    expect(shouldHaveStorageLink(snap, 0)).toBe(false);
  });

  it("RCL5：有 storage 且无 link 且槽位未满 → 应有", () => {
    const snap = snapshotAt(5);
    expect(shouldHaveStorageLink(snap, 0)).toBe(true);
  });

  it("RCL5：storage 附近已有 link → 不应有", () => {
    const snap = snapshotAt(5, {
      links: [{
        id: "link1",
        pos: mockPos(26, 26),
        structureType: "link",
        store: { getUsedCapacity: () => 0, getFreeCapacity: () => 800, getCapacity: () => 800, energy: 0 } as any,
        cooldown: 0,
        my: true,
      } as any],
    });
    expect(shouldHaveStorageLink(snap, 0)).toBe(false);
  });

  it("RCL5：槽位满 → 不应有", () => {
    const snap = snapshotAt(5);
    expect(shouldHaveStorageLink(snap, 2)).toBe(false);
  });

  it("无 storage → 不应有", () => {
    const snap = snapshotAt(5, { storage: undefined });
    expect(shouldHaveStorageLink(snap, 0)).toBe(false);
  });
});

// ─── linkConstrained 标记逻辑 ───────────────────────────────

describe("P1-3 linkConstrained 标记", () => {
  it("未标记时 isLinkConstrained 返回 false", () => {
    expect(isLinkConstrained("W7N4", 1000)).toBe(false);
  });

  it("markLinkConstrained 后 isLinkConstrained 返回 true", () => {
    markLinkConstrained("W7N4", 1000);
    expect(isLinkConstrained("W7N4", 1000)).toBe(true);
    expect(isLinkConstrained("W7N4", 1999)).toBe(true);
  });

  it("超过 LINK_CONSTRAINED_RETRY_INTERVAL 后自动过期", () => {
    markLinkConstrained("W7N4", 1000);
    const expiryTick = 1000 + LINK_CONSTRAINED_RETRY_INTERVAL;
    expect(isLinkConstrained("W7N4", expiryTick - 1)).toBe(true);
    expect(isLinkConstrained("W7N4", expiryTick)).toBe(false);
  });

  it("clearLinkConstrained 清除标记", () => {
    markLinkConstrained("W7N4", 1000);
    expect(isLinkConstrained("W7N4", 1000)).toBe(true);
    clearLinkConstrained("W7N4");
    expect(isLinkConstrained("W7N4", 1000)).toBe(false);
  });

  it("不同房间名独立标记", () => {
    markLinkConstrained("W7N4", 1000);
    expect(isLinkConstrained("W7N4", 1000)).toBe(true);
    expect(isLinkConstrained("W7N5", 1000)).toBe(false);
  });

  it("标记写入 globalCache.linkConstrained", () => {
    markLinkConstrained("W7N4", 1000);
    expect(globalCache().linkConstrained?.get("W7N4")).toBe(1000);
  });
});
