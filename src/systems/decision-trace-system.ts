/**
 * A4.7 Decision Trace System — 系统层薄壳。
 *
 * 合同锚点：A4.7 Task Spec §5 Domain/System 分离 + §32 CPU Budget。
 *
 * 职责（薄壳——只采集和编排，不做决策）：
 *   1. 从 globalCache / Memory / Game 采集运行时状态
 *   2. 适配为 DecisionSnapshot（纯函数输入格式）
 *   3. 调用 domain 纯函数生成 DecisionRecord（写入 Ring Buffer）
 *   4. 定期执行 Trace GC
 *   5. 提供 Dashboard / 查询接口
 *
 * 禁止：
 *   - 不做任何业务决策（决策由各业务系统自己做）
 *   - 不修改任何业务状态
 *   - 不进入 tick 关键路径（低频 100t）
 *   - Replay 不在此系统运行（Replay 只在测试/诊断环境）
 *
 * CPU 预算：低频执行（interval=100），Snapshot 生成近零成本。
 * 优先级 P3（在所有业务系统之后运行，采集它们产出的决策信号）。
 * 存储：heap only — global reset 可丢。
 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import {
  type DecisionSnapshot,
  type DecisionRecord,
  type DecisionReason,
  type DecisionEvidence,
  type DecisionCategory,
  type DecisionSeverity,
  type RejectedAlternative,
  type TraceRingBuffer,
  type TraceQuery,
  type MemoryBudgetResult,
  type IntegrityCheckResult,
  type DecisionChainEntry,
  createRingBuffer,
  pushRecord,
  getRecentRecords,
  gcTrace,
  queryRecords,
  traceChain,
  measureMemoryBudget,
  checkTraceIntegrity,
  snapshotHash,
  decisionHash,
  makeCorrelationId,
  makeDecisionId,
  buildDecisionChain,
} from "../domain/strategy/decision-trace";
import type { ThreatAssessment, ThreatLevel, ThreatIntent } from "../domain/defense/threat-assessment";
import type { RemoteDefenseDecision, RemoteDefenseAction } from "../domain/defense/remote-defense";

// ─── globalCache 字段类型 ──────────────────────────────────

interface DecisionTraceCache {
  ringBuffer: TraceRingBuffer;
  /** Snapshot 注册表：hash → snapshot（用于 Integrity 检查）。 */
  snapshotRegistry: Map<string, DecisionSnapshot>;
  /** 自增序列号（生成 decisionId）。 */
  seq: number;
  /** TD-37-3：已产生 DecisionTrace 的 expansion planId 集合（防重复）。 */
  processedExpansionPlanIds: Set<string>;
}

// ─── 系统定义 ──────────────────────────────────────────────

export const decisionTraceSystem: System = {
  name: "decision-trace",
  priority: 3 as Priority,
  interval: 100,
  phase: "post",

  run(ctx: TickContext): void {
    const g = globalCache();
    const tick = ctx.tick;

    // ── 1. 初始化 Ring Buffer（首次运行或 global reset 后）──
    if (!g.__decisionTraceCache) {
      g.__decisionTraceCache = {
        ringBuffer: createRingBuffer(1000),
        snapshotRegistry: new Map(),
        seq: 0,
        processedExpansionPlanIds: new Set(),
      };
    }
    const cache = g.__decisionTraceCache as DecisionTraceCache;

    // ── 2. 采集各系统产出的决策信号，构建 DecisionRecords ──
    collectEmpireHealthDecisions(ctx, cache, tick);
    collectLogisticsDecisions(ctx, cache, tick);
    collectRecoveryDecisions(ctx, cache, tick);
    collectSpawnDecisions(ctx, cache, tick);
    collectDefenseDecisions(ctx, cache, tick);
    collectWarPlanDecisions(ctx, cache, tick);
    // TD-37-3：采集 Expansion Decision（一次 Plan consume = 一次 Decision Event）
    collectExpansionDecisions(ctx, cache, tick);

    // ── 3. Trace GC ──
    gcTrace(cache.ringBuffer, tick);

    // ── 3b. Snapshot Registry eviction ──
    // AI-1 修复：snapshotRegistry 只增不减导致无界增长。
    // 驱逐策略：只保留 ring buffer 中仍存活 DecisionRecord 引用的 snapshot。
    // 驱逐时机：每 500 tick 执行一次（低频，避免每 100t 遍历开销）。
    if (tick % 500 === 0) {
      evictStaleSnapshots(cache);
    }

    // ── 4. 可观测性输出 ──
    const records = getRecentRecords(cache.ringBuffer, 5);
    if (records.length > 0) {
      const important = records.filter(
        r => r.severity === "IMPORTANT" || r.severity === "CRITICAL",
      );
      if (important.length > 0) {
        console.log(
          `[${tick}] decision-trace: ${cache.ringBuffer.count} records, ` +
            `recent IMPORTANT/CRITICAL: ${important.map(r => `${r.selectedAction}(${r.scope})`).join(", ")}`,
        );
      }
    }
  },
};

// ─── 采集函数：从各系统产出构建 DecisionRecord ─────────────

/**
 * 从 empire-health-system 产出的 empireHealth / recoveryActions 构建决策记录。
 */
