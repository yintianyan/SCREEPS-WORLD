/** v25 → v26 迁移独立测试（R3 战时闭环 / KernelMemory.warPlan 建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v25 → v26（warPlan 建档）", () => {
  it("空 Memory（无 warPlan）不报错，版本升到当前", () => {
    (globalThis as any).Memory = {
      schemaVersion: 25,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法 warPlan 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 25,
      creeps: {},
      rooms: {},
      kernel: {
        warPlan: { targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, since: 900, towersSeen: 0 },
      },
    };

    runMigrations();

    const plan = (globalThis as any).Memory.kernel.warPlan;
    expect(plan.targetRoom).toBe("W6N4");
    expect(plan.sponsor).toBe("W7N4");
    expect(plan.squadSize).toBe(3);
  });

  it("warPlan 为非对象（字符串）→ 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 25,
      creeps: {},
      rooms: {},
      kernel: { warPlan: "bad" },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
  });

  it("warPlan 缺 targetRoom（非字符串）→ 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 25,
      creeps: {},
      rooms: {},
      kernel: {
        warPlan: { sponsor: "W7N4", squadSize: 3, since: 900 },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
  });

  it("warPlan 缺 sponsor（非字符串）→ 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 25,
      creeps: {},
      rooms: {},
      kernel: {
        warPlan: { targetRoom: "W6N4", squadSize: 3, since: 900 },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
  });

  it("warPlan squadSize 非数字 → 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 25,
      creeps: {},
      rooms: {},
      kernel: {
        warPlan: { targetRoom: "W6N4", sponsor: "W7N4", squadSize: "three", since: 900 },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 25,
      creeps: {},
      rooms: {},
      kernel: {
        warPlan: { targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, since: 900, towersSeen: 1 },
      },
    };

    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});