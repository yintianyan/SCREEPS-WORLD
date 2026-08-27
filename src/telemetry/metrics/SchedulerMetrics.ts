/** Scheduler Metrics — 调度器指标。 */

import { registerMetricGauge, registerMetricCounter } from "../Telemetry";
import { setGauge, incrementCounter } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";

let registered = false;

export function registerSchedulerMetrics(): void {
    if (registered) return;
    registered = true;

    registerMetricGauge("scheduler", "ready_processes", "Ready processes count", []);
    registerMetricGauge("scheduler", "due_processes", "Due processes count", []);
    registerMetricCounter("scheduler", "executed_processes", "Total executed processes", [], "total");
    registerMetricCounter("scheduler", "skipped_processes", "Total skipped processes", [], "total");
    registerMetricCounter("scheduler", "deferred_processes", "Total deferred processes", [], "total");
    registerMetricGauge("scheduler", "lag_ticks", "Scheduler lag in ticks", [], "ticks");
    registerMetricGauge("scheduler", "cpu_budget", "Scheduler CPU budget", []);
    registerMetricGauge("scheduler", "cpu_used", "Scheduler CPU used", []);
    registerMetricCounter("scheduler", "cpu_overrun", "Total CPU overruns", [], "total");
}

/** 采集 Scheduler Metrics。每 tick 调用。 */
export function collectSchedulerMetrics(
    budget: { softLimit: number; hardLimit: number; tier: string },
    readyCount: number = 0,
    dueCount: number = 0,
    executedCount: number = 0,
    skippedCount: number = 0,
    deferredCount: number = 0,
): void {
    if (!shouldCollect("scheduler")) return;
    markCollected("scheduler");

    try {
        setGauge("screeps_scheduler_ready_processes", readyCount);
        setGauge("screeps_scheduler_due_processes", dueCount);
        if (executedCount > 0) incrementCounter("screeps_scheduler_executed_processes_total", executedCount);
        if (skippedCount > 0) incrementCounter("screeps_scheduler_skipped_processes_total", skippedCount);
        if (deferredCount > 0) incrementCounter("screeps_scheduler_deferred_processes_total", deferredCount);

        setGauge("screeps_scheduler_cpu_budget", budget.softLimit);
        setGauge("screeps_scheduler_cpu_used", Math.round(Game.cpu.getUsed() * 1000) / 1000);

        // CPU overrun 检测
        if (Game.cpu.getUsed() > budget.hardLimit) {
            incrementCounter("screeps_scheduler_cpu_overrun_total");
        }
    } catch {
        // Telemetry 失败不得影响 AI
    }
}
