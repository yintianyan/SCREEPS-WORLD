/**
 * A6.2 Strategy Evaluation System — 系统层薄壳。
 *
 * 合同锚点：A6.2 Task Spec + A6_2_CONTRACT_RESOLUTION.md
 *
 * 职责（薄壳——只采集和编排，不做决策）：
 *   1. 从 Experience Ring Buffer 读取 FINALIZED Experience
 *   2. 从 globalCache 采集 EmpireHealth / AutonomyMetrics / RecoveryStats
 *   3. 构建 EvaluationInput（纯 DTO）
 *   4. 调用 domain 纯函数 evaluateStrategy
 *   5. 保存 compact Evaluation Result（Ring Buffer + GC）
 *   6. 提供 observability
 *
 * 禁止：
 *   - 不执行任何 Game API（Shadow-Only 原则）
 *   - 不修改任何业务状态
 *   - 不进入 tick 关键路径（低频 500t）
 *   - 不建立第二套 Evaluation / Metrics / Strategy
 *   - Evaluation Result 不得进入任何执行系统
 *
 * CPU 预算：低频执行（interval=500），评估近零成本。
 * 优先级 P3（在所有业务系统之后运行，消费它们产出的数据）。
 * 存储：heap only — global reset 可丢。
 *
 * 安全不变式：本系统完全停止时，帝国必须照常安全运行。
 */
import type { Priority, System, TickContext } from "../../kernel/contracts";
import { globalCache } from "../../kernel/global-cache";
import {
  type EvaluationInput,
  type MetricSnapshot,
  type ContextInfo,
  type EvaluationWindow,
  type StrategyEvaluation,
  CANONICAL_EVALUATION_DIMENSIONS,
  evaluateStrategy,
} from "../../domain/intelligence/strategy-evaluation";
import {
  type Baseline,
  type BaselineKey,
  buildBaseline,
  buildBaselineKey,
  extractHistoricalValues,
} from "../../domain/intelligence/baseline";
import {
  buildEvaluationEvidence,
  validateEvidenceCompleteness,
} from "../../domain/intelligence/evaluation-evidence";
import {
  type ExperienceRecord,
  type ExperienceRingBuffer,
  getRecentExperiences,
} from "../../domain/intelligence/experience";

// ─── Evaluation Result Ring Buffer ────────────────────────

interface EvaluationRingBuffer {
  records: (StrategyEvaluation | undefined)[];
  capacity: number;
  count: number;
  cursor: number;
  totalWritten: number;
}

function createEvaluationRingBuffer(capacity: number): EvaluationRingBuffer {
  return {
    records: new Array(capacity).fill(undefined),
    capacity,
    count: 0,
    cursor: 0,
    totalWritten: 0,
  };
}

function pushEvaluation(buf: EvaluationRingBuffer, eval_: StrategyEvaluation): void {
  buf.records[buf.cursor] = eval_;
  buf.cursor = (buf.cursor + 1) % buf.capacity;
  buf.totalWritten++;
  if (buf.count < buf.capacity) buf.count++;
}

function gcEvaluationBuffer(buf: EvaluationRingBuffer, maxAge: number, currentTick: number): number {
  let cleaned = 0;
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (currentTick - r.tick > maxAge) {
      buf.records[i] = undefined;
      cleaned++;
      if (buf.count > 0) buf.count--;
    }
  }
  return cleaned;
}

// ─── Cache ─────────────────────────────────────────────────

interface StrategyEvaluationCache {
  ringBuffer: EvaluationRingBuffer;
  /** 上次评估 tick。 */
  lastEvaluationTick: number;
}

/** 当前 A6.2 模型版本。 */
const MODEL_VERSION = 1;

/** Evaluation Ring Buffer 容量。 */
const EVALUATION_RING_BUFFER_CAPACITY = 50;

/** Evaluation 最大存活 tick。 */
const EVALUATION_MAX_AGE = 50000;

// ─── 系统定义 ──────────────────────────────────────────────

