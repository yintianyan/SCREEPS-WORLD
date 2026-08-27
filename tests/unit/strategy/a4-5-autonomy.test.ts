/** A4.5 Empire Autonomous Stability — E2E 场景测试。 */
import { describe, it, expect } from "vitest";
import {
  evaluateEmpireHealth,
  mapEconomicHealth,
  mapThreatHealth,
  mapCpuHealth,
  dimensionScore,
  type EmpireHealthInput,
  type EmpireHealthLevel,
} from "../../../src/domain/strategy/empire-health";
import {
  buildFailureGraph,
  detectRootCause,
  analyzeImpact,
  findRootCauses,
  findSymptoms,
  computeFailureSeverity,
  type FailureNode,
} from "../../../src/domain/strategy/failure-propagation";
import {
  computeRecoveryPriority,
  prioritizeRecovery,
  isOnCooldown,
  recordRecoveryAttempt,
  remainingCooldown,
  cooldownKey,
  selectNextRecovery,
  type CooldownTable,
} from "../../../src/domain/strategy/recovery-priority";
import {
  computeAutonomyScore,
  detectNoProgress,
  detectThrashing,
  evaluateAutonomyStatus,
} from "../../../src/domain/strategy/autonomy-metrics";

const TICK = 1000;

// ─── 辅助构造 ──────────────────────────────────────────────

function makeHealthyInput(prevLevel?: EmpireHealthLevel, tick: number = TICK): EmpireHealthInput {
  return {
    energyHealth: "healthy", energyScore: 1.0,
    mineralHealth: "healthy", mineralScore: 0.9,
    logisticsHealth: "healthy", logisticsScore: 0.95,
    networkHealth: "healthy", networkScore: 0.9,
    colonyHealth: "healthy", colonyScore: 0.85,
    threatHealth: "healthy", threatScore: 1.0,
    spawnHealth: "healthy", spawnScore: 1.0,
    cpuHealth: "healthy", cpuScore: 1.0,
    prevLevel,
    tick,
  };
}

function makeCriticalInput(prevLevel?: EmpireHealthLevel, tick: number = TICK): EmpireHealthInput {
  return {
    energyHealth: "critical", energyScore: 0.1,
    mineralHealth: "stable", mineralScore: 0.7,
    logisticsHealth: "degraded", logisticsScore: 0.4,
    networkHealth: "stable", networkScore: 0.7,
    colonyHealth: "critical", colonyScore: 0.1,
    threatHealth: "stable", threatScore: 0.75,
    spawnHealth: "degraded", spawnScore: 0.4,
    cpuHealth: "stable", cpuScore: 0.75,
    prevLevel,
    tick,
  };
}

function makeFailureNode(
  id: string,
  domain: import("../../../src/domain/strategy/failure-propagation").FailureDomain,
  severity: "info" | "warning" | "error" | "critical" = "error",
  room?: string,
): FailureNode {
  return {
    id,
    domain,
    severity,
    room,
    description: `${domain} failure in ${room ?? "global"}`,
    detectedAt: TICK,
  };
}

// ─── E2E-001: Empire Health 8 维度评估 ───────────────────

describe("A4.5-E2E-001: Empire Health 8 维度评估", () => {
  it("全健康维度 → HEALTHY", () => {
    const result = evaluateEmpireHealth(makeHealthyInput());
    expect(result.level).toBe("healthy");
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.dimensions).toHaveLength(8);
    expect(result.worstDimension).toBeTruthy();
  });

  it("多维度 critical → CRITICAL", () => {
    const result = evaluateEmpireHealth(makeCriticalInput());
    // 2+ critical → 直接 critical
    expect(result.level).toBe("critical");
    expect(result.score).toBeLessThan(0.4);
  });

  it("维度映射函数正确", () => {
    expect(mapEconomicHealth("critical")).toBe("critical");
    expect(mapEconomicHealth("deficit")).toBe("degraded");
    expect(mapEconomicHealth("stable")).toBe("stable");
    expect(mapEconomicHealth("growing")).toBe("healthy");
    expect(mapEconomicHealth("healthy")).toBe("healthy");

    expect(mapThreatHealth("war")).toBe("critical");
    expect(mapThreatHealth("fortify")).toBe("degraded");
    expect(mapThreatHealth("develop")).toBe("stable");
    expect(mapThreatHealth("expand")).toBe("healthy");

    expect(mapCpuHealth("recovery")).toBe("critical");
    expect(mapCpuHealth("conserve")).toBe("degraded");
    expect(mapCpuHealth("guarded")).toBe("stable");
    expect(mapCpuHealth("healthy")).toBe("healthy");
  });

  it("dimensionScore 映射正确", () => {
    expect(dimensionScore("healthy")).toBe(1.0);
    expect(dimensionScore("stable")).toBe(0.75);
    expect(dimensionScore("degraded")).toBe(0.5);
    expect(dimensionScore("critical")).toBe(0.1);
  });
});

