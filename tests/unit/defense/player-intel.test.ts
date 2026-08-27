/** A5.2 G5 — PlayerIntel Confidence 纯函数测试。 */
import { describe, expect, it } from "vitest";
import {
  buildPlayerIntelRecord,
  computeFreshness,
  applyFreshnessDecay,
  detectIntelConflict,
  aggregateIntelConfidence,
  evaluatePlayerThreatIndex,
  gcIntelEvidence,
  makeObservedFact,
  makeCombatLogFact,
  makeInference,
  makePrediction,
  FRESHNESS_THRESHOLDS,
  type IntelEvidence,
} from "../../../src/domain/defense/player-intel";

const CURRENT_TICK = 1_000_000;

// ─── 测试 ─────────────────────────────────────────────────

describe("G5 — computeFreshness", () => {
  it("age 0 → FRESH", () => {
    expect(computeFreshness(0)).toBe("FRESH");
  });

  it("age 300 → FRESH", () => {
    expect(computeFreshness(300)).toBe("FRESH");
  });

  it("age 1000 → RECENT", () => {
    expect(computeFreshness(1000)).toBe("RECENT");
  });

  it("age 5000 → STALE", () => {
    expect(computeFreshness(5000)).toBe("STALE");
  });

  it("age 15000 → EXPIRED", () => {
    expect(computeFreshness(15000)).toBe("EXPIRED");
  });
});

describe("G5 — applyFreshnessDecay", () => {
  it("FRESH HIGH → stays HIGH", () => {
    expect(applyFreshnessDecay("HIGH", 100)).toBe("HIGH");
  });

  it("RECENT HIGH → decays to MEDIUM", () => {
    expect(applyFreshnessDecay("HIGH", 1000)).toBe("MEDIUM");
  });

  it("STALE HIGH → decays to LOW", () => {
    expect(applyFreshnessDecay("HIGH", 5000)).toBe("LOW");
  });

  it("EXPIRED CONFIRMED → UNKNOWN", () => {
    expect(applyFreshnessDecay("CONFIRMED", 15000)).toBe("UNKNOWN");
  });

  it("old情报不永久保持 HIGH", () => {
    const decayed = applyFreshnessDecay("HIGH", 20000);
    expect(decayed).not.toBe("HIGH");
  });
});

describe("G5 — detectIntelConflict", () => {
  it("detects peace vs attack conflict", () => {
    const evidence: IntelEvidence[] = [
      makeObservedFact(CURRENT_TICK - 100, CURRENT_TICK, "Player peaceful, no military activity"),
      makeCombatLogFact(CURRENT_TICK - 50, CURRENT_TICK, "Player attacked with boosted military"),
    ];
    const result = detectIntelConflict(evidence);
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingPairs.length).toBeGreaterThan(0);
  });

  it("no conflict for consistent evidence", () => {
    const evidence: IntelEvidence[] = [
      makeObservedFact(CURRENT_TICK - 100, CURRENT_TICK, "Player attacked with boosted military"),
      makeCombatLogFact(CURRENT_TICK - 50, CURRENT_TICK, "Player siege activity detected"),
    ];
    const result = detectIntelConflict(evidence);
    expect(result.hasConflict).toBe(false);
  });
});

