/** v29 → v30 迁移独立测试（R7a 容量感知 / capacity + agenda.progressBase 建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v29 → v30（capacity 建档）", () => {
  it("空 Memory 不报错，版本升到当前", () => {
    (globalThis as any).Memory = { schemaVersion: 29, creeps: {}, rooms: {}, kernel: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法 capacity + progressBase 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 29,
      creeps: {},
      rooms: {},
      kernel: {
        capacity: { tier: "abundant", since: 900, upgradeTicks: 12 },
        agenda: { initiative: "rcl-push", since: 900, progressBase: 5000 },
      },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.capacity.tier).toBe("abundant");
    expect((globalThis as any).Memory.kernel.agenda.progressBase).toBe(5000);
  });

  it("capacity tier 不在枚举 / 字段类型错误 → 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 29,
      creeps: {},
      rooms: {},
      kernel: { capacity: { tier: "godlike", since: 900, upgradeTicks: 0 } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.capacity).toBeUndefined();

    (globalThis as any).Memory = {
      schemaVersion: 29,
      creeps: {},
      rooms: {},
      kernel: { capacity: { tier: "tight", since: "soon", upgradeTicks: 0 } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.capacity).toBeUndefined();
  });

  it("progressBase 非数字 → 删除（缺失视为无基线）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 29,
      creeps: {},
      rooms: {},
      kernel: { agenda: { initiative: "rcl-push", since: 900, progressBase: "lots" } },
    };
    runMigrations();
    const agenda = (globalThis as any).Memory.kernel.agenda;
    expect(agenda.initiative).toBe("rcl-push"); // 其余字段保留
    expect(agenda.progressBase).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 29,
      creeps: {},
      rooms: {},
      kernel: {
        capacity: { tier: "tight", since: 950, upgradeTicks: 3 },
        agenda: { initiative: "develop", since: 950, progressBase: 100 },
      },
    };
    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});