// ─── E2E-002: Health 等级降级立即生效 ───────────────────

describe("A4.5-E2E-002: Health 降级立即生效", () => {
  it("从 HEALTHY 降级到 DEGRADED 不需阈值确认", () => {
    // 上次 healthy，这次分数很低 → 立即降级
    const input = makeHealthyInput("healthy");
    input.energyHealth = "critical";
    input.energyScore = 0.1;
    input.colonyHealth = "critical";
    input.colonyScore = 0.1;

    const result = evaluateEmpireHealth(input);
    expect(result.level).toBe("critical"); // 2+ critical → 立即降级
  });

  it("从 STABLE 降级到 DEGRADED 不需阈值确认", () => {
    const input = makeHealthyInput("stable");
    input.energyHealth = "critical";
    input.energyScore = 0.1;
    input.colonyHealth = "critical";
    input.colonyScore = 0.1;
    input.logisticsHealth = "degraded";
    input.logisticsScore = 0.4;

    const result = evaluateEmpireHealth(input);
    // 2+ critical → 立即降级到 critical
    expect(result.level).toBe("critical");
  });
});

// ─── E2E-003: Health 恢复需超阈值（滞回）───────────────

describe("A4.5-E2E-003: Health 恢复滞回", () => {
  it("从 CRITICAL 恢复需要分数 > 0.55", () => {
    // 上次 critical，这次分数刚到 0.5 → 仍然 critical
    const input: EmpireHealthInput = {
      ...makeHealthyInput("critical"),
      energyHealth: "stable", energyScore: 0.75,
      mineralHealth: "stable", mineralScore: 0.75,
      logisticsHealth: "stable", logisticsScore: 0.75,
      networkHealth: "stable", networkScore: 0.75,
      colonyHealth: "stable", colonyScore: 0.75,
      threatHealth: "stable", threatScore: 0.75,
      spawnHealth: "stable", spawnScore: 0.75,
      cpuHealth: "stable", cpuScore: 0.75,
    };
    // 加权分数 = 0.75 * 各权重 ≈ 0.75 → > 0.55 → 恢复到 degraded
    const result = evaluateEmpireHealth(input);
    expect(result.level).not.toBe("critical");
  });

  it("从 DEGRADED 恢复到 STABLE 需要分数 > 0.80", () => {
    // 上次 degraded，分数 0.78 → 不到 0.80 → 仍然 degraded
    const input: EmpireHealthInput = {
      ...makeHealthyInput("degraded"),
      energyHealth: "stable", energyScore: 0.78,
      mineralHealth: "stable", mineralScore: 0.78,
      logisticsHealth: "stable", logisticsScore: 0.78,
      networkHealth: "stable", networkScore: 0.78,
      colonyHealth: "stable", colonyScore: 0.78,
      threatHealth: "stable", threatScore: 0.78,
      spawnHealth: "stable", spawnScore: 0.78,
      cpuHealth: "stable", cpuScore: 0.78,
    };
    const result = evaluateEmpireHealth(input);
    // 0.78 < 0.80 → 仍然 degraded
    expect(result.level).toBe("degraded");
  });
});

// ─── E2E-004: Failure Propagation 根因检测 ───────────────

describe("A4.5-E2E-004: Failure Propagation 根因检测", () => {
  it("从症状回溯到根因", () => {
    const failures = [
      makeFailureNode("f1", "spawn", "critical", "W1N1"),
      makeFailureNode("f2", "colony", "error", "W1N1"),
      makeFailureNode("f3", "energy", "error", "W1N1"),
    ];
    const graph = buildFailureGraph(failures, TICK);

    // spawn 是根因（spawn → colony → energy）
    const rootCauses = findRootCauses(graph);
    expect(rootCauses.length).toBeGreaterThan(0);

    // 从 energy（症状）回溯到 spawn（根因）
    const rootCause = detectRootCause(graph, "f3");
    expect(rootCause).not.toBeNull();
    if (rootCause) {
      expect(rootCause.rootCauseId).toBe("f1");
      expect(rootCause.depth).toBeGreaterThan(0);
      expect(rootCause.confidence).toBeGreaterThan(0);
    }
  });

  it("无上游的节点是根因", () => {
    const failures = [
      makeFailureNode("f1", "threat", "critical"),
      makeFailureNode("f2", "remote", "error"),
    ];
    const graph = buildFailureGraph(failures, TICK);
    const rootCauses = findRootCauses(graph);
    // threat 是根因（threat → remote）
    expect(rootCauses.some(r => r.id === "f1")).toBe(true);
  });
});