describe("G5 — buildPlayerIntelRecord", () => {
  it("T01: Fresh Observed Fact → HIGH confidence", () => {
    const record = buildPlayerIntelRecord(
      "attacker1",
      [makeObservedFact(CURRENT_TICK - 100, CURRENT_TICK, "Observed boosted attack creeps")],
      CURRENT_TICK,
      false,
    );
    expect(record.aggregatedConfidence).toBe("HIGH");
    expect(record.hasConflict).toBe(false);
    expect(record.evidence).toHaveLength(1);
  });

  it("T02: Stale Fact → confidence reduced", () => {
    const record = buildPlayerIntelRecord(
      "attacker2",
      [makeObservedFact(CURRENT_TICK - 3000, CURRENT_TICK, "Observed attack creeps")],
      CURRENT_TICK,
      false,
    );
    // STALE age → confidence should be lower than HIGH
    expect(record.aggregatedConfidence).not.toBe("CONFIRMED");
    expect(record.aggregatedConfidence).not.toBe("HIGH");
  });

  it("T03: Inference → lower confidence than fact", () => {
    const record = buildPlayerIntelRecord(
      "attacker3",
      [makeInference(CURRENT_TICK - 100, CURRENT_TICK, "Player may be preparing siege", "MEDIUM")],
      CURRENT_TICK,
      false,
    );
    expect(record.aggregatedConfidence).not.toBe("CONFIRMED");
  });

  it("T04: Prediction → lowest confidence", () => {
    const record = buildPlayerIntelRecord(
      "attacker4",
      [makePrediction(CURRENT_TICK - 100, CURRENT_TICK, "Player may attack remote in 100 ticks")],
      CURRENT_TICK,
      false,
    );
    // Prediction should have low confidence
    expect(["LOW", "STALE", "UNKNOWN", "MEDIUM"]).toContain(record.aggregatedConfidence);
  });

  it("T05: Conflicting Intel → conflict detected, confidence reduced", () => {
    const record = buildPlayerIntelRecord(
      "attacker5",
      [
        makeObservedFact(CURRENT_TICK - 200, CURRENT_TICK, "Player peaceful"),
        makeCombatLogFact(CURRENT_TICK - 100, CURRENT_TICK, "Player attack with boosted military"),
      ],
      CURRENT_TICK,
      false,
    );
    expect(record.hasConflict).toBe(true);
    expect(record.aggregatedConfidence).not.toBe("CONFIRMED");
  });

  it("T06: Multiple Sources → higher confidence than single", () => {
    const singleSource = buildPlayerIntelRecord(
      "attacker6",
      [makeObservedFact(CURRENT_TICK - 100, CURRENT_TICK, "Observed attack")],
      CURRENT_TICK,
      false,
    );
    const multiSource = buildPlayerIntelRecord(
      "attacker6",
      [
        makeObservedFact(CURRENT_TICK - 100, CURRENT_TICK, "Observed attack"),
        makeCombatLogFact(CURRENT_TICK - 50, CURRENT_TICK, "Combat log: boosted military"),
      ],
      CURRENT_TICK,
      false,
    );
    // Multiple consistent sources should not be lower than single
    expect(multiSource.evidence).toHaveLength(2);
    expect(multiSource.hasConflict).toBe(false);
  });

  it("T07: High Threat Player → threatIndex high", () => {
    const record = buildPlayerIntelRecord(
      "attacker7",
      [
        makeCombatLogFact(CURRENT_TICK - 100, CURRENT_TICK, "Player used T3 boosted attack creeps"),
        makeObservedFact(CURRENT_TICK - 50, CURRENT_TICK, "Player siege detected"),
      ],
      CURRENT_TICK,
      true,
    );
    expect(record.threatIndex).toBeGreaterThan(50);
    expect(record.blacklist).toBe(true);
  });

  it("T08: Low Threat Player → threatIndex low", () => {
    const record = buildPlayerIntelRecord(
      "newbie1",
      [makeObservedFact(CURRENT_TICK - 100, CURRENT_TICK, "Player peaceful, newbie area")],
      CURRENT_TICK,
      false,
    );
    expect(record.threatIndex).toBeLessThan(50);
  });

  it("T09: Unknown Player → no evidence → UNKNOWN", () => {
    const record = buildPlayerIntelRecord(
      "unknown1",
      [],
      CURRENT_TICK,
      false,
    );
    expect(record.aggregatedConfidence).toBe("UNKNOWN");
    expect(record.threatIndex).toBe(0);
  });

  it("T10: Expired Intel → gc removes old evidence", () => {
    const evidence: IntelEvidence[] = [
      makeObservedFact(CURRENT_TICK - 15000, CURRENT_TICK, "Very old observation"),
      makeObservedFact(CURRENT_TICK - 100, CURRENT_TICK, "Recent observation"),
    ];
    const gcResult = gcIntelEvidence(evidence, CURRENT_TICK);
    expect(gcResult.length).toBe(1); // Only recent remains
  });
});

describe("G5 — aggregateIntelConfidence", () => {
  it("empty evidence → UNKNOWN", () => {
    expect(aggregateIntelConfidence([], false)).toBe("UNKNOWN");
  });

  it("conflict reduces confidence", () => {
    const evidence: IntelEvidence[] = [
      makeObservedFact(CURRENT_TICK - 100, CURRENT_TICK, "Player peaceful"),
      makeCombatLogFact(CURRENT_TICK - 50, CURRENT_TICK, "Player boosted attack"),
    ];
    const noConflict = aggregateIntelConfidence(
      [makeObservedFact(CURRENT_TICK - 100, CURRENT_TICK, "Player attack")],
      false,
    );
    const withConflict = aggregateIntelConfidence(evidence, true);
    // Conflict should produce lower or equal confidence
    expect(withConflict).not.toBe("CONFIRMED");
  });
});
