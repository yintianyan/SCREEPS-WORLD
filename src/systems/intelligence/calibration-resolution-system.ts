/** A6.4 Calibration Resolution System — 系统层薄壳。 */
import type { Priority, System, TickContext } from "../../kernel/contracts";
import { globalCache } from "../../kernel/global-cache";
import { systemPhase } from "../../kernel/phase";
import type { Prediction } from "../../domain/intelligence/prediction";
import type { PredictionRingBuffer } from "../../domain/intelligence/prediction";
import type { PredictionContext } from "../../domain/intelligence/prediction";
import { makePredictionContext } from "../../domain/intelligence/prediction";
import type {
  CalibrationRingBuffer,
  ExternalFactorSignal,
  ObservationSample,
  ResolutionResult,
} from "../../domain/intelligence/calibration";
import {
  createCalibrationRingBuffer,
  pushResolution,
  gcCalibrationBuffer,
  calibrationBufferStats,
  getPendingResolutionIds,
  isPredictionResolved,
} from "../../domain/intelligence/calibration";
import { resolvePrediction } from "../../domain/intelligence/calibration";
import {
  computeCalibrationStatistics,
} from "../../domain/intelligence/calibration";
import {
  updateProfile,
} from "../../domain/intelligence/calibration";
import {
  CALIBRATION_INTERVAL,
  CALIBRATION_PROFILE_INTERVAL,
  RESOLUTION_GRACE_PERIOD,
  RESOLUTION_MAX_AGE,
  RESOLUTION_RING_BUFFER_CAPACITY,
} from "../../domain/intelligence/calibration";
import {
  validateCalibrationBuffer,
} from "../../domain/intelligence/calibration/guards";

// ─── Calibration Cache ─────────────────────────────────────

interface CalibrationCache {
  ringBuffer: CalibrationRingBuffer;
  lastRunTick: number;
}

// ─── 系统定义 ──────────────────────────────────────────────

export const calibrationResolutionSystem: System = {
  name: "calibration-resolution",
  priority: 3 as Priority,
  interval: CALIBRATION_INTERVAL,
  phase: "post",

  run(ctx: TickContext): void {
    const g = globalCache();
    const tick = ctx.tick;

    // ── 1. 初始化缓存（首次运行或 global reset 后）──
    if (!g.__calibrationCache) {
      g.__calibrationCache = {
        ringBuffer: createCalibrationRingBuffer(RESOLUTION_RING_BUFFER_CAPACITY),
        lastRunTick: 0,
      };
    }
    const cache = g.__calibrationCache as CalibrationCache;

    // ── 2. 从 PredictionCache 获取已到期预测 ──
    const predCache = g.__predictionCache as
      | { ringBuffer: PredictionRingBuffer }
      | undefined;
    if (!predCache?.ringBuffer) {
      cache.lastRunTick = tick;
      return;
    }

    // 获取所有预测（不限 status — A6.3 的 expireOverduePredictions 会在 endTick 时
    // 将预测标记为 expired，但 calibration 需要等到 endTick + grace period 才解析）
    const allPredictions = collectAllPredictions(predCache.ringBuffer);

    // 过滤出已到期且在 grace period 之后的预测
    const predictionEndTicks = new Map<string, number>();
    for (const p of allPredictions) {
      predictionEndTicks.set(p.id, p.window.endTick);
    }

    // 获取需要解析的 prediction IDs
    const pendingIds = getPendingResolutionIds(
      cache.ringBuffer,
      allPredictions.map(p => p.id),
      predictionEndTicks,
      tick,
      RESOLUTION_GRACE_PERIOD,
    );

    // ── 3. 逐个解析 ──
    let resolvedCount = 0;
    for (const predId of pendingIds) {
      // 找到 prediction 对象
      const prediction = allPredictions.find(p => p.id === predId);
      if (!prediction) continue;

      // 跳过已解析的
      if (isPredictionResolved(cache.ringBuffer, predId)) continue;

      // 构建 observations
      const observations = buildObservations(g, prediction);

      // 构建 current context
      const currentContext = buildCurrentContext(ctx, g);
      if (!currentContext) continue;

      // 构建 external factors
      const externalFactors = buildExternalFactors(g, prediction);

      // 调用 Domain 纯函数
      const result = resolvePrediction(
        prediction,
        observations,
        currentContext,
        externalFactors,
      );

      // 写入 Ring Buffer
      pushResolution(cache.ringBuffer, result);
      resolvedCount++;
    }

    // ── 4. 低频计算 ModelCalibrationProfile ──
    if (tick - cache.ringBuffer.lastProfileTick >= CALIBRATION_PROFILE_INTERVAL) {
      const profiles = computeCalibrationStatistics(cache.ringBuffer, allPredictions);
      for (const profile of profiles) {
        updateProfile(cache.ringBuffer, profile);
      }
      cache.ringBuffer.lastProfileTick = tick;
    }

    // ── 5. GC ──
    gcCalibrationBuffer(cache.ringBuffer, tick, RESOLUTION_MAX_AGE);
    cache.lastRunTick = tick;

    // ── 6. 守卫检查（违规只记日志）──
    // P14 修复：cadence 错峰使本系统只在 tick%500===phase 时运行，
    // 绝对 tick%5000===0 与 phase≠0 不相交 → 守卫永不执行。
    // 改为相位相对判定 (tick-phase)%5000===0。
    const calPhase = systemPhase("calibration-resolution", 500);
    if ((tick - calPhase) % 5000 === 0) {
      const violations = validateCalibrationBuffer(cache.ringBuffer);
      if (violations.length > 0) {
        console.log(`[${tick}] calibration: ${violations.length} guard violations`);
        for (const v of violations.slice(0, 5)) {
          console.log(`  ${v.guardId}: ${v.message}`);
        }
      }
    }

    // ── 7. Observability ──
    if ((tick - calPhase) % 5000 === 0) {
      const stats = calibrationBufferStats(cache.ringBuffer);
      console.log(
        `[${tick}] calibration: total=${stats.total}, calibratable=${stats.calibratable}, ` +
        `resolved=${resolvedCount}, profiles=${stats.profileCount}, ` +
        `regimeChanged=${stats.regimeChanged}, externalInterfere=${stats.externalInterference}, ` +
        `insufficientObs=${stats.insufficientObservation}`,
      );
    }
  },
};

