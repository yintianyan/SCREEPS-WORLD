/** v35 → v36+ 迁移测试（PB 野采链：powerFarm 任务建档 + v46 多任务迁移）。
 * v36 建立 powerFarm，v46 将 powerFarm 迁移为 powerFarmMissions 数组。
 * 从 v35 跑迁移会一路执行到当前版本（46），因此验证终态。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v35 → v46（PB 野采任务建档 + 多任务迁移）", () => {
  it("空 Memory 不报错，版本升到当前", () => {
    (globalThis as any).Memory = { schemaVersion: 35, creeps: {}, rooms: {}, kernel: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法任务条目迁移为 powerFarmMissions 数组", () => {
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
    // v46 迁移后：powerFarm → powerFarmMissions 数组
    const missions = (globalThis as any).Memory.kernel.powerFarmMissions;
    expect(missions).toBeDefined();
    expect(missions).toHaveLength(1);
    expect(missions[0]).toEqual({
      targetRoom: "W2N1",
      sponsor: "W7N4",
      since: 1000,
      spawned: 3,
      phase: "strike",
      collectorSpawnedAt: undefined,
    });
    expect((globalThis as any).Memory.kernel.powerFarm).toBeUndefined();
  });

  it("powerFarm 非对象（数组/字符串）→ 删除（无 powerFarmMissions）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 35,
      creeps: {},
      rooms: {},
      kernel: { powerFarm: ["bad"] },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.powerFarm).toBeUndefined();
    expect((globalThis as any).Memory.kernel.powerFarmMissions).toBeUndefined();

    (globalThis as any).Memory = {
      schemaVersion: 35,
      creeps: {},
      rooms: {},
      kernel: { powerFarm: "bad" },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.powerFarm).toBeUndefined();
    expect((globalThis as any).Memory.kernel.powerFarmMissions).toBeUndefined();
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
    expect((globalThis as any).Memory.kernel.powerFarmMissions).toBeUndefined();
  });

  it("无 kernel 的旧 Memory → 正常通过", () => {
    (globalThis as any).Memory = { schemaVersion: 35, creeps: {}, rooms: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });
});