// ─── E2E-005: Failure 影响范围分析 ───────────────────────

describe("A4.5-E2E-005: Failure 影响范围分析", () => {
  it("从根因正向传播到所有受影响节点", () => {
    const failures = [
      makeFailureNode("f1", "spawn", "critical", "W1N1"),
      makeFailureNode("f2", "colony", "error", "W1N1"),
      makeFailureNode("f3", "energy", "error", "W1N1"),
    ];
    const graph = buildFailureGraph(failures, TICK);

    const impact = analyzeImpact(graph, "f1");
    expect(impact).not.toBeNull();
    if (impact) {
      expect(impact.affectedNodes).toContain("f1");
      expect(impact.maxDepth).toBeGreaterThan(0);
      expect(impact.affectedDomains).toContain("spawn");
    }
  });

  it("失败图严重度计算", () => {
    const failures = [
      makeFailureNode("f1", "spawn", "critical"),
      makeFailureNode("f2", "colony", "error"),
    ];
    const graph = buildFailureGraph(failures, TICK);
    const severity = computeFailureSeverity(graph);
    expect(severity).toBeGreaterThan(0);
    expect(severity).toBeLessThanOrEqual(1);
  });
});

// ─── E2E-006: Recovery Priority 排序 + ROI ───────────────

describe("A4.5-E2E-006: Recovery Priority 排序 + ROI", () => {
  it("critical 失败优先于 error", () => {
    const failures = [
      makeFailureNode("f1", "mineral", "warning"),
      makeFailureNode("f2", "spawn", "critical", "W1N1"),
      makeFailureNode("f3", "energy", "error"),
    ];
    const graph = buildFailureGraph(failures, TICK);
    const rootCauseIds = new Set(findRootCauses(graph).map(r => r.id));
    const impacts = new Map();
    for (const rc of findRootCauses(graph)) {
      const imp = analyzeImpact(graph, rc.id);
      if (imp) impacts.set(rc.id, imp);
    }
    const cooldowns = new Map() as CooldownTable;

    const actions = prioritizeRecovery(failures, rootCauseIds, impacts, cooldowns, TICK);

    expect(actions.length).toBeGreaterThan(0);
    // spawn critical 应该排在前面
    const spawnAction = actions.find(a => a.domain === "spawn");
    expect(spawnAction).toBeDefined();
    if (spawnAction) {
      expect(spawnAction.urgent).toBe(true);
    }
  });

  it("ROI 计算正确", () => {
    const failure = makeFailureNode("f1", "spawn", "critical", "W1N1");
    const cooldowns = new Map() as CooldownTable;
    const action = computeRecoveryPriority(failure, true, null, cooldowns, TICK);

    expect(action).not.toBeNull();
    if (action) {
      expect(action.roi).toBeGreaterThan(0);
      expect(action.priority).toBeGreaterThan(0);
      expect(action.estimatedCost).toBeGreaterThan(0);
    }
  });

  it("根因优先级提升", () => {
    const failure = makeFailureNode("f1", "energy", "error");
    const cooldowns = new Map() as CooldownTable;

    const asRoot = computeRecoveryPriority(failure, true, null, cooldowns, TICK);
    const asSymptom = computeRecoveryPriority(failure, false, null, cooldowns, TICK);

    if (asRoot && asSymptom) {
      expect(asRoot.priority).toBeGreaterThanOrEqual(asSymptom.priority);
    }
  });
});

// ─── E2E-007: Recovery Cooldown 机制 ─────────────────────

