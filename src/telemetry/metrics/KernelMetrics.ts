/** Kernel Metrics — 内核调度指标（1.md §6）。 */

import { registerMetricGauge, registerMetricCounter, registerMetricHistogram } from "../Telemetry";
import { setGauge, incrementCounter, observeHistogram } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";
import type { GlobalCache } from "../../kernel/global-cache";
import { globalCache } from "../../kernel/global-cache";

// ─── Metric Registration ──────────────────────────────────

let registered = false;

export function registerKernelMetrics(): void {
  if (registered) return;
  registered = true;

  // Process 统计（1.md §6）
  registerMetricGauge("kernel", "process_active", "Active process count", ["process_type"]);
  registerMetricCounter("kernel", "process_created", "Total processes created", ["process_type"], "total");
  registerMetricCounter("kernel", "process_completed", "Total processes completed", ["process_type"], "total");
  registerMetricCounter("kernel", "process_failed", "Total processes failed", ["process_type"], "total");
  registerMetricCounter("kernel", "process_skipped", "Total processes skipped", ["process_type"], "total");

  // Process 执行时间
  registerMetricHistogram("kernel", "process_execution", "Process execution time in seconds", ["process_type"], undefined, "seconds");

  // Scheduler 相关
  registerMetricGauge("kernel", "scheduler_lag", "Scheduler lag in ticks", [], "ticks");
  registerMetricCounter("kernel", "scheduler_overrun", "Total scheduler overruns", [], "total");
}

// ─── Collection ───────────────────────────────────────────

interface TelemetryData {
  tick: number;
  systemCpu: Record<string, number>;
  roleCpu: Record<string, number>;
  skipped: number;
  errors: number;
}

/**
 * 采集 Kernel Metrics。
 * 每 tick 调用。

 * @param skipped 本 tick 跳过数
 * @param errors 本 tick 错误数
 */
export function collectKernelMetrics(skipped: number = 0, errors: number = 0): void {
  if (!shouldCollect("kernel")) return;
  markCollected("kernel");

  try {
    const g = globalCache();
    const tel = g.telemetry as TelemetryData | undefined;

    if (!tel || tel.tick !== Game.time) return;

    // System CPU → process_type 维度
    let activeCount = 0;
    for (const [sysName, cpu] of Object.entries(tel.systemCpu)) {
      if (cpu > 0) {
        activeCount++;
        observeHistogram("screeps_kernel_process_execution_seconds", cpu / 1000, {
          process_type: sysName,
        });
      }
    }
    setGauge("screeps_kernel_process_active", activeCount, { process_type: "all" });

    if (skipped > 0) {
      incrementCounter("screeps_kernel_process_skipped_total", skipped, { process_type: "all" });
    }
    if (errors > 0) {
      incrementCounter("screeps_kernel_process_failed_total", errors, { process_type: "all" });
    }
  } catch {
    // Telemetry 失败不得影响 AI
  }
}
