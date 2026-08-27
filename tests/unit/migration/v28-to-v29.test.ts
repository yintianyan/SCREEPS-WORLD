/** v28 → v29 迁移独立测试（R6b 主动情报 / prospect + prospectCooldown 建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v28 → v29（prospect 建档）", () => {
  it("空 Memory 不报错，版本升到当前", () => {
    (globalThis as any).Memory = { schemaVersion: 28, creeps: {}, rooms: {}, kernel: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法 prospect + prospectCooldown 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 28,
      creeps: {},
      rooms: {},
      kernel: {
        prospect: { target: "W6N4", sponsor: "W7N4", startedAt: 900, spawned: 1 },
        prospectCooldown: { W5N5: 21000 },
      },
    };
    runMigrations();
    const kernel = (globalThis as any).Memory.kernel;
    expect(kernel.prospect.target).toBe("W6N4");
    expect(kernel.prospectCooldown.W5N5).toBe(21000);
  });

  it("prospect 缺字段/类型错误 → 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 28,
      creeps: {},
      rooms: {},
      kernel: { prospect: { target: "W6N4", sponsor: "W7N4", startedAt: 900 } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();

    (globalThis as any).Memory = {
      schemaVersion: 28,
      creeps: {},
      rooms: {},
      kernel: { prospect: "scouting" },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.prospect).toBeUndefined();
  });

  it("prospectCooldown 非对象 → 删除字段；条目非数字 → 删除条目；空对象回收", () => {
    (globalThis as any).Memory = {
      schemaVersion: 28,
      creeps: {},
      rooms: {},
      kernel: { prospectCooldown: "soon" },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.prospectCooldown).toBeUndefined();

    (globalThis as any).Memory = {
      schemaVersion: 28,
      creeps: {},
      rooms: {},
      kernel: { prospectCooldown: { W5N5: "soon", W6N4: 21000 } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.prospectCooldown).toEqual({ W6N4: 21000 });

    (globalThis as any).Memory = {
      schemaVersion: 28,
      creeps: {},
      rooms: {},
      kernel: { prospectCooldown: { W5N5: "soon" } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.prospectCooldown).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 28,
      creeps: {},
      rooms: {},
      kernel: {
        prospect: { target: "W6N4", sponsor: "W7N4", startedAt: 900, spawned: 2 },
        prospectCooldown: { W5N5: 21000 },
      },
    };
    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});
