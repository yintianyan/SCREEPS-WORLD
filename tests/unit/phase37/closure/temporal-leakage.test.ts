/** Phase 37 Final Closure — Temporal Leakage 反事实测试 */
import { describe, it, expect } from "vitest";
import {
  type OutcomeCollectionInput,
  type OutcomeRecord,
  collectOutcome,
  computeOutcomeConfidence,
} from "../../../../src/domain/intelligence/outcome";
import {
  type ExperienceRecord,
  type ExperienceIdentity,
  type DecisionRef,
  type ExperienceContext,
  type OutcomeClassification,
  createExperience,
  attachOutcome,
  attachAttribution,
  finalizeExperience,
  makeExperienceId,
  buildDecisionRef,
  isDecisionReadyForOutcome,
  MEASUREMENT_DELAYS,
} from "../../../../src/domain/intelligence/experience";
import {
  type AttributionInput,
  collectAttribution,
} from "../../../../src/domain/intelligence/attribution";

// ─── Helpers ──────────────────────────────────────────────

function makeIdentity(tick: number, seq: number, type: "expansion" | "war" = "expansion"): ExperienceIdentity {
  return { experienceId: makeExperienceId(tick, seq), tick, source: "test", type };
}

function makeRef(tick: number, action: string = "EXPANSION_START_W1N1"): DecisionRef {
  return buildDecisionRef({
    decisionId: `D-${tick}-1`,
    tick,
    category: "EXPANSION",
    actor: "expansion-manager",
    selectedAction: action,
    decisionHash: "abcd1234",
    correlationId: `rcv-D-${tick}-1-${tick}`,
  });
}

function makeContext(tick: number): ExperienceContext {
  return {
    scope: "W1N1",
    posture: "develop",
    empireHealthLevel: "healthy",
    empireHealthScore: 0.8,
    cpuTier: "healthy",
    stateBeforeHash: "snap_hash",
    metrics: {},
  };
}