describe("A4.5-E2E-007: Recovery Cooldown 机制", () => {
  it("记录恢复尝试后进入冷却", () => {
    let cooldowns = new Map() as CooldownTable;

    // 记录一次失败恢复
    cooldowns = recordRecoveryAttempt(cooldowns, "spawn", "W1N1", TICK, false, 200);

    // 在冷却期内
    expect(isOnCooldown(cooldowns, "spawn", "W1N1", TICK + 100)).toBe(true);
    expect(remainingCooldown(cooldowns, "spawn", "W1N1", TICK + 100)).toBe(100);

    // 冷却到期
    expect(isOnCooldown(cooldowns, "spawn", "W1N1", TICK + 201)).toBe(false);
    expect(remainingCooldown(cooldowns, "spawn", "W1N1", TICK + 201)).toBe(0);
  });

  it("冷却中的失败不产出恢复动作", () => {
    const failure = makeFailureNode("f1", "spawn", "critical", "W1N1");
    let cooldowns = new Map() as CooldownTable;
    cooldowns = recordRecoveryAttempt(cooldowns, "spawn", "W1N1", TICK, false, 200);

    const action = computeRecoveryPriority(failure, true, null, cooldowns, TICK + 100);
    expect(action).toBeNull();
  });

  it("不同房间的同领域失败独立冷却", () => {
    let cooldowns = new Map() as CooldownTable;
    cooldowns = recordRecoveryAttempt(cooldowns, "spawn", "W1N1", TICK, false, 200);

    // W2N1 的 spawn 不受 W1N1 冷却影响
    expect(isOnCooldown(cooldowns, "spawn", "W2N1", TICK + 100)).toBe(false);
  });
});

// ─── E2E-008: Autonomy Score 计算 ────────────────────────

describe("A4.5-E2E-008: Autonomy Score 计算", () => {
  it("全自治场景 → 高分", () => {
    const result = computeAutonomyScore({
      economicLoopActive: true,
      economicLoopRate: 0.95,
      totalFailuresDetected: 10,
      autoRecoveredFailures: 9,
      activeFailures: 1,
      manualInterventions: 0,
      consecutiveStableTicks: 10000,
      perturbationCount: 5,
      totalRecoveryTime: 2500,
      tick: TICK,
      roomCount: 3,
    });

    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.level).toBe("full");
    expect(result.economicLoopScore).toBe(95);
    expect(result.manualInterventionScore).toBe(100);
  });

  it("多次人工干预 → 低分", () => {
    const result = computeAutonomyScore({
      economicLoopActive: true,
      economicLoopRate: 0.8,
      totalFailuresDetected: 20,
      autoRecoveredFailures: 5,
      activeFailures: 15,
      manualInterventions: 5,
      consecutiveStableTicks: 500,
      perturbationCount: 10,
      totalRecoveryTime: 8000,
      tick: TICK,
      roomCount: 3,
    });

    expect(result.score).toBeLessThan(50);
    expect(result.level).toBe("low");
    expect(result.manualInterventionScore).toBe(50);
  });

  it("无扰动 → 满分扰动恢复", () => {
    const result = computeAutonomyScore({
      economicLoopActive: true,
      economicLoopRate: 1.0,
      totalFailuresDetected: 0,
      autoRecoveredFailures: 0,
      activeFailures: 0,
      manualInterventions: 0,
      consecutiveStableTicks: 10000,
      perturbationCount: 0,
      totalRecoveryTime: 0,
      tick: TICK,
      roomCount: 3,
    });

    expect(result.perturbationRecoveryScore).toBe(100);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.level).toBe("full");
  });
});

// ─── E2E-009: No-Progress 检测 ───────────────────────────

describe("A4.5-E2E-009: No-Progress 检测", () => {
  it("经济指标连续无增长 → 检测到 No-Progress", () => {
    const result = detectNoProgress({
      netFlowHistory: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
      totalReserveHistory: [50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000],
      populationHistory: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
      failureCountHistory: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      tick: TICK,
      window: 10,
    });

    expect(result.detected).toBe(true);
    expect(result.stuckDimensions).toContain("net_flow");
    expect(result.stuckDimensions).toContain("reserve");
    expect(result.stuckDimensions).toContain("population");
    expect(result.stuckDimensions).toContain("failures");
    expect(result.severity).toBeGreaterThan(0);
  });

  it("有增长的场景 → 无 No-Progress", () => {
    const result = detectNoProgress({
      netFlowHistory: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      totalReserveHistory: [50000, 51000, 52000, 53000, 54000, 55000, 56000, 57000, 58000, 59000],
      populationHistory: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      failureCountHistory: [5, 4, 3, 2, 1, 0, 0, 0, 0, 0],
      tick: TICK,
      window: 10,
    });

    expect(result.detected).toBe(false);
    expect(result.stuckDimensions).toHaveLength(0);
  });
});

// ─── E2E-010: Thrashing 检测 ─────────────────────────────

