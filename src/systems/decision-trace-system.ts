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

// ─── globalCache 字段类型 ──────────────────────────────────

interface DecisionTraceCache {
  ringBuffer: TraceRingBuffer;
  /** Snapshot 注册表：hash → snapshot（用于 Integrity 检查）。 */
  snapshotRegistry: Map<string, DecisionSnapshot>;
  /** 自增序列号（生成 decisionId）。 */
  seq: number;
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
      };
    }
    const cache = g.__decisionTraceCache as DecisionTraceCache;

    // ── 2. 采集各系统产出的决策信号，构建 DecisionRecords ──
    collectEmpireHealthDecisions(ctx, cache, tick);
    collectLogisticsDecisions(ctx, cache, tick);
    collectRecoveryDecisions(ctx, cache, tick);
    collectSpawnDecisions(ctx, cache, tick);

    // ── 3. Trace GC ──
    gcTrace(cache.ringBuffer, tick);

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
  if (!actionTable || actionTable.size === 0) return;

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
