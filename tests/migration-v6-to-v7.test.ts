/**
 * v6 → v7 迁移独立测试（参数自调优 Memory 结构自愈）。
 *
 * 覆盖：
 *   - v6 Memory 升级到 v7，kernel.tuning 结构正确初始化
 *   - 畸形 tuning 数据被自愈修正
 *   - tuning 为非对象类型时被清除
 *   - 幂等：重复执行不产生副作用
 *   - 无 kernel 字段时正常初始化
 */
import { beforeEach, describe, expect, it } from "vitest";
import { maintainMemory } from "../src/kernel/memory";
import { resetGlobals } from "./role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v6 → v7（tuning 结构自愈）", () => {
  it("v6 Memory 升级到 v7，kernel.tuning 不存在时不报错", () => {
    (globalThis as any).Memory = {
      schemaVersion: 6,
      creeps: {},
      kernel: {},
      rooms: {},
    };
    expect(() => maintainMemory()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(7);
    // tuning 字段可选——tuning-engine 首次运行时自动初始化，迁移不强建。
    expect((globalThis as any).Memory.kernel.tuning).toBeUndefined();
  });

  it("畸形 tuning.lastTuned 被修正为 0", () => {
    (globalThis as any).Memory = {
      schemaVersion: 6,
      creeps: {},
      kernel: {
        tuning: {
          lastTuned: "invalid",
          rooms: {},
        },
      },
      rooms: {},
    };
    maintainMemory();

    expect((globalThis as any).Memory.schemaVersion).toBe(7);
    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastTuned).toBe(0);
    expect(tuning.rooms).toEqual({});
  });

  it("畸形 tuning.rooms 被修正为空对象", () => {
    (globalThis as any).Memory = {
      schemaVersion: 6,
      creeps: {},
      kernel: {
        tuning: {
          lastTuned: 500,
          rooms: "invalid",
        },
      },
      rooms: {},
    };
    maintainMemory();

    expect((globalThis as any).Memory.schemaVersion).toBe(7);
    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastTuned).toBe(500);
    expect(tuning.rooms).toEqual({});
  });

  it("tuning 为非对象类型时被清除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 6,
      creeps: {},
      kernel: {
        tuning: "garbage",
      },
      rooms: {},
    };
    maintainMemory();

    expect((globalThis as any).Memory.schemaVersion).toBe(7);
    expect((globalThis as any).Memory.kernel.tuning).toBeUndefined();
  });

  it("tuning 为 null 时被清除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 6,
      creeps: {},
      kernel: {
        tuning: null,
      },
      rooms: {},
    };
    maintainMemory();

    expect((globalThis as any).Memory.schemaVersion).toBe(7);
    expect((globalThis as any).Memory.kernel.tuning).toBeUndefined();
  });

  it("幂等：重复执行不修改已正确的 tuning 结构", () => {
    (globalThis as any).Memory = {
      schemaVersion: 6,
      creeps: {},
      kernel: {
        tuning: {
          lastTuned: 1000,
          rooms: {
            W7N4: {
              roleBounds: { hauler: { maxCount: 5 } },
              lastAdjusted: { "hauler.maxCount": 500 },
            },
          },
        },
      },
      rooms: {},
    };
    maintainMemory();
    maintainMemory();
    maintainMemory();

    expect((globalThis as any).Memory.schemaVersion).toBe(7);
    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastTuned).toBe(1000);
    expect(tuning.rooms.W7N4.roleBounds.hauler.maxCount).toBe(5);
    expect(tuning.rooms.W7N4.lastAdjusted["hauler.maxCount"]).toBe(500);
  });

  it("无 kernel 字段时正常初始化", () => {
    (globalThis as any).Memory = {
      schemaVersion: 6,
      creeps: {},
      rooms: {},
    };
    expect(() => maintainMemory()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(7);
    expect((globalThis as any).Memory.kernel).toEqual({});
  });

  it("完整的 tuning 结构不受影响", () => {
    (globalThis as any).Memory = {
      schemaVersion: 6,
      creeps: {},
      kernel: {
        tuning: {
          lastTuned: 2000,
          rooms: {
            W7N4: {
              roleBounds: { hauler: { minCount: 2, maxCount: 5 } },
              lastAdjusted: {},
            },
          },
        },
      },
      rooms: {},
    };
    maintainMemory();

    expect((globalThis as any).Memory.schemaVersion).toBe(7);
    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastTuned).toBe(2000);
    expect(tuning.rooms.W7N4.roleBounds.hauler.minCount).toBe(2);
    expect(tuning.rooms.W7N4.roleBounds.hauler.maxCount).toBe(5);
  });
});
