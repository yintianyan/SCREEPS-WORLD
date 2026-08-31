/** 迁移降版保护回归测试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  delete (globalThis as { __schemaDowngradeWarned?: boolean }).__schemaDowngradeWarned;
});

describe("runMigrations — 降版保护", () => {
  it("Memory 版本高于代码：告警且不抛错、不迁移", () => {
    (globalThis as any).Memory = {
      schemaVersion: 99,
      creeps: {},
      rooms: {},
    };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(() => runMigrations()).not.toThrow();
      const warns = spy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes("schemaVersion=99"));
      expect(warns).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
    // 不执行正向迁移（版本不被改动）
    expect((globalThis as any).Memory.schemaVersion).toBe(99);
  });

  it("同一次 boot 内只告警一次", () => {
    (globalThis as any).Memory = { schemaVersion: 99 };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      runMigrations();
      runMigrations();
      runMigrations();
      const warns = spy.mock.calls.filter((c) => String(c[0]).includes("schemaVersion=99"));
      expect(warns).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("版本一致时不告警", () => {
    (globalThis as any).Memory = { schemaVersion: 36 };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      runMigrations();
      const warns = spy.mock.calls.filter((c) => String(c[0]).includes("[schema]"));
      expect(warns).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
