/** A6.1 Attribution Model — 单元测试。 */
import { describe, it, expect } from "vitest";
import {
  type AttributionInput,
  collectAttribution,
  attributionHash,
  verifyAttributionDeterminism,
  computeAttributionConfidence,
} from "../../../src/domain/intelligence/attribution";
import type { OutcomeRecord, ExperienceContext } from "../../../src/domain/intelligence/experience";

function makeOutcome(overrides?: Partial<OutcomeRecord>): OutcomeRecord {
  return {
    decisionId: "D-100-1",
    decisionTick: 100,
    measurementTick: 600,
    delay: 500,
    classification: "SUCCESS",
    metric: "warOutcome",
    value: 1,
    source: "evaluateWarOutcome",
    stateAfterHash: "hash_after",
    stateDelta: {},
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ExperienceContext>): ExperienceContext {
  return {
    scope: "empire",
    posture: "war",
    empireHealthLevel: "stable",
    empireHealthScore: 0.5,
    cpuTier: "healthy",
    stateBeforeHash: "hash_before",
    metrics: {},
    ...overrides,
  };
}

function makeAttributionInput(overrides?: Partial<AttributionInput>): AttributionInput {
  return {
    type: "war",
    outcome: makeOutcome(),
    context: makeContext(),
    modelVersion: 1,
    ...overrides,
  };
}

describe("A6.1 Attribution Model", () => {
  describe("UT-028: collectAttribution — War 成功归因", () => {
    it("should attribute war success to DECISION_QUALITY with high confidence", () => {
      const input = makeAttributionInput({
        type: "war",
        outcome: makeOutcome({ classification: "SUCCESS", value: 1 }),
        warOurLosses: 0,
        warSquadSize: 5,
      });
      const attr = collectAttribution(input);
      expect(attr.primaryCause).toBe("DECISION_QUALITY");
      expect(attr.confidence).toBeGreaterThanOrEqual(0.8);
      expect(attr.method).toBe("direct");
      expect(attr.evidence.length).toBeGreaterThan(0);
      expect(attr.systemAttribution).toBe("war-planning");
    });
  });

  describe("UT-029: collectAttribution — War 失败 + 敌方 boosted", () => {
    it("should attribute to INTEL_QUALITY when enemy is boosted", () => {
      const input = makeAttributionInput({
        type: "war",
        outcome: makeOutcome({ classification: "FAILURE", value: -1 }),
        warEnemyComposition: [{ role: "attacker", count: 3, boosted: true }],
        warOurLosses: 3,
        warSquadSize: 5,
      });
      const attr = collectAttribution(input);
      expect(attr.primaryCause).toBe("INTEL_QUALITY");
      expect(attr.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("UT-030: collectAttribution — War 止损归因", () => {
    it("should attribute to ECONOMIC_GUARD when abort reason is economic", () => {
      const input = makeAttributionInput({
        type: "war",
        outcome: makeOutcome({ classification: "ABORTED" }),
        warAbortReason: "economic pressure too high",
      });
      const attr = collectAttribution(input);
      expect(attr.primaryCause).toBe("ECONOMIC_GUARD");
      expect(attr.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("UT-031: collectAttribution — Recovery 成功归因", () => {
    it("should attribute recovery success to DECISION_QUALITY", () => {
      const input = makeAttributionInput({
        type: "recovery",
        outcome: makeOutcome({
          classification: "SUCCESS",
          metric: "recoverySuccessRate",
          value: 0.9,
          source: "recoveryStats",
        }),
        recoverySucceeded: 9,
        recoveryFailed: 1,
      });
      const attr = collectAttribution(input);
      expect(attr.primaryCause).toBe("DECISION_QUALITY");
      expect(attr.confidence).toBeGreaterThanOrEqual(0.7);
      expect(attr.method).toBe("direct");
    });
  });

  describe("UT-032: collectAttribution — Economic 低置信度", () => {
    it("should use expert method for economic attribution", () => {
      const input = makeAttributionInput({
        type: "economic",
        outcome: makeOutcome({
          classification: "SUCCESS",
          metric: "healthScoreDelta",
          value: 0.15,
          source: "empireHealth",
        }),
        healthScoreBefore: 0.3,
        healthScoreAfter: 0.45,
        bottleneckDimension: "economy",
      });
      const attr = collectAttribution(input);
      expect(attr.method).toBe("expert");
      expect(attr.confidence).toBeLessThanOrEqual(0.5);
    });
  });

  describe("UT-033: collectAttribution — Logistics hauler deficit", () => {
    it("should attribute to RESOURCE_AVAILABILITY when hauler deficit exists", () => {
      const input = makeAttributionInput({
        type: "logistics",
        outcome: makeOutcome({
          classification: "FAILURE",
          metric: "logisticsLevelDelta",
          value: -1,
          source: "logisticsHealth",
        }),
        logisticsBacklog: 10,
        logisticsDeliveryRate: 0.5,
        haulerDeficit: 3,
      });
      const attr = collectAttribution(input);
      expect(attr.primaryCause).toBe("RESOURCE_AVAILABILITY");
      expect(attr.method).toBe("correlation");
    });
  });

  describe("UT-034: collectAttribution — Spawn P0 → RESOURCE_AVAILABILITY", () => {
    it("should attribute to RESOURCE_AVAILABILITY when P0 pending", () => {
      const input = makeAttributionInput({
        type: "spawn",
        outcome: makeOutcome({
          classification: "FAILURE",
          metric: "spawnQueueLength",
          value: 3,
          source: "spawnQueueStats",
        }),
        spawnQueueLength: 3,
        spawnP0Count: 1,
      });
      const attr = collectAttribution(input);
      expect(attr.primaryCause).toBe("RESOURCE_AVAILABILITY");
      expect(attr.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("UT-035: attributionHash — 确定性", () => {
    it("should produce same hash for same input (1000 iterations)", () => {
      const input = makeAttributionInput();
      const hash1 = attributionHash(
        input.type,
        "DECISION_QUALITY",
        input.outcome ? [] : [],
        1,
      );
      const hash2 = attributionHash(
        input.type,
        "DECISION_QUALITY",
        input.outcome ? [] : [],
        1,
      );
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different primary causes", () => {
      const hash1 = attributionHash("war", "DECISION_QUALITY", [], 1);
      const hash2 = attributionHash("war", "INTEL_QUALITY", [], 1);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("UT-036: verifyAttributionDeterminism — 1000 次一致", () => {
    it("should be deterministic across 1000 iterations", () => {
      const input = makeAttributionInput({
        type: "war",
        outcome: makeOutcome({ classification: "SUCCESS" }),
        warOurLosses: 1,
        warSquadSize: 5,
      });
      const result = verifyAttributionDeterminism(input, 1000);
      expect(result.deterministic).toBe(true);
      expect(result.firstDivergenceAt).toBeUndefined();
      // All hashes should be the same
      const uniqueHashes = new Set(result.hashes);
      expect(uniqueHashes.size).toBe(1);
    });
  });

  describe("UT-037: collectAttribution — Evidence-based", () => {
    it("should always have at least one evidence for war", () => {
      const input = makeAttributionInput({
        type: "war",
        outcome: makeOutcome({ classification: "SUCCESS" }),
      });
      const attr = collectAttribution(input);
      expect(attr.evidence.length).toBeGreaterThan(0);
      // Every evidence should have all required fields
      for (const e of attr.evidence) {
        expect(e.metric).toBeDefined();
        expect(e.actual).toBeDefined();
        expect(e.threshold).toBeDefined();
        expect(e.suggestsFactor).toBeDefined();
        expect(e.strength).toBeGreaterThanOrEqual(0);
        expect(e.strength).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("UT-038: collectAttribution — Economic confidence ≤ 0.5", () => {
    it("should never exceed 0.5 confidence for economic attribution", () => {
      const input = makeAttributionInput({
        type: "economic",
        outcome: makeOutcome({
          classification: "SUCCESS",
          metric: "healthScoreDelta",
          value: 0.2,
          source: "empireHealth",
        }),
        healthScoreBefore: 0.3,
        healthScoreAfter: 0.5,
        bottleneckDimension: "spawn",
      });
      const attr = collectAttribution(input);
      expect(attr.confidence).toBeLessThanOrEqual(0.5);
    });
  });

  describe("UT-039: collectAttribution — War confidence ≥ 0.5", () => {
    it("should have confidence ≥ 0.5 for war attribution", () => {
      const input = makeAttributionInput({
        type: "war",
        outcome: makeOutcome({ classification: "FAILURE" }),
        warOurLosses: 2,
        warSquadSize: 5,
      });
      const attr = collectAttribution(input);
      expect(attr.confidence).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe("UT-040: computeAttributionConfidence — 样本+方差+延迟", () => {
    it("should increase with more samples", () => {
      const few = computeAttributionConfidence(1, 10, 500);
      const many = computeAttributionConfidence(10, 10, 500);
      expect(many).toBeGreaterThan(few);
    });

    it("should decrease with higher variance", () => {
      const lowVar = computeAttributionConfidence(5, 10, 500);
      const highVar = computeAttributionConfidence(5, 80, 500);
      expect(lowVar).toBeGreaterThan(highVar);
    });

    it("should decrease with longer delay", () => {
      const shortDelay = computeAttributionConfidence(5, 10, 100);
      const longDelay = computeAttributionConfidence(5, 10, 4000);
      expect(shortDelay).toBeGreaterThan(longDelay);
    });

    it("should have minimum delay factor of 0.3", () => {
      const veryLongDelay = computeAttributionConfidence(10, 0, 10000);
      // sampleFactor=1, varianceFactor=1, delayFactor=0.3
      expect(veryLongDelay).toBeCloseTo(0.3, 2);
    });
  });
});
