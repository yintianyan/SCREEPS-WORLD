/** A4.6 Recovery Execution & Autonomous Recovery Loop — E2E 场景测试。 */
import { describe, it, expect } from "vitest";
import {
  recoveryIdempotencyKey,
  isActionActive,
  shouldSubmitAction,
  createActionRecord,
  transitionAction,
  markSubmitted,
  markExecuting,
  markVerifying,
  markSucceeded,
  markFailed,
  markBlocked,
  getRetryPolicy,
  classifyFailure,
  evaluateRecoveryResult,
  evaluateRecoveryBudget,
  evaluateRecoveryUnviability,
  evaluateEscalation,
  cleanupRecoveryTable,
  computeRecoveryStats,
  type RecoveryActionTable,
  type RecoveryActionRecord,
  type RecoveryWorldSnapshot,
  type RecoveryVerificationInput,
} from "../../../src/domain/strategy/recovery-lifecycle";
import type { RecoveryAction } from "../../../src/domain/strategy/recovery-priority";
import type { FailureNode } from "../../../src/domain/strategy/failure-propagation";

const TICK = 1000;

// ─── 辅助构造 ──────────────────────────────────────────────

function makeRecoveryAction(overrides: Partial<RecoveryAction> = {}): RecoveryAction {
  return {
    id: "action-001",
    type: "spawn_recovery",
    targetFailureId: "failure:spawn:W1N1:1000",
    domain: "spawn",
    priority: 80,
    estimatedCost: 200,
    estimatedBenefit: 500,
    roi: 2.5,
    urgent: true,
    estimatedRecoveryTime: 50,
    description: "spawn starvation in W1N1",
    recommendation: "emergency spawn [WORK,CARRY,MOVE]",
    ...overrides,
  };
}

