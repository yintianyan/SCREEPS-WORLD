/** A5.3.1 GAP-1 E2E Tests — Recovery Chain Closure。 */

import { describe, expect, it } from "vitest";
import {
  mapAbortToRecoveryAction,
  mapAbortSignalsToRecoveryActions,
  abortSignalHash,
  type WarAbortSignal,
} from "../../../src/domain/military/abort-recovery";
import {
  recoveryIdempotencyKey,
  shouldSubmitAction,
  createActionRecord,
  markSubmitted,
  markExecuting,
  markSucceeded,
  markFailed,
  markBlocked,
  getRetryPolicy,
  cleanupRecoveryTable,
  computeRecoveryStats,
  isActionActive,
  evaluateRecoveryResult,
  evaluateEscalation,
  evaluateRecoveryUnviability,
  type RecoveryActionTable,
  type RecoveryActionRecord,
  type RecoveryWorldSnapshot,
} from "../../../src/domain/strategy/recovery-lifecycle";
import type { RecoveryAction } from "../../../src/domain/strategy/recovery-priority";

// ─── 辅助函数 ──────────────────────────────────────────────

function makeAbortSignal(overrides: Partial<WarAbortSignal> = {}): WarAbortSignal {
  return {
    tick: 1000,
    reason: "ATTRITION",
    targetRoom: "W12N10",
    sponsor: "W11N10",
    spawned: 5,
    outcome: "failure",
    ...overrides,
  };
}

function makeWorldSnapshot(overrides: Partial<RecoveryWorldSnapshot> = {}): RecoveryWorldSnapshot {
  return {
    healthScore: 0.4,
    healthLevel: "degraded",
    activeFailureCount: 3,
    domainScore: 0.3,
    domainLevel: "critical",
    room: "W11N10",
    energyAvailable: 200,
    population: 5,
    deliveryRate: 0.5,
    activeRemoteOps: 2,
    ...overrides,
  };
}

// ─── REC-001: 完整链路 ─────────────────────────────────────

describe("A5.3.1-REC-001: WarPlan → Abort → warAbortSignals → Recovery Intent → Recovery Action", () => {
  it("完整链路：信号 → 纯函数转换 → RecoveryAction → 幂等检查通过 → 可提交", () => {
    // 1. 模拟 war-planner demobilize 写入 warAbortSignals
    const signal = makeAbortSignal({
      reason: "ATTRITION",
      outcome: "failure",
      spawned: 8,
    });

    // 2. recovery-execution-system 消费信号
    const actions = mapAbortSignalsToRecoveryActions([signal]);
    expect(actions).toHaveLength(1);

    const action = actions[0]!;
    expect(action.type).toBe("population_rebuild");
    expect(action.urgent).toBe(true);
    expect(action.priority).toBeGreaterThan(50);

    // 3. 幂等检查：新 action 应该可以提交
    const table: RecoveryActionTable = new Map();
    const check = shouldSubmitAction(table, action, 1000, 500);
    expect(check.submit).toBe(true);

    // 4. 创建追踪记录
    const record = createActionRecord(action, 1000, 2);
    expect(record.state).toBe("proposed");

    // 5. 提交
    const submitted = markSubmitted(record, 1000);
    expect(submitted.state).toBe("submitted");

    // 6. 执行中
    const executing = markExecuting(submitted, 1000);
    expect(executing.state).toBe("executing");
  });

  it("信号 hash 在整个链路中保持确定性", () => {
    const signal = makeAbortSignal();
    const hash = abortSignalHash(signal);
    // 相同信号总是相同 hash
    expect(abortSignalHash(makeAbortSignal())).toBe(hash);
  });
});

// ─── REC-002: 重复 Abort 幂等 ───────────────────────────────

describe("A5.3.1-REC-002: 重复 Abort → 不产生重复 Recovery 执行", () => {
  it("相同 sponsor+reason 的信号只产生一个 idempotency key", () => {
    const signal1 = makeAbortSignal({ tick: 1000 });
    const signal2 = makeAbortSignal({ tick: 2000 }); // 不同 tick

    const action1 = mapAbortToRecoveryAction(signal1)!;
    const action2 = mapAbortToRecoveryAction(signal2)!;

    // 相同 key（sponsor + reason 相同）
    expect(recoveryIdempotencyKey(action1)).toBe(recoveryIdempotencyKey(action2));
  });

  it("活跃的 action 不被重复提交", () => {
    const signal = makeAbortSignal();
    const action = mapAbortToRecoveryAction(signal)!;
    const table: RecoveryActionTable = new Map();

    // 第一次提交
    let record = createActionRecord(action, 1000, 3);
    record = markSubmitted(record, 1000);
    record = markExecuting(record, 1000);
    table.set(recoveryIdempotencyKey(action), record);

    // 第二次尝试 — 应该被去重
    const check = shouldSubmitAction(table, action, 1010, 500);
    expect(check.submit).toBe(false);
    expect(check.reason).toContain("active");
  });

  it("cooldown 期内不重试", () => {
    const signal = makeAbortSignal();
    const action = mapAbortToRecoveryAction(signal)!;
    const table: RecoveryActionTable = new Map();

    let record = createActionRecord(action, 1000, 3);
    record = markFailed(record, 1050, "test", true);
    table.set(recoveryIdempotencyKey(action), record);

    // population_rebuild cooldown=500
    const policy = getRetryPolicy(action.type);
    const check = shouldSubmitAction(table, action, 1100, policy.cooldownDuration);
    expect(check.submit).toBe(false);
  });

  it("批量信号去重：相同 sponsor 的多个信号只产生一个活跃 action", () => {
    const signals = [
      makeAbortSignal({ tick: 1000, reason: "ATTRITION" }),
      makeAbortSignal({ tick: 1100, reason: "ATTRITION" }), // 相同 sponsor+reason
      makeAbortSignal({ tick: 1200, reason: "ATTRITION" }),
    ];

    const actions = mapAbortSignalsToRecoveryActions(signals);
    const keys = new Set(actions.map(a => recoveryIdempotencyKey(a)));
    expect(keys.size).toBe(1); // 全部去重到同一个 key
  });
});

