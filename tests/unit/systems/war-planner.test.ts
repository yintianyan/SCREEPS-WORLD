/**
 * War Planner 系统测试（R3 战时闭环 + R4 自治升级）。
 *
 * 覆盖：
 *   R3 姿态消费与编队孵化：
 *   - war 姿态 + 合法目标 → 发布 warPlan（build 相位、spawned=0）并推 attacker 请求
 *   - 编队缺口逐步补齐到 squadSize（key 稳定不重复、spawned 同步累计）
 *   - 在役满编 → phase advance，不再补请求
 *   - 无合格目标 → 不发布 warPlan
 *   R4 收摊与战后核验：
 *   - 非 war 姿态 → 收摊：核验 failure → 黑名单 + 清计划 + 撤请求 + 回收 attacker
 *   - 核验 success（塔网清零 / 敌人弃房）→ 不黑名单
 *   - 核验 unknown（情报过期）→ 黑名单
 *   - demobilize 幂等
 *   R4 战损止损与波次相位：
 *   - spawned 超编队 × casualtyMultiplier → 收摊（attrition）+ 黑名单
 *   - advance 残编 → 回落 build（幸存者归建重组）
 *   - 黑名单目标不被重选（选次优）
 *   - 计划存续期间目标进黑名单 → 立即收摊
 */
import { beforeEach, describe, expect, it } from "vitest";
import { demobilize, warPlannerSystem } from "../../../src/systems/war-planner";
import { mockContext, mockSnapshot, resetGlobals } from "../../role-helpers";
import { CONFIG } from "../../../src/config";

const TICK = 1000;

beforeEach(() => {
  resetGlobals();
});

function setPosture(posture: "develop" | "expand" | "fortify" | "war"): void {
  (globalThis as any).Memory.kernel.strategy = {
    posture,
    since: 900,
    expansionAllowed: posture === "expand",
    newRemoteOpsAllowed: posture === "develop" || posture === "expand",
  };
}

/** 建立 home 房：我方控制器 + 邻居情报（默认 W6N4 合格 / W6N5 SK 不合格）。 */
function setupHome(extraIntel: Record<string, any> = {}): void {
  (globalThis as any).Game.rooms = {
    W7N4: { controller: { my: true, owner: { username: "Me" } } },
  };
  (globalThis as any).Memory.rooms.W7N4 = {
    spawnQueue: [],
    intel: {
      W6N4: { kind: "normal", owner: "Enemy", lastSeen: 900, towers: 0 },
      W6N5: { kind: "sk", owner: "Enemy", lastSeen: 900, towers: 0 },
      ...extraIntel,
    },
  };
}

/** 在役 attacker 计数（live）。 */
function setLiveAttackers(count: number): void {
  const creeps: Record<string, any> = {};
  for (let i = 0; i < count; i++) {
    creeps[`a${i}`] = {
      memory: { role: "attacker", home: "W7N4", remoteTarget: "W6N4" },
    };
  }
  (globalThis as any).Game.creeps = creeps;
}

/** 读取 WarOutcome 事件（kind=23）列表。 */
function warOutcomeEvents(): any[] {
  const events = (globalThis as any).eventBuffer?.events ?? [];
  return events.filter((e: any) => e.k === 23);
}