function makeRecord(overrides: Partial<RecoveryActionRecord> = {}): RecoveryActionRecord {
  return {
    actionId: "action-001",
    failureId: "failure:spawn:W1N1:1000",
    correlationId: "rcv-action-001-1000",
    type: "spawn_recovery",
    domain: "spawn",
    room: "W1N1",
    state: "proposed",
    attempts: 0,
    maxAttempts: 3,
    submittedAt: TICK,
    updatedAt: TICK,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<RecoveryWorldSnapshot> = {}): RecoveryWorldSnapshot {
  return {
    healthScore: 0.5,
    healthLevel: "stable",
    activeFailureCount: 2,
    domainScore: 0.4,
    domainLevel: "degraded",
    room: "W1N1",
    energyAvailable: 500,
    population: 5,
    deliveryRate: 0.6,
    activeRemoteOps: 2,
    ...overrides,
  };
}

function makeFailureNode(overrides: Partial<FailureNode> = {}): FailureNode {
  return {
    id: "failure:spawn:W1N1:1000",
    domain: "spawn",
    severity: "critical",
    description: "spawn starvation",
    detectedAt: TICK,
    ...overrides,
  };
}

// ─── E2E-001: 生命周期状态转换 ──────────────────────────────

describe("A4.6 E2E-001: RecoveryAction 生命周期状态转换", () => {
  it("PROPOSED → SUBMITTED → EXECUTING → VERIFYING → SUCCEEDED", () => {
    const action = makeRecoveryAction();
    let record = createActionRecord(action, TICK, 3);

    expect(record.state).toBe("proposed");
    expect(record.attempts).toBe(0);

    record = markSubmitted(record, TICK);
    expect(record.state).toBe("submitted");
    expect(record.attempts).toBe(1);

    record = markExecuting(record, TICK + 1);
    expect(record.state).toBe("executing");

    record = markVerifying(record, TICK + 50);
    expect(record.state).toBe("verifying");

    record = markSucceeded(record, TICK + 60, "success");
    expect(record.state).toBe("succeeded");
    expect(record.verificationResult).toBe("success");
  });

  it("PROPOSED → SUBMITTED → EXECUTING → FAILED → RETRYABLE", () => {
    const action = makeRecoveryAction();
    let record = createActionRecord(action, TICK, 3);

    record = markSubmitted(record, TICK);
    record = markExecuting(record, TICK + 1);
    record = markFailed(record, TICK + 50, "spawn failed", true);

    expect(record.state).toBe("retryable");
    expect(record.failureReason).toBe("spawn failed");
  });

  it("多次失败到 maxAttempts → terminal", () => {
    const action = makeRecoveryAction();
    let record = createActionRecord(action, TICK, 2);

    record = markSubmitted(record, TICK);
    record = markFailed(record, TICK + 50, "failed 1", false);
    expect(record.state).toBe("failed");

    record = markSubmitted(record, TICK + 100);
    record = markFailed(record, TICK + 150, "failed 2", false);
    expect(record.state).toBe("terminal");
  });

  it("markBlocked 设置 blocked 状态", () => {
    let record = makeRecord({ state: "submitted" });
    record = markBlocked(record, TICK + 10, "threat detected");
    expect(record.state).toBe("blocked");
    expect(record.failureReason).toBe("threat detected");
  });
});

// ─── E2E-002~006: Idempotency ─────────────────────────────

describe("A4.6 E2E-002: Idempotency Key 稳定性", () => {
  it("相同 domain+type+room 产生相同 key", () => {
    const a1 = makeRecoveryAction();
    const a2 = makeRecoveryAction({ id: "action-002" });
    expect(recoveryIdempotencyKey(a1)).toBe(recoveryIdempotencyKey(a2));
  });

  it("不同 domain 产生不同 key", () => {
    const a1 = makeRecoveryAction({ domain: "spawn" });
    const a2 = makeRecoveryAction({ domain: "energy" });
    expect(recoveryIdempotencyKey(a1)).not.toBe(recoveryIdempotencyKey(a2));
  });

  it("不同 domain 产生不同 key（domain 是 key 的一部分）", () => {
    const a1 = makeRecoveryAction({ domain: "spawn", targetFailureId: "failure:spawn:1000" });
    const a2 = makeRecoveryAction({ domain: "energy", targetFailureId: "failure:energy:1000" });
    expect(recoveryIdempotencyKey(a1)).not.toBe(recoveryIdempotencyKey(a2));
  });
});

describe("A4.6 E2E-003: Idempotency — 活跃状态阻止重复提交", () => {
  it("executing 状态不重复提交", () => {
    const action = makeRecoveryAction();
    const table: RecoveryActionTable = new Map();
    const record = makeRecord({ state: "executing", attempts: 1 });
    table.set(recoveryIdempotencyKey(action), record);

    const result = shouldSubmitAction(table, action, TICK + 10, 200);
    expect(result.submit).toBe(false);
    expect(result.reason).toBe("already active");
  });

  it("proposed 状态不重复提交", () => {
    const action = makeRecoveryAction();
    const table: RecoveryActionTable = new Map();
    const record = makeRecord({ state: "proposed" });
    table.set(recoveryIdempotencyKey(action), record);

    const result = shouldSubmitAction(table, action, TICK + 10, 200);
    expect(result.submit).toBe(false);
  });
});

describe("A4.6 E2E-004: Idempotency — succeeded 状态阻止重新提交", () => {
  it("succeeded 状态不重新提交", () => {
    const action = makeRecoveryAction();
    const table: RecoveryActionTable = new Map();
    const record = makeRecord({ state: "succeeded", updatedAt: TICK });
    table.set(recoveryIdempotencyKey(action), record);

    const result = shouldSubmitAction(table, action, TICK + 600, 200);
    expect(result.submit).toBe(false);
    expect(result.reason).toBe("already succeeded");
  });
});

describe("A4.6 E2E-005: Idempotency — retryable 冷却期到期后允许重试", () => {
  it("冷却期内不重试", () => {
    const action = makeRecoveryAction();
    const table: RecoveryActionTable = new Map();
    const record = makeRecord({ state: "retryable", updatedAt: TICK + 50, attempts: 1 });
    table.set(recoveryIdempotencyKey(action), record);

    const result = shouldSubmitAction(table, action, TICK + 100, 200);
    expect(result.submit).toBe(false);
    expect(result.reason).toContain("cooldown");
  });

  it("冷却期到期后允许重试", () => {
    const action = makeRecoveryAction();
    const table: RecoveryActionTable = new Map();
    const record = makeRecord({ state: "retryable", updatedAt: TICK, attempts: 1 });
    table.set(recoveryIdempotencyKey(action), record);

    const result = shouldSubmitAction(table, action, TICK + 250, 200);
    expect(result.submit).toBe(true);
    expect(result.reason).toBe("cooldown expired, retrying");
    expect(result.existing).toBeDefined();
  });
});

describe("A4.6 E2E-006: Idempotency — terminal 状态永久阻止重试", () => {
  it("terminal 状态不重试", () => {
    const action = makeRecoveryAction();
    const table: RecoveryActionTable = new Map();
    const record = makeRecord({ state: "terminal", attempts: 3, maxAttempts: 3 });
    table.set(recoveryIdempotencyKey(action), record);

    const result = shouldSubmitAction(table, action, TICK + 2000, 200);
    expect(result.submit).toBe(false);
    expect(result.reason).toBe("terminal failure — no retry");
  });
});

// ─── E2E-007~010: Verification ────────────────────────────

describe("A4.6 E2E-007: Verification — domainLevel 改善 → success", () => {
  it("domainLevel 从 degraded 升到 healthy → success", () => {
    const before = makeSnapshot({ domainLevel: "degraded", domainScore: 0.4 });
    const after = makeSnapshot({ domainLevel: "healthy", domainScore: 0.9 });
    const action = makeRecoveryAction({ estimatedRecoveryTime: 50 });

    const result = evaluateRecoveryResult({ beforeState: before, afterState: after, action, elapsedTicks: 60 });
    expect(result).toBe("success");
  });

  it("domainLevel 从 critical 升到 stable → success", () => {
    const before = makeSnapshot({ domainLevel: "critical", domainScore: 0.1 });
    const after = makeSnapshot({ domainLevel: "stable", domainScore: 0.7 });
    const action = makeRecoveryAction({ estimatedRecoveryTime: 50 });

    const result = evaluateRecoveryResult({ beforeState: before, afterState: after, action, elapsedTicks: 60 });
    expect(result).toBe("success");
  });
});

describe("A4.6 E2E-008: Verification — domainScore 改善 → partial", () => {
  it("domainScore 改善 >0.1 但 level 不变 → partial", () => {
    const before = makeSnapshot({ domainLevel: "degraded", domainScore: 0.3 });
    const after = makeSnapshot({ domainLevel: "degraded", domainScore: 0.5 });
    const action = makeRecoveryAction({ estimatedRecoveryTime: 50 });

    const result = evaluateRecoveryResult({ beforeState: before, afterState: after, action, elapsedTicks: 60 });
    expect(result).toBe("partial");
  });

  it("活跃失败数减少 → partial", () => {
    const before = makeSnapshot({ activeFailureCount: 5, domainLevel: "degraded", domainScore: 0.4 });
    const after = makeSnapshot({ activeFailureCount: 3, domainLevel: "degraded", domainScore: 0.4 });
    const action = makeRecoveryAction({ estimatedRecoveryTime: 50 });

    const result = evaluateRecoveryResult({ beforeState: before, afterState: after, action, elapsedTicks: 60 });
    expect(result).toBe("partial");
  });

  it("spawn_recovery 人口增长 → partial", () => {
    const before = makeSnapshot({ population: 3, domainLevel: "degraded", domainScore: 0.4, activeFailureCount: 2 });
    const after = makeSnapshot({ population: 5, domainLevel: "degraded", domainScore: 0.4, activeFailureCount: 2 });
    const action = makeRecoveryAction({ type: "spawn_recovery", estimatedRecoveryTime: 50 });

    const result = evaluateRecoveryResult({ beforeState: before, afterState: after, action, elapsedTicks: 60 });
    expect(result).toBe("partial");
  });

  it("logistics_fix 投递率改善 → partial", () => {
    const before = makeSnapshot({ deliveryRate: 0.3, domainLevel: "degraded", domainScore: 0.4, activeFailureCount: 2 });
    const after = makeSnapshot({ deliveryRate: 0.5, domainLevel: "degraded", domainScore: 0.4, activeFailureCount: 2 });
    const action = makeRecoveryAction({ type: "logistics_fix", estimatedRecoveryTime: 50 });

    const result = evaluateRecoveryResult({ beforeState: before, afterState: after, action, elapsedTicks: 60 });
    expect(result).toBe("partial");
  });

  it("remote_stall 活跃远矿数减少 → success", () => {
    const before = makeSnapshot({ activeRemoteOps: 3, domainLevel: "degraded", domainScore: 0.4, activeFailureCount: 2 });
    const after = makeSnapshot({ activeRemoteOps: 2, domainLevel: "degraded", domainScore: 0.4, activeFailureCount: 2 });
    const action = makeRecoveryAction({ type: "remote_stall", estimatedRecoveryTime: 10 });

    const result = evaluateRecoveryResult({ beforeState: before, afterState: after, action, elapsedTicks: 20 });
    expect(result).toBe("success");
  });
});

describe("A4.6 E2E-009: Verification — 无改善 + 超时 → failed", () => {
  it("超过 2× estimatedRecoveryTime 仍无改善 → failed", () => {
    const before = makeSnapshot({ domainLevel: "degraded", domainScore: 0.4, activeFailureCount: 2, population: 5 });
    const after = makeSnapshot({ domainLevel: "degraded", domainScore: 0.4, activeFailureCount: 2, population: 5 });
    const action = makeRecoveryAction({ type: "spawn_recovery", estimatedRecoveryTime: 50 });

    const result = evaluateRecoveryResult({ beforeState: before, afterState: after, action, elapsedTicks: 120 });
    expect(result).toBe("failed");
  });
});

describe("A4.6 E2E-010: Verification — 未到恢复时间 → no_progress", () => {
  it("提交成功但没改善且未超时 → no_progress", () => {
    const before = makeSnapshot({ domainLevel: "degraded", domainScore: 0.4, activeFailureCount: 2, population: 5 });
    const after = makeSnapshot({ domainLevel: "degraded", domainScore: 0.4, activeFailureCount: 2, population: 5 });
    const action = makeRecoveryAction({ type: "spawn_recovery", estimatedRecoveryTime: 100 });

    const result = evaluateRecoveryResult({ beforeState: before, afterState: after, action, elapsedTicks: 30 });
    expect(result).toBe("no_progress");
  });
});

// ─── E2E-011: Retry Policy ────────────────────────────────

describe("A4.6 E2E-011: Retry Policy 配置", () => {
  it("spawn_recovery: 3 attempts, 100 cooldown, retryable", () => {
    const policy = getRetryPolicy("spawn_recovery");
    expect(policy.maxAttempts).toBe(3);
    expect(policy.cooldownDuration).toBe(100);
    expect(policy.classification).toBe("retryable");
  });

  it("remote_stall: 1 attempt, non_retryable", () => {
    const policy = getRetryPolicy("remote_stall");
    expect(policy.maxAttempts).toBe(1);
    expect(policy.classification).toBe("non_retryable");
  });

  it("defense_response: 5 attempts, 50 cooldown", () => {
    const policy = getRetryPolicy("defense_response");
    expect(policy.maxAttempts).toBe(5);
    expect(policy.cooldownDuration).toBe(50);
  });

  it("expansion_pause: 1 attempt, non_retryable", () => {
    const policy = getRetryPolicy("expansion_pause");
    expect(policy.maxAttempts).toBe(1);
    expect(policy.classification).toBe("non_retryable");
  });

  it("terminal_trade: 3 attempts, 200 cooldown", () => {
    const policy = getRetryPolicy("terminal_trade");
    expect(policy.maxAttempts).toBe(3);
    expect(policy.cooldownDuration).toBe(200);
  });
});

// ─── E2E-012: Failure Classification ──────────────────────

describe("A4.6 E2E-012: Failure Classification", () => {
  it("threat 关键词 → threat_blocked", () => {
    expect(classifyFailure("threat detected in room", "spawn_recovery")).toBe("threat_blocked");
    expect(classifyFailure("hostile creep found", "logistics_fix")).toBe("threat_blocked");
    expect(classifyFailure("under attack", "defense_response")).toBe("threat_blocked");
  });

  it("energy 关键词 → resource_constrained", () => {
    expect(classifyFailure("not enough energy", "spawn_recovery")).toBe("resource_constrained");
    expect(classifyFailure("resource unavailable", "terminal_trade")).toBe("resource_constrained");
  });

  it("cpu 关键词 → blocked", () => {
    expect(classifyFailure("cpu bucket low", "cpu_conserve")).toBe("blocked");
    expect(classifyFailure("bucket tier recovery", "cpu_conserve")).toBe("blocked");
  });

  it("not found → non_retryable", () => {
    expect(classifyFailure("target not found", "remote_stall")).toBe("non_retryable");
    expect(classifyFailure("room gone", "remote_stall")).toBe("non_retryable");
    expect(classifyFailure("structure destroyed", "logistics_fix")).toBe("non_retryable");
  });

  it("busy/queue/timeout → retryable", () => {
    expect(classifyFailure("spawn busy", "spawn_recovery")).toBe("retryable");
    expect(classifyFailure("queue full", "spawn_recovery")).toBe("retryable");
    expect(classifyFailure("timeout waiting", "logistics_fix")).toBe("retryable");
  });

  it("未知原因回退到默认分类", () => {
    expect(classifyFailure("unknown error", "spawn_recovery")).toBe("retryable");
    expect(classifyFailure("unknown error", "remote_stall")).toBe("non_retryable");
  });
});

// ─── E2E-013~015: Recovery Budget ─────────────────────────

describe("A4.6 E2E-013: Recovery Budget — CPU bucket 不足", () => {
  it("CPU bucket < 1000 → 不允许任何 Recovery", () => {
    const result = evaluateRecoveryBudget({
      tick: TICK,
      cpuBudget: 500,
      empireEnergyReserve: 10000,
      activeRecoveryCount: 0,
      maxCpuPerRecovery: 5,
      maxEnergyPerRecovery: 1000,
    });
    expect(result.allowed).toBe(false);
    expect(result.maxConcurrent).toBe(0);
  });
});

describe("A4.6 E2E-014: Recovery Budget — 低能量只允许零成本", () => {
  it("empireEnergyReserve < 500 → 只允许零成本 Recovery", () => {
    const result = evaluateRecoveryBudget({
      tick: TICK,
      cpuBudget: 5000,
      empireEnergyReserve: 300,
      activeRecoveryCount: 0,
      maxCpuPerRecovery: 5,
      maxEnergyPerRecovery: 1000,
    });
    expect(result.allowed).toBe(true);
    expect(result.maxConcurrent).toBe(1);
    expect(result.energyBudget).toBe(0);
  });
});

describe("A4.6 E2E-015: Recovery Budget — 并发上限", () => {
  it("活跃 Recovery ≥ maxConcurrent → 不允许新增", () => {
    const result = evaluateRecoveryBudget({
      tick: TICK,
      cpuBudget: 2500, // maxConcurrent = min(5, 2500/500) = 5
      empireEnergyReserve: 10000,
      activeRecoveryCount: 5,
      maxCpuPerRecovery: 5,
      maxEnergyPerRecovery: 1000,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("max concurrent");
  });

  it("正常预算 → 允许且有合理 energyBudget", () => {
    const result = evaluateRecoveryBudget({
      tick: TICK,
      cpuBudget: 5000,
      empireEnergyReserve: 10000,
      activeRecoveryCount: 2,
      maxCpuPerRecovery: 5,
      maxEnergyPerRecovery: 1000,
    });
    expect(result.allowed).toBe(true);
    // min(1000, floor(10000 * 0.1)) = min(1000, 1000) = 1000
    expect(result.energyBudget).toBe(1000);
  });
});

// ─── E2E-016: Recovery Unviability ────────────────────────

describe("A4.6 E2E-016: Recovery Unviability", () => {
  it("累计尝试 > 10 → unviable", () => {
    const result = evaluateRecoveryUnviability({
      room: "W1N1",
      domain: "spawn",
      totalAttempts: 12,
      totalInvested: 1000,
      totalRecoveryTime: 500,
      tick: TICK,
    });
    expect(result.unviable).toBe(true);
    expect(result.reason).toContain("too many attempts");
  });

  it("累计投入 > 5000 且时间 > 5000 → unviable", () => {
    const result = evaluateRecoveryUnviability({
      room: "W1N1",
      domain: "energy",
      totalAttempts: 5,
      totalInvested: 6000,
      totalRecoveryTime: 6000,
      tick: TICK,
    });
    expect(result.unviable).toBe(true);
    expect(result.reason).toContain("excessive investment");
  });

  it("正常恢复 → viable", () => {
    const result = evaluateRecoveryUnviability({
      room: "W1N1",
      domain: "spawn",
      totalAttempts: 2,
      totalInvested: 500,
      totalRecoveryTime: 200,
      tick: TICK,
    });
    expect(result.unviable).toBe(false);
  });
});

// ─── E2E-017~019: Escalation ──────────────────────────────

describe("A4.6 E2E-017: Escalation — spawn 失败因能量不足", () => {
  it("spawn_recovery 失败 + 能量原因 → 建议 energy_redirect", () => {
    const record = makeRecord({
      type: "spawn_recovery",
      state: "failed",
      attempts: 2,
      failureReason: "not enough energy to spawn",
    });
    const failureNode = makeFailureNode({ domain: "spawn" });

    const result = evaluateEscalation({
      failedRecord: record,
      failureNode,
      allFailures: [],
      tick: TICK,
    });

    expect(result.shouldEscalate).toBe(true);
    expect(result.suggestedActionType).toBe("energy_redirect");
    expect(result.suggestedDomain).toBe("energy");
  });
});

describe("A4.6 E2E-018: Escalation — logistics 失败因威胁", () => {
  it("logistics_fix 失败 + 威胁原因 → 建议 defense_response", () => {
    const record = makeRecord({
      type: "logistics_fix",
      state: "failed",
      attempts: 2,
      failureReason: "threat blocked the route",
    });
    const failureNode = makeFailureNode({ domain: "logistics" });

    const result = evaluateEscalation({
      failedRecord: record,
      failureNode,
      allFailures: [],
      tick: TICK,
    });

    expect(result.shouldEscalate).toBe(true);
    expect(result.suggestedActionType).toBe("defense_response");
    expect(result.suggestedDomain).toBe("defense");
  });
});

describe("A4.6 E2E-019: Escalation — terminal 状态", () => {
  it("terminal 状态 → 必须找替代路径", () => {
    const record = makeRecord({
      type: "spawn_recovery",
      state: "terminal",
      attempts: 3,
      maxAttempts: 3,
      failureReason: "max attempts exceeded",
    });
    const failureNode = makeFailureNode();

    const result = evaluateEscalation({
      failedRecord: record,
      failureNode,
      allFailures: [],
      tick: TICK,
    });

    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain("terminal");
  });

  it("首次失败不升级", () => {
    const record = makeRecord({
      type: "spawn_recovery",
      state: "failed",
      attempts: 1,
      failureReason: "spawn busy",
    });
    const failureNode = makeFailureNode();

    const result = evaluateEscalation({
      failedRecord: record,
      failureNode,
      allFailures: [],
      tick: TICK,
    });

    expect(result.shouldEscalate).toBe(false);
  });
});

// ─── E2E-020: Cleanup ─────────────────────────────────────

describe("A4.6 E2E-020: Cleanup 过期记录", () => {
  it("succeeded 记录 500 tick 后清理", () => {
    const table: RecoveryActionTable = new Map();
    table.set("key1", makeRecord({ state: "succeeded", updatedAt: TICK }));
    table.set("key2", makeRecord({ state: "executing", updatedAt: TICK }));

    const result = cleanupRecoveryTable(table, TICK + 600);
    expect(result.size).toBe(1);
    expect(result.has("key2")).toBe(true);
  });

  it("failed 记录 1000 tick 后清理", () => {
    const table: RecoveryActionTable = new Map();
    table.set("key1", makeRecord({ state: "failed", updatedAt: TICK }));
    table.set("key2", makeRecord({ state: "succeeded", updatedAt: TICK }));

    const result = cleanupRecoveryTable(table, TICK + 550);
    expect(result.size).toBe(1);
    expect(result.has("key1")).toBe(true);
  });

  it("超过 100 条未过期记录时删除最老的", () => {
    const table: RecoveryActionTable = new Map();
    // 用 blocked 状态（保留 500 tick），TICK+200 确保不过期
    for (let i = 0; i < 105; i++) {
      table.set(`key-${i}`, makeRecord({
        state: "blocked",
        updatedAt: TICK + i,
        actionId: `action-${i}`,
        correlationId: `rcv-${i}`,
      }));
    }
    // TICK+200 - (TICK+0) = 200 < 500，不过期；但超过 100 条上限
    const result = cleanupRecoveryTable(table, TICK + 200);
    expect(result.size).toBe(100);
    // 最老的 5 条被删除（updatedAt 最小）
    expect(result.has("key-0")).toBe(false);
    expect(result.has("key-4")).toBe(false);
    expect(result.has("key-5")).toBe(true);
  });

  it("succeeded 记录全部过期时清理到 0", () => {
    const table: RecoveryActionTable = new Map();
    for (let i = 0; i < 105; i++) {
      table.set(`key-${i}`, makeRecord({
        state: "succeeded",
        updatedAt: TICK + i,
        actionId: `action-${i}`,
        correlationId: `rcv-${i}`,
      }));
    }
    // succeeded 记录保留 500 tick；TICK+10000 - (TICK+0) = 10000 > 500
    // 所以所有 105 条都先被清理到 0 条，100 上限不触发
    const result = cleanupRecoveryTable(table, TICK + 10000);
    expect(result.size).toBe(0);
  });

  it("活跃记录不清理", () => {
    const table: RecoveryActionTable = new Map();
    table.set("active", makeRecord({ state: "executing", updatedAt: TICK }));

    const result = cleanupRecoveryTable(table, TICK + 100000);
    expect(result.size).toBe(1);
    expect(result.has("active")).toBe(true);
  });
});

// ─── E2E-021: Stats ───────────────────────────────────────

describe("A4.6 E2E-021: Recovery Stats 计算", () => {
  it("正确统计各状态数量", () => {
    const table: RecoveryActionTable = new Map();
    table.set("a1", makeRecord({ state: "executing", actionId: "a1", correlationId: "c1", attempts: 1 }));
    table.set("a2", makeRecord({ state: "succeeded", actionId: "a2", correlationId: "c2", attempts: 2, submittedAt: TICK, updatedAt: TICK + 60 }));
    table.set("a3", makeRecord({ state: "failed", actionId: "a3", correlationId: "c3", attempts: 1 }));
    table.set("a4", makeRecord({ state: "terminal", actionId: "a4", correlationId: "c4", attempts: 3 }));
    table.set("a5", makeRecord({ state: "blocked", actionId: "a5", correlationId: "c5", attempts: 1 }));

    const stats = computeRecoveryStats(table, TICK + 100);
    expect(stats.activeCount).toBe(1);
    expect(stats.succeededCount).toBe(1);
    expect(stats.failedCount).toBe(1);
    expect(stats.terminalCount).toBe(1);
    expect(stats.blockedCount).toBe(1);
    expect(stats.totalAttempts).toBe(8);
    expect(stats.avgRecoveryTime).toBe(60); // 60 tick for the one succeeded
  });

  it("空表 → 全零", () => {
    const table: RecoveryActionTable = new Map();
    const stats = computeRecoveryStats(table, TICK);
    expect(stats.activeCount).toBe(0);
    expect(stats.succeededCount).toBe(0);
    expect(stats.avgRecoveryTime).toBe(0);
  });
});

// ─── isActionActive ───────────────────────────────────────

describe("A4.6 isActionActive", () => {
  it("活跃状态返回 true", () => {
    expect(isActionActive(makeRecord({ state: "proposed" }))).toBe(true);
    expect(isActionActive(makeRecord({ state: "validated" }))).toBe(true);
    expect(isActionActive(makeRecord({ state: "submitted" }))).toBe(true);
    expect(isActionActive(makeRecord({ state: "executing" }))).toBe(true);
    expect(isActionActive(makeRecord({ state: "verifying" }))).toBe(true);
  });

  it("非活跃状态返回 false", () => {
    expect(isActionActive(makeRecord({ state: "succeeded" }))).toBe(false);
    expect(isActionActive(makeRecord({ state: "failed" }))).toBe(false);
    expect(isActionActive(makeRecord({ state: "retryable" }))).toBe(false);
    expect(isActionActive(makeRecord({ state: "terminal" }))).toBe(false);
    expect(isActionActive(makeRecord({ state: "blocked" }))).toBe(false);
  });

  it("undefined 返回 false", () => {
    expect(isActionActive(undefined)).toBe(false);
  });
});
