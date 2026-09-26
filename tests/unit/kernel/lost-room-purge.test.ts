/**
 * B4-⑲ — 失守房账本清盘的可归因性。
 *
 * `maintainMemory` 的 LOST_ROOM_GRACE 届满时会连着删掉 `Memory.rooms[r]` 与
 * `Memory.kernel.tuning.rooms[r]` / `lastEval[r]`。删本身是对的（宽限期 20000t 大于
 * FROZEN_DURATION 10000t 与 verifyDelay 1500t，那份账本里的冻结保护与在途验证此刻
 * 必然早已过期，想保也保不住）——**缺陷是全程无声**：调参账本一消失，"这间房调过
 * 什么、为什么被冻过"再无处可查，回收一间隔房重开运营时线上只看到调参从头再来。
 *
 * 这里钉的是：有东西被抹掉时必须留下事件（含被抹掉的数量与失守时长），
 * 没东西被抹掉时不发噪声，宽限期内一律不删。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { maintainMemory } from "../../../src/kernel/memory";
import { EventKind } from "../../../src/kernel/event-log";
import { resetGlobals } from "../../support/factories";

const NOW = 30000;
const GRACE = 20000;
const OWNED = "W7N4";
const LOST = "W6N4";

const G = () => globalThis as any;

function purgeEvents(): Array<{ k: number; r: string; d: number[] }> {
  const events = G().eventBuffer?.events ?? [];
  return events.filter((e: any) => e.k === EventKind.LostRoomPurge);
}

/** 布景：OWNED 在视野内，LOST 只活在 Memory 里（失守），失守时长由 lostFor 控制。 */
function setup(opts: { lostFor: number; withTuning?: boolean; withRemoteOps?: boolean }): void {
  resetGlobals();
  G().Game.time = NOW;
  G().Game.creeps = {};
  G().Game.rooms = { [OWNED]: { controller: { my: true, owner: { username: "Me" } } } };
  G().Memory.rooms = {
    [OWNED]: { spawnQueue: [], buildQueue: [] },
    [LOST]: { spawnQueue: [], buildQueue: [] },
  };
  G().Memory.kernel = { lostRooms: { [LOST]: NOW - opts.lostFor } };

  if (opts.withTuning) {
    G().Memory.kernel.tuning = {
      baselineVersion: 2,
      rooms: {
        [LOST]: {
          roleBounds: {
            harvester: { minCount: 1, maxCount: 3 },
            hauler: { minCount: 1, maxCount: 4 },
          },
          lastAdjusted: { "hauler.maxCount": NOW - GRACE - 5000 },
          pendingValidation: { "harvester.maxCount": { adjustTick: NOW - GRACE - 9000 } },
          frozenParams: {
            "hauler.maxCount": { frozenUntil: NOW - GRACE - 4000, rollbackCount: 3 },
          },
        },
      },
      lastEval: { [LOST]: { tick: NOW - GRACE - 100, adjustments: [], signals: {} } },
    };
  }
  if (opts.withRemoteOps) {
    G().Memory.rooms[LOST].remoteOps = { W5N4: { state: "active", createdAt: 1, lastSeen: 1 } };
  }
}

beforeEach(() => {
  resetGlobals();
});

describe("B4-⑲ 失守房清盘必须留账", () => {
  it("宽限期届满且有调参账 → 删账之前记一条 LostRoomPurge，带被抹掉的数量", () => {
    setup({ lostFor: GRACE + 1, withTuning: true });

    maintainMemory();

    const events = purgeEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.r).toBe(LOST);
    // d = [reasonCode, overrides, pending, frozen, remoteOps, lostForTicks]
    expect(events[0]!.d).toEqual([0, 2, 1, 1, 0, GRACE + 1]);
    // 账本照旧被清（本修复只加可见性，不改清理语义）。
    expect(G().Memory.rooms[LOST]).toBeUndefined();
    expect(G().Memory.kernel.tuning.rooms[LOST]).toBeUndefined();
    expect(G().Memory.kernel.tuning.lastEval[LOST]).toBeUndefined();
    expect(G().Memory.kernel.lostRooms[LOST]).toBeUndefined();
  });

  it("连带远矿账一起抹 → remoteOps 计数进事件，别房的账不受影响", () => {
    setup({ lostFor: GRACE + 1, withTuning: true, withRemoteOps: true });
    G().Memory.kernel.tuning.rooms[OWNED] = {
      roleBounds: { harvester: { minCount: 2, maxCount: 2 } },
    };

    maintainMemory();

    expect(purgeEvents()[0]!.d).toEqual([0, 2, 1, 1, 1, GRACE + 1]);
    expect(G().Memory.kernel.tuning.rooms[OWNED]).toBeDefined();
    expect(G().Memory.rooms[OWNED]).toBeDefined();
  });

  it("失守房里啥账都没有 → 不发事件（清盘是日常，不制造噪声）", () => {
    setup({ lostFor: GRACE + 1 });

    maintainMemory();

    expect(purgeEvents()).toHaveLength(0);
    expect(G().Memory.rooms[LOST]).toBeUndefined();
  });

  it("宽限期内（未届满）→ 一律不删、不记", () => {
    setup({ lostFor: GRACE - 100, withTuning: true, withRemoteOps: true });

    maintainMemory();

    expect(purgeEvents()).toHaveLength(0);
    expect(G().Memory.rooms[LOST]).toBeDefined();
    expect(G().Memory.kernel.tuning.rooms[LOST]).toBeDefined();
    expect(G().Memory.kernel.lostRooms[LOST]).toBe(NOW - (GRACE - 100));
  });

  it("重新拿回视野 → 失守标记清除，账本完整保留", () => {
    setup({ lostFor: GRACE - 100, withTuning: true });
    G().Game.rooms[LOST] = { controller: { my: true, owner: { username: "Me" } } };

    maintainMemory();

    expect(purgeEvents()).toHaveLength(0);
    expect(G().Memory.kernel.lostRooms[LOST]).toBeUndefined();
    expect(G().Memory.kernel.tuning.rooms[LOST]).toBeDefined();
    expect(G().Memory.rooms[LOST]).toBeDefined();
  });
});