function collectEmpireHealthDecisions(
  ctx: TickContext,
  cache: DecisionTraceCache,
  tick: number,
): void {
  const g = globalCache();
  const health = g.empireHealth;
  if (!health) return;

  // 只有健康等级变化或恢复动作存在时才记录
  const hasRecovery = (g.recoveryActions?.length ?? 0) > 0;
  const isImportant = health.level === "degraded" || health.level === "critical";

  if (!hasRecovery && !isImportant) return;

  const snapshot = buildSnapshot(ctx, tick, "empire", "RECOVERY");
  const snapHash = snapshotHash(snapshot);
  cache.snapshotRegistry.set(snapHash, snapshot);

  const reasons: DecisionReason[] = [];
  if (health.bottleneck) {
    reasons.push({
      metric: "bottleneckDimension",
      actual: health.bottleneck,
      threshold: "none",
      severity: health.level === "critical" ? "critical" : "warning",
      consequence: `empire health degraded to ${health.level}`,
    });
  }

  const recoveryActions = g.recoveryActions ?? [];
  for (const action of recoveryActions) {
    reasons.push({
      metric: "recoveryActionTriggered",
      actual: action.type,
      threshold: "none",
      severity: action.urgent ? "critical" : "warning",
      consequence: action.recommendation ?? `recovery needed for ${action.domain}`,
    });
  }

  const selectedAction = recoveryActions.length > 0
    ? `RECOVERY_${recoveryActions[0]!.type}`
    : `HEALTH_${health.level}`;

  const rejected: RejectedAlternative[] = [];
  if (recoveryActions.length > 1) {
    for (let i = 1; i < recoveryActions.length; i++) {
      rejected.push({
        action: `RECOVERY_${recoveryActions[i]!.type}`,
        reason: `lower priority (${recoveryActions[i]!.priority} vs ${recoveryActions[0]!.priority})`,
      });
    }
  }

  const evidence: DecisionEvidence = {
    health: {
      empireHealthLevel: health.level,
      empireHealthScore: health.score,
      bottleneck: health.bottleneck,
      recovering: health.recovering,
    },
    recovery: {
      activeActions: recoveryActions.length,
      succeededCount: g.recoveryStats?.succeededCount ?? 0,
      failedCount: g.recoveryStats?.failedCount ?? 0,
    },
  };

  const dHash = decisionHash(selectedAction, reasons, evidence, rejected);
  const decisionId = makeDecisionId(tick, ++cache.seq);
  const record: DecisionRecord = {
    decisionId,
    tick,
    category: "RECOVERY",
    actor: "empire-health",
    scope: "empire",
    inputSnapshotHash: snapHash,
    reasons,
    evidence,
    selectedAction,
    rejectedAlternatives: rejected,
    expectedOutcome: recoveryActions.length > 0
      ? "recovery action submitted and verified"
      : "empire health stabilizes",
    correlationId: makeCorrelationId(decisionId, tick),
    severity: isImportant ? "IMPORTANT" : "NORMAL",
    decisionHash: dHash,
    createdAt: tick,
    lifecycle: "ACTIVE",
  };

  pushRecord(cache.ringBuffer, record);
}

/**
 * 从 logistics-planner 产出的 plan / health 构建决策记录。
 */
function collectLogisticsDecisions(
  ctx: TickContext,
  cache: DecisionTraceCache,
  tick: number,
): void {
  const g = globalCache();
  const plan = g.logisticsPlan?.plan;
  const health = g.logisticsHealth;
  if (!plan || !health) return;

  // 只有有请求或健康度非 healthy 时才记录
  if (plan.requests.length === 0 && health.level === "healthy") return;

  const snapshot = buildSnapshot(ctx, tick, "empire", "LOGISTICS");
  const snapHash = snapshotHash(snapshot);
  cache.snapshotRegistry.set(snapHash, snapshot);

  const reasons: DecisionReason[] = [];
  if (health.level !== "healthy") {
    reasons.push({
      metric: "logisticsHealth",
      actual: health.level,
      threshold: "healthy",
      severity: health.level === "critical" ? "critical" : "warning",
      consequence: "delivery chain degraded",
    });
  }
  if (health.backlogCount > 0) {
    reasons.push({
      metric: "logisticsBacklog",
      actual: health.backlogCount,
      threshold: 0,
      severity: "warning",
      consequence: "transport requests piling up",
    });
  }

  const selectedAction = plan.requests.length > 0
    ? `LOGISTICS_PLAN_${plan.requests.length}_requests`
    : `LOGISTICS_HEALTH_${health.level}`;

  const evidence: DecisionEvidence = {
    logistics: {
      deliveryFailure: health.backlogCount,
      haulerDeficit: g.logisticsCapacity?.result.totalHaulerGap ?? 0,
      backlog: health.backlogCount,
    },
  };

  const dHash = decisionHash(selectedAction, reasons, evidence, []);
  const decisionId = makeDecisionId(tick, ++cache.seq);
  const record: DecisionRecord = {
    decisionId,
    tick,
    category: "LOGISTICS",
    actor: "logistics-planner",
    scope: "empire",
    inputSnapshotHash: snapHash,
    reasons,
    evidence,
    selectedAction,
    rejectedAlternatives: [],
    expectedOutcome: "transport plan executed, delivery rate improves",
    correlationId: makeCorrelationId(decisionId, tick),
    severity: health.level !== "healthy" ? "IMPORTANT" : "NORMAL",
    decisionHash: dHash,
    createdAt: tick,
    lifecycle: "ACTIVE",
  };

  pushRecord(cache.ringBuffer, record);
}

/**
 * 从 recovery-execution-system 产出的 actionTable 构建决策记录。
 */