function makeOutcomeInput(overrides?: Partial<OutcomeCollectionInput>): OutcomeCollectionInput {
  return {
    decisionId: "D-100-1",
    decisionTick: 100,
    currentTick: 2100,
    type: "expansion",
    stateBeforeHash: "hash",
    stateAfterHash: "hash_after",
    expansionOutcome: 10,
    expansionDuration: 400,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────

describe("Phase 37 Closure — Temporal Leakage Audit", () => {

  // T1: future outcome 不得进入 past decision
  it("T1: future outcome does not leak into past decision", () => {
    const decisionTick = 100;
    const currentTick = 2100; // After measurement delay

    const input = makeOutcomeInput({
      decisionTick,
      currentTick,
      expansionOutcome: 10,
    });

    const outcome = collectOutcome(input);

    expect(outcome).toBeDefined();
    expect(outcome!.decisionTick).toBe(decisionTick);
    expect(outcome!.measurementTick).toBe(currentTick);
    // The outcome's measurement tick is AFTER the decision tick
    expect(outcome!.measurementTick).toBeGreaterThan(outcome!.decisionTick);
    // The delay is positive (no temporal leakage)
    expect(outcome!.delay).toBe(currentTick - decisionTick);
    expect(outcome!.delay).toBeGreaterThan(0);
  });

  // T2: overlapping expansion — no cross-pollution
  it("T2: overlapping expansions produce independent outcomes", () => {
    // Expansion A: tick 100, Expansion B: tick 150 (overlapping)
    const inputA = makeOutcomeInput({
      decisionId: "D-100-1",
      decisionTick: 100,
      currentTick: 2100,
      expansionOutcome: 10, // success
    });

    const inputB = makeOutcomeInput({
      decisionId: "D-150-1",
      decisionTick: 150,
      currentTick: 2150,
      expansionOutcome: 12, // timeout
    });

    const outcomeA = collectOutcome(inputA);
    const outcomeB = collectOutcome(inputB);

    expect(outcomeA!.decisionId).toBe("D-100-1");
    expect(outcomeB!.decisionId).toBe("D-150-1");
    expect(outcomeA!.classification).toBe("SUCCESS");
    expect(outcomeB!.classification).toBe("EXPIRED");
    // No cross-pollution
    expect(outcomeA!.classification).not.toBe(outcomeB!.classification);
  });

  // T3: same-target repeated expansion — no temporal leakage
  it("T3: repeated same-target expansion — outcomes are independent", () => {
    const input1 = makeOutcomeInput({
      decisionId: "D-100-1",
      decisionTick: 100,
      currentTick: 2100,
      expansionOutcome: 12, // timeout
    });

    const input2 = makeOutcomeInput({
      decisionId: "D-600-1",
      decisionTick: 600,
      currentTick: 2600,
      expansionOutcome: 10, // success
    });

    const outcome1 = collectOutcome(input1);
    const outcome2 = collectOutcome(input2);

    // First expansion failed, second succeeded — no temporal leakage
    expect(outcome1!.classification).toBe("EXPIRED");
    expect(outcome2!.classification).toBe("SUCCESS");
  });

  // T4: delayed outcome — correct UNRESOLVED behavior
  it("T4: when expansionOutcome is undefined, collectOutcome returns undefined", () => {
    const input = makeOutcomeInput({
      expansionOutcome: undefined,
    });

    const outcome = collectOutcome(input);
    expect(outcome).toBeUndefined();
  });

  // T5: timeout outcome — correct classification
  it("T5: timeout (outcomeCode=2) → EXPIRED classification", () => {
    const input = makeOutcomeInput({
      expansionOutcome: 12, // phase=1, outcome=2 (timeout)
    });

    const outcome = collectOutcome(input);
    expect(outcome!.classification).toBe("EXPIRED");
  });

  // T6: aborted outcome — correct classification
  it("T6: aborted (outcomeCode=4) → UNKNOWN classification", () => {
    const input = makeOutcomeInput({
      expansionOutcome: 14, // phase=1, outcome=4 (aborted)
    });

    const outcome = collectOutcome(input);
    expect(outcome!.classification).toBe("UNKNOWN");
  });

  // T7: measurement window boundary — not ready before delay
  it("T7: isDecisionReadyForOutcome is false before measurement delay", () => {
    const decisionTick = 100;
    const delay = MEASUREMENT_DELAYS.expansion; // 2000

    // 1 tick before delay
    expect(isDecisionReadyForOutcome(decisionTick, decisionTick + delay - 1, "expansion")).toBe(false);
  });

  // T8: measurement window boundary — ready at exact delay
  it("T8: isDecisionReadyForOutcome is true at exact measurement delay", () => {
    const decisionTick = 100;
    const delay = MEASUREMENT_DELAYS.expansion; // 2000

    // Exactly at delay
    expect(isDecisionReadyForOutcome(decisionTick, decisionTick + delay, "expansion")).toBe(true);
  });

  // T9: outcome measurementTick never exceeds currentTick
  it("T9: outcome measurementTick equals currentTick, never exceeds it", () => {
    const currentTick = 2100;
    const input = makeOutcomeInput({
      currentTick,
      expansionOutcome: 10,
    });

    const outcome = collectOutcome(input);
    expect(outcome!.measurementTick).toBe(currentTick);
    expect(outcome!.measurementTick).toBeLessThanOrEqual(currentTick);
  });

  // T10: attribution delay is non-negative
  it("T10: outcome delay is always non-negative", () => {
    const testCases = [
      { decisionTick: 100, currentTick: 2100 },
      { decisionTick: 100, currentTick: 100 }, // Same tick (edge case)
      { decisionTick: 100, currentTick: 2101 },
    ];

    for (const tc of testCases) {
      const input = makeOutcomeInput({
        decisionTick: tc.decisionTick,
        currentTick: tc.currentTick,
        expansionOutcome: 10,
      });
      const outcome = collectOutcome(input);
      if (outcome) {
        expect(outcome.delay).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // T11: No future information in outcome record
  it("T11: outcome only contains data from input, no future state", () => {
    const input = makeOutcomeInput({
      decisionTick: 100,
      currentTick: 2100,
      expansionOutcome: 10,
      stateAfterHash: "hash_after_2100",
    });

    const outcome = collectOutcome(input);

    // Verify all fields are derived from input
    expect(outcome!.decisionId).toBe(input.decisionId);
    expect(outcome!.decisionTick).toBe(input.decisionTick);
    expect(outcome!.measurementTick).toBe(input.currentTick);
    expect(outcome!.value).toBe(input.expansionOutcome);
    expect(outcome!.stateAfterHash).toBe(input.stateAfterHash);
  });

  // T12: Experience lifecycle respects temporal ordering
  it("T12: Experience lifecycle — OBSERVED → OPEN → ATTRIBUTED → FINALIZED", () => {
    const exp = createExperience(
      makeIdentity(100, 1),
      makeRef(100),
      makeContext(100),
      1,
    );
    expect(exp.lifecycle).toBe("OBSERVED");

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
    expect(withOutcome.lifecycle).toBe("OPEN");

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

  // T13: Confidence never exceeds 1.0
  it("T13: outcome confidence is bounded [0, 1]", () => {
    const input = makeOutcomeInput({
      expansionOutcome: 10,
    });
    const outcome = collectOutcome(input);
    if (outcome) {
      const confidence = computeOutcomeConfidence(
        outcome.delay,
        MEASUREMENT_DELAYS.expansion * 4,
        outcome.source,
      );
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });
});
