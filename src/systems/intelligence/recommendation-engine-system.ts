/**
 * A6.6 Recommendation Engine System — 系统层薄壳。
 *
 * 合同锚点：A6_6_ARCHITECTURE.md · A6_6_SAFETY_BOUNDARY.md
 *
 * 职责（薄壳——只采集和编排，不做决策）：
 *   1. 从 globalCache.__experienceCache / __evaluationCache / __predictionCache / __calibrationCache 只读采集数据
 *   2. 调用 A6.5 computeIntelligenceState 获取 IntelligenceState（瞬态）
 *   3. 调用 A6.6 Domain 纯函数构建 EvidenceItem[] + EvidenceTrace
 *   4. 调用 A6.6 Domain 纯函数 generateRecommendations
 *   5. 调用 A6.6 Domain 纯函数 detectConflicts + attachConflictIds
 *   6. 调用 A6.6 Domain 纯函数 lifecycle 管理（TTL / Supersede / GC）
 *   7. 将结果写入 globalCache.__recommendationCache
 *   8. 可观测性输出
 *
 * 禁止（REC-001~014）：
 *   - 不调用 Game API（REC-003）
 *   - 不修改任何业务状态（REC-004）
 *   - 不修改 Strategy / Posture（REC-007）
 *   - 不进入 tick 关键路径（低频 500t）
 *   - 不新建采样通道（复用 A6.1-A6.5 cadence）
 *   - 不建立第二套 Metrics / Strategy / Prediction / Calibration / Reliability
 *   - Recommendation 不自动进入任何执行系统（REC-006）
 *
 * CPU 预算：低频执行（interval=500），每 tick 近零成本。
 * 优先级 P3（在所有业务系统之后运行，消费它们产出的数据）。
 * 存储：heap only — global reset 可丢。
 *
 * 安全不变式：本系统完全停止时，帝国必须照常安全运行。
 */
import type { Priority, System, TickContext } from "../../kernel/contracts";
import { globalCache } from "../../kernel/global-cache";
import { systemPhase } from "../../kernel/phase";
import type { ExperienceRecord, ExperienceRingBuffer } from "../../domain/intelligence/experience";
import { getRecentExperiences } from "../../domain/intelligence/experience";
import type { StrategyEvaluation } from "../../domain/intelligence/strategy-evaluation";
import type { Prediction, PredictionRingBuffer, PredictionContext } from "../../domain/intelligence/prediction";
import { makePredictionContext, buildPredictionContextSignature } from "../../domain/intelligence/prediction";
import type {
  CalibrationRingBuffer,
  ResolutionResult,
  ModelCalibrationProfile,
  ModelFailureStats,
} from "../../domain/intelligence/calibration";
import { computeIntelligenceState } from "../../domain/intelligence/reliability/compute-state";
import type { IntelligenceStateInput } from "../../domain/intelligence/reliability/compute-state";
import type { IntelligenceState } from "../../domain/intelligence/reliability/types";
import { INTELLIGENCE_STATE_INTERVAL } from "../../domain/intelligence/reliability/types";

// A6.6 Domain imports
import {
  type RecommendationRingBuffer,
  type RecommendationCandidate,
  type EvidenceItem,
  createRecommendationRingBuffer,
  RECOMMENDATION_RING_BUFFER_CAPACITY,
  CONFLICT_RING_BUFFER_CAPACITY,
  RECOMMENDATION_MAX_AGE,
  RECOMMENDATION_INTERVAL,
  MAX_EVIDENCE_ITEMS,
} from "../../domain/intelligence/recommendation/types";
import {
  buildExperienceEvidence,
  buildAttributionEvidence,
  buildEvaluationEvidence,
  buildPredictionEvidence,
  buildCalibrationEvidence,
  buildReliabilityEvidence,
  assembleEvidenceTrace,
} from "../../domain/intelligence/recommendation/evidence-builder";
import {
  generateRecommendations,
  type RecommendationGeneratorInput,
} from "../../domain/intelligence/recommendation/generator";
import {
  detectConflicts,
  attachConflictIds,
} from "../../domain/intelligence/recommendation/conflict-detector";
import {
  pushRecommendation,
  pushConflict,
  expireOverdueRecommendations,
  expireByRegimeChange,
  processSupersession,
  validateRecommendation,
  gcRecommendationBuffer,
  getActiveRecommendations,
  getActiveConflicts,
  getRecentRecommendations,
  recommendationStats,
} from "../../domain/intelligence/recommendation/lifecycle";
import {
  rankRecommendations,
  getTopRecommendations,
} from "../../domain/intelligence/recommendation/ranking";
import {
  validateRecommendationBuffer,
  validateSystemGuards,
} from "../../domain/intelligence/recommendation/guards";

