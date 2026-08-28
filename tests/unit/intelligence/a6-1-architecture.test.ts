/**  */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  collectAttribution,
  attributionHash,
  verifyAttributionDeterminism,
  type AttributionInput,
} from "../../../src/domain/intelligence/attribution";
import {
  collectOutcome,
} from "../../../src/domain/intelligence/outcome";
import {
  createExperience,
  attachOutcome,
  attachAttribution,
  finalizeExperience,
  type OutcomeRecord,
  type ExperienceContext,
  type DecisionRef,
  type ExperienceIdentity,
} from "../../../src/domain/intelligence/experience";

// ─── 工具函数 ──────────────────────────────────────────────

function readSrc(file: string): string {
  return readFileSync(join(process.cwd(), "src", file), "utf-8");
}

function readDomain(file: string): string {
  return readFileSync(join(process.cwd(), "src/domain/intelligence", file), "utf-8");
}

// ─── 测试 ──────────────────────────────────────────────────

describe("A6.1 Architecture Guards", () => {
  describe("UT-041: INT-013 — Domain 层不引用 Game/Memory/RawMemory", () => {
    // 去掉注释行后检查代码行
    function stripComments(src: string): string {
      return src.split("\n").filter(l => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
    }

    it("experience.ts should not import Game/Memory/RawMemory", () => {
      const src = stripComments(readDomain("experience.ts"));
      expect(src).not.toMatch(/\bGame\b\./);
      expect(src).not.toMatch(/\bMemory\b\./);
      expect(src).not.toMatch(/\bRawMemory\b/);
      expect(src).not.toMatch(/globalCache/);
    });

    it("outcome.ts should not import Game/Memory/RawMemory", () => {
      const src = stripComments(readDomain("outcome.ts"));
      expect(src).not.toMatch(/\bGame\b\./);
      expect(src).not.toMatch(/\bMemory\b\./);
      expect(src).not.toMatch(/\bRawMemory\b/);
      expect(src).not.toMatch(/globalCache/);
    });

    it("attribution.ts should not import Game/Memory/RawMemory", () => {
      const src = stripComments(readDomain("attribution.ts"));
      expect(src).not.toMatch(/\bGame\b\./);
      expect(src).not.toMatch(/\bMemory\b\./);
      expect(src).not.toMatch(/\bRawMemory\b/);
      expect(src).not.toMatch(/globalCache/);
    });
  });

  describe("UT-042: INT-013 — Domain 层不建立第二套系统", () => {
    it("should not import decision-trace (only type re-exports)", () => {
      const src = readDomain("experience.ts");
      // Should not import decision-trace module directly
      expect(src).not.toMatch(/from\s+["'].*decision-trace["']/);
    });

    it("should not re-implement recovery/spawn/logistics logic", () => {
      const src = readDomain("outcome.ts");
      // Should only consume, not re-implement
      expect(src).not.toMatch(/function spawnCreep/);
      expect(src).not.toMatch(/function createConstructionSite/);
      expect(src).not.toMatch(/function evaluateWarOutcome/);
    });
  });

  describe("UT-045: INT-007 — Domain 纯函数不调用 Game API", () => {
    it("attribution.ts should not call Game API methods", () => {
      const src = readDomain("attribution.ts");
      expect(src).not.toMatch(/\.spawnCreep\(/);
      expect(src).not.toMatch(/\.attack\(/);
      expect(src).not.toMatch(/\.move\(/);
      expect(src).not.toMatch(/\.transfer\(/);
      expect(src).not.toMatch(/\.createConstructionSite\(/);
    });

    it("outcome.ts should not call Game API methods", () => {
      const src = readDomain("outcome.ts");
      expect(src).not.toMatch(/\.spawnCreep\(/);
      expect(src).not.toMatch(/\.attack\(/);
      expect(src).not.toMatch(/\.move\(/);
      expect(src).not.toMatch(/\.transfer\(/);
    });
  });

  describe("UT-046: 确定性 — attributionHash 不使用 Math.random", () => {
    it("attribution.ts should not use Math.random", () => {
      const src = readDomain("attribution.ts").split("\n").filter(l => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
      expect(src).not.toMatch(/Math\.random/);
    });
  });

  describe("UT-047: 确定性 — attributionHash 不使用 Date.now", () => {
    it("attribution.ts should not use Date.now", () => {
      const src = readDomain("attribution.ts").split("\n").filter(l => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
      expect(src).not.toMatch(/Date\.now/);
    });
  });

  describe("UT-048: Shadow-Only — collectAttribution 不修改输入", () => {
    it("should return new objects, not mutate input", () => {
      const outcome: OutcomeRecord = {
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
      };
      const context: ExperienceContext = {
        scope: "empire",
        posture: "war",
        empireHealthLevel: "stable",
        empireHealthScore: 0.5,
        cpuTier: "healthy",
        stateBeforeHash: "hash_before",
        metrics: {},
      };

      // Create a snapshot of the input
      const inputSnapshot = JSON.parse(JSON.stringify({ type: "war" as const, outcome, context, modelVersion: 1 }));

      const result = collectAttribution({
        type: "war",
        outcome,
        context,
        modelVersion: 1,
      });

      // The input should not have been modified
      const inputAfter = JSON.parse(JSON.stringify({ type: "war" as const, outcome, context, modelVersion: 1 }));
      expect(inputAfter).toEqual(inputSnapshot);

      // The result should be a new object
      expect(result).not.toBe(inputSnapshot);
    });
  });

  describe("INT-018: 置信度标注", () => {
    it("all Attribution results should have confidence field", () => {
      const outcome: OutcomeRecord = {
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
      };
      const context: ExperienceContext = {
        scope: "empire",
        posture: "war",
        empireHealthLevel: "stable",
        empireHealthScore: 0.5,
        cpuTier: "healthy",
        stateBeforeHash: "hash_before",
        metrics: {},
      };

      // Test all types
      const types = ["war", "recovery", "economic", "logistics", "spawn", "expansion", "defense"] as const;
      for (const type of types) {
        const attr = collectAttribution({
          type,
          outcome,
          context,
          modelVersion: 1,
        });
        expect(attr.confidence).toBeDefined();
        expect(attr.confidence).toBeGreaterThanOrEqual(0);
        expect(attr.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 补充架构安全边界测试
  // ═══════════════════════════════════════════════════════════

  describe("INT-013-extended: Domain 层不引用 globalThis", () => {
    it("experience.ts should not access globalThis", () => {
      const src = readDomain("experience.ts");
      expect(src).not.toMatch(/globalThis/);
    });

    it("outcome.ts should not access globalThis", () => {
      const src = readDomain("outcome.ts");
      expect(src).not.toMatch(/globalThis/);
    });

    it("attribution.ts should not access globalThis", () => {
      const src = readDomain("attribution.ts");
      expect(src).not.toMatch(/globalThis/);
    });
  });

  describe("INT-013-extended: Domain 层不引用 console", () => {
    it("experience.ts should not use console", () => {
      const src = readDomain("experience.ts");
      expect(src).not.toMatch(/console\./);
    });

    it("outcome.ts should not use console", () => {
      const src = readDomain("outcome.ts");
      expect(src).not.toMatch(/console\./);
    });

    it("attribution.ts should not use console", () => {
      const src = readDomain("attribution.ts");
      expect(src).not.toMatch(/console\./);
    });
  });


  describe("INT-007-extended: Domain 纯函数不引用 CPU", () => {
    it("experience.ts should not reference Game.cpu", () => {
      const src = readDomain("experience.ts");
      expect(src).not.toMatch(/Game\.cpu/);
      expect(src).not.toMatch(/Game\.Cpu/);
    });

    it("outcome.ts should not reference Game.cpu", () => {
      const src = readDomain("outcome.ts");
      expect(src).not.toMatch(/Game\.cpu/);
      expect(src).not.toMatch(/Game\.Cpu/);
    });

    it("attribution.ts should not reference Game.cpu", () => {
      const src = readDomain("attribution.ts");
      expect(src).not.toMatch(/Game\.cpu/);
      expect(src).not.toMatch(/Game\.Cpu/);
    });
  });

  describe("Determinism-extended: 确定性验证", () => {
    it("attributionHash should be 8-char hex string", () => {
      const hash = attributionHash("war", "DECISION_QUALITY", [], 1);
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it("verifyAttributionDeterminism should detect determinism (1000 iterations)", () => {
      const outcome: OutcomeRecord = {
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
      };
      const context: ExperienceContext = {
        scope: "empire",
        posture: "war",
        empireHealthLevel: "stable",
        empireHealthScore: 0.5,
        cpuTier: "healthy",
        stateBeforeHash: "hash_before",
        metrics: {},
      };
      const input: AttributionInput = {
        type: "war",
        outcome,
        context,
        modelVersion: 1,
      };

      const result = verifyAttributionDeterminism(input, 1000);
      expect(result.deterministic).toBe(true);
      expect(result.firstDivergenceAt).toBeUndefined();
      expect(result.hashes).toHaveLength(1000);
      expect(new Set(result.hashes).size).toBe(1);
    });
  });

});
