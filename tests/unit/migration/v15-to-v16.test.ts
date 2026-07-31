/**
 * v15 → v16 迁移独立测试（P1-G：dangerUntil 从 intel 搬到 remoteOps）。
 *
 * 覆盖：
 *   - intel[room].dangerUntil 搬到 remoteOps[room].dangerUntil
 *   - 搬运后 intel 侧旧字段删除
 *   - remoteOps 条目不存在时仅删 intel 旧字段
 *   - 非数字 dangerUntil 自愈删除
 *   - 幂等：重复执行不产生副作用
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v15 → v16（dangerUntil 搬家）", () => {
  it("intel[room].dangerUntil 搬到 remoteOps[room].dangerUntil", () => {
    (globalThis as any).Memory = {
      schemaVersion: 15,
      creeps: {},
      rooms: {
        W1N1: {
          intel: {
            W2N1: { kind: "normal", status: "normal", lastSeen: 100, dangerUntil: 5000 },
          },
          remoteOps: {
            W2N1: { state: "active", createdAt: 0, lastSeen: 100 },
          },
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    const room = (globalThis as any).Memory.rooms.W1N1;
    expect(room.intel.W2N1.dangerUntil).toBeUndefined();
    expect(room.remoteOps.W2N1.dangerUntil).toBe(5000);
  });

  it("remoteOps 条目不存在时仅删 intel 旧字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 15,
      creeps: {},
      rooms: {
        W1N1: {
          intel: {
            W3N1: { kind: "normal", status: "normal", lastSeen: 100, dangerUntil: 5000 },
          },
          remoteOps: {},
        },
      },
    };

    runMigrations();

    const room = (globalThis as any).Memory.rooms.W1N1;
    expect(room.intel.W3N1.dangerUntil).toBeUndefined();
    expect(room.remoteOps.W3N1).toBeUndefined();
  });

  it("非数字 dangerUntil 自愈删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 15,
      creeps: {},
      rooms: {
        W1N1: {
          intel: {
            W2N1: { kind: "normal", status: "normal", lastSeen: 100, dangerUntil: "bad" },
          },
          remoteOps: {
            W2N1: { state: "active", createdAt: 0, lastSeen: 100 },
          },
        },
      },
    };

    runMigrations();

    const room = (globalThis as any).Memory.rooms.W1N1;
    expect(room.intel.W2N1.dangerUntil).toBeUndefined();
    expect(room.remoteOps.W2N1.dangerUntil).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 15,
      creeps: {},
      rooms: {
        W1N1: {
          intel: {
            W2N1: { kind: "normal", status: "normal", lastSeen: 100, dangerUntil: 5000 },
          },
          remoteOps: {
            W2N1: { state: "active", createdAt: 0, lastSeen: 100 },
          },
        },
      },
    };

    runMigrations();
    runMigrations();
    runMigrations();

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    const room = (globalThis as any).Memory.rooms.W1N1;
    expect(room.intel.W2N1.dangerUntil).toBeUndefined();
    expect(room.remoteOps.W2N1.dangerUntil).toBe(5000);
  });

  it("remoteOps 已有 dangerUntil 时不覆盖", () => {
    (globalThis as any).Memory = {
      schemaVersion: 15,
      creeps: {},
      rooms: {
        W1N1: {
          intel: {
            W2N1: { kind: "normal", status: "normal", lastSeen: 100, dangerUntil: 5000 },
          },
          remoteOps: {
            W2N1: { state: "active", createdAt: 0, lastSeen: 100, dangerUntil: 9999 },
          },
        },
      },
    };

    runMigrations();

    const room = (globalThis as any).Memory.rooms.W1N1;
    // remoteOps 侧已有值（9999），不覆盖；intel 侧旧值（5000）仍然删除。
    expect(room.intel.W2N1.dangerUntil).toBeUndefined();
    expect(room.remoteOps.W2N1.dangerUntil).toBe(9999);
  });

  it("无 intel 的房间正常跳过", () => {
    (globalThis as any).Memory = {
      schemaVersion: 15,
      creeps: {},
      rooms: {
        W1N1: {
          remoteOps: {
            W2N1: { state: "active", createdAt: 0, lastSeen: 100 },
          },
        },
      },
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });
});
