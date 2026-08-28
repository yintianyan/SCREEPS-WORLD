/** Prospect Manager 系统测试（R6b 主动情报 — 任务生命周期 + 止损链）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { prospectManagerSystem } from "../../../src/systems/prospect-manager";
import { intelligenceSystem, __resetIntelStateForTests } from "../../../src/systems/intelligence";
import { globalCache } from "../../../src/kernel/global-cache";
import { mockBudget, mockSnapshot, resetGlobals, syncSquadIndex } from "../../role-helpers";
import { CONFIG } from "../../../src/config";

const TICK = 1000;

beforeEach(() => {
  resetGlobals();
  __resetIntelStateForTests();
});

function setPosture(expansionAllowed: boolean): void {
  (globalThis as any).Memory.kernel.strategy = {
    posture: expansionAllowed ? "expand" : "develop",
    since: 900,
    expansionAllowed,
    newRemoteOpsAllowed: true,
  };
}

/** 建 sponsor 房 + 一条无视野候选 intel（观察交接播种 → intelligence 采用）。 */
function setupIntel(): void {
  (globalThis as any).Game.rooms = {
    W7N4: { controller: { my: true, owner: { username: "Me" } } },
  };
  (globalThis as any).Memory.rooms.W7N4 = { spawnQueue: [] };
  __resetIntelStateForTests();
  globalCache().intelHandoff = [{
    subject: "W6N4",
    home: "W7N4",
    source: "observer",
    payload: { kind: "normal", status: "normal", lastSeen: 500 } as never, // sources 未知
  }];
  intelligenceSystem.run({ tick: 1000, snapshots: () => [], budget: { canStart: () => true } } as never);
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
    syncSquadIndex();

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
    syncSquadIndex();
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true, owner: { username: "Me" } } },
    };
    syncSquadIndex();
    (globalThis as any).Game.cpu.bucket = 10000;
  }

  it("成功：目标 intel 新鲜且 sources 已知 → 收摊 + 事件 success + 无冷却", () => {
    missionFixture();
    __resetIntelStateForTests();
    globalCache().intelHandoff = [{
      subject: "W6N4",
      home: "W7N4",
      source: "observer",
      payload: { kind: "normal", status: "normal", sources: 2, lastSeen: 990 } as never,
    }];
    intelligenceSystem.run({
      tick: TICK,
      snapshots: () => [],
      budget: mockBudget(),
    } as never);
    syncSquadIndex();
    (globalThis as any).Game.creeps = {
      s1: { memory: { role: "scout", home: "W7N4", remoteTarget: "W6N4" } },
    };
    syncSquadIndex();

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
    syncSquadIndex();

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

  it("姿态持续退出超 grace → 中止（无冷却）", () => {
    // Opt B：瞬时翻转不再秒撤；仅当非 expand 持续超过 postureGraceTicks 才收摊。
    // 预设 postureExitSince 已越过 grace 窗口 → 视为真实战略撤退，果断中止。
    missionFixture({ postureExitSince: TICK - CONFIG.prospect.postureGraceTicks - 1 });
    (globalThis as any).Memory.kernel.strategy.expansionAllowed = false;
    (globalThis as any).Memory.kernel.strategy.posture = "develop";
    (globalThis as any).Game.creeps = {
      s1: { memory: { role: "scout", home: "W7N4", remoteTarget: "W6N4" } },
    };
    syncSquadIndex();

    prospectManagerSystem.run(makeContext());

    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();
    expect((globalThis as any).Memory.kernel.prospectCooldown).toBeUndefined();
    expect((globalThis as any).Game.creeps.s1.memory.recycle).toBe(true);
    expect(prospectEvents()[0]?.d?.[0]).toBe(3);
  });

  it("Opt B 瞬时翻转（pixel 放血：bucket 跌落、posture 临时翻 develop）→ 任务存活、scout 不孤儿化", () => {
    // 复现线上 bug：generatePixel() 周期清空 bucket → posture 翻 develop → 旧逻辑秒撤任务。
    // Opt B 脱敏：非 expand 仍在 grace 窗口内 → 任务保留、scout 不回收。
    missionFixture({ spawned: 1 });
    (globalThis as any).Memory.kernel.strategy.expansionAllowed = false;
    (globalThis as any).Memory.kernel.strategy.posture = "develop";
    (globalThis as any).Game.cpu.bucket = 0; // 模拟 pixel 放血后 bucket 清零
    (globalThis as any).Game.creeps = {
      s1: { memory: { role: "scout", home: "W7N4", remoteTarget: "W6N4" } },
    };
    syncSquadIndex();

    const ctx = makeContext();
    prospectManagerSystem.run(ctx);

    const mission = (globalThis as any).Memory.kernel.prospect;
    expect(mission).toBeDefined(); // 任务未被撤
    expect(mission.postureExitSince).toBe(TICK); // 脱敏计时已起
    expect((globalThis as any).Game.creeps.s1.memory.recycle).toBeUndefined(); // scout 未被回收
    expect(prospectEvents()).toHaveLength(0); // 无中止事件

    // 下一 tick bucket 回血、posture 翻回 expand → 脱敏计时清零、任务继续存活。
    (globalThis as any).Memory.kernel.strategy.expansionAllowed = true;
    (globalThis as any).Memory.kernel.strategy.posture = "expand";
    (globalThis as any).Game.cpu.bucket = 10000;
    prospectManagerSystem.run(makeContext());
    expect((globalThis as any).Memory.kernel.prospect?.postureExitSince).toBeUndefined();
  });

  it("现场有活敌（hasLiveThreat）→ 绕过 grace 即时中止（无冷却）", () => {
    // Opt B：真实战争威胁优先级最高，即便在 grace 窗口内也立即撤任务回收 scout。
    missionFixture({ spawned: 1 });
    (globalThis as any).Memory.kernel.strategy.expansionAllowed = false;
    (globalThis as any).Memory.kernel.strategy.posture = "develop";
    (globalThis as any).Game.creeps = {
      s1: { memory: { role: "scout", home: "W7N4", remoteTarget: "W6N4" } },
    };
    syncSquadIndex();

    const ctx = makeContext(mockSnapshot({ threatCreeps: [{ id: "x" }] as any }));
    prospectManagerSystem.run(ctx);

    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();
    expect((globalThis as any).Game.creeps.s1.memory.recycle).toBe(true);
    expect(prospectEvents()[0]?.d?.[0]).toBe(3);
  });
});

