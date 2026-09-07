/** v44 → v45 Schema Migration Test — TuningMemory.intakePending 建档与畸形自愈 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v44 → v45（intakePending 建档 + 畸形自愈）", () => {
  it("无 kernel/tuning 时不崩溃，schemaVersion 升至当前", () => {
    (globalThis as any).Memory = {
      schemaVersion: 44,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("无 intakePending 时不新增键（幂等）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 44,
      creeps: {},
      rooms: {},
      kernel: { tuning: { hauler: { maxCount: 5 } } },
    };

    runMigrations();

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect("intakePending" in tuning).toBe(false);
    expect(tuning.hauler.maxCount).toBe(5);
  });

  it("畸形 intakePending（非对象）被删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 44,
      creeps: {},
      rooms: {},
      kernel: { tuning: { intakePending: "bad" } },
    };

    runMigrations();

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect("intakePending" in tuning).toBe(false);
  });

  it("畸形 intakePending（数组）被删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 44,
      creeps: {},
      rooms: {},
      kernel: { tuning: { intakePending: [1, 2] } },
    };

    runMigrations();

    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect("intakePending" in tuning).toBe(false);
  });

  it("正常 intakePending 条目保留，畸形条目删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 44,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          intakePending: {
            hauler: { value: 8, originalValue: 5, receivedAt: 1000 },
            bad: { value: "x", originalValue: 5, receivedAt: 1000 },
            bad2: { value: 8, originalValue: "x", receivedAt: 1000 },
            bad3: { value: 8, originalValue: 5, receivedAt: "x" },
            bad4: "not-an-object",
            bad5: null,
          },
        },
      },
    };

    runMigrations();

    const intake = (globalThis as any).Memory.kernel.tuning.intakePending;
    expect("hauler" in intake).toBe(true);
    expect(intake.hauler).toEqual({ value: 8, originalValue: 5, receivedAt: 1000 });
    expect("bad" in intake).toBe(false);
    expect("bad2" in intake).toBe(false);
    expect("bad3" in intake).toBe(false);
    expect("bad4" in intake).toBe(false);
    expect("bad5" in intake).toBe(false);
  });

  it("幂等：重复执行无副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 44,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          intakePending: {
            hauler: { value: 8, originalValue: 5, receivedAt: 1000 },
          },
        },
      },
    };

    runMigrations();
    (globalThis as any).Memory.schemaVersion = 44;
    runMigrations();

    const intake = (globalThis as any).Memory.kernel.tuning.intakePending;
    expect(intake.hauler).toEqual({ value: 8, originalValue: 5, receivedAt: 1000 });
  });
});
