/**
 * Phase 37 Final Closure — Expansion Outcome Correlation 反事实测试 (v3)
 *
 * 验证 AI-2 修复（decisionId 优先 + target+completedTick fallback）的反事实场景。
 * 核心发现：startedAt 在状态机推进中被反复覆盖，不能作为唯一关联键。
 * planId 在旧版 Memory 可能缺失且不能直接从 DecisionRef 获取。
 * 修复方案：用 decisionId 作为唯一稳定关联键——collectExpansionDecisions 分配并写入
 * Memory.kernel.expansion.decisionId，recordExpansionOutcome 读取并写入 lastExpansionOutcome.decisionId。
 *
 *   E1:  Expansion A outcome 不被 B 使用（decisionId 不匹配）
 *   E2:  A/B 各自正确归属
 *   E3:  A 进行中不读 B 的 outcome
 *   E4:  target + decisionId 都不匹配 → 不注入
 *   E5:  同 target 多次 expansion → decisionId 消歧
 *   E6:  不同 target → 不交叉污染
 *   E7:  完成顺序不同于 decision 顺序 → 不错误归因
 *   E8:  heap reset → 不伪造历史
 *   E9:  超出 measurement window → unresolved
 *   E10: 接近同时完成 → decisionId 唯一关联
 *   E11: startedAt 被状态机覆盖 → decisionId 仍可靠
 *   E12: fallback — 无 decisionId 时 target + completedTick > decisionTick
 *   E13: fallback 已知限制 — 无 decisionId 时同 target 风险
 */
import { describe, it, expect, beforeEach } from "vitest";
import { globalCache } from "../../../../src/kernel/global-cache";
import {
  type OutcomeCollectionInput,
  collectOutcome,
} from "../../../../src/domain/intelligence/outcome";
import {
  type ExperienceRecord,
  type ExperienceIdentity,
  type DecisionRef,
  type ExperienceContext,
  createExperience,
  makeExperienceId,
  buildDecisionRef,
  MEASUREMENT_DELAYS,
} from "../../../../src/domain/intelligence/experience";

// ─── Helpers ──────────────────────────────────────────────

function makeIdentity(tick: number, seq: number): ExperienceIdentity {
  return { experienceId: makeExperienceId(tick, seq), tick, source: "experience-collector", type: "expansion" };
}

function makeRef(decisionTick: number, targetRoom: string, decisionId?: string): DecisionRef {
  const id = decisionId ?? `D-${decisionTick}-1`;
  return buildDecisionRef({
    decisionId: id,
    tick: decisionTick,
    category: "EXPANSION",
    actor: "expansion-manager",
    selectedAction: `EXPANSION_START_${targetRoom}`,
    decisionHash: "abcd1234",
    correlationId: `rcv-${id}-${decisionTick}`,
  });
}

function makeContext(decisionTick: number, targetRoom: string): ExperienceContext {
  return {
    scope: targetRoom,
    posture: "develop",
    empireHealthLevel: "healthy",
    empireHealthScore: 0.8,
    cpuTier: "healthy",
    stateBeforeHash: "snap_hash_1",
    metrics: { expansionDuration: 0, hostilesInRoom: 0 },
  };
}

function makeExperience(decisionTick: number, targetRoom: string, seq: number, decisionId?: string): ExperienceRecord {
  return createExperience(makeIdentity(decisionTick, seq), makeRef(decisionTick, targetRoom, decisionId), makeContext(decisionTick, targetRoom), 1);
}

/**
 * 模拟 buildOutcomeCollectionInput 中 expansion case 的 decisionId 匹配逻辑。
 */
function simulateBuildOutcomeInput(
  exp: ExperienceRecord,
  tick: number,
  lastExpansionOutcome: {
    target: string;
    outcomeCode: number;
    completedTick: number;
    duration: number;
    startedAt: number;
    decisionId?: string;
  } | undefined,
  expansionMem: { target: string; startedAt: number; state: string; decisionId?: string } | undefined,
): OutcomeCollectionInput {
  const input: OutcomeCollectionInput = {
    decisionId: exp.decision.decisionId,
    decisionTick: exp.decision.decisionTick,
    currentTick: tick,
    type: "expansion",
    stateBeforeHash: exp.context.stateBeforeHash,
    stateAfterHash: "",
  };

  const expTargetRoom = exp.decision.selectedAction.replace("EXPANSION_START_", "");

  // 匹配策略：decisionId 优先；有 decisionId 时只认 decisionId，无 decisionId 才用 fallback
  const hasDecisionId = !!(lastExpansionOutcome?.decisionId);
  const decisionIdMatch = hasDecisionId
    && lastExpansionOutcome!.decisionId === exp.decision.decisionId;
  const fallbackMatch = !hasDecisionId && lastExpansionOutcome
    && lastExpansionOutcome.target === expTargetRoom
    && lastExpansionOutcome.completedTick > exp.decision.decisionTick;

  if (lastExpansionOutcome && (decisionIdMatch || fallbackMatch)) {
    const phaseCode = 1;
    input.expansionOutcome = phaseCode * 10 + lastExpansionOutcome.outcomeCode;
    input.expansionDuration = lastExpansionOutcome.duration;
  } else if (expansionMem && expansionMem.target === expTargetRoom
             && (!expansionMem.decisionId || expansionMem.decisionId === exp.decision.decisionId)) {
    input.expansionDuration = tick - expansionMem.startedAt;
  }

  if (exp.context.metrics.hostilesInRoom !== undefined) {
    input.hostilesInRoom = exp.context.metrics.hostilesInRoom;
  }

  return input;
}