// ─── System 定义 ──────────────────────────────────────────

export const recommendationEngineSystem: System = {
  name: "recommendation-engine",
  priority: 3 as Priority,
  interval: RECOMMENDATION_INTERVAL,
  phase: "post",

  run(ctx: TickContext): void {
    const g = globalCache();
    const tick = ctx.tick;

    // ── 1. 初始化缓存（首次运行或 global reset 后）──
    if (!g.__recommendationCache) {
      g.__recommendationCache = {
        ringBuffer: createRecommendationRingBuffer(
          RECOMMENDATION_RING_BUFFER_CAPACITY,
          CONFLICT_RING_BUFFER_CAPACITY,
        ),
        lastRunTick: 0,
      };
    }
    const cache = g.__recommendationCache as RecommendationCache;
    const buf = cache.ringBuffer;

    // ── 2. 从 A6.1-A6.5 只读采集数据 ──
    const experiences = collectExperiences(g);
    const evaluation = collectLatestEvaluation(g);
    const predictions = collectPredictions(g);
    const { resolutions, profiles, failureStats } = collectCalibration(g);

    // ── 3. 构建 PredictionContext ──
    // ── 3. 构建 RecommendationContext ──
    const recPhase = systemPhase("recommendation-engine", RECOMMENDATION_INTERVAL);
    const currentContext = buildCurrentContext(ctx, g);
    if (!currentContext) {
      // 冷启动：empireHealth 尚未产出
      // P14 修复：改为相位相对判定 (tick-phase)%5000===0。
      if ((tick - recPhase) % 5000 === 0) {
        console.log(`[${tick}] recommendation-engine: cold start (no empireHealth)`);
      }
      return;
    }

    const currentSignature = buildPredictionContextSignature(currentContext);

    // ── 4. 调用 A6.5 computeIntelligenceState 获取 IntelligenceState ──
    const intelState = computeIntelState(
      predictions,
      resolutions,
      profiles,
      failureStats,
      currentContext,
      tick,
    );

    // ── 5. 构建 EvidenceItem[] ──
    const evidenceItems: EvidenceItem[] = [
      ...buildExperienceEvidence(experiences, MAX_EVIDENCE_ITEMS),
      ...buildAttributionEvidence(experiences, MAX_EVIDENCE_ITEMS),
      ...buildEvaluationEvidence(evaluation, MAX_EVIDENCE_ITEMS),
      ...buildPredictionEvidence(predictions, MAX_EVIDENCE_ITEMS),
      ...buildCalibrationEvidence(resolutions, profiles, MAX_EVIDENCE_ITEMS),
      ...buildReliabilityEvidence(intelState, MAX_EVIDENCE_ITEMS),
    ];

    // ── 6. 组装 EvidenceTrace ──
    const trace = assembleEvidenceTrace(evidenceItems);

    // ── 7. 判断 dataSufficient 和 regimeCompatible ──
    const dataSufficient = intelState?.dataSufficiency.sufficient ?? false;
    const regimeCompatible = intelState?.regimeFit.currentRegimeMatched ?? true;

    // ── 8. 生成 Recommendations ──
    const genInput: RecommendationGeneratorInput = {
      trace,
      contextSignature: currentSignature,
      dataSufficient,
      regimeCompatible,
      currentTick: tick,
      seq: buf.seq,
    };

    const results = generateRecommendations(genInput);

    // ── 9. 处理结果（写入 Ring Buffer）──
    let newRecs: RecommendationCandidate[] = [];
    for (const result of results) {
      if ("recommendationId" in result) {
        // 有效 Recommendation
        let rec = result;
        // Supersede: 同 category+target 的旧建议
        rec = processSupersession(buf, rec);
        // validate lifecycle: created → valid
        rec = validateRecommendation(rec);
        // 写入 Ring Buffer
        pushRecommendation(buf, rec);
        newRecs.push(rec);
      }
      // NO_RECOMMENDATION 结果不写入，只在可观测性中记录
    }

    // 更新 seq
    buf.seq += results.length;

    // ── 10. 冲突检测 ──
    const activeRecs = getActiveRecommendations(buf);
    const conflicts = detectConflicts(activeRecs, tick);

    // 将冲突写入 Ring Buffer
    for (const c of conflicts) {
      pushConflict(buf, c);
    }

    // 将冲突 ID 关联到 Recommendations
    if (conflicts.length > 0) {
      const withConflictIds = attachConflictIds(activeRecs, conflicts);
      // 更新 Ring Buffer 中的记录
      for (const updated of withConflictIds) {
        updateRecordInBuffer(buf, updated);
      }
    }

    // ── 11. Lifecycle 管理 ──
    // TTL 过期
    expireOverdueRecommendations(buf, tick);
    // Regime 变化失效
    expireByRegimeChange(buf, currentSignature);

    // ── 12. GC ──
    gcRecommendationBuffer(buf, tick, RECOMMENDATION_MAX_AGE);

    cache.lastRunTick = tick;

    // ── 13. 可观测性输出 ──
    // P14 修复：改为相位相对判定 (tick-phase)%5000===0。
    if ((tick - recPhase) % 5000 === 0) {
      const stats = recommendationStats(buf);
      const activeConflicts = getActiveConflicts(buf);
      const ranked = rankRecommendations(getActiveRecommendations(buf));
      const topRecs = getTopRecommendations(ranked, 3);

      console.log(
        `[${tick}] recommendation-engine: total=${stats.total}, active=${stats.active}, ` +
        `expired=${stats.expired}, superseded=${stats.superseded}, ` +
        `conflicts=${activeConflicts.length}, ` +
        `evidence_items=${evidenceItems.length}, ` +
        `evidence_complete=${trace.complete}`,
      );

      if (topRecs.length > 0) {
        for (const r of topRecs) {
          console.log(
            `  ${r.recommendationId} [${r.urgency}] ${r.category}: ${r.description} ` +
            `(conf=${r.confidence.toFixed(2)}, evidence=${r.evidence.length})`,
          );
        }
      }

      // 守卫验证
      const guardViolations = validateRecommendationBuffer(buf);
      if (guardViolations.length > 0) {
        for (const v of guardViolations.slice(0, 5)) {
          console.log(`  GUARD ${v.guardId}: ${v.message}`);
        }
      }

      const sysGuards = validateSystemGuards(recommendationEngineSystem);
      for (const v of sysGuards.filter(g => !g.passed)) {
        console.log(`  SYS_GUARD ${v.guardId}: ${v.message}`);
      }
    }
  },
};

