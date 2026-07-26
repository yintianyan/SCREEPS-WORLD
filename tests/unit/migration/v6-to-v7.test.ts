/**
 * v6 → v7 迁移独立测试（参数自调优 Memory 结构自愈）。
 *
 * 迁移链路 v6→v7→v8→v9→v10，最终 schemaVersion === 10。
 *
 * 覆盖：
 *   - v6 Memory 升级，kernel.tuning 结构正确初始化
 *   - 畸形 tuning 数据被自愈修正
 *   - tuning 为非对象类型时被清除
 *   - 旧格式 lastEval（单对象含 room 字段）迁移为 Record 格式
 *   - 幂等：重复执行不产生副作用
 *   - 无 kernel 字段时正常初始化
 */
import { beforeEach, describe, expect, it } from "vitest";
import { maintainMemory } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

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
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
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

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
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

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
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

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
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

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
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

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
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
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    // maintainMemory 会惰性初始化失守房记录（lostRooms）— kernel 不再是纯空对象。
    expect((globalThis as any).Memory.kernel).toEqual({ lostRooms: {} });
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

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastTuned).toBe(2000);
    expect(tuning.rooms.W7N4.roleBounds.hauler.minCount).toBe(2);
    expect(tuning.rooms.W7N4.roleBounds.hauler.maxCount).toBe(5);
  });

  it("旧格式 lastEval（单对象含 room 字段）迁移为 Record 格式", () => {
    (globalThis as any).Memory = {
      schemaVersion: 6,
      creeps: {},
      kernel: {
        tuning: {
          lastTuned: 500,
          rooms: {},
          lastEval: {
            tick: 500,
            room: "W1N1",
            adjustments: ["hauler.maxCount=6→7"],
            signals: { avgPressure: 0.1 },
            skipped: undefined,
          },
        },
      },
      rooms: {},
    };
    maintainMemory();

    const tuning = (globalThis as any).Memory.kernel.tuning;
    // lastEval 应从单对象格式迁移为 Record 格式
    expect(tuning.lastEval).toBeDefined();
    expect(tuning.lastEval.W1N1).toBeDefined();
    expect(tuning.lastEval.W1N1.tick).toBe(500);
    expect(tuning.lastEval.W1N1.adjustments).toEqual(["hauler.maxCount=6→7"]);
    expect(tuning.lastEval.W1N1.signals.avgPressure).toBe(0.1);
    // 旧 room 字段不应存在于迁移后的结构中
    expect(tuning.lastEval.W1N1.room).toBeUndefined();
  });

  it("已是 Record 格式的 lastEval 不受迁移影响", () => {
    (globalThis as any).Memory = {
      schemaVersion: 6,
      creeps: {},
      kernel: {
        tuning: {
          lastTuned: 1000,
          rooms: {},
          lastEval: {
            W1N1: { tick: 500, adjustments: [], signals: {}, skipped: "economy_unstable" },
            W2N2: { tick: 600, adjustments: ["hauler.maxCount=6→7"], signals: {} },
          },
        },
      },
      rooms: {},
    };
    maintainMemory();

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(Object.keys(tuning.lastEval)).toHaveLength(2);
    expect(tuning.lastEval.W1N1.skipped).toBe("economy_unstable");
    expect(tuning.lastEval.W2N2.adjustments).toEqual(["hauler.maxCount=6→7"]);
  });
});
