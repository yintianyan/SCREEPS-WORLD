/** A6.5 IntelligenceState System — 系统层薄壳。 */
import type { Priority, System, TickContext } from "../../kernel/contracts";
import { globalCache } from "../../kernel/global-cache";
import { systemPhase } from "../../kernel/phase";
import type { Prediction } from "../../domain/intelligence/prediction";
import type { PredictionRingBuffer } from "../../domain/intelligence/prediction";
import type { PredictionContext } from "../../domain/intelligence/prediction";
import { makePredictionContext } from "../../domain/intelligence/prediction";
import type {
  CalibrationRingBuffer,
  ResolutionResult,
  ModelCalibrationProfile,
  ModelFailureStats,
} from "../../domain/intelligence/calibration";
import { computeIntelligenceState } from "../../domain/intelligence/reliability/compute-state";
import type { IntelligenceStateInput } from "../../domain/intelligence/reliability/compute-state";
import type { IntelligenceState } from "../../domain/intelligence/reliability/types";
import {
  validateIntelligenceState,
  guardRelReadOnly,
  guardRelNoStrategyMutation,
  guardRelNoNewSampler,
} from "../../domain/intelligence/reliability/guards";
import { INTELLIGENCE_STATE_INTERVAL } from "../../domain/intelligence/reliability/types";
import { log } from "../../kernel/log";

// ─── System 定义 ──────────────────────────────────────────

export const intelligenceStateSystem: System = {
  name: "intelligence-state",
  priority: 3 as Priority,
  interval: INTELLIGENCE_STATE_INTERVAL,
  phase: "post",

  run(ctx: TickContext): void {
    const g = globalCache();
    const tick = ctx.tick;

    // ── 1. 从 A6.3 __predictionCache 只读采集 ──
    const predCache = g.__predictionCache as
      | { ringBuffer: PredictionRingBuffer }
      | undefined;
    const predictions: Prediction[] = predCache?.ringBuffer
      ? collectAllPredictions(predCache.ringBuffer)
      : [];

    // ── 2. 从 A6.4 __calibrationCache 只读采集 ──
    const calCache = g.__calibrationCache as
      | CalibrationCache
      | undefined;
    const resolutions: ResolutionResult[] = calCache?.ringBuffer
      ? collectAllResolutions(calCache.ringBuffer)
      : [];
    const profiles: ModelCalibrationProfile[] = calCache?.ringBuffer
      ? collectAllProfiles(calCache.ringBuffer)
      : [];
    const failureStats: { modelKey: string; stats: ModelFailureStats }[] =
      calCache?.ringBuffer
        ? collectAllFailureStats(calCache.ringBuffer)
        : [];

    // ── 3. 构建 PredictionContext ──
    const isPhase = systemPhase("intelligence-state", INTELLIGENCE_STATE_INTERVAL);
    const currentContext = buildCurrentContext(ctx, g);
    if (!currentContext) {
      // 冷启动：empireHealth 尚未产出
      // P14 修复：改为相位相对判定 (tick-phase)%5000===0。
      if ((tick - isPhase) % 5000 === 0) {
        log.info("intelligence-state-system", `intelligence-state: cold start (no empireHealth)`);
      }
      return;
    }

    // ── 4. 调用 Domain 纯函数 ──
    const input: IntelligenceStateInput = {
      predictions,
      resolutions,
      profiles,
      failureStats,
      currentContext,
      currentTick: tick,
    };

    let state: IntelligenceState;
    try {
      state = computeIntelligenceState(input);
    } catch (err) {
      log.error("intelligence-state-system", `intelligence-state: compute failed — ${String(err)}`);
      return;
    }

    // ── 5. 运行 REL 守卫检查 ──
    // P14 修复：改为相位相对判定 (tick-phase)%5000===0。
    if ((tick - isPhase) % 5000 === 0) {
      const violations = validateIntelligenceState(state);
      if (violations.length > 0) {
        for (const v of violations.slice(0, 5)) {
          log.info("intelligence-state-system", `intelligence-state guard ${v.guardId}: ${v.message}`);
        }
      }

      // 系统级守卫
      const sysViolations = [
        guardRelReadOnly(intelligenceStateSystem),
        guardRelNoStrategyMutation(intelligenceStateSystem),
        guardRelNoNewSampler(intelligenceStateSystem),
      ].filter(v => !v.passed);
      for (const v of sysViolations) {
        log.info("intelligence-state-system", `intelligence-state guard ${v.guardId}: ${v.message}`);
      }
    }

    // ── 6. 可观测性输出（每 5000t）──
    // P14 修复：改为相位相对判定。
    if ((tick - isPhase) % 5000 === 0) {
      const summary = formatStateSummary(state);
      log.info("intelligence-state-system", `intelligence-state: ${summary}`);
    }
  },
};

