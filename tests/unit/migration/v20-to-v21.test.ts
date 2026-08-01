/**
 * v20 → v21 迁移独立测试（目标清单布局闭环字段建档）。
 *
 * 迁移语义：新增 KernelMemory.layoutGaps（缺口观测）与
 * LayoutMemory.nextGapPlanTick（缺口慢速重试节流）两个可选字段，
 * 由 layout-planner 惰性写入。迁移只做「建档 + 畸形自愈」，不写字段值。
 *
 * 自愈规则：
 *   - layoutGaps 非对象 → 删除整个字段
 *   - layoutGaps[room] 非对象 → 删除该房条目
 *   - layoutGaps[room][type] 非数字 → 删除该类型
 *   - 空对象回收（删除空房条目 / 空 layoutGaps）
 *   - nextGapPlanTick 非数字 → 删除（缺失视为 0：允许立即 gap-force）
 *
 * 覆盖：
 *   - 空 Memory（无 kernel）不报错
 *   - 合法 layoutGaps / nextGapPlanTick 保留
 *   - 脏 layoutGaps（非对象/非数字值）→ 清除
 *   - 脏 nextGapPlanTick → 清除
 *   - 幂等：重复执行不产生副作用
 *   - 已是 v21 的新 Memory → 跳过迁移
 */
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

  it("已是 v21 的新 Memory → 跳过迁移", () => {
    (globalThis as any).Memory = {
      schemaVersion: 21,
      creeps: {},
      rooms: {},
      kernel: { layoutGaps: { W7N3: "should-not-touch" } },
    };

    runMigrations();

    // 迁移被跳过：脏数据原样保留（版本已达到当前，不执行自愈）。
    expect((globalThis as any).Memory.kernel.layoutGaps.W7N3).toBe("should-not-touch");
    expect((globalThis as any).Memory.schemaVersion).toBe(21);
  });
});
