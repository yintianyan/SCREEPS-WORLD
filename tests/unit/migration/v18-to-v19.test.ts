/**
 * v18 → v19 迁移独立测试（P1-J：demand 迟滞状态入迁移体系）。
 *
 * 迁移语义：distScaleUpSince 与 builderPressureState 字段原本由
 * domain/spawn/demand.ts 直读写 Memory，现收敛为 spawn-manager 适配层
 * 显式输入输出（prevHysteresis / nextHysteresis）。
 *
 * 字段类型早已登记在 RoomMemory（global.d.ts:215/221），本迁移只纳入
 * schema 管理（幂等畸形自愈），不改变值。
 *
 * 覆盖：
 *   - 旧格式 distScaleUpSince（数字）→ 保留
 *   - 旧格式 builderPressureState（'full'/'shrinking'）→ 保留
 *   - 非数字 distScaleUpSince 自愈删除
 *   - 非法 builderPressureState 自愈删除
 *   - 幂等：重复执行不产生副作用
 *   - 字段缺失时跳过（惰性）
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

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

  it("已是 v19 的新 Memory → 跳过迁移", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: { W1N1: {} },
    };

    runMigrations();

    expect((globalThis as any).Memory.schemaVersion).toBe(19);
    expect((globalThis as any).Memory.rooms.W1N1).toEqual({});
  });
});
