/** v30 → v31 迁移独立测试（R7b 扩张节奏自适应 / expansionRhythm + expansionPausedUntil 建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v30 → v31（expansionRhythm 建档）", () => {
  it("空 Memory 不报错，版本升到当前", () => {
    (globalThis as any).Memory = { schemaVersion: 30, creeps: {}, rooms: {}, kernel: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法 expansionRhythm + pausedUntil 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: {},
      kernel: {
        expansionRhythm: { ring: [0, 1, 2], blacklistMultiplier: 0.5, minSources: 2 },
        expansionPausedUntil: 21000,
      },
    };
    runMigrations();
    const kernel = (globalThis as any).Memory.kernel;
    expect(kernel.expansionRhythm.ring).toEqual([0, 1, 2]);
    expect(kernel.expansionRhythm.blacklistMultiplier).toBe(0.5);
    expect(kernel.expansionPausedUntil).toBe(21000);
  });

  it("ring 条目非 0-4 → 过滤；ring 非数组 → 空数组", () => {
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: {},
      kernel: { expansionRhythm: { ring: [0, 9, -1, 2], blacklistMultiplier: 1, minSources: 1 } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.expansionRhythm.ring).toEqual([0, 2]);

    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: {},
      kernel: { expansionRhythm: { ring: "bad", blacklistMultiplier: 1, minSources: 1 } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.expansionRhythm.ring).toEqual([]);
  });

  it("blacklistMultiplier/minSources 越界 → 回默认", () => {
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: {},
      kernel: { expansionRhythm: { ring: [], blacklistMultiplier: 9, minSources: 7 } },
    };
    runMigrations();
    const rhythm = (globalThis as any).Memory.kernel.expansionRhythm;
    expect(rhythm.blacklistMultiplier).toBe(1);
    expect(rhythm.minSources).toBe(1);
  });

  it("pausedUntil 非数字 → 删除；幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 30,
      creeps: {},
      rooms: {},
      kernel: {
        expansionRhythm: { ring: [1], blacklistMultiplier: 1.5, minSources: 1 },
        expansionPausedUntil: "soon",
      },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.expansionPausedUntil).toBeUndefined();

    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});