describe("R3 — 姿态消费与编队孵化", () => {
  it("war 姿态 + 合法目标 → 发布 warPlan（build 相位，spawned=0）并推 1 个 attacker 请求", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    const plan = (globalThis as any).Memory.kernel.warPlan;
    expect(plan.targetRoom).toBe("W6N4");
    expect(plan.sponsor).toBe("W7N4");
    expect(plan.squadSize).toBe(3); // 无 tower 基数 3
    expect(plan.phase).toBe("build"); // 新计划从集结开始
    expect(plan.spawned).toBe(1);

    const queue = (globalThis as any).Memory.rooms.W7N4.spawnQueue;
    expect(queue.length).toBe(1);
    expect(queue[0].role).toBe("attacker");
    expect(queue[0].memory.remoteTarget).toBe("W6N4");
  });

  it("编队缺口逐步补齐到 squadSize（key 稳定不重复，spawned 同步累计）", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");

    const ctx = mockContext(mockSnapshot());
    warPlannerSystem.run(ctx);
    const queue = (globalThis as any).Memory.rooms.W7N4.spawnQueue;
    expect(queue.length).toBe(1);

    // 第 2 次运行：live=0 + pending=1 → 再补 1 个。
    warPlannerSystem.run(ctx);
    expect(queue.length).toBe(2);
    expect(queue[1].key).not.toBe(queue[0].key);

    // 第 3 次运行应补到 squadSize=3。
    warPlannerSystem.run(ctx);
    expect(queue.length).toBe(3);

    // spawned 只随新 key 递增：三次运行后 = 3，与队列长度一致。
    expect((globalThis as any).Memory.kernel.warPlan.spawned).toBe(3);
  });

  it("在役满编（live ≥ squadSize）→ phase advance，不再补请求", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    setLiveAttackers(3);

    warPlannerSystem.run(mockContext(mockSnapshot()));

    const plan = (globalThis as any).Memory.kernel.warPlan;
    expect(plan.phase).toBe("advance");
    expect(plan.spawned).toBe(0); // 满编 — 无新提交
    expect((globalThis as any).Memory.rooms.W7N4.spawnQueue).toHaveLength(0);
  });

  it("无合格目标 → 不发布 warPlan", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    // 使唯一合格目标失效：owner 清空（无主房不是战争目标）。
    (globalThis as any).Memory.rooms.W7N4.intel.W6N4.owner = undefined;

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Memory.rooms.W7N4.spawnQueue).toHaveLength(0);
  });
});

describe("R4 — 收摊与战后核验", () => {
  function warPlanFixture(overrides: Record<string, any> = {}): void {
    (globalThis as any).Memory = {
      schemaVersion: 27,
      creeps: {},
      rooms: {
        W7N4: {
          spawnQueue: [
            {
              key: "attacker:W7N4:W6N4:0", role: "attacker", home: "W7N4", priority: 2,
              body: ["attack", "move"], memory: { role: "attacker", home: "W7N4", remoteTarget: "W6N4" },
              createdAt: 900, expiresAt: 1900, retries: 0,
            },
          ],
          intel: {
            W6N4: { kind: "normal", owner: "Enemy", lastSeen: 900, towers: 1 },
          },
        },
      },
      kernel: {
        strategy: { posture: "war", since: 900, expansionAllowed: false, newRemoteOpsAllowed: false },
        warPlan: { targetRoom: "W6N4", sponsor: "W7N4", squadSize: 1, since: 900, towersSeen: 2, ...overrides },
      },
    };
    (globalThis as any).Game.creeps = {
      a1: { memory: { role: "attacker", home: "W7N4", remoteTarget: "W6N4" } },
    };
  }

  it("非 war 姿态 → 收摊：核验 failure → 黑名单 + 清计划 + 撤请求 + 回收 attacker", () => {
    warPlanFixture();
    setPosture("develop");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Memory.rooms.W7N4.spawnQueue).toHaveLength(0);
    expect((globalThis as any).Game.creeps.a1.memory.recycle).toBe(true);
    // 塔网未清零（towersSeen=2，intel towers=1）且敌主仍在 → failure → 黑名单。
    expect((globalThis as any).Memory.kernel.warBlacklist.W6N4).toBe(TICK + CONFIG.war.warBlacklistTicks);
    // 黑匣子事件：outcome=failure(1)。
    expect(warOutcomeEvents()[0]?.d?.[0]).toBe(1);
  });

  it("核验 success（塔网清零）→ 不黑名单", () => {
    warPlanFixture();
    (globalThis as any).Memory.rooms.W7N4.intel.W6N4.towers = 0;
    setPosture("develop");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warBlacklist).toBeUndefined();
    expect(warOutcomeEvents()[0]?.d?.[0]).toBe(0);
  });

  it("核验 success（敌人弃房）→ 不黑名单", () => {
    warPlanFixture({ towersSeen: 0 }); // 无塔目标：弃房即胜利
    (globalThis as any).Memory.rooms.W7N4.intel.W6N4.owner = undefined;
    setPosture("develop");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warBlacklist).toBeUndefined();
    expect(warOutcomeEvents()[0]?.d?.[0]).toBe(0);
  });

  it("核验 unknown（情报过期）→ 黑名单", () => {
    warPlanFixture();
    (globalThis as any).Memory.rooms.W7N4.intel.W6N4.lastSeen = -600; // 距今 1600 > freshness 1500
    setPosture("develop");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warBlacklist.W6N4).toBe(TICK + CONFIG.war.warBlacklistTicks);
    expect(warOutcomeEvents()[0]?.d?.[0]).toBe(2);
  });

  it("demobilize 幂等：重复调用仅动作一次", () => {
    warPlanFixture();
    (globalThis as any).Memory.rooms.W7N4.intel.W6N4.towers = 0; // success：免黑名单，聚焦幂等断言

    demobilize(TICK, 0);
    demobilize(TICK, 0);

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Game.creeps.a1.memory.recycle).toBe(true);
    // 第二次调用无计划可收 — 事件只记一次。
    expect(warOutcomeEvents()).toHaveLength(1);
  });
});

