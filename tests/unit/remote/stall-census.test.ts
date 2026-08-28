/** v33 远矿空转止损 + 入口封死废弃测试（remote-mining-manager）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { remoteMiningManagerSystem } from "../../../src/systems/remote-mining-manager";
import { intelligenceSystem, __resetIntelStateForTests } from "../../../src/systems/intelligence";
import { globalCache } from "../../../src/kernel/global-cache";
import { CONFIG } from "../../../src/config";
import { mockContext, mockSnapshot, mockSource, resetGlobals, syncSquadIndex } from "../../role-helpers";
import type { RoomSnapshot } from "../../../src/kernel/contracts";

const homeRoom = "W1N1";
const targetRoom = "W2N2";
const g = (): any => globalThis as any;

/** 构造 active 状态的 RemoteOp。 */
function activeOp(overrides: Partial<RemoteOp> = {}): RemoteOp {
  return {
    state: "active",
    sources: 1,
    haulerNeed: 1,
    createdAt: 0,
    lastSeen: g().Game.time,
    ...overrides,
  };
}

/** 远矿编队 creep mock（只含 census 读取的字段）。 */
function remoteCreep(
  name: string,
  opts: { mode?: string; stuck?: number; spawning?: boolean; recycle?: boolean } = {},
): any {
  return {
    name,
    spawning: opts.spawning ?? false,
    ticksToLive: 1500,
    body: [],
    memory: {
      home: homeRoom,
      remoteTarget: targetRoom,
      mode: opts.mode ?? "work",
      stuckTicks: opts.stuck ?? 0,
      recycle: opts.recycle ?? false,
      role: "remoteHauler",
    },
    room: { name: targetRoom },
  };
}

function seed(opts: {
  creeps?: Record<string, any>;
  intel?: Record<string, any>;
  op?: Record<string, RemoteOp>;
} = {}): RoomSnapshot {
  const glob = g();
  glob.Game.creeps = opts.creeps ?? {};
  syncSquadIndex();
  glob.Memory.rooms[homeRoom] = {
    colonyState: "normal",
    spawnQueue: [],
    remoteOps: opts.op ?? { [targetRoom]: activeOp() },
  };
  if (opts.intel) {
    // IntelQuery 播种：handoff → intelligence 采用（与生产采集路径一致）。
    __resetIntelStateForTests();
    globalCache().intelHandoff = Object.entries(opts.intel).map(([subject, p]) => ({
      subject,
      home: homeRoom,
      source: "observer" as const,
      payload: { kind: "normal", status: "normal", lastSeen: 1000, ...(p as object) } as never,
    }));
    intelligenceSystem.run({ tick: 1000, snapshots: () => [], budget: { canStart: () => true } } as never);
  }
  return mockSnapshot({
    roomName: homeRoom,
    rcl: 6,
    spawns: [{} as never],
    energyCapacityAvailable: 1300,
  });
}

function run(snap: RoomSnapshot): void {
  remoteMiningManagerSystem.run(mockContext(snap));
}

/** 用 tick 推进 + 多次运行把空转计时推到废弃线上（每次 run 会跑完整 run() 体）。 */
function advanceTo(stallTicks: number, snap: RoomSnapshot): void {
  g().Game.time = 1000 + stallTicks;
  run(snap);
}

const normalIntel = {
  [targetRoom]: { kind: "normal", status: "normal", lastSeen: 1000, pathCost: 60 },
};

beforeEach(() => {
  resetGlobals();
});

// ─── 空转止损（censusStalledOps）─────────────────────────────

