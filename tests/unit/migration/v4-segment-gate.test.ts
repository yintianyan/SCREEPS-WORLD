/** v3→v4 迁移的 segment 就绪门禁测试。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { requestSegments, flushSegments, SEGMENT_LAYOUT } from "../../../src/kernel/segment-store";
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

  it("观察到送达后迁移续跑：overrides 真的落进 segment，且别房历史不被覆盖", () => {
    // 首 tick：门禁中断。
    requestSegments();
    runMigrations();
    expect((globalThis as any).Memory.schemaVersion).toBe(3);

    // 次 tick：段已送达，且里面有别的房的历史冷数据 — 这正是"空覆盖"会毁掉的东西。
    mockState.time = 101;
    mockState.segments[SEGMENT_LAYOUT] = JSON.stringify({
      W9N9: { overrides: { "ext.1.1": { structureType: "extension" } }, blocked: {} },
    });
    runMigrations();

    const mem = (globalThis as any).Memory;
    expect(mem.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    // Memory 源字段已删除 — 数据只剩 segment 一份。
    expect(mem.rooms.W1N1.layout.overrides).toBeUndefined();

    // 关键：断落盘结果，不断堆缓存。旧写法用 getRoomLayoutData 读缓存，
    // 于是"从未 flush / 覆盖历史"这两种失效都测不出来。
    flushSegments();
    const onDisk = JSON.parse(mockState.segments[SEGMENT_LAYOUT]!);
    expect(onDisk.W1N1.overrides).toEqual({ "ext.5.5": { structureType: "extension" } });
    expect(onDisk.W9N9.overrides).toEqual({ "ext.1.1": { structureType: "extension" } });
  });

  it("从未请求激活：状态未知，迁移暂缓而不是当成全新档直接跑完", () => {
    // 没调用 requestSegments，也没观察到任何段送达 — 此时读到的空结构不可信。
    runMigrations();
    expect((globalThis as any).Memory.schemaVersion).toBe(3);
    expect((globalThis as any).Memory.rooms.W1N1.layout.overrides).toEqual({
      "ext.5.5": { structureType: "extension" },
    });

    // 请求并观察到送达 → 迁移续跑。
    requestSegments();
    mockState.time = 101;
    mockState.segments[SEGMENT_LAYOUT] = "{}";
    runMigrations();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });
});
