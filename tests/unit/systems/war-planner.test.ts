/**
 * War Planner 系统测试（R3 战时闭环 — 姿态消费 + 编队孵化 + 收摊）。
 *
 * 覆盖：
 *   - war 姿态 + 合法目标 → 发布 warPlan + 向 sponsor 队列推 attacker 孵化请求
 *   - 编队缺口逐步补齐（第 1 次 1 个，第 2 次补到 squadSize）
 *   - 非 war 姿态 → 清空计划 + 撤销请求 + 标记在役 attacker 回收（demobilize）
 *   - 无合格目标 → 不发布 warPlan
 */
import { beforeEach, describe, expect, it } from "vitest";
import { demobilize, warPlannerSystem } from "../../../src/systems/war-planner";
import { mockContext, mockSnapshot, resetGlobals } from "../../role-helpers";

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

/** 建立 home 房：我方控制器 + 两块邻居情报（W6N4 合格 / W6N5 SK 不合格）。 */
function setupHome(): void {
  (globalThis as any).Game.rooms = {
    W7N4: { controller: { my: true, owner: { username: "Me" } } },
  };
  (globalThis as any).Memory.rooms.W7N4 = {
    spawnQueue: [],
    intel: {
      W6N4: { kind: "normal", owner: "Enemy", lastSeen: 900, towers: 0 },
      W6N5: { kind: "sk", owner: "Enemy", lastSeen: 900, towers: 0 },
    },
  };
}

describe("war-planner 系统", () => {
  it("war 姿态 + 合法目标 → 发布 warPlan 并推 1 个 attacker 请求", () => {
    (globalThis as any).Memory = { schemaVersion: 26, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    const plan = (globalThis as any).Memory.kernel.warPlan;
    expect(plan.targetRoom).toBe("W6N4");
    expect(plan.sponsor).toBe("W7N4");
    expect(plan.squadSize).toBe(3); // 无 tower 基数 3

    const queue = (globalThis as any).Memory.rooms.W7N4.spawnQueue;
    expect(queue.length).toBe(1);
    expect(queue[0].role).toBe("attacker");
    expect(queue[0].memory.remoteTarget).toBe("W6N4");
  });

  it("编队缺口逐步补齐到 squadSize（第 2 次运行 +1，key 稳定不重复）", () => {
    (globalThis as any).Memory = { schemaVersion: 26, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");

    const ctx = mockContext(mockSnapshot());
    warPlannerSystem.run(ctx);
    const queue = (globalThis as any).Memory.rooms.W7N4.spawnQueue;
    expect(queue.length).toBe(1);

    // 第 2 次运行：live=0（无在役 creep）+ pending=1 → 再补 1 个。
    warPlannerSystem.run(ctx);
    expect(queue.length).toBe(2);
    expect(queue[1].key).not.toBe(queue[0].key);

    // 第 3 次运行应补到 squadSize=3。
    warPlannerSystem.run(ctx);
    expect(queue.length).toBe(3);
  });

  it("非 war 姿态 → 收摊：清空 warPlan + 撤销请求 + 标记在役 attacker 回收", () => {
    (globalThis as any).Memory = {
      schemaVersion: 26,
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
        },
      },
      kernel: {
        strategy: { posture: "war", since: 900, expansionAllowed: false, newRemoteOpsAllowed: false },
        warPlan: { targetRoom: "W6N4", sponsor: "W7N4", squadSize: 1, since: 900, towersSeen: 0 },
      },
    };
    (globalThis as any).Game.creeps = {
      a1: { memory: { role: "attacker", home: "W7N4" } },
    };

    // 姿态切走（非 war）→ 收摊。
    setPosture("develop");
    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Memory.rooms.W7N4.spawnQueue).toHaveLength(0);
    expect((globalThis as any).Game.creeps.a1.memory.recycle).toBe(true);
  });

  it("可直接调用 demobilize 收摊（幂等：重复调用仅动作一次）", () => {
    (globalThis as any).Memory.kernel.warPlan = { targetRoom: "W6N4", sponsor: "W7N4", squadSize: 1, since: 900, towersSeen: 0 };
    (globalThis as any).Memory.rooms.W7N4 = { spawnQueue: [] };
    (globalThis as any).Game.creeps = { a1: { memory: { role: "attacker", home: "W7N4" } } };

    demobilize();
    demobilize();

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Game.creeps.a1.memory.recycle).toBe(true);
  });

  it("无合格目标 → 不发布 warPlan", () => {
    (globalThis as any).Memory = { schemaVersion: 26, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    // 使唯一合格目标失效：owner 清空（无主房不是战争目标）。
    (globalThis as any).Memory.rooms.W7N4.intel.W6N4.owner = undefined;

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Memory.rooms.W7N4.spawnQueue).toHaveLength(0);
  });
});