describe("v33 远矿空转止损", () => {
  it("编队全员 idle：stallSince 起算；持续超时 → 废弃", () => {
    const snap = seed({
      creeps: {
        h1: remoteCreep("h1", { mode: "idle" }),
        h2: remoteCreep("h2", { mode: "idle" }),
      },
      intel: normalIntel,
    });
    run(snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].stallSince).toBe(1000);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].state).toBe("active");

    advanceTo(CONFIG.remote.stallAbandonTicks + 10, snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].state).toBe("abandoned");
  });

  it("卡死成员（stuck≥stallStuckTicks）计入空转；全员卡死同样废弃", () => {
    const snap = seed({
      creeps: {
        r1: remoteCreep("r1", { mode: "acquire", stuck: CONFIG.remote.stallStuckTicks + 5 }),
      },
      intel: normalIntel,
    });
    run(snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].stallSince).toBe(1000);
    advanceTo(CONFIG.remote.stallAbandonTicks + 10, snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].state).toBe("abandoned");
  });

  it("flee 计入空转（受威胁逃亡=不产出）", () => {
    const snap = seed({
      creeps: { h1: remoteCreep("h1", { mode: "flee" }) },
      intel: normalIntel,
    });
    run(snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].stallSince).toBe(1000);
  });

  it("任一成员在工作（acquire/work 且未卡）→ 不计空转、计时清零", () => {
    const snap = seed({
      creeps: {
        h1: remoteCreep("h1", { mode: "idle" }),
        h2: remoteCreep("h2", { mode: "acquire", stuck: 1 }),
      },
      intel: normalIntel,
    });
    const glob = g();
    glob.Memory.rooms[homeRoom].remoteOps[targetRoom].stallSince = 500;
    run(snap);
    expect(glob.Memory.rooms[homeRoom].remoteOps[targetRoom].stallSince).toBeUndefined();
  });

  it("通勤中的 acquire/work 视为工作（跨房导航不误判空转）", () => {
    const snap = seed({
      creeps: {
        h1: remoteCreep("h1", { mode: "acquire", stuck: 0 }),
      },
      intel: normalIntel,
    });
    run(snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].stallSince).toBeUndefined();
  });

  it("编队归零（孵化中/替换窗口）：不计空转、旧计时清零", () => {
    const snap = seed({
      creeps: {
        // 孵化中的替补不计入普查。
        h1: remoteCreep("h1", { spawning: true }),
      },
      intel: normalIntel,
    });
    const glob = g();
    glob.Memory.rooms[homeRoom].remoteOps[targetRoom].stallSince = 500;
    run(snap);
    expect(glob.Memory.rooms[homeRoom].remoteOps[targetRoom].stallSince).toBeUndefined();
  });

  it("空转后恢复工作：计时清零，不误废弃", () => {
    const glob = g();
    const snap = seed({
      creeps: {
        h1: remoteCreep("h1", { mode: "idle" }),
        h2: remoteCreep("h2", { mode: "idle" }),
      },
      intel: normalIntel,
    });
    run(snap); // 起算 stallSince=1000
    // 中途恢复：h2 开始采集。
    glob.Game.creeps.h2.memory.mode = "work";
    advanceTo(CONFIG.remote.stallAbandonTicks + 10, snap);
    expect(glob.Memory.rooms[homeRoom].remoteOps[targetRoom].state).toBe("active");
    expect(glob.Memory.rooms[homeRoom].remoteOps[targetRoom].stallSince).toBeUndefined();
  });
});

// ─── v33-R11：op.sources 现场视野校正 ──────────────────────────

describe("v33-R11 op.sources 视野校正", () => {
  function seedWithVision(roomFind: (t: number) => any[]): RoomSnapshot {
    const glob = g();
    glob.Game.creeps = {};
    syncSquadIndex();
    glob.Game.rooms = {
      [targetRoom]: { name: targetRoom, find: vi.fn(roomFind) },
    };
    glob.Memory.rooms[homeRoom] = {
      colonyState: "normal",
      spawnQueue: [],
      remoteOps: { [targetRoom]: activeOp({ sources: 1 }) }, // 开点快照失真：记 1 源
    };
    return mockSnapshot({
      roomName: homeRoom,
      rcl: 6,
      spawns: [{} as never],
      energyCapacityAvailable: 1300,
    });
  }

  it("有视野：实测 source 数与快照不符 → 校正 op.sources（需求侧随之补齐配员）", () => {
    // 线上实证 W37S57：开点记 1 源，实际 2 源 → 南源长期无采集者。
    const snap = seedWithVision((t) => (t === FIND_SOURCES ? [mockSource("a"), mockSource("b")] : []));
    run(snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].sources).toBe(2);
  });

  it("实测与快照一致 → 不重复写入（幂等）", () => {
    const snap = seedWithVision((t) => (t === FIND_SOURCES ? [mockSource("a")] : []));
    run(snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].sources).toBe(1);
  });

  it("实测 source 数为 0（异常视野）→ 保留旧值（保守不误伤）", () => {
    const snap = seedWithVision(() => []);
    run(snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].sources).toBe(1);
  });
});

// ─── 入口封死废弃（maintainExistingOps）──────────────────────

describe("v33 入口封死废弃", () => {
  it("全部出口封死 → 废弃（编队物理上无法进入）", () => {
    // resetGlobals 的 describeExits 固定返回 4 个出口 {1,3,5,7}。
    const snap = seed({
      intel: {
        [targetRoom]: {
          kind: "normal",
          status: "normal",
          lastSeen: 1000,
          pathCost: 60,
          sealedExits: [1, 3, 5, 7],
        },
      },
    });
    run(snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].state).toBe("abandoned");
  });

  it("部分封死（如 W36S58 仅西侧墙线）→ 不废弃，继续运营", () => {
    const snap = seed({
      intel: {
        [targetRoom]: {
          kind: "normal",
          status: "normal",
          lastSeen: 1000,
          pathCost: 60,
          sealedExits: [7],
          enemySpawns: 1, // 遗迹 spawn：controller 无主 → 仍可运营远矿
        },
      },
    });
    run(snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].state).toBe("active");
  });

  it("sealedExits 为空数组（有视野确认无封死）→ 不废弃", () => {
    const snap = seed({
      intel: {
        [targetRoom]: {
          kind: "normal",
          status: "normal",
          lastSeen: 1000,
          pathCost: 60,
          wallCount: 0,
          sealedExits: [],
        },
      },
    });
    run(snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].state).toBe("active");
  });

  it("sealedExits 缺失（无视野未知）→ 不触发封死废弃（保守不误伤）", () => {
    const snap = seed({ intel: normalIntel });
    run(snap);
    expect(g().Memory.rooms[homeRoom].remoteOps[targetRoom].state).toBe("active");
  });
});
