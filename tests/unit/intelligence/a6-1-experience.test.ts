/**
 * A6.1 Experience Model — 单元测试。
 *
 * 验证 domain 层纯函数的核心能力：
 *   UT-001: ExperienceRingBuffer — push + getRecent
 *   UT-002: ExperienceRingBuffer — 环形覆盖
 *   UT-003: getPendingOutcomes — 筛选未采集 Outcome
 *   UT-004: getUnattributed — 筛选未归因
 *   UT-005: createExperience — 初始 lifecycle = OBSERVED
 *   UT-006: attachOutcome — lifecycle: OBSERVED → OPEN
 *   UT-007: attachAttribution — lifecycle: OPEN → ATTRIBUTED
 *   UT-008: finalizeExperience — lifecycle: ATTRIBUTED → FINALIZED
 *   UT-009: expireExperience — 标记为 EXPIRED
 *   UT-010: isDecisionReadyForOutcome — 到期判定
 *   UT-011: categoryToExperienceType — DecisionCategory 映射
 *   UT-012: gcExperienceBuffer — GC 清理
 *   UT-013: experienceStats — 统计正确
 *   UT-014: makeExperienceId — 格式正确
 *   UT-015: buildDecisionRef — 引用不复制
 *
 * 纯函数测试 — 不依赖 Game/Memory。
 */
import { describe, it, expect } from "vitest";
import {
  type ExperienceRingBuffer,
  type ExperienceRecord,
  type DecisionRef,
  type ExperienceContext,
  type ExperienceIdentity,
  createExperienceRingBuffer,
  pushExperience,
  getRecentExperiences,
  getPendingOutcomes,
  getUnattributed,
  createExperience,
  attachOutcome,
  attachAttribution,
  finalizeExperience,
  expireExperience,
  unresolveExperience,
  isDecisionReadyForOutcome,
  categoryToExperienceType,
  gcExperienceBuffer,
  experienceStats,
  makeExperienceId,
  buildDecisionRef,
  MEASUREMENT_DELAYS,
} from "../../../src/domain/intelligence/experience";

// ─── 测试夹具 ──────────────────────────────────────────────

