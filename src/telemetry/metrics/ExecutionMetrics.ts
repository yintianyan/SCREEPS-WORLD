/** Execution Metrics — 执行指标。 */

import { registerMetricCounter, registerMetricGauge } from "../Telemetry";
import { incrementCounter, setGauge } from "../MetricRegistry";

let registered = false;

export function registerExecutionMetrics(): void {
    if (registered) return;
    registered = true;

    registerMetricCounter("execution", "operations", "Total operations", ["operation_type"], "total");
    registerMetricCounter("execution", "completed", "Completed operations", ["operation_type"], "total");
    registerMetricCounter("execution", "failed", "Failed operations", ["operation_type"], "total");
    registerMetricCounter("execution", "cancelled", "Cancelled operations", ["operation_type"], "total");
    registerMetricGauge("execution", "latency", "Execution latency in seconds", ["operation_type"], "seconds");
}

/**
 * 记录一个操作执行结果（事件驱动）。
 * @param operationType 操作类型（claim/colonize/bootstrap/spawn/build）
 * @param result 结果（completed/failed/cancelled）
 */
export function recordExecution(
    operationType: string,
    result: "completed" | "failed" | "cancelled",
): void {
    try {
        incrementCounter("screeps_execution_operations_total", 1, {
            operation_type: operationType,
        });
        if (result === "completed") {
            incrementCounter("screeps_execution_completed_total", 1, {
                operation_type: operationType,
            });
        } else if (result === "failed") {
            incrementCounter("screeps_execution_failed_total", 1, {
                operation_type: operationType,
            });
        } else if (result === "cancelled") {
            incrementCounter("screeps_execution_cancelled_total", 1, {
                operation_type: operationType,
            });
        }
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/**
 * 记录执行延迟。
 * @param operationType 操作类型
 * @param seconds 延迟秒数
 */
export function recordExecutionLatency(operationType: string, seconds: number): void {
    try {
        setGauge("screeps_execution_latency_seconds", seconds, {
            operation_type: operationType,
        });
    } catch {
        // Telemetry 失败不得影响 AI
    }
}
