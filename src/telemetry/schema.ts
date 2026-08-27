/** Telemetry Schema — Metric types, label rules, domain definitions. */

// ─── Metric Types ─────────────────────────────────────────

/** Counter 只能递增（或 reset to 0），适合累计计数。 */
export interface CounterMetric {
    readonly type: "counter";
    readonly name: string;
    readonly help: string;
    readonly labels: readonly string[];
    value: number;
}

/** Gauge 可任意设置，适合当前状态快照。 */
export interface GaugeMetric {
    readonly type: "gauge";
    readonly name: string;
    readonly help: string;
    readonly labels: readonly string[];
    value: number;
}

/** Histogram 分布统计，适合 latency / duration。 */
export interface HistogramMetric {
    readonly type: "histogram";
    readonly name: string;
    readonly help: string;
    readonly labels: readonly string[];
    count: number;
    sum: number;
    buckets: { threshold: number; count: number }[];
}

/** Timer 是 Histogram 的语法糖，自动测量耗时。 */
export interface TimerHandle {
    end(): number;
}

// ─── Telemetry Domains ────────────────────────────────────

/**
 * Telemetry 域定义。
 * 每个域对应一组语义相关的指标。
 */
export const TELEMETRY_DOMAINS = [
    "runtime",
    "kernel",
    "scheduler",
    "world",
    "room",
    "creep",
    "spawn",
    "economy",
    "logistics",
    "empire",
    "expansion",
    "defense",
    "planning",
    "execution",
    "evaluation",
] as const;

export type TelemetryDomain = (typeof TELEMETRY_DOMAINS)[number];

// ─── Label Schema ─────────────────────────────────────────

/**
 * 允许的 label keys。
 * 禁止高基数 labels：pid, creep_name, task_id, request_id, target_id, error_message, coordinates。
 */
export const ALLOWED_LABELS = [
    "shard",
    "room",
    "rcl",
    "role",
    "process_type",
    "operation_type",
    "planner",
    "result",
    "reason",
    "phase",
    "tier",
    "colony_state",
    "resource_type",
    "structure_type",
] as const;

export type AllowedLabel = (typeof ALLOWED_LABELS)[number];

/** Label value 类型（全部是字符串，Prom 标准）。 */
export type LabelSet = Partial<Record<AllowedLabel, string>>;

// ─── Telemetry Event Schema ────────────────────

export interface TelemetryEvent {
    readonly tick: number;
    readonly type: string;
    readonly room?: string;
    readonly operation?: string;
    readonly data: Record<string, unknown>;
}

// ─── Decision Schema ─────────────────────────────

export interface DecisionRecord {
    readonly tick: number;
    readonly planner: string;
    readonly decision: string;
    readonly target?: string;
    readonly reason: string;
    readonly confidence?: number;
    readonly expectedOutcome?: Record<string, unknown>;
}

// ─── Collection Frequency ──────────────────────

/**
 * 采集频率规范。
 * 采集 ≠ 发送：每 tick 采 → Local Aggregator → Buffer → Flush。
 */
export const COLLECTION_FREQUENCY: Record<string, number> = {
    // 每 tick
    cpu: 1,
    bucket: 1,
    kernel: 1,
    scheduler: 1,
    process: 1,
    // 每 5 tick
    room_energy: 5,
    spawn: 5,
    // 每 10 tick
    creep: 10,
    economy: 10,
    logistics: 10,
    dashboard_summary: 10,
    // 每 25 tick
    empire: 25,
    // 事件驱动（不做周期采集）
    planning: 0,
    expansion: 0,
    error: 0,
    decision: 0,
} as const;

// ─── Metric Naming Convention ──────────────────────────────

/**
 * 构建 Prometheus 兼容的 metric name。
 * 格式：screeps_<domain>_<metric>_<unit/type>
 */
export function buildMetricName(domain: TelemetryDomain, metric: string, unit?: string): string {
    const parts = ["screeps", domain, metric];
    if (unit) parts.push(unit);
    return parts.join("_");
}

// ─── Telemetry CPU Budget ──────────────────────────────────

/**
 * Telemetry 自身的 CPU 预算约束）。
 * Telemetry 失败不得影响 AI 运行。
 * Phase T0 目标：< 0.5% CPU。
 */
export const TELEMETRY_CPU_BUDGET_RATIO = 0.005; // 0.5% of CPU limit
