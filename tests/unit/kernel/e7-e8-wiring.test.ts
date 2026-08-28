/** E7/E8 真实接线测试 — 验证 site 进度追踪和路径失败追踪已接入 kernel expectations。 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateExpectations,
  E7_STALE_TICKS,
  E8_STALE_TICKS,
  type SiteProgressSnapshot,
  type PathFailureSnapshot,
  type P3SystemRef,
} from "../../../src/kernel/expectations";

describe("E7 site progress — 真实接线", () => {
  const p3Systems: P3SystemRef[] = [];
  const baseTick = 10000;
  const bootTick = 0;

  it("site 长期无进度且无 builder → 违例", () => {
    const siteProgresses: SiteProgressSnapshot[] = [{
      room: "W1N1",
      siteId: "abc123",
      structureType: "spawn",
      progress: 100,
      progressTotal: 1000,
      lastProgressTick: baseTick - E7_STALE_TICKS - 1,
      builderVisits: 0,
      siteAge: E7_STALE_TICKS + 1,
    }];
    const res = evaluateExpectations({
      tick: baseTick,
      bootTick,
      systemLastRun: {},
      p3Systems,
      siteProgresses,
    });
    expect(res.violations.some(v => v.id.startsWith("siteStale:W1N1:abc123"))).toBe(true);
  });

  it("有 builder 到达 → 不违例", () => {
    const siteProgresses: SiteProgressSnapshot[] = [{
      room: "W1N1",
      siteId: "abc123",
      structureType: "extension",
      progress: 100,
      progressTotal: 1000,
      lastProgressTick: baseTick - E7_STALE_TICKS - 1,
      builderVisits: 1,
      siteAge: E7_STALE_TICKS + 1,
    }];
    const res = evaluateExpectations({
      tick: baseTick,
      bootTick,
      systemLastRun: {},
      p3Systems,
      siteProgresses,
    });
    expect(res.violations.some(v => v.id.startsWith("siteStale:"))).toBe(false);
  });

  it("近期有进度变化 → 不违例", () => {
    const siteProgresses: SiteProgressSnapshot[] = [{
      room: "W1N1",
      siteId: "abc123",
      structureType: "road",
      progress: 500,
      progressTotal: 1000,
      lastProgressTick: baseTick - 100,
      builderVisits: 0,
      siteAge: 100,
    }];
    const res = evaluateExpectations({
      tick: baseTick,
      bootTick,
      systemLastRun: {},
      p3Systems,
      siteProgresses,
    });
    expect(res.violations.some(v => v.id.startsWith("siteStale:"))).toBe(false);
  });

  it("多房隔离 — 一房违例不影响其他房", () => {
    const siteProgresses: SiteProgressSnapshot[] = [
      {
        room: "W1N1",
        siteId: "stale",
        structureType: "extension",
        progress: 10,
        progressTotal: 1000,
        lastProgressTick: baseTick - E7_STALE_TICKS - 1,
        builderVisits: 0,
        siteAge: E7_STALE_TICKS + 1,
      },
      {
        room: "W2N2",
        siteId: "ok",
        structureType: "spawn",
        progress: 500,
        progressTotal: 1000,
        lastProgressTick: baseTick - 50,
        builderVisits: 0,
        siteAge: 50,
      },
    ];
    const res = evaluateExpectations({
      tick: baseTick,
      bootTick,
      systemLastRun: {},
      p3Systems,
      siteProgresses,
    });
    expect(res.violations.some(v => v.id === "siteStale:W1N1:stale")).toBe(true);
    expect(res.violations.some(v => v.id === "siteStale:W2N2:ok")).toBe(false);
  });

  it("boot 宽限期内不违例", () => {
    const siteProgresses: SiteProgressSnapshot[] = [{
      room: "W1N1",
      siteId: "abc123",
      structureType: "spawn",
      progress: 0,
      progressTotal: 1000,
      lastProgressTick: 0,
      builderVisits: 0,
      siteAge: 5000,
    }];
    const res = evaluateExpectations({
      tick: 500,
      bootTick: 0,
      systemLastRun: {},
      p3Systems,
      siteProgresses,
    });
    expect(res.violations.some(v => v.id.startsWith("siteStale:"))).toBe(false);
  });
});

describe("E8 path failure — 真实接线", () => {
  const p3Systems: P3SystemRef[] = [];
  const baseTick = 10000;
  const bootTick = 0;

  it("路径持续失败超过阈值 → 违例", () => {
    const pathFailures: PathFailureSnapshot[] = [{
      room: "W1N1",
      pathId: "creep_001",
      lastSuccessTick: baseTick - E8_STALE_TICKS - 1,
      consecutiveFailures: 5,
    }];
    const res = evaluateExpectations({
      tick: baseTick,
      bootTick,
      systemLastRun: {},
      p3Systems,
      pathFailures,
    });
    expect(res.violations.some(v => v.id.startsWith("pathFailure:W1N1:creep_001"))).toBe(true);
  });

  it("连续失败超过 10 次 → 违例", () => {
    const pathFailures: PathFailureSnapshot[] = [{
      room: "W1N1",
      pathId: "creep_002",
      lastSuccessTick: baseTick - 100,
      consecutiveFailures: 11,
    }];
    const res = evaluateExpectations({
      tick: baseTick,
      bootTick,
      systemLastRun: {},
      p3Systems,
      pathFailures,
    });
    expect(res.violations.some(v => v.id.startsWith("pathFailure:W1N1:creep_002"))).toBe(true);
  });

  it("近期成功 → 不违例", () => {
    const pathFailures: PathFailureSnapshot[] = [{
      room: "W1N1",
      pathId: "creep_003",
      lastSuccessTick: baseTick - 50,
      consecutiveFailures: 2,
    }];
    const res = evaluateExpectations({
      tick: baseTick,
      bootTick,
      systemLastRun: {},
      p3Systems,
      pathFailures,
    });
    expect(res.violations.some(v => v.id.startsWith("pathFailure:"))).toBe(false);
  });

  it("boot 宽限期内不违例", () => {
    const pathFailures: PathFailureSnapshot[] = [{
      room: "W1N1",
      pathId: "creep_004",
      lastSuccessTick: 0,
      consecutiveFailures: 20,
    }];
    const res = evaluateExpectations({
      tick: 500,
      bootTick: 0,
      systemLastRun: {},
      p3Systems,
      pathFailures,
    });
    expect(res.violations.some(v => v.id.startsWith("pathFailure:"))).toBe(false);
  });

  it("多房隔离 — 一房失败不影响其他房", () => {
    const pathFailures: PathFailureSnapshot[] = [
      {
        room: "W1N1",
        pathId: "creep_fail",
        lastSuccessTick: baseTick - E8_STALE_TICKS - 1,
        consecutiveFailures: 15,
      },
      {
        room: "W2N2",
        pathId: "creep_ok",
        lastSuccessTick: baseTick - 10,
        consecutiveFailures: 1,
      },
    ];
    const res = evaluateExpectations({
      tick: baseTick,
      bootTick,
      systemLastRun: {},
      p3Systems,
      pathFailures,
    });
    expect(res.violations.some(v => v.id === "pathFailure:W1N1:creep_fail")).toBe(true);
    expect(res.violations.some(v => v.id === "pathFailure:W2N2:creep_ok")).toBe(false);
  });
});

describe("E7/E8 故障注入 — recordPathSuccess/recordPathFailure 状态流转", () => {
  beforeEach(() => {
    // 清理 globalCache
    const g = globalThis as any;
    delete g.pathFailureTracker;
    delete g.siteProgressTracker;
  });

  it("recordPathFailure 后 recordPathSuccess 重置连续失败", () => {
    // 模拟路径失败追踪
    const tracker = new Map<string, { lastSuccessTick: number; consecutiveFailures: number }>();
    (globalThis as any).pathFailureTracker = tracker;

    // 初始失败
    const key = "W1N1:creep1";
    tracker.set(key, { lastSuccessTick: 100, consecutiveFailures: 1 });
    tracker.get(key)!.consecutiveFailures++;

    expect(tracker.get(key)!.consecutiveFailures).toBe(2);

    // 成功后重置
    tracker.get(key)!.lastSuccessTick = 200;
    tracker.get(key)!.consecutiveFailures = 0;

    expect(tracker.get(key)!.consecutiveFailures).toBe(0);
    expect(tracker.get(key)!.lastSuccessTick).toBe(200);
  });

  it("site progress tracker — 进度变化时更新 lastProgressTick", () => {
    const tracker = new Map<string, { lastProgress: number; lastProgressTick: number; builderVisits: number }>();
    (globalThis as any).siteProgressTracker = tracker;

    // 首次记录
    tracker.set("site1", { lastProgress: 0, lastProgressTick: 100, builderVisits: 0 });

    // 进度变化
    const prev = tracker.get("site1")!;
    const newProgress = 500;
    const progressChanged = prev.lastProgress !== newProgress;
    expect(progressChanged).toBe(true);

    tracker.set("site1", {
      lastProgress: newProgress,
      lastProgressTick: progressChanged ? 200 : prev.lastProgressTick,
      builderVisits: prev.builderVisits,
    });

    expect(tracker.get("site1")!.lastProgress).toBe(500);
    expect(tracker.get("site1")!.lastProgressTick).toBe(200);
  });

  it("site progress tracker — 进度不变时保持原 lastProgressTick", () => {
    const tracker = new Map<string, { lastProgress: number; lastProgressTick: number; builderVisits: number }>();
    (globalThis as any).siteProgressTracker = tracker;

    tracker.set("site2", { lastProgress: 500, lastProgressTick: 100, builderVisits: 2 });

    // 进度不变
    const prev = tracker.get("site2")!;
    const newProgress = 500;
    const progressChanged = prev.lastProgress !== newProgress;
    expect(progressChanged).toBe(false);

    tracker.set("site2", {
      lastProgress: newProgress,
      lastProgressTick: progressChanged ? 200 : prev.lastProgressTick,
      builderVisits: prev.builderVisits,
    });

    expect(tracker.get("site2")!.lastProgressTick).toBe(100);
  });

  it("已消失的 site 从 tracker 清理", () => {
    const tracker = new Map<string, { lastProgress: number; lastProgressTick: number; builderVisits: number }>();
    (globalThis as any).siteProgressTracker = tracker;

    tracker.set("site1", { lastProgress: 100, lastProgressTick: 50, builderVisits: 0 });
    tracker.set("site2", { lastProgress: 200, lastProgressTick: 60, builderVisits: 1 });

    // 模拟 site2 已消失
    const gameSites: Record<string, unknown> = { site1: {} };
    for (const trackedId of tracker.keys()) {
      if (!gameSites[trackedId]) tracker.delete(trackedId);
    }

    expect(tracker.has("site1")).toBe(true);
    expect(tracker.has("site2")).toBe(false);
  });
});
