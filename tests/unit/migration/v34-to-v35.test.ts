/**
 * v34 → v35 迁移独立测试（v35 nuker 威慑链：nukesInFlight 在途台账建档）。
 *
 * 迁移语义：KernelMemory.nukesInFlight 为可选字段（war-planner 唯一写者）。
 * 建档 + 畸形自愈：nukesInFlight 非对象 → 删除；条目非数字数组 → 删除该
 * 条目（缺失视为无在途，安全侧 — 宁可漏射不可重复砸同一目标）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v34 → v35（在途核弹台账建档）", () => {
  it("空 Memory 不报错，版本升到当前", () => {
    (globalThis as any).Memory = { schemaVersion: 34, creeps: {}, rooms: {}, kernel: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("合法台账条目保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 34,
      creeps: {},
      rooms: {},
      kernel: { nukesInFlight: { W6N4: [51000, 102000] } },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.nukesInFlight).toEqual({
      W6N4: [51000, 102000],
    });
  });

  it("nukesInFlight 非对象（数组/字符串）→ 删除", () => {
    (globalThis as any).Memory = {
      schemaVersion: 34,
      creeps: {},
      rooms: {},
      kernel: { nukesInFlight: ["bad"] },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.nukesInFlight).toBeUndefined();

    (globalThis as any).Memory = {
      schemaVersion: 34,
      creeps: {},
      rooms: {},
      kernel: { nukesInFlight: "bad" },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.nukesInFlight).toBeUndefined();
  });

  it("条目非数字数组（字符串/混合/非数组）→ 删除该目标（合法条目不受连坐）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 34,
      creeps: {},
      rooms: {},
      kernel: {
        nukesInFlight: {
          W6N4: [51000],
          W8N2: ["soon"],
          W9N1: [51000, "x"],
          W9N3: 42,
        },
      },
    };
    runMigrations();
    expect((globalThis as any).Memory.kernel.nukesInFlight).toEqual({ W6N4: [51000] });
  });

  it("字段缺失 → 不新建（无在途是安全默认，发射判定自然放行后续裁决）", () => {
    (globalThis as any).Memory = { schemaVersion: 34, creeps: {}, rooms: {}, kernel: {} };
    runMigrations();
    expect((globalThis as any).Memory.kernel.nukesInFlight).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 34,
      creeps: {},
      rooms: {},
      kernel: { nukesInFlight: { W6N4: [51000] } },
    };
    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});
