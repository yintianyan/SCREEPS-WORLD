/**
 * Prospect Manager 系统测试（R6b 主动情报 — 任务生命周期 + 止损链）。
 *
 * 覆盖：
 *   - expansionAllowed + 合法候选 → 发布任务 + 推 scout 孵化请求
 *   - 姿态未授权 / 低 bucket / 扩张行动进行中 → 不开新任务
 *   - 成功：目标 intel 新鲜（sources 已知）→ 收摊 + 事件 + 回收 scout + 无冷却
 *   - 超时 → 收摊 + 目标冷却
 *   - 侦察兵死亡 → 补派（spawned 递增）；达 maxSpawns 再死 → 失败 + 冷却
 *   - 姿态退出 → 中止（无冷却）
 *   - 冷却期内候选不被重选；冷却到期恢复资格
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prospectManagerSystem } from "../../../src/systems/prospect-manager";
import { mockBudget, mockSnapshot, resetGlobals } from "../../role-helpers";
import { CONFIG } from "../../../src/config";

const TICK = 1000;

beforeEach(() => {
  resetGlobals();
});

function setPosture(expansionAllowed: boolean): void {
  (globalThis as any).Memory.kernel.strategy = {
    posture: expansionAllowed ? "expand" : "develop",
    since: 900,
    expansionAllowed,
    newRemoteOpsAllowed: true,
  };
}

/** 建 sponsor 房 + 一条无视野候选 intel。 */
function setupIntel(): void {
  (globalThis as any).Game.rooms = {
    W7N4: { controller: { my: true, owner: { username: "Me" } } },
  };
  (globalThis as any).Memory.rooms.W7N4 = {
    spawnQueue: [],
    intel: {
      W6N4: { kind: "normal", status: "normal", lastSeen: 500 }, // sources 未知
    },
  };
}

function makeContext(snapshot?: any): any {
  const snap = snapshot ?? mockSnapshot();
  const map: Record<string, any> = { W7N4: snap };
  return {
    tick: (globalThis as any).Game.time,
    budget: mockBudget("healthy"),
    globalSiteCount: 0,
    getSnapshot: (name: string) => map[name],
    snapshots: function* () { yield snap; },
  };
}

function prospectEvents(): any[] {
  return ((globalThis as any).eventBuffer?.events ?? []).filter((e: any) => e.k === 26);
}

describe("prospect-manager — 任务开启", () => {
  it("expansionAllowed + 无视野候选 → 发布任务并推 1 个 scout 请求（spawned=1）", () => {
    (globalThis as any).Memory = { schemaVersion: 29, creeps: {}, rooms: {}, kernel: {} };
    setupIntel();
    setPosture(true);
    (globalThis as any).Game.cpu.bucket = 10000;

    prospectManagerSystem.run(makeContext());

    const mission = (globalThis as any).Memory.kernel.prospect;
    expect(mission.target).toBe("W6N4");
    expect(mission.sponsor).toBe("W7N4");
    expect(mission.spawned).toBe(1);
    const queue = (globalThis as any).Memory.rooms.W7N4.spawnQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].role).toBe("scout");
    expect(queue[0].memory.remoteTarget).toBe("W6N4");
  });

  it("姿态未授权 → 不开任务", () => {
    (globalThis as any).Memory = { schemaVersion: 29, creeps: {}, rooms: {}, kernel: {} };
    setupIntel();
    setPosture(false);
    (globalThis as any).Game.cpu.bucket = 10000;

    prospectManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();
  });

  it("bucket 低于门槛 → 不开任务", () => {
    (globalThis as any).Memory = { schemaVersion: 29, creeps: {}, rooms: {}, kernel: {} };
    setupIntel();
    setPosture(true);
    (globalThis as any).Game.cpu.bucket = 1000;

    prospectManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();
  });

  it("进行中的扩张行动 → 侦察让位", () => {
    (globalThis as any).Memory = { schemaVersion: 29, creeps: {}, rooms: {}, kernel: {} };
    setupIntel();
    setPosture(true);
    (globalThis as any).Game.cpu.bucket = 10000;
    (globalThis as any).Memory.kernel.expansion = {
      state: "claiming", target: "W8N4", sponsor: "W7N4", startedAt: 900,
    };

    prospectManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();
  });
});

