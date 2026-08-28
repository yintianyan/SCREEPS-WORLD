/** E4-E9 expectations 回归测试 */
import { describe, expect, it } from "vitest";
import {
  evaluateExpectations,
  P3_BOOT_GRACE_TICKS,
  E4_SAMPLE_INTERVAL,
  E4_GROWTH_THRESHOLD_PCT,
  E4_SLOPE_THRESHOLD,
  E5_STALE_TICKS,
  E6_STALE_TICKS,
  E7_STALE_TICKS,
  E8_STALE_TICKS,
  E9_STALE_TICKS,
  type MemorySizeSample,
  type RCLSnapshot,
  type BuildQueueSnapshot,
  type SiteProgressSnapshot,
  type PathFailureSnapshot,
  type RecoverySnapshot,
} from "../../../src/kernel/expectations";

const baseTick = P3_BOOT_GRACE_TICKS + 100;

describe("expectations — E4 Memory 增长检测", () => {
  it("boot 宽限期内不检查 E4", () => {
    const r = evaluateExpectations({
      tick: P3_BOOT_GRACE_TICKS - 1,
      bootTick: 0,
      statsLastSample: 1,
      systemLastRun: {},
      p3Systems: [],
      memoryHistory: [
        { tick: 0, bytes: 10000, roomCount: 1 },
        { tick: 500, bytes: 20000, roomCount: 1 },
      ],
    });
    expect(r.violations.some((v) => v.id.startsWith("memoryGrowth"))).toBe(false);
  });

  it("环比增长超阈值 → 违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      memoryHistory: [
        { tick: baseTick - 1000, bytes: 10000, roomCount: 1 },
        { tick: baseTick - 500, bytes: 10000, roomCount: 1 },
        { tick: baseTick, bytes: 20000, roomCount: 1 },
      ],
    });
    expect(r.violations.some((v) => v.id.startsWith("memoryGrowth"))).toBe(true);
  });

  it("房间数增长导致的合理增长不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      memoryHistory: [
        { tick: baseTick - 1000, bytes: 10000, roomCount: 1 },
        { tick: baseTick - 500, bytes: 10000, roomCount: 1 },
        { tick: baseTick, bytes: 20000, roomCount: 2 },
      ],
    });
    expect(r.violations.some((v) => v.id.startsWith("memoryGrowth"))).toBe(false);
  });

  it("线性增长斜率超阈值 → 违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      memoryHistory: [
        { tick: baseTick - 5000, bytes: 10000, roomCount: 1 },
        { tick: baseTick - 4500, bytes: 11000, roomCount: 1 },
        { tick: baseTick - 4000, bytes: 20000, roomCount: 1 },
      ],
    });
    expect(r.violations.some((v) => v.id === "memorySlope")).toBe(true);
  });

  it("稳定 Memory 不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      memoryHistory: [
        { tick: baseTick - 1000, bytes: 11000, roomCount: 1 },
        { tick: baseTick - 500, bytes: 11000, roomCount: 1 },
        { tick: baseTick, bytes: 11200, roomCount: 1 },
      ],
    });
    expect(r.violations.some((v) => v.id.startsWith("memory"))).toBe(false);
  });

  it("采样不足 3 个不检查斜率", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      memoryHistory: [
        { tick: baseTick - 500, bytes: 10000, roomCount: 1 },
        { tick: baseTick, bytes: 20000, roomCount: 1 },
      ],
    });
    // 环比增长可能触发，但斜率不应触发
    expect(r.violations.some((v) => v.id === "memorySlope")).toBe(false);
  });
});

describe("expectations — E5 RCL 长期不增长", () => {
  it("RCL 长期不增长 → 违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      rclSnapshots: [{
        room: "W1N1",
        rcl: 4,
        progress: 1000,
        progressTotal: 15000,
        lastRclChange: baseTick - E5_STALE_TICKS - 1,
        hasUpgrader: false,
        storageEnergy: 50000,
      }],
    });
    expect(r.violations.some((v) => v.id === "rclStale:W1N1")).toBe(true);
  });

  it("RCL8 满级不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      rclSnapshots: [{
        room: "W1N1",
        rcl: 8,
        progress: 0,
        progressTotal: 0,
        lastRclChange: baseTick - E5_STALE_TICKS - 1,
        hasUpgrader: false,
        storageEnergy: 50000,
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("rclStale"))).toBe(false);
  });

  it("RCL 正常增长不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      rclSnapshots: [{
        room: "W1N1",
        rcl: 4,
        progress: 1000,
        progressTotal: 15000,
        lastRclChange: baseTick - 1000,
        hasUpgrader: true,
        storageEnergy: 50000,
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("rclStale"))).toBe(false);
  });

  it("多房隔离", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      rclSnapshots: [
        { room: "W1N1", rcl: 4, progress: 0, progressTotal: 0, lastRclChange: baseTick - E5_STALE_TICKS - 1, hasUpgrader: false, storageEnergy: 0 },
        { room: "W2N2", rcl: 5, progress: 1000, progressTotal: 0, lastRclChange: baseTick - 100, hasUpgrader: true, storageEnergy: 0 },
      ],
    });
    expect(r.violations.some((v) => v.id === "rclStale:W1N1")).toBe(true);
    expect(r.violations.some((v) => v.id === "rclStale:W2N2")).toBe(false);
  });
});