export const strategyEvaluationSystem: System = {
  name: "strategy-evaluation",
  priority: 3 as Priority,
  interval: 500,
  phase: "post",

  run(ctx: TickContext): void {
    const g = globalCache();
    const tick = ctx.tick;

    // ── 1. 初始化缓存（首次运行或 global reset 后）──
    if (!g.__evaluationCache) {
      g.__evaluationCache = {
        ringBuffer: createEvaluationRingBuffer(EVALUATION_RING_BUFFER_CAPACITY),
        lastEvaluationTick: 0,
      };
    }
    const cache = g.__evaluationCache as StrategyEvaluationCache;

    // ── 2. 读取 Experience Ring Buffer ──
    const expCache = g.__experienceCache as
      | { ringBuffer: ExperienceRingBuffer }
      | undefined;
    if (!expCache?.ringBuffer) return;

    // 获取最近的 FINALIZED Experience
    const experiences = getRecentExperiences(expCache.ringBuffer, 200);
    if (experiences.length === 0) return;

    // ── 3. 构建 EvaluationInput ──
    const input = buildEvaluationInput(experiences, ctx, tick);
    if (!input) return;

    // ── 4. 调用 domain 纯函数 ──
    const evaluation = evaluateStrategy(input);

    // ── 5. 保存 compact result ──
    pushEvaluation(cache.ringBuffer, evaluation);

    // ── 6. GC ──
    gcEvaluationBuffer(cache.ringBuffer, EVALUATION_MAX_AGE, tick);
    cache.lastEvaluationTick = tick;

    // ── 7. Observability ──
    if (tick % 5000 === 0) {
      const evidence = buildEvaluationEvidence(evaluation, experiences);
      const completeness = validateEvidenceCompleteness(evaluation, experiences);
      console.log(
        `[${tick}] strategy-evaluation: verdict=${evaluation.score.verdict}, ` +
        `confidence=${evaluation.score.confidence.toFixed(2)}, ` +
        `infoScore=${evaluation.score.informationalScore.toFixed(3)}, ` +
        `findings=${evaluation.findings.length}, ` +
        `recommendations=${evaluation.recommendations.length}, ` +
        `evidence_completeness=${completeness.completenessScore.toFixed(2)}`,
      );
    }
  },
};

// ─── 构建 EvaluationInput ───────────────────────────────────

function buildEvaluationInput(
  experiences: readonly ExperienceRecord[],
  ctx: TickContext,
  tick: number,
): EvaluationInput | undefined {
  const g = globalCache();
  const health = g.empireHealth;
  const recoveryStats = g.recoveryStats;
  const logisticsHealth = g.logisticsHealth;

  if (!health) return undefined;

  // 策略类型：从姿态推导
  const strategy = (globalThis as { Memory?: { kernel?: { strategy?: { posture?: string } } } }).Memory?.kernel?.strategy;
  const posture = strategy?.posture ?? "develop";

  // 当前上下文
  const roomCount = countOwnedRooms();
  const rcl = getMaxRcl();
  const threatLevel = health.bottleneck === "threat" ? "HIGH" : "LOW";
  const resourceContext = health.level;

  const currentContext: ContextInfo = {
    rcl,
    roomCount,
    threatLevel,
    posture,
    resourceContext,
  };

  // BaselineKey
  const baselineKey = buildBaselineKey({
    strategyId: posture,
    phase: posture,
    rcl,
    roomCount,
    threatLevel,
  });

  // 提取历史值
  const historicalValues = extractHistoricalValues(experiences);

  // 构建 Baseline
  const baseline = buildBaseline(baselineKey, historicalValues, MODEL_VERSION, tick);

  // MetricSnapshot
  const metrics: MetricSnapshot = {
    economicGrowth: health.score,
    resourceEfficiency: logisticsHealth?.deliveryRate ?? 0.5,
    cpuEfficiency: ctx.budget.tier === "healthy" ? 0.9 : ctx.budget.tier === "guarded" ? 0.75 : ctx.budget.tier === "conserve" ? 0.5 : 0.3,
    riskLevel: threatLevel === "HIGH" ? 0.3 : 0.75,
    survival: health.score,
    expansion: 0.5, // 从扩张 dashboard 推导（简化）
    militaryOutcome: 0.5, // 从 evaluateWarOutcome 推导（简化）
    recoveryCost: recoveryStats
      ? recoveryStats.succeededCount / Math.max(1, recoveryStats.succeededCount + recoveryStats.failedCount)
      : 0.5,
    externalEnergyInflow: 0, // 由调用方检测
  };

  // Evaluation Window
  const window: EvaluationWindow = {
    startTick: tick - 500,
    endTick: tick,
    duration: 500,
    type: "short_term",
  };

  // Outcome 和 Attribution 列表
  const outcomes = experiences
    .filter(e => e.outcome !== undefined)
    .map(e => e.outcome!);
  const attributions = experiences
    .filter(e => e.attribution !== undefined)
    .map(e => e.attribution!);

  return {
    strategyType: posture,
    window,
    experiences,
    outcomes,
    attributions,
    metrics,
    baseline,
    baselineKey,
    currentContext,
    modelVersion: MODEL_VERSION,
    tick,
  };
}