describe("R4 — 战损止损与波次相位", () => {
  it("spawned 超编队 × casualtyMultiplier → 收摊（attrition）+ 黑名单 + 整军休战", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    (globalThis as any).Memory.kernel.warPlan = {
      targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, since: 900,
      towersSeen: 0, phase: "advance", spawned: 8, // 8 > 3 × 2.5
    };

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Memory.kernel.warBlacklist.W6N4).toBe(TICK + CONFIG.war.warBlacklistTicks);
    // 整军休战：止损后不立即换目标重开。
    expect((globalThis as any).Memory.kernel.warStandDownUntil).toBe(TICK + CONFIG.war.standDownTicks);
    // 收摊原因 = attrition(1)。
    expect(warOutcomeEvents()[0]?.d?.[2]).toBe(1);
  });

  it("休战期内（warStandDownUntil 未到）→ 不创建新战争计划", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    (globalThis as any).Memory.kernel.warStandDownUntil = TICK + 500;

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Memory.rooms.W7N4.spawnQueue).toHaveLength(0);

    // 休战到期 → 恢复评估。
    (globalThis as any).Memory.kernel.warStandDownUntil = TICK - 1;
    warPlannerSystem.run(mockContext(mockSnapshot()));
    expect((globalThis as any).Memory.kernel.warPlan?.targetRoom).toBe("W6N4");
  });

  it("姿态退出 war → 清除休战闸（下次 re-war 不被旧休战期卡住）", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("develop");
    (globalThis as any).Memory.kernel.warStandDownUntil = TICK + 5000;

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warStandDownUntil).toBeUndefined();
  });

  it("advance 残编（live < squadSize × regroupRatio）→ 回落 build 重组", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    (globalThis as any).Memory.kernel.warPlan = {
      targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, since: 900,
      towersSeen: 0, phase: "advance", spawned: 3,
    };
    setLiveAttackers(1); // 1 < 3 × 0.5 → 回落 build

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan.phase).toBe("build");
  });

  it("build 未满编保持 build；满编才转 advance（迟滞不抖动）", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    (globalThis as any).Memory.kernel.warPlan = {
      targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, since: 900,
      towersSeen: 0, phase: "build", spawned: 3,
    };
    setLiveAttackers(2); // 2 ≥ 1.5 但 < 3 → 未满编仍 build

    warPlannerSystem.run(mockContext(mockSnapshot()));
    expect((globalThis as any).Memory.kernel.warPlan.phase).toBe("build");
  });

  it("黑名单目标不被重选（选次优）", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome({
      W5N5: { kind: "normal", owner: "Enemy", lastSeen: 900, towers: 0, pathCost: 600 },
    });
    setPosture("war");
    (globalThis as any).Memory.kernel.warBlacklist = { W6N4: TICK + CONFIG.war.warBlacklistTicks };

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan.targetRoom).toBe("W5N5");
  });

  it("计划存续期间目标进黑名单 → 立即收摊（防绕过滤选回）", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    (globalThis as any).Memory.kernel.warPlan = {
      targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, since: 900,
      towersSeen: 0, phase: "advance", spawned: 3,
    };
    (globalThis as any).Memory.kernel.warBlacklist = { W6N4: TICK + CONFIG.war.warBlacklistTicks };

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
  });
});
