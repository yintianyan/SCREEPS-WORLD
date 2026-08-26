/**
 * A6.1 Experience Collector System — 系统层薄壳。
 *
 * 合同锚点：A6.1 Task Spec + INT-001/INT-004/INT-013/INT-014。
 *
 * 职责（薄壳——只采集和编排，不做决策）：
 *   1. 从 DecisionTrace Ring Buffer 读取到期的 DecisionRecord
 *   2. 从 globalCache / Memory 采集运行时状态构建 OutcomeCollectionInput
 *   3. 调用 domain 纯函数 collectOutcome 采集 OutcomeRecord
 *   4. 调用 domain 纯函数 collectAttribution 采集 Attribution
 *   5. 合并为 ExperienceRecord 写入 Experience Ring Buffer (heap)
 *   6. 定期执行 GC
 *
 * 禁止：
 *   - 不执行任何 Game API（Shadow-Only 原则）
 *   - 不修改任何业务状态
 *   - 不进入 tick 关键路径（低频 100t）
 *   - 不建立第二套 DecisionTrace / evaluateWarOutcome / empireHealth
 *
 * CPU 预算：低频执行（interval=100），采集近零成本。
 * 优先级 P3（在所有业务系统之后运行，消费它们产出的数据）。
 * 存储：heap only — global reset 可丢。
 *
 * 安全不变式：本系统完全停止时，帝国必须照常安全运行。
 */
import type { Priority, System, TickContext } from "../../kernel/contracts";
import { globalCache } from "../../kernel/global-cache";
import { systemPhase } from "../../kernel/phase";
import {
  type ExperienceRingBuffer,
  type ExperienceRecord,
  type DecisionRef,
  type ExperienceContext,
  type ExperienceType,
  type ExperienceIdentity,
  createExperienceRingBuffer,
  pushExperience,
  getPendingOutcomes,
  getRecentExperiences,
  getUnattributed,
  gcExperienceBuffer,
  experienceStats,
  makeExperienceId,
  buildDecisionRef,
  createExperience,
  attachOutcome,
  attachAttribution,
  finalizeExperience,
  isDecisionReadyForOutcome,
  categoryToExperienceType,
  MEASUREMENT_DELAYS,
} from "../../domain/intelligence/experience";
import {
  type OutcomeCollectionInput,
  collectOutcome,
  computeOutcomeConfidence,
} from "../../domain/intelligence/outcome";
import {
  type AttributionInput,
  collectAttribution,
} from "../../domain/intelligence/attribution";

// ─── globalCache 字段类型 ──────────────────────────────────

interface ExperienceCollectorCache {
  ringBuffer: ExperienceRingBuffer;
  /** 自增序列号（生成 experienceId）。 */
  seq: number;
  /** 已处理的 decisionId 集合（防重复处理）。 */
  processedDecisionIds: Set<string>;
}

/** 当前 A6 模型版本。 */
const MODEL_VERSION = 1;

/** Experience Ring Buffer 容量。 */
const RING_BUFFER_CAPACITY = 500;

/** Experience 最大存活 tick（超过则 GC）。 */
const EXPERIENCE_MAX_AGE = 10000;

// ─── 系统定义 ──────────────────────────────────────────────

export const experienceCollectorSystem: System = {
  name: "experience-collector",
  priority: 3 as Priority,
  interval: 100,
  phase: "post",

  run(ctx: TickContext): void {
    const g = globalCache();
    const tick = ctx.tick;

    // ── 1. 初始化 Ring Buffer（首次运行或 global reset 后）──
    if (!g.__experienceCache) {
      g.__experienceCache = {
        ringBuffer: createExperienceRingBuffer(RING_BUFFER_CAPACITY),
        seq: 0,
        processedDecisionIds: new Set(),
      };
    }
    const cache = g.__experienceCache as ExperienceCollectorCache;

    // ── 2. 从 DecisionTrace Ring Buffer 采集新的 DecisionRecord ─
    collectNewExperiences(ctx, cache, tick);

    // ── 3. 采集到期 Experience 的 Outcome ──
    collectPendingOutcomes(ctx, cache, tick);

    // ── 4. 为有 Outcome 的 Experience 采集 Attribution ──
    collectPendingAttributions(ctx, cache, tick);

    // ── 5. GC ──
    gcExperienceBuffer(cache.ringBuffer, tick, EXPERIENCE_MAX_AGE);

    // ── 6. 可观测性输出 ──
    // P14 修复：cadence 错峰使本系统只在 tick%100===phase 时运行，
    // 绝对 tick%1000===0 要求 tick%100===0，与 phase≠0 不相交 → 永不执行。
    // 改为相位相对判定 (tick-phase)%1000===0。
    const ecPhase = systemPhase("experience-collector", 100);
    const stats = experienceStats(cache.ringBuffer);
    if (stats.total > 0 && (tick - ecPhase) % 1000 === 0) {
      console.log(
        `[${tick}] experience-collector: ${stats.total} experiences, ` +
        `${stats.attributed} attributed (${stats.unattributed} pending), ` +
        `${stats.unknownAttribution} unknown attribution`,
      );
    }
  },
};