describe("prospect-manager — 生命周期与止损", () => {
  function missionFixture(overrides: Record<string, any> = {}): void {
    (globalThis as any).Memory = {
      schemaVersion: 29,
      creeps: {},
      rooms: {
        W7N4: {
          spawnQueue: [],
          intel: {
            W6N4: { kind: "normal", status: "normal", lastSeen: 500 },
          },
        },
      },
      kernel: {
        strategy: { posture: "expand", since: 900, expansionAllowed: true, newRemoteOpsAllowed: true },
        prospect: {
          target: "W6N4", sponsor: "W7N4", startedAt: 900, spawned: 1,
          ...overrides,
        },
      },
    };
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true, owner: { username: "Me" } } },
    };
    (globalThis as any).Game.cpu.bucket = 10000;
  }

  it("成功：目标 intel 新鲜且 sources 已知 → 收摊 + 事件 success + 无冷却", () => {
    missionFixture();
    (globalThis as any).Memory.rooms.W7N4.intel.W6N4 = {
      kind: "normal", status: "normal", sources: 2, lastSeen: 990,
    };
    (globalThis as any).Game.creeps = {
      s1: { memory: { role: "scout", home: "W7N4", remoteTarget: "W6N4" } },
    };

    prospectManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();
    expect((globalThis as any).Memory.kernel.prospectCooldown).toBeUndefined();
    expect((globalThis as any).Game.creeps.s1.memory.recycle).toBe(true);
    expect(prospectEvents()[0]?.d?.[0]).toBe(0);
  });

  it("超时 → 收摊 + 目标冷却", () => {
    missionFixture({ startedAt: TICK - CONFIG.prospect.maxMissionTicks - 100 });
    (globalThis as any).Game.creeps = {
      s1: { memory: { role: "scout", home: "W7N4", remoteTarget: "W6N4" } },
    };

    prospectManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();
    expect((globalThis as any).Memory.kernel.prospectCooldown.W6N4)
      .toBe(TICK + CONFIG.prospect.cooldownTicks);
    expect(prospectEvents()[0]?.d?.[0]).toBe(1);
  });

  it("侦察兵死亡且未达上限 → 补派（spawned 递增）", () => {
    missionFixture({ spawned: 1 });
    // live=0、pending=0 → 视为死亡，补派第 2 只。
    prospectManagerSystem.run(makeContext());

    const mission = (globalThis as any).Memory.kernel.prospect;
    expect(mission.spawned).toBe(2);
    expect((globalThis as any).Memory.rooms.W7N4.spawnQueue).toHaveLength(1);
  });

  it("死亡达 maxSpawns → 失败 + 冷却", () => {
    missionFixture({ spawned: CONFIG.prospect.maxSpawns });
    (globalThis as any).Memory.rooms.W7N4.spawnQueue = []; // 无 pending

    prospectManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();
    expect((globalThis as any).Memory.kernel.prospectCooldown.W6N4)
      .toBe(TICK + CONFIG.prospect.cooldownTicks);
    expect(prospectEvents()[0]?.d?.[0]).toBe(2);
  });

  it("姿态退出 → 中止（无冷却）", () => {
    missionFixture();
    (globalThis as any).Memory.kernel.strategy.expansionAllowed = false;
    (globalThis as any).Memory.kernel.strategy.posture = "develop";
    (globalThis as any).Game.creeps = {
      s1: { memory: { role: "scout", home: "W7N4", remoteTarget: "W6N4" } },
    };

    prospectManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();
    expect((globalThis as any).Memory.kernel.prospectCooldown).toBeUndefined();
    expect((globalThis as any).Game.creeps.s1.memory.recycle).toBe(true);
    expect(prospectEvents()[0]?.d?.[0]).toBe(3);
  });
});

describe("prospect-manager — 冷却管理", () => {
  it("冷却期内的目标不被重选；到期恢复资格", () => {
    (globalThis as any).Memory = { schemaVersion: 29, creeps: {}, rooms: {}, kernel: {} };
    setupIntel();
    setPosture(true);
    (globalThis as any).Game.cpu.bucket = 10000;
    (globalThis as any).Memory.kernel.prospectCooldown = { W6N4: TICK + 10000 };

    prospectManagerSystem.run(makeContext());
    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();

    // 冷却到期 → 恢复资格。
    (globalThis as any).Memory.kernel.prospectCooldown = { W6N4: TICK - 1 };
    prospectManagerSystem.run(makeContext());
    expect((globalThis as any).Memory.kernel.prospect?.target).toBe("W6N4");
  });
});
