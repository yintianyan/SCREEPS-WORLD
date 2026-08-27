import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock globalCache ──────────────────────────────────────

const mockGlobal: Record<string, unknown> = {};

vi.mock("../../../src/kernel/global-cache", () => ({
  globalCache: () => mockGlobal,
}));

// ── Mock Game ─────────────────────────────────────────────

let mockCpuUsed = 0.5;
let mockBucket = 5000;
let mockGameTime = 1000;

vi.stubGlobal("Game", {
  time: 1000,
  cpu: {
    getUsed: () => mockCpuUsed,
    bucket: mockBucket,
    limit: 20,
  },
  rooms: {},
  creeps: {},
  spawns: {},
  gcl: { level: 3 },
  gpl: { level: 1 },
});

vi.stubGlobal("RawMemory", {
  get: () => '{"test":"data"}',
});

// ── Import after mocks ────────────────────────────────────

import {
  registerCounter as registerMetricCounter,
  registerGauge as registerMetricGauge,
  registerHistogram as registerMetricHistogram,
  incrementCounter,
  setGauge,
  observeHistogram,
  startTimer,
  snapshotMetrics,
  resetCounters,
  metricCount,
} from "../../../src/telemetry/MetricRegistry";

import {
  recordEvent,
  drainEvents,
  shouldFlushEvents,
  eventBufferSize,
  totalEventsFlushed,
  TELEMETRY_EVENT_TYPES,
} from "../../../src/telemetry/EventRegistry";

import {
  recordDecision,
  drainDecisions,
  shouldFlushDecisions,
  decisionBufferSize,
  totalDecisionsFlushed,
  recordOutcome,
  drainOutcomes,
} from "../../../src/telemetry/DecisionRegistry";

import {
  shouldCollect,
  markCollected,
  aggregateTick,
  resetFrequencyState,
} from "../../../src/telemetry/TickAggregator";

import {
  flush,
  shouldFlush,
  bufferStatus,
  collectFlushPackage,
} from "../../../src/telemetry/TelemetryBuffer";

import { runFlush, initTelemetryFlush } from "../../../src/telemetry/TelemetryFlush";

import {
  counter,
  gauge,
  timer,
  event,
  decision,
  outcome,
  registeredMetricCount,
  buildMetricName,
} from "../../../src/telemetry/Telemetry";

import { exportConsoleLine } from "../../../src/telemetry/exporters/ConsoleExporter";
import { exportPrometheusText } from "../../../src/telemetry/exporters/PrometheusExporter";

// ── Tests ─────────────────────────────────────────────────

beforeEach(() => {
  // Clean all global state
  for (const key of Object.keys(mockGlobal)) {
    delete mockGlobal[key];
  }
  mockCpuUsed = 0.5;
  mockBucket = 5000;
  mockGameTime = 1000;
  (Game as any).time = mockGameTime;
  (Game as any).cpu.bucket = mockBucket;
});

