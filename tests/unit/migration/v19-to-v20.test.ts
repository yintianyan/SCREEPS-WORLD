/** v19 → v20 迁移独立测试（改进 A：tuning 闭环验证字段建档）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v19 → v20（tuning 闭环验证字段建档）", () => {
  it("空 Memory（无 kernel）不报错，版本升到 v20", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
    };

    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("tuning 存在但无 rooms → 不报错，不创建 rooms", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: { tuning: { lastTuned: 1000 } },
    };

    expect(() => runMigrations()).not.toThrow();
    const tuning = (globalThis as any).Memory.kernel.tuning;
    expect(tuning.rooms).toBeUndefined();
  });

  it("合法 pendingValidation 与 frozenParams 保留", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          lastTuned: 1000,
          rooms: {
            W1N1: {
              roleBounds: { hauler: { maxCount: 7 } },
              lastAdjusted: { "hauler.maxCount": 1000 },
              pendingValidation: {
                "hauler.maxCount": {
                  preAdjustSignals: { containerFillRatio: 0.8 },
                  expectedDirection: "improve",
                  adjustDirection: "up",
                  adjustTick: 1000,
                  preAdjustValue: 6,
                },
              },
              frozenParams: {
                "harvester.maxCount": {
                  frozenAt: 500,
                  frozenUntil: 10500,
                  reason: "Consecutive 3 rollbacks",
                  rollbackCount: 3,
                },
              },
            },
          },
        },
      },
    };

    runMigrations();

    const room = (globalThis as any).Memory.kernel.tuning.rooms.W1N1;
    expect(room.pendingValidation["hauler.maxCount"]).toBeDefined();
    expect(room.pendingValidation["hauler.maxCount"].expectedDirection).toBe("improve");
    expect(room.frozenParams["harvester.maxCount"]).toBeDefined();
    expect(room.frozenParams["harvester.maxCount"].rollbackCount).toBe(3);
  });

  it("pendingValidation 为非对象 → 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          rooms: {
            W1N1: { roleBounds: {}, lastAdjusted: {}, pendingValidation: "bad" },
          },
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.tuning.rooms.W1N1.pendingValidation).toBeUndefined();
  });

  it("pendingValidation 条目缺关键字段（adjustTick 非数字）→ 删除该条目", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          rooms: {
            W1N1: {
              roleBounds: {},
              lastAdjusted: {},
              pendingValidation: {
                "hauler.maxCount": {
                  preAdjustSignals: {},
                  expectedDirection: "improve",
                  adjustDirection: "up",
                  adjustTick: "not-a-number", // 非法
                  preAdjustValue: 6,
                },
              },
            },
          },
        },
      },
    };

    runMigrations();

    const pv = (globalThis as any).Memory.kernel.tuning.rooms.W1N1.pendingValidation;
    expect(pv).toBeUndefined();
  });

  it("pendingValidation 条目缺 preAdjustValue → 删除该条目", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          rooms: {
            W1N1: {
              roleBounds: {},
              lastAdjusted: {},
              pendingValidation: {
                "hauler.maxCount": {
                  preAdjustSignals: {},
                  expectedDirection: "improve",
                  adjustDirection: "up",
                  adjustTick: 1000,
                  // preAdjustValue 缺失
                },
              },
            },
          },
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.tuning.rooms.W1N1.pendingValidation).toBeUndefined();
  });

  it("pendingValidation 条目 expectedDirection 非法枚举 → 删除该条目", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          rooms: {
            W1N1: {
              roleBounds: {},
              lastAdjusted: {},
              pendingValidation: {
                "hauler.maxCount": {
                  preAdjustSignals: {},
                  expectedDirection: "unknown", // 非法
                  adjustDirection: "up",
                  adjustTick: 1000,
                  preAdjustValue: 6,
                },
              },
            },
          },
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.tuning.rooms.W1N1.pendingValidation).toBeUndefined();
  });

  it("pendingValidation 条目 adjustDirection 非法枚举 → 删除该条目", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          rooms: {
            W1N1: {
              roleBounds: {},
              lastAdjusted: {},
              pendingValidation: {
                "hauler.maxCount": {
                  preAdjustSignals: {},
                  expectedDirection: "improve",
                  adjustDirection: "sideways", // 非法
                  adjustTick: 1000,
                  preAdjustValue: 6,
                },
              },
            },
          },
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.tuning.rooms.W1N1.pendingValidation).toBeUndefined();
  });

  it("frozenParams 为非对象 → 删除整个字段", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          rooms: {
            W1N1: { roleBounds: {}, lastAdjusted: {}, frozenParams: 123 },
          },
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.tuning.rooms.W1N1.frozenParams).toBeUndefined();
  });

  it("frozenParams 条目缺 frozenAt → 删除该条目", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          rooms: {
            W1N1: {
              roleBounds: {},
              lastAdjusted: {},
              frozenParams: {
                "hauler.maxCount": {
                  // frozenAt 缺失
                  frozenUntil: 10500,
                  reason: "",
                  rollbackCount: 3,
                },
              },
            },
          },
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.tuning.rooms.W1N1.frozenParams).toBeUndefined();
  });

  it("frozenParams 条目 rollbackCount 非数字 → 删除该条目", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          rooms: {
            W1N1: {
              roleBounds: {},
              lastAdjusted: {},
              frozenParams: {
                "hauler.maxCount": {
                  frozenAt: 500,
                  frozenUntil: 10500,
                  reason: "test",
                  rollbackCount: "three", // 非法
                },
              },
            },
          },
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.tuning.rooms.W1N1.frozenParams).toBeUndefined();
  });

  it("空 pendingValidation 对象被回收（控体积）", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          rooms: {
            W1N1: {
              roleBounds: {},
              lastAdjusted: {},
              pendingValidation: {
                "hauler.maxCount": { adjustTick: "bad" }, // 非法 → 删除后空 → 回收
              },
            },
          },
        },
      },
    };

    runMigrations();

    expect((globalThis as any).Memory.kernel.tuning.rooms.W1N1.pendingValidation).toBeUndefined();
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 19,
      creeps: {},
      rooms: {},
      kernel: {
        tuning: {
          rooms: {
            W1N1: {
              roleBounds: { hauler: { maxCount: 7 } },
              lastAdjusted: {},
              pendingValidation: {
                "hauler.maxCount": {
                  preAdjustSignals: { containerFillRatio: 0.8 },
                  expectedDirection: "improve",
                  adjustDirection: "up",
                  adjustTick: 1000,
                  preAdjustValue: 6,
                },
              },
              frozenParams: {
                "harvester.maxCount": {
                  frozenAt: 500,
                  frozenUntil: 10500,
                  reason: "test",
                  rollbackCount: 3,
                },
              },
            },
          },
        },
      },
    };

    runMigrations();
    runMigrations();
    runMigrations();

    const room = (globalThis as any).Memory.kernel.tuning.rooms.W1N1;
    expect(room.pendingValidation["hauler.maxCount"].preAdjustValue).toBe(6);
    expect(room.frozenParams["harvester.maxCount"].rollbackCount).toBe(3);
  });

  it("已是当前版本的新 Memory → 跳过迁移", () => {
    (globalThis as any).Memory = {
      schemaVersion: CONFIG.memory.schemaVersion,
      creeps: {},
      rooms: {},
      kernel: { tuning: { rooms: { W1N1: { roleBounds: {}, lastAdjusted: {} } } } },
    };

    runMigrations();

    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    // 未被迁移改动
    expect((globalThis as any).Memory.kernel.tuning.rooms.W1N1.roleBounds).toEqual({});
  });
});
