/** v31 → v32 迁移独立测试（R7c 无害侦察观测 / lastObserverAt + observerSightings 建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v31 → v32（观测字段建档）", () => {
  it("空 Memory 不报错，版本升到当前", () => {
    (globalThis as any).Memory = { schemaVersion: 31, creeps: {}, rooms: {}, kernel: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法字段保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 31,
      creeps: {},
      rooms: { W7N4: { lastObserverAt: 900, observerSightings: 12 } },
      kernel: {},
    };
    runMigrations();
    expect((globalThis as any).Memory.rooms.W7N4.lastObserverAt).toBe(900);
    expect((globalThis as any).Memory.rooms.W7N4.observerSightings).toBe(12);
  });

  it("非数字 → 删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 31,
      creeps: {},
      rooms: { W7N4: { lastObserverAt: "soon", observerSightings: "many" } },
      kernel: {},
    };
    runMigrations();
    const room = (globalThis as any).Memory.rooms.W7N4;
    expect(room.lastObserverAt).toBeUndefined();
    expect(room.observerSightings).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 31,
      creeps: {},
      rooms: { W7N4: { lastObserverAt: 950, observerSightings: 3 } },
      kernel: {},
    };
    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});