describe("Telemetry SDK — MetricRegistry", () => {
  it("should register and increment a counter", () => {
    registerMetricCounter("runtime", "tick_total", "Total ticks", [], "total");
    expect(metricCount()).toBeGreaterThan(0);

    incrementCounter("screeps_runtime_tick_total_total", 1);
    incrementCounter("screeps_runtime_tick_total_total", 2);

    const snap = snapshotMetrics();
    const found = snap.find(m => m.name === "screeps_runtime_tick_total_total");
    expect(found).toBeDefined();
    expect(found!.kind).toBe("counter");
    expect(found!.entries).toHaveLength(1);
    expect(found!.entries[0]!.value).toBe(3);
  });

  it("should register and set a gauge", () => {
    registerMetricGauge("runtime", "cpu_used", "CPU used", [], "");
    setGauge("screeps_runtime_cpu_used", 1.23);
    setGauge("screeps_runtime_cpu_used", 2.46); // overwrite

    const snap = snapshotMetrics();
    const found = snap.find(m => m.name === "screeps_runtime_cpu_used");
    expect(found).toBeDefined();
    expect(found!.kind).toBe("gauge");
    expect(found!.entries[0]!.value).toBe(2.46);
  });

  it("should register and observe a histogram", () => {
    registerMetricHistogram("kernel", "process_execution", "Process time", ["process_type"], undefined, "seconds");
    observeHistogram("screeps_kernel_process_execution_seconds", 0.001, { process_type: "economy" });
    observeHistogram("screeps_kernel_process_execution_seconds", 0.05, { process_type: "economy" });
    observeHistogram("screeps_kernel_process_execution_seconds", 0.3, { process_type: "economy" });

    const snap = snapshotMetrics();
    const found = snap.find(m => m.name === "screeps_kernel_process_execution_seconds");
    expect(found).toBeDefined();
    expect(found!.kind).toBe("histogram");
    expect(found!.histogramEntries).toBeDefined();
    expect(found!.histogramEntries!.length).toBeGreaterThan(0);
    const histEntry = found!.histogramEntries![0]!;
    expect(histEntry.count).toBe(3);
    expect(histEntry.sum).toBeCloseTo(0.351, 3);
  });

  it("should handle label sets", () => {
    registerMetricGauge("room", "energy_available", "Room energy", ["room"]);
    setGauge("screeps_room_energy_available", 300, { room: "W1N1" });
    setGauge("screeps_room_energy_available", 500, { room: "W2N2" });

    const snap = snapshotMetrics();
    const found = snap.find(m => m.name === "screeps_room_energy_available");
    expect(found).toBeDefined();
    expect(found!.entries).toHaveLength(2);
    const w1n1 = found!.entries.find(e => e.labels.room === "W1N1");
    expect(w1n1!.value).toBe(300);
  });

  it("should reset counters after flush", () => {
    registerMetricCounter("runtime", "errors", "Error count", [], "total");
    incrementCounter("screeps_runtime_errors_total", 5);
    resetCounters();
    incrementCounter("screeps_runtime_errors_total", 1);

    const snap = snapshotMetrics();
    const found = snap.find(m => m.name === "screeps_runtime_errors_total");
    expect(found!.entries[0]!.value).toBe(1); // reset then +1
  });

  it("should handle timer", () => {
    registerMetricHistogram("planning", "plan_generation", "Plan time", ["planner"], undefined, "seconds");
    const t = startTimer("screeps_planning_plan_generation_seconds", { planner: "empire" });
    mockCpuUsed += 0.1; // simulate CPU usage
    const elapsed = t.end();
    expect(elapsed).toBeGreaterThan(0);

    const snap = snapshotMetrics();
    const found = snap.find(m => m.name === "screeps_planning_plan_generation_seconds");
    expect(found).toBeDefined();
    expect(found!.histogramEntries!.length).toBeGreaterThan(0);
  });

  it("should silently skip unregistered metrics", () => {
    incrementCounter("screeps_nonexistent_metric", 1);
    setGauge("screeps_nonexistent_gauge", 42);
    observeHistogram("screeps_nonexistent_histogram", 0.1);
    // No error thrown — telemetry must never crash
  });
});

describe("Telemetry SDK — EventRegistry", () => {
  it("should record and drain events", () => {
    recordEvent("spawn.requested", { role: "harvester" }, "W1N1");
    recordEvent("spawn.completed", { role: "harvester" }, "W1N1");
    expect(eventBufferSize()).toBe(2);

    const events = drainEvents();
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("spawn.requested");
    expect(events[0]!.room).toBe("W1N1");
    expect(eventBufferSize()).toBe(0);
  });

  it("should track total flushed", () => {
    recordEvent("test.event", {});
    drainEvents();
    expect(totalEventsFlushed()).toBeGreaterThan(0);
  });

  it("should handle buffer overflow", () => {
    for (let i = 0; i < 300; i++) {
      recordEvent("overflow.test", { index: i });
    }
    // Should not crash, buffer capped
    expect(eventBufferSize()).toBeLessThanOrEqual(200);
  });

  it("should export event type constants", () => {
    expect(TELEMETRY_EVENT_TYPES.SPAWN_REQUESTED).toBe("spawn.requested");
    expect(TELEMETRY_EVENT_TYPES.CREEP_DIED).toBe("creep.died");
    expect(TELEMETRY_EVENT_TYPES.EXPANSION_STARTED).toBe("expansion.started");
  });
});