// ─── 辅助函数 ──────────────────────────────────────────────

function countOwnedRooms(): number {
  const game = (globalThis as { Game?: { rooms?: Record<string, { controller?: { my: boolean } }> } }).Game;
  if (!game?.rooms) return 1;
  let count = 0;
  for (const room of Object.values(game.rooms)) {
    if (room.controller?.my) count++;
  }
  return Math.max(1, count);
}

function getMaxRcl(): number {
  const game = (globalThis as { Game?: { rooms?: Record<string, { controller?: { my: boolean; level: number } }> } }).Game;
  if (!game?.rooms) return 1;
  let max = 1;
  for (const room of Object.values(game.rooms)) {
    if (room.controller?.my && room.controller.level > max) {
      max = room.controller.level;
    }
  }
  return max;
}

// ─── 查询口（供 Dashboard / 外部消费）─────────────────────

export function getEvaluationResults(limit = 10): StrategyEvaluation[] {
  const cache = globalCache().__evaluationCache as StrategyEvaluationCache | undefined;
  if (!cache) return [];
  const result: StrategyEvaluation[] = [];
  const start = (cache.ringBuffer.cursor - 1 + cache.ringBuffer.capacity) % cache.ringBuffer.capacity;
  for (let i = 0; i < cache.ringBuffer.count && i < limit; i++) {
    const idx = (start - i + cache.ringBuffer.capacity) % cache.ringBuffer.capacity;
    const r = cache.ringBuffer.records[idx];
    if (r) result.push(r);
  }
  return result;
}

/**
 * 打印 Evaluation Dashboard — 供控制台调用。
 */
export function printEvaluationDashboard(): string {
  const cache = globalCache().__evaluationCache as StrategyEvaluationCache | undefined;
  if (!cache) {
    return "Strategy Evaluation: not initialized yet (runs every 500 ticks)";
  }

  const tick = (globalThis as { Game?: { time?: number } }).Game?.time ?? 0;
  const lines: string[] = [];

  lines.push(`═══ Strategy Evaluation Dashboard @${tick} ═══`);
  lines.push(`Results: ${cache.ringBuffer.count} (capacity=${EVALUATION_RING_BUFFER_CAPACITY})`);
  lines.push(`Last evaluation: tick ${cache.lastEvaluationTick}`);

  // 最近一次评估
  const recent = getEvaluationResults(1);
  if (recent.length > 0) {
    const eval_ = recent[0]!;
    lines.push("");
    lines.push(`Verdict: ${eval_.score.verdict}`);
    lines.push(`Confidence: ${eval_.score.confidence.toFixed(3)}`);
    lines.push(`Informational Score: ${eval_.score.informationalScore.toFixed(3)} (informational only, no decision power)`);
    lines.push(`Samples: ${eval_.score.samples}`);
    lines.push("");

    lines.push("Dimensions:");
    for (const dim of CANONICAL_EVALUATION_DIMENSIONS) {
      const d = eval_.score.dimensions[dim];
      const status = d.comparable
        ? `${d.observed.toFixed(3)} vs ${d.baseline.toFixed(3)} (delta=${d.delta.toFixed(3)}, conf=${d.confidence.toFixed(2)}, trend=${d.trend})`
        : `INCOMPARABLE (${d.incompatibilityReason ?? "context mismatch"})`;
      lines.push(`  ${dim}: ${status}`);
    }

    if (eval_.findings.length > 0) {
      lines.push("");
      lines.push("Findings:");
      for (const f of eval_.findings) {
        lines.push(`  [${f.evidenceType}] ${f.description} (conf=${f.confidence.toFixed(2)})${f.hasExternalFactor ? " [EXTERNAL FACTOR]" : ""}`);
      }
    }

    if (eval_.recommendations.length > 0) {
      lines.push("");
      lines.push("Shadow Recommendations (not auto-applied):");
      for (const r of eval_.recommendations) {
        lines.push(`  ${r.dimension}: ${r.description} (conf=${r.confidence.toFixed(2)})`);
      }
    }
  }

  return lines.join("\n");
}