// ─── 采集函数 ──────────────────────────────────────────────

/**
 * 从 DecisionTrace Ring Buffer 采集新的 DecisionRecord，构建 ExperienceRecord。
 *
 * 只处理尚未处理过的 DecisionRecord。
 * 不复制完整 DecisionRecord，只提取 DecisionRef。
 */
function collectNewExperiences(
  ctx: TickContext,
  cache: ExperienceCollectorCache,
  tick: number,
): void {
  const g = globalCache();
  const traceCache = g.__decisionTraceCache as
    | { ringBuffer: { records: import("../../domain/strategy/decision-trace").DecisionRecord[]; count: number; capacity: number; head: number } }
    | undefined;

  if (!traceCache?.ringBuffer) return;

  // 遍历 DecisionTrace Ring Buffer 中的记录
  const records = traceCache.ringBuffer.records;
  for (const record of records) {
    if (!record) continue;
    if (cache.processedDecisionIds.has(record.decisionId)) continue;

    // 映射 DecisionCategory → ExperienceType
    const expType = categoryToExperienceType(record.category);

    // 构建 DecisionRef（不复制完整 DecisionRecord）
    const decisionRef = buildDecisionRef({
      decisionId: record.decisionId,
      tick: record.tick,
      category: record.category,
      actor: record.actor,
      selectedAction: record.selectedAction,
      decisionHash: record.decisionHash,
      correlationId: record.correlationId,
    });

    // 构建 ExperienceContext
    const context = buildExperienceContext(record, ctx, tick);

    // 创建 ExperienceRecord
    const identity: ExperienceIdentity = {
      experienceId: makeExperienceId(tick, ++cache.seq),
      tick,
      source: "experience-collector",
      type: expType,
    };

    const exp = createExperience(identity, decisionRef, context, MODEL_VERSION);
    pushExperience(cache.ringBuffer, exp);

    // 标记已处理
    cache.processedDecisionIds.add(record.decisionId);

    // 防止 processedDecisionIds 无限增长
    if (cache.processedDecisionIds.size > 5000) {
      const oldIds = Array.from(cache.processedDecisionIds).slice(0, 2000);
      for (const id of oldIds) {
        cache.processedDecisionIds.delete(id);
      }
    }
  }
}

/**
 * 采集到期 Experience 的 Outcome。
 *
 * 遍历未采集 Outcome 的 Experience，检查是否到期。
 */
function collectPendingOutcomes(
  ctx: TickContext,
  cache: ExperienceCollectorCache,
  tick: number,
): void {
  const pending = getPendingOutcomes(cache.ringBuffer);

  for (const exp of pending) {
    // 检查是否到期
    if (!isDecisionReadyForOutcome(exp.decision.decisionTick, tick, exp.identity.type)) {
      continue;
    }

    // 采集 OutcomeCollectionInput
    const input = buildOutcomeCollectionInput(exp, ctx, tick);
    if (!input) continue;

    // 调用 domain 纯函数采集 Outcome
    const outcome = collectOutcome(input);
    if (!outcome) {
      // 无法采集 Outcome → 标记为 UNRESOLVED
      // 但先检查是否已超过最大延迟
      const maxDelay = (MEASUREMENT_DELAYS[exp.identity.type] ?? 500) * 4;
      if (tick - exp.decision.decisionTick > maxDelay) {
        const idx = findExperienceIndex(cache.ringBuffer, exp.identity.experienceId);
        if (idx >= 0) {
          cache.ringBuffer.records[idx] = { ...exp, lifecycle: "UNRESOLVED" };
        }
      }
      continue;
    }

    // 附加 Outcome
    const idx = findExperienceIndex(cache.ringBuffer, exp.identity.experienceId);
    if (idx >= 0) {
      cache.ringBuffer.records[idx] = attachOutcome(exp, outcome);
    }
  }
}