describe("Telemetry SDK — DecisionRegistry", () => {
  it("should record and drain decisions", () => {
    recordDecision("empire", "EXPAND", "energy_surplus", {
      target: "W9N3",
      confidence: 0.87,
    });
    expect(decisionBufferSize()).toBe(1);

    const decisions = drainDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.planner).toBe("empire");
    expect(decisions[0]!.decision).toBe("EXPAND");
    expect(decisions[0]!.reason).toBe("energy_surplus");
    expect(decisions[0]!.target).toBe("W9N3");
    expect(decisions[0]!.confidence).toBe(0.87);
  });

  it("should record outcomes", () => {
    recordOutcome(1000, "empire", "EXPAND", { duration: 1500 }, { duration: 2140 }, 42.6);
    const outcomes = drainOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.deviation).toBe(42.6);
  });

  it("should handle ring buffer overflow", () => {
    for (let i = 0; i < 200; i++) {
      recordDecision("test", `decision_${i}`, "reason");
    }
    expect(decisionBufferSize()).toBeLessThanOrEqual(100);
  });
});

describe("Telemetry SDK — TickAggregator", () => {
  beforeEach(() => {
    resetFrequencyState();
  });

  it("should allow every-tick collection", () => {
    expect(shouldCollect("cpu")).toBe(true);
    expect(shouldCollect("bucket")).toBe(true);
    expect(shouldCollect("kernel")).toBe(true);
    expect(shouldCollect("scheduler")).toBe(true);
  });

  it("should gate low-frequency domains", () => {
    // economy is every 10 ticks
    expect(shouldCollect("economy")).toBe(true); // first call, never collected

    markCollected("economy");
    expect(shouldCollect("economy")).toBe(false); // just collected, tick didn't advance

    // Advance time
    (Game as any).time = 1010;
    expect(shouldCollect("economy")).toBe(true);
  });

  it("should return false for event-driven domains", () => {
    expect(shouldCollect("planning")).toBe(false);
    expect(shouldCollect("expansion")).toBe(false);
    expect(shouldCollect("decision")).toBe(false);
  });

  it("should aggregate tick results", () => {
    (Game as any).time = 1000;
    const result = aggregateTick();
    expect(result.collected).toContain("cpu");
    expect(result.collected).toContain("economy"); // first time
  });
});

describe("Telemetry SDK — TelemetryBuffer & Flush", () => {
  it("should collect flush package", () => {
    registerMetricGauge("runtime", "test_metric", "Test", [], "");
    setGauge("screeps_runtime_test_metric", 42);

    const pkg = collectFlushPackage();
    expect(pkg.tick).toBe(Game.time);
    expect(pkg.metrics.length).toBeGreaterThan(0);
  });

  it("should reset counters on flush", () => {
    registerMetricCounter("runtime", "flush_test", "Flush test", [], "total");
    counter("runtime.flush_test.total", 3);
    expect(metricCount()).toBeGreaterThan(0);

    const pkg = flush();
    expect(pkg.metrics.length).toBeGreaterThan(0);

    // After flush, counters should be reset
    const snap = snapshotMetrics();
    const found = snap.find(m => m.name === "screeps_runtime_flush_test_total");
    if (found) {
      expect(found.entries.length).toBeGreaterThan(0);
      expect(found.entries[0]!.value).toBe(0);
    }
  });

  it("should skip flush in recovery tier", () => {
    initTelemetryFlush();
    const result = runFlush("recovery");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("tier=recovery");
  });

  it("should skip flush in conserve tier", () => {
    initTelemetryFlush();
    const result = runFlush("conserve");
    expect(result.skipped).toBe(true);
  });

  it("should track buffer status", () => {
    initTelemetryFlush();
    const status = bufferStatus();
    expect(status.flushCount).toBeDefined();
    expect(status.lastFlushCpu).toBeDefined();
  });
});