// ─── Recommendation Cache ─────────────────────────────────

export interface RecommendationCache {
  ringBuffer: RecommendationRingBuffer;
  lastRunTick: number;
}

// ─── 数据采集（只读） ────────────────────────────────────

function collectExperiences(g: ReturnType<typeof globalCache>): ExperienceRecord[] {
  const expCache = g.__experienceCache as
    | { ringBuffer: ExperienceRingBuffer }
    | undefined;
  if (!expCache?.ringBuffer) return [];
  return getRecentExperiences(expCache.ringBuffer, 100);
}

function collectLatestEvaluation(g: ReturnType<typeof globalCache>): StrategyEvaluation | undefined {
  const evalCache = g.__evaluationCache as
    | { ringBuffer: { records: (StrategyEvaluation | undefined)[]; count: number; cursor: number; capacity: number } }
    | undefined;
  if (!evalCache?.ringBuffer) return undefined;

  const rb = evalCache.ringBuffer;
  if (rb.count === 0) return undefined;
  const start = (rb.cursor - 1 + rb.capacity) % rb.capacity;
  for (let i = 0; i < rb.count; i++) {
    const idx = (start - i + rb.capacity) % rb.capacity;
    const r = rb.records[idx];
    if (r) return r;
  }
  return undefined;
}

