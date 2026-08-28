/** Empire Health System */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import {
  createTimeSeries,
  pushSample,
  gcTimeSeries,
  type TimeSeries,
} from "../domain/intelligence/prediction/time-series";
import {
  evaluateEmpireHealth,
  mapEconomicHealth,
  mapResourceHealth,
  mapLogisticsHealth,
  mapNetworkHealth,
  mapColonyHealth,
  mapThreatHealth,
  mapCpuHealth,
  mapSpawnHealth,
  dimensionScore,
  type EmpireHealthLevel,
  type DimensionHealth,
} from "../domain/strategy/empire-health";
import {
  buildFailureGraph,
  findRootCauses,
  detectRootCause,
  analyzeImpact,
  computeFailureSeverity,
  type FailureNode,
  type FailureGraph,
} from "../domain/strategy/failure-propagation";
import {
  prioritizeRecovery,
  recordRecoveryAttempt,
  type RecoveryAction,
  type CooldownTable,
} from "../domain/strategy/recovery-priority";
import {
  computeAutonomyScore,
  detectNoProgress,
  detectThrashing,
  evaluateAutonomyStatus,
  type AutonomyStatus,
} from "../domain/strategy/autonomy-metrics";
import { log } from "../kernel/log";

// ─── 历史数据追踪（heap，跨 tick 持久）──────────────────

interface HealthHistoryEntry {
  tick: number;
  level: string;
  score: number;
}

interface PostureHistoryEntry {
  tick: number;
  posture: string;
}

// ─── 系统定义 ──────────────────────────────────────────────

