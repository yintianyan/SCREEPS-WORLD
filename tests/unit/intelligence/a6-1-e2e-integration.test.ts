/** A6.1 E2E Integration — 端到端集成测试。 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  type ExperienceRecord,
  type ExperienceRingBuffer,
  type DecisionRef,
  type ExperienceContext,
  type ExperienceIdentity,
  createExperienceRingBuffer,
  pushExperience,
  getRecentExperiences,
  getPendingOutcomes,
  getUnattributed,
  gcExperienceBuffer,
  experienceStats,
  makeExperienceId,
  buildDecisionRef,
  createExperience,
  attachOutcome,
  attachAttribution,
  finalizeExperience,
  isDecisionReadyForOutcome,
  categoryToExperienceType,
  MEASUREMENT_DELAYS,
} from "../../../src/domain/intelligence/experience";
import {
  type OutcomeCollectionInput,
  collectOutcome,
  computeOutcomeConfidence,
} from "../../../src/domain/intelligence/outcome";
import {
  type AttributionInput,
  collectAttribution,
  verifyAttributionDeterminism,
} from "../../../src/domain/intelligence/attribution";
import type { DecisionRecord, DecisionEvidence } from "../../../src/domain/strategy/decision-trace";

// ─── 测试夹具 ──────────────────────────────────────────────

function makeDecisionEvidence(): DecisionEvidence {
  return {
    energy: { available: 3000, income: 15, expense: 10 },
    spawn: { capacity: 3, queueLength: 0, p0Count: 0 },
    population: { harvester: 6, hauler: 4 },
    logistics: { deliveryFailure: 0, haulerDeficit: 0, backlog: 0 },
    recovery: { activeActions: 0, succeededCount: 5, failedCount: 1 },
    health: { empireHealthLevel: "stable", empireHealthScore: 0.6, bottleneck: "none", recovering: false },
  };
}

function makeDecisionRecord(overrides?: Partial<DecisionRecord>): DecisionRecord {
  return {
    decisionId: "D-100-1",
    tick: 100,
    category: "MILITARY",
    actor: "war-planning",
    scope: "empire",
    inputSnapshotHash: "a1b2c3d4",
    reasons: [{ metric: "warPlan", actual: "attack", threshold: "scout", severity: "info", consequence: "no action" }],
    evidence: makeDecisionEvidence(),
    selectedAction: "WAR_PLAN_ATTACK_W1N1",
    rejectedAlternatives: [{ action: "WAR_PLAN_DEFEND", reason: "no threat" }],
    expectedOutcome: "success",
    correlationId: "rcv-D-100-1-100",
    severity: "NORMAL",
    decisionHash: "h1a2b3c4",
    createdAt: 100,
    lifecycle: "ACTIVE",
    ...overrides,
  };
}

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

// ─── 测试 ──────────────────────────────────────────────────

describe("A6.1 E2E Integration", () => {
  describe("E2E-001: 完整流水线 — DecisionRecord → ExperienceRecord → FINALIZED", () => {
    it("should build experience from DecisionRecord, attach outcome and attribution, finalize", () => {
      // 1. 从 DecisionRecord 构建 ExperienceRecord
      const record = makeDecisionRecord();
      const decisionRef = buildDecisionRef({
        decisionId: record.decisionId,
        tick: record.tick,
        category: record.category,
        actor: record.actor,
        selectedAction: record.selectedAction,
        decisionHash: record.decisionHash,
        correlationId: record.correlationId,
      });
      const context = makeContext({
        stateBeforeHash: record.inputSnapshotHash,
      });
      const identity = makeIdentity();
      let exp = createExperience(identity, decisionRef, context, 1);

      expect(exp.lifecycle).toBe("OBSERVED");
      expect(exp.outcome).toBeUndefined();
      expect(exp.attribution).toBeUndefined();

      // 2. 采集 Outcome（war 类型，延迟 500 tick 后）
      const outcomeInput: OutcomeCollectionInput = {
        decisionId: record.decisionId,
        decisionTick: record.tick,
        currentTick: 600,
        type: "war",
        stateBeforeHash: record.inputSnapshotHash,
        stateAfterHash: "hash_after_600",
        warOutcome: "success",
      };
      const outcome = collectOutcome(outcomeInput);
      expect(outcome).toBeDefined();
      exp = attachOutcome(exp, outcome!);

      expect(exp.lifecycle).toBe("OPEN");
      expect(exp.outcome).toBeDefined();
      expect(exp.outcome!.classification).toBe("SUCCESS");

      // 3. 采集 Attribution
      const attrInput: AttributionInput = {
        type: "war",
        outcome: exp.outcome!,
        context: exp.context,
        modelVersion: 1,
        warOurLosses: 1,
        warSquadSize: 5,
      };
      const attribution = collectAttribution(attrInput);
      exp = attachAttribution(exp, attribution);

      expect(exp.lifecycle).toBe("ATTRIBUTED");
      expect(exp.attribution).toBeDefined();
      expect(exp.attribution!.primaryCause).toBe("DECISION_QUALITY");
      expect(exp.attribution!.confidence).toBeGreaterThanOrEqual(0.8);

      // 4. 最终化
      exp = finalizeExperience(exp);
      expect(exp.lifecycle).toBe("FINALIZED");

      // 5. 验证完整链
      expect(exp.identity.experienceId).toBe("E-100-1");
      expect(exp.decision.decisionId).toBe("D-100-1");
      expect(exp.outcome!.classification).toBe("SUCCESS");
      expect(exp.attribution!.primaryCause).toBe("DECISION_QUALITY");
      expect(exp.attribution!.attributionHash).toHaveLength(8);
    });
  });

  describe("E2E-002: 测量延迟门禁 — 未到期不采集", () => {
    it("should not collect outcome before measurement delay", () => {
      const decisionTick = 100;
      const type = "war"; // delay = 500
      // tick 599 → 未到期
      expect(isDecisionReadyForOutcome(decisionTick, 599, type)).toBe(false);
      // tick 600 → 到期
      expect(isDecisionReadyForOutcome(decisionTick, 600, type)).toBe(true);
    });

    it("should respect type-specific delays", () => {
      const decisionTick = 100;
      // recovery delay = 100
      expect(isDecisionReadyForOutcome(decisionTick, 199, "recovery")).toBe(false);
      expect(isDecisionReadyForOutcome(decisionTick, 200, "recovery")).toBe(true);
      // expansion delay = 2000
      expect(isDecisionReadyForOutcome(decisionTick, 2099, "expansion")).toBe(false);
      expect(isDecisionReadyForOutcome(decisionTick, 2100, "expansion")).toBe(true);
    });
  });

  describe("E2E-003: 重复 DecisionRecord 不产生重复 Experience", () => {
    it("should not create duplicate experiences for same decisionId", () => {
      const buf = createExperienceRingBuffer(50);
      const processedIds = new Set<string>();

      // 模拟同一个 DecisionRecord 被处理两次
      const record = makeDecisionRecord({ decisionId: "D-100-1" });
      const expType = categoryToExperienceType(record.category);
      const decisionRef = makeDecisionRef({ decisionId: record.decisionId });

      // 第一次处理
      if (!processedIds.has(record.decisionId)) {
        const exp = createExperience(
          makeIdentity({ experienceId: "E-100-1" }),
          decisionRef,
          makeContext(),
          1,
        );
        pushExperience(buf, exp);
        processedIds.add(record.decisionId);
      }

      // 第二次处理（应被跳过）
      if (!processedIds.has(record.decisionId)) {
        const exp = createExperience(
          makeIdentity({ experienceId: "E-100-2" }),
          decisionRef,
          makeContext(),
          1,
        );
        pushExperience(buf, exp);
        processedIds.add(record.decisionId);
      }

      expect(buf.count).toBe(1);
      expect(processedIds.size).toBe(1);
    });
  });

  describe("E2E-004: Ring Buffer 环形覆盖", () => {
    it("should overwrite oldest experiences when buffer is full", () => {
      const buf = createExperienceRingBuffer(5);
      // 写入 7 条（超过容量 5）
      for (let i = 0; i < 7; i++) {
        const exp = createExperience(
          makeIdentity({ experienceId: `E-${i}`, tick: i }),
          makeDecisionRef({ decisionId: `D-${i}` }),
          makeContext(),
          1,
        );
        pushExperience(buf, exp);
      }

      expect(buf.count).toBe(5);
      expect(buf.totalWritten).toBe(7);

      // 最旧的两条 (E-0, E-1) 应被覆盖
      const recent = getRecentExperiences(buf, 5);
      const ids = recent.map(e => e.identity.experienceId);
      expect(ids).not.toContain("E-0");
      expect(ids).not.toContain("E-1");
      expect(ids).toContain("E-5");
      expect(ids).toContain("E-6");
    });
  });

  describe("E2E-005: GC 清理", () => {
    it("should clean up old experiences and keep recent ones", () => {
      const buf = createExperienceRingBuffer(20);
      // 写入不同 tick 的记录
      pushExperience(buf, createExperience(
        makeIdentity({ experienceId: "E-old", tick: 100 }),
        makeDecisionRef(), makeContext(), 1,
      ));
      pushExperience(buf, createExperience(
        makeIdentity({ experienceId: "E-recent", tick: 8000 }),
        makeDecisionRef({ decisionId: "D-8000" }), makeContext(), 1,
      ));

      // GC：清理超过 5000 tick 的记录
      const result = gcExperienceBuffer(buf, 10000, 5000);
      expect(result.cleaned).toBe(1);
      expect(buf.count).toBe(1);

      const recent = getRecentExperiences(buf, 10);
      expect(recent).toHaveLength(1);
      expect(recent[0]!.identity.experienceId).toBe("E-recent");
    });
  });

  describe("E2E-006: Stats 可观测性", () => {
    it("should return correct stats for mixed experiences", () => {
      const buf = createExperienceRingBuffer(20);

      // 2 条 war
      pushExperience(buf, createExperience(
        makeIdentity({ experienceId: "E-w1", type: "war" }),
        makeDecisionRef(), makeContext(), 1,
      ));
      pushExperience(buf, createExperience(
        makeIdentity({ experienceId: "E-w2", type: "war" }),
        makeDecisionRef({ decisionId: "D-2" }), makeContext(), 1,
      ));

      // 1 条 recovery（已附加 outcome）
      const recExp = createExperience(
        makeIdentity({ experienceId: "E-r1", type: "recovery" }),
        makeDecisionRef({ decisionId: "D-3" }),
        makeContext(),
        1,
      );
      const outcome = collectOutcome({
        decisionId: "D-3", decisionTick: 100, currentTick: 200,
        type: "recovery", stateBeforeHash: "h", stateAfterHash: "h2",
        recoverySucceeded: 8, recoveryFailed: 2,
      });
      buf.records[2] = attachOutcome(recExp, outcome!);

      // 1 条 economic（已附加 outcome + attribution = FINALIZED）
      const econExp = createExperience(
        makeIdentity({ experienceId: "E-e1", type: "economic" }),
        makeDecisionRef({ decisionId: "D-4" }),
        makeContext(),
        1,
      );
      const econOutcome = collectOutcome({
        decisionId: "D-4", decisionTick: 100, currentTick: 600,
        type: "economic", stateBeforeHash: "h", stateAfterHash: "h2",
        healthScoreBefore: 0.3, healthScoreAfter: 0.5,
      });
      let econWithOutcome = attachOutcome(econExp, econOutcome!);
      const econAttr = collectAttribution({
        type: "economic",
        outcome: econWithOutcome.outcome!,
        context: econWithOutcome.context,
        modelVersion: 1,
        healthScoreBefore: 0.3,
        healthScoreAfter: 0.5,
      });
      econWithOutcome = attachAttribution(econWithOutcome, econAttr);
      buf.records[3] = finalizeExperience(econWithOutcome);

      const stats = experienceStats(buf);
      expect(stats.total).toBe(4);
      expect(stats.byType.war).toBe(2);
      expect(stats.byType.recovery).toBe(1);
      expect(stats.byType.economic).toBe(1);
      expect(stats.attributed).toBe(1); // only econ has attribution
      expect(stats.unattributed).toBe(3);
      expect(stats.byLifecycle.FINALIZED).toBe(1);
      expect(stats.byLifecycle.OBSERVED).toBe(2); // 2 war records still OBSERVED
    });
  });

  describe("E2E-007: Shadow-Only — 系统不修改全局状态", () => {
    it("should not write to Memory or modify any global state", () => {
      // 采集 Attribution 不修改输入
      const outcome = collectOutcome({
        decisionId: "D-100-1", decisionTick: 100, currentTick: 600,
        type: "war", stateBeforeHash: "h", stateAfterHash: "h2",
        warOutcome: "success",
      })!;

      const context = makeContext();
      const input: AttributionInput = {
        type: "war",
        outcome,
        context,
        modelVersion: 1,
      };
      const inputSnapshot = JSON.parse(JSON.stringify(input));

      collectAttribution(input);

      // Input should not be modified
      const inputAfter = JSON.parse(JSON.stringify(input));
      expect(inputAfter).toEqual(inputSnapshot);
    });

    it("should not call any Game API", () => {
      // 纯函数测试：collectOutcome / collectAttribution 不引用 Game
      // 这通过编译时类型检查保证 — 无 Game 类型导入
      const outcome = collectOutcome({
        decisionId: "D-1", decisionTick: 100, currentTick: 600,
        type: "war", stateBeforeHash: "h", stateAfterHash: "h2",
        warOutcome: "success",
      });
      expect(outcome).toBeDefined();
      // 如果 collectAttribution 引用了 Game，会在运行时报错
      const attr = collectAttribution({
        type: "war",
        outcome: outcome!,
        context: makeContext(),
        modelVersion: 1,
      });
      expect(attr).toBeDefined();
    });
  });

  describe("E2E-008: 确定性 Replay — 相同输入相同 hash", () => {
    it("should produce same attributionHash for identical input (1000 iterations)", () => {
      const outcome = collectOutcome({
        decisionId: "D-100-1", decisionTick: 100, currentTick: 600,
        type: "war", stateBeforeHash: "h", stateAfterHash: "h2",
        warOutcome: "success",
      })!;
      const input: AttributionInput = {
        type: "war",
        outcome,
        context: makeContext(),
        modelVersion: 1,
        warOurLosses: 1,
        warSquadSize: 5,
      };

      const result = verifyAttributionDeterminism(input, 1000);
      expect(result.deterministic).toBe(true);
      expect(result.firstDivergenceAt).toBeUndefined();
      const uniqueHashes = new Set(result.hashes);
      expect(uniqueHashes.size).toBe(1);
    });

    it("should produce different hash for different inputs", () => {
      const outcome1 = collectOutcome({
        decisionId: "D-1", decisionTick: 100, currentTick: 600,
        type: "war", stateBeforeHash: "h", stateAfterHash: "h2",
        warOutcome: "success",
      })!;
      const outcome2 = collectOutcome({
        decisionId: "D-1", decisionTick: 100, currentTick: 600,
        type: "war", stateBeforeHash: "h", stateAfterHash: "h2",
        warOutcome: "failure",
      })!;

      const attr1 = collectAttribution({
        type: "war", outcome: outcome1, context: makeContext(), modelVersion: 1,
      });
      const attr2 = collectAttribution({
        type: "war", outcome: outcome2, context: makeContext(), modelVersion: 1,
      });

      expect(attr1.attributionHash).not.toBe(attr2.attributionHash);
    });
  });

  describe("E2E-009: 无法采集 Outcome → UNRESOLVED", () => {
    it("should handle missing outcome data gracefully", () => {
      // war 类型但无 warOutcome 字段 → collectOutcome 返回 undefined
      const outcome = collectOutcome({
        decisionId: "D-1", decisionTick: 100, currentTick: 600,
        type: "war", stateBeforeHash: "h", stateAfterHash: "h2",
        // warOutcome 未设置
      });
      expect(outcome).toBeUndefined();
    });

    it("should handle recovery with no stats gracefully", () => {
      const outcome = collectOutcome({
        decisionId: "D-1", decisionTick: 100, currentTick: 200,
        type: "recovery", stateBeforeHash: "h", stateAfterHash: "h2",
        // recoverySucceeded/Failed 未设置
      });
      expect(outcome).toBeUndefined();
    });
  });

  describe("E2E-010: 多类型混合 — War + Recovery + Economic 并行", () => {
    it("should handle multiple experience types simultaneously", () => {
      const buf = createExperienceRingBuffer(50);

      // War experience
      const warExp = createExperience(
        makeIdentity({ experienceId: "E-war", type: "war", tick: 100 }),
        makeDecisionRef({ decisionId: "D-war" }),
        makeContext(),
        1,
      );
      pushExperience(buf, warExp);

      // Recovery experience
      const recExp = createExperience(
        makeIdentity({ experienceId: "E-rec", type: "recovery", tick: 100 }),
        makeDecisionRef({ decisionId: "D-rec" }),
        makeContext(),
        1,
      );
      pushExperience(buf, recExp);

      // Economic experience
      const econExp = createExperience(
        makeIdentity({ experienceId: "E-econ", type: "economic", tick: 100 }),
        makeDecisionRef({ decisionId: "D-econ" }),
        makeContext(),
        1,
      );
      pushExperience(buf, econExp);

      // 采集各自 Outcome
      const warOutcome = collectOutcome({
        decisionId: "D-war", decisionTick: 100, currentTick: 600,
        type: "war", stateBeforeHash: "h", stateAfterHash: "h2",
        warOutcome: "success",
      })!;
      const recOutcome = collectOutcome({
        decisionId: "D-rec", decisionTick: 100, currentTick: 200,
        type: "recovery", stateBeforeHash: "h", stateAfterHash: "h2",
        recoverySucceeded: 9, recoveryFailed: 1,
      })!;
      const econOutcome = collectOutcome({
        decisionId: "D-econ", decisionTick: 100, currentTick: 600,
        type: "economic", stateBeforeHash: "h", stateAfterHash: "h2",
        healthScoreBefore: 0.3, healthScoreAfter: 0.6,
      })!;

      // 附加 Outcome
      const warIdx = buf.records.findIndex(r => r?.identity.experienceId === "E-war");
      const recIdx = buf.records.findIndex(r => r?.identity.experienceId === "E-rec");
      const econIdx = buf.records.findIndex(r => r?.identity.experienceId === "E-econ");

      buf.records[warIdx!] = attachOutcome(warExp, warOutcome);
      buf.records[recIdx!] = attachOutcome(recExp, recOutcome);
      buf.records[econIdx!] = attachOutcome(econExp, econOutcome);

      // 采集 Attribution
      const warAttr = collectAttribution({
        type: "war", outcome: warOutcome, context: makeContext(), modelVersion: 1,
        warOurLosses: 1, warSquadSize: 5,
      });
      const recAttr = collectAttribution({
        type: "recovery", outcome: recOutcome, context: makeContext(), modelVersion: 1,
        recoverySucceeded: 9, recoveryFailed: 1,
      });
      const econAttr = collectAttribution({
        type: "economic", outcome: econOutcome, context: makeContext(), modelVersion: 1,
        healthScoreBefore: 0.3, healthScoreAfter: 0.6,
      });

      // 附加 Attribution + 最终化
      buf.records[warIdx!] = finalizeExperience(attachAttribution(
        buf.records[warIdx!] as ExperienceRecord, warAttr));
      buf.records[recIdx!] = finalizeExperience(attachAttribution(
        buf.records[recIdx!] as ExperienceRecord, recAttr));
      buf.records[econIdx!] = finalizeExperience(attachAttribution(
        buf.records[econIdx!] as ExperienceRecord, econAttr));

      // 验证
      const stats = experienceStats(buf);
      expect(stats.total).toBe(3);
      expect(stats.attributed).toBe(3);
      expect(stats.byLifecycle.FINALIZED).toBe(3);

      // 各类型归因不同
      const warFinal = buf.records[warIdx!] as ExperienceRecord;
      const recFinal = buf.records[recIdx!] as ExperienceRecord;
      const econFinal = buf.records[econIdx!] as ExperienceRecord;

      expect(warFinal.attribution!.primaryCause).toBe("DECISION_QUALITY");
      expect(recFinal.attribution!.primaryCause).toBe("DECISION_QUALITY");
      expect(econFinal.attribution!.method).toBe("expert");
      expect(econFinal.attribution!.confidence).toBeLessThanOrEqual(0.5);

      // Hash 各不相同
      expect(warFinal.attribution!.attributionHash).not.toBe(recFinal.attribution!.attributionHash);
      expect(warFinal.attribution!.attributionHash).not.toBe(econFinal.attribution!.attributionHash);
      expect(recFinal.attribution!.attributionHash).not.toBe(econFinal.attribution!.attributionHash);
    });
  });
});