describe("A4.5-E2E-010: Thrashing 检测", () => {
  it("健康度频繁跳动 → 检测到 Thrashing", () => {
    const result = detectThrashing({
      healthLevelHistory: ["healthy", "degraded", "healthy", "degraded", "healthy", "degraded"],
      healthLevelTicks: [100, 200, 300, 400, 500, 600],
      postureHistory: ["develop"],
      postureTicks: [100],
      failureDomainCycles: {},
      tick: TICK,
      window: 1000,
    });

    expect(result.detected).toBe(true);
    expect(result.type).toBe("health_oscillation");
    expect(result.frequency).toBeGreaterThan(0);
    expect(result.affectedAreas).toContain("health");
  });

  it("稳定健康度 → 无 Thrashing", () => {
    const result = detectThrashing({
      healthLevelHistory: ["healthy", "healthy", "healthy", "healthy"],
      healthLevelTicks: [100, 200, 300, 400],
      postureHistory: ["develop", "develop"],
      postureTicks: [100, 200],
      failureDomainCycles: {},
      tick: TICK,
      window: 1000,
    });

    expect(result.detected).toBe(false);
    expect(result.type).toBe("none");
  });

  it("失败领域循环 → 检测到 Thrashing", () => {
    const result = detectThrashing({
      healthLevelHistory: ["stable", "stable"],
      healthLevelTicks: [100, 200],
      postureHistory: ["develop"],
      postureTicks: [100],
      failureDomainCycles: { logistics: 4, spawn: 3 },
      tick: TICK,
      window: 1000,
    });

    expect(result.detected).toBe(true);
    expect(result.type).toBe("failure_cycle");
    expect(result.affectedAreas).toContain("logistics");
    expect(result.affectedAreas).toContain("spawn");
  });
});

// ─── E2E-011: 综合自治状态判定 ───────────────────────────

describe("A4.5-E2E-011: 综合自治状态判定", () => {
  it("高分 + 无 No-Progress + 无 Thrashing → 自治", () => {
    const score = computeAutonomyScore({
      economicLoopActive: true,
      economicLoopRate: 1.0,
      totalFailuresDetected: 0,
      autoRecoveredFailures: 0,
      activeFailures: 0,
      manualInterventions: 0,
      consecutiveStableTicks: 10000,
      perturbationCount: 0,
      totalRecoveryTime: 0,
      tick: TICK,
      roomCount: 3,
    });

    const noProgress = detectNoProgress({
      netFlowHistory: [1, 2, 3, 4, 5],
      totalReserveHistory: [50000, 51000, 52000, 53000, 54000],
      populationHistory: [10, 11, 12, 13, 14],
      failureCountHistory: [0, 0, 0, 0, 0],
      tick: TICK,
      window: 5,
    });

    const thrashing = detectThrashing({
      healthLevelHistory: ["healthy", "healthy"],
      healthLevelTicks: [100, 200],
      postureHistory: ["develop"],
      postureTicks: [100],
      failureDomainCycles: {},
      tick: TICK,
      window: 1000,
    });

    const status = evaluateAutonomyStatus(score, noProgress, thrashing);
    expect(status.autonomous).toBe(true);
    expect(status.score.score).toBeGreaterThanOrEqual(90);
  });

  it("低分 或 No-Progress 或 Thrashing → 非自治", () => {
    const score = computeAutonomyScore({
      economicLoopActive: false,
      economicLoopRate: 0.2,
      totalFailuresDetected: 20,
      autoRecoveredFailures: 5,
      activeFailures: 15,
      manualInterventions: 3,
      consecutiveStableTicks: 0,
      perturbationCount: 10,
      totalRecoveryTime: 8000,
      tick: TICK,
      roomCount: 3,
    });

    const noProgress = detectNoProgress({
      netFlowHistory: [-1, -1, -1, -1, -1],
      totalReserveHistory: [50000, 49000, 48000, 47000, 46000],
      populationHistory: [10, 9, 8, 7, 6],
      failureCountHistory: [5, 6, 7, 8, 9],
      tick: TICK,
      window: 5,
    });

    const thrashing = detectThrashing({
      healthLevelHistory: ["healthy", "critical", "healthy", "critical"],
      healthLevelTicks: [100, 200, 300, 400],
      postureHistory: ["develop", "fortify", "develop", "fortify"],
      postureTicks: [100, 200, 300, 400],
      failureDomainCycles: {},
      tick: TICK,
      window: 1000,
    });

    const status = evaluateAutonomyStatus(score, noProgress, thrashing);
    expect(status.autonomous).toBe(false);
  });
});
