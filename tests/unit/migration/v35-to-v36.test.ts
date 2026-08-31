/** v35 → v36 迁移独立测试（v36 PB 野采链：powerFarm 任务建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v35 → v36（PB 野采任务建档）", () => {
  it("空 Memory 不报错，版本升到当前", () => {
    (globalThis as any).Memory = { schemaVersion: 35, creeps: {}, rooms: {}, kernel: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法任务条目保留（strike/collect 两相位）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 35,
      creeps: {},
      rooms: {},
      kernel: {
        powerFarm: {
          targetRoom: "W2N1",
          sponsor: "W7N4",
          since: 1000,
          spawned: 3,
          phase: "strike",
        },
      },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.powerFarm).toEqual({
      targetRoom: "W2N1",
      sponsor: "W7N4",
      since: 1000,
      spawned: 3,
      phase: "strike",
    });
  });

  it("powerFarm 非对象（数组/字符串）→ 删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 35,
      creeps: {},
      rooms: {},
      kernel: { powerFarm: ["bad"] },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.powerFarm).toBeUndefined();

    (globalThis as any).Memory = {
      schemaVersion: 35,
      creeps: {},
      rooms: {},
      kernel: { powerFarm: "bad" },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.powerFarm).toBeUndefined();
  });

  it("phase 非法 → 删除（安全侧：缺失视为无任务）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 35,
      creeps: {},
      rooms: {},
      kernel: {
        powerFarm: { targetRoom: "W2N1", sponsor: "W7N4", since: 1, spawned: 0, phase: "weird" },
      },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.powerFarm).toBeUndefined();
  });

  it("无 kernel 的旧 Memory → 正常通过", () => {
    (globalThis as any).Memory = { schemaVersion: 35, creeps: {}, rooms: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });
});
