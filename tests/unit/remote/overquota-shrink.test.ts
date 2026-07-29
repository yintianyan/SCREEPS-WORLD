/**
 * 远矿超额收缩测试 — spawn 产能维度接入后的存量治理。
 *
 * 背景：effectiveMaxOperations 曾只看 storage 有无（建成即放开到 2），
 * 单 spawn 房开双远矿后远程编制 ~11 只把唯一孵化位占满，本地
 * upgrader/builder/distributor 寿终后永远排不到队首（线上实测：远程吃掉
 * 50% 孵化产出，本地关键角色全饿死）。修复引入 spawn 数上限 + 超额收缩：
 * active 数超过新上限时废弃编制最贵的（haulerNeed 最大 = 通勤最远）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { remoteMiningManagerSystem } from "../../../src/systems/remote-mining-manager";
import { mockContext, mockSnapshot, resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("remote-mining-manager — 超额收缩（spawn 产能上限）", () => {
  it("单 spawn 房双远矿 active → 废弃 haulerNeed 更大者，保留更近的", () => {
    const g = globalThis as unknown as {
      Game: { time: number };
      Memory: { rooms: Record<string, unknown> };
    };
    const now = g.Game.time;

    g.Memory.rooms.W7N4 = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: {
        // 近房：haulerNeed=2（应保留）。
        W7N3: { state: "active", haulerNeed: 2, createdAt: now - 500, lastSeen: now },
        // 远房：haulerNeed=3（编制最贵，应被废弃）。
        W8N4: { state: "active", haulerNeed: 3, createdAt: now - 500, lastSeen: now },
      },
    };

    // 单 spawn + 有 storage：上限 = min(maxOperations=2, spawnCount=1) = 1。
    const snapshot = mockSnapshot({
      rcl: 4,
      spawns: [{} as never],
      storage: {} as never,
    });
    remoteMiningManagerSystem.run(mockContext(snapshot));

    const ops = (g.Memory.rooms.W7N4 as { remoteOps: Record<string, { state: string }> }).remoteOps;
    expect(ops.W7N3!.state).toBe("active");
    expect(ops.W8N4!.state).toBe("abandoned");
  });

  it("双 spawn 房双远矿 active → 上限 2，不收缩", () => {
    const g = globalThis as unknown as {
      Game: { time: number };
      Memory: { rooms: Record<string, unknown> };
    };
    const now = g.Game.time;

    g.Memory.rooms.W7N4 = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: {
        W7N3: { state: "active", haulerNeed: 2, createdAt: now - 500, lastSeen: now },
        W8N4: { state: "active", haulerNeed: 3, createdAt: now - 500, lastSeen: now },
      },
    };

    const snapshot = mockSnapshot({
      rcl: 7,
      spawns: [{} as never, {} as never],
      storage: {} as never,
    });
    remoteMiningManagerSystem.run(mockContext(snapshot));

    const ops = (g.Memory.rooms.W7N4 as { remoteOps: Record<string, { state: string }> }).remoteOps;
    expect(ops.W7N3!.state).toBe("active");
    expect(ops.W8N4!.state).toBe("active");
  });

  it("haulerNeed 缺失（存量运营）按 1 处理，平局按房名字典序废弃靠前者", () => {
    const g = globalThis as unknown as {
      Game: { time: number };
      Memory: { rooms: Record<string, unknown> };
    };
    const now = g.Game.time;

    g.Memory.rooms.W7N4 = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: {
        W7N3: { state: "active", createdAt: now - 500, lastSeen: now },
        W8N4: { state: "active", createdAt: now - 500, lastSeen: now },
      },
    };

    const snapshot = mockSnapshot({
      rcl: 4,
      spawns: [{} as never],
      storage: {} as never,
    });
    remoteMiningManagerSystem.run(mockContext(snapshot));

    const ops = (g.Memory.rooms.W7N4 as { remoteOps: Record<string, { state: string }> }).remoteOps;
    // 平局（都视为 haulerNeed=1）→ 字典序靠前的 W7N3 被废弃，保证确定性。
    expect(ops.W7N3!.state).toBe("abandoned");
    expect(ops.W8N4!.state).toBe("active");
  });
});
