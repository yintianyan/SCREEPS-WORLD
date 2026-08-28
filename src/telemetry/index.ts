/** Telemetry SDK — Barrel Export */

// ─── Facade API ──────────────────────────────────
export {
    counter,
    gauge,
    timer,
    decision,
    outcome,
    registerMetricCounter,
    registerMetricGauge,
    registerMetricHistogram,
    registeredMetricCount,
    buildMetricName,
} from "./Telemetry";

// ─── Schema Types ───────────────────────────
export type {
    CounterMetric,
    GaugeMetric,
    HistogramMetric,
    TimerHandle,
    TelemetryDomain,
    AllowedLabel,
    LabelSet,
    DecisionRecord,
} from "./schema";

export {
    TELEMETRY_DOMAINS,
    ALLOWED_LABELS,
    COLLECTION_FREQUENCY,
} from "./schema";

// ─── Metric Registry ──────────────────────────────────────
export type { MetricSnapshot } from "./MetricRegistry";

// ─── Flush Pipeline ───────────────────────────────────────
export type { FlushPackage } from "./TelemetryBuffer";
export { flush, shouldFlush, bufferStatus } from "./TelemetryBuffer";
export { runFlush, initTelemetryFlush } from "./TelemetryFlush";
export type { FlushResult } from "./TelemetryFlush";

// ─── Domain Collectors ────────────────────────────────────
export { registerRuntimeMetrics, collectRuntimeMetrics } from "./metrics/RuntimeMetrics";
export { registerKernelMetrics, collectKernelMetrics } from "./metrics/KernelMetrics";
export { registerSchedulerMetrics, collectSchedulerMetrics } from "./metrics/SchedulerMetrics";
export { registerWorldMetrics, collectWorldMetrics } from "./metrics/WorldMetrics";
export { registerRoomMetrics, collectRoomMetrics } from "./metrics/RoomMetrics";
export { registerCreepMetrics, collectCreepMetrics } from "./metrics/CreepMetrics";
export { registerSpawnMetrics, collectSpawnMetrics } from "./metrics/SpawnMetrics";
export { registerEconomyMetrics, collectEconomyMetrics } from "./metrics/EconomyMetrics";
export { registerLogisticsMetrics, collectLogisticsMetrics } from "./metrics/LogisticsMetrics";
export { registerPlanningMetrics, recordPlanningDecision, recordPlanningTime } from "./metrics/PlanningMetrics";
export { registerExecutionMetrics, recordExecution, recordExecutionLatency } from "./metrics/ExecutionMetrics";
export { registerEmpireMetrics, collectEmpireMetrics } from "./metrics/EmpireMetrics";
export { registerExpansionMetrics, collectExpansionMetrics, recordExpansionCompleted, recordExpansionFailed } from "./metrics/ExpansionMetrics";
export { registerDefenseMetrics, collectDefenseMetrics } from "./metrics/DefenseMetrics";
export {
    registerEvaluationMetrics,
    recordExpectationDeclared,
    recordExpectationFulfilled,
    recordExpectationMissed,
    recordExpectationExpired,
    recordPendingCount,
} from "./metrics/EvaluationMetrics";

// ─── Evaluation Registry (T3: AI Evaluation) ───────────────
export {
    declareExpected,
    resolveOutcome,
    evaluatePending,
    getStrategyFeedback,
    pendingCount,
    recentResolved,
    shouldEvaluate,
    resetEvaluation,
    computeDeviations,
    aggregate,
    determineStatus,
} from "./EvaluationRegistry";
export type {
    EvaluationDomain,
    ExpectationStatus,
    ExpectedOutcome,
    ActualOutcome,
    ResolvedExpectation,
    StrategyFeedback,
} from "./EvaluationRegistry";

// ─── Exporters ────────────────────────────────────────────
export { exportConsoleLine, exportAlertLine } from "./exporters/ConsoleExporter";
export { exportPrometheusText, getRecordingRulesSuggestions } from "./exporters/PrometheusExporter";

// ─── Tick Aggregator ──────────────────────────────────────
export { shouldCollect, markCollected, aggregateTick, resetFrequencyState } from "./TickAggregator";
