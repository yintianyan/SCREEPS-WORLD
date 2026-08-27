/** Logistics Metrics — 物流指标（1.md §14）。 */

import { registerMetricGauge, registerMetricCounter } from "../Telemetry";
import { setGauge, incrementCounter } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";
import { globalCache } from "../../kernel/global-cache";

let registered = false;

export function registerLogisticsMetrics(): void {
  if (registered) return;
  registered = true;

  registerMetricGauge("logistics", "requests", "Active logistics requests", ["room"]);
  registerMetricGauge("logistics", "pending", "Pending logistics requests", ["room"]);
  registerMetricCounter("logistics", "completed", "Total completed logistics", ["room"], "total");
  registerMetricCounter("logistics", "failed", "Total failed logistics", ["room"], "total");
  registerMetricGauge("logistics", "delivery_latency", "Delivery latency in seconds", [], "seconds");
  registerMetricGauge("logistics", "delivery_efficiency_ratio", "Delivery efficiency ratio", []);
  registerMetricGauge("logistics", "haul_utilization_ratio", "Hauler utilization ratio", []);
}

/** 采集 Logistics Metrics。每 10 tick 调用。 */
export function collectLogisticsMetrics(): void {
  if (!shouldCollect("logistics")) return;
  markCollected("logistics");

  try {
    // 从 globalCache.logisticsAccounting 读取
    const g = globalCache();
    const acc = g.logisticsAccounting;
    if (acc && acc.tick === Game.time) {
      const s = acc.summary;
      setGauge("screeps_logistics_requests", s.activeCount + s.completedCount);
      setGauge("screeps_logistics_pending", s.totalRemaining);

      if (s.totalRequested > 0) {
        const eff = s.totalDelivered / s.totalRequested;
        setGauge("screeps_logistics_delivery_efficiency_ratio", Math.round(eff * 1000) / 1000);
      }
      if (s.completedCount > 0 && s.totalRequested > 0) {
        setGauge("screeps_logistics_haul_utilization_ratio",
          Math.round((s.completedCount / s.totalRequested) * 1000) / 1000);
      }
    }
  } catch {
    // Telemetry 失败不得影响 AI
  }
}
