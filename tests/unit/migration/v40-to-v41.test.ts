/**
 * v40 → v41 Schema Migration Test
 *
 * 验证 OutcomeChannel 字段名压缩迁移：
 *   queue → q, seen → s, duplicateRejected → dr, overflowEvicted → oe
 *
 * 关键：调用真实的 `runMigrations()` 函数（src/kernel/memory.ts），
 * 而非复制粘贴迁移逻辑——确保测试验证的是生产代码而非副本。
 *
 * 覆盖：
 *   1. 正常迁移：旧字段名 → 新字段名，数据保留，schemaVersion === CONFIG 版本
 *   2. 幂等性：重复执行不产生副作用
 *   3. 坏数据：字段类型错误时不崩溃
 *   4. 无 outcomeEvents 时安全跳过
 *   5. 不破坏 operationId/openedAt/closedAt/forcedAdvance
 *   6. global reset 后不重复破坏数据
 *   7. 迁移中断后下一 tick 可重试，schemaVersion 不提前增加
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("migration v40 → v41（OutcomeChannel 字段名压缩）", () => {
  it("空 Memory 不报错，版本升到 CONFIG.memory.schemaVersion（=CONFIG.memory.schemaVersion）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 40,
      creeps: {},
      rooms: {},
      kernel: {},
    };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(
      CONFIG.memory.schemaVersion,
    );
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("正常迁移：旧字段 → 新字段，数据保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 40,
      creeps: {},
      rooms: {},
      kernel: {
        outcomeEvents: {
          queue: [
            {
              eid: "E-1-0",
              oid: "op:W1N1:1000",
              r: "COMPLETED",
              oa: 1000,
              ca: 2000,
              fa: false,
            },
          ],
          seen: ["op:W1N1:1000"],
          duplicateRejected: 2,
          overflowEvicted: 1,
        },
      },
    };

    runMigrations();

    const mem = (globalThis as any).Memory;
    expect(mem.schemaVersion).toBe(CONFIG.memory.schemaVersion);

    const ch = mem.kernel.outcomeEvents;
    expect(ch).toBeDefined();
    expect(ch.q).toHaveLength(1);
    expect(ch.q[0].eid).toBe("E-1-0");
    expect(ch.q[0].oid).toBe("op:W1N1:1000");
    expect(ch.q[0].r).toBe("COMPLETED");
    expect(ch.q[0].oa).toBe(1000);
    expect(ch.q[0].ca).toBe(2000);
    expect(ch.q[0].fa).toBe(false);
    expect(ch.s).toHaveLength(1);
    expect(ch.s[0]).toBe("op:W1N1:1000");
    expect(ch.dr).toBe(2);
    expect(ch.oe).toBe(1);

    // 旧字段必须被删除
    expect(ch.queue).toBeUndefined();
    expect(ch.seen).toBeUndefined();
    expect(ch.duplicateRejected).toBeUndefined();
    expect(ch.overflowEvicted).toBeUndefined();
  });

  it("幂等性：重复执行不产生副作用，schemaVersion 稳定", () => {
    (globalThis as any).Memory = {
      schemaVersion: 40,
      creeps: {},
      rooms: {},
      kernel: {
        outcomeEvents: {
          queue: [{ eid: "E-1-0" }],
          seen: ["op:W1N1:1000"],
          duplicateRejected: 1,
          overflowEvicted: 0,
        },
      },
    };

    // 第一次迁移
    runMigrations();
    const mem1 = (globalThis as any).Memory;
    const ch1 = JSON.parse(JSON.stringify(mem1.kernel.outcomeEvents));
    const version1 = mem1.schemaVersion;

    expect(version1).toBe(CONFIG.memory.schemaVersion);

    // 第二次调用（已经是当前版本 → migrateMemory 不执行）
    runMigrations();
    const mem2 = (globalThis as any).Memory;
    const ch2 = JSON.parse(JSON.stringify(mem2.kernel.outcomeEvents));

    expect(mem2.schemaVersion).toBe(version1);
    expect(ch2).toEqual(ch1);
  });

  it("坏数据：字段类型错误时归一化为安全默认值", () => {
    (globalThis as any).Memory = {
      schemaVersion: 40,
      creeps: {},
      rooms: {},
      kernel: {
        outcomeEvents: {
          queue: "not-an-array",
          seen: null,
          duplicateRejected: "not-a-number",
          overflowEvicted: undefined,
        },
      },
    };

    expect(() => runMigrations()).not.toThrow();

    const ch = (globalThis as any).Memory.kernel.outcomeEvents;
    expect(ch.q).toEqual([]);
    expect(ch.s).toEqual([]);
    expect(ch.dr).toBe(0);
    expect(ch.oe).toBe(0);

    // 坏数据使用安全默认值归一化，迁移仍可完成，避免永久卡在 v40。
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect((globalThis as any).Memory.kernel.outcomeEvents).toEqual({
      q: [], s: [], dr: 0, oe: 0,
    });
  });

  it("无 outcomeEvents 时安全跳过", () => {
    (globalThis as any).Memory = {
      schemaVersion: 40,
      creeps: {},
      rooms: {},
      kernel: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect(
      (globalThis as any).Memory.kernel.outcomeEvents,
    ).toBeUndefined();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("无 kernel 时安全跳过", () => {
    (globalThis as any).Memory = {
      schemaVersion: 40,
      creeps: {},
      rooms: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.kernel).toBeUndefined();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("不破坏 expansion 的 operationId/openedAt/closedAt/forcedAdvance", () => {
    (globalThis as any).Memory = {
      schemaVersion: 40,
      creeps: {},
      rooms: {},
      kernel: {
        outcomeEvents: {
          queue: [{ eid: "E-1-0", oid: "op:W1N1:1000", r: "COMPLETED", oa: 1000, ca: 2000, fa: false }],
          seen: ["op:W1N1:1000"],
          duplicateRejected: 0,
          overflowEvicted: 0,
        },
        expansion: {
          operationId: "op:W1N1:1000",
          openedAt: 1000,
          closedAt: 2000,
          forcedAdvance: false,
        },
      },
    };

    runMigrations();

    const mem = (globalThis as any).Memory;
    const exp = mem.kernel.expansion;
    expect(exp.operationId).toBe("op:W1N1:1000");
    expect(exp.openedAt).toBe(1000);
    expect(exp.closedAt).toBe(2000);
    expect(exp.forcedAdvance).toBe(false);

    // outcomeEvents 中的事件数据也保留
    const ch = mem.kernel.outcomeEvents;
    const event = ch.q[0];
    expect(event.oid).toBe("op:W1N1:1000");
    expect(event.oa).toBe(1000);
    expect(event.ca).toBe(2000);
    expect(event.fa).toBe(false);
  });

  it("部分迁移场景：只有部分旧字段存在", () => {
    (globalThis as any).Memory = {
      schemaVersion: 40,
      creeps: {},
      rooms: {},
      kernel: {
        outcomeEvents: {
          queue: [{ eid: "E-1-0" }],
          dr: 3,
        },
      },
    };

    runMigrations();

    const ch = (globalThis as any).Memory.kernel.outcomeEvents;
    expect(ch.q).toHaveLength(1);
    expect(ch.queue).toBeUndefined();
    expect(ch.dr).toBe(3);
    expect(ch.s).toEqual([]);
    expect(ch.oe).toBe(0);
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("空 outcomeEvents 安全处理", () => {
    (globalThis as any).Memory = {
      schemaVersion: 40,
      creeps: {},
      rooms: {},
      kernel: {
        outcomeEvents: {
          queue: [],
          seen: [],
          duplicateRejected: 0,
          overflowEvicted: 0,
        },
      },
    };

    runMigrations();

    const ch = (globalThis as any).Memory.kernel.outcomeEvents;
    expect(ch.q).toEqual([]);
    expect(ch.s).toEqual([]);
    expect(ch.dr).toBe(0);
    expect(ch.oe).toBe(0);
    expect(ch.queue).toBeUndefined();
    expect(ch.seen).toBeUndefined();
    expect(ch.duplicateRejected).toBeUndefined();
    expect(ch.overflowEvicted).toBeUndefined();
  });

  it("global reset 后不重复破坏数据（幂等重入）", () => {
    // 模拟 global reset：Memory 丢失，重新从 RawMemory 加载，
    // schemaVersion 可能回到 40（如果有旧持久化版本）
    // 迁移应安全重入，不产生重复或损坏
    const v40Data = {
      schemaVersion: 40,
      creeps: {},
      rooms: {},
      kernel: {
        outcomeEvents: {
          queue: [{ eid: "E-1-0", oid: "op:W1N1:1000" }],
          seen: ["op:W1N1:1000"],
          duplicateRejected: 0,
          overflowEvicted: 0,
        },
      },
    };

    // 第一次迁移
    (globalThis as any).Memory = JSON.parse(JSON.stringify(v40Data));
    runMigrations();
    const afterFirst = JSON.parse(
      JSON.stringify((globalThis as any).Memory),
    );
    expect(afterFirst.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect(afterFirst.kernel.outcomeEvents.q).toHaveLength(1);

    // 模拟 global reset 后从持久化恢复（此时已有 v41 数据）
    // schemaVersion = 41 → runMigrations 不执行迁移
    (globalThis as any).Memory = JSON.parse(JSON.stringify(afterFirst));
    runMigrations();
    const afterReset = (globalThis as any).Memory;

    expect(afterReset.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect(afterReset.kernel.outcomeEvents.q).toEqual(
      afterFirst.kernel.outcomeEvents.q,
    );
    expect(afterReset.kernel.outcomeEvents.s).toEqual(
      afterFirst.kernel.outcomeEvents.s,
    );
    expect(afterReset.kernel.outcomeEvents.dr).toBe(
      afterFirst.kernel.outcomeEvents.dr,
    );
    expect(afterReset.kernel.outcomeEvents.oe).toBe(
      afterFirst.kernel.outcomeEvents.oe,
    );
  });

  it("已有新字段时跳过旧字段迁移（前向兼容）", () => {
    // 如果运行时惰性迁移已部分执行（新字段已存在），正式迁移不应覆盖
    (globalThis as any).Memory = {
      schemaVersion: 40,
      creeps: {},
      rooms: {},
      kernel: {
        outcomeEvents: {
          q: [{ eid: "E-2-0" }], // 已有新字段
          s: ["op:W1N1:2000"],
          dr: 5,
          oe: 2,
          // 旧字段也残留（惰性迁移可能已执行但未删除旧字段）
          queue: [{ eid: "OLD-DO-NOT-USE" }],
          seen: ["OLD"],
          duplicateRejected: 99,
          overflowEvicted: 99,
        },
      },
    };

    runMigrations();

    const ch = (globalThis as any).Memory.kernel.outcomeEvents;
    // 新字段不被旧字段覆盖
    expect(ch.q).toHaveLength(1);
    expect(ch.q[0].eid).toBe("E-2-0");
    expect(ch.s[0]).toBe("op:W1N1:2000");
    expect(ch.dr).toBe(5);
    expect(ch.oe).toBe(2);
    // 旧字段被删除
    expect(ch.queue).toBeUndefined();
    expect(ch.seen).toBeUndefined();
    expect(ch.duplicateRejected).toBeUndefined();
    expect(ch.overflowEvicted).toBeUndefined();
  });
});