export const empireHealthSystem: System = {
  name: "empire-health",
  priority: 1 as Priority,
  interval: 100,
  phase: "main",

  run(ctx: TickContext): void {
    const g = globalCache();
    const tick = ctx.tick;

    // ── 1. 收集各维度健康信号 ──
    const energyHealth = deriveEnergyHealth(g);
    const mineralHealth = deriveMineralHealth(g);
    const logisticsHealth = deriveLogisticsHealth(g);
    const networkHealth = deriveNetworkHealth(g);
    const colonyHealth = deriveColonyHealth(g, ctx);
    const threatHealth = deriveThreatHealth(g);
    const spawnHealth = deriveSpawnHealth(g, ctx);
    const cpuHealth = deriveCpuHealth(ctx);

    // ── 2. 获取上次评估结果（Hysteresis 输入）──
    const prevResult = g.empireHealth;
    const prevLevel = prevResult?.level;
    const prevScore = prevResult?.score;

    // ── 3. 评估帝国综合健康度 ──
    const healthResult = evaluateEmpireHealth({
      energyHealth: energyHealth.level,
      energyScore: energyHealth.score,
      mineralHealth: mineralHealth.level,
      mineralScore: mineralHealth.score,
      logisticsHealth: logisticsHealth.level,
      logisticsScore: logisticsHealth.score,
      networkHealth: networkHealth.level,
      networkScore: networkHealth.score,
      colonyHealth: colonyHealth.level,
      colonyScore: colonyHealth.score,
      threatHealth: threatHealth.level,
      threatScore: threatHealth.score,
      spawnHealth: spawnHealth.level,
      spawnScore: spawnHealth.score,
      cpuHealth: cpuHealth.level,
      cpuScore: cpuHealth.score,
      prevLevel,
      prevScore,
      tick,
    });

    // ── 4. 收集活跃失败节点 ──
    const activeFailures = collectActiveFailures(g, ctx, healthResult);

    // ── 5. 构建失败传播图 ──
    const failureGraph = buildFailureGraph(activeFailures, tick);

    // ── 6. 根因检测 + 影响范围分析 ──
    const rootCauses = findRootCauses(failureGraph);
    const rootCauseIds = new Set(rootCauses.map(r => r.id));

    const impacts = new Map<string, NonNullable<ReturnType<typeof analyzeImpact>>>();
    for (const rc of rootCauses) {
      const impact = analyzeImpact(failureGraph, rc.id);
      if (impact) impacts.set(rc.id, impact);
    }

    // ── 7. 计算恢复优先级 ──
    const cooldowns = g.recoveryCooldowns ?? new Map() as CooldownTable;
    const recoveryActions = prioritizeRecovery(
      activeFailures,
      rootCauseIds,
      impacts,
      cooldowns,
      tick,
    );

    // ── 8. 自治指标计算 ──
    // 维护历史数据（heap）
    if (!g.__healthHistory) g.__healthHistory = [];
    if (!g.__postureHistory) g.__postureHistory = [];
    if (!g.__netFlowHistory) g.__netFlowHistory = [];
    if (!g.__reserveHistory) g.__reserveHistory = [];
    if (!g.__populationHistory) g.__populationHistory = [];
    if (!g.__failureCountHistory) g.__failureCountHistory = [];

    const healthHistory = g.__healthHistory;
    const postureHistory = g.__postureHistory;
    const netFlowHistory = g.__netFlowHistory;
    const reserveHistory = g.__reserveHistory;
    const populationHistory = g.__populationHistory;
    const failureCountHistory = g.__failureCountHistory;

    // 追加当前数据
    healthHistory.push({ tick, level: healthResult.level, score: healthResult.score });
    postureHistory.push({ tick, posture: threatHealth.evidence });

    // 从 empireEconomy snapshot 获取经济数据
    const empireEcon = Memory.kernel?.empireEconomy;
    if (empireEcon) {
      netFlowHistory.push(empireEcon.nf / 100); // 编码为 ×100
      reserveHistory.push(empireEcon.tr);
    }

    // 人口统计（RoomSnapshot 无 creeps 数组，用 Game.creeps 归属统计）
    let totalPop = 0;
    for (const _ of Object.values(Game.creeps)) {
      totalPop++;
    }
    populationHistory.push(totalPop);
    failureCountHistory.push(activeFailures.length);

    // 限制历史长度（10000 tick / 100 tick interval = 100 条）
    const MAX_HISTORY = 100;
    while (healthHistory.length > MAX_HISTORY) healthHistory.shift();
    while (postureHistory.length > MAX_HISTORY) postureHistory.shift();
    while (netFlowHistory.length > MAX_HISTORY) netFlowHistory.shift();
    while (reserveHistory.length > MAX_HISTORY) reserveHistory.shift();
    while (populationHistory.length > MAX_HISTORY) populationHistory.shift();
    while (failureCountHistory.length > MAX_HISTORY) failureCountHistory.shift();

    // 计算 Autonomy Score
    const consecutiveStableTicks = prevResult && prevResult.level !== "critical" && prevResult.level !== "degraded"
      ? (g.__consecutiveStableTicks ?? 0) + 100
      : 0;
    g.__consecutiveStableTicks = consecutiveStableTicks;

    const autonomyScore = computeAutonomyScore({
      economicLoopActive: healthResult.level !== "critical",
      economicLoopRate: energyHealth.score,
      totalFailuresDetected: g.__totalFailuresDetected ?? 0,
      autoRecoveredFailures: g.__autoRecoveredFailures ?? 0,
      activeFailures: activeFailures.length,
      manualInterventions: 0, // 自治框架不追踪人工干预（需要 console hook）
      consecutiveStableTicks,
      lastDegradedTick: prevResult?.level === "degraded" || prevResult?.level === "critical" ? tick : undefined,
      perturbationCount: g.__perturbationCount ?? 0,
      totalRecoveryTime: g.__totalRecoveryTime ?? 0,
      tick,
      roomCount: countOwnedRooms(ctx),
    });

    // No-Progress 检测
    const noProgress = detectNoProgress({
      netFlowHistory,
      totalReserveHistory: reserveHistory,
      populationHistory,
      failureCountHistory,
      tick,
      window: 10, // 10 个采样点 = 1000 tick
    });

    // Thrashing 检测
    const thrashing = detectThrashing({
      healthLevelHistory: healthHistory.map(h => h.level),
      healthLevelTicks: healthHistory.map(h => h.tick),
      postureHistory: postureHistory.map(p => p.posture),
      postureTicks: postureHistory.map(p => p.tick),
      failureDomainCycles: g.__failureDomainCycles ?? {},
      tick,
      window: 1000,
    });

    // 综合自治状态
    const autonomyStatus = evaluateAutonomyStatus(autonomyScore, noProgress, thrashing);

    // ── 9. A6.3 预测采样寄生（复用既有 100t cadence，零额外调度）──
    // PRED-010：不自建采样通道，寄生在 empire-health-system 的既有 cadence 中。
    // 每个采样点 O(1) 成本（push + shift），global reset 后从空数组重建。
    sampleForPredictions(g, ctx, tick, healthResult, spawnHealth);

    // ── 10. 写入 globalCache ──
    g.empireHealth = healthResult;
    g.failureGraph = failureGraph;
    g.recoveryActions = recoveryActions;
    g.autonomyStatus = autonomyStatus;
    g.recoveryCooldowns = cooldowns;

    // ── 11. 可观测性：等级变更时打日志 ──
    if (prevLevel !== healthResult.level) {
      log.info("empire-health-system", `empire-health: ${prevLevel ?? "(none)"} → ${healthResult.level}` +
        ` score=${healthResult.score.toFixed(3)}` +
        ` bottleneck=${healthResult.bottleneck}` +
        ` recovering=${healthResult.recovering}` +
        (recoveryActions.length > 0 ? ` recoveryQueue=${recoveryActions.length}` : "") +
        ` autonomy=${autonomyStatus.score.score}(${autonomyStatus.score.level})` +
        (noProgress.detected ? ` NO_PROGRESS:${noProgress.stuckDimensions.join(",")}` : "") +
        (thrashing.detected ? ` THRASHING:${thrashing.type}` : ""),);
    }

    // 紧急恢复动作打日志
    const urgent = recoveryActions.find(a => a.urgent);
    if (urgent) {
      log.info("empire-health-system", `empire-health: URGENT recovery → ${urgent.type}` +
        ` domain=${urgent.domain} priority=${urgent.priority}` +
        ` roi=${urgent.roi.toFixed(2)}: ${urgent.recommendation}`,);
    }
  },
};

