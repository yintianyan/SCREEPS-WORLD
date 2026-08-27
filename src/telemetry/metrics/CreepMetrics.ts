/** Creep Metrics — Creep 聚合指标（1.md §13）。 */

import { registerMetricGauge, registerMetricCounter, registerMetricHistogram } from "../Telemetry";
import { setGauge, incrementCounter, observeHistogram } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";

let registered = false;

export function registerCreepMetrics(): void {
  if (registered) return;
  registered = true;

  registerMetricGauge("creep", "alive", "Alive creep count", ["role"]);
  registerMetricCounter("creep", "spawned", "Total creeps spawned", ["role"], "total");
  registerMetricCounter("creep", "died", "Total creeps died", ["role"], "total");
  registerMetricHistogram("creep", "lifetime_ticks", "Creep lifetime in ticks", ["role"], undefined, "");
  registerMetricGauge("creep", "ttl", "Average ticks to live by role", ["role"]);
  registerMetricGauge("creep", "work_ratio", "Creep work time ratio", ["role"]);
  registerMetricGauge("creep", "idle_ratio", "Creep idle time ratio", ["role"]);
  registerMetricGauge("creep", "travel_ratio", "Creep travel time ratio", ["role"]);
  registerMetricGauge("creep", "productivity", "Creep productivity score", ["role"]);
}

/** 采集 Creep Metrics。每 10 tick 调用。 */
export function collectCreepMetrics(): void {
  if (!shouldCollect("creep")) return;
  markCollected("creep");

  try {
    const counts: Record<string, number> = {};
    const ttls: Record<string, number[]> = {};
    const modes: Record<string, { acquire: number; work: number; idle: number; flee: number }> = {};

    for (const creep of Object.values(Game.creeps)) {
      const role = creep.memory.role ?? "unknown";
      counts[role] = (counts[role] ?? 0) + 1;
      const ttl = creep.ticksToLive ?? 1500;
      if (!ttls[role]) ttls[role] = [];
      ttls[role].push(ttl);

      if (!modes[role]) modes[role] = { acquire: 0, work: 0, idle: 0, flee: 0 };
      const mode = creep.memory.mode ?? "idle";
      if (mode in modes[role]) {
        modes[role][mode as keyof typeof modes[string]]++;
      }
    }

    for (const [role, count] of Object.entries(counts)) {
      const labels = { role };
      setGauge("screeps_creep_alive", count, labels);

      // TTL
      const ttlArr = ttls[role];
      if (ttlArr && ttlArr.length > 0) {
        const avg = Math.round(ttlArr.reduce((a, b) => a + b, 0) / ttlArr.length);
        setGauge("screeps_creep_ttl", avg, labels);
      }

      // Mode 分布 → productivity
      const m = modes[role];
      if (m) {
        const total = m.acquire + m.work + m.idle + m.flee || 1;
        setGauge("screeps_creep_work_ratio", Math.round((m.work / total) * 1000) / 1000, labels);
        setGauge("screeps_creep_idle_ratio", Math.round((m.idle / total) * 1000) / 1000, labels);
        setGauge("screeps_creep_travel_ratio", Math.round((m.acquire / total) * 1000) / 1000, labels);
        // Productivity = work / (work + idle + travel)
        const productive = m.work + m.idle + m.acquire || 1;
        setGauge("screeps_creep_productivity", Math.round((m.work / productive) * 1000) / 1000, labels);
      }
    }
  } catch {
    // Telemetry 失败不得影响 AI
  }
}