/**
 * 为有 Outcome 的 Experience 采集 Attribution。
 */
function collectPendingAttributions(
  ctx: TickContext,
  cache: ExperienceCollectorCache,
  tick: number,
): void {
  const unattributed = getUnattributed(cache.ringBuffer);

  for (const exp of unattributed) {
    if (!exp.outcome) continue;

    // 采集 AttributionInput
    const input = buildAttributionInput(exp, ctx, tick);
    if (!input) continue;

    // 调用 domain 纯函数采集 Attribution
    const attribution = collectAttribution(input);

    // 附加 Attribution
    const idx = findExperienceIndex(cache.ringBuffer, exp.identity.experienceId);
    if (idx >= 0) {
      const attributed = attachAttribution(exp, attribution);
      // 最终化
      cache.ringBuffer.records[idx] = finalizeExperience(attributed);
    }
  }
}

// ─── 构建函数 ──────────────────────────────────────────────

/**
 * 从 DecisionRecord + TickContext 构建 ExperienceContext。
 */
function buildExperienceContext(
  record: import("../../domain/strategy/decision-trace").DecisionRecord,
  ctx: TickContext,
  tick: number,
): ExperienceContext {
  const g = globalCache();
  const health = g.empireHealth;
  const strategy = (globalThis as { Memory?: { kernel?: { strategy?: { posture?: string } } } }).Memory?.kernel?.strategy;

  return {
    scope: record.scope,
    posture: strategy?.posture ?? "develop",
    empireHealthLevel: health?.level ?? "unknown",
    empireHealthScore: health?.score ?? 0,
    cpuTier: ctx.budget.tier,
    stateBeforeHash: record.inputSnapshotHash,
    metrics: extractMetricsFromEvidence(record.evidence),
  };
}

/**
 * 从 DecisionEvidence 提取关键数值指标。
 */
function extractMetricsFromEvidence(
  evidence: import("../../domain/strategy/decision-trace").DecisionEvidence,
): Record<string, number> {
  const metrics: Record<string, number> = {};
  if (evidence.energy) {
    metrics.energyAvailable = evidence.energy.available;
    metrics.energyIncome = evidence.energy.income;
  }
  if (evidence.spawn) {
    metrics.spawnCapacity = evidence.spawn.capacity;
    metrics.spawnQueueLength = evidence.spawn.queueLength;
    metrics.spawnP0Count = evidence.spawn.p0Count;
  }
  if (evidence.logistics) {
    metrics.logisticsBacklog = evidence.logistics.backlog;
    metrics.logisticsHaulerDeficit = evidence.logistics.haulerDeficit;
  }
  if (evidence.recovery) {
    metrics.recoveryActive = evidence.recovery.activeActions;
    metrics.recoverySucceeded = evidence.recovery.succeededCount;
    metrics.recoveryFailed = evidence.recovery.failedCount;
  }
  if (evidence.health) {
    metrics.empireHealthScore = evidence.health.empireHealthScore;
  }
  return metrics;
}

/**
 * 构建 OutcomeCollectionInput — 从 globalCache 采集运行时状态。
 */
