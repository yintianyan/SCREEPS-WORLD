/** Telemetry — 统一 facade API）。 */

import {
    registerCounter,
    registerGauge,
    registerHistogram,
    incrementCounter,
    setGauge,
    observeHistogram,
    startTimer,
    metricCount,
} from "./MetricRegistry";
import type { TimerHandle } from "./schema";
import {
    recordEvent as recordTelemetryEvent,
    TELEMETRY_EVENT_TYPES,
    type TelemetryEventType,
} from "./EventRegistry";
import { recordDecision } from "./DecisionRegistry";
import { recordOutcome } from "./DecisionRegistry";
import {
    buildMetricName,
    type AllowedLabel,
    type LabelSet,
    type TelemetryDomain,
} from "./schema";

// ─── Registration API ─────────────────────────────────────

/**
 * 注册一个 Counter 指标。
 * 应在模块初始化时调用（bootstrap 或模块顶层）。
 */
export function registerMetricCounter(
    domain: TelemetryDomain,
    metric: string,
    help: string,
    labels: AllowedLabel[] = [],
    unit?: string,
): void {
    try {
        registerCounter(domain, metric, help, labels, unit);
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/** 注册一个 Gauge 指标。 */
export function registerMetricGauge(
    domain: TelemetryDomain,
    metric: string,
    help: string,
    labels: AllowedLabel[] = [],
    unit?: string,
): void {
    try {
        registerGauge(domain, metric, help, labels, unit);
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/** 注册一个 Histogram 指标。 */
export function registerMetricHistogram(
    domain: TelemetryDomain,
    metric: string,
    help: string,
    labels: AllowedLabel[] = [],
    buckets?: number[],
    unit?: string,
): void {
    try {
        registerHistogram(domain, metric, help, labels, buckets, unit);
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

// ─── Recording API（业务代码调用）──────────────────────────

/**
 * 递增一个 Counter。
 * @param shortName 简短名如 "spawn.requests.total"（自动加 screeps_ 前缀）
 * @param value 增量（默认 1）
 * @param labels label set

 * 
 *   Telemetry.counter("spawn.requests.total", 1, { role: "miner" });
 */
export function counter(shortName: string, value: number = 1, labels: LabelSet = {}): void {
    try {
        const name = resolveMetricName(shortName);
        incrementCounter(name, value, labels);
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/**
 * 设置一个 Gauge。
 * @param shortName 简短名如 "economy.energy.net"
 * @param value 当前值
 * @param labels label set

 * 
 *   Telemetry.gauge("economy.energy.net", netEnergy);
 */
export function gauge(shortName: string, value: number, labels: LabelSet = {}): void {
    try {
        const name = resolveMetricName(shortName);
        setGauge(name, value, labels);
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/**
 * 开始一个计时器。
 * @param shortName 简短名如 "planning.generation"
 * @returns TimerHandle，调用 end() 完成计时

 * 
 *   const timer = Telemetry.timer("planning.generation");
 *   const plan = planner.generate();
 *   timer.end();
 */
export function timer(shortName: string, labels: LabelSet = {}): TimerHandle {
    try {
        const name = resolveMetricName(shortName);
        return startTimer(name, labels);
    } catch {
        // Telemetry 失败不得影响 AI — 返回 noop timer
        return { end: () => 0 };
    }
}

/**
 * 记录一个离散事件。
 * @param type 事件类型（如 "expansion.started"）
 * @param data 事件数据
 * @param room 关联房间名
 * @param operation 关联操作名

 * 
 *   Telemetry.event("expansion.started", { room: targetRoom, operationType: "colonize" });
 */
export function event(
    type: string | TelemetryEventType,
    data: Record<string, unknown> = {},
    room?: string,
    operation?: string,
): void {
    try {
        recordTelemetryEvent(type, data, room, operation);
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/**
 * 记录一个 AI 决策。
 * @param planner 决策者（如 "empire", "economy", "spawn"）
 * @param decision 决策内容（如 "EXPAND", "FORTIFY"）
 * @param reason 决策原因（如 "energy_surplus"）
 * @param options 额外信息（target, confidence, expectedOutcome）

 * 
 *   Telemetry.decision("empire.expansion", {
 *     action: "EXPAND",
 *     target: roomName,
 *     reason: "RESOURCE_SURPLUS"
 *   });
 */
export function decision(
    planner: string,
    decision: string,
    reason: string,
    options?: {
        target?: string;
        confidence?: number;
        expectedOutcome?: Record<string, unknown>;
    },
): void {
    try {
        recordDecision(planner, decision, reason, options);
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

/**
 * 记录一个 Decision → Outcome 评估。

 * @param decisionTick 原始决策 tick
 * @param planner 决策者
 * @param decision 决策内容
 * @param expected 预期结果
 * @param actual 实际结果
 * @param deviation 偏差百分比
 */
export function outcome(
    decisionTick: number,
    planner: string,
    decision: string,
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
    deviation: number,
): void {
    try {
        recordOutcome(decisionTick, planner, decision, expected, actual, deviation);
    } catch {
        // Telemetry 失败不得影响 AI
    }
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * 解析简短名到完整 metric name。
 * 输入如 "spawn.requests.total" → "screeps_spawn_requests_total"
 * 输入已经是完整名（以 screeps_ 开头）则直接返回。
 * 点号自动转换为下划线以匹配 buildMetricName 的输出。
 */
function resolveMetricName(shortName: string): string {
    if (shortName.startsWith("screeps_")) return shortName;
    return `screeps_${shortName.replace(/\./g, "_")}`;
}

/** 获取已注册指标数量（R6 上限审计）。 */
export function registeredMetricCount(): number {
    try {
        return metricCount();
    } catch {
        return 0;
    }
}

// ─── Export event types for convenience ───────────────────

export { TELEMETRY_EVENT_TYPES, buildMetricName };
