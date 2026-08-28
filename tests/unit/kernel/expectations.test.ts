/** 期望自检回归测试 — */
import { describe, expect, it } from "vitest";
import {
  evaluateExpectations,
  TELEMETRY_STALE_TICKS,
  P3_BOOT_GRACE_TICKS,
  E3_QUEUE_STALE_TICKS,
  E3_RECOVERY_TICKS,
  type SpawnQueueSnapshot,
  type E3ViolationRecord,
} from "../../../src/kernel/expectations";

const P3 = [{ name: "telemetry-collector", interval: 10 }];

describe("expectations — E1 遥测新鲜度", () => {
  it("lastSample 停摆超阈值 → telemetryStale 违例", () => {
    const r = evaluateExpectations({
      tick: 82414165,
      statsLastSample: 82414165 - TELEMETRY_STALE_TICKS - 1,
      systemLastRun: {},
      p3Systems: [],
    });
    expect(r.violations.some((v) => v.id === "telemetryStale")).toBe(true);
  });

  it("新鲜采样不违例", () => {
    const r = evaluateExpectations({
      tick: 82414165,
      statsLastSample: 82414160,
      systemLastRun: {},
      p3Systems: [],
    });
    expect(r.violations).toHaveLength(0);
  });
});

describe("expectations — E2 P3 存活", () => {
  it("boot 宽限期内从未运行不判饿（相对 bootTick）", () => {
    const r = evaluateExpectations({
      tick: P3_BOOT_GRACE_TICKS - 1,
      bootTick: 0,
      statsLastSample: undefined,
      systemLastRun: {},
      p3Systems: P3,
    });
    expect(r.p3Starved).toBe(false);
  });

  it("reset 后 200 tick（绝对 tick 巨大）不误报 —— W38S59 夜间误报回归", () => {
    const r = evaluateExpectations({
      tick: 82414200,
      bootTick: 82414000,
      statsLastSample: undefined,
      systemLastRun: {},
      p3Systems: [
        { name: "terminal-manager", interval: 200 },
        { name: "expansion-manager", interval: 20 },
        { name: "tuning-engine", interval: 500 },
      ],
    });
    // E1（遥测未流）可合理触发；本回归锁定的是 E2 不把 post-reset 待跑误判为饥饿
    expect(r.p3Starved).toBe(false);
    expect(r.violations.some((v) => v.id.startsWith("p3Starved:"))).toBe(false);
  });

  it("宽限期后仍未见执行 → p3Starved（含从未运行）", () => {
    const r = evaluateExpectations({
      tick: 100000,
      statsLastSample: 99990,
      systemLastRun: {},
      p3Systems: P3,
    });
    expect(r.p3Starved).toBe(true);
    expect(r.violations.some((v) => v.id === "p3Starved:telemetry-collector")).toBe(true);
  });

  it("interval×GRACE 内跑过 → 健康", () => {
    const tick = 100000;
    const r = evaluateExpectations({
      tick,
      statsLastSample: tick - 5,
      systemLastRun: { "telemetry-collector": tick - 25 },
      p3Systems: P3,
    });
    expect(r.p3Starved).toBe(false);
    expect(r.violations).toHaveLength(0);
  });
});