// ─── Observation 构建 ─────────────────────────────────────

/**
 * 从 globalCache 既有数据构建 ObservationSample 序列。

 * 不新建采样通道（CAL-007）。
 * 只从既有 TimeSeries / history 数组读取。
 */
function buildObservations(
  g: ReturnType<typeof globalCache>,
  prediction: Prediction,
): ObservationSample[] {
  const samples: ObservationSample[] = [];
  const startTick = prediction.window.startTick;
  const endTick = prediction.window.endTick;

  // 根据预测目标选择数据源
  if (prediction.target === "energy-shortage") {
    // 从 reserveHistory 构建
    const reserveArr = g.__reserveHistory as number[] | undefined;
    if (reserveArr) {
      const len = reserveArr.length;
      const baseTick = endTick - (len - 1) * 100;
      for (let i = 0; i < len; i++) {
        const tick = baseTick + i * 100;
        if (tick >= startTick && tick <= endTick) {
          samples.push({
            tick,
            value: reserveArr[i]!,
            source: "empireHealth.reserve",
          });
        }
      }
    }
  } else if (prediction.target === "spawn-starvation") {
    // 从 spawnQueueDepthHistory 构建
    const queueHistory = g.__spawnQueueDepthHistory;
    if (queueHistory && typeof queueHistory === "object" && "samples" in queueHistory) {
      const ts = queueHistory as { samples: { tick: number; value: number }[] };
      for (const s of ts.samples) {
        if (s.tick >= startTick && s.tick <= endTick) {
          samples.push({
            tick: s.tick,
            value: s.value,
            source: "spawnQueueDepth",
          });
        }
      }
    }
  }

  return samples;
}

// ─── Current Context 构建 ─────────────────────────────────

/**
 * 构建当前 PredictionContext。

 * 从 globalCache + Memory 读取，不新建采样。
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

// ─── External Factors 构建 ─────────────────────────────────

/**
 * 从 A6.1/A6.2 和 globalCache 提取 ExternalFactorSignal。

 * 不新建采样通道，只从既有缓存读取。
 */
function buildExternalFactors(
  g: ReturnType<typeof globalCache>,
  prediction: Prediction,
): ExternalFactorSignal[] {
  const factors: ExternalFactorSignal[] = [];

  // 从 prediction evidence 检查 externalEnergyInflow
  const inflow = prediction.evidence.modelParams["externalEnergyInflow"];
  if (typeof inflow === "number" && inflow > 0) {
    factors.push({
      source: "globalCache",
      description: `External energy inflow: ${inflow}`,
      magnitude: Math.min(1, inflow / 10000),
    });
  }

  // 从 A6.1 Experience Cache 检查 externalFactors
  const expCache = g.__experienceCache as
    | { ringBuffer: { records: unknown[] } }
    | undefined;
  if (expCache?.ringBuffer) {
    for (const record of expCache.ringBuffer.records) {
      if (!record) continue;
      const exp = record as {
        identity: { type: string };
        attribution?: { externalFactors: string[] };
      };
      // 只匹配时间窗口内的 experience
      if (
        exp.identity.type === "economic" ||
        exp.identity.type === "recovery"
      ) {
        if (exp.attribution?.externalFactors && exp.attribution.externalFactors.length > 0) {
          factors.push({
            source: "a61-attribution",
            description: exp.attribution.externalFactors.join(", "),
            magnitude: 0.5,
          });
        }
      }
    }
  }

  // 从 A6.2 Evaluation Cache 检查 findings
  const evalCache = g.__evaluationCache as
    | { ringBuffer: { records: unknown[] } }
    | undefined;
  if (evalCache?.ringBuffer) {
    for (const record of evalCache.ringBuffer.records) {
      if (!record) continue;
      const evalResult = record as {
        findings?: { hasExternalFactor: boolean; externalFactorDescription?: string }[];
      };
      if (evalResult.findings) {
        for (const f of evalResult.findings) {
          if (f.hasExternalFactor) {
            factors.push({
              source: "a62-evaluation",
              description: f.externalFactorDescription ?? "External factor",
              magnitude: 0.5,
            });
          }
        }
      }
    }
  }

  return factors;
}

// ─── 辅助函数 ──────────────────────────────────────────────

/**
 * 从 PredictionRingBuffer 收集所有 Prediction（不限 status）。
 */
function collectAllPredictions(buf: PredictionRingBuffer): Prediction[] {
  const result: Prediction[] = [];
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (r) result.push(r);
  }
  // 按 id 排序确保确定性
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

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