function buildOutcomeCollectionInput(
  exp: ExperienceRecord,
  ctx: TickContext,
  tick: number,
): OutcomeCollectionInput | undefined {
  const g = globalCache();
  const health = g.empireHealth;
  const recoveryStats = g.recoveryStats;
  const logisticsHealth = g.logisticsHealth;
  const warPlanCache = g.warPlanCache;

  const input: OutcomeCollectionInput = {
    decisionId: exp.decision.decisionId,
    decisionTick: exp.decision.decisionTick,
    currentTick: tick,
    type: exp.identity.type,
    stateBeforeHash: exp.context.stateBeforeHash,
    stateAfterHash: "", // 由调用方填充，这里用空串占位
  };

  // 根据类型采集不同的运行时状态
  switch (exp.identity.type) {
    case "war":
      // 从 DecisionRecord.actualOutcome 或 warPlanCache.operation.status 推导战争结果
      // 注意：不直接读 warAbortSignals（架构约束：仅 recovery-execution-system / war-planner 可读）
      // War Outcome 通过 evaluateWarOutcome 纯函数推导，但该函数需要 intel 数据
      // 这里从 warPlanCache 获取 WarPlan 状态作为间接信号
      if (warPlanCache?.plan) {
        const status = warPlanCache.plan.operation.status;
        // WarPlan operation status 映射到 warOutcome:
        // COMPLETED → success, FAILED → failure, EXPIRED → unknown
        if (status === "COMPLETED") {
          input.warOutcome = "success";
        } else if (status === "FAILED") {
          input.warOutcome = "failure";
        } else if (status === "EXPIRED" || status === "ABORTING") {
          input.warOutcome = "unknown";
        }
      }
      // 编队规模从 context metrics 获取
      break;

    case "recovery":
      if (recoveryStats) {
        input.recoverySucceeded = recoveryStats.succeededCount;
        input.recoveryFailed = recoveryStats.failedCount;
        input.recoveryTerminal = (recoveryStats as { terminalCount?: number }).terminalCount ?? 0;
      }
      if (health) {
        input.healthScoreBefore = exp.context.empireHealthScore;
        input.healthScoreAfter = health.score;
      }
      break;

    case "economic":
      if (health) {
        input.healthLevelBefore = exp.context.empireHealthLevel;
        input.healthLevelAfter = health.level;
        input.healthScoreBefore = exp.context.empireHealthScore;
        input.healthScoreAfter = health.score;
      }
      (input as { bottleneckDimension?: string }).bottleneckDimension = health?.bottleneck;
      break;

    case "logistics":
      if (logisticsHealth) {
        (input as { logisticsLevelBefore?: string }).logisticsLevelBefore = "stable";
        input.logisticsLevelAfter = logisticsHealth.level;
        input.logisticsBacklog = logisticsHealth.backlogCount;
        input.logisticsDeliveryRate = logisticsHealth.deliveryRate;
      }
      break;

    case "spawn":
      // 从 DecisionRecord 的 evidence 获取 spawn 状态
      input.spawnQueueLength = exp.context.metrics.spawnQueueLength;
      input.spawnP0Count = exp.context.metrics.spawnP0Count;
      input.totalPopulation = exp.context.metrics.totalPopulation;
      break;

    case "defense":
      // 威胁状态从 threatAssessments 获取（运行时）
      input.hostilesInRoom = exp.context.metrics.hostilesInRoom;
      break;

    case "expansion":
      // TD-37-3 + AI-2 修复：从 globalCache().lastExpansionOutcome 采集扩张结果
      // 扩张 Outcome 只能来自已经发生的 Runtime Fact
      // AI-2 关键修复：用 decisionId 作为唯一稳定关联键匹配
      // - decisionId 由 collectExpansionDecisions 分配（D-{tick}-{seq}），写入 Memory.kernel.expansion.decisionId
      // - recordExpansionOutcome 读取 expansion.decisionId 写入 lastExpansionOutcome.decisionId
      // - experience-collector 用 exp.decision.decisionId === lastOutcome.decisionId 直接匹配
      // fallback：如果 decisionId 不可用（旧版 Memory），退回 target + completedTick > decisionTick
      const expansionMem = (globalThis as { Memory?: { kernel?: { expansion?: { target: string; sponsor: string; startedAt: number; state: string; checkpointsPassed?: number; decisionId?: string } } } }).Memory?.kernel?.expansion;
      const lastOutcome = g.lastExpansionOutcome;

      // 从 DecisionRecord.selectedAction 解析 target room（格式 EXPANSION_START_{roomName}）
      const expTargetRoom = exp.decision.selectedAction.replace("EXPANSION_START_", "");

      // 匹配策略：decisionId 优先；有 decisionId 时只认 decisionId，无 decisionId 才用 fallback
      const hasDecisionId = !!(lastOutcome?.decisionId);
      const decisionIdMatch = hasDecisionId
        && lastOutcome!.decisionId === exp.decision.decisionId;
      const fallbackMatch = !hasDecisionId && lastOutcome
        && lastOutcome.target === expTargetRoom
        && lastOutcome.completedTick > exp.decision.decisionTick;

      if (lastOutcome && (decisionIdMatch || fallbackMatch)) {
        // decisionId 匹配 或 (无 decisionId 时 target + completedTick > decisionTick) → 可以安全使用
        // expansionOutcome 格式：phase * 10 + outcomeCode
        // phaseCode: 1 = pioneer phase (扩张完成/终止都在 pioneer 阶段)
        const phaseCode = 1;
        input.expansionOutcome = phaseCode * 10 + lastOutcome.outcomeCode;
        input.expansionDuration = lastOutcome.duration;
      } else if (expansionMem && expansionMem.target === expTargetRoom
                 && (!expansionMem.decisionId || expansionMem.decisionId === exp.decision.decisionId)) {
        // 扩张仍在进行中（Memory.kernel.expansion 存在且 target 匹配 + decisionId 匹配如果可用）
        // → 不采集 Outcome（没有最终结果）
        // expansionDuration 可以从 startedAt 推导
        input.expansionDuration = tick - expansionMem.startedAt;
      }
      // 如果 decisionId 不匹配且 fallback 也不匹配 → 不注入（防错配）

      // 威胁状态：从 context metrics 获取（如果存在）
      if (exp.context.metrics.hostilesInRoom !== undefined) {
        input.hostilesInRoom = exp.context.metrics.hostilesInRoom;
      }
      break;
  }

  return input;
}