describe("Telemetry SDK — Facade API", () => {
  it("should provide counter() shorthand", () => {
    registerMetricCounter("spawn", "requests", "Spawn requests", ["role"], "total");
    counter("spawn.requests.total", 1, { role: "miner" });
    counter("spawn.requests.total", 2, { role: "hauler" });

    const snap = snapshotMetrics();
    const found = snap.find(m => m.name === "screeps_spawn_requests_total");
    expect(found).toBeDefined();
    expect(found!.entries.length).toBeGreaterThan(0);
    const miner = found!.entries.find(e => e.labels.role === "miner");
    expect(miner).toBeDefined();
    expect(miner!.value).toBe(1);
    const hauler = found!.entries.find(e => e.labels.role === "hauler");
    expect(hauler).toBeDefined();
    expect(hauler!.value).toBe(2);
  });

  it("should provide gauge() shorthand", () => {
    registerMetricGauge("economy", "energy_net", "Net energy", ["room"]);
    gauge("economy.energy.net", 3.2, { room: "W1N1" });

    const snap = snapshotMetrics();
    const found = snap.find(m => m.name === "screeps_economy_energy_net");
    expect(found).toBeDefined();
    expect(found!.entries.length).toBeGreaterThan(0);
    expect(found!.entries[0]!.value).toBe(3.2);
  });

  it("should provide timer() shorthand", () => {
    registerMetricHistogram("planning", "generation", "Plan time", ["planner"], undefined, "seconds");
    const t = timer("planning.generation.seconds", { planner: "empire" });
    mockCpuUsed += 0.05;
    const elapsed = t.end();
    expect(elapsed).toBeGreaterThanOrEqual(0);

    const snap = snapshotMetrics();
    const found = snap.find(m => m.name === "screeps_planning_generation_seconds");
    expect(found).toBeDefined();
  });

  it("should provide event() shorthand", () => {
    event("expansion.started", { room: "W9N3" });
    const events = drainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("expansion.started");
  });

  it("should provide decision() shorthand", () => {
    decision("empire", "EXPAND", "energy_surplus", { target: "W9N3", confidence: 0.87 });
    const decisions = drainDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decision).toBe("EXPAND");
  });

  it("should provide outcome() shorthand", () => {
    outcome(1000, "empire", "EXPAND", { ticks: 1500 }, { ticks: 2140 }, 42.6);
    const outcomes = drainOutcomes();
    expect(outcomes).toHaveLength(1);
  });

  it("should never throw on failure", () => {
    // Call before registering — should silently skip
    counter("nonexistent.metric", 1);
    gauge("nonexistent.gauge", 42);
    timer("nonexistent.timer").end();
    event("nonexistent.event", {});
    decision("test", "test", "test");
    // No error thrown
  });

  it("should build metric names correctly", () => {
    expect(buildMetricName("runtime", "cpu_used")).toBe("screeps_runtime_cpu_used");
    expect(buildMetricName("economy", "energy_net", "ratio")).toBe("screeps_economy_energy_net_ratio");
  });

  it("should track registered metric count", () => {
    const before = registeredMetricCount();
    registerMetricCounter("runtime", "count_check", "test", [], "total");
    const after = registeredMetricCount();
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe("Telemetry SDK — Exporters", () => {
  it("should export console line with @TELEMETRY prefix", () => {
    registerMetricGauge("runtime", "cpu_used", "CPU", [], "");
    setGauge("screeps_runtime_cpu_used", 0.72);

    const pkg = collectFlushPackage();
    const line = exportConsoleLine(pkg);
    expect(line).not.toBeNull();
    expect(line).toContain("@TELEMETRY");
  });

  it("should export null for empty package", () => {
    const pkg = { tick: 0, metrics: [], events: [], decisions: [], outcomes: [] };
    expect(exportConsoleLine(pkg as any)).toBeNull();
  });

  it("should export prometheus text format", () => {
    registerMetricGauge("runtime", "cpu_used", "CPU used this tick", [], "");
    setGauge("screeps_runtime_cpu_used", 0.72);

    registerMetricCounter("kernel", "process_failed", "Failed processes", ["process_type"], "total");
    incrementCounter("screeps_kernel_process_failed_total", 3, { process_type: "economy" });

    const pkg = collectFlushPackage();
    const text = exportPrometheusText(pkg);

    expect(text).toContain("# HELP screeps_runtime_cpu_used");
    expect(text).toContain("# TYPE screeps_runtime_cpu_used gauge");
    expect(text).toContain("screeps_runtime_cpu_used");
    expect(text).toContain("# TYPE screeps_kernel_process_failed_total counter");
    expect(text).toContain('process_type="economy"');
  });
});