describe("prospect-manager — 冷却管理", () => {
  it("冷却期内的目标不被重选；转而探前沿房，到期恢复资格", () => {
    // Part 1：W6N4 冷却中 → 不重选 W6N4，视野外扩去探前沿未知房。
    (globalThis as any).Memory = { schemaVersion: 29, creeps: {}, rooms: {}, kernel: {} };
    setupIntel();
    setPosture(true);
    (globalThis as any).Game.cpu.bucket = 10000;
    (globalThis as any).Memory.kernel.prospectCooldown = { W6N4: TICK + 10000 };

    prospectManagerSystem.run(makeContext());
    const cooled = (globalThis as any).Memory.kernel.prospect;
    expect(cooled).toBeDefined();
    expect(cooled.target).not.toBe("W6N4"); // 冷却阻止重选 W6N4
    expect(cooled.sponsor).toBe("W7N4");

    // Part 2：重置 + 冷却到期 → W6N4 恢复资格，被选中。
    (globalThis as any).Memory = { schemaVersion: 29, creeps: {}, rooms: {}, kernel: {} };
    setupIntel();
    setPosture(true);
    (globalThis as any).Game.cpu.bucket = 10000;
    (globalThis as any).Memory.kernel.prospectCooldown = { W6N4: TICK - 1 };

    prospectManagerSystem.run(makeContext());
    expect((globalThis as any).Memory.kernel.prospect?.target).toBe("W6N4");
  });
});

describe("prospect-manager — 视野外扩（horizon）", () => {
  it("已知房全不可殖民 → 改探前沿未知房（打破视野锁死）", () => {
    (globalThis as any).Memory = { schemaVersion: 29, creeps: {}, rooms: {}, kernel: {} };
    (globalThis as any).Game.rooms = {
      W7N4: { controller: { my: true, owner: { username: "Me" } } },
    };
    syncSquadIndex();
    (globalThis as any).Memory.rooms.W7N4 = {
      spawnQueue: [],
      intel: {
        // 已知房有主 → 侦察/扩张均跳过；帝国须外扩找干净中立房。
        W6N4: { kind: "normal", status: "normal", owner: "Enemy", lastSeen: 500 },
      },
    };
    syncSquadIndex();
    setPosture(true);
    (globalThis as any).Game.cpu.bucket = 10000;

    prospectManagerSystem.run(makeContext());

    const mission = (globalThis as any).Memory.kernel.prospect;
    expect(mission).toBeDefined();
    expect(mission.sponsor).toBe("W7N4");
    // 选中的是前沿未知房（mock describeExits 返回 W7N3/W7N5），而非有主的 W6N4。
    expect(mission.target).not.toBe("W6N4");
    const queue = (globalThis as any).Memory.rooms.W7N4.spawnQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].role).toBe("scout");
    expect(queue[0].memory.remoteTarget).toBe(mission.target);
  });
});