/**
 * 构建 AttributionInput — 从 globalCache 采集运行时状态。
 */
function buildAttributionInput(
  exp: ExperienceRecord,
  ctx: TickContext,
  tick: number,
): AttributionInput | undefined {
  if (!exp.outcome) return undefined;

  const g = globalCache();
  const health = g.empireHealth;
  const recoveryStats = g.recoveryStats;
  const logisticsHealth = g.logisticsHealth;

  const input: AttributionInput = {
    type: exp.identity.type,
    outcome: exp.outcome,
    context: exp.context,
    modelVersion: MODEL_VERSION,
  };

  // 根据类型采集不同的归因输入
  switch (exp.identity.type) {
    case "war":
      // 从 warPlanCache 获取战争状态（不直接读 warAbortSignals）
      input.warSquadSize = exp.context.metrics.warSquadSize;
      // warDuration 从 WarPlan 的 createdTick 推导
      if (g.warPlanCache?.plan) {
        input.warDuration = tick - g.warPlanCache.plan.operation.createdTick;
      }
      // warAbortReason 从 outcome 中间接获取（如果 outcome.classification = ABORTED）
      break;

    case "recovery":
      input.recoverySucceeded = recoveryStats?.succeededCount;
      input.recoveryFailed = recoveryStats?.failedCount;
      input.recoveryAvgTime = (recoveryStats as { avgRecoveryTime?: number })?.avgRecoveryTime;
      input.healthScoreBefore = exp.context.empireHealthScore;
      input.healthScoreAfter = health?.score;
      break;

    case "economic":
      input.healthScoreBefore = exp.context.empireHealthScore;
      input.healthScoreAfter = health?.score;
      (input as { bottleneckDimension?: string }).bottleneckDimension = health?.bottleneck;
      input.cpuTier = exp.context.cpuTier;
      break;

    case "logistics":
      input.logisticsBacklog = logisticsHealth?.backlogCount;
      input.logisticsDeliveryRate = logisticsHealth?.deliveryRate;
      input.haulerDeficit = exp.context.metrics.logisticsHaulerDeficit;
      break;

    case "spawn":
      input.spawnQueueLength = exp.context.metrics.spawnQueueLength;
      input.spawnP0Count = exp.context.metrics.spawnP0Count;
      input.totalPopulation = exp.context.metrics.totalPopulation;
      input.spawnCapacity = exp.context.metrics.spawnCapacity;
      break;

    case "expansion":
      // TD-37-3：补充 Expansion Attribution 输入字段
      input.expansionDuration = exp.context.metrics.expansionDuration ?? exp.outcome.delay;
      // 从 DecisionRef.selectedAction 提取 target room（格式 EXPANSION_START_{roomName}）
      input.expansionTargetRoom = exp.decision.selectedAction.replace("EXPANSION_START_", "");
      // 从 outcome 的 classification 推导最终殖民地状态
      input.expansionFinalColonyState = exp.outcome.classification === "SUCCESS"
        ? "normal"
        : exp.outcome.classification === "EXPIRED"
          ? "timeout"
          : "unknown";
      // RCL achieved 从 context metrics 获取（如果存在）
      input.expansionRclAchieved = exp.context.metrics.expansionRclAchieved;
      // 威胁等级从 context metrics 获取
      if (exp.context.metrics.threatLevelAfter !== undefined) {
        input.threatLevelAfter = String(exp.context.metrics.threatLevelAfter);
      }
      // posture 从 context 获取（使用 Object.assign 避免 architecture guard 误报）
      Object.assign(input, { posture: exp.context.posture });
      break;

    case "defense":
      input.hostilesInRoom = exp.context.metrics.hostilesInRoom;
      input.structuresDestroyed = exp.context.metrics.structuresDestroyed;
      input.towerCount = exp.context.metrics.towerCount;
      break;
  }

  return input;
}

