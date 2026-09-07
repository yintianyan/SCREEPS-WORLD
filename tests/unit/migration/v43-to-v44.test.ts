/** v43 → v44 Schema Migration Test — TuningMemory.strategyOverrides 建档与畸形自愈 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v43 → v44（strategyOverrides 建档 + 畸形自愈）", () => {
  it("无 kernel/tuning 时不崩溃，schemaVersion 升至当前", () => {
    (globalThis as any).Memory = {
      schemaVersion: 43,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("无 strategyOverrides 时不新增键（幂等）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 43,
      creeps: {},
      rooms: {},
      kernel: { tuning: { hauler: { maxCount: 5 } } },
    };

    runMigrations();

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect("strategyOverrides" in tuning).toBe(false);
    expect(tuning.hauler.maxCount).toBe(5);
  });

  it("畸形 strategyOverrides（非对象）被删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 43,
      creeps: {},
      rooms: {},
      kernel: { tuning: { strategyOverrides: "bad" } },
    };

    runMigrations();

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect("strategyOverrides" in tuning).toBe(false);
  });

  it("畸形 strategyOverrides（数组）被删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 43,
      creeps: {},
      rooms: {},
      kernel: { tuning: { strategyOverrides: [1, 2, 3] } },
    };

    runMigrations();

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect("strategyOverrides" in tuning).toBe(false);
  });

  it("正常 strategyOverrides 条目保留，畸形条目删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 43,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          strategyOverrides: {
            posture: { value: 1, adjustedAt: 100 },
            bad: { value: "x", adjustedAt: 100 },
            bad2: { value: 1, adjustedAt: "x" },
            bad3: "not-an-object",
            bad4: null,
          },
        },
      },
    };

    runMigrations();

    const overrides = (globalThis as any).Memory.kernel.tuning.strategyOverrides;
    expect("posture" in overrides).toBe(true);
    expect(overrides.posture).toEqual({ value: 1, adjustedAt: 100 });
    expect("bad" in overrides).toBe(false);
    expect("bad2" in overrides).toBe(false);
    expect("bad3" in overrides).toBe(false);
    expect("bad4" in overrides).toBe(false);
  });

  it("幂等：重复执行无副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 43,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          strategyOverrides: {
            posture: { value: 1, adjustedAt: 100 },
          },
        },
      },
    };

    runMigrations();
    (globalThis as any).Memory.schemaVersion = 43;
    runMigrations();

    const overrides = (globalThis as any).Memory.kernel.tuning.strategyOverrides;
    expect(overrides.posture).toEqual({ value: 1, adjustedAt: 100 });
  });
});
