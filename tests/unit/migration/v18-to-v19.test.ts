/** v18 → v19 迁移独立测试（P1-J：demand 迟滞状态入迁移体系）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v18 → v19（demand 迟滞状态建档）", () => {
  it("合法 distScaleUpSince 与 builderPressureState 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 18,
      creeps: {},
      rooms: {
        W1N1: {
          distScaleUpSince: 1000,
          builderPressureState: "shrinking",
        },
        W2N1: {
          builderPressureState: "full",
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect((globalThis as any).Memory.rooms.W1N1.distScaleUpSince).toBe(1000);
    expect((globalThis as any).Memory.rooms.W1N1.builderPressureState).toBe("shrinking");
    expect((globalThis as any).Memory.rooms.W2N1.builderPressureState).toBe("full");
  });

  it("非数字 distScaleUpSince 自愈删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 18,
      creeps: {},
      rooms: {
        W1N1: {
          distScaleUpSince: "bad",
          builderPressureState: "full",
        },
      },
    };

    runMigrations();

    const room = (globalThis as any).Memory.rooms.W1N1;
    expect(room.distScaleUpSince).toBeUndefined();
    // builderPressureState 不受影响。
    expect(room.builderPressureState).toBe("full");
  });

  it("非法 builderPressureState（非 full/shrinking）自愈删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 18,
      creeps: {},
      rooms: {
        W1N1: {
          distScaleUpSince: 1000,
          builderPressureState: "unknown",
        },
        W2N1: {
          builderPressureState: 123,
        },
      },
    };

    runMigrations();

    const r1 = (globalThis as any).Memory.rooms.W1N1;
    expect(r1.distScaleUpSince).toBe(1000); // 不受影响
    expect(r1.builderPressureState).toBeUndefined();

    const r2 = (globalThis as any).Memory.rooms.W2N1;
    expect(r2.builderPressureState).toBeUndefined();
  });

  it("字段缺失时跳过（惰性，不创建）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 18,
      creeps: {},
      rooms: {
        W1N1: {}, // 无字段
      },
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect((globalThis as any).Memory.rooms.W1N1).toEqual({});
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 18,
      creeps: {},
      rooms: {
        W1N1: {
          distScaleUpSince: 1000,
          builderPressureState: "shrinking",
        },
        W2N1: {
          distScaleUpSince: "bad",
        },
      },
    };

    runMigrations();
    runMigrations();
    runMigrations();

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    const r1 = (globalThis as any).Memory.rooms.W1N1;
    expect(r1.distScaleUpSince).toBe(1000);
    expect(r1.builderPressureState).toBe("shrinking");
    const r2 = (globalThis as any).Memory.rooms.W2N1;
    expect(r2.distScaleUpSince).toBeUndefined();
  });

  it("已是 v19 的新 Memory → v18→v19 迁移跳过（后续 v19→v20 仍会执行）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: { W1N1: {} },
    };

    runMigrations();

    // v18→v19 步骤跳过（已是 v19）；但 v19→v20 步骤仍会执行，
    // 最终版本升到 CONFIG.memory.schemaVersion（当前为 20）。
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    // rooms.W1N1 内容不受 tuning 迁移影响（v20 只触及 kernel.tuning.rooms）。
    expect((globalThis as any).Memory.rooms.W1N1).toEqual({});
  });
});
