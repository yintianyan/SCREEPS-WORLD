/** v26 → v27 迁移独立测试（R4 战争自治升级 / warPlan 扩展 + warBlacklist + warPressureTicks）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v26 → v27（R4 战争自治升级建档）", () => {
  it("空 Memory（无新字段）不报错，版本升到当前", () => {
    (globalThis as any).Memory = {
      schemaVersion: 26,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法 phase/spawned/warBlacklist/warPressureTicks 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 26,
      creeps: {},
      rooms: {},
      kernel: {
        warPlan: { targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, phase: "advance", spawned: 5 },
        warBlacklist: { W5N5: 21000 },
        strategy: { posture: "war", since: 900, warPressureTicks: 120 },
      },
    };

    runMigrations();

    const kernel = (globalThis as any).Memory.kernel;
    expect(kernel.warPlan.phase).toBe("advance");
    expect(kernel.warPlan.spawned).toBe(5);
    expect(kernel.warBlacklist.W5N5).toBe(21000);
    expect(kernel.strategy.warPressureTicks).toBe(120);
  });

  it("warPlan.phase 非法值 → 删除（缺失视为 build），核心字段保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 26,
      creeps: {},
      rooms: {},
      kernel: {
        warPlan: { targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, phase: "blitz" },
      },
    };

    runMigrations();

    const plan = (globalThis as any).Memory.kernel.warPlan;
    expect(plan.targetRoom).toBe("W6N4"); // 核心字段不受影响
    expect(plan.phase).toBeUndefined();
  });

  it("warPlan.spawned 非数字 → 删除（缺失视为 0）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 26,
      creeps: {},
      rooms: {},
      kernel: {
        warPlan: { targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, spawned: "five" },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.warPlan.spawned).toBeUndefined();
  });

  it("warBlacklist 非对象 → 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 26,
      creeps: {},
      rooms: {},
      kernel: { warBlacklist: ["W5N5"] },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.warBlacklist).toBeUndefined();
  });

  it("warBlacklist 条目非数字 → 删除该条目；空对象回收", () => {
    (globalThis as any).Memory = {
      schemaVersion: 26,
      creeps: {},
      rooms: {},
      kernel: {
        warBlacklist: { W5N5: "soon", W6N4: 21000 },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.warBlacklist).toEqual({ W6N4: 21000 });

    // 全部条目畸形 → 整个字段回收。
    (globalThis as any).Memory = {
      schemaVersion: 26,
      creeps: {},
      rooms: {},
      kernel: { warBlacklist: { W5N5: "soon" } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.warBlacklist).toBeUndefined();
  });

  it("strategy.warPressureTicks 非数字 → 删除（缺失视为 0）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 26,
      creeps: {},
      rooms: {},
      kernel: {
        strategy: { posture: "war", since: 900, warPressureTicks: "lots" },
      },
    };

    runMigrations();

    const strategy = (globalThis as any).Memory.kernel.strategy;
    expect(strategy.posture).toBe("war"); // 其余字段保留
    expect(strategy.warPressureTicks).toBeUndefined();
  });

  it("warStandDownUntil 非数字 → 删除（缺失视为无休战）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 26,
      creeps: {},
      rooms: {},
      kernel: { warStandDownUntil: "soon" },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.warStandDownUntil).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 26,
      creeps: {},
      rooms: {},
      kernel: {
        warPlan: { targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, phase: "build", spawned: 2 },
        warBlacklist: { W5N5: 21000 },
        strategy: { posture: "war", since: 900, warPressureTicks: 42 },
      },
    };

    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});
