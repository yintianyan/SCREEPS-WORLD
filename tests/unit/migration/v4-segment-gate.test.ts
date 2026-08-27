/** v3→v4 迁移的 segment 就绪门禁测试。 */
import { beforeEach, describe, expect, it } from "vitest";
import { maintainMemory, runMigrations } from "../../../src/kernel/memory";
import { requestSegments, getRoomLayoutData } from "../../../src/kernel/segment-store";
import { CONFIG } from "../../../src/config";

const mockState = {
  time: 100,
  segments: {} as Record<number, string | undefined>,
};

beforeEach(() => {
  mockState.time = 100;
  mockState.segments = {};
  // 模拟 global reset：清空 segment 缓存。
  delete (globalThis as Record<string, unknown>).__segStore;
  Object.assign(globalThis, {
    Game: {
      get time() {
        return mockState.time;
      },
      creeps: {},
      rooms: {},
    },
    RawMemory: {
      segments: mockState.segments,
      setActiveSegments: () => undefined,
    },
    Memory: {
      schemaVersion: 3,
      creeps: {},
      rooms: {
        W1N1: {
          spawnQueue: [],
          buildQueue: [],
          layout: {
            version: 1,
            templateId: "compact-core-v1",
            state: "accepted",
            revision: 0,
            nextPlanTick: 0,
            overrides: { "ext.5.5": { structureType: "extension" } },
            blocked: {},
          },
        },
      },
      kernel: {},
    },
  });
});

describe("memory — v4 迁移 segment 就绪门禁", () => {
  it("reset 首 tick：segment 未就绪时迁移链停在 v3，overrides 不丢失", () => {
    // kernel.run 的真实顺序：requestSegments 先于 maintainMemory。
    requestSegments();
    runMigrations();

    const mem = (globalThis as any).Memory;
    // 版本停在断点 — 不被无条件盖章掩盖。
    expect(mem.schemaVersion).toBe(3);
    // 源数据原封不动，等待 segment 就绪。
    expect(mem.rooms.W1N1.layout.overrides).toEqual({ "ext.5.5": { structureType: "extension" } });
  });

  it("次 tick segment 就绪：迁移续跑至最新版本，overrides 落入 segment", () => {
    // 首 tick：门禁中断。
    requestSegments();
    runMigrations();
    expect((globalThis as any).Memory.schemaVersion).toBe(3);

    // 次 tick：requestedAt !== Game.time → segment 视为可用（真空 = 全新服务器）。
    mockState.time = 101;
    runMigrations();

    const mem = (globalThis as any).Memory;
    expect(mem.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    // 冷数据已迁入 segment，Memory 源字段已删除。
    expect(mem.rooms.W1N1.layout.overrides).toBeUndefined();
    const segData = getRoomLayoutData("W1N1");
    expect(segData.overrides).toEqual({ "ext.5.5": { structureType: "extension" } });
  });

  it("非 reset 环境（未调用 requestSegments）：迁移直接完成，向后兼容", () => {
    runMigrations();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });
});
