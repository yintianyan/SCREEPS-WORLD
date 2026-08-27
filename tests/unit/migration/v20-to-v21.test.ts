/** v20 → v21 迁移独立测试（目标清单布局闭环字段建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v20 → v21（目标清单布局闭环字段建档）", () => {
  it("空 Memory（无 kernel）不报错，版本升到 v21", () => {
    (globalThis as any).Memory = {
      schemaVersion: 20,
      creeps: {},
      rooms: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法 layoutGaps 与 nextGapPlanTick 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 20,
      creeps: {},
      rooms: {
        W7N3: {
          layout: { nextGapPlanTick: 15000 },
        },
      },
      kernel: {
        layoutGaps: {
          W7N3: { extension: 19, lab: 6 },
          W8N3: { powerSpawn: 1 },
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.layoutGaps.W7N3).toEqual({
      extension: 19,
      lab: 6,
    });
    expect((globalThis as any).Memory.kernel.layoutGaps.W8N3.powerSpawn).toBe(1);
    expect((globalThis as any).Memory.rooms.W7N3.layout.nextGapPlanTick).toBe(15000);
  });

  it("layoutGaps 为非对象 → 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 20,
      creeps: {},
      rooms: {},
      kernel: { layoutGaps: "bad" },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.layoutGaps).toBeUndefined();
  });

  it("layoutGaps[room] 为非对象 → 删除该房条目", () => {
    (globalThis as any).Memory = {
      schemaVersion: 20,
      creeps: {},
      rooms: {},
      kernel: {
        layoutGaps: {
          W7N3: { extension: 10 },
          W8N3: "bad",
        },
      },
    };

    runMigrations();

    const gaps = (globalThis as any).Memory.kernel.layoutGaps;
    expect(gaps.W7N3).toEqual({ extension: 10 });
    expect(gaps.W8N3).toBeUndefined();
  });

  it("layoutGaps[room][type] 为非数字 → 删除该类型；空房条目/空字段回收", () => {
    (globalThis as any).Memory = {
      schemaVersion: 20,
      creeps: {},
      rooms: {},
      kernel: {
        layoutGaps: {
          W7N3: { extension: 10, lab: "many" },
          W8N3: { powerSpawn: 1 },
          W9N3: {},
        },
      },
    };

    runMigrations();

    const gaps = (globalThis as any).Memory.kernel.layoutGaps;
    expect(gaps.W7N3).toEqual({ extension: 10 }); // lab 非数字被清除
    expect(gaps.W8N3).toEqual({ powerSpawn: 1 });
    expect(gaps.W9N3).toBeUndefined(); // 空房条目回收
    expect(gaps).toBeDefined(); // 仍有房条目 → 字段保留
  });

  it("layoutGaps 全部为空 → 整个字段回收", () => {
    (globalThis as any).Memory = {
      schemaVersion: 20,
      creeps: {},
      rooms: {},
      kernel: { layoutGaps: {} },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.layoutGaps).toBeUndefined();
  });

  it("nextGapPlanTick 为非数字 → 删除（缺失视为 0，允许立即 gap-force）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 20,
      creeps: {},
      rooms: {
        W7N3: { layout: { nextGapPlanTick: "later" } },
        W8N3: { layout: { nextGapPlanTick: 42 } },
      },
    };

    runMigrations();

    const r7 = (globalThis as any).Memory.rooms.W7N3.layout;
    expect(r7.nextGapPlanTick).toBeUndefined();
    expect((globalThis as any).Memory.rooms.W8N3.layout.nextGapPlanTick).toBe(42);
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 20,
      creeps: {},
      rooms: {
        W7N3: { layout: { nextGapPlanTick: 15000 } },
      },
      kernel: {
        layoutGaps: { W7N3: { extension: 19 } },
      },
    };

    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });

  it("已是 v21 的新 Memory → 跳过 v20→v21 迁移（layoutGaps 不被自愈）", () => {
    // 注：v22 上线后 v21 会继续迁移到 v22（v22 仅遍历 rooms[].phase 自愈，
    // 不触碰 kernel.layoutGaps）。本用例验证 v20→v21 步骤被跳过 —
    // 脏 layoutGaps 原样保留（v21 迁移的 ready/run 不再执行）。
    (globalThis as any).Memory = {
      schemaVersion: 21,
      creeps: {},
      rooms: {},
      kernel: { layoutGaps: { W7N3: "should-not-touch" } },
    };

    runMigrations();

    // v20→v21 迁移被跳过：脏数据原样保留（v21 步骤的 ready/run 不执行）。
    expect((globalThis as any).Memory.kernel.layoutGaps.W7N3).toBe("should-not-touch");
    // v21→v22 迁移会执行（rooms 为空，无副作用），版本升到当前 schemaVersion。
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });
});
