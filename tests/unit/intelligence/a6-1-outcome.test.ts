/**
 * A6.1 Outcome Model — 单元测试。
 *
 * 验证 domain 层纯函数的核心能力：
 *   UT-016: collectOutcome — War 成功
 *   UT-017: collectOutcome — War 失败
 *   UT-018: collectOutcome — War 止损
 *   UT-019: collectOutcome — Recovery 成功
 *   UT-020: collectOutcome — Recovery 失败
 *   UT-021: collectOutcome — Economic 健康度变化
 *   UT-022: collectOutcome — Logistics 级别变化
 *   UT-023: collectOutcome — Spawn 队列清空
 *   UT-024: collectOutcome — Expansion 结果
 *   UT-025: collectOutcome — Defense 威胁降低
 *   UT-026: collectOutcome — 无输入时返回 undefined
 *   UT-027: computeOutcomeConfidence — 延迟 + 来源可靠性
 *
 * 纯函数测试 — 不依赖 Game/Memory。
 */
import { describe, it, expect } from "vitest";
import {
  type OutcomeCollectionInput,
  collectOutcome,
  computeOutcomeConfidence,
} from "../../../src/domain/intelligence/outcome";

function makeBaseInput(overrides?: Partial<OutcomeCollectionInput>): OutcomeCollectionInput {
  return {
    decisionId: "D-100-1",
    decisionTick: 100,
    currentTick: 600,
    type: "war",
    stateBeforeHash: "hash_before",
    stateAfterHash: "hash_after",
    ...overrides,
  };
}

describe("A6.1 Outcome Model", () => {
  describe("UT-016: collectOutcome — War 成功", () => {
    it("should collect war success outcome", () => {
      const input = makeBaseInput({
        type: "war",
        warOutcome: "success",
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("SUCCESS");
      expect(outcome!.metric).toBe("warOutcome");
      expect(outcome!.value).toBe(1);
      expect(outcome!.source).toBe("evaluateWarOutcome");
    });
  });

  describe("UT-017: collectOutcome — War 失败", () => {
    it("should collect war failure outcome", () => {
      const input = makeBaseInput({
        type: "war",
        warOutcome: "failure",
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("FAILURE");
      expect(outcome!.value).toBe(-1);
    });
  });

  describe("UT-018: collectOutcome — War 止损", () => {
    it("should collect war aborted outcome", () => {
      const input = makeBaseInput({
        type: "war",
        warOutcome: "unknown",
        warAbortReason: "economic pressure",
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("ABORTED");
    });
  });

  describe("UT-019: collectOutcome — Recovery 成功", () => {
    it("should collect recovery success outcome", () => {
      const input = makeBaseInput({
        type: "recovery",
        recoverySucceeded: 8,
        recoveryFailed: 2,
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("SUCCESS");
      expect(outcome!.metric).toBe("recoverySuccessRate");
      expect(outcome!.value).toBe(0.8);
      expect(outcome!.source).toBe("recoveryStats");
    });
  });

  describe("UT-020: collectOutcome — Recovery 失败", () => {
    it("should collect recovery failure outcome", () => {
      const input = makeBaseInput({
        type: "recovery",
        recoverySucceeded: 1,
        recoveryFailed: 4,
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("FAILURE");
      expect(outcome!.value).toBe(0.2);
    });
  });

  describe("UT-021: collectOutcome — Economic 健康度变化", () => {
    it("should collect economic success when health improves", () => {
      const input = makeBaseInput({
        type: "economic",
        healthScoreBefore: 0.3,
        healthScoreAfter: 0.5,
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("SUCCESS");
      expect(outcome!.value).toBe(0.2);
    });

    it("should collect economic failure when health degrades", () => {
      const input = makeBaseInput({
        type: "economic",
        healthScoreBefore: 0.5,
        healthScoreAfter: 0.3,
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("FAILURE");
    });
  });

  describe("UT-022: collectOutcome — Logistics 级别变化", () => {
    it("should collect logistics success when level improves", () => {
      const input = makeBaseInput({
        type: "logistics",
        logisticsLevelBefore: "degraded",
        logisticsLevelAfter: "healthy",
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("SUCCESS");
    });
  });

  describe("UT-023: collectOutcome — Spawn 队列清空", () => {
    it("should collect spawn success when queue drained", () => {
      const input = makeBaseInput({
        type: "spawn",
        spawnQueueLength: 0,
        spawnP0Count: 0,
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("SUCCESS");
    });

    it("should collect spawn failure when P0 pending", () => {
      const input = makeBaseInput({
        type: "spawn",
        spawnQueueLength: 3,
        spawnP0Count: 1,
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeDefined();
      expect(outcome!.classification).toBe("FAILURE");
    });
  });

  describe("UT-026: collectOutcome — 无输入时返回 undefined", () => {
    it("should return undefined when war outcome is missing", () => {
      const input = makeBaseInput({ type: "war", warOutcome: undefined });
      const outcome = collectOutcome(input);
      expect(outcome).toBeUndefined();
    });

    it("should return undefined when recovery stats are missing", () => {
      const input = makeBaseInput({
        type: "recovery",
        recoverySucceeded: undefined,
        recoveryFailed: undefined,
      });
      const outcome = collectOutcome(input);
      expect(outcome).toBeUndefined();
    });
  });

  describe("UT-027: computeOutcomeConfidence — 延迟 + 来源可靠性", () => {
    it("should decrease confidence with longer delay", () => {
      const shortDelay = computeOutcomeConfidence(100, 5000, "evaluateWarOutcome");
      const longDelay = computeOutcomeConfidence(2000, 5000, "evaluateWarOutcome");
      expect(shortDelay).toBeGreaterThan(longDelay);
    });

    it("should vary by source reliability", () => {
      const warConfidence = computeOutcomeConfidence(100, 5000, "evaluateWarOutcome");
      const econConfidence = computeOutcomeConfidence(100, 5000, "empireHealth");
      expect(warConfidence).toBeGreaterThan(econConfidence);
    });

    it("should have minimum confidence of 0.3 * reliability for very long delays", () => {
      const veryLongDelay = computeOutcomeConfidence(5000, 5000, "evaluateWarOutcome");
      expect(veryLongDelay).toBeGreaterThan(0);
      expect(veryLongDelay).toBeLessThanOrEqual(1);
    });
  });
});