function collectPredictions(g: ReturnType<typeof globalCache>): Prediction[] {
  const predCache = g.__predictionCache as
    | { ringBuffer: PredictionRingBuffer }
    | undefined;
  if (!predCache?.ringBuffer) return [];
  const result: Prediction[] = [];
  for (let i = 0; i < predCache.ringBuffer.records.length; i++) {
    const r = predCache.ringBuffer.records[i];
    if (r) result.push(r);
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

function collectCalibration(g: ReturnType<typeof globalCache>): {
  resolutions: ResolutionResult[];
  profiles: ModelCalibrationProfile[];
  failureStats: { modelKey: string; stats: ModelFailureStats }[];
} {
  const calCache = g.__calibrationCache as
    | { ringBuffer: CalibrationRingBuffer }
    | undefined;
  if (!calCache?.ringBuffer) {
    return { resolutions: [], profiles: [], failureStats: [] };
  }

  const rb = calCache.ringBuffer;

  // Resolutions
  const resolutions: ResolutionResult[] = [];
  for (let i = 0; i < rb.resolutionRecords.length; i++) {
    const r = rb.resolutionRecords[i];
    if (r) resolutions.push(r);
  }
  resolutions.sort((a, b) => a.predictionId.localeCompare(b.predictionId));

  // Profiles
  const profiles: ModelCalibrationProfile[] = [];
  if (rb.profiles) {
    for (const p of rb.profiles.values()) {
      profiles.push(p);
    }
  }
  profiles.sort((a, b) => a.modelKey.localeCompare(b.modelKey));

  // Failure stats
  const failureStats: { modelKey: string; stats: ModelFailureStats }[] = [];
  if (rb.failureStats) {
    for (const [key, stats] of rb.failureStats) {
      failureStats.push({ modelKey: key, stats });
    }
  }
  failureStats.sort((a, b) => a.modelKey.localeCompare(b.modelKey));

  return { resolutions, profiles, failureStats };
}

function computeIntelState(
  predictions: Prediction[],
  resolutions: ResolutionResult[],
  profiles: ModelCalibrationProfile[],
  failureStats: { modelKey: string; stats: ModelFailureStats }[],
  currentContext: PredictionContext,
  tick: number,
): IntelligenceState | undefined {
  if (predictions.length === 0 && resolutions.length === 0) {
    return undefined;
  }

  try {
    const input: IntelligenceStateInput = {
      predictions,
      resolutions,
      profiles,
      failureStats,
      currentContext,
      currentTick: tick,
    };
    return computeIntelligenceState(input);
  } catch {
    return undefined;
  }
}

// ─── PredictionContext 构建 ──────────────────────────────

function buildCurrentContext(
  ctx: TickContext,
  g: ReturnType<typeof globalCache>,
): PredictionContext | undefined {
  const health = g.empireHealth;
  if (!health) return undefined;

  const strategy = (globalThis as { Memory?: { kernel?: { strategy?: { posture?: string } } } }).Memory?.kernel?.strategy;
  const posture = strategy?.posture ?? "develop";
  const watchdogTier = ctx.budget.tier;
  const roomCount = countOwnedRooms();
  const maxRcl = getMaxRcl();
  const threatLevel = health.bottleneck === "threat" ? "HIGH" : "LOW";

  return makePredictionContext({
    posture,
    watchdogTier,
    roomCount,
    maxRcl,
    threatLevel,
  });
}

// ─── 辅助函数 ─────────────────────────────────────────────

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

/**
 * 更新 Ring Buffer 中的记录（用于冲突 ID 关联后）。
 */
function updateRecordInBuffer(
  buf: RecommendationRingBuffer,
  rec: RecommendationCandidate,
): void {
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (r && r.recommendationId === rec.recommendationId) {
      buf.records[i] = rec;
      return;
    }
  }
}

// ─── 查询口（供 Dashboard / 外部消费，只读）─────────────

export function getRecommendations(limit = 20): RecommendationCandidate[] {
  const cache = globalCache().__recommendationCache as RecommendationCache | undefined;
  if (!cache) return [];
  return getRecentRecommendations(cache.ringBuffer, limit);
}

export function getActiveRecommendationList(): RecommendationCandidate[] {
  const cache = globalCache().__recommendationCache as RecommendationCache | undefined;
  if (!cache) return [];
  return getActiveRecommendations(cache.ringBuffer);
}

/**
 * 打印 Recommendation Dashboard — 供控制台调用。
 */
export function printRecommendationDashboard(): string {
  const cache = globalCache().__recommendationCache as RecommendationCache | undefined;
  if (!cache) {
    return "Recommendation Engine: not initialized yet (runs every 500 ticks)";
  }

  const tick = (globalThis as { Game?: { time?: number } }).Game?.time ?? 0;
  const stats = recommendationStats(cache.ringBuffer);
  const activeConflicts = getActiveConflicts(cache.ringBuffer);
  const ranked = rankRecommendations(getActiveRecommendations(cache.ringBuffer));
  const lines: string[] = [];

  lines.push(`═══ Recommendation Dashboard @${tick} ═══`);
  lines.push(`Total: ${stats.total} (capacity=${RECOMMENDATION_RING_BUFFER_CAPACITY})`);
  lines.push(`Active: ${stats.active}, Expired: ${stats.expired}, Superseded: ${stats.superseded}`);
  lines.push(`Conflicts: ${stats.conflicts} (capacity=${CONFLICT_RING_BUFFER_CAPACITY})`);

  if (ranked.length > 0) {
    lines.push("");
    lines.push("Ranked Active Recommendations:");
    for (const r of ranked.slice(0, 10)) {
      lines.push(
        `  [${r.urgency}] ${r.category}: ${r.description} ` +
        `(conf=${r.confidence.toFixed(2)}, evidence=${r.evidence.length}, ` +
        `TTL=${r.validity.ttl}, conflicts=${r.conflictIds.length})`,
      );
    }
  }

  if (activeConflicts.length > 0) {
    lines.push("");
    lines.push("Active Conflicts:");
    for (const c of activeConflicts) {
      lines.push(
        `  ${c.type} [${c.severity}]: ${c.description} ` +
        `(${c.participantIds.length} participants)`,
      );
    }
  }

  return lines.join("\n");
}
