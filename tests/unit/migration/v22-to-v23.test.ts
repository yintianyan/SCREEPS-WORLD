/** v22 → v23 迁移独立测试（P0-3 spawn churn 熔断字段建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v22 → v23（spawn churn 熔断字段建档）", () => {
  it("空 Memory（无 churnFreezeUntil）不报错，版本升到当前", () => {
    (globalThis as any).Memory = {
      schemaVersion: 22,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法 churnFreezeUntil（role → 数字）保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 22,
      creeps: {},
      rooms: {
        W7N3: { churnFreezeUntil: { hauler: 5000, builder: 9000 } },
      },
      kernel: {},
    };

    runMigrations();

    const freeze = (globalThis as any).Memory.rooms.W7N3.churnFreezeUntil;
    expect(freeze.hauler).toBe(5000);
    expect(freeze.builder).toBe(9000);
  });

  it("churnFreezeUntil 为字符串（非对象）→ 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 22,
      creeps: {},
      rooms: {
        W7N3: { churnFreezeUntil: "bad" },
      },
      kernel: {},
    };

    runMigrations();

    expect((globalThis as any).Memory.rooms.W7N3.churnFreezeUntil).toBeUndefined();
  });

  it("churnFreezeUntil 为数组（非对象）→ 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 22,
      creeps: {},
      rooms: {
        W7N3: { churnFreezeUntil: [100, 200] },
      },
      kernel: {},
    };

    runMigrations();

    expect((globalThis as any).Memory.rooms.W7N3.churnFreezeUntil).toBeUndefined();
  });

  it("churnFreezeUntil[role] 非数字 → 删除该条目，合法 role 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 22,
      creeps: {},
      rooms: {
        W7N3: {
          churnFreezeUntil: { hauler: 5000, builder: "soon" },
        },
      },
      kernel: {},
    };

    runMigrations();

    const freeze = (globalThis as any).Memory.rooms.W7N3.churnFreezeUntil;
    expect(freeze.hauler).toBe(5000);
    expect(freeze.builder).toBeUndefined();
  });

  it("空对象 → 回收整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 22,
      creeps: {},
      rooms: {
        W7N3: { churnFreezeUntil: {} },
      },
      kernel: {},
    };

    runMigrations();

    expect((globalThis as any).Memory.rooms.W7N3.churnFreezeUntil).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 22,
      creeps: {},
      rooms: {
        W7N3: { churnFreezeUntil: { hauler: 5000, builder: 9000 } },
      },
      kernel: {},
    };

    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});