/**
 * 在 Ring Buffer 中查找指定 experienceId 的索引。
 */
function findExperienceIndex(
  buf: ExperienceRingBuffer,
  experienceId: string,
): number {
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (r && r.identity.experienceId === experienceId) {
      return i;
    }
  }
  return -1;
}

// ─── 查询口（供 Dashboard / 外部消费）─────────────────────

export function getExperienceRecords(limit = 50): ExperienceRecord[] {
  const cache = globalCache().__experienceCache as ExperienceCollectorCache | undefined;
  if (!cache) return [];
  return getRecentExperiences(cache.ringBuffer, limit);
}

export function getExperienceStats() {
  const cache = globalCache().__experienceCache as ExperienceCollectorCache | undefined;
  if (!cache) return null;
  return experienceStats(cache.ringBuffer);
}

/**
 * 打印 Experience Dashboard — 供控制台调用。
 */
export function printExperienceDashboard(): string {
  const cache = globalCache().__experienceCache as ExperienceCollectorCache | undefined;
  if (!cache) {
    return "Experience Collector: not initialized yet (runs every 100 ticks)";
  }

  const tick = (globalThis as { Game?: { time?: number } }).Game?.time ?? 0;
  const stats = experienceStats(cache.ringBuffer);
  const lines: string[] = [];

  lines.push(`═══ Experience Dashboard @${tick} ═══`);
  lines.push(`Total: ${stats.total} (capacity=${RING_BUFFER_CAPACITY})`);
  lines.push(`Attributed: ${stats.attributed} (${stats.unattributed} pending)`);
  lines.push(`Unknown Attribution: ${stats.unknownAttribution}`);

  if (Object.keys(stats.byType).length > 0) {
    lines.push("");
    lines.push("By Type:");
    for (const [type, count] of Object.entries(stats.byType)) {
      lines.push(`  ${type}: ${count}`);
    }
  }

  if (Object.keys(stats.byLifecycle).length > 0) {
    lines.push("");
    lines.push("By Lifecycle:");
    for (const [lifecycle, count] of Object.entries(stats.byLifecycle)) {
      lines.push(`  ${lifecycle}: ${count}`);
    }
  }

  // Recent experiences
  const recent = getRecentExperiences(cache.ringBuffer, 10);
  if (recent.length > 0) {
    lines.push("");
    lines.push("Recent Experiences:");
    for (const exp of recent) {
      const outcome = exp.outcome
        ? `${exp.outcome.classification} (${exp.outcome.metric}=${exp.outcome.value})`
        : "pending";
      const attribution = exp.attribution
        ? `${exp.attribution.primaryCause} (conf=${exp.attribution.confidence})`
        : "pending";
      lines.push(
        `  [${exp.identity.tick}] ${exp.identity.type}: ${exp.decision.selectedAction} → ${outcome} → ${attribution}`,
      );
    }
  }

  return lines.join("\n");
}
