/** A5.3.1 GAP-1 Unit Tests — AbortReason → RecoveryAction 映射 + 幂等 + 确定性。 */

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
  getRetryPolicy,
  type RecoveryActionTable,
} from "../../../src/domain/strategy/recovery-lifecycle";
import type { RecoveryAction } from "../../../src/domain/strategy/recovery-priority";

// ─── 测试数据 ──────────────────────────────────────────────

function makeSignal(overrides: Partial<WarAbortSignal> = {}): WarAbortSignal {
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

// ─── AbortReason → RecoveryAction 映射 ──────────────────────

describe("A5.3.1 AbortReason → RecoveryAction 映射", () => {
  it("ATTRITION → population_rebuild", () => {
    const signal = makeSignal({ reason: "ATTRITION" });
    const action = mapAbortToRecoveryAction(signal);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("population_rebuild");
    expect(action!.domain).toBe("colony");
    expect(action!.urgent).toBe(true);
  });

  it("POSTURE → expansion_pause", () => {
    const signal = makeSignal({ reason: "POSTURE", outcome: "success" });
    const action = mapAbortToRecoveryAction(signal);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("expansion_pause");
    expect(action!.domain).toBe("expansion");
    expect(action!.urgent).toBe(false);
  });

  it("NO_TARGET → auto_resolve", () => {
    const signal = makeSignal({ reason: "NO_TARGET" });
    const action = mapAbortToRecoveryAction(signal);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("auto_resolve");
  });

  it("PLAN_TIMEOUT → population_rebuild", () => {
    const signal = makeSignal({ reason: "PLAN_TIMEOUT" });
    const action = mapAbortToRecoveryAction(signal);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("population_rebuild");
  });

  it("未知 reason → null", () => {
    const signal = makeSignal({ reason: "UNKNOWN" } as WarAbortSignal);
    const action = mapAbortToRecoveryAction(signal);
    expect(action).toBeNull();
  });

  it("outcome=failure 提升 urgency", () => {
    const signal = makeSignal({ reason: "POSTURE", outcome: "failure" });
    const action = mapAbortToRecoveryAction(signal);
    expect(action).not.toBeNull();
    expect(action!.urgent).toBe(true);
  });

  it("outcome=success 不提升 urgency", () => {
    const signal = makeSignal({ reason: "POSTURE", outcome: "success" });
    const action = mapAbortToRecoveryAction(signal);
    expect(action).not.toBeNull();
    expect(action!.urgent).toBe(false);
  });

  it("spawned > 5 提升优先级", () => {
    const lowSpawn = makeSignal({ spawned: 2, outcome: "success" });
    const highSpawn = makeSignal({ spawned: 10, outcome: "success" });
    const lowAction = mapAbortToRecoveryAction(lowSpawn)!;
    const highAction = mapAbortToRecoveryAction(highSpawn)!;
    expect(highAction.priority).toBeGreaterThan(lowAction.priority);
  });
});

// ─── 批量转换 ──────────────────────────────────────────────

describe("A5.3.1 批量转换", () => {
  it("多个信号批量转换保持顺序", () => {
    const signals = [
      makeSignal({ reason: "POSTURE", sponsor: "W11N10" }),
      makeSignal({ reason: "ATTRITION", sponsor: "W12N10" }),
      makeSignal({ reason: "NO_TARGET", sponsor: "W13N10" }),
    ];
    const actions = mapAbortSignalsToRecoveryActions(signals);
    expect(actions).toHaveLength(3);
    expect(actions[0]!.type).toBe("expansion_pause");
    expect(actions[1]!.type).toBe("population_rebuild");
    expect(actions[2]!.type).toBe("auto_resolve");
  });

  it("空列表返回空", () => {
    const actions = mapAbortSignalsToRecoveryActions([]);
    expect(actions).toHaveLength(0);
  });
});

// ─── 幂等性 / Cooldown ─────────────────────────────────────

describe("A5.3.1 幂等性 + Cooldown", () => {
  it("相同 sponsor+reason 产出相同 idempotency key", () => {
    const signal = makeSignal({ reason: "ATTRITION", sponsor: "W11N10" });
    const action = mapAbortToRecoveryAction(signal)!;
    const key = recoveryIdempotencyKey(action);

    // 再来一个相同 sponsor 的
    const signal2 = makeSignal({ reason: "ATTRITION", sponsor: "W11N10", tick: 2000 });
    const action2 = mapAbortToRecoveryAction(signal2)!;
    const key2 = recoveryIdempotencyKey(action2);

    expect(key).toBe(key2);
  });

  it("shouldSubmitAction: 新 action 可以提交", () => {
    const table: RecoveryActionTable = new Map();
    const signal = makeSignal({ reason: "ATTRITION" });
    const action = mapAbortToRecoveryAction(signal)!;
    const check = shouldSubmitAction(table, action, 1000, 200);
    expect(check.submit).toBe(true);
  });

  it("shouldSubmitAction: 活跃 action 不重复提交", () => {
    const signal = makeSignal({ reason: "ATTRITION" });
    const action = mapAbortToRecoveryAction(signal)!;
    const table: RecoveryActionTable = new Map();
    let record = createActionRecord(action, 1000, 3);
    record = markSubmitted(record, 1000);
    record = markExecuting(record, 1000);
    table.set(recoveryIdempotencyKey(action), record);

    const check = shouldSubmitAction(table, action, 1010, 200);
    expect(check.submit).toBe(false);
    expect(check.reason).toContain("active");
  });

  it("shouldSubmitAction: cooldown 期内不重试", () => {
    const signal = makeSignal({ reason: "ATTRITION" });
    const action = mapAbortToRecoveryAction(signal)!;
    const table: RecoveryActionTable = new Map();
    let record = createActionRecord(action, 1000, 3);
    record = markFailed(record, 1050, "test failure", true);
    table.set(recoveryIdempotencyKey(action), record);

    // cooldown=200, 当前 tick=1100 → 还在 cooldown 内
    const check = shouldSubmitAction(table, action, 1100, 200);
    expect(check.submit).toBe(false);
    expect(check.reason).toContain("cooldown");
  });

  it("shouldSubmitAction: cooldown 过期后可重试", () => {
    const signal = makeSignal({ reason: "ATTRITION" });
    const action = mapAbortToRecoveryAction(signal)!;
    const table: RecoveryActionTable = new Map();
    let record = createActionRecord(action, 1000, 3);
    record = markFailed(record, 1050, "test failure", true);
    table.set(recoveryIdempotencyKey(action), record);

    // cooldown=200, 失败 tick=1050 → 1250 过期
    const check = shouldSubmitAction(table, action, 1300, 200);
    expect(check.submit).toBe(true);
  });

  it("maxAttempts 烧穿后标记 terminal", () => {
    const signal = makeSignal({ reason: "ATTRITION" });
    const action = mapAbortToRecoveryAction(signal)!;
    const table: RecoveryActionTable = new Map();
    let record = createActionRecord(action, 1000, 2);
    record = markSubmitted(record, 1000);
    record = markFailed(record, 1050, "fail 1", true);
    record = markSubmitted(record, 1100);
    record = markFailed(record, 1150, "fail 2", true);
    // attempts=2 >= maxAttempts=2 → terminal (not retryable)
    record = markFailed(record, 1200, "fail 3", false);
    table.set(recoveryIdempotencyKey(action), record);

    const check = shouldSubmitAction(table, action, 2000, 200);
    expect(check.submit).toBe(false);
    // terminal 状态 → 不重试
  });
});

// ─── Escalation / RecoveryUnavailable ─────────────────────

describe("A5.3.1 Escalation + RecoveryUnavailable", () => {
  it("RecoveryUnavailable: maxAttempts=0 → terminal", () => {
    // auto_resolve 的 RetryPolicy: maxAttempts=1, non_retryable
    const signal = makeSignal({ reason: "NO_TARGET" });
    const action = mapAbortToRecoveryAction(signal)!;
    const policy = getRetryPolicy(action.type);
    expect(policy.classification).toBe("non_retryable");
    expect(policy.maxAttempts).toBe(1);
  });

  it("同一信号多次调用不产生无限 action", () => {
    const signal = makeSignal({ reason: "ATTRITION" });
    const actions: RecoveryAction[] = [];
    for (let i = 0; i < 10; i++) {
      actions.push(mapAbortToRecoveryAction(signal)!);
    }
    // 全部产出相同 id → recoveryIdempotencyKey 去重
    const keys = new Set(actions.map(a => recoveryIdempotencyKey(a)));
    expect(keys.size).toBe(1);
  });
});

// ─── 确定性 ────────────────────────────────────────────────

describe("A5.3.1 确定性", () => {
  it("相同 input → 相同 output", () => {
    const signal = makeSignal();
    const action1 = mapAbortToRecoveryAction(signal)!;
    const action2 = mapAbortToRecoveryAction(signal)!;
    expect(action1.id).toBe(action2.id);
    expect(action1.type).toBe(action2.type);
    expect(action1.priority).toBe(action2.priority);
    expect(action1.roi).toBe(action2.roi);
  });

  it("相同 signal → 相同 hash", () => {
    const signal = makeSignal();
    const hash1 = abortSignalHash(signal);
    const hash2 = abortSignalHash(signal);
    expect(hash1).toBe(hash2);
  });

  it("不同 signal → 不同 hash", () => {
    const signal1 = makeSignal({ reason: "ATTRITION" });
    const signal2 = makeSignal({ reason: "POSTURE" });
    expect(abortSignalHash(signal1)).not.toBe(abortSignalHash(signal2));
  });

  it("hash 不使用 Date.now / Math.random", () => {
    const signal = makeSignal({ tick: 12345 });
    const hash = abortSignalHash(signal);
    // 确定性：相同 tick 总是产出相同 hash
    expect(hash).toBe(abortSignalHash(makeSignal({ tick: 12345 })));
    // 长度为 8（fnv1a32 hex）
    expect(hash.length).toBe(8);
    // 是有效的十六进制字符串
    expect(/^[0-9a-f]{8}$/.test(hash)).toBe(true);
  });
});

// ─── Domain Purity ─────────────────────────────────────────

describe("A5.3.1 Domain Purity — abort-recovery.ts", () => {
  it("不引用 Game / Memory / RawMemory", async () => {
    const source = await import("node:fs").then(fs =>
      fs.readFileSync(
        new URL("../../../src/domain/military/abort-recovery.ts", import.meta.url),
        "utf8",
      ),
    );
    // 移除注释行
    const codeLines = source.split("\n")
      .filter(l => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");
    expect(codeLines).not.toMatch(/Game\./);
    expect(codeLines).not.toMatch(/Memory\./);
    expect(codeLines).not.toMatch(/RawMemory\./);
    expect(codeLines).not.toMatch(/console\./);
  });
});