function collectRecoveryDecisions(
  ctx: TickContext,
  cache: DecisionTraceCache,
  tick: number,
): void {
  const g = globalCache();
  const actionTable = g.recoveryActionTable;

  // A5.3.1 GAP-1: 追踪 war abort → recovery 链路。
  // warAbortSignals 被 recovery-execution-system 消费后转化为 RecoveryAction，
  // 出现在 actionTable 中。这里追踪 ABORT_TRIGGERED → RECOVERY_REQUESTED 链。
  // 信号已消费（g.warAbortSignals === undefined），但可通过 actionTable 中的
  // targetFailureId 前缀 "war-abort:" 识别来自军事止损的 action。
  let warAbortActions = 0;
  if (actionTable && actionTable.size > 0) {
    for (const [, record] of actionTable) {
      if (record.failureId?.startsWith("war-abort:")) {
        warAbortActions++;
      }
    }
  }

  if (!actionTable || actionTable.size === 0) {
    // 即使没有 actionTable，如果有 war abort 相关的 action 也需要记录
    if (warAbortActions === 0) return;
  }

  const snapshot = buildSnapshot(ctx, tick, "empire", "RECOVERY");
  const snapHash = snapshotHash(snapshot);
  // 不重复注册已存在的 snapshot
  if (!cache.snapshotRegistry.has(snapHash)) {
    cache.snapshotRegistry.set(snapHash, snapshot);
  }

  // 从 actionTable 中提取最近的状态变更
  let submitted = 0;
  let succeeded = 0;
  let failed = 0;
  const actionTypes: string[] = [];

  if (!actionTable) return;

  for (const [, record] of actionTable) {
    if (record.state === "executing" || record.state === "submitted") submitted++;
    if (record.state === "succeeded") succeeded++;
    if (record.state === "failed" || record.state === "terminal") failed++;
    if (!actionTypes.includes(record.type)) {
      actionTypes.push(record.type);
    }
  }

  if (submitted === 0 && succeeded === 0 && failed === 0) return;

  const reasons: DecisionReason[] = [];
  if (submitted > 0) {
    reasons.push({
      metric: "recoverySubmitted",
      actual: submitted,
      threshold: 0,
      severity: "warning",
      consequence: "recovery actions in flight",
    });
  }
  if (failed > 0) {
    reasons.push({
      metric: "recoveryFailed",
      actual: failed,
      threshold: 0,
      severity: "critical",
      consequence: "recovery actions failed, may need escalation",
    });
  }

  const selectedAction = `RECOVERY_EXEC_${actionTypes.join(",")}`;
  const evidence: DecisionEvidence = {
    recovery: {
      activeActions: submitted,
      succeededCount: succeeded,
      failedCount: failed,
    },
  };

  const dHash = decisionHash(selectedAction, reasons, evidence, []);
  const decisionId = makeDecisionId(tick, ++cache.seq);
  const record: DecisionRecord = {
    decisionId,
    tick,
    category: "RECOVERY",
    actor: "recovery-execution",
    scope: "empire",
    inputSnapshotHash: snapHash,
    reasons,
    evidence,
    selectedAction,
    rejectedAlternatives: [],
    expectedOutcome: "recovery actions complete, world state improves",
    correlationId: makeCorrelationId(decisionId, tick),
    severity: failed > 0 ? "CRITICAL" : "IMPORTANT",
    decisionHash: dHash,
    createdAt: tick,
    lifecycle: "ACTIVE",
  };

  pushRecord(cache.ringBuffer, record);
}

/**
 * 从 spawn-manager 的队列状态构建决策记录。
 */
function collectSpawnDecisions(
  ctx: TickContext,
  cache: DecisionTraceCache,
  tick: number,
): void {
  let totalQueue = 0;
  let totalP0 = 0;
  let roomCount = 0;

  for (const snap of ctx.snapshots()) {
    const roomMem = Memory.rooms[snap.roomName];
    const queue = roomMem?.spawnQueue;
    if (queue && Array.isArray(queue)) {
      totalQueue += queue.length;
      totalP0 += queue.filter(r => r.priority === 0).length;
      roomCount++;
    }
  }

  // 只有队列非空或 P0 存在时才记录
  if (totalQueue === 0) return;

  const snapshot = buildSnapshot(ctx, tick, "empire", "SPAWN");
  const snapHash = snapshotHash(snapshot);
  if (!cache.snapshotRegistry.has(snapHash)) {
    cache.snapshotRegistry.set(snapHash, snapshot);
  }

  const reasons: DecisionReason[] = [];
  if (totalP0 > 0) {
    reasons.push({
      metric: "p0SpawnQueue",
      actual: totalP0,
      threshold: 0,
      severity: "critical",
      consequence: "P0 recovery spawn pending — population at risk",
    });
  }
  if (totalQueue > 5) {
    reasons.push({
      metric: "spawnQueueBacklog",
      actual: totalQueue,
      threshold: 5,
      severity: "warning",
      consequence: "spawn queue backing up — hatchery under capacity",
    });
  }

  const selectedAction = `SPAWN_QUEUE_${totalQueue}_p0_${totalP0}`;
  const evidence: DecisionEvidence = {
    spawn: {
      capacity: roomCount,
      queueLength: totalQueue,
      p0Count: totalP0,
    },
  };

  const dHash = decisionHash(selectedAction, reasons, evidence, []);
  const decisionId = makeDecisionId(tick, ++cache.seq);
  const record: DecisionRecord = {
    decisionId,
    tick,
    category: "SPAWN",
    actor: "spawn-manager",
    scope: "empire",
    inputSnapshotHash: snapHash,
    reasons,
    evidence,
    selectedAction,
    rejectedAlternatives: [],
    expectedOutcome: "spawn queue drains, population stabilizes",
    correlationId: makeCorrelationId(decisionId, tick),
    severity: totalP0 > 0 ? "IMPORTANT" : "NORMAL",
    decisionHash: dHash,
    createdAt: tick,
    lifecycle: "ACTIVE",
  };

  pushRecord(cache.ringBuffer, record);
}

/**
 * 从 A5.1 威胁评估 + 远矿防御决策构建 DecisionRecord。
 *
 * 采集 globalCache.threatAssessments（room-state 每 tick 写入）和
 * globalCache.remoteDefenseDecisions（remote-mining-manager 按需写入），
 * 将军事防御决策接入 Decision Trace 追踪链。
 *
 * 记录规则：
 * - 威胁级别 ≥ MEDIUM 或意图 ∈ {SIEGE, FULL_ASSAULT, NUCLEAR} → 记录
 * - 远矿防御决策 ≠ CONTINUE → 记录
 * - 威胁置信度 = fact 且级别 ≥ HIGH → severity = CRITICAL
 */
