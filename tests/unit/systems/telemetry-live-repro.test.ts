/** 临时诊断（非长期回归）：用官服拉回的真实 segment 内容驱动采集器全链， */
import { describe, expect, it, beforeEach } from "vitest";
import fs from "fs";

function loadSeg(n: number): string {
  try {
    return fs.readFileSync("/tmp/s" + n + ".txt", "utf8");
  } catch {
    return "";
  }
}

describe("telemetry live repro — 真实官服 segment 数据", () => {
  beforeEach(() => {
    const g = globalThis as Record<string, unknown>;
    g.Game = {
      time: 82450000,
      cpu: { bucket: 10000, limit: 20, tickLimit: 500, getUsed: () => 3 },
      rooms: {},
      creeps: {},
      spawns: {},
      map: { describeExits: () => ({}) },
      gcl: { level: 2 },
      market: { credits: 100000, getAllOrders: () => [], deal: () => 0 },
    };
    g.Memory = {
      schemaVersion: 36,
      creeps: {},
      rooms: { W37S58: { colonyState: "normal", spawnQueue: [], buildQueue: [] } },
      kernel: { schemaVersion: 36, stats: {} },
    };
    g.RawMemory = {
      segments: { 0: loadSeg(0), 1: loadSeg(1), 2: loadSeg(2), 3: loadSeg(3) },
      activeSegments: [],
      setActiveSegments: () => undefined,
      get: () => "{}",
      set: () => undefined,
    };
    // 清 globalCache 字段
    for (const k of Object.keys(g)) {
      if (typeof k === "string" && (k.startsWith("__") || ["telemetry","errorLog","errorCounts","pluginCooldowns","eventBuffer","skipBuffer","assignment","roomTraffic","prevRoomTraffic"].includes(k))) delete g[k];
    }
  });

  it("requestSegments + collector.run 全链不抛错（真实数据）", async () => {
    const { requestSegments, flushSegments } = await import("../../../src/kernel/segment-store");
    const { telemetryCollectorSystem } = await import("../../../src/systems/telemetry-collector");
    requestSegments();
    const ctx: any = {
      tick: 82450000,
      budget: { tier: "healthy", softLimit: 17.5, hardLimit: 19.2, canStart: () => true, isExhausted: () => false, spent: () => 3 },
      globalSiteCount: 0,
      getSnapshot: () => undefined,
      snapshots: function* () { /* 空 */ },
    };
    let err: unknown;
    try {
      telemetryCollectorSystem.run(ctx);
      (globalThis as { Game: { time: number } }).Game.time += 50;
      (globalThis as any).Memory.kernel.stats = {};
      (globalThis as Record<string, unknown>).telemetry = undefined;
      const { initTelemetry } = await import("../../../src/kernel/telemetry");
      initTelemetry(82450050);
      telemetryCollectorSystem.run({ ...ctx, tick: 82450050 });
      flushSegments();
    } catch (e) {
      err = e;
    }
    console.log("REPRO err:", err instanceof Error ? err.stack : String(err));
    console.log("REPRO stats:", JSON.stringify((globalThis as any).Memory.kernel.stats).slice(0, 400));
    expect(err).toBeUndefined();
  });
});
