/**
 * v17 → v18 迁移独立测试（P1-I：tuning baselineVersion 版本戳建档）。
 *
 * 迁移语义：只建档不定版 —— 故意不写 baselineVersion=CONFIG.tuning.baselineVersion，
 * 让 tuning-engine 首次评估时检测 undefined ≠ CONFIG 值触发清空 rooms 覆盖
 * （清零重来语义）。若迁移直接定版，则存量旧覆盖会保留并继续压制新基线，
 * 违背 P1-I 修复目标。
 *
 * 覆盖：
 *   - 旧 tuning 结构存在 → 不写 baselineVersion，保留 undefined
 *   - 无 tuning 结构 → 不创建（惰性）
 *   - 非数字 baselineVersion 自愈删除
 *   - 幂等：重复执行不产生副作用
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v17 → v18（tuning baselineVersion 建档）", () => {
  it("存在 tuning 结构时不写 baselineVersion（让 tuning-engine 触发清零）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 17,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          lastTuned: 1000,
          rooms: {
            W1N1: {
              roleBounds: { hauler: { maxCount: 7 } },
              lastAdjusted: { "hauler.maxCount": 1000 },
            },
          },
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    // 关键断言：迁移不写 baselineVersion，保留 undefined。
    // tuning-engine 首次评估时检测 undefined ≠ CONFIG.tuning.baselineVersion(=1)
    // → 清空 rooms → 自调优从基线重新收敛（清零重来语义）。
    expect((globalThis as any).Memory.kernel.tuning.baselineVersion).toBeUndefined();
    // 旧覆盖值保留（迁移不动 rooms，由 tuning-engine 清）。
    expect((globalThis as any).Memory.kernel.tuning.rooms.W1N1.roleBounds.hauler.maxCount).toBe(7);
  });

  it("无 tuning 时不创建（惰性，由 tuning-engine 首次运行建档）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 17,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    runMigrations();

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect((globalThis as any).Memory.kernel.tuning).toBeUndefined();
  });

  it("无 kernel 时跳过（不创建 kernel）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 17,
      creeps: {},
      rooms: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect((globalThis as any).Memory.kernel).toBeUndefined();
  });

  it("非数字 baselineVersion 自愈删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 17,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          // 畸形数据：字符串版本号
          baselineVersion: "bad",
          lastTuned: 0,
          rooms: {},
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.tuning.baselineVersion).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 17,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          lastTuned: 1000,
          rooms: {
            W1N1: {
              roleBounds: { hauler: { maxCount: 7 } },
              lastAdjusted: {},
            },
          },
        },
      },
    };

    runMigrations();
    runMigrations();
    runMigrations();

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect((globalThis as any).Memory.kernel.tuning.baselineVersion).toBeUndefined();
    // rooms 内容三跑不变。
    expect((globalThis as any).Memory.kernel.tuning.rooms.W1N1.roleBounds.hauler.maxCount).toBe(7);
  });

  it("已是最新版本的新 Memory（无 tuning）→ 跳过迁移", () => {
    (globalThis as any).Memory = {
      schemaVersion: CONFIG.memory.schemaVersion,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    runMigrations();

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect((globalThis as any).Memory.kernel.tuning).toBeUndefined();
  });
});