function collectDefenseDecisions(
  ctx: TickContext,
  cache: DecisionTraceCache,
  tick: number,
): void {
  const g = globalCache();

  // ── 1. 采集威胁评估 ──
  const threatMap = g.threatAssessments;
  if (threatMap && threatMap.size > 0) {
    for (const [roomName, assessment] of threatMap) {
      // 只记录有意义的威胁
      const isImportant =
        assessment.level === "HIGH" ||
        assessment.level === "CRITICAL" ||
        (assessment.level === "MEDIUM" &&
          (assessment.estimatedIntent.intent === "SIEGE" ||
           assessment.estimatedIntent.intent === "FULL_ASSAULT" ||
           assessment.estimatedIntent.intent === "NUCLEAR" ||
           assessment.estimatedIntent.intent === "CONTROLLER_ATTACK"));

      if (!isImportant) continue;

      const snapshot = buildSnapshot(ctx, tick, roomName, "DEFENSE_PREP");
      const snapHash = snapshotHash(snapshot);
      if (!cache.snapshotRegistry.has(snapHash)) {
        cache.snapshotRegistry.set(snapHash, snapshot);
      }

      const reasons: DecisionReason[] = [];
      reasons.push({
        metric: "threatLevel",
        actual: assessment.level,
        threshold: "LOW",
        severity: assessment.level === "CRITICAL" ? "critical" : "warning",
        consequence: `房间 ${roomName} 面临 ${assessment.level} 级威胁`,
      });
      reasons.push({
        metric: "threatIntent",
        actual: assessment.estimatedIntent.intent,
        threshold: "SCOUTING",
        severity: assessment.estimatedIntent.intent === "NUCLEAR" ? "critical" : "warning",
        consequence: `意图推断: ${assessment.estimatedIntent.evidence.join("; ")}`,
      });
      if (assessment.estimatedPower.boosted) {
        reasons.push({
          metric: "enemyBoosted",
          actual: `T${assessment.estimatedPower.maxBoostTier}`,
          threshold: 0,
          severity: "warning",
          consequence: `敌方使用 T${assessment.estimatedPower.maxBoostTier} boost`,
        });
      }
      if (assessment.timeToImpact !== Infinity && assessment.timeToImpact < 50) {
        reasons.push({
          metric: "timeToImpact",
          actual: assessment.timeToImpact,
          threshold: 50,
          severity: "critical",
          consequence: `预计 ${assessment.timeToImpact} tick 后到达核心区`,
        });
      }

      const selectedAction = `THREAT_${assessment.level}_${assessment.estimatedIntent.intent}_${roomName}`;
      const evidence: DecisionEvidence = {
        threat: {
          hostileCount: assessment.score.combat > 0 ? Math.ceil(assessment.score.combat / 10) : 0,
          posture: assessment.recommendedPosture,
        },
        terrain: assessment.terrainEvidence ? {
          terrainType: assessment.terrainEvidence.terrainType,
          walkability: assessment.terrainEvidence.retreatQuality, // walkability approximated
          retreatQuality: assessment.terrainEvidence.retreatQuality,
          mobilityModifier: assessment.terrainEvidence.mobilityModifier,
          towerCoverage: assessment.terrainEvidence.towerCoverage,
          rampartCoverage: "UNKNOWN",
          chokepointCount: 0,
        } : undefined,
        intel: assessment.intelEvidence ? {
          hasIntel: assessment.intelEvidence.hasIntel,
          aggregatedConfidence: assessment.intelEvidence.aggregatedConfidence,
          threatIndex: assessment.intelEvidence.threatIndex,
          hasConflict: assessment.intelEvidence.hasConflict,
          evidenceCount: assessment.intelEvidence.evidenceCount,
        } : undefined,
        confidence: assessment.multiConfidence ? {
          fact: assessment.multiConfidence.factConfidence,
          combat: assessment.multiConfidence.combatConfidence,
          intent: assessment.multiConfidence.intentConfidence,
          terrain: assessment.multiConfidence.terrainConfidence,
          intel: assessment.multiConfidence.intelConfidence,
          overall: assessment.multiConfidence.overallConfidence,
        } : undefined,
      };

      const isCritical =
        assessment.level === "CRITICAL" ||
        assessment.estimatedIntent.intent === "NUCLEAR" ||
        (assessment.confidence === "fact" && assessment.level === "HIGH");

      const dHash = decisionHash(selectedAction, reasons, evidence, []);
      const decisionId = makeDecisionId(tick, ++cache.seq);
      const record: DecisionRecord = {
        decisionId,
        tick,
        category: "DEFENSE_PREP",
        actor: "threat-assessment",
        scope: roomName,
        inputSnapshotHash: snapHash,
        reasons,
        evidence,
        selectedAction,
        rejectedAlternatives: [],
        expectedOutcome: `姿态调整为 ${assessment.recommendedPosture}，防御系统响应`,
        correlationId: makeCorrelationId(decisionId, tick),
        severity: isCritical ? "CRITICAL" : "IMPORTANT",
        decisionHash: dHash,
        createdAt: tick,
        lifecycle: "ACTIVE",
      };

      pushRecord(cache.ringBuffer, record);
    }
  }

  // ── 2. 采集远矿防御决策 ──
  const remoteDecisions = g.remoteDefenseDecisions;
  if (remoteDecisions && remoteDecisions.size > 0) {
    for (const [targetRoom, decision] of remoteDecisions) {
      // 只记录非 CONTINUE 的决策
      if (decision.action === "CONTINUE") continue;

      const snapshot = buildSnapshot(ctx, tick, targetRoom, "REMOTE");
      const snapHash = snapshotHash(snapshot);
      if (!cache.snapshotRegistry.has(snapHash)) {
        cache.snapshotRegistry.set(snapHash, snapshot);
      }

      const reasons: DecisionReason[] = [];
      reasons.push({
        metric: "remoteDefenseAction",
        actual: decision.action,
        threshold: "CONTINUE",
        severity: decision.action === "ABORT" ? "critical" : "warning",
        consequence: decision.reason,
      });
      if (decision.expectedValue.netValue < 0) {
        reasons.push({
          metric: "remoteNetValue",
          actual: decision.expectedValue.netValue,
          threshold: 0,
          severity: "warning",
          consequence: `远矿净价值为负，继续运营不划算`,
        });
      }
      if (decision.escortDemand) {
        reasons.push({
          metric: "escortDemand",
          actual: `${decision.escortDemand.count} defenders`,
          threshold: 0,
          severity: "info",
          consequence: `护航需求: ${decision.escortDemand.count} defender, 成本 ${decision.escortDemand.cost}`,
        });
      }

      const selectedAction = `REMOTE_DEFENSE_${decision.action}_${targetRoom}`;
      const evidence: DecisionEvidence = {
        threat: {
          hostileCount: 0,
          posture: decision.action,
        },
      };

      const rejected: RejectedAlternative[] = decision.rejectedAlternatives.map(alt => ({
        action: `REMOTE_DEFENSE_${alt.action}_${targetRoom}`,
        reason: alt.reason,
      }));

      const isCritical = decision.action === "ABORT";
      const dHash = decisionHash(selectedAction, reasons, evidence, rejected);
      const decisionId = makeDecisionId(tick, ++cache.seq);
      const record: DecisionRecord = {
        decisionId,
        tick,
        category: "REMOTE",
        actor: "remote-defense",
        scope: targetRoom,
        inputSnapshotHash: snapHash,
        reasons,
        evidence,
        selectedAction,
        rejectedAlternatives: rejected,
        expectedOutcome: decision.action === "ABORT"
          ? `远矿车道 ${targetRoom} 放弃`
          : decision.action === "RETREAT"
            ? `远矿 creep 从 ${targetRoom} 撤退`
            : decision.action === "ESCORT"
              ? `defender 护航 ${targetRoom}`
              : `远矿 ${targetRoom} 暂停后恢复`,
        correlationId: makeCorrelationId(decisionId, tick),
        severity: isCritical ? "IMPORTANT" : "NORMAL",
        decisionHash: dHash,
        createdAt: tick,
        lifecycle: "ACTIVE",
      };

      pushRecord(cache.ringBuffer, record);
    }
  }
}

