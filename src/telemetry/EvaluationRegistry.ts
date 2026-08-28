/**
 * Evaluation Registry — T3: AI Evaluation System.
 *
 * Expected Outcome → Actual Outcome → Deviation → Evaluation → Strategy Feedback.
 *
 * 生命周期：
 *   1. 策略层做决策时调用 `declareExpected()` 注册一个期望快照
 *   2. 执行层完成时调用 `resolveOutcome()` 回填实际结果
 *   3. `evaluatePending()` 低频扫描 pending → 超时/达成 → 计算 deviation
 *   4. 偏差汇总写入 `globalCache.strategyFeedback` 供策略层消费
 *
 * 安全不变式：本模块完全失败时，帝国照常安全运行。
 * 数据存储：全部在 globalCache（volatile），global reset 后从空重建。
 * Memory 增长：零 — 不写入 Memory，只在 console 输出偏差报告。
 */

import { globalCache } from "../kernel/global-cache";
import { recordOutcome } from "./DecisionRegistry";
import { recordExpectationDeclared, recordExpectationFulfilled, recordExpectationMissed } from "./metrics/EvaluationMetrics";
import { log } from "../kernel/log";

// ─── Types ──────────────────────────────────────────────

/** 领域标识 — 哪个子系统声明了这个期望。 */
export type EvaluationDomain =
    | "empire"
    | "expansion"
    | "war"
    | "spawn"
    | "agenda";

/** 期望状态。 */
export type ExpectationStatus = "pending" | "fulfilled" | "missed" | "expired";

/** 期望快照 — 策略层在决策时声明。 */
export interface ExpectedOutcome {
    /** 唯一标识（调用方生成，如 "expansion-W12N1-12345"）。 */
    readonly id: string;
    /** 声明 tick。 */
    readonly declaredAtTick: number;
    /** 域。 */
    readonly domain: EvaluationDomain;
    /** 决策描述（如 "EXPAND", "POSTURE_CHANGE:war"）。 */
    readonly decision: string;
    /** 目标（如房间名、creep 角色名）。 */
    readonly target?: string;
    /** 预期完成 tick（deadline）。 */
    readonly expectedDeadlineTick: number;
    /** 预期量化指标 key → value（如 { storageEnergy: 50000, rooms: 2 }）。 */
    readonly expectedMetrics: Record<string, number>;
    /** 置信度 0-1。 */
    readonly confidence: number;
}

/** 实际结果回填。 */
export interface ActualOutcome {
    /** 完成 tick。 */
    readonly resolvedAtTick: number;
    /** 实际量化指标（与 expectedMetrics 对应的 key）。 */
    readonly actualMetrics: Record<string, number>;
    /** 结果标签（如 "COMPLETED", "FAILED", "CANCELLED"）。 */
    readonly result: string;
}

/** 已解析的期望记录（Expected + Actual + Deviation）。 */
export interface ResolvedExpectation {
    readonly id: string;
    readonly domain: EvaluationDomain;
    readonly decision: string;
    readonly target?: string;
    readonly declaredAtTick: number;
    readonly resolvedAtTick: number;
    readonly expectedMetrics: Record<string, number>;
    readonly actualMetrics: Record<string, number>;
    /** 每个指标 key 的偏差百分比（actual - expected） / max(expected, 1) × 100。 */
    readonly deviations: Record<string, number>;
    /** 综合偏差（各指标偏差的均值，可为负）。 */
    readonly aggregateDeviation: number;
    readonly status: ExpectationStatus;
    readonly result: string;
}

/** Strategy Feedback — 写入 globalCache 供策略层消费。 */
export interface StrategyFeedback {
    /** 最近一次评估 tick。 */
    readonly tick: number;
    /** 各域的偏差汇总（正 = 超预期，负 = 不达预期）。 */
    readonly byDomain: Record<string, { avgDeviation: number; sampleCount: number; missed: number; fulfilled: number }>;
    /** 建议信号：哪些域表现持续不达预期。 */
    readonly underperformingDomains: string[];
    /** 建议信号：哪些域表现超预期（可考虑加码）。 */
    readonly overperformingDomains: string[];
}

// ─── Storage ────────────────────────────────────────────

interface EvaluationStore {
    /** 待解析的期望声明（pending）。 */
    pending: Map<string, ExpectedOutcome>;
    /** 已解析的记录（ring buffer）。 */
    resolved: ResolvedExpectation[];
    /** 上次评估 tick。 */
    lastEvalTick: number;
}

const MAX_RESOLVED = 200;
const EVAL_INTERVAL = 100; // 每 100 tick 评估一次
const EXPIRY_GRACE_TICKS = 50; // 超过 deadline 后的宽限 tick

