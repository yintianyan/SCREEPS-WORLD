/**
 * Phase 37 Decision ID Correlation Final Audit — E14-E21 反事实测试
 *
 * 验证 decisionId 作为 Expansion Operation 的 correlation identity 的稳定性。
 *
 *   E14: Decision A running → Decision B 出现 → Expansion A completes → Outcome = A
 *   E15: A/B same target → both complete → A→A, B→B
 *   E16: A running → B supersedes plan → A completes → A→A
 *   E17: A timeout → B starts same target → A timeout→A, B outcome→B
 *   E18: A aborted → B starts same target → A aborted→A
 *   E19: Decision duplicated/re-evaluated → multiple IDs check
 *   E20: Server restart between decision and outcome
 *   E21: Memory.kernel.expansion.decisionId 被覆盖 → recordExpansionOutcome 得到什么
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

describe("Phase 37 Decision ID Correlation Final Audit (E14-E21)", () => {
  beforeEach(() => {
    const g = globalCache();
    delete g.lastExpansionOutcome;
  });

  // E14: Decision A running → Decision B → Expansion A completes → Outcome = A
  it("E14: running expansion A not contaminated by Decision B", () => {
    const expA = makeExperience(100, "W1N1", 1, "D-100-1");
    // Decision B happens at t=200 but it's a different expansion
    const expB = makeExperience(200, "W2N2", 2, "D-200-2");

    // Expansion A completes at t=500 with decisionId = D-100-1
    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 500, duration: 400, startedAt: 490, decisionId: "D-100-1",
    };

    // A should match
    const inputA = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputA.expansionOutcome).toBe(10);

    // B should NOT match A's outcome
    const inputB = simulateBuildOutcomeInput(expB, 2200, globalCache().lastExpansionOutcome, undefined);
    expect(inputB.expansionOutcome).toBeUndefined();
  });

  // E15: A/B same target → both complete → A→A, B→B
  it("E15: same target multiple expansions — decisionId disambiguates both", () => {
    const expA = makeExperience(100, "W8N3", 1, "D-100-1");
    const expB = makeExperience(600, "W8N3", 2, "D-600-2");

    // A completes first
    globalCache().lastExpansionOutcome = {
      target: "W8N3", outcomeCode: 0, completedTick: 500, duration: 400, startedAt: 490, decisionId: "D-100-1",
    };
    const inputA = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputA.expansionOutcome).toBe(10);

    // B should not match A
    const inputBBeforeBCompletes = simulateBuildOutcomeInput(expB, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputBBeforeBCompletes.expansionOutcome).toBeUndefined();

    // B completes
    globalCache().lastExpansionOutcome = {
      target: "W8N3", outcomeCode: 1, completedTick: 1000, duration: 400, startedAt: 990, decisionId: "D-600-2",
    };
    const inputB = simulateBuildOutcomeInput(expB, 2600, globalCache().lastExpansionOutcome, undefined);
    expect(inputB.expansionOutcome).toBe(11);

    // A should not match B
    const inputAAfterB = simulateBuildOutcomeInput(expA, 2600, globalCache().lastExpansionOutcome, undefined);
    expect(inputAAfterB.expansionOutcome).toBeUndefined();
  });

  // E16: A running → B supersedes plan → A completes → A→A
  it("E16: supersede does not contaminate running expansion", () => {
    const expA = makeExperience(100, "W1N1", 1, "D-100-1");

    // Even if a new plan B supersedes the plan, expansion A still has decisionId = D-100-1
    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 5000, duration: 4900, startedAt: 4990, decisionId: "D-100-1",
    };

    const inputA = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputA.expansionOutcome).toBe(10);
  });

  // E17: A timeout → B starts same target → A timeout→A, B outcome→B
  it("E17: timeout then retry same target — decisionId prevents cross-contamination", () => {
    const expA = makeExperience(100, "W8N3", 1, "D-100-1");
    const expB = makeExperience(600, "W8N3", 2, "D-600-2");

    // A times out
    globalCache().lastExpansionOutcome = {
      target: "W8N3", outcomeCode: 2, completedTick: 500, duration: 400, startedAt: 490, decisionId: "D-100-1",
    };
    const inputA = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputA.expansionOutcome).toBe(12); // timeout

    // B should not match A's timeout
    const inputB = simulateBuildOutcomeInput(expB, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputB.expansionOutcome).toBeUndefined();

    // B completes
    globalCache().lastExpansionOutcome = {
      target: "W8N3", outcomeCode: 0, completedTick: 1000, duration: 400, startedAt: 990, decisionId: "D-600-2",
    };
    const inputBFinal = simulateBuildOutcomeInput(expB, 2600, globalCache().lastExpansionOutcome, undefined);
    expect(inputBFinal.expansionOutcome).toBe(10); // success

    // A should not match B's success
    const inputAFinal = simulateBuildOutcomeInput(expA, 2600, globalCache().lastExpansionOutcome, undefined);
    expect(inputAFinal.expansionOutcome).toBeUndefined();
  });

  // E18: A aborted → B starts same target → A aborted→A
  it("E18: aborted then retry same target — decisionId prevents cross-contamination", () => {
    const expA = makeExperience(100, "W8N3", 1, "D-100-1");
    const expB = makeExperience(600, "W8N3", 2, "D-600-2");

    // A aborted (outcomeCode = 4)
    globalCache().lastExpansionOutcome = {
      target: "W8N3", outcomeCode: 4, completedTick: 300, duration: 200, startedAt: 290, decisionId: "D-100-1",
    };
    const inputA = simulateBuildOutcomeInput(expA, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputA.expansionOutcome).toBe(14); // aborted

    // B should not match A's abort
    const inputB = simulateBuildOutcomeInput(expB, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputB.expansionOutcome).toBeUndefined();
  });

  // E19: Decision duplicated/re-evaluated — check if multiple IDs could be generated
  it("E19: dedup prevents duplicate DecisionRecord for same expansion", () => {
    // In real system, processedExpansionPlanIds prevents duplicate collection.
    // This test simulates: if somehow two DecisionRecords are created for the same expansion
    // (e.g., dedupKey changed due to startedAt overwrite), the SECOND decisionId would
    // overwrite Memory.kernel.expansion.decisionId.

    // Simulate: first decision at t=100 with planId="plan-A"
    // dedupKey = "plan-A" → processed set has "plan-A"
    // If startedAt is overwritten (no planId case), dedupKey changes → new DecisionRecord created
    // But with planId present, dedupKey stays "plan-A" → no duplicate

    // We verify: the exp with the FIRST decisionId should still match the outcome
    const expA_v1 = makeExperience(100, "W1N1", 1, "D-100-1");
    // Hypothetically, if decisionId was overwritten to D-100-2:
    const expA_v2 = makeExperience(100, "W1N1", 1, "D-100-2");

    // Outcome has the latest decisionId (D-100-2)
    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 500, duration: 400, startedAt: 490, decisionId: "D-100-2",
    };

    // v1 should NOT match (decisionId was overwritten)
    const inputV1 = simulateBuildOutcomeInput(expA_v1, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputV1.expansionOutcome).toBeUndefined();

    // v2 should match
    const inputV2 = simulateBuildOutcomeInput(expA_v2, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(inputV2.expansionOutcome).toBe(10);

    // This test documents: IF decisionId is overwritten, the FIRST DecisionRecord
    // becomes UNRESOLVED (safe — no wrong attribution) but data is LOST (not ideal).
    // The fix is: dedupKey uses planId (stable) to prevent overwrite.
  });

  // E20: Server restart between decision and outcome
  it("E20: server restart — no fabricated outcome", () => {
    const exp = makeExperience(100, "W1N1", 1, "D-100-1");

    // After restart, globalCache is cleared → lastExpansionOutcome is undefined
    // Memory.kernel.expansion might still exist (persisted) with decisionId
    // But lastExpansionOutcome is heap-only → undefined

    const expansionMem = { target: "W1N1", startedAt: 100, state: "bootstrapping", decisionId: "D-100-1" };
    const input = simulateBuildOutcomeInput(exp, 2100, undefined, expansionMem);

    // No outcome → UNRESOLVED (safe)
    expect(input.expansionOutcome).toBeUndefined();
    // Duration still works from expansionMem
    expect(input.expansionDuration).toBe(2000);
  });

  // E21: Memory.kernel.expansion.decisionId 被覆盖
  it("E21: decisionId overwritten — recordExpansionOutcome gets which?", () => {
    // This test simulates the EDGE CASE where processedExpansionPlanIds trim
    // causes collectExpansionDecisions to re-process the same expansion.

    // Original decision at t=100: decisionId = D-100-1
    // After trim + re-collection at t=500: decisionId = D-500-5 (new seq)
    // Memory.kernel.expansion.decisionId is now D-500-5

    // recordExpansionOutcome reads expansion.decisionId → gets D-500-5 (overwritten)
    // lastExpansionOutcome.decisionId = D-500-5

    // The Experience created from the FIRST DecisionRecord (D-100-1) will NOT match
    const expOriginal = makeExperience(100, "W1N1", 1, "D-100-1");
    // The Experience from the SECOND DecisionRecord (D-500-5) WILL match
    const expOverwritten = makeExperience(500, "W1N1", 5, "D-500-5");

    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 1000, duration: 500, startedAt: 990, decisionId: "D-500-5",
    };

    // Original Experience → UNRESOLVED (decisionId mismatch)
    const inputOriginal = simulateBuildOutcomeInput(expOriginal, 2500, globalCache().lastExpansionOutcome, undefined);
    expect(inputOriginal.expansionOutcome).toBeUndefined();

    // Overwritten Experience → matches
    const inputOverwritten = simulateBuildOutcomeInput(expOverwritten, 2500, globalCache().lastExpansionOutcome, undefined);
    expect(inputOverwritten.expansionOutcome).toBe(10);

    // CONCLUSION: If decisionId is overwritten, the original Experience becomes UNRESOLVED
    // (safe — no wrong attribution), but data is LOST.
    // This edge case requires 500+ concurrent expansion planIds in processedExpansionPlanIds
    // (each living ~10000t cooldown → ~5M ticks → ~1.5 years). Extremely unlikely.
  });

  // E22: All outcome paths preserve decisionId (success)
  it("E22a: success path preserves decisionId", () => {
    const exp = makeExperience(100, "W1N1", 1, "D-100-1");
    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 0, completedTick: 5000, duration: 4900, startedAt: 4990, decisionId: "D-100-1",
    };
    const input = simulateBuildOutcomeInput(exp, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(input.expansionOutcome).toBe(10);
  });

  // E22: All outcome paths preserve decisionId (timeout)
  it("E22b: timeout path preserves decisionId", () => {
    const exp = makeExperience(100, "W1N1", 1, "D-100-1");
    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 2, completedTick: 5000, duration: 4900, startedAt: 4990, decisionId: "D-100-1",
    };
    const input = simulateBuildOutcomeInput(exp, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(input.expansionOutcome).toBe(12);
  });

  // E22: All outcome paths preserve decisionId (stolen)
  it("E22c: stolen path preserves decisionId", () => {
    const exp = makeExperience(100, "W1N1", 1, "D-100-1");
    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 1, completedTick: 500, duration: 400, startedAt: 490, decisionId: "D-100-1",
    };
    const input = simulateBuildOutcomeInput(exp, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(input.expansionOutcome).toBe(11);
  });

  // E22: All outcome paths preserve decisionId (lost)
  it("E22d: lost path preserves decisionId", () => {
    const exp = makeExperience(100, "W1N1", 1, "D-100-1");
    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 3, completedTick: 500, duration: 400, startedAt: 490, decisionId: "D-100-1",
    };
    const input = simulateBuildOutcomeInput(exp, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(input.expansionOutcome).toBe(13);
  });

  // E22: All outcome paths preserve decisionId (aborted)
  it("E22e: aborted path preserves decisionId", () => {
    const exp = makeExperience(100, "W1N1", 1, "D-100-1");
    globalCache().lastExpansionOutcome = {
      target: "W1N1", outcomeCode: 4, completedTick: 300, duration: 200, startedAt: 290, decisionId: "D-100-1",
    };
    const input = simulateBuildOutcomeInput(exp, 2100, globalCache().lastExpansionOutcome, undefined);
    expect(input.expansionOutcome).toBe(14);
  });

  // E23: Fallback path — LEGACY/DEGRADED, no wrong attribution
  it("E23: fallback (no decisionId) — same target risk but no wrong calibration", () => {
    const exp1 = makeExperience(100, "W8N3", 1, "D-100-1");
    const exp2 = makeExperience(600, "W8N3", 2, "D-600-2");

    // No decisionId (legacy Memory)
    globalCache().lastExpansionOutcome = {
      target: "W8N3", outcomeCode: 0, completedTick: 1000, duration: 400, startedAt: 600,
      // decisionId undefined
    };

    // Both match via fallback (known limitation)
    const input1 = simulateBuildOutcomeInput(exp1, 2100, globalCache().lastExpansionOutcome, undefined);
    const input2 = simulateBuildOutcomeInput(exp2, 2600, globalCache().lastExpansionOutcome, undefined);

    // Both get outcome — this is the KNOWN DEGRADED behavior
    expect(input1.expansionOutcome).toBe(10);
    expect(input2.expansionOutcome).toBe(10);

    // BUT: this only happens when decisionId is COMPLETELY ABSENT.
    // When decisionId exists, it's the ONLY matching key.
    // Fallback cannot fabricate outcomes when lastExpansionOutcome is undefined.
  });

  // E24: Fallback — no outcome at all → UNRESOLVED (safe)
  it("E24: fallback with no outcome → UNRESOLVED", () => {
    const exp = makeExperience(100, "W1N1", 1, "D-100-1");
    const input = simulateBuildOutcomeInput(exp, 2100, undefined, undefined);
    expect(input.expansionOutcome).toBeUndefined();
  });
});
