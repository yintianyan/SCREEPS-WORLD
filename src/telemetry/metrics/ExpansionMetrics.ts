/** Expansion Metrics — 扩张指标。 */

import { registerMetricGauge, registerMetricCounter } from "../Telemetry";
import { setGauge, incrementCounter } from "../MetricRegistry";
import { globalCache } from "../../kernel/global-cache";

let registered = false;

export function registerExpansionMetrics(): void {
    if (registered) return;
    registered = true;

    registerMetricGauge("expansion", "candidates", "Expansion candidate rooms", []);
    registerMetricGauge("expansion", "plans", "Active expansion plans", []);
    registerMetricGauge("expansion", "active", "Active expansions", []);
    registerMetricCounter("expansion", "completed", "Completed expansions", [], "total");
    registerMetricCounter("expansion", "failed", "Failed expansions", ["reason"], "total");
    registerMetricGauge("expansion", "duration", "Expansion duration in seconds", [], "seconds");
    registerMetricGauge("expansion", "bootstrap_ticks", "Bootstrap phase ticks", [], "ticks");
    registerMetricGauge("expansion", "energy_cost", "Expansion energy cost", []);
}

/** 采集 Expansion Metrics。事件驱动，不做周期采集。 */
export function collectExpansionMetrics(): void {
    try {
        const g = globalCache();
        const dashboard = g.expansionDashboard;

        if (dashboard) {
            const d = dashboard as any;
            setGauge("screeps_expansion_candidates", d.candidates?.length ?? 0);
            setGauge("screeps_expansion_plans", d.plans?.length ?? 0);
            setGauge("screeps_expansion_active", d.activeExpansions?.length ?? 0);
        }
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/**
 * 记录扩张完成。
 * @param durationTicks 扩张耗时（tick）
 * @param energyCost 能量成本
 */
export function recordExpansionCompleted(durationTicks: number, energyCost: number): void {
    try {
        incrementCounter("screeps_expansion_completed_total");
        setGauge("screeps_expansion_bootstrap_ticks", durationTicks);
        setGauge("screeps_expansion_energy_cost", energyCost);
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/**
 * 记录扩张失败。
 * @param reason 失败原因
 */
export function recordExpansionFailed(reason: string): void {
    try {
        incrementCounter("screeps_expansion_failed_total", 1, { reason });
    } catch {
        // Telemetry 失败不得影响 AI
    }
}
