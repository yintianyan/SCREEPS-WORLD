/**
 * v21 → v22 迁移独立测试（P0-1 srcRatio 强制 crisis 通道字段建档）。
 *
 * 迁移语义：新增 RoomMemory.phase.srcStallTicks 与 RoomMemory.phase.storageEnergyPrev
 * 两个可选字段，由 room-state 惰性写入。迁移只做「建档 + 畸形自愈」，不写字段值。
 *
 * 自愈规则：
 *   - srcStallTicks 非数字 → 删除（缺失视为 0，安全）
 *   - storageEnergyPrev 非数字 → 删除（缺失由 room-state 用 current 兜底，drainRate=0）
 *   - phase 非对象 → 跳过该房（不触碰）
 *
 * 覆盖：
 *   - 空 Memory（无 room.phase）不报错
 *   - 合法 srcStallTicks / storageEnergyPrev 保留
 *   - 脏 srcStallTicks（非数字）→ 清除，合法 storageEnergyPrev 保留
 *   - 脏 storageEnergyPrev（非数字）→ 清除，合法 srcStallTicks 保留
 *   - phase 非对象 → 跳过
 *   - 幂等：重复执行不产生副作用
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v21 → v22（srcRatio 强制 crisis 通道字段建档）", () => {
  it("空 Memory（无 phase）不报错，版本升到当前", () => {
    (globalThis as any).Memory = {
      schemaVersion: 21,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法 srcStallTicks 与 storageEnergyPrev 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 21,
      creeps: {},
      rooms: {
        W7N3: { phase: { srcStallTicks: 300, storageEnergyPrev: 12000 } },
        W8N3: { phase: { srcStallTicks: 0 } },
      },
      kernel: {},
    };

    runMigrations();

    expect((globalThis as any).Memory.rooms.W7N3.phase.srcStallTicks).toBe(300);
    expect((globalThis as any).Memory.rooms.W7N3.phase.storageEnergyPrev).toBe(12000);
    expect((globalThis as any).Memory.rooms.W8N3.phase.srcStallTicks).toBe(0);
  });

  it("srcStallTicks 非数字 → 删除，合法 storageEnergyPrev 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 21,
      creeps: {},
      rooms: {
        W7N3: { phase: { srcStallTicks: "long", storageEnergyPrev: 5000 } },
      },
      kernel: {},
    };

    runMigrations();

    const phase = (globalThis as any).Memory.rooms.W7N3.phase;
    expect(phase.srcStallTicks).toBeUndefined();
    expect(phase.storageEnergyPrev).toBe(5000);
  });

  it("storageEnergyPrev 非数字 → 删除，合法 srcStallTicks 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 21,
      creeps: {},
      rooms: {
        W7N3: { phase: { srcStallTicks: 90, storageEnergyPrev: "n/a" } },
      },
      kernel: {},
    };

    runMigrations();

    const phase = (globalThis as any).Memory.rooms.W7N3.phase;
    expect(phase.srcStallTicks).toBe(90);
    expect(phase.storageEnergyPrev).toBeUndefined();
  });

  it("phase 非对象 → 跳过该房", () => {
    (globalThis as any).Memory = {
      schemaVersion: 21,
      creeps: {},
      rooms: {
        W7N3: { phase: "bad" },
      },
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    // 非对象 phase 被 continue 跳过，原样保留（v22 迁移不触碰）。
    expect((globalThis as any).Memory.rooms.W7N3.phase).toBe("bad");
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 21,
      creeps: {},
      rooms: {
        W7N3: { phase: { srcStallTicks: 120, storageEnergyPrev: 3000 } },
      },
      kernel: {},
    };

    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});