// ─── A5.3 军事行动计划决策采集 ──────────────────────────────

/**
 * 从 A5.3 war-planning-system 产出的 WarPlan 构建决策记录。
 *
 * 采集 globalCache.warPlanCache（war-planning-system 每 interval 写入），
 * 将军事行动计划接入 Decision Trace 追踪链。
 *
 * 记录规则：
 * - 有 WarPlan → 记录（包含 operationId, type, target, posture, risk, econGuard, netValue）
 * - 无 WarPlan 但 posture=war → 记录 "no plan" 原因
 * - posture≠war → 不记录（CEASEFIRE 无军事决策）
 * - 被拒绝的目标候选 → RejectedAlternatives
 */
function collectWarPlanDecisions(
  ctx: TickContext,
  cache: DecisionTraceCache,
  tick: number,
): void {
  const g = globalCache();
  const warPlanCache = g.warPlanCache;
  const posture = Memory.kernel?.strategy?.posture ?? "develop";

  // posture 非 war 且无活跃计划 → 不记录
  if (posture !== "war" && !warPlanCache?.plan) return;

  const plan = warPlanCache?.plan;
  const scope = plan?.operation.target.roomName ?? "empire";

  const snapshot = buildSnapshot(ctx, tick, scope, "MILITARY");
  const snapHash = snapshotHash(snapshot);
  if (!cache.snapshotRegistry.has(snapHash)) {
    cache.snapshotRegistry.set(snapHash, snapshot);
  }

  const reasons: DecisionReason[] = [];
  const rejected: RejectedAlternative[] = [];
  let selectedAction: string;
  let expectedOutcome: string;
  let severity: DecisionSeverity = "NORMAL";

  if (plan) {
    // 有计划
    reasons.push({
      metric: "warPosture",
      actual: plan.posture.posture,
      threshold: "CEASEFIRE",
      severity: plan.posture.offensiveAuthorized ? "warning" : "info",
      consequence: plan.posture.reasons.join("; "),
    });
    reasons.push({
      metric: "operationType",
      actual: plan.operation.type,
      threshold: "none",
      severity: "info",
      consequence: `目标: ${plan.operation.objective}`,
    });
    reasons.push({
      metric: "riskLevel",
      actual: plan.risk.level,
      threshold: "LOW",
      severity: plan.risk.level === "CRITICAL" ? "critical" : plan.risk.level === "HIGH" ? "warning" : "info",
      consequence: `风险分数: ${plan.risk.score}`,
    });
    reasons.push({
      metric: "economicGuard",
      actual: plan.economicGuard.passed ? "PASS" : "FAIL",
      threshold: "PASS",
      severity: plan.economicGuard.passed ? "info" : "critical",
      consequence: plan.economicGuard.recommendation || "经济护栏通过",
    });
    reasons.push({
      metric: "netValue",
      actual: plan.expectedValue.netValue,
      threshold: 0,
      severity: plan.expectedValue.netValue < 0 ? "critical" : "info",
      consequence: `建议: ${plan.expectedValue.recommendation}`,
    });
    if (plan.capabilityGaps.totalGapRatio > 0.3) {
      reasons.push({
        metric: "capabilityGap",
        actual: plan.capabilityGaps.totalGapRatio,
        threshold: 0.3,
        severity: "warning",
        consequence: `能力缺口较大: ${plan.capabilityGaps.evidence.join(", ")}`,
      });
    }

    // 被拒绝的目标候选
    for (const alt of plan.targetSelection.rejectedAlternatives) {
      rejected.push({
        action: `TARGET_${alt.roomName}`,
        reason: alt.reason,
      });
    }

    selectedAction = `WAR_PLAN_${plan.operation.type}_${plan.operation.target.roomName}`;
    expectedOutcome = plan.expectedValue.recommendation === "PROCEED"
      ? `军事行动 ${plan.operation.operationId} 执行: ${plan.operation.type} → ${plan.operation.target.roomName}`
      : `军事行动 ${plan.operation.operationId} 延迟/降级: ${plan.expectedValue.recommendation}`;

    severity = plan.risk.level === "CRITICAL" || !plan.economicGuard.passed
      ? "CRITICAL"
      : plan.risk.level === "HIGH" || plan.expectedValue.netValue < 0
        ? "IMPORTANT"
        : "NORMAL";
  } else {
    // posture=war 但无计划
    reasons.push({
      metric: "empirePosture",
      actual: posture,
      threshold: "war",
      severity: "warning",
      consequence: "战争姿态但无活跃军事行动计划",
    });
    selectedAction = "WAR_PLAN_NONE";
    expectedOutcome = "等待威胁评估或条件改善后产生军事行动计划";
    severity = "NORMAL";
  }

  const evidence: DecisionEvidence = {
    threat: {
      hostileCount: 0,
      posture,
    },
  };

  const dHash = decisionHash(selectedAction, reasons, evidence, rejected);
  const decisionId = makeDecisionId(tick, ++cache.seq);
  const record: DecisionRecord = {
    decisionId,
    tick,
    category: "MILITARY",
    actor: "war-planning",
    scope,
    inputSnapshotHash: snapHash,
    reasons,
    evidence,
    selectedAction,
    rejectedAlternatives: rejected,
    expectedOutcome,
    correlationId: makeCorrelationId(decisionId, tick),
    severity,
    decisionHash: dHash,
    createdAt: tick,
    lifecycle: "ACTIVE",
  };

  pushRecord(cache.ringBuffer, record);
}