// ─── 维度健康度推导辅助 ────────────────────────────────────

interface DimensionResult {
  level: DimensionHealth;
  score: number;
  evidence: string;
}

function deriveEnergyHealth(g: ReturnType<typeof globalCache>): DimensionResult {
  const econ = Memory.kernel?.empireEconomy;
  if (!econ) {
    return { level: "stable", score: 0.75, evidence: "no-economy-data" };
  }
  // econ.h 是 HEALTH_CODES 编码的 economic health
  // 0=critical, 1=deficit, 2=stable, 3=growing, 4=healthy
  const healthStr = ["critical", "deficit", "stable", "growing", "healthy"][econ.h] ?? "stable";
  const level = mapEconomicHealth(healthStr);
  return { level, score: dimensionScore(level), evidence: `economic=${healthStr}` };
}

function deriveMineralHealth(g: ReturnType<typeof globalCache>): DimensionResult {
  const mrh = g.multiResourceHealth;
  if (!mrh) {
    return { level: "stable", score: 0.75, evidence: "no-mineral-data" };
  }
  const level = mapResourceHealth(mrh.health);
  return {
    level,
    score: dimensionScore(level),
    evidence: `multiResource=${mrh.health} worstMineral=${mrh.worstMineral ?? "none"}`,
  };
}

function deriveLogisticsHealth(g: ReturnType<typeof globalCache>): DimensionResult {
  const lh = g.logisticsHealth;
  if (!lh) {
    return { level: "stable", score: 0.75, evidence: "no-logistics-data" };
  }
  const level = mapLogisticsHealth(lh.level);
  return { level, score: dimensionScore(level), evidence: `logistics=${lh.level}` };
}

function deriveNetworkHealth(g: ReturnType<typeof globalCache>): DimensionResult {
  const nh = g.networkHealth;
  if (!nh) {
    return { level: "stable", score: 0.75, evidence: "no-network-data" };
  }
  const level = mapNetworkHealth(nh.level);
  return { level, score: dimensionScore(level), evidence: `network=${nh.level}` };
}

function deriveColonyHealth(g: ReturnType<typeof globalCache>, ctx: TickContext): DimensionResult {
  // 聚合各 Colony 的 StabilityScore
  // 简化：用 ColonyState 推导
  let worstLevel: DimensionHealth = "healthy";
  let roomCount = 0;
  for (const snap of ctx.snapshots()) {
    roomCount++;
    const roomMem = Memory.rooms[snap.roomName];
    const colonyState = roomMem?.colonyState ?? "normal";
    if (colonyState === "recovery" || colonyState === "bootstrap") {
      worstLevel = "critical";
    } else if (colonyState === "defense" && worstLevel !== "critical") {
      worstLevel = "degraded";
    }
  }
  if (roomCount === 0) {
    return { level: "critical", score: 0.1, evidence: "no-rooms" };
  }
  return { level: worstLevel, score: dimensionScore(worstLevel), evidence: `rooms=${roomCount} worst=${worstLevel}` };
}