function store(): EvaluationStore {
    const g = globalCache() as Record<string, unknown>;
    if (!g.__evaluationRegistry) {
        g.__evaluationRegistry = {
            pending: new Map(),
            resolved: [],
            lastEvalTick: 0,
        } as EvaluationStore;
    }
    return g.__evaluationRegistry as EvaluationStore;
}

// ─── Public API ────────────────────────────────────────

/**
 * 声明一个期望结果。策略层做决策时调用。
 * 幂等：同 id 的声明被忽略（不覆盖已有 pending）。
 */
export function declareExpected(outcome: ExpectedOutcome): void {
    try {
        const s = store();
        if (s.pending.has(outcome.id)) return; // 幂等
        // 如果 resolved 中已有同 id，也不重复声明
        if (s.resolved.some(r => r.id === outcome.id)) return;
        s.pending.set(outcome.id, outcome);
        recordExpectationDeclared(outcome.domain);
    } catch {
        // Evaluation 失败不得影响 AI
    }
}

/**
 * 回填实际结果。执行层完成时调用。
 * 如果 id 不在 pending 中（可能已过期被清理或未声明），静默跳过。
 */
export function resolveOutcome(id: string, actual: ActualOutcome): void {
    try {
        const s = store();
        const expected = s.pending.get(id);
        if (!expected) return; // 不在 pending 中 — 静默跳过

        const deviations = computeDeviations(expected.expectedMetrics, actual.actualMetrics);
        const aggregateDeviation = aggregate(deviations);
        const status: ExpectationStatus = determineStatus(expected, actual, deviations);

        const resolved: ResolvedExpectation = {
            id: expected.id,
            domain: expected.domain,
            decision: expected.decision,
            target: expected.target,
            declaredAtTick: expected.declaredAtTick,
            resolvedAtTick: actual.resolvedAtTick,
            expectedMetrics: expected.expectedMetrics,
            actualMetrics: actual.actualMetrics,
            deviations,
            aggregateDeviation,
            status,
            result: actual.result,
        };

        // Ring buffer
        if (s.resolved.length >= MAX_RESOLVED) {
            s.resolved.shift();
        }
    s.resolved.push(resolved);
        s.pending.delete(id);

        // T3 Metrics
        if (status === "fulfilled") recordExpectationFulfilled(expected.domain, aggregateDeviation);
        else if (status === "missed") recordExpectationMissed(expected.domain, aggregateDeviation);

    // 同时写入 DecisionRegistry 的 Outcome 追踪
        recordOutcome(
            expected.declaredAtTick,
            expected.domain,
            expected.decision,
            expected.expectedMetrics as Record<string, unknown>,
            actual.actualMetrics as Record<string, unknown>,
            aggregateDeviation,
        );
    } catch {
        // Evaluation 失败不得影响 AI
    }
}

/**
 * 评估所有 pending 期望。低频调用（每 100 tick）。
 * - 超过 deadline + 宽限期的 pending → 标记为 expired
 * - 计算各域偏差汇总
 * - 产出 Strategy Feedback 写入 globalCache
 */
export function evaluatePending(tick: number): StrategyFeedback {
    const s = store();
    const feedback = computeFeedback(tick, s);

    // 清理过期 pending
    const expired: string[] = [];
    for (const [id, exp] of s.pending) {
        if (tick > exp.expectedDeadlineTick + EXPIRY_GRACE_TICKS) {
            expired.push(id);
            // 记录为 expired
            const deviations = computeDeviations(exp.expectedMetrics, {});
            const aggregateDeviation = aggregate(deviations);
            const resolved: ResolvedExpectation = {
                id: exp.id,
                domain: exp.domain,
                decision: exp.decision,
                target: exp.target,
                declaredAtTick: exp.declaredAtTick,
                resolvedAtTick: tick,
                expectedMetrics: exp.expectedMetrics,
                actualMetrics: {},
                deviations,
                aggregateDeviation,
                status: "expired",
                result: "EXPIRED",
            };
            if (s.resolved.length >= MAX_RESOLVED) {
                s.resolved.shift();
            }
            s.resolved.push(resolved);
        }
    }
    for (const id of expired) {
        s.pending.delete(id);
    }

    s.lastEvalTick = tick;

    // 写入 globalCache 供策略层消费
    const g = globalCache() as Record<string, unknown>;
    g.strategyFeedback = feedback;

    // 偏差报告（仅在有非零偏差时输出）
    if (feedback.underperformingDomains.length > 0 || feedback.overperformingDomains.length > 0) {
        const parts: string[] = [];
        if (feedback.underperformingDomains.length > 0) {
            parts.push(`under: [${feedback.underperformingDomains.join(",")}]`);
        }
        if (feedback.overperformingDomains.length > 0) {
            parts.push(`over: [${feedback.overperformingDomains.join(",")}]`);
        }
        log.info("EvaluationRegistry", `@TELEMETRY evaluation: ${parts.join(" ")} at tick ${tick}`);
    }

    return feedback;
}