// ─── TD-37-3: Expansion Decision 采集 ──────────────────────────

/**
 * 从 expansion-manager 的运行时状态构建 Expansion DecisionRecord。
 *
 * 语义约束：一次真实 Expansion Decision = Plan 被 consume 启动执行的时刻，
 * 而不是 Operation 每 tick 的状态变化。使用 processedExpansionPlanIds 防重。
 *
 * 采集来源：
 * - Memory.kernel.expansion（活跃扩张状态机）
 * - globalCache.executionDashboard（运行时执行看板）
 * - Memory.kernel.strategy（姿态上下文）
 *
 * 记录规则：
 * - 有活跃扩张 + planId 未处理过 → 记录一次
 * - 无活跃扩张 → 不记录（扩张终止的 Outcome 由 Outcome 采集链处理）
 * - planId 为空但有活跃扩张 → 用 target+startedAt 作为去重 key
 */
function collectExpansionDecisions(
  ctx: TickContext,
  cache: DecisionTraceCache,
  tick: number,
): void {
  const mem = (globalThis as { Memory?: { kernel?: { expansion?: { target: string; sponsor: string; startedAt: number; planId?: string; state: string; checkpointsPassed?: number } } } }).Memory?.kernel?.expansion;
  if (!mem) return;

  // 去重 key：planId 优先，fallback 到 target+startedAt
  const dedupKey = mem.planId ?? `expansion:${mem.target}:${mem.startedAt}`;
  if (cache.processedExpansionPlanIds.has(dedupKey)) return;

  // 防止 Set 无限增长
  if (cache.processedExpansionPlanIds.size > 500) {
    const old = Array.from(cache.processedExpansionPlanIds).slice(0, 200);
    for (const k of old) cache.processedExpansionPlanIds.delete(k);
  }

  const scope = mem.target;
  const snapshot = buildSnapshot(ctx, tick, scope, "EXPANSION");
  const snapHash = snapshotHash(snapshot);
  if (!cache.snapshotRegistry.has(snapHash)) {
    cache.snapshotRegistry.set(snapHash, snapshot);
  }

  const strategy = (globalThis as { Memory?: { kernel?: { strategy?: { posture?: string; expansionAllowed?: boolean } } } }).Memory?.kernel?.strategy;
  const posture = strategy?.posture ?? "develop";
  const expansionAllowed = strategy?.expansionAllowed ?? false;

  const reasons: DecisionReason[] = [];
  reasons.push({
    metric: "expansionPlanConsumed",
    actual: dedupKey,
    threshold: "none",
    severity: "info",
    consequence: `扩张计划 ${dedupKey} 开始执行: ${mem.target} (sponsor=${mem.sponsor})`,
  });
  reasons.push({
    metric: "expansionPosture",
    actual: posture,
    threshold: "develop",
    severity: expansionAllowed ? "info" : "warning",
    consequence: expansionAllowed
      ? "姿态授权扩张"
      : "姿态未授权但已有活跃扩张（沉没投资保护）",
  });
  reasons.push({
    metric: "expansionState",
    actual: mem.state,
    threshold: "preparing",
    severity: "info",
    consequence: `初始状态: ${mem.state}`,
  });

  // 采集扩张看板证据
  const g = globalCache() as { executionDashboard?: { tick: number; executionState: string; targetRoom: string; sponsorRoom: string; progress: number; checkpointsPassed: number; reservedEnergy: number; consecutivePositiveTicks: number } };
  const dashboard = g.executionDashboard;

  const evidence: DecisionEvidence = {
    threat: {
      hostileCount: 0,
      posture,
    },
    health: {
      empireHealthLevel: snapshot.health.empireHealthLevel,
      empireHealthScore: snapshot.health.empireHealthScore,
      bottleneck: snapshot.health.bottleneck,
      recovering: snapshot.health.recovering,
    },
    population: snapshot.population.creepByRole,
  };

  if (dashboard) {
    reasons.push({
      metric: "executionProgress",
      actual: `${dashboard.checkpointsPassed}/5`,
      threshold: "5/5",
      severity: "info",
      consequence: `执行进度: ${dashboard.executionState}, CP=${dashboard.checkpointsPassed}/5`,
    });
  }

  const selectedAction = `EXPANSION_START_${mem.target}`;
  const dHash = decisionHash(selectedAction, reasons, evidence, []);
  const decisionId = makeDecisionId(tick, ++cache.seq);
  const record: DecisionRecord = {
    decisionId,
    tick,
    category: "EXPANSION",
    actor: "expansion-manager",
    scope,
    inputSnapshotHash: snapHash,
    reasons,
    evidence,
    selectedAction,
    rejectedAlternatives: [],
    expectedOutcome: `房间 ${mem.target} 完成完整扩张链路 (CP1-CP5) 并成为自治房间`,
    correlationId: makeCorrelationId(decisionId, tick),
    severity: "IMPORTANT",
    decisionHash: dHash,
    createdAt: tick,
    lifecycle: "ACTIVE",
  };

  pushRecord(cache.ringBuffer, record);
  cache.processedExpansionPlanIds.add(dedupKey);

  // AI-2 修复：将 decisionId 写入 Memory.kernel.expansion.decisionId
  // 这是唯一稳定关联键——recordExpansionOutcome 读取此值写入 lastExpansionOutcome.decisionId，
  // experience-collector 用 exp.decision.decisionId === lastOutcome.decisionId 直接匹配。
  // startedAt 在状态机推进中被反复覆盖，planId 在旧版 Memory 可能缺失，decisionId 是可靠键。
  const expMem = (globalThis as { Memory?: { kernel?: { expansion?: { decisionId?: string } } } }).Memory?.kernel?.expansion;
  if (expMem) {
    expMem.decisionId = decisionId;
  }
}

// ─── Snapshot 构建器（从 Runtime State 采集）──────────────

