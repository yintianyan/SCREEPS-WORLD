/** 现役 op 周期经济重估测试（组③ / A-3 + B-6）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { remoteMiningManagerSystem } from "../../../src/systems/remote-mining-manager";
import { intelligenceSystem, __resetIntelStateForTests } from "../../../src/systems/intelligence";
import { globalCache } from "../../../src/kernel/global-cache";
import { createEmptyPlan } from "../../../src/domain/logistics/transport-plan";
import { CONFIG } from "../../../src/config";
import { mockContext, mockSnapshot, resetGlobals, syncSquadIndex } from "../../support/factories";

const homeRoom = "W7N4";
const targetRoom = "W2N1"; // 与 W7N4 线性距离近，正常 pathCost 下达标。
const farRoom = "W7N9"; // 极远房，netScore 跌破门槛。

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
  intelligenceSystem.run({
    tick: now,
    snapshots: () => [],
    budget: { canStart: () => true },
  } as never);
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
      {
        [farRoom]: {
          state: "active",
          sources: 1,
          createdAt: started,
          lastSeen: now,
          lowScoreSince: started,
        },
      },
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
      {
        [targetRoom]: {
          state: "active",
          sources: 2,
          createdAt: now - 100,
          lastSeen: now,
          lowScoreSince: now - 50,
        },
      },
      { [targetRoom]: { kind: "normal", status: "normal", lastSeen: now, pathCost: 60 } }, // 近房高分。
    );
    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));

    const op = g.Memory.rooms[homeRoom].remoteOps[targetRoom];
    expect(op.state).toBe("active");
    expect(op.lowScoreSince).toBeUndefined(); // 回升清零。
  });
});

describe("remote-mining-manager — haulerNeed 决策权回归（A4.4 authority 死锁）", () => {
  it("Plan 存在且新鲜（不含 operation 请求）→ haulerNeed 仍被重算覆写（线上 18k tick 冻结回归）", () => {
    // 线上形态：op.haulerNeed 冻结在 1（2 源），运力仅产出 12%。
    // 旧代码 planActive 恒真 → 覆写被跳过；修复后重估是唯一决策源。
    const g = globalThis as any;
    const now = g.Game.time as number;
    seed(
      now,
      {
        [targetRoom]: {
          state: "active",
          sources: 2,
          haulerNeed: 1, // 冻结的陈旧值。
          createdAt: now - 100,
          lastSeen: now,
        },
      },
      { [targetRoom]: { kind: "normal", status: "normal", lastSeen: now, pathCost: 60 } },
    );
    // 模拟 planner 每 100t 刷新的新鲜 Plan（无 operation 请求 — 线上真实行为）。
    globalCache().logisticsPlan = { tick: now, plan: createEmptyPlan(now, "test") };

    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));

    const op = g.Memory.rooms[homeRoom].remoteOps[targetRoom];
    // eCap 800 → 无路 hauler [8C,8M] 运力 400；pathCost 60 → perHauler=400/120≈3.33；
    // demand=2×10=20 → need=ceil(6.0)=7 → clamp haulersMax(4)。
    expect(op.haulerNeed).toBe(CONFIG.remote.haulersMax);
  });

  it("Plan 过期（plannedAt 超 100t）→ haulerNeed 正常重算（降级路径不回归）", () => {
    const g = globalThis as any;
    const now = g.Game.time as number;
    seed(
      now,
      {
        [targetRoom]: {
          state: "active",
          sources: 2,
          haulerNeed: 1,
          createdAt: now - 100,
          lastSeen: now,
        },
      },
      { [targetRoom]: { kind: "normal", status: "normal", lastSeen: now, pathCost: 60 } },
    );
    globalCache().logisticsPlan = { tick: now - 101, plan: createEmptyPlan(now - 101, "stale") };

    remoteMiningManagerSystem.run(mockContext(mockSnapshot({ rcl: 5, spawns: [{} as never] })));

    expect(g.Memory.rooms[homeRoom].remoteOps[targetRoom].haulerNeed).toBe(
      CONFIG.remote.haulersMax,
    );
  });
});