function deriveThreatHealth(g: ReturnType<typeof globalCache>): DimensionResult {
  // 从 Memory.kernel.strategy 读取 posture
  const posture = Memory.kernel?.strategy?.posture ?? "develop";
  const level = mapThreatHealth(posture);
  return { level, score: dimensionScore(level), evidence: `posture=${posture}` };
}

function deriveSpawnHealth(g: ReturnType<typeof globalCache>, ctx: TickContext): DimensionResult {
  // 检查各房 spawn 状态
  let spawnAvailable = false;
  let starvationCount = 0;
  for (const snap of ctx.snapshots()) {
    if (snap.spawns && snap.spawns.length > 0) {
      spawnAvailable = true;
    }
    // spawn starvation 从 room memory 读取（可选字段，缺失视为 0）
    const roomMem = Memory.rooms[snap.roomName] as RoomMemory & { spawnStarvationCount?: number };
    if (roomMem?.spawnStarvationCount) {
      starvationCount += roomMem.spawnStarvationCount;
    }
  }
  const level = mapSpawnHealth(spawnAvailable, starvationCount);
  return { level, score: dimensionScore(level), evidence: `spawnAvail=${spawnAvailable} starvation=${starvationCount}` };
}

function deriveCpuHealth(ctx: TickContext): DimensionResult {
  const tier = ctx.budget.tier;
  const level = mapCpuHealth(tier);
  return { level, score: dimensionScore(level), evidence: `cpuTier=${tier}` };
}

// ─── 活跃失败节点收集 ──────────────────────────────────────

function collectActiveFailures(
  g: ReturnType<typeof globalCache>,
  ctx: TickContext,
  health: ReturnType<typeof evaluateEmpireHealth>,
): FailureNode[] {
  const failures: FailureNode[] = [];
  const tick = ctx.tick;

  // 从健康度维度推导失败节点
  for (const dim of health.dimensions) {
    if (dim.level === "critical" || dim.level === "degraded") {
      failures.push({
        id: `failure:${dim.name}:${tick}`,
        domain: mapDimensionToDomain(dim.name),
        severity: dim.level === "critical" ? "critical" : "error",
        description: `${dim.name} health is ${dim.level}: ${dim.evidence}`,
        detectedAt: tick,
      });
    }
  }

  // 从 colony failure 检测结果补充
  for (const snap of ctx.snapshots()) {
    const roomMem = Memory.rooms[snap.roomName];
    const colonyState = roomMem?.colonyState;
    if (colonyState === "recovery") {
      failures.push({
        id: `failure:colony:${snap.roomName}:${tick}`,
        domain: "colony",
        severity: "critical",
        room: snap.roomName,
        description: `Colony ${snap.roomName} in recovery state`,
        detectedAt: tick,
      });
    }
  }

  // 从 logistics health 补充
  const lh = g.logisticsHealth;
  if (lh && (lh.level === "critical" || lh.level === "degraded")) {
    failures.push({
      id: `failure:logistics:${tick}`,
      domain: "logistics",
      severity: lh.level === "critical" ? "critical" : "warning",
        description: `Logistics health ${lh.level}: ${lh.message}`,
      detectedAt: tick,
    });
  }

  // 从 network health 补充
  const nh = g.networkHealth;
  if (nh && (nh.level === "critical" || nh.level === "degraded")) {
    failures.push({
      id: `failure:network:${tick}`,
      domain: "network",
      severity: nh.level === "critical" ? "critical" : "warning",
      description: `Network health ${nh.level}`,
      detectedAt: tick,
    });
  }

  return failures;
}

function mapDimensionToDomain(dimName: string): import("../domain/strategy/failure-propagation").FailureDomain {
  switch (dimName) {
    case "energy": return "energy";
    case "mineral": return "mineral";
    case "logistics": return "logistics";
    case "network": return "network";
    case "colony": return "colony";
    case "threat": return "threat";
    case "spawn": return "spawn";
    case "cpu": return "cpu";
    default: return "energy";
  }
}

function countOwnedRooms(ctx: TickContext): number {
  let count = 0;
  for (const _ of ctx.snapshots()) count++;
  return count;
}

// ─── A6.3 预测采样寄生 ────────────────────────────────────

/** TimeSeries 容量上限（100 采样 × 100t interval = 10000t 历史 ≈ 8.3h）。 */
const PREDICTION_TS_CAPACITY = 100;