/**
 * 从运行时状态构建 DecisionSnapshot。
 *
 * 这是 system 层的核心职责：把散落在 globalCache / Memory / Game 中的
 * 运行时数据适配为纯函数可消费的确定性快照。
 */
function buildSnapshot(
  ctx: TickContext,
  tick: number,
  scope: string,
  category: DecisionCategory,
): DecisionSnapshot {
  const g = globalCache();
  const snapshots = [...ctx.snapshots()];

  // 经济状态（从 Memory.kernel.empireEconomy + 房间快照聚合）
  const empireEcon = Memory.kernel?.empireEconomy;
  let totalEnergyAvailable = 0;
  let totalEnergyCapacity = 0;
  let totalStorageEnergy = 0;
  let totalTerminalEnergy = 0;
  let worstColonyState = "normal";
  let worstEconomyPressure = 0;

  for (const snap of snapshots) {
    const roomMem = Memory.rooms[snap.roomName];
    totalEnergyAvailable += Game.rooms[snap.roomName]?.energyAvailable ?? 0;
    totalEnergyCapacity += Game.rooms[snap.roomName]?.energyCapacityAvailable ?? 0;
    const room = Game.rooms[snap.roomName];
    totalStorageEnergy += room?.storage?.store.energy ?? 0;
    totalTerminalEnergy += room?.terminal?.store.energy ?? 0;
    const cs = roomMem?.colonyState ?? "normal";
    if (cs === "recovery" || cs === "bootstrap") worstColonyState = cs;
    const ep = roomMem?.economyPressure ?? 0;
    if (ep > worstEconomyPressure) worstEconomyPressure = ep;
  }

  // 人口统计
  const creepByRole: Record<string, number> = {};
  let totalCreeps = 0;
  let creepTtlMin = 1500;
  for (const creep of Object.values(Game.creeps)) {
    if (creep.spawning) continue;
    const role = creep.memory.role ?? "unknown";
    creepByRole[role] = (creepByRole[role] ?? 0) + 1;
    totalCreeps++;
    const ttl = creep.ticksToLive ?? 1500;
    if (ttl < creepTtlMin) creepTtlMin = ttl;
  }

  // 物流状态
  const logisticsHealth = g.logisticsHealth;
  const logisticsCapacity = g.logisticsCapacity?.result;
  const haulerCount = creepByRole["hauler"] ?? 0;
  // RoomCapacityResult 没有 haulerCount 字段，用 requiredHaulers 近似总运力
  const haulerCapacity = logisticsCapacity?.rooms?.reduce(
    (sum, r) => sum + r.requiredHaulers * 100, 0,
  ) ?? 0;

  // Spawn 状态
  let spawnCount = 0;
  let spawningCount = 0;
  let queueLength = 0;
  let queueP0Count = 0;
  for (const snap of snapshots) {
    spawnCount += snap.spawns.length;
    spawningCount += snap.spawns.filter(s => s.spawning).length;
    const queue = Memory.rooms[snap.roomName]?.spawnQueue;
    if (queue && Array.isArray(queue)) {
      queueLength += queue.length;
      queueP0Count += queue.filter(r => r.priority === 0).length;
    }
  }

  // 威胁状态
  const strategy = Memory.kernel?.strategy;
  const posture = strategy?.posture ?? "develop";
  let hostilesInRoom = 0;
  let hasLiveThreat = false;
  for (const snap of snapshots) {
    if (snap.threatCreeps && snap.threatCreeps.length > 0) {
      hostilesInRoom += snap.threatCreeps.length;
      hasLiveThreat = true;
    }
  }

  // 健康度
  const empireHealth = g.empireHealth;

  // 恢复状态
  const recoveryStats = g.recoveryStats;
  const recoveryActionTable = g.recoveryActionTable;
  const recoveryActionTypes: string[] = [];
  if (recoveryActionTable) {
    for (const [, record] of recoveryActionTable) {
      if (!recoveryActionTypes.includes(record.type)) {
        recoveryActionTypes.push(record.type);
      }
    }
  }

  // 运营状态
  let activeRemoteOps = 0;
  for (const snap of snapshots) {
    const remoteOps = Memory.rooms[snap.roomName]?.remoteOps;
    if (remoteOps) {
      for (const op of Object.values(remoteOps)) {
        if (op.state === "active") activeRemoteOps++;
      }
    }
  }

  return {
    tick,
    scope,
    category,
    economy: {
      energyAvailable: totalEnergyAvailable,
      energyCapacity: totalEnergyCapacity,
      storageEnergy: totalStorageEnergy,
      terminalEnergy: totalTerminalEnergy,
      netFlow: empireEcon?.nf ?? 0,
      economyPressure: worstEconomyPressure,
      colonyState: worstColonyState,
    },
    resources: {
      storageEnergy: totalStorageEnergy,
      storageMinerals: {}, // 简化：矿物追踪在 multiResourceHealth
      terminalResources: {},
    },
    logistics: {
      haulerCount,
      haulerCapacity,
      deliveryRate: logisticsHealth?.deliveryRate ?? 1,
      backlogCount: logisticsHealth?.backlogCount ?? 0,
      idleHaulers: g.logisticsIdleHaulers?.names.length ?? 0,
    },
    threat: {
      posture,
      hostilesInRoom,
      hasLiveThreat,
      safeModeTicks: 0, // 从房间快照读取，简化
    },
    spawn: {
      spawnCount,
      spawningCount,
      queueLength,
      queueP0Count,
    },
    population: {
      totalCreeps,
      creepByRole,
      creepTtlMin,
    },
    health: {
      empireHealthLevel: empireHealth?.level ?? "unknown",
      empireHealthScore: empireHealth?.score ?? 0,
      bottleneck: empireHealth?.bottleneck ?? "none",
      recovering: empireHealth?.recovering ?? false,
    },
    recovery: {
      activeRecoveryCount: recoveryActionTable?.size ?? 0,
      recoveryActionTypes,
      recoveryStatsSucceeded: recoveryStats?.succeededCount ?? 0,
      recoveryStatsFailed: recoveryStats?.failedCount ?? 0,
    },
    operations: {
      activeRemoteOps,
      activeContracts: 0, // Supply Contracts 追踪在 Memory.kernel.supplyContracts
      expansionTarget: g.expansionDashboard?.plans?.topPlanRoom ?? null,
    },
    planner: {
      strategyPosture: posture,
      expansionAllowed: strategy?.expansionAllowed ?? false,
      newRemoteOpsAllowed: strategy?.newRemoteOpsAllowed ?? true,
      cpuTier: ctx.budget.tier,
      cpuBucket: Game.cpu.bucket ?? 10000,
    },
  };
}