// ─── Calibration Cache 形态 ──────────────────────────────

interface CalibrationCache {
  ringBuffer: CalibrationRingBuffer;
  lastRunTick: number;
}

// ─── 数据采集（只读） ────────────────────────────────────

/**
 * 从 PredictionRingBuffer 收集所有 Prediction（不限 status）。
 * 按 id 排序确保确定性。
 */
function collectAllPredictions(buf: PredictionRingBuffer): Prediction[] {
  const result: Prediction[] = [];
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (r) result.push(r);
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

/**
 * 从 CalibrationRingBuffer 收集所有 ResolutionResult。
 * 按 predictionId 排序确保确定性。
 */
function collectAllResolutions(
  buf: CalibrationRingBuffer,
): ResolutionResult[] {
  const result: ResolutionResult[] = [];
  for (let i = 0; i < buf.resolutionRecords.length; i++) {
    const r = buf.resolutionRecords[i];
    if (r) result.push(r);
  }
  result.sort((a, b) => a.predictionId.localeCompare(b.predictionId));
  return result;
}

/**
 * 从 CalibrationRingBuffer 收集所有 ModelCalibrationProfile。
 * 按 modelKey 排序确保确定性。
 */
function collectAllProfiles(
  buf: CalibrationRingBuffer,
): ModelCalibrationProfile[] {
  const result: ModelCalibrationProfile[] = [];
  for (const profile of buf.profiles.values()) {
    result.push(profile);
  }
  result.sort((a, b) => a.modelKey.localeCompare(b.modelKey));
  return result;
}

/**
 * 从 CalibrationRingBuffer 收集所有 ModelFailureStats。
 * 按 modelKey 排序确保确定性。
 */
function collectAllFailureStats(
  buf: CalibrationRingBuffer,
): { modelKey: string; stats: ModelFailureStats }[] {
  const result: { modelKey: string; stats: ModelFailureStats }[] = [];
  if (buf.failureStats) {
    for (const [modelKey, stats] of buf.failureStats) {
      result.push({ modelKey, stats });
    }
  }
  result.sort((a, b) => a.modelKey.localeCompare(b.modelKey));
  return result;
}

// ─── PredictionContext 构建 ──────────────────────────────

/**
 * 构建当前 PredictionContext。
 * 复用 prediction-system 和 calibration-resolution-system 的相同逻辑。
 */
function buildCurrentContext(
  ctx: TickContext,
  g: ReturnType<typeof globalCache>,
): PredictionContext | undefined {
  const health = g.empireHealth;
  if (!health) return undefined;

  // 从 Memory 读取姿态
  const strategy = (globalThis as { Memory?: { kernel?: { strategy?: { posture?: string } } } }).Memory?.kernel?.strategy;
  const posture = strategy?.posture ?? "develop";

  // 看门狗档位
  const watchdogTier = ctx.budget.tier;

  // 房间数量和最高 RCL
  const roomCount = countOwnedRooms();
  const maxRcl = getMaxRcl();

  // 威胁等级
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
 * 格式化 IntelligenceState 摘要供 console.log 输出。
 */
function formatStateSummary(state: IntelligenceState): string {
  const coverage = state.predictionCoverage;
  const health = state.calibrationHealth;
  const suff = state.dataSufficiency;
  const unc = state.uncertainty;
  const fresh = state.knowledgeFreshness;

  return (
    `models=${coverage.implementedModels}/${coverage.plannedModels}, ` +
    `conflicts=${state.predictionConflicts.length}, ` +
    `drift=${health.driftDetected ? health.driftDirection : "none"}, ` +
    `coverage=${coverage.activePredictions} active, ` +
    `sufficient=${suff.sufficient}, ` +
    `freshness=${fresh.overallFreshness}, ` +
    `uncertainty=${unc.dominantSource ?? "none"}, ` +
    `calStatus=${health.status}`
  );
}
