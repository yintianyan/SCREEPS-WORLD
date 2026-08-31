/** v23 → v24 迁移独立测试（P0-1 srcRatio 修正 / storageDrainAccum 字段建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v23 → v24（storageDrainAccum 字段建档）", () => {
  it("空 Memory（无 phase）不报错，版本升到当前", () => {
    (globalThis as any).Memory = {
      schemaVersion: 23,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法 storageDrainAccum 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 23,
      creeps: {},
      rooms: {
        W7N3: { phase: { storageDrainAccum: 2500 } },
      },
      kernel: {},
    };

    runMigrations();

    expect((globalThis as any).Memory.rooms.W7N3.phase.storageDrainAccum).toBe(2500);
  });

  it("storageDrainAccum 非数字 → 删除，合法 srcStallTicks 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 23,
      creeps: {},
      rooms: {
        W7N3: { phase: { srcStallTicks: 45, storageDrainAccum: "negative" } },
      },
      kernel: {},
    };

    runMigrations();

    const phase = (globalThis as any).Memory.rooms.W7N3.phase;
    expect(phase.srcStallTicks).toBe(45);
    expect(phase.storageDrainAccum).toBeUndefined();
  });

  it("phase 非对象 → 跳过该房", () => {
    (globalThis as any).Memory = {
      schemaVersion: 23,
      creeps: {},
      rooms: {
        W7N3: { phase: 42 },
      },
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.rooms.W7N3.phase).toBe(42);
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 23,
      creeps: {},
      rooms: {
        W7N3: { phase: { storageDrainAccum: 900 } },
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