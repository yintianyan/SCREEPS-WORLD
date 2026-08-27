/** Runtime Metrics */

import { registerMetricGauge, registerMetricCounter } from "../Telemetry";
import { setGauge, incrementCounter } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";
import type { Budget } from "../../kernel/contracts";

// ─── Metric Registration ──────────────────────────────────

let registered = false;

/** 注册所有 Runtime Metrics。幂等。 */
export function registerRuntimeMetrics(): void {
    if (registered) return;
    registered = true;

    // CPU
    registerMetricGauge("runtime", "cpu_used", "CPU used this tick", [], "");
    registerMetricGauge("runtime", "cpu_limit", "CPU limit per tick", [], "");
    registerMetricGauge("runtime", "cpu_bucket", "CPU bucket level", [], "");
    registerMetricGauge("runtime", "cpu_tick_ratio", "CPU used / CPU limit ratio", [], "");

    // Tick
    registerMetricCounter("runtime", "tick_total", "Total ticks processed", [], "total");
    registerMetricGauge("runtime", "tick_duration", "Tick wall-clock duration in seconds", [], "seconds");
    registerMetricCounter("runtime", "tick_skipped", "Total ticks skipped", [], "total");
    registerMetricCounter("runtime", "tick_error", "Total ticks with errors", [], "total");

    // Memory
    registerMetricGauge("runtime", "memory_bytes", "Memory size in bytes", [], "");
    registerMetricGauge("runtime", "memory_parse", "Memory JSON.parse duration in seconds", [], "seconds");
    registerMetricGauge("runtime", "memory_serialize", "Memory JSON.stringify duration in seconds", [], "seconds");

    // Segment（if available）
    registerMetricGauge("runtime", "segment_active", "Active RawMemory segments count", [], "");
    registerMetricGauge("runtime", "segment_bytes", "Total active segment bytes", [], "");
    registerMetricCounter("runtime", "segment_read", "Segment read operations", [], "total");
    registerMetricCounter("runtime", "segment_write", "Segment write operations", [], "total");
}

// ─── Collection ───────────────────────────────────────────

/**
 * 采集 Runtime Metrics。
 * 每 tick 调用（频率 = 1）。

 * @param budget 当前 CPU 预算
 * @param tickSkipped 本 tick 跳过数
 * @param tickErrors 本 tick 错误数
 * @param tickStartTime tick 开始时间戳（用于计算 tick duration）
 */
export function collectRuntimeMetrics(
    budget: Budget,
    tickSkipped: number = 0,
    tickErrors: number = 0,
    tickStartTime: number = 0,
): void {
    if (!shouldCollect("cpu")) return;
    markCollected("cpu");

    try {
        const cpuUsed = Game.cpu.getUsed();
        const cpuLimit = Game.cpu.limit ?? 500;
        const bucket = Game.cpu.bucket ?? 0;
        const ratio = cpuLimit > 0 ? cpuUsed / cpuLimit : 0;

        setGauge("screeps_runtime_cpu_used", Math.round(cpuUsed * 1000) / 1000);
        setGauge("screeps_runtime_cpu_limit", cpuLimit);
        setGauge("screeps_runtime_cpu_bucket", bucket);
        setGauge("screeps_runtime_cpu_tick_ratio", Math.round(ratio * 1000) / 1000);

        incrementCounter("screeps_runtime_tick_total");

        if (tickStartTime > 0) {
            const duration = (Date.now() - tickStartTime) / 1000;
            setGauge("screeps_runtime_tick_duration_seconds", Math.round(duration * 1000) / 1000);
        }

        if (tickSkipped > 0) {
            incrementCounter("screeps_runtime_tick_skipped_total", tickSkipped);
        }
        if (tickErrors > 0) {
            incrementCounter("screeps_runtime_tick_error_total", tickErrors);
        }

        // Memory size
        try {
            const memSize = RawMemory.get().length;
            setGauge("screeps_runtime_memory_bytes", memSize);
        } catch {
            // RawMemory not available in test env
        }
    } catch {
        // Telemetry 失败不得影响 AI
    }
}