// ─── AI-1 修复：Snapshot Registry eviction ──────────────────

/**
 * 驱逐 snapshotRegistry 中不再被任何存活 DecisionRecord 引用的 snapshot。
 *
 * 策略：遍历 ring buffer 中仍存活的 DecisionRecord，收集它们的 inputSnapshotHash，
 * 然后删除 snapshotRegistry 中不在该集合中的条目。
 *
 * 执行频率：每 500 tick 一次（低频，与 gcTrace 同区域）。
 * 复杂度：O(ringBuffer.count + snapshotRegistry.size)。
 */
function evictStaleSnapshots(cache: DecisionTraceCache): void {
  const referencedHashes = new Set<string>();

  // 收集 ring buffer 中所有存活记录引用的 snapshot hash
  for (let i = 0; i < cache.ringBuffer.records.length; i++) {
    const r = cache.ringBuffer.records[i];
    if (r && r.lifecycle !== "EXPIRED") {
      referencedHashes.add(r.inputSnapshotHash);
    }
  }

  // 删除未被引用的 snapshot
  let evicted = 0;
  for (const key of cache.snapshotRegistry.keys()) {
    if (!referencedHashes.has(key)) {
      cache.snapshotRegistry.delete(key);
      evicted++;
    }
  }

  if (evicted > 0 && cache.snapshotRegistry.size > 0) {
    console.log(
      `[decision-trace] snapshotRegistry evicted ${evicted} stale snapshots, ` +
      `remaining: ${cache.snapshotRegistry.size}`,
    );
  }
}

// ─── 查询口（供 Dashboard / 外部消费）─────────────────────

export function getDecisionTraceRecords(limit = 50): DecisionRecord[] {
  const cache = globalCache().__decisionTraceCache as DecisionTraceCache | undefined;
  if (!cache) return [];
  return getRecentRecords(cache.ringBuffer, limit);
}

export function queryDecisionTrace(query: TraceQuery): DecisionRecord[] {
  const cache = globalCache().__decisionTraceCache as DecisionTraceCache | undefined;
  if (!cache) return [];
  return queryRecords(cache.ringBuffer, query);
}

export function getDecisionChain(correlationId: string): DecisionChainEntry[] {
  const cache = globalCache().__decisionTraceCache as DecisionTraceCache | undefined;
  if (!cache) return [];
  const records = traceChain(cache.ringBuffer, correlationId);
  return buildDecisionChain(records);
}

export function getDecisionTraceMemoryBudget(): MemoryBudgetResult | null {
  const cache = globalCache().__decisionTraceCache as DecisionTraceCache | undefined;
  if (!cache) return null;
  const records = getRecentRecords(cache.ringBuffer, 1);
  if (records.length === 0) return null;
  return measureMemoryBudget(records[0]!);
}

export function getDecisionTraceIntegrity(): IntegrityCheckResult | null {
  const cache = globalCache().__decisionTraceCache as DecisionTraceCache | undefined;
  if (!cache) return null;
  return checkTraceIntegrity(cache.ringBuffer, cache.snapshotRegistry);
}

/**
 * 打印 Decision Trace Dashboard — 供控制台调用。
 *
 * 输出格式：
 *   ═══ Decision Trace Dashboard @12345 ═══
 *   Records: 42 (capacity=1000, written=58)
 *   Memory: 320 bytes/record, 320KB for 1000
 *   Integrity: 42/42 (100%)
 *
 *   Recent IMPORTANT/CRITICAL:
 *     [12340] SPAWN_QUEUE_3_p0_1 (spawn-manager) — p0SpawnQueue=1(critical)
 *     [12330] RECOVERY_SPAWN_HAULER (empire-health) — bottleneckDimension=spawn(warning)
 *     ...
 */
export function printDecisionTraceDashboard(): string {
  const cache = globalCache().__decisionTraceCache as DecisionTraceCache | undefined;
  if (!cache) {
    return "Decision Trace: not initialized yet (runs every 100 ticks)";
  }

  const buf = cache.ringBuffer;
  const tick = Game.time;
  const lines: string[] = [];

  lines.push(`═══ Decision Trace Dashboard @${tick} ═══`);
  lines.push(`Records: ${buf.count} (capacity=${buf.capacity}, totalWritten=${buf.totalWritten})`);

  // Memory Budget
  const recentForBudget = getRecentRecords(buf, 1);
  if (recentForBudget.length > 0) {
    const budget = measureMemoryBudget(recentForBudget[0]!);
    lines.push(`Memory: ${budget.bytesPerRecord}B/record, ${(budget.bytesFor1000 / 1024).toFixed(0)}KB for 1000`);
  }

  // Integrity
  const integrity = checkTraceIntegrity(buf, cache.snapshotRegistry);
  if (integrity) {
    const ratio = (integrity.integrityRatio * 100).toFixed(0);
    lines.push(`Integrity: ${integrity.recordsWithSnapshot}/${integrity.totalRecords} (${ratio}%)`);
    if (integrity.orphanedRecords > 0) {
      lines.push(`  ⚠ ${integrity.orphanedRecords} orphaned records (snapshot evicted)`);
    }
  }

  // Recent IMPORTANT/CRITICAL
  const recent = getRecentRecords(buf, 10);
  const important = recent.filter(
    r => r.severity === "IMPORTANT" || r.severity === "CRITICAL",
  );
  if (important.length > 0) {
    lines.push("");
    lines.push("Recent IMPORTANT/CRITICAL:");
    for (const r of important) {
      const reasonStr = r.reasons
        .map(rs => `${rs.metric}=${rs.actual}(${rs.severity})`)
        .join("; ");
      lines.push(`  [${r.tick}] ${r.selectedAction} (${r.actor}) — ${reasonStr}`);
    }
  }

  return lines.join("\n");
}
