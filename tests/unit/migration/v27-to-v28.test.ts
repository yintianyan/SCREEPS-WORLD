/** v27 → v28 迁移独立测试（R6a 帝国议程 / KernelMemory.agenda 建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v27 → v28（agenda 建档）", () => {
  it("空 Memory（无 agenda）不报错，版本升到当前", () => {
    (globalThis as any).Memory = {
      schemaVersion: 27,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法 agenda 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 27,
      creeps: {},
      rooms: {},
      kernel: { agenda: { initiative: "rcl-push", since: 900 } },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.agenda).toEqual({ initiative: "rcl-push", since: 900 });
  });

  it("initiative 不在枚举 → 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 27,
      creeps: {},
      rooms: {},
      kernel: { agenda: { initiative: "blitz", since: 900 } },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.agenda).toBeUndefined();
  });

  it("since 非数字 → 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 27,
      creeps: {},
      rooms: {},
      kernel: { agenda: { initiative: "develop", since: "soon" } },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.agenda).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 27,
      creeps: {},
      rooms: {},
      kernel: { agenda: { initiative: "defense-readiness", since: 950 } },
    };

    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});
