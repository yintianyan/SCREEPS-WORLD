/** Planning Metrics — 规划指标。 */

import { registerMetricCounter, registerMetricHistogram } from "../Telemetry";
import { incrementCounter, observeHistogram } from "../MetricRegistry";

let registered = false;

export function registerPlanningMetrics(): void {
    if (registered) return;
    registered = true;

    registerMetricCounter("planning", "decisions", "Total planning decisions", ["planner"], "total");
    registerMetricCounter("planning", "decisions_accepted", "Accepted decisions", ["planner"], "total");
    registerMetricCounter("planning", "decisions_rejected", "Rejected decisions", ["planner"], "total");
    registerMetricHistogram("planning", "plan_generation", "Plan generation time in seconds", ["planner"], undefined, "seconds");
}

/**
 * 记录一个规划决策（事件驱动，不做周期采集）。
 * @param planner 规划者名（empire/economy/spawn/expansion/defense）
 * @param accepted 是否接受
 */
export function recordPlanningDecision(planner: string, accepted: boolean): void {
    try {
        incrementCounter("screeps_planning_decisions_total", 1, { planner });
        if (accepted) {
            incrementCounter("screeps_planning_decisions_accepted_total", 1, { planner });
        } else {
            incrementCounter("screeps_planning_decisions_rejected_total", 1, { planner });
        }
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/**
 * 记录规划生成耗时。
 * @param planner 规划者名
 * @param seconds 耗时（秒）
 */
export function recordPlanningTime(planner: string, seconds: number): void {
    try {
        observeHistogram("screeps_planning_plan_generation_seconds", seconds, { planner });
    } catch {
        // Telemetry 失败不得影响 AI
    }
}
