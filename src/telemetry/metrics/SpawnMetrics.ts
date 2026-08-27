/** Spawn Metrics — 孵化系统指标（1.md §12）。 */

import { registerMetricGauge, registerMetricCounter } from "../Telemetry";
import { setGauge, incrementCounter } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";

let registered = false;

export function registerSpawnMetrics(): void {
  if (registered) return;
  registered = true;

  registerMetricGauge("spawn", "count", "Total spawn structures", []);
  registerMetricGauge("spawn", "busy", "Busy spawns count", []);
  registerMetricGauge("spawn", "idle", "Idle spawns count", []);
  registerMetricGauge("spawn", "queue_length", "Spawn queue length", []);
  registerMetricCounter("spawn", "requests", "Total spawn requests", ["role"], "total");
  registerMetricCounter("spawn", "requests_completed", "Total spawn completions", ["role"], "total");
  registerMetricCounter("spawn", "requests_failed", "Total spawn failures", ["role", "reason"], "total");
  registerMetricGauge("spawn", "request_wait", "Average spawn request wait time in seconds", [], "seconds");
  registerMetricGauge("spawn", "demand", "Spawn demand count", ["role"]);
  registerMetricGauge("spawn", "supply", "Spawn supply count", ["role"]);
  registerMetricGauge("spawn", "deficit", "Spawn deficit count", ["role"]);
}

/** 采集 Spawn Metrics。每 5 tick 调用。 */
export function collectSpawnMetrics(): void {
  if (!shouldCollect("spawn")) return;
  markCollected("spawn");

  try {
    const spawns = Object.values(Game.spawns);
    const busy = spawns.filter(s => s.spawning).length;
    const idle = spawns.length - busy;

    setGauge("screeps_spawn_count", spawns.length);
    setGauge("screeps_spawn_busy", busy);
    setGauge("screeps_spawn_idle", idle);

    // Queue length from Memory
    let queueLen = 0;
    const roleCounts: Record<string, number> = {};
    for (const roomMem of Object.values(Memory.rooms)) {
      if (roomMem?.spawnQueue) {
        queueLen += roomMem.spawnQueue.length;
        for (const req of roomMem.spawnQueue) {
          const role = req.role ?? "unknown";
          roleCounts[role] = (roleCounts[role] ?? 0) + 1;
        }
      }
    }
    setGauge("screeps_spawn_queue_length", queueLen);

    for (const [role, count] of Object.entries(roleCounts)) {
      setGauge("screeps_spawn_demand", count, { role });
    }
  } catch {
    // Telemetry 失败不得影响 AI
  }
}
