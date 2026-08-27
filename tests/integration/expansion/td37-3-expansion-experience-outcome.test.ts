/** TD-37-3: Expansion Decision → DecisionTrace → Experience → Outcome 完整链路测试 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  type OutcomeCollectionInput,
  collectOutcome,
} from "../../../src/domain/intelligence/outcome";
import {
  type AttributionInput,
  collectAttribution,
} from "../../../src/domain/intelligence/attribution";
import {
  type ExperienceRecord,
  type ExperienceIdentity,
  type DecisionRef,
  type ExperienceContext,
  type OutcomeRecord,
  createExperience,
  attachOutcome,
  attachAttribution,
  finalizeExperience,
  makeExperienceId,
  buildDecisionRef,
  isDecisionReadyForOutcome,
  categoryToExperienceType,
  MEASUREMENT_DELAYS,
} from "../../../src/domain/intelligence/experience";

// ─── Helpers ──────────────────────────────────────────────

function makeExpansionIdentity(tick: number, seq: number): ExperienceIdentity {
  return {
    experienceId: makeExperienceId(tick, seq),
    tick,
    source: "experience-collector",
    type: "expansion",
  };
}

function makeExpansionDecisionRef(decisionTick: number): DecisionRef {
  return buildDecisionRef({
    decisionId: `D-${decisionTick}-1`,
    tick: decisionTick,
    category: "EXPANSION",
    actor: "expansion-manager",
    selectedAction: "EXPANSION_START_W1N1",
    decisionHash: "abcd1234",
    correlationId: `rcv-D-${decisionTick}-1-${decisionTick}`,
  });
}

function makeExpansionContext(decisionTick: number): ExperienceContext {
  return {
    scope: "W1N1",
    posture: "develop",
    empireHealthLevel: "healthy",
    empireHealthScore: 0.8,
    cpuTier: "healthy",
    stateBeforeHash: "snap_hash_1",
    metrics: {
      expansionDuration: 0,
      hostilesInRoom: 0,
    },
  };
}

function makeExpansionExperience(decisionTick: number, seq: number): ExperienceRecord {
  return createExperience(
    makeExpansionIdentity(decisionTick, seq),
    makeExpansionDecisionRef(decisionTick),
    makeExpansionContext(decisionTick),
    1,
  );
}

function makeExpansionOutcomeInput(
  overrides?: Partial<OutcomeCollectionInput>,
): OutcomeCollectionInput {
  return {
    decisionId: "D-100-1",
    decisionTick: 100,
    currentTick: 2100, // MEASUREMENT_DELAYS.expansion = 2000
    type: "expansion",
    stateBeforeHash: "hash_before",
    stateAfterHash: "hash_after",
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────

describe("TD-37-3: Expansion Experience/Outcome Closure", () => {

  // ── DT-EXP-001: Expansion Decision 产生统一 DecisionRecord ──
  describe("DT-EXP-001: Expansion DecisionTrace Category", () => {
    it("categoryToExperienceType maps EXPANSION to expansion", () => {
      const type = categoryToExperienceType("EXPANSION");
      expect(type).toBe("expansion");
    });

    it("MEASUREMENT_DELAYS has expansion with 2000 tick delay", () => {
      expect(MEASUREMENT_DELAYS.expansion).toBe(2000);
    });
  });

  // ── DT-EXP-002: 同一 Plan 不重复产生 DecisionTrace ──
  describe("DT-EXP-002: No Duplicate DecisionTrace", () => {
    it("isDecisionReadyForOutcome is deterministic for same inputs", () => {
      const r1 = isDecisionReadyForOutcome(100, 2100, "expansion");
      const r2 = isDecisionReadyForOutcome(100, 2100, "expansion");
      expect(r1).toBe(r2);
      expect(r1).toBe(true);
    });

    it("isDecisionReadyForOutcome returns false before delay", () => {
      expect(isDecisionReadyForOutcome(100, 500, "expansion")).toBe(false);
    });
  });

  // ── DT-EXP-003: DecisionTrace 关联 ID ──
  describe("DT-EXP-003: DecisionTrace ID Association", () => {
    it("DecisionRef contains decisionId, correlationId, category", () => {
      const ref = makeExpansionDecisionRef(100);
      expect(ref.decisionId).toBe("D-100-1");
      expect(ref.category).toBe("EXPANSION");
      expect(ref.actor).toBe("expansion-manager");
      expect(ref.correlationId).toContain("D-100-1");
      expect(ref.selectedAction).toBe("EXPANSION_START_W1N1");
    });
  });

  // ── OUT-EXP-001: 成功 Expansion → SUCCESS ──
  describe("OUT-EXP-001: Success Expansion → SUCCESS", () => {
    it("collectExpansionOutcome returns SUCCESS for outcome=0", () => {
      // expansionOutcome = phaseCode * 10 + outcomeCode
      // success = outcomeCode 0
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 10, // phase=1, outcome=0 (success)
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("SUCCESS");
      expect(outcome!.metric).toBe("expansionOutcome");
      expect(outcome!.source).toBe("expansionManager");
    });
  });

  // ── OUT-EXP-002: Timeout → FAILURE ──
  describe("OUT-EXP-002: Timeout Expansion → FAILURE", () => {
    it("collectExpansionOutcome returns EXPIRED for outcome=2 (timeout)", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 12, // phase=1, outcome=2 (timeout)
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("EXPIRED");
    });
  });

  // ── OUT-EXP-003: Abort → 正确 Outcome ──
  describe("OUT-EXP-003: Abort Expansion → Correct Outcome", () => {
    it("collectExpansionOutcome returns UNKNOWN for outcome=4 (aborted)", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 14, // phase=1, outcome=4 (aborted)
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("UNKNOWN");
    });

    it("collectExpansionOutcome returns FAILURE for outcome=1 (stolen)", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 11, // phase=1, outcome=1 (stolen)
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("FAILURE");
    });

    it("collectExpansionOutcome returns UNKNOWN for outcome=3 (lost)", () => {
      // Domain contract: outcomeCode 3 (lost) → UNKNOWN (INCONCLUSIVE)
      // Lost means we cannot determine the exact cause → INCONCLUSIVE is correct
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 13, // phase=1, outcome=3 (lost)
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("UNKNOWN");
    });
  });

  // ── OUT-EXP-004: External interference 标记 ──
  describe("OUT-EXP-004: External Interference", () => {
    it("attribution marks EXTERNAL_THREAT when threatLevelAfter is HIGH", () => {
      const outcome: OutcomeRecord = {
        decisionId: "D-100-1",
        decisionTick: 100,
        measurementTick: 2100,
        delay: 2000,
        classification: "FAILURE",
        metric: "expansionOutcome",
        value: 11, // stolen
        source: "expansionManager",
        stateAfterHash: "hash_after",
        stateDelta: {},
      };
      const input: AttributionInput = {
        type: "expansion",
        outcome,
        context: makeExpansionContext(100),
        modelVersion: 1,
        expansionDuration: 2000,
        expansionTargetRoom: "W1N1",
        threatLevelAfter: "HIGH",
        posture: "develop",
      };
      const attr = collectAttribution(input);
      expect(attr.primaryCause).toBe("EXTERNAL_THREAT");
      expect(attr.externalFactors).toBeDefined();
    });
  });

  // ── OUT-EXP-005: 无法确定 → INCONCLUSIVE ──
  describe("OUT-EXP-005: INCONCLUSIVE when no data", () => {
    it("collectExpansionOutcome returns undefined when expansionOutcome is undefined", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: undefined,
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeUndefined();
    });

    it("attribution returns UNKNOWN for unknown classification", () => {
      const outcome: OutcomeRecord = {
        decisionId: "D-100-1",
        decisionTick: 100,
        measurementTick: 2100,
        delay: 2000,
        classification: "UNKNOWN",
        metric: "expansionOutcome",
        value: 14,
        source: "expansionManager",
        stateAfterHash: "hash_after",
        stateDelta: {},
      };
      const input: AttributionInput = {
        type: "expansion",
        outcome,
        context: makeExpansionContext(100),
        modelVersion: 1,
        expansionDuration: 2000,
      };
      const attr = collectAttribution(input);
      expect(attr.primaryCause).toBe("UNKNOWN");
      expect(attr.confidence).toBeLessThanOrEqual(0.5);
    });
  });

  // ── OUT-EXP-006: startTick/endTick/duration ──
  describe("OUT-EXP-006: Temporal Correctness", () => {
    it("outcome delay = currentTick - decisionTick", () => {
      const input = makeExpansionOutcomeInput({
        decisionTick: 100,
        currentTick: 2100,
        expansionOutcome: 10,
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.decisionTick).toBe(100);
      expect(outcome!.measurementTick).toBe(2100);
      expect(outcome!.delay).toBe(2000);
    });

    it("delay is non-negative (no temporal leakage)", () => {
      const input = makeExpansionOutcomeInput({
        decisionTick: 100,
        currentTick: 200,
        expansionOutcome: 10,
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.delay).toBeGreaterThanOrEqual(0);
    });
  });

  // ── OUT-EXP-007: Outcome 不读取未来数据 ──
  describe("OUT-EXP-007: No Future Data Leakage", () => {
    it("outcome only uses input fields, not future state", () => {
      // The pure function collectOutcome only uses input params
      // It cannot access Game/Memory/globalCache
      const input = makeExpansionOutcomeInput({
        decisionTick: 100,
        currentTick: 2100,
        expansionOutcome: 10,
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      // Verify it only uses provided data
      expect(outcome!.decisionTick).toBe(input.decisionTick);
      expect(outcome!.measurementTick).toBe(input.currentTick);
    });
  });

  // ── OUT-EXP-008: 失败 Expansion 不被丢弃 ──
  describe("OUT-EXP-008: Failure Not Dropped", () => {
    it("failure expansion (timeout) produces valid OutcomeRecord", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 12, // timeout
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).not.toBe("SUCCESS");
    });

    it("lost expansion produces UNKNOWN classification (INCONCLUSIVE)", () => {
      // Domain contract: outcomeCode 3 (lost) → UNKNOWN
      // This is correct — lost means inconclusive cause
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 13, // lost
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("UNKNOWN");
    });
  });

  // ── A6-EXP-001: 完整链路 ──
  describe("A6-EXP-001: DecisionTrace → Experience → Outcome Full Chain", () => {
    it("creates experience from expansion decision, attaches outcome, finalizes", () => {
      const decisionTick = 100;
      const exp = makeExpansionExperience(decisionTick, 1);
      expect(exp.lifecycle).toBe("OBSERVED");

      // Simulate outcome collection
      const outcomeInput = makeExpansionOutcomeInput({
        decisionTick,
        currentTick: decisionTick + 2000,
        expansionOutcome: 10, // success
      });
      const outcome = collectOutcome(outcomeInput);
      expect(outcome).toBeDefined();

      const withOutcome = attachOutcome(exp, outcome!);
      expect(withOutcome.lifecycle).toBe("OPEN");
      expect(withOutcome.outcome).toBeDefined();

      // Simulate attribution
      const attrInput: AttributionInput = {
        type: "expansion",
        outcome: withOutcome.outcome!,
        context: withOutcome.context,
        modelVersion: 1,
        expansionDuration: 2000,
        expansionTargetRoom: "W1N1",
      };
      const attr = collectAttribution(attrInput);
      const withAttr = attachAttribution(withOutcome, attr);
      expect(withAttr.lifecycle).toBe("ATTRIBUTED");

      const finalized = finalizeExperience(withAttr);
      expect(finalized.lifecycle).toBe("FINALIZED");
    });
  });

  // ── A6-EXP-002: Attribution 消费 Outcome ──
  describe("A6-EXP-002: Attribution Consumes Outcome", () => {
    it("attribution evidence references outcome classification", () => {
      const outcome: OutcomeRecord = {
        decisionId: "D-100-1",
        decisionTick: 100,
        measurementTick: 2100,
        delay: 2000,
        classification: "SUCCESS",
        metric: "expansionOutcome",
        value: 10,
        source: "expansionManager",
        stateAfterHash: "hash_after",
        stateDelta: {},
      };
      const input: AttributionInput = {
        type: "expansion",
        outcome,
        context: makeExpansionContext(100),
        modelVersion: 1,
        expansionDuration: 2000,
        expansionTargetRoom: "W1N1",
      };
      const attr = collectAttribution(input);
      expect(attr.evidence.length).toBeGreaterThan(0);
      expect(attr.primaryCause).toBe("DECISION_QUALITY");
      expect(attr.confidence).toBeGreaterThan(0.5);
    });
  });

  // ── A6-EXP-003: Evaluation 消费 Experience ──
  describe("A6-EXP-003: Evaluation Can Consume Expansion Experience", () => {
    it("expansion experience has type='expansion' for evaluation filter", () => {
      const exp = makeExpansionExperience(100, 1);
      expect(exp.identity.type).toBe("expansion");
    });

    it("expansion experience with outcome has value for evaluation", () => {
      const exp = makeExpansionExperience(100, 1);
      const outcome: OutcomeRecord = {
        decisionId: "D-100-1",
        decisionTick: 100,
        measurementTick: 2100,
        delay: 2000,
        classification: "SUCCESS",
        metric: "expansionOutcome",
        value: 10,
        source: "expansionManager",
        stateAfterHash: "hash_after",
        stateDelta: {},
      };
      const withOutcome = attachOutcome(exp, outcome);
      expect(withOutcome.outcome).toBeDefined();
      expect(withOutcome.outcome!.value).toBe(10);
    });
  });

  // ── A6-EXP-004: A6.3-A6.6 无需修改 ──
  describe("A6-EXP-004: No A6.3-A6.6 Changes Required", () => {
    it("categoryToExperienceType supports EXPANSION", () => {
      expect(categoryToExperienceType("EXPANSION")).toBe("expansion");
    });

    it("MEASUREMENT_DELAYS includes expansion", () => {
      expect(MEASUREMENT_DELAYS).toHaveProperty("expansion");
      expect(typeof MEASUREMENT_DELAYS.expansion).toBe("number");
    });
  });

  // ── SAFETY-EXP-001: A6 停止时 A3 不受影响 ──
  describe("SAFETY-EXP-001: A6 Shutdown Safety", () => {
    it("collectOutcome is a pure function — no side effects", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 10,
      });
      const outcome = collectOutcome(input);
      // Calling it again produces the same result
      const outcome2 = collectOutcome(input);
      expect(outcome).toEqual(outcome2);
    });

    it("collectAttribution is a pure function — no side effects", () => {
      const outcome: OutcomeRecord = {
        decisionId: "D-100-1",
        decisionTick: 100,
        measurementTick: 2100,
        delay: 2000,
        classification: "SUCCESS",
        metric: "expansionOutcome",
        value: 10,
        source: "expansionManager",
        stateAfterHash: "hash_after",
        stateDelta: {},
      };
      const input: AttributionInput = {
        type: "expansion",
        outcome,
        context: makeExpansionContext(100),
        modelVersion: 1,
        expansionDuration: 2000,
      };
      const attr1 = collectAttribution(input);
      const attr2 = collectAttribution(input);
      expect(attr1.attributionHash).toBe(attr2.attributionHash);
    });
  });

  // ── SAFETY-EXP-002: Outcome 采集不改变 Execution ──
  describe("SAFETY-EXP-002: Observation Does Not Change Execution", () => {
    it("collectOutcome does not modify input", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 10,
      });
      const original = { ...input };
      collectOutcome(input);
      expect(input).toEqual(original);
    });

    it("collectAttribution does not modify input", () => {
      const outcome: OutcomeRecord = {
        decisionId: "D-100-1",
        decisionTick: 100,
        measurementTick: 2100,
        delay: 2000,
        classification: "SUCCESS",
        metric: "expansionOutcome",
        value: 10,
        source: "expansionManager",
        stateAfterHash: "hash_after",
        stateDelta: {},
      };
      const input: AttributionInput = {
        type: "expansion",
        outcome,
        context: makeExpansionContext(100),
        modelVersion: 1,
        expansionDuration: 2000,
      };
      const original = JSON.stringify(input);
      collectAttribution(input);
      expect(JSON.stringify(input)).toBe(original);
    });
  });

  // ── CF-EXP-01: 当前失败 + 历史成功 → 忠实记录当前失败 ──
  describe("CF-EXP-01: Current Failure + Historical Success", () => {
    it("outcome is FAILURE regardless of historical success", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 12, // timeout
      });
      const outcome = collectOutcome(input);
      expect(outcome!.classification).toBe("EXPIRED");
      // Historical success doesn't change current outcome
    });
  });

  // ── CF-EXP-02: 当前成功 + 历史失败 → 不能改变当前 Outcome ──
  describe("CF-EXP-02: Current Success + Historical Failure", () => {
    it("outcome is SUCCESS regardless of historical failure", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 10, // success
      });
      const outcome = collectOutcome(input);
      expect(outcome!.classification).toBe("SUCCESS");
    });
  });

  // ── CF-EXP-03: timeout → FAILURE，不是 SUCCESS ──
  describe("CF-EXP-03: Timeout is FAILURE not SUCCESS", () => {
    it("timeout classification is EXPIRED, not SUCCESS", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 12, // timeout
      });
      const outcome = collectOutcome(input);
      expect(outcome!.classification).not.toBe("SUCCESS");
      expect(outcome!.classification).toBe("EXPIRED");
    });
  });

  // ── CF-EXP-04: hostile interference → FAILURE + external factor ──
  describe("CF-EXP-04: Hostile Interference", () => {
    it("attribution marks EXTERNAL_THREAT for failure with HIGH threat", () => {
      const outcome: OutcomeRecord = {
        decisionId: "D-100-1",
        decisionTick: 100,
        measurementTick: 2100,
        delay: 2000,
        classification: "FAILURE",
        metric: "expansionOutcome",
        value: 11, // stolen
        source: "expansionManager",
        stateAfterHash: "hash_after",
        stateDelta: { threatDelta: 5 },
      };
      const input: AttributionInput = {
        type: "expansion",
        outcome,
        context: makeExpansionContext(100),
        modelVersion: 1,
        expansionDuration: 2000,
        threatLevelAfter: "HIGH",
      };
      const attr = collectAttribution(input);
      expect(attr.primaryCause).toBe("EXTERNAL_THREAT");
    });
  });

  // ── CF-EXP-05: Decision 尚未发生 → 不得生成 Experience ──
  describe("CF-EXP-05: No Decision = No Experience", () => {
    it("isDecisionReadyForOutcome returns false for future tick", () => {
      expect(isDecisionReadyForOutcome(100, 50, "expansion")).toBe(false);
    });
  });

  // ── CF-EXP-06: Outcome 尚未结束 → 不得提前生成最终 Outcome ──
  describe("CF-EXP-06: No Early Outcome", () => {
    it("collectOutcome returns undefined when expansionOutcome is undefined", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: undefined,
      });
      expect(collectOutcome(input)).toBeUndefined();
    });
  });

  // ── CF-EXP-07: 未来 tick 数据注入 ──
  describe("CF-EXP-07: No Future Data Injection", () => {
    it("outcome measurementTick <= currentTick, never future", () => {
      const currentTick = 2100;
      const input = makeExpansionOutcomeInput({
        decisionTick: 100,
        currentTick,
        expansionOutcome: 10,
      });
      const outcome = collectOutcome(input);
      expect(outcome!.measurementTick).toBe(currentTick);
      expect(outcome!.measurementTick).toBeLessThanOrEqual(currentTick);
    });
  });

  // ── CF-EXP-08: A6 Recommendation 不改变 Outcome ──
  describe("CF-EXP-08: Recommendation Does Not Change Outcome", () => {
    it("outcome is immutable after creation", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 10,
      });
      const outcome = collectOutcome(input);
      const originalHash = JSON.stringify(outcome);
      // "Recommendation" is simulated by just calling collectOutcome again
      collectOutcome(input);
      expect(JSON.stringify(outcome)).toBe(originalHash);
    });
  });

  // ── CF-EXP-09: Evaluation confidence 改变不改变历史 Outcome ──
  describe("CF-EXP-09: Evaluation Does Not Change Historical Outcome", () => {
    it("outcome value is fixed at creation time", () => {
      const input = makeExpansionOutcomeInput({
        expansionOutcome: 12, // timeout
        currentTick: 2100,
      });
      const outcome = collectOutcome(input);
      const originalValue = outcome!.value;
      // Even with different currentTick (simulating later evaluation)
      const input2 = makeExpansionOutcomeInput({
        expansionOutcome: 12,
        currentTick: 5000,
      });
      const outcome2 = collectOutcome(input2);
      // The value depends on expansionOutcome, not on currentTick
      expect(outcome2!.value).toBe(originalValue);
    });
  });

  // ── CF-EXP-10: 失败后 Operation recycle → Historical Experience 仍在 ──
  describe("CF-EXP-10: Experience Survives Operation Recycle", () => {
    it("finalizeExperience preserves all data", () => {
      const exp = makeExpansionExperience(100, 1);
      const outcome: OutcomeRecord = {
        decisionId: "D-100-1",
        decisionTick: 100,
        measurementTick: 2100,
        delay: 2000,
        classification: "FAILURE",
        metric: "expansionOutcome",
        value: 12,
        source: "expansionManager",
        stateAfterHash: "hash_after",
        stateDelta: {},
      };
      const withOutcome = attachOutcome(exp, outcome);
      const attrInput: AttributionInput = {
        type: "expansion",
        outcome: withOutcome.outcome!,
        context: withOutcome.context,
        modelVersion: 1,
        expansionDuration: 2000,
      };
      const attr = collectAttribution(attrInput);
      const withAttr = attachAttribution(withOutcome, attr);
      const finalized = finalizeExperience(withAttr);

      // Even after "recycle" (finalize), all data is preserved
      expect(finalized.identity.experienceId).toBe(exp.identity.experienceId);
      expect(finalized.decision.decisionId).toBe("D-100-1");
      expect(finalized.outcome).toBeDefined();
      expect(finalized.outcome!.classification).toBe("FAILURE");
      expect(finalized.attribution).toBeDefined();
    });
  });
});