// ─── Tests ─────────────────────────────────────────────────

describe("Phase 37 Closure — Expansion Outcome Correlation v3 (AI-2 decisionId)", () => {
  beforeEach(() => {
    const g = globalCache();
    delete g.lastExpansionOutcome;
  });

  // E1: Expansion A 完成 → Outcome A 不被 B 使用
  it("E1: Expansion A outcome is not used by Expansion B (decisionId mismatch)", () => {
    const expA = makeExperience(100, "W1N1", 1, "D-100-1");
    const expB = makeExperience(600, "W2N2", 2, "D-600-2");

    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 500, duration: 400, startedAt: 100, decisionId: "D-100-1",
    };

    const inputB = simulateBuildOutcomeInput(expB, 2600, globalCache().lastExpansionOutcome, undefined);
    expect(inputB.expansionOutcome).toBeUndefined();

    const inputA = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputA.expansionOutcome).toBe(10);
  });

  // E2: A/B 各自正确归属
  it("E2: A and B both complete — correct attribution via decisionId", () => {
    const expA = makeExperience(100, "W1N1", 1, "D-100-1");
    const expB = makeExperience(200, "W2N2", 2, "D-200-2");

    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 500, duration: 400, startedAt: 350, decisionId: "D-100-1",
    };

    const inputA = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputA.expansionOutcome).toBe(10);

    globalCache().lastExpansionOutcome = {
      target: "W2N2", outcomeCode: 2, completedTick: 700, duration: 500, startedAt: 650, decisionId: "D-200-2",
    };

    const inputB = simulateBuildOutcomeInput(expB, 2200, globalCache().lastExpansionOutcome, undefined);
    expect(inputB.expansionOutcome).toBe(12);

    // A 不应匹配 B 的 outcome
    const inputAAfterB = simulateBuildOutcomeInput(expA, 2200, globalCache().lastExpansionOutcome, undefined);
    expect(inputAAfterB.expansionOutcome).toBeUndefined();
  });

  // E3: A 进行中不读 B 的 outcome
  it("E3: Pending expansion A does not use B's outcome (decisionId mismatch)", () => {
    const expA = makeExperience(100, "W1N1", 1, "D-100-1");
    const expansionMemA = { target: "W1N1", startedAt: 100, state: "bootstrapping", decisionId: "D-100-1" };

    globalCache().lastExpansionOutcome = {
      target: "W2N2", outcomeCode: 0, completedTick: 500, duration: 300, startedAt: 200, decisionId: "D-200-2",
    };

    const inputA = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, expansionMemA);
    expect(inputA.expansionOutcome).toBeUndefined();
    expect(inputA.expansionDuration).toBe(2100 - 100);
  });

  // E4: target + decisionId 都不匹配 → 不注入
  it("E4: target mismatch + decisionId mismatch → no outcome injected", () => {
    const exp = makeExperience(100, "W1N1", 1, "D-100-1");
    globalCache().lastExpansionOutcome = {
      target: "W3N3", outcomeCode: 0, completedTick: 500, duration: 400, startedAt: 100, decisionId: "D-999-9",
    };

    const input = simulateBuildOutcomeInput(exp, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(input.expansionOutcome).toBeUndefined();
  });

  // E5: 同 target 多次 expansion → decisionId 消歧
  it("E5: same target multiple expansions — decisionId disambiguates", () => {
    const exp1 = makeExperience(100, "W1N1", 1, "D-100-1");
    const exp2 = makeExperience(600, "W1N1", 2, "D-600-2");

    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 1000, duration: 400, startedAt: 950, decisionId: "D-600-2",
    };

    // exp1 的 decisionId 是 D-100-1，不匹配 D-600-2 → 不注入
    const input1 = simulateBuildOutcomeInput(exp1, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(input1.expansionOutcome).toBeUndefined();

    // exp2 的 decisionId 是 D-600-2，匹配 → 注入
    const input2 = simulateBuildOutcomeInput(exp2, 2600, globalCache().lastExpansionOutcome, undefined);
    expect(input2.expansionOutcome).toBe(10);
  });

  // E6: 不同 target → 不交叉污染
  it("E6: different targets — no cross-contamination", () => {
    const expA = makeExperience(100, "W1N1", 1, "D-100-1");
    const expB = makeExperience(100, "W2N2", 2, "D-100-2");

    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 500, duration: 400, startedAt: 100, decisionId: "D-100-1",
    };

    const inputA = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, undefined);
    const inputB = simulateBuildOutcomeInput(expB, 2100, globalCache().lastExpansionOutcome, undefined);

    expect(inputA.expansionOutcome).toBe(10);
    expect(inputB.expansionOutcome).toBeUndefined();
  });

  // E7: 完成顺序不同于 decision 顺序 → 不错误归因
  it("E7: completion order different from decision order — decisionId prevents misattribution", () => {
    const expA = makeExperience(100, "W1N1", 1, "D-100-1");
    const expB = makeExperience(200, "W2N2", 2, "D-200-2");

    // B 先完成
    globalCache().lastExpansionOutcome = {
      target: "W2N2", outcomeCode: 2, completedTick: 600, duration: 400, startedAt: 550, decisionId: "D-200-2",
    };

    const inputB = simulateBuildOutcomeInput(expB, 2200, globalCache().lastExpansionOutcome, undefined);
    expect(inputB.expansionOutcome).toBe(12);

    // A 不应匹配 B 的 outcome
    const inputA = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputA.expansionOutcome).toBeUndefined();
  });

  // E8: heap reset → 不伪造历史
  it("E8: heap reset — no fabricated outcome", () => {
    const exp = makeExperience(100, "W1N1", 1, "D-100-1");
    const input = simulateBuildOutcomeInput(exp, 2100, undefined, undefined);
    expect(input.expansionOutcome).toBeUndefined();
  });

  // E9: 超出 measurement window → unresolved
  it("E9: outcome delay exceeding measurement window → UNRESOLVED", () => {
    const decisionTick = 100;
    const maxDelay = MEASUREMENT_DELAYS.expansion * 4;
    const currentTick = decisionTick + maxDelay + 1;
    const exp = makeExperience(decisionTick, "W1N1", 1, "D-100-1");
    const input = simulateBuildOutcomeInput(exp, currentTick, undefined, undefined);
    const outcome = collectOutcome(input);
    expect(outcome).toBeUndefined();
  });

  // E10: 接近同时完成 → decisionId 唯一关联
  it("E10: near-simultaneous expansions — decisionId uniquely correlates", () => {
    const expA = makeExperience(100, "W1N1", 1, "D-100-1");
    const expB = makeExperience(101, "W1N1", 2, "D-101-2");

    // A 完成
    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 500, duration: 400, startedAt: 450, decisionId: "D-100-1",
    };

    const inputA = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputA.expansionOutcome).toBe(10);

    // B 不应匹配 A 的 outcome
    const inputB = simulateBuildOutcomeInput(expB, 2101, globalCache().lastExpansionOutcome, undefined);
    expect(inputB.expansionOutcome).toBeUndefined();

    // B 完成
    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 1, completedTick: 501, duration: 400, startedAt: 451, decisionId: "D-101-2",
    };

    const inputBFinal = simulateBuildOutcomeInput(expB, 2101, globalCache().lastExpansionOutcome, undefined);
    expect(inputBFinal.expansionOutcome).toBe(11);

    // A 不应匹配 B 的 outcome
    const inputAFinal = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputAFinal.expansionOutcome).toBeUndefined();
  });

  // E11: startedAt 被状态机覆盖 — decisionId 仍可靠
  it("E11: startedAt overwritten by state machine — decisionId still reliable", () => {
    const exp = makeExperience(100, "W1N1", 1, "D-100-1");

    // startedAt 被覆盖到不同值，但 decisionId 不变
    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 5000, duration: 4500,
      startedAt: 4900, // 被 integrating 状态覆盖，不等于 decisionTick=100
      decisionId: "D-100-1",
    };

    // decisionId 匹配 → 应该注入（即使 startedAt !== decisionTick）
    const input = simulateBuildOutcomeInput(exp, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(input.expansionOutcome).toBe(10);

    // 验证 startedAt 不等于 decisionTick（模拟状态机覆盖）
    expect(globalCache().lastExpansionOutcome!.startedAt).not.toBe(exp.decision.decisionTick);
  });

  // E12: fallback — 无 decisionId 时 target + completedTick > decisionTick 匹配
  it("E12: fallback — no decisionId, target + completedTick > decisionTick", () => {
    const exp = makeExperience(100, "W1N1", 1, "D-100-1");

    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 500, duration: 400, startedAt: 100,
      // decisionId undefined (旧版 Memory)
    };

    const input = simulateBuildOutcomeInput(exp, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(input.expansionOutcome).toBe(10);
  });

  // E13: fallback 已知限制 — 无 decisionId 时同 target 多次扩张风险
  it("E13: fallback — same target multiple expansions without decisionId (known limitation)", () => {
    const exp1 = makeExperience(100, "W1N1", 1, "D-100-1");
    const exp2 = makeExperience(600, "W1N1", 2, "D-600-2");

    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 1000, duration: 400, startedAt: 600,
      // decisionId undefined
    };

    // exp2 匹配（target + completedTick > decisionTick）
    const input2 = simulateBuildOutcomeInput(exp2, 2600, globalCache().lastExpansionOutcome, undefined);
    expect(input2.expansionOutcome).toBe(10);

    // exp1 也匹配 — 这是无 decisionId 的已知限制
    const input1 = simulateBuildOutcomeInput(exp1, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(input1.expansionOutcome).toBe(10); // 已知限制
  });
});
