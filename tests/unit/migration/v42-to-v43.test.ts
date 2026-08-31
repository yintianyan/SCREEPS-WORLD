/** v42 → v43 Schema Migration Test — legacy 情报桥退役清理 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v42 → v43（RoomMemory.intel 存量清理）", () => {
  it("存量 intel 记录被清除，schemaVersion 升至当前", () => {
    (globalThis as any).Memory = {
      schemaVersion: 42,
      creeps: {},
      rooms: {
        W1N1: {
          intel: {
            W2N2: { kind: "normal", status: "normal", lastSeen: 900, pathCost: 60 },
          },
          colonyState: "normal",
        },
        W3N3: {
          intel: {},
        },
      },
      kernel: {},
    };

    runMigrations();

    const mem = (globalThis as any).Memory;
    expect(mem.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect("intel" in mem.rooms.W1N1).toBe(false);
    expect("intel" in mem.rooms.W3N3).toBe(false);
    expect(mem.rooms.W1N1.colonyState).toBe("normal"); // 其余字段不受影响
  });

  it("无 intel 字段的房不新增键；rooms 为空不崩溃", () => {
    (globalThis as any).Memory = {
      schemaVersion: 42,
      creeps: {},
      rooms: {
        W1N1: { colonyState: "normal" },
      },
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect(Object.keys((globalThis as any).Memory.rooms.W1N1)).toEqual(["colonyState"]);
  });

  it("幂等：重复执行无副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 42,
      creeps: {},
      rooms: {
        W1N1: { intel: { W2N2: { kind: "normal", status: "normal", lastSeen: 1 } } },
      },
      kernel: {},
    };

    runMigrations();
    (globalThis as any).Memory.schemaVersion = 42; // 强制重入（global reset 场景）
    runMigrations();

    const mem = (globalThis as any).Memory;
    expect(mem.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect("intel" in mem.rooms.W1N1).toBe(false);
  });
});