describe("expectations — E6 buildQueue 持续非空", () => {
  it("buildQueue 队首超期 → 违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      buildQueues: [{
        room: "W1N1",
        queueLength: 3,
        oldestTaskTick: baseTick - E6_STALE_TICKS - 1,
        oldestTaskType: "spawn",
        rcl: 4,
        builderCount: 0,
        colonyState: "normal",
      }],
    });
    expect(r.violations.some((v) => v.id === "buildQueueStale:W1N1")).toBe(true);
  });

  it("recovery colonyState 豁免", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      buildQueues: [{
        room: "W1N1",
        queueLength: 3,
        oldestTaskTick: baseTick - E6_STALE_TICKS - 1,
        oldestTaskType: "spawn",
        rcl: 4,
        builderCount: 0,
        colonyState: "recovery",
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("buildQueueStale"))).toBe(false);
  });

  it("bootstrap colonyState 豁免", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      buildQueues: [{
        room: "W1N1",
        queueLength: 3,
        oldestTaskTick: baseTick - E6_STALE_TICKS - 1,
        oldestTaskType: "spawn",
        rcl: 4,
        builderCount: 0,
        colonyState: "bootstrap",
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("buildQueueStale"))).toBe(false);
  });

  it("队列年轻不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      buildQueues: [{
        room: "W1N1",
        queueLength: 3,
        oldestTaskTick: baseTick - 100,
        oldestTaskType: "spawn",
        rcl: 4,
        builderCount: 2,
        colonyState: "normal",
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("buildQueueStale"))).toBe(false);
  });

  it("空队列不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      buildQueues: [{
        room: "W1N1",
        queueLength: 0,
        builderCount: 0,
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("buildQueueStale"))).toBe(false);
  });
});

describe("expectations — E7 site 长期无进度", () => {
  it("site 无进度且无 builder → 违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      siteProgresses: [{
        room: "W1N1",
        siteId: "abc123",
        structureType: "spawn",
        progress: 1000,
        progressTotal: 5000,
        lastProgressTick: baseTick - E7_STALE_TICKS - 1,
        builderVisits: 0,
        siteAge: 3000,
      }],
    });
    expect(r.violations.some((v) => v.id === "siteStale:W1N1:abc123")).toBe(true);
  });

  it("有 builder 到达不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      siteProgresses: [{
        room: "W1N1",
        siteId: "abc123",
        structureType: "spawn",
        progress: 1000,
        progressTotal: 5000,
        lastProgressTick: baseTick - E7_STALE_TICKS - 1,
        builderVisits: 3,
        siteAge: 3000,
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("siteStale"))).toBe(false);
  });

  it("进度近期变化不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      siteProgresses: [{
        room: "W1N1",
        siteId: "abc123",
        structureType: "spawn",
        progress: 1000,
        progressTotal: 5000,
        lastProgressTick: baseTick - 100,
        builderVisits: 0,
        siteAge: 200,
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("siteStale"))).toBe(false);
  });
});

describe("expectations — E8 关键路径持续失败", () => {
  it("路径持续失败超阈值 → 违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      pathFailures: [{
        room: "W1N1",
        pathId: "source→container",
        lastSuccessTick: baseTick - E8_STALE_TICKS - 1,
        consecutiveFailures: 5,
      }],
    });
    expect(r.violations.some((v) => v.id === "pathFailure:W1N1:source→container")).toBe(true);
  });

  it("连续失败超 10 次 → 违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      pathFailures: [{
        room: "W1N1",
        pathId: "storage→spawn",
        lastSuccessTick: baseTick - 100,
        consecutiveFailures: 11,
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("pathFailure"))).toBe(true);
  });

  it("近期成功不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      pathFailures: [{
        room: "W1N1",
        pathId: "source→container",
        lastSuccessTick: baseTick - 100,
        consecutiveFailures: 2,
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("pathFailure"))).toBe(false);
  });
});

describe("expectations — E9 recovery 持续过久", () => {
  it("recovery 持续超阈值 → 违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      recoverySnapshots: [{
        room: "W1N1",
        colonyState: "recovery",
        recoveryStartTick: baseTick - E9_STALE_TICKS - 1,
        missingStructures: 1,
        missingRoles: 0,
        storageEnergy: 5000,
        spawnQueueLength: 2,
        buildQueueLength: 3,
      }],
    });
    expect(r.violations.some((v) => v.id === "recoveryStale:W1N1")).toBe(true);
  });

  it("normal colonyState 不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      recoverySnapshots: [{
        room: "W1N1",
        colonyState: "normal",
        recoveryStartTick: 0,
        missingStructures: 0,
        missingRoles: 0,
        storageEnergy: 50000,
        spawnQueueLength: 0,
        buildQueueLength: 0,
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("recoveryStale"))).toBe(false);
  });

  it("短时间 recovery 不违例", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      recoverySnapshots: [{
        room: "W1N1",
        colonyState: "recovery",
        recoveryStartTick: baseTick - 100,
        missingStructures: 1,
        missingRoles: 0,
        storageEnergy: 5000,
        spawnQueueLength: 2,
        buildQueueLength: 3,
      }],
    });
    expect(r.violations.some((v) => v.id.startsWith("recoveryStale"))).toBe(false);
  });

  it("多房隔离", () => {
    const r = evaluateExpectations({
      tick: baseTick,
      bootTick: 0,
      statsLastSample: baseTick - 5,
      systemLastRun: {},
      p3Systems: [],
      recoverySnapshots: [
        { room: "W1N1", colonyState: "recovery", recoveryStartTick: baseTick - E9_STALE_TICKS - 1, missingStructures: 1, missingRoles: 0, storageEnergy: 0, spawnQueueLength: 0, buildQueueLength: 0 },
        { room: "W2N2", colonyState: "recovery", recoveryStartTick: baseTick - 100, missingStructures: 1, missingRoles: 0, storageEnergy: 0, spawnQueueLength: 0, buildQueueLength: 0 },
      ],
    });
    expect(r.violations.some((v) => v.id === "recoveryStale:W1N1")).toBe(true);
    expect(r.violations.some((v) => v.id === "recoveryStale:W2N2")).toBe(false);
  });
});
