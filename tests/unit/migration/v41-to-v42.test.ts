/**
 * v41 → v42 Schema Migration Test
 *
 * 验证 R2 队列治理迁移：BuildTask 新增可选 queuedAt（入队 tick）。
 * 存量任务缺 queuedAt → 回填为迁移时刻 Game.time（防止「缺省=0」被超龄
 * 判定误清除）。调用真实 runMigrations()。
 *
 * 覆盖：
 *   1. 回填：无 queuedAt 的任务获得当前 tick
 *   2. 保留：已有 queuedAt 的任务不被覆盖
 *   3. 幂等：重复执行不改变回填值
 *   4. 防御：buildQueue 非数组 / 任务为 null 不崩溃
 *   5. 版本：schemaVersion 升至 CONFIG.memory.schemaVersion
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "core.ext.01",
    pos: { x: 24, y: 26, roomName: "W1N1" },
    structureType: "extension",
    priority: 1,
    state: "queued",
    attempts: 0,
    retryAt: 0,
    ...overrides,
  };
}

describe("migration v41 → v42（BuildTask.queuedAt 回填）", () => {
  it("无 queuedAt 的任务回填为当前 Game.time", () => {
    (globalThis as any).Memory = {
      schemaVersion: 41,
      creeps: {},
      rooms: {
        W1N1: { buildQueue: [makeTask()] },
      },
      kernel: {},
    };
    (globalThis as any).Game = { ...(globalThis as any).Game, time: 12345 };

    runMigrations();

    const mem = (globalThis as any).Memory;
    expect(mem.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect(mem.rooms.W1N1.buildQueue[0].queuedAt).toBe(12345);
  });

  it("已有 queuedAt 的任务不被覆盖", () => {
    (globalThis as any).Memory = {
      schemaVersion: 41,
      creeps: {},
      rooms: {
        W1N1: { buildQueue: [makeTask({ queuedAt: 777 })] },
      },
      kernel: {},
    };
    (globalThis as any).Game = { ...(globalThis as any).Game, time: 12345 };

    runMigrations();

    expect((globalThis as any).Memory.rooms.W1N1.buildQueue[0].queuedAt).toBe(777);
  });

  it("幂等：重复执行不改变回填值", () => {
    (globalThis as any).Memory = {
      schemaVersion: 41,
      creeps: {},
      rooms: { W1N1: { buildQueue: [makeTask()] } },
      kernel: {},
    };
    (globalThis as any).Game = { ...(globalThis as any).Game, time: 100 };

    runMigrations();
    const first = (globalThis as any).Memory.rooms.W1N1.buildQueue[0].queuedAt;

    (globalThis as any).Game = { ...(globalThis as any).Game, time: 9999 };
    // schemaVersion 已是最新 → 不会重跑；即便强制重入（global reset 场景回 41），
    // queuedAt 已存在也不会被覆盖。
    (globalThis as any).Memory.schemaVersion = 41;
    runMigrations();

    const mem = (globalThis as any).Memory;
    expect(mem.rooms.W1N1.buildQueue[0].queuedAt).toBe(first);
  });

  it("防御：buildQueue 非数组 / null 任务不崩溃", () => {
    (globalThis as any).Memory = {
      schemaVersion: 41,
      creeps: {},
      rooms: {
        W1N1: { buildQueue: "corrupted" },
        W2N2: { buildQueue: [null, makeTask()] },
        W3N3: {},
      },
      kernel: {},
    };
    (globalThis as any).Game = { ...(globalThis as any).Game, time: 5 };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(
      CONFIG.memory.schemaVersion,
    );
    expect((globalThis as any).Memory.rooms.W2N2.buildQueue[1].queuedAt).toBe(5);
  });

  it("site/blocked/done 状态的任务同样回填（状态无关）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 41,
      creeps: {},
      rooms: {
        W1N1: {
          buildQueue: [
            makeTask({ state: "site" }),
            makeTask({ state: "blocked", key: "core.ext.02" }),
            makeTask({ state: "done", key: "core.ext.03" }),
          ],
        },
      },
      kernel: {},
    };
    (globalThis as any).Game = { ...(globalThis as any).Game, time: 42 };

    runMigrations();

    const queue = (globalThis as any).Memory.rooms.W1N1.buildQueue;
    expect(queue.map((t: any) => t.queuedAt)).toEqual([42, 42, 42]);
  });
});
