/**
 * v7 → v8 迁移独立测试（清除 CreepMemory.working 遗留字段）。
 *
 * 迁移链路 v7→v8，最终 schemaVersion === 8。
 *
 * 覆盖：
 *   - v7 Memory 升级到 v8，所有 creep 的 working 字段被删除
 *   - 无 working 字段的 creep 不受影响
 *   - 幂等：重复执行不产生副作用
 *   - 空 creeps 对象正常处理
 *   - mode 字段不受影响
 */
import { beforeEach, describe, expect, it } from "vitest";
import { maintainMemory } from "../../../src/kernel/memory";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v7 → v8（清除 working 遗留字段）", () => {
  it("v7 Memory 升级到 v8，working 字段被删除", () => {
    const creepNames = ["harvester-W1N1-0-1000-abc", "hauler-W1N1-1-1001-def", "upgrader-W1N1-2-1002-ghi"];
    // 同步 Game.creeps，避免 maintainMemory 的死亡清理删除测试 creep。
    for (const n of creepNames) (globalThis as any).Game.creeps[n] = { name: n };
    (globalThis as any).Memory = {
      schemaVersion: 7,
      creeps: {
        "harvester-W1N1-0-1000-abc": { role: "harvester", home: "W1N1", mode: "work", working: true },
        "hauler-W1N1-1-1001-def": { role: "hauler", home: "W1N1", mode: "acquire", working: false },
        "upgrader-W1N1-2-1002-ghi": { role: "upgrader", home: "W1N1", mode: "work", working: true },
      },
      kernel: { tuning: { lastTuned: 500, rooms: {} } },
      rooms: {},
    };
    maintainMemory();

    expect((globalThis as any).Memory.schemaVersion).toBe(8);
    const creeps = (globalThis as any).Memory.creeps;
    expect(creeps["harvester-W1N1-0-1000-abc"].working).toBeUndefined();
    expect(creeps["hauler-W1N1-1-1001-def"].working).toBeUndefined();
    expect(creeps["upgrader-W1N1-2-1002-ghi"].working).toBeUndefined();
    // mode 字段保持不变
    expect(creeps["harvester-W1N1-0-1000-abc"].mode).toBe("work");
    expect(creeps["hauler-W1N1-1-1001-def"].mode).toBe("acquire");
  });

  it("无 working 字段的 creep 不受影响", () => {
    (globalThis as any).Game.creeps["harvester-W1N1-0-1000-abc"] = { name: "harvester-W1N1-0-1000-abc" };
    (globalThis as any).Memory = {
      schemaVersion: 7,
      creeps: {
        "harvester-W1N1-0-1000-abc": { role: "harvester", home: "W1N1", mode: "work" },
      },
      kernel: {},
      rooms: {},
    };
    maintainMemory();

    expect((globalThis as any).Memory.schemaVersion).toBe(8);
    const creep = (globalThis as any).Memory.creeps["harvester-W1N1-0-1000-abc"];
    expect(creep.role).toBe("harvester");
    expect(creep.mode).toBe("work");
    expect(creep.working).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Game.creeps["creep1"] = { name: "creep1" };
    (globalThis as any).Memory = {
      schemaVersion: 7,
      creeps: {
        "creep1": { role: "harvester", mode: "work", working: true },
      },
      kernel: {},
      rooms: {},
    };
    maintainMemory();
    maintainMemory();
    maintainMemory();

    expect((globalThis as any).Memory.schemaVersion).toBe(8);
    expect((globalThis as any).Memory.creeps.creep1.working).toBeUndefined();
    expect((globalThis as any).Memory.creeps.creep1.mode).toBe("work");
  });

  it("空 creeps 对象正常处理", () => {
    (globalThis as any).Memory = {
      schemaVersion: 7,
      creeps: {},
      kernel: {},
      rooms: {},
    };
    expect(() => maintainMemory()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(8);
  });

  it("tuning 结构在 v8 中保持不变", () => {
    (globalThis as any).Memory = {
      schemaVersion: 7,
      creeps: {},
      kernel: {
        tuning: {
          lastTuned: 1000,
          rooms: {
            W1N1: {
              roleBounds: { hauler: { maxCount: 7 } },
              lastAdjusted: { "hauler.maxCount": 500 },
            },
          },
        },
      },
      rooms: {},
    };
    maintainMemory();

    expect((globalThis as any).Memory.schemaVersion).toBe(8);
    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.lastTuned).toBe(1000);
    expect(tuning.rooms.W1N1.roleBounds.hauler.maxCount).toBe(7);
  });
});