/**
 * A6.3 预测采样寄生函数 — 复用 empire-health-system 既有 100t cadence。

 * PRED-010：不自建采样通道，寄生在既有 cadence 中追加 4 个采样字段。

 * 采样内容：
 *   1. CPU bucket 历史（→ __cpuBucketHistory，预测目标 #7）
 *   2. Spawn 队列深度历史（→ __spawnQueueDepthHistory，预测目标 #2）
 *   3. 物流健康度历史（→ __logisticsHealthHistory，预测目标 #3）
 *   4. 房间健康度历史（→ __roomHealthHistory，预测目标 #4）

 * 远矿收益历史（#5）由 expansion-planner 的 cadence 采样，不在此处。

 * 每个采样点 O(1) 成本（push + 可能的 shift）。
 * global reset 后从空 TimeSeries 重建（可接受）。
 */
function sampleForPredictions(
  g: ReturnType<typeof globalCache>,
  ctx: TickContext,
  tick: number,
  healthResult: ReturnType<typeof evaluateEmpireHealth>,
  spawnHealth: DimensionResult,
): void {
  // ── 1. CPU bucket 历史 ──
  // WO-8/P14：无消费者（prediction-system 不读此序列）。降频到每 500t 采样省 CPU，
  // 数据保留供未来预测目标 #7 接线。接线后恢复每 100t 采样。
  if (tick % 500 === 0) {
    if (!g.__cpuBucketHistory) {
      g.__cpuBucketHistory = createTimeSeries<number>(PREDICTION_TS_CAPACITY);
    }
    const game = globalThis as { Game?: { cpu?: { bucket?: number } } };
    const bucket = game.Game?.cpu?.bucket ?? 0;
    pushSample(g.__cpuBucketHistory, tick, bucket);
    gcTimeSeries(g.__cpuBucketHistory, tick, PREDICTION_TS_CAPACITY * 200);
  }

  // ── 2. Spawn 队列深度历史 ──
  // 唯一有消费者的序列：prediction-system + calibration-resolution 消费。
  if (!g.__spawnQueueDepthHistory) {
    g.__spawnQueueDepthHistory = createTimeSeries<number>(PREDICTION_TS_CAPACITY);
  }
  // 从各房 spawnQueue 聚合总队列深度
  let totalQueueDepth = 0;
  for (const snap of ctx.snapshots()) {
    const roomMem = Memory.rooms[snap.roomName];
    if (roomMem?.spawnQueue) {
      totalQueueDepth += roomMem.spawnQueue.length;
    }
  }
  pushSample(g.__spawnQueueDepthHistory, tick, totalQueueDepth);
  gcTimeSeries(g.__spawnQueueDepthHistory, tick, PREDICTION_TS_CAPACITY * 200);

  // ── 3. 物流健康度历史 ──
  // WO-9/P14：无消费者。降频到每 500t 采样省 CPU。
  if (tick % 500 === 0) {
    if (!g.__logisticsHealthHistory) {
      g.__logisticsHealthHistory = createTimeSeries<{ score: number; deliveryRate: number; lossRate: number }>(
        PREDICTION_TS_CAPACITY,
      );
    }
    const lh = g.logisticsHealth;
    if (lh) {
      pushSample(g.__logisticsHealthHistory, tick, {
        score: lh.score,
        deliveryRate: lh.deliveryRate,
        lossRate: lh.lossRate,
      });
      gcTimeSeries(g.__logisticsHealthHistory, tick, PREDICTION_TS_CAPACITY * 200);
    }
  }

  // ── 4. 房间健康度历史（per-room）──
  // WO-10/P14：无消费者。降频到每 500t 采样省 CPU。
  if (tick % 500 === 0) {
  if (!g.__roomHealthHistory) {
    g.__roomHealthHistory = new Map();
  }
  for (const snap of ctx.snapshots()) {
    const roomMem = Memory.rooms[snap.roomName];
    const colonyState = roomMem?.colonyState ?? "normal";
    const roomScore = colonyState === "normal" ? 1.0
      : colonyState === "defense" ? 0.5
      : colonyState === "bootstrap" ? 0.3
      : colonyState === "recovery" ? 0.1
      : 0.5;
    let roomTs = g.__roomHealthHistory.get(snap.roomName);
    if (!roomTs) {
      roomTs = createTimeSeries<{ score: number; level: string }>(PREDICTION_TS_CAPACITY);
      g.__roomHealthHistory.set(snap.roomName, roomTs);
    }
    pushSample(roomTs, tick, { score: roomScore, level: colonyState });
    gcTimeSeries(roomTs, tick, PREDICTION_TS_CAPACITY * 200);
  }
  } // end if (tick % 500 === 0)
}