describe("expectations — E3 spawn queue 持续非空", () => {
  const baseTick = P3_BOOT_GRACE_TICKS + 100;

  function makeQueue(room: string, oldestAge: number, opts?: Partial<SpawnQueueSnapshot>): SpawnQueueSnapshot {
    return {
      room,
      queueLength: opts?.queueLength ?? 1,
      oldestRequestTick: baseTick - oldestAge,
      oldestRequestKey: opts?.oldestRequestKey ?? "harvester:" + room,
      oldestPriority: opts?.oldestPriority ?? 1,
      oldestRole: opts?.oldestRole ?? "harvester",
      rcl: opts?.rcl ?? 4,
      energyAvailable: opts?.energyAvailable ?? 300,
      spawning: opts?.spawning ?? false,
      colonyState: opts?.colonyState ?? "normal",
    };
  }

  it("boot 宽限期内不检查 E3", () => {
    const r = evaluateExpectations({
      tick: P3_BOOT_GRACE_TICKS - 1,
      bootTick: 0,
      statsLastSample: 1,
      systemLastRun: {},
      p3Systems: [],
      spawnQueues: [makeQueue("W1N1", E3_QUEUE_STALE_TICKS + 100)],
      e3Prev: {},
    });
    expect(r.violations.some((v) => v.id.startsWith("spawnQueueStale:"))).toBe(false);
  });

  it("队列空 → 不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      spawnQueues: [{ room: "W1N1", queueLength: 0, spawning: false }],
      e3Prev: {},
    });
    expect(r.violations.some((v) => v.id.startsWith("spawnQueueStale:"))).toBe(false);
  });

  it("队首年轻 → 不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      spawnQueues: [makeQueue("W1N1", 100)],
      e3Prev: {},
    });
    expect(r.violations.some((v) => v.id.startsWith("spawnQueueStale:"))).toBe(false);
  });

  it("队首超期 → 违例 + 记录创建", () => {
    const e3Prev: Record<string, E3ViolationRecord> = {};
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      spawnQueues: [makeQueue("W1N1", E3_QUEUE_STALE_TICKS + 1)],
      e3Prev,
    });
    expect(r.violations.some((v) => v.id === "spawnQueueStale:W1N1")).toBe(true);
    expect(e3Prev["W1N1"]).toBeDefined();
    expect(e3Prev["W1N1"]!.violationStartTick).toBe(baseTick);
  });

  it("recovery colonyState → 不违例（正常排队）", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      spawnQueues: [makeQueue("W1N1", E3_QUEUE_STALE_TICKS + 1, { colonyState: "recovery" })],
      e3Prev: {},
    });
    expect(r.violations.some((v) => v.id.startsWith("spawnQueueStale:"))).toBe(false);
  });

  it("bootstrap colonyState → 不违例（正常排队）", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      spawnQueues: [makeQueue("W1N1", E3_QUEUE_STALE_TICKS + 1, { colonyState: "bootstrap" })],
      e3Prev: {},
    });
    expect(r.violations.some((v) => v.id.startsWith("spawnQueueStale:"))).toBe(false);
  });

  it("已有违例 + 队列清空 → 滞回恢复", () => {
    const e3Prev: Record<string, E3ViolationRecord> = {
      W1N1: {
        room: "W1N1",
        queueLength: 3,
        violationStartTick: baseTick - 3000,
        lastRecordedTick: baseTick - 100,
        recoveryTick: 0,
        emptyStreak: 0,
        spawning: false,
      },
    };
    // 连续空队列 E3_RECOVERY_TICKS 次
    let tick = baseTick;
    for (let i = 0; i < E3_RECOVERY_TICKS; i++) {
      tick++;
      evaluateExpectations({
        tick,
        bootTick: 0,
        statsLastSample: tick - 5,
        systemLastRun: {},
        p3Systems: [],
        spawnQueues: [{ room: "W1N1", queueLength: 0, spawning: false }],
        e3Prev,
      });
    }
    expect(e3Prev["W1N1"]!.recoveryTick).toBe(tick);
  });

  it("已有违例 + 队列清空但未达恢复阈值 → 不恢复", () => {
    const e3Prev: Record<string, E3ViolationRecord> = {
      W1N1: {
        room: "W1N1",
        queueLength: 3,
        violationStartTick: baseTick - 3000,
        lastRecordedTick: baseTick - 100,
        recoveryTick: 0,
        emptyStreak: 0,
        spawning: false,
      },
    };
    let tick = baseTick;
    for (let i = 0; i < E3_RECOVERY_TICKS - 1; i++) {
      tick++;
      evaluateExpectations({
        tick,
        bootTick: 0,
        statsLastSample: tick - 5,
        systemLastRun: {},
        p3Systems: [],
        spawnQueues: [{ room: "W1N1", queueLength: 0, spawning: false }],
        e3Prev,
      });
    }
    expect(e3Prev["W1N1"]!.recoveryTick).toBe(0);
  });

  it("多房隔离 — W1N1 违例不影响 W2N2", () => {
    const e3Prev: Record<string, E3ViolationRecord> = {};
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      spawnQueues: [
        makeQueue("W1N1", E3_QUEUE_STALE_TICKS + 1),
        makeQueue("W2N2", 100),
      ],
      e3Prev,
    });
    expect(r.violations.some((v) => v.id === "spawnQueueStale:W1N1")).toBe(true);
    expect(r.violations.some((v) => v.id === "spawnQueueStale:W2N2")).toBe(false);
    expect(e3Prev["W1N1"]).toBeDefined();
    expect(e3Prev["W2N2"]).toBeUndefined();
  });

  it("违例记录限流 — 不每 tick 写入", () => {
    const e3Prev: Record<string, E3ViolationRecord> = {
      W1N1: {
        room: "W1N1",
        queueLength: 2,
        violationStartTick: baseTick - 3000,
        lastRecordedTick: baseTick - 50,
        recoveryTick: 0,
        emptyStreak: 0,
        spawning: false,
      },
    };
    const beforeLen = JSON.stringify(e3Prev["W1N1"]).length;
    evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      spawnQueues: [makeQueue("W1N1", E3_QUEUE_STALE_TICKS + 1)],
      e3Prev,
    });
    // lastRecordedTick 不应更新（距上次记录仅 50 tick < E3_RECORD_INTERVAL=100）
    expect(e3Prev["W1N1"]!.lastRecordedTick).toBe(baseTick - 50);
  });

  it("恢复后 1000 tick 清理记录", () => {
    const e3Prev: Record<string, E3ViolationRecord> = {
      W1N1: {
        room: "W1N1",
        queueLength: 0,
        violationStartTick: baseTick - 5000,
        lastRecordedTick: baseTick - 4900,
        recoveryTick: baseTick - 1001,
        emptyStreak: E3_RECOVERY_TICKS,
        spawning: false,
      },
    };
    evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      spawnQueues: [{ room: "W1N1", queueLength: 0, spawning: false }],
      e3Prev,
    });
    expect(e3Prev["W1N1"]).toBeUndefined();
  });

  it("违例包含诊断字段（room/role/priority/rcl/energy）", () => {
    const e3Prev: Record<string, E3ViolationRecord> = {};
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      spawnQueues: [makeQueue("W7N7", E3_QUEUE_STALE_TICKS + 1, {
        oldestRole: "upgrader",
        oldestPriority: 2,
        rcl: 5,
        energyAvailable: 1300,
      })],
      e3Prev,
    });
    const v = r.violations.find((v) => v.id === "spawnQueueStale:W7N7");
    expect(v).toBeDefined();
    expect(v!.detail).toContain("role=upgrader");
    expect(v!.detail).toContain("pri=2");
  });
});