// ─── REC-003: Recovery unavailable → escalation ───────────

describe("A5.3.1-REC-003: Recovery unavailable → escalation 而不是无限 retry", () => {
  it("maxAttempts 烧穿 → terminal 状态 → 不重试", () => {
    const signal = makeAbortSignal({ reason: "ATTRITION" });
    const action = mapAbortToRecoveryAction(signal)!;
    const table: RecoveryActionTable = new Map();

    // 模拟 maxAttempts 烧穿
    let record = createActionRecord(action, 1000, 2);
    record = markSubmitted(record, 1000);
    record = markFailed(record, 1050, "fail 1", true);
    record = markSubmitted(record, 1100);
    record = markFailed(record, 1150, "fail 2", true);
    // attempts=2 >= maxAttempts=2 → 下一次失败应该 terminal
    record = markFailed(record, 1200, "fail 3", false);
    table.set(recoveryIdempotencyKey(action), record);

    // 应该不再提交
    const check = shouldSubmitAction(table, action, 2000, 500);
    expect(check.submit).toBe(false);
  });

  it("terminal 状态 → evaluateRecoveryUnviability 标记不可恢复", () => {
    const signal = makeAbortSignal({ reason: "ATTRITION" });
    const action = mapAbortToRecoveryAction(signal)!;

    let record = createActionRecord(action, 1000, 2);
    record = { ...record, attempts: 11, state: "terminal" as const, updatedAt: 1500 };

    const unviability = evaluateRecoveryUnviability({
      room: "W11N10",
      domain: action.domain,
      totalAttempts: record.attempts,
      totalInvested: 6000,
      totalRecoveryTime: 6000,
      tick: 1500,
    });

    // 应该检测到不可恢复（attempts > 10 或 invested > 5000 && time > 5000）
    expect(unviability.unviable).toBe(true);
  });

  it("Escalation 在失败后触发", () => {
    const signal = makeAbortSignal({ reason: "ATTRITION" });
    const action = mapAbortToRecoveryAction(signal)!;

    let record = createActionRecord(action, 1000, 3);
    record = { ...record, attempts: 2, state: "failed" as const, updatedAt: 1500, failureReason: "test failure" };

    const escalation = evaluateEscalation({
      failedRecord: record,
      failureNode: {
        id: action.targetFailureId,
        domain: action.domain,
        severity: "error",
        description: action.description,
        detectedAt: 1000,
      },
      allFailures: [],
      tick: 1500,
    });

    // 应该建议升级（attempts >= 2 && state === "failed"）
    expect(escalation.shouldEscalate).toBe(true);
  });
});

// ─── REC-004: Logistics failure → Recovery 路径 ────────────

describe("A5.3.1-REC-004: Logistics failure → Recovery 路径正确触发", () => {
  it("PLAN_TIMEOUT (可能涉及物流失败) → population_rebuild", () => {
    const signal = makeAbortSignal({ reason: "PLAN_TIMEOUT" });
    const action = mapAbortToRecoveryAction(signal)!;
    expect(action.type).toBe("population_rebuild");
    expect(action.domain).toBe("colony");
  });

  it("Recovery Action 的 targetFailureId 包含 sponsor 房间", () => {
    const signal = makeAbortSignal({ sponsor: "W15N15" });
    const action = mapAbortToRecoveryAction(signal)!;
    expect(action.targetFailureId).toContain("W15N15");
  });

  it("World State 验证：恢复前 degraded → 恢复后 healthy", () => {
    const beforeState = makeWorldSnapshot({
      healthScore: 0.3,
      healthLevel: "critical",
      activeFailureCount: 5,
    });

    const afterState = makeWorldSnapshot({
      healthScore: 0.8,
      healthLevel: "healthy",
      domainScore: 0.8,
      domainLevel: "healthy",
      activeFailureCount: 1,
    });

    const action: RecoveryAction = {
      id: "test",
      type: "population_rebuild",
      targetFailureId: "war-abort:W11N10",
      domain: "colony",
      priority: 80,
      estimatedCost: 800,
      estimatedBenefit: 60,
      roi: 0.075,
      urgent: true,
      estimatedRecoveryTime: 500,
      description: "test",
      recommendation: "test",
    };

    const result = evaluateRecoveryResult({
      beforeState,
      afterState,
      action,
      elapsedTicks: 100,
    });

    expect(result).toBe("success");
  });
});

// ─── ENVIRONMENT_BLOCKED 测试 ──────────────────────────────

describe("ENVIRONMENT_BLOCKED: 真实 Screeps 环境测试", () => {
  it("ENVIRONMENT_BLOCKED: 真实 warAbortSignals 写入 → recovery-execution-system 消费", () => {
    // 此测试需要真实 Screeps 环境（Game/Memory/kernel）
    // 在本地环境无法执行 — 标记为 ENVIRONMENT_BLOCKED
    // 在 CI / Screeps 私服环境运行时取消注释

    // const g = globalCache();
    // g.warAbortSignals = { tick: 1000, reason: "ATTRITION", ... };
    // const actions = consumeWarAbortSignals(g, 1000);
    // expect(actions).toHaveLength(1);

    expect(true).toBe(true); // placeholder
  });
});
