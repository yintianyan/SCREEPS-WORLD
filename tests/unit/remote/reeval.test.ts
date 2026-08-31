/** 现役 op 周期经济重估测试（组③ / A-3 + B-6）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { remoteMiningManagerSystem } from "../../../src/systems/remote-mining-manager";
import { intelligenceSystem, __resetIntelStateForTests } from "../../../src/systems/intelligence";
import { globalCache } from "../../../src/kernel/global-cache";
import { CONFIG } from "../../../src/config";
import { mockContext, mockSnapshot, resetGlobals, syncSquadIndex } from "../../support/factories";

const homeRoom = "W7N4";
const targetRoom = "W2N1"; // 与 W7N4 线性距离近，正常 pathCost 下达标。
const farRoom = "W7N9";    // 极远房，netScore 跌破门槛。

function seed(now: number, ops: Record<string, unknown>, intel: Record<string, unknown>) {
  const g = globalThis as any;
  g.Game.rooms = {}; // 无视野 — 重估走 intel.pathCost + 线性距离。
  g.Game.creeps = {};
  syncSquadIndex();
  g.Memory.rooms[homeRoom] = { colonyState: "normal", spawnQueue: [], remoteOps: ops };
  // IntelQuery 播种：handoff → intelligence 采用（重估读 payload 视图）。
  __resetIntelStateForTests();
  globalCache().intelHandoff = Object.entries(intel).map(([subject, p]) => ({
    subject,
    home: homeRoom,
    source: "observer" as const,
    payload: { kind: "normal", status: "normal", lastSeen: now, ...(p as object) } as never,
  }));
  intelligenceSystem.run({ tick: now, snapshots: () => [], budget: { canStart: () => true } } as never);
}

beforeEach(() => {
  resetGlobals();
});

describe("remote-mining-manager — 现役 op 周期经济重估", () => {
  it("netScore 首次跌破门槛只起算、不立即废弃（抗抖动）", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;
    seed(
      now,
      { [farRoom]: { state: "active", sources: 1, createdAt: now - 100, lastSeen: now } },
      { [farRoom]: { kind: "normal", status: "normal", lastSeen: now, pathCost: 5000 } },
    );
    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));

    const op = g.Memory.rooms[homeRoom].remoteOps[farRoom];
    expect(op.state).toBe("active"); // 未立即废弃。
    expect(op.lowScoreSince).toBe(now); // 起算宽限期。
  });

  it("低分持续超过宽限期 → 废弃", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;
    const started = now - CONFIG.remote.lowScoreGrace - 100; // 早已跌破。
    seed(
      now,
      { [farRoom]: { state: "active", sources: 1, createdAt: started, lastSeen: now, lowScoreSince: started } },
      { [farRoom]: { kind: "normal", status: "normal", lastSeen: now, pathCost: 5000 } },
    );
    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));

    expect(g.Memory.rooms[homeRoom].remoteOps[farRoom].state).toBe("abandoned");
  });

  it("netScore 回升到门槛以上 → 清除低分计时", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;
    seed(
      now,
      { [targetRoom]: { state: "active", sources: 2, createdAt: now - 100, lastSeen: now, lowScoreSince: now - 50 } },
      { [targetRoom]: { kind: "normal", status: "normal", lastSeen: now, pathCost: 60 } }, // 近房高分。
    );
    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));

    const op = g.Memory.rooms[homeRoom].remoteOps[targetRoom];
    expect(op.state).toBe("active");
    expect(op.lowScoreSince).toBeUndefined(); // 回升清零。
  });
});
