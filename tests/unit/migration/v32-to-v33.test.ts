/** v32 → v33 迁移独立测试（v33 完整情报：enemySpawns / wallCount / sealedExits 建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v32 → v33（完整情报字段建档）", () => {
  it("空 Memory 不报错，版本升到当前", () => {
    (globalThis as any).Memory = { schemaVersion: 32, creeps: {}, rooms: {}, kernel: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法字段保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 32,
      creeps: {},
      rooms: { W7N4: { intel: { W6N4: { enemySpawns: 1, wallCount: 8, sealedExits: [7] } } } },
      kernel: {},
    };
    runMigrations();
    const info = (globalThis as any).Memory.rooms.W7N4.intel.W6N4;
    expect(info.enemySpawns).toBe(1);
    expect(info.wallCount).toBe(8);
    expect(info.sealedExits).toEqual([7]);
  });

  it("数字字段非数字 → 删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 32,
      creeps: {},
      rooms: { W7N4: { intel: { W6N4: { enemySpawns: "1", wallCount: "many" } } } },
      kernel: {},
    };
    runMigrations();
    const info = (globalThis as any).Memory.rooms.W7N4.intel.W6N4;
    expect(info.enemySpawns).toBeUndefined();
    expect(info.wallCount).toBeUndefined();
  });

  it("sealedExits 非数组或含非数字 → 删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 32,
      creeps: {},
      rooms: {
        W7N4: { intel: { W6N4: { sealedExits: "7" }, W5N4: { sealedExits: [7, "3"] } } },
      },
      kernel: {},
    };
    runMigrations();
    const info = (globalThis as any).Memory.rooms.W7N4.intel;
    expect(info.W6N4.sealedExits).toBeUndefined();
    expect(info.W5N4.sealedExits).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 32,
      creeps: {},
      rooms: { W7N4: { intel: { W6N4: { enemySpawns: 2, wallCount: 5, sealedExits: [1, 3] } } } },
      kernel: {},
    };
    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});
