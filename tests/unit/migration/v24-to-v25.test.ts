/**
 * v24 → v25 迁移独立测试（P1-3 defense 误触发修复 / prevThreatCount 字段建档）。
 *
 * 迁移语义：新增 RoomMemory.prevThreatCount 可选字段（威胁计数基线，用于检测威胁新增：
 * count 增加才刷 lastHostileAt，防旧威胁停留永久维持 defense 姿态），由 room-state 惰性写入。
 * 迁移只做「建档 + 畸形自愈」，不写字段值。
 *
 * 自愈规则：
 *   - prevThreatCount 非数字 → 删除（缺失视为 0，首威胁即新增，安全）
 *
 * 覆盖：
 *   - 空 Memory 不报错
 *   - 合法 prevThreatCount 保留
 *   - 脏 prevThreatCount（非数字）→ 清除，合法邻居保留
 *   - 幂等：重复执行不产生副作用
 *   - 已是当前版本的新 Memory → 跳过迁移
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v24 → v25（prevThreatCount 字段建档）", () => {
  it("空 Memory 不报错，版本升到当前", () => {
    (globalThis as any).Memory = {
      schemaVersion: 24,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法 prevThreatCount 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 24,
      creeps: {},
      rooms: {
        W7N3: { prevThreatCount: 13 },
      },
      kernel: {},
    };

    runMigrations();

    expect((globalThis as any).Memory.rooms.W7N3.prevThreatCount).toBe(13);
  });

  it("prevThreatCount 非数字 → 删除，合法邻居保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 24,
      creeps: {},
      rooms: {
        W7N3: { prevThreatCount: "many" },
        W8N3: { prevThreatCount: 2 },
      },
      kernel: {},
    };

    runMigrations();

    expect((globalThis as any).Memory.rooms.W7N3.prevThreatCount).toBeUndefined();
    expect((globalThis as any).Memory.rooms.W8N3.prevThreatCount).toBe(2);
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 24,
      creeps: {},
      rooms: {
        W7N3: { prevThreatCount: 7 },
      },
      kernel: {},
    };

    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });

  it("已是当前版本的新 Memory → 跳过迁移（脏 prevThreatCount 不被自愈）", () => {
    (globalThis as any).Memory = {
      schemaVersion: CONFIG.memory.schemaVersion,
      creeps: {},
      rooms: {
        W7N3: { prevThreatCount: "should-not-touch" },
      },
      kernel: {},
    };

    runMigrations();

    // v25 迁移的 ready/run 不执行：脏数据原样保留。
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect((globalThis as any).Memory.rooms.W7N3.prevThreatCount).toBe("should-not-touch");
  });
});