/** 获取当前 Strategy Feedback（供策略层读取）。 */
export function getStrategyFeedback(): StrategyFeedback | undefined {
    const g = globalCache() as Record<string, unknown>;
    return g.strategyFeedback as StrategyFeedback | undefined;
}

/** 获取 pending 期望数量。 */
export function pendingCount(): number {
    return store().pending.size;
}

/** 获取已解析的最近 N 条记录（供测试和调试）。 */
export function recentResolved(count: number = 10): ResolvedExpectation[] {
    const s = store();
    return s.resolved.slice(-count);
}

/** 是否到了评估时间。 */
export function shouldEvaluate(tick: number): boolean {
    const s = store();
    return tick - s.lastEvalTick >= EVAL_INTERVAL;
}

/** 清空所有状态（测试用）。 */
export function resetEvaluation(): void {
    const g = globalCache() as Record<string, unknown>;
    g.__evaluationRegistry = undefined;
}

// ─── Pure Functions（可独立测试）────────────────────────

/**
 * 计算每个指标的偏差百分比。
 * deviation = (actual - expected) / max(expected, 1) × 100
 * actual 缺失时视为 0。
 */
export function computeDeviations(
    expected: Record<string, number>,
    actual: Record<string, number>,
): Record<string, number> {
    const result: Record<string, number> = {};
    for (const key of Object.keys(expected)) {
        const exp = expected[key] ?? 0;
        const act = actual[key] ?? 0;
        const denom = Math.max(Math.abs(exp), 1);
        result[key] = ((act - exp) / denom) * 100;
    }
    return result;
}

/**
 * 计算综合偏差（各指标偏差的算术均值）。
 * 可为负（不达预期）或正（超预期）。
 */
export function aggregate(deviations: Record<string, number>): number {
    const values = Object.values(deviations);
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * 判定期望状态。
 * - 所有指标 ≥ 预期的 90% → fulfilled
 * - 任何指标 < 预期的 50% → missed
 * - 否则 → missed（部分达成也算 missed，保守评价）
 */
export function determineStatus(
    expected: ExpectedOutcome,
    actual: ActualOutcome,
    deviations: Record<string, number>,
): ExpectationStatus {
    // 如果 result 明确标记为 FAILED/CANCELLED → missed
    if (actual.result === "FAILED" || actual.result === "CANCELLED" || actual.result === "EXPIRED") {
        return actual.result === "CANCELLED" ? "missed" : "missed";
    }
    // 检查所有偏差是否在容忍范围内（±10%）
    const allFulfilled = Object.values(deviations).every(d => d >= -10);
    return allFulfilled ? "fulfilled" : "missed";
}

/**
 * 从 resolved 记录中计算 Strategy Feedback。
 * 只看最近 2 个评估窗口的数据（200 tick 窗口），避免旧数据稀释。
 */
function computeFeedback(tick: number, s: EvaluationStore): StrategyFeedback {
    const windowStart = tick - EVAL_INTERVAL * 2;
    const recent = s.resolved.filter(r => r.resolvedAtTick >= windowStart);

    const byDomain: StrategyFeedback["byDomain"] = {};
    for (const r of recent) {
        const key = r.domain;
        if (!byDomain[key]) {
            byDomain[key] = { avgDeviation: 0, sampleCount: 0, missed: 0, fulfilled: 0 };
        }
        const entry = byDomain[key];
        entry.avgDeviation = (entry.avgDeviation * entry.sampleCount + r.aggregateDeviation) / (entry.sampleCount + 1);
        entry.sampleCount++;
        if (r.status === "fulfilled") entry.fulfilled++;
        else if (r.status === "missed" || r.status === "expired") entry.missed++;
    }

    const underperforming: string[] = [];
    const overperforming: string[] = [];
    for (const [domain, entry] of Object.entries(byDomain)) {
        if (entry.sampleCount < 2) continue; // 样本太少不做判断
        // 持续不达预期：平均偏差 < -15% 或 missed 率 > 50%
        if (entry.avgDeviation < -15 || (entry.missed / entry.sampleCount) > 0.5) {
            underperforming.push(domain);
        }
        // 持续超预期：平均偏差 > 15% 且 fulfilled 率 > 70%
        if (entry.avgDeviation > 15 && (entry.fulfilled / entry.sampleCount) > 0.7) {
            overperforming.push(domain);
        }
    }

    return {
        tick,
        byDomain,
        underperformingDomains: underperforming,
        overperformingDomains: overperforming,
    };
}
