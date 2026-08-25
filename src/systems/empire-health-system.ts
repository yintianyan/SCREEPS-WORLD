/**
 * Empire Health System — A4.5 系统薄壳。
 *
 * 合同锚点：A4.5 Task Spec §18-27 + SYSTEM_BOUNDARIES §1.4 Empire。
 *
 * 职责：每 100 tick 调用 domain 纯函数链，综合评估帝国健康度，
 * 检测失败传播，计算恢复优先级，量化自治能力。
 *
 * 执行链：
 *   1. 从 globalCache 读取各维度健康信号（empireEconomy / logistics / network / colony）
 *   2. 映射各维度到 DimensionHealth + score
 *   3. evaluateEmpireHealth（8 维度 + Hysteresis）
 *   4. 从活跃失败列表构建 failureGraph
 *   5. detectRootCause + analyzeImpact
 *   6. prioritizeRecovery
 *   7. computeAutonomyScore + detectNoProgress + detectThrashing
 *   8. 写入 globalCache（empireHealth / failureGraph / recoveryActions / autonomyStatus）
 *
 * 状态所有权：
 *   唯一写者 = 本系统 → globalCache.empireHealth / failureGraph / recoveryActions / autonomyStatus
 *   recoveryCooldowns 跨 tick 持久（heap Map，global reset 丢失可接受）。
 *
 * CPU 预算：低频执行（interval=100），不每 tick 重算。
 * 优先级 P1（在 empireEconomy / agendaManager / logisticsPlanner 之后运行，
 *   消费它们产出的信号）。
 *
 * 注意：本系统不执行任何恢复动作——只产出建议。
 * 恢复动作的执行由各执行系统（spawn-manager / agenda-manager / terminal-manager 等）
 * 消费 recoveryActions 自行决定是否执行。
 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
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

    // ── 9. 写入 globalCache ──
    g.empireHealth = healthResult;
    g.failureGraph = failureGraph;
    g.recoveryActions = recoveryActions;
    g.autonomyStatus = autonomyStatus;
    g.recoveryCooldowns = cooldowns;

    // ── 10. 可观测性：等级变更时打日志 ──
    if (prevLevel !== healthResult.level) {
      console.log(
        `[${tick}] empire-health: ${prevLevel ?? "(none)"} → ${healthResult.level}` +
        ` score=${healthResult.score.toFixed(3)}` +
        ` bottleneck=${healthResult.bottleneck}` +
        ` recovering=${healthResult.recovering}` +
        (recoveryActions.length > 0 ? ` recoveryQueue=${recoveryActions.length}` : "") +
        ` autonomy=${autonomyStatus.score.score}(${autonomyStatus.score.level})` +
        (noProgress.detected ? ` NO_PROGRESS:${noProgress.stuckDimensions.join(",")}` : "") +
        (thrashing.detected ? ` THRASHING:${thrashing.type}` : ""),
      );
    }

    // 紧急恢复动作打日志
    const urgent = recoveryActions.find(a => a.urgent);
    if (urgent) {
      console.log(
        `[${tick}] empire-health: URGENT recovery → ${urgent.type}` +
        ` domain=${urgent.domain} priority=${urgent.priority}` +
        ` roi=${urgent.roi.toFixed(2)}: ${urgent.recommendation}`,
      );
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