function makeDecisionRef(overrides?: Partial<DecisionRef>): DecisionRef {
  return {
    decisionId: "D-100-1",
    decisionTick: 100,
    category: "MILITARY",
    actor: "war-planning",
    selectedAction: "WAR_PLAN_ATTACK_W1N1",
    decisionHash: "a1b2c3d4",
    correlationId: "rcv-D-100-1-100",
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

function makeIdentity(overrides?: Partial<ExperienceIdentity>): ExperienceIdentity {
  return {
    experienceId: "E-100-1",
    tick: 100,
    source: "experience-collector",
    type: "war",
    ...overrides,
  };
}

function makeExperience(overrides?: Partial<ExperienceRecord>): ExperienceRecord {
  return createExperience(
    overrides?.identity ?? makeIdentity(),
    overrides?.decision ?? makeDecisionRef(),
    overrides?.context ?? makeContext(),
    1,
  );
}

// ─── 测试 ──────────────────────────────────────────────────

describe("A6.1 Experience Model", () => {
  describe("UT-001: ExperienceRingBuffer — push + getRecent", () => {
    it("should push and retrieve experiences", () => {
      const buf = createExperienceRingBuffer(10);
      const exp = makeExperience();
      pushExperience(buf, exp);

      const recent = getRecentExperiences(buf, 5);
      expect(recent).toHaveLength(1);
      expect(recent[0]!.identity.experienceId).toBe("E-100-1");
    });

    it("should return experiences in reverse order (newest first)", () => {
      const buf = createExperienceRingBuffer(10);
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-100-1", tick: 100 }) }));
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-100-2", tick: 101 }) }));
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-100-3", tick: 102 }) }));

      const recent = getRecentExperiences(buf, 3);
      expect(recent[0]!.identity.experienceId).toBe("E-100-3");
      expect(recent[1]!.identity.experienceId).toBe("E-100-2");
      expect(recent[2]!.identity.experienceId).toBe("E-100-1");
    });
  });

  describe("UT-002: ExperienceRingBuffer — 环形覆盖", () => {
    it("should overwrite oldest when full", () => {
      const buf = createExperienceRingBuffer(3);
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-1", tick: 1 }) }));
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-2", tick: 2 }) }));
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-3", tick: 3 }) }));
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-4", tick: 4 }) }));

      expect(buf.count).toBe(3);
      expect(buf.totalWritten).toBe(4);

      const recent = getRecentExperiences(buf, 3);
      // E-1 should have been overwritten
      const ids = recent.map(r => r.identity.experienceId);
      expect(ids).not.toContain("E-1");
      expect(ids).toContain("E-2");
      expect(ids).toContain("E-3");
      expect(ids).toContain("E-4");
    });
  });

  describe("UT-003: getPendingOutcomes — 筛选未采集 Outcome", () => {
    it("should return experiences without outcomes", () => {
      const buf = createExperienceRingBuffer(10);
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-1" }) }));
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-2" }) }));

      // Attach outcome to E-1
      const withOutcome = attachOutcome(
        getRecentExperiences(buf, 10).find(e => e.identity.experienceId === "E-1")!,
        {
          decisionId: "D-100-1",
          decisionTick: 100,
          measurementTick: 600,
          delay: 500,
          classification: "SUCCESS" as const,
          metric: "warOutcome",
          value: 1,
          source: "evaluateWarOutcome",
          stateAfterHash: "hash_after",
          stateDelta: {},
        },
      );
      buf.records[0] = withOutcome;

      const pending = getPendingOutcomes(buf);
      expect(pending).toHaveLength(1);
      expect(pending[0]!.identity.experienceId).toBe("E-2");
    });

    it("should return in tick-ascending order", () => {
      const buf = createExperienceRingBuffer(10);
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-1", tick: 200 }) }));
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-2", tick: 100 }) }));

      const pending = getPendingOutcomes(buf);
      expect(pending[0]!.identity.tick).toBe(100);
      expect(pending[1]!.identity.tick).toBe(200);
    });
  });

  describe("UT-004: getUnattributed — 筛选未归因", () => {
    it("should return experiences without attribution", () => {
      const buf = createExperienceRingBuffer(10);
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-1" }) }));
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-2" }) }));

      const unattributed = getUnattributed(buf);
      expect(unattributed).toHaveLength(2);
    });
  });

  describe("UT-005: createExperience — 初始 lifecycle", () => {
    it("should create experience with lifecycle = OBSERVED", () => {
      const exp = makeExperience();
      expect(exp.lifecycle).toBe("OBSERVED");
      expect(exp.outcome).toBeUndefined();
      expect(exp.attribution).toBeUndefined();
    });
  });

  describe("UT-006: attachOutcome — lifecycle transition", () => {
    it("should transition OBSERVED → OPEN", () => {
      const exp = makeExperience();
      const outcome = {
        decisionId: "D-100-1",
        decisionTick: 100,
        measurementTick: 600,
        delay: 500,
        classification: "SUCCESS" as const,
        metric: "warOutcome",
        value: 1,
        source: "evaluateWarOutcome",
        stateAfterHash: "hash_after",
        stateDelta: {},
      };
      const withOutcome = attachOutcome(exp, outcome);
      expect(withOutcome.lifecycle).toBe("OPEN");
      expect(withOutcome.outcome).toBeDefined();
      // Original should be unchanged (immutable)
      expect(exp.outcome).toBeUndefined();
    });
  });

  describe("UT-007: attachAttribution — lifecycle transition", () => {
    it("should transition OPEN → ATTRIBUTED", () => {
      const exp = makeExperience();
      const outcome = {
        decisionId: "D-100-1",
        decisionTick: 100,
        measurementTick: 600,
        delay: 500,
        classification: "SUCCESS" as const,
        metric: "warOutcome",
        value: 1,
        source: "evaluateWarOutcome",
        stateAfterHash: "hash_after",
        stateDelta: {},
      };
      const withOutcome = attachOutcome(exp, outcome);
      const attribution = {
        primaryCause: "DECISION_QUALITY" as const,
        contributingFactors: [],
        externalFactors: [],
        systemAttribution: "war-planning",
        confidence: 0.9,
        method: "direct" as const,
        evidence: [],
        attributionHash: "test_hash",
      };
      const withAttribution = attachAttribution(withOutcome, attribution);
      expect(withAttribution.lifecycle).toBe("ATTRIBUTED");
      expect(withAttribution.attribution).toBeDefined();
    });
  });

  describe("UT-008: finalizeExperience — lifecycle transition", () => {
    it("should transition ATTRIBUTED → FINALIZED", () => {
      const exp = makeExperience();
      const finalized = finalizeExperience(exp);
      expect(finalized.lifecycle).toBe("FINALIZED");
    });
  });

  describe("UT-009: expireExperience — lifecycle transition", () => {
    it("should mark as EXPIRED", () => {
      const exp = makeExperience();
      const expired = expireExperience(exp);
      expect(expired.lifecycle).toBe("EXPIRED");
    });
  });

  describe("UT-010: isDecisionReadyForOutcome — 到期判定", () => {
    it("should return true when delay exceeded", () => {
      // war delay = 500
      expect(isDecisionReadyForOutcome(100, 600, "war")).toBe(true);
      expect(isDecisionReadyForOutcome(100, 601, "war")).toBe(true);
    });

    it("should return false when delay not yet reached", () => {
      expect(isDecisionReadyForOutcome(100, 599, "war")).toBe(false);
      expect(isDecisionReadyForOutcome(100, 100, "war")).toBe(false);
    });

    it("should use type-specific delays", () => {
      // recovery delay = 100
      expect(isDecisionReadyForOutcome(100, 200, "recovery")).toBe(true);
      expect(isDecisionReadyForOutcome(100, 199, "recovery")).toBe(false);

      // spawn delay = 150
      expect(isDecisionReadyForOutcome(100, 250, "spawn")).toBe(true);
      expect(isDecisionReadyForOutcome(100, 249, "spawn")).toBe(false);
    });
  });

  describe("UT-011: categoryToExperienceType — 映射", () => {
    it("should map DecisionCategory to ExperienceType", () => {
      expect(categoryToExperienceType("MILITARY")).toBe("war");
      expect(categoryToExperienceType("EXPANSION")).toBe("expansion");
      expect(categoryToExperienceType("ECONOMY")).toBe("economic");
      expect(categoryToExperienceType("DEFENSE_PREP")).toBe("defense");
      expect(categoryToExperienceType("LOGISTICS")).toBe("logistics");
      expect(categoryToExperienceType("SPAWN")).toBe("spawn");
      expect(categoryToExperienceType("RECOVERY")).toBe("recovery");
    });

    it("should default to economic for unknown categories", () => {
      expect(categoryToExperienceType("UNKNOWN")).toBe("economic");
    });
  });

  describe("UT-012: gcExperienceBuffer — GC 清理", () => {
    it("should clean up old experiences", () => {
      const buf = createExperienceRingBuffer(10);
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-1", tick: 1 }) }));
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-2", tick: 5000 }) }));

      const result = gcExperienceBuffer(buf, 10000, 5000);
      expect(result.cleaned).toBe(1);
      expect(buf.count).toBe(1);
    });

    it("should not clean recent experiences", () => {
      const buf = createExperienceRingBuffer(10);
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-1", tick: 9000 }) }));

      const result = gcExperienceBuffer(buf, 10000, 5000);
      expect(result.cleaned).toBe(0);
      expect(buf.count).toBe(1);
    });
  });

  describe("UT-013: experienceStats — 统计", () => {
    it("should return correct statistics", () => {
      const buf = createExperienceRingBuffer(10);
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-1", type: "war" }) }));
      pushExperience(buf, makeExperience({ identity: makeIdentity({ experienceId: "E-2", type: "spawn" }) }));

      const stats = experienceStats(buf);
      expect(stats.total).toBe(2);
      expect(stats.byType.war).toBe(1);
      expect(stats.byType.spawn).toBe(1);
      expect(stats.attributed).toBe(0);
      expect(stats.unattributed).toBe(2);
    });
  });

  describe("UT-014: makeExperienceId — 格式", () => {
    it("should produce E-{tick}-{seq} format", () => {
      expect(makeExperienceId(100, 1)).toBe("E-100-1");
      expect(makeExperienceId(5000, 42)).toBe("E-5000-42");
    });
  });

  describe("UT-015: buildDecisionRef — 引用不复制", () => {
    it("should build DecisionRef with only necessary fields", () => {
      const ref = buildDecisionRef({
        decisionId: "D-100-1",
        tick: 100,
        category: "MILITARY",
        actor: "war-planning",
        selectedAction: "WAR_PLAN_ATTACK",
        decisionHash: "a1b2c3d4",
        correlationId: "rcv-D-100-1-100",
      });

      expect(ref.decisionId).toBe("D-100-1");
      expect(ref.decisionTick).toBe(100);
      expect(ref.category).toBe("MILITARY");
      expect(ref.actor).toBe("war-planning");
      expect(ref.selectedAction).toBe("WAR_PLAN_ATTACK");
      expect(ref.decisionHash).toBe("a1b2c3d4");
      expect(ref.correlationId).toBe("rcv-D-100-1-100");
    });
  });

  describe("MEASUREMENT_DELAYS — 延迟值合理性", () => {
    it("should have reasonable delays for each type", () => {
      expect(MEASUREMENT_DELAYS.war).toBeGreaterThanOrEqual(100);
      expect(MEASUREMENT_DELAYS.recovery).toBeGreaterThanOrEqual(50);
      expect(MEASUREMENT_DELAYS.spawn).toBeGreaterThanOrEqual(50);
      expect(MEASUREMENT_DELAYS.economic).toBeGreaterThanOrEqual(100);
    });
  });
});
