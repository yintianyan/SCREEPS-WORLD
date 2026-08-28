/** Evaluation Metrics — T3: AI Evaluation 偏差指标。 */

import { registerMetricCounter, registerMetricGauge } from "../Telemetry";
import { incrementCounter, setGauge } from "../MetricRegistry";

let registered = false;

export function registerEvaluationMetrics(): void {
    if (registered) return;
    registered = true;

    // T3 evaluation counters 标记为 cumulative（flush 时不重置）。
    // 原因：T3 事件是低频的（posture 变更、spawn 成功/失败），每次 flush 窗口可能只有 0-1 次。
    // 如果 flush 归零，Prometheus rate() 会频繁看到 0，导致告警规则无法正常触发。
    // 累积 counter 通过 rate() 计算速率，符合 Prometheus counter 语义。
    registerMetricCounter("evaluation", "expectations_declared", "Total expectations declared", ["planner"], "total", true);
    registerMetricCounter("evaluation", "expectations_fulfilled", "Fulfilled expectations", ["planner"], "total", true);
    registerMetricCounter("evaluation", "expectations_missed", "Missed expectations", ["planner"], "total", true);
    registerMetricCounter("evaluation", "expectations_expired", "Expired expectations", ["planner"], "total", true);
    registerMetricGauge("evaluation", "deviation", "Aggregate deviation percentage", ["planner"], "percent");
    registerMetricGauge("evaluation", "pending", "Pending expectations count", ["planner"], "count");
}

/** 记录期望声明。 */
export function recordExpectationDeclared(domain: string): void {
    try {
        incrementCounter("screeps_evaluation_expectations_declared_total", 1, { planner: domain });
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/** 记录期望已达成。 */
export function recordExpectationFulfilled(domain: string, deviation: number): void {
    try {
        incrementCounter("screeps_evaluation_expectations_fulfilled_total", 1, { planner: domain });
        setGauge("screeps_evaluation_deviation_percent", deviation, { planner: domain });
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/** 记录期望未达成。 */
export function recordExpectationMissed(domain: string, deviation: number): void {
    try {
        incrementCounter("screeps_evaluation_expectations_missed_total", 1, { planner: domain });
        setGauge("screeps_evaluation_deviation_percent", deviation, { planner: domain });
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/** 记录期望过期。 */
export function recordExpectationExpired(domain: string): void {
    try {
        incrementCounter("screeps_evaluation_expectations_expired_total", 1, { planner: domain });
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/** 记录当前 pending 数量。 */
export function recordPendingCount(domain: string, count: number): void {
    try {
        setGauge("screeps_evaluation_pending_count", count, { planner: domain });
    } catch {
        // Telemetry 失败不得影响 AI
    }
}
