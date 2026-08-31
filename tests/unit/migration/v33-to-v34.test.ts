/** v33 → v34 迁移独立测试（v34 Power Creeps：homeAssignments 建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v33 → v34（PC 驻留建档）", () => {
  it("空 Memory 不报错，版本升到当前", () => {
    (globalThis as any).Memory = { schemaVersion: 33, creeps: {}, rooms: {}, kernel: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法驻留条目保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 33,
      creeps: {},
      rooms: {},
      kernel: { powerCreeps: { homeAssignments: { "pc-op-0": "W7N4" } } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.powerCreeps.homeAssignments).toEqual({
      "pc-op-0": "W7N4",
    });
  });

  it("powerCreeps 非对象（数组/字符串）→ 删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 33,
      creeps: {},
      rooms: {},
      kernel: { powerCreeps: ["bad"] },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.powerCreeps).toBeUndefined();
  });

  it("homeAssignments 缺失/非对象 → 重置为空对象", () => {
    (globalThis as any).Memory = {
      schemaVersion: 33,
      creeps: {},
      rooms: {},
      kernel: { powerCreeps: {} },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.powerCreeps.homeAssignments).toEqual({});

    (globalThis as any).Memory = {
      schemaVersion: 33,
      creeps: {},
      rooms: {},
      kernel: { powerCreeps: { homeAssignments: "bad" } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.powerCreeps.homeAssignments).toEqual({});
  });

  it("条目值非字符串 → 删除该条目（合法条目不受连坐）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 33,
      creeps: {},
      rooms: {},
      kernel: { powerCreeps: { homeAssignments: { "pc-op-0": "W7N4", "pc-bad": 42 } } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.powerCreeps.homeAssignments).toEqual({
      "pc-op-0": "W7N4",
    });
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 33,
      creeps: {},
      rooms: {},
      kernel: { powerCreeps: { homeAssignments: { "pc-op-0": "W7N4" } } },
    };
    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});
