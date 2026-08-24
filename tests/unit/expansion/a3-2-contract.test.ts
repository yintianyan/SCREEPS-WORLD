/**
 * A3.2 Contract Tests — Expansion Intelligence 全链路合约测试。
 *
 * 覆盖：Pressure / Candidate / Discovery / Scoring / Ranking / Cost / Payback /
 * Risk / Budget / Plan / Lifecycle / Explanation / Dashboard / Readiness Extended。
 *
 * 纯函数测试 — 不需要 Game/Memory mock。
 */

import { describe, it, expect } from "vitest";
import {
  evaluateExpansionPressure,
  DEFAULT_PRESSURE_OPTIONS,
  type ExpansionPressureResult,
} from "../../../src/domain/expansion/pressure";
import {
  buildCandidate,
  isEvaluable,
  isQualified,
  type ExpansionCandidateV2,
} from "../../../src/domain/expansion/candidate";
import type { RoomIntel } from "../../../src/domain/intel";
import { discoverCandidates, getEvaluableCandidates } from "../../../src/domain/expansion/discovery";
import { scoreCandidate, scoreCandidates } from "../../../src/domain/expansion/scoring";
import { rankCandidates, getTopCandidate } from "../../../src/domain/expansion/ranking";
import { estimateExpansionCost, DEFAULT_COST_OPTIONS } from "../../../src/domain/expansion/cost-model";
import { evaluatePayback } from "../../../src/domain/expansion/payback";
import { evaluateRisk, DEFAULT_RISK_OPTIONS } from "../../../src/domain/expansion/risk";
import { computeTieredBudget, isWithinBudget, type TieredExpansionBudget } from "../../../src/domain/expansion/budget";
import { createPlan, derivePriority, updatePlanStatus, type ExpansionPlan } from "../../../src/domain/expansion/plan";
import {
  deduplicatePlans,
  prunePlans,
  getActivePlans,
  isRebuildBlocked,
  applyHysteresis,
  needsReevaluation,
  type PlanWithHysteresis,
} from "../../../src/domain/expansion/plan-lifecycle";
import { explainDecision, explainShort } from "../../../src/domain/expansion/explanation";
import { buildExpansionDashboard } from "../../../src/domain/expansion/dashboard";
import { evaluateExpansionReadinessExtended } from "../../../src/domain/strategy/readiness";
import type { EmpireResourceView } from "../../../src/domain/strategy/resource-view";
import type { EmpireBudget } from "../../../src/domain/strategy/budget";
import type { ExpansionReadinessResult } from "../../../src/domain/strategy/readiness";
import type { RoomCapacityProfile } from "../../../src/domain/economy/capacity-profile";

// ─── 测试辅助 ──────────────────────────────────────────

function makeIntel(over: Partial<RoomIntel> = {}): RoomIntel {
  return { kind: "normal", status: "normal", sources: 2, lastSeen: 1000, ...over };
}

function makeResourceView(over: Partial<EmpireResourceView> = {}): EmpireResourceView {
  return {
    tick: 1000, roomCount: 3, totalEnergy: 50000, totalProduction: 30, totalNetFlow: 15,
    totalReserve: 20000, minRiskBuffer: 500, avgEfficiency: 0.7, coreRooms: 2,
    productionRooms: 1, candidateRooms: 0, strugglingRooms: 0,
    surplusRooms: ["W1N1", "W2N1"], deficitRooms: [], hasImbalance: false,
    hasStruggling: false, maxPressure: 0.3, hasLiveThreat: false,
    empireNetFlowPositive: true, empireSelfSufficiency: 0.8, ...over,
  };
}

function makeBudget(over: Partial<EmpireBudget> = {}): EmpireBudget {
  return {
    tick: 1000, totalEnergy: 50000, reserve: 15000, survival: 0,
    production: 8000, infrastructure: 4000, expansion: 7500, free: 5000,
    reserveRatio: 0.3, expansionAvailableRatio: 0.25, ...over,
  };
}

function makeReadiness(over: Partial<ExpansionReadinessResult> = {}): ExpansionReadinessResult {
  return { readiness: "READY", evidence: "all gates passed", gates: [], ...over };
}

function makeCandidate(over: Partial<ExpansionCandidateV2> = {}): ExpansionCandidateV2 {
  return {
    roomName: "W5N5", sponsorRoom: "W1N1", kind: "normal", roomStatus: "normal",
    sourceCount: 2, mineral: "H",
    terrain: { exitCount: 3, sealedExitCount: 1, wallCount: 0 },
    controller: { hasOwner: false, isMine: false, isHostileReserved: false },
    pathCost: 100, lastSeen: 1000, distance: 1,
    neighborRooms: ["W4N5", "W6N5", "W5N4"],
    score: 0, status: "DISCOVERED", discoveredAt: 1000, ...over,
  };
}

function makeCapacityProfile(over: Partial<RoomCapacityProfile> = {}): RoomCapacityProfile {
  return {
    roomName: "W1N1", sourceCount: 2, nominalCapacity: 20, efficiency: 0.8,
    effectiveCapacity: 16, utilization: 0.8, storageCapacity: 300000,
    terminalCapacity: 100000, linkCapacity: 8000, totalReserveCapacity: 408000,
    reserveUtilization: 0.5, spawnCapacity: 300, spawnUtilization: 0.7,
    spawnCount: 1, haulerCount: 4, referenceCarry: 300, logisticsThroughput: 24,
    builderCount: 2, constructionThroughput: 100, bottleneck: "none", ...over,
  };
}

function makeTieredBudget(over: Partial<TieredExpansionBudget> = {}): TieredExpansionBudget {
  return {
    totalEnergy: 50000, emergencyReserve: 10000, coreReserve: 5000,
    operationalReserve: 12000, availableExpansion: 23000, tick: 1000,
    coreInvaded: false, evidence: "", ...over,
  };
}

function makeFullPlan(): ExpansionPlan {
  const c = makeCandidate({ score: 0.8, status: "QUALIFIED", sourceCount: 2, distance: 1 });
  const cost = estimateExpansionCost(c);
  const payback = evaluatePayback(c, cost);
  const risk = evaluateRisk(c, cost, 50000, 0, 10000);
  return createPlan({ candidate: c, reason: "resource", cost, payback, risk, tick: 1000 });
}

function makePressure(over: Partial<ExpansionPressureResult> = {}): ExpansionPressureResult {
  return {
    level: "HIGH", score: 0.7,
    dimensions: {
      productionCapacity: 0.8, storageSaturation: 0.8, spawnCapacity: 0.7,
      resourceDeficit: "none", growthOpportunity: 0.5, strategicPosition: 0,
      infrastructureSaturation: 0.3,
    },
    evidence: "", ...over,
  };
}

// ─── 1. Pressure ──────────────────────────────────────

describe("A3.2 Pressure", () => {
  it("LOW when no saturation", () => {
    const r = evaluateExpansionPressure({
      view: makeResourceView(), budget: makeBudget(),
      capacityProfiles: [makeCapacityProfile({ utilization: 0.3, reserveUtilization: 0.3, spawnUtilization: 0.3 })],
      gclLevel: 3, ownedRoomCount: 3, candidateCount: 0, hasAdversaryPressure: false,
    });
    expect(r.level).toBe("LOW");
  });

  it("HIGH when all saturated", () => {
    const r = evaluateExpansionPressure({
      view: makeResourceView({ deficitRooms: ["W1", "W2", "W3"], hasImbalance: true }),
      budget: makeBudget(),
      capacityProfiles: [makeCapacityProfile({ utilization: 0.95, reserveUtilization: 0.95, spawnUtilization: 0.95, bottleneck: "production" })],
      gclLevel: 5, ownedRoomCount: 3, candidateCount: 5, hasAdversaryPressure: true,
    });
    expect(r.level).toBe("HIGH");
  });

  it("evidence has all dimensions", () => {
    const r = evaluateExpansionPressure({
      view: makeResourceView(), budget: makeBudget(),
      capacityProfiles: [makeCapacityProfile()],
      gclLevel: 3, ownedRoomCount: 3, candidateCount: 0, hasAdversaryPressure: false,
    });
    expect(r.evidence).toContain("prod=");
    expect(r.evidence).toContain("storage=");
    expect(r.evidence).toContain("deficit=");
  });
});

// ─── 2. Candidate ─────────────────────────────────────

describe("A3.2 Candidate", () => {
  it("builds from 2-source intel", () => {
    const c = buildCandidate("W5N5", "W1N1", makeIntel({ sources: 2 }), ["W1N1"], 1000, "p1");
    expect(c.sourceCount).toBe(2);
    expect(c.status).toBe("DISCOVERED");
    expect(c.vetoReason).toBeUndefined();
  });

  it("rejects sk kind", () => {
    const c = buildCandidate("W5N5", "W1N1", makeIntel({ kind: "sk" }), ["W1N1"], 1000, "p1");
    expect(c.status).toBe("REJECTED");
    expect(c.vetoReason).toContain("kind=");
  });

  it("rejects hostile owner", () => {
    const c = buildCandidate("W5N5", "W1N1", makeIntel({ owner: "enemy" }), ["W1N1"], 1000, "p1");
    expect(c.status).toBe("REJECTED");
  });

  it("rejects towers", () => {
    const c = buildCandidate("W5N5", "W1N1", makeIntel({ towers: 3 }), ["W1N1"], 1000, "p1");
    expect(c.status).toBe("REJECTED");
  });

  it("UNKNOWN when no sources", () => {
    const c = buildCandidate("W5N5", "W1N1", makeIntel({ sources: undefined }), ["W1N1"], 1000, "p1");
    expect(c.status).toBe("UNKNOWN");
  });

  it("isEvaluable / isQualified", () => {
    expect(isEvaluable(makeCandidate({ status: "DISCOVERED", sourceCount: 2 }))).toBe(true);
    expect(isQualified(makeCandidate({ status: "QUALIFIED" }))).toBe(true);
  });
});

// ─── 3. Discovery ──────────────────────────────────────

describe("A3.2 Discovery", () => {
  it("discovers new candidates", () => {
    const r = discoverCandidates({
      ownedRoomNames: ["W1N1"],
      intelBySponsor: { "W1N1": { "W2N1": makeIntel({ sources: 2 }) } },
      tick: 1000,
    });
    expect(r.candidates.length).toBe(1);
    expect(r.newCount).toBe(1);
  });

  it("updates when intel fresher", () => {
    const existing = makeCandidate({ roomName: "W2N1", lastSeen: 500, discoveredAt: 400 });
    const r = discoverCandidates({
      ownedRoomNames: ["W1N1"],
      intelBySponsor: { "W1N1": { "W2N1": makeIntel({ sources: 2, lastSeen: 1000 }) } },
      tick: 1000, existingCandidates: [existing],
    });
    expect(r.updatedCount).toBe(1);
    expect(r.candidates[0]?.lastSeen).toBe(1000);
    expect(r.candidates[0]?.discoveredAt).toBe(400);
  });
});

// ─── 4. Scoring ────────────────────────────────────────

describe("A3.2 Scoring", () => {
  it("2-source > 1-source", () => {
    const r2 = scoreCandidate({ candidate: makeCandidate({ sourceCount: 2 }) });
    const r1 = scoreCandidate({ candidate: makeCandidate({ sourceCount: 1 }) });
    expect(r2.breakdown.total).toBeGreaterThan(r1.breakdown.total);
  });

  it("closer distance scores higher", () => {
    const r1 = scoreCandidate({ candidate: makeCandidate({ distance: 1 }) });
    const r3 = scoreCandidate({ candidate: makeCandidate({ distance: 3 }) });
    expect(r1.breakdown.distanceScore).toBeGreaterThan(r3.breakdown.distanceScore);
  });

  it("rival reduces score", () => {
    const c = makeCandidate({ neighborRooms: ["W4N5"] });
    const rSafe = scoreCandidate({ candidate: c, rivalRooms: new Set(["W9N9"]) });
    const rRival = scoreCandidate({ candidate: c, rivalRooms: new Set(["W4N5"]) });
    expect(rRival.breakdown.total).toBeLessThan(rSafe.breakdown.total);
  });

  it("batch scoring", () => {
    const scored = scoreCandidates([
      makeCandidate({ roomName: "A", sourceCount: 2 }),
      makeCandidate({ roomName: "B", sourceCount: 1 }),
    ], {}, 1000);
    expect(scored.length).toBe(2);
    expect(scored[0]?.score).toBeGreaterThan(0);
  });
});

// ─── 5. Ranking ────────────────────────────────────────

describe("A3.2 Ranking", () => {
  it("sorts by score descending", () => {
    const ranked = rankCandidates([
      makeCandidate({ roomName: "A", score: 0.8, status: "QUALIFIED" }),
      makeCandidate({ roomName: "B", score: 0.9, status: "QUALIFIED" }),
    ], 1000);
    expect(ranked[0]?.candidate.roomName).toBe("B");
    expect(ranked[1]?.candidate.roomName).toBe("A");
  });

  it("filters non-QUALIFIED", () => {
    const ranked = rankCandidates([
      makeCandidate({ score: 0.8, status: "QUALIFIED" }),
      makeCandidate({ status: "REJECTED" }),
    ], 1000);
    expect(ranked.length).toBe(1);
  });

  it("getTopCandidate", () => {
    const top = getTopCandidate([makeCandidate({ score: 0.8, status: "QUALIFIED" })], 1000);
    expect(top).toBeDefined();
    expect(top?.rank).toBe(1);
  });
});

// ─── 6. Cost ───────────────────────────────────────────

describe("A3.2 Cost", () => {
  it("total > 0 with all components", () => {
    const c = makeCandidate({ distance: 1 });
    const cost = estimateExpansionCost(c);
    expect(cost.totalCost).toBeGreaterThan(0);
    expect(cost.claimerCost).toBe(DEFAULT_COST_OPTIONS.claimerBodyCost);
    expect(cost.spawnCost).toBe(DEFAULT_COST_OPTIONS.spawnEnergyCost);
  });

  it("farther = more expensive", () => {
    expect(estimateExpansionCost(makeCandidate({ distance: 3 })).totalCost)
      .toBeGreaterThan(estimateExpansionCost(makeCandidate({ distance: 1 })).totalCost);
  });
});

// ─── 7. Payback ────────────────────────────────────────

describe("A3.2 Payback", () => {
  it("2-source has finite payback", () => {
    const c = makeCandidate({ sourceCount: 2 });
    const pb = evaluatePayback(c, estimateExpansionCost(c));
    expect(pb.paybackTicks).toBeGreaterThan(0);
    expect(pb.paybackTicks).not.toBe(Infinity);
  });

  it("0-source = infinite payback", () => {
    const pb = evaluatePayback(makeCandidate({ sourceCount: 0 }), estimateExpansionCost(makeCandidate()));
    expect(pb.paybackTicks).toBe(Infinity);
  });

  it("2-source distance-1 is worthwhile", () => {
    const pb = evaluatePayback(makeCandidate({ sourceCount: 2, distance: 1 }), estimateExpansionCost(makeCandidate()));
    expect(pb.worthwhile).toBe(true);
  });
});

// ─── 8. Risk ──────────────────────────────────────────

describe("A3.2 Risk", () => {
  it("LOW for close safe candidate", () => {
    const r = evaluateRisk(makeCandidate({ distance: 1 }), estimateExpansionCost(makeCandidate()), 50000, 0, 10000);
    expect(r.level).toBe("LOW");
  });

  it("higher for far expensive", () => {
    const r = evaluateRisk(makeCandidate({ distance: 4 }), estimateExpansionCost(makeCandidate({ distance: 4 })), 10000, 5000, 10000);
    expect(r.score).toBeGreaterThan(0.3);
  });

  it("evidence has 5 dimensions", () => {
    const r = evaluateRisk(makeCandidate(), estimateExpansionCost(makeCandidate()), 50000, 0, 10000);
    expect(r.evidence).toContain("economic=");
    expect(r.evidence).toContain("dist=");
    expect(r.evidence).toContain("defense=");
  });
});

// ─── 9. Tiered Budget ──────────────────────────────────

describe("A3.2 Tiered Budget", () => {
  it("available = total - emergency - core - operational", () => {
    const t = computeTieredBudget(makeBudget());
    expect(t.emergencyReserve).toBe(10000);
    expect(t.coreReserve).toBe(5000);
    expect(t.operationalReserve).toBe(12000);
    expect(t.availableExpansion).toBeGreaterThan(0);
  });

  it("core invaded when reserves exceed total", () => {
    const t = computeTieredBudget(makeBudget({ totalEnergy: 1000, reserve: 200, survival: 0, production: 300, infrastructure: 200, expansion: 0, free: 0 }));
    // total=1000, emergency=200, core=100, operational=500 → available=200, but cap=expansion+free=0
    // available clamped to 0, coreInvaded=true because raw available < 0
    // Actually: 1000-200-100-500=200, cap=0, so available=min(200,0)=0
    // coreInvaded check: raw available (200) < 0? No. So need a case where it's truly negative.
    // Use totalEnergy=500: 500-100-50-500=-150 → coreInvaded=true
    const t2 = computeTieredBudget(makeBudget({ totalEnergy: 500, reserve: 150, survival: 0, production: 300, infrastructure: 200, expansion: 0, free: 0 }));
    expect(t2.coreInvaded).toBe(true);
    expect(t2.availableExpansion).toBe(0);
  });

  it("isWithinBudget", () => {
    const t = makeTieredBudget();
    expect(isWithinBudget(10000, t)).toBe(true);
    expect(isWithinBudget(30000, t)).toBe(false);
  });

  it("isWithinBudget false when core invaded", () => {
    expect(isWithinBudget(100, makeTieredBudget({ availableExpansion: 0, coreInvaded: true }))).toBe(false);
  });
});

// ─── 10. Plan ──────────────────────────────────────────

describe("A3.2 Plan", () => {
  it("creates from evaluation results", () => {
    const p = makeFullPlan();
    expect(p.planId).toContain("W5N5");
    expect(p.status).toBe("EVALUATED");
    expect(p.cancelConditions.length).toBeGreaterThan(0);
  });

  it("derivePriority P0 for high score+ROI, low risk", () => {
    expect(derivePriority(0.85, 2.5, 0.2)).toBe("P0");
  });

  it("derivePriority P3 for marginal", () => {
    expect(derivePriority(0.5, 1.0, 0.9)).toBe("P3");
  });

  it("updatePlanStatus preserves createdAt", () => {
    const p = updatePlanStatus(makeFullPlan(), "READY", 2000);
    expect(p.status).toBe("READY");
    expect(p.createdAt).toBe(1000);
    expect(p.updatedAt).toBe(2000);
  });
});

// ─── 11. Plan Lifecycle ───────────────────────────────

describe("A3.2 Plan Lifecycle", () => {
  it("deduplicate prevents duplicate roomName", () => {
    const r = deduplicatePlans([makeFullPlan()], makeFullPlan());
    expect(r.deduplicated).toBe(true);
    expect(r.plans.length).toBe(1);
  });

  it("prune removes old terminal", () => {
    const p = updatePlanStatus(makeFullPlan(), "CANCELLED", 1000);
    expect(prunePlans([p], 20000).length).toBe(0);
  });

  it("getActivePlans filters", () => {
    const p1 = makeFullPlan();
    const p2 = updatePlanStatus(makeFullPlan(), "CANCELLED", 1000);
    expect(getActivePlans([p1, p2]).length).toBe(1);
  });

  it("isRebuildBlocked within cooldown", () => {
    const p = updatePlanStatus(makeFullPlan(), "CANCELLED", 1000);
    expect(isRebuildBlocked([p], "W5N5", 5000)).toBe(true);
    expect(isRebuildBlocked([p], "W5N5", 15000)).toBe(false);
  });

  it("hysteresis upgrades EVALUATED→READY", () => {
    let s: PlanWithHysteresis = { plan: makeFullPlan(), hysteresis: { readyTicks: 0, notReadyTicks: 0, lastEvalTick: 1000 } };
    for (let t = 1001; t <= 1500; t++) s = applyHysteresis(s, true, t);
    expect(s.plan.status).toBe("READY");
  });

  it("hysteresis downgrades READY→EVALUATED", () => {
    let s: PlanWithHysteresis = { plan: updatePlanStatus(makeFullPlan(), "READY", 1000), hysteresis: { readyTicks: 500, notReadyTicks: 0, lastEvalTick: 1500 } };
    for (let t = 1501; t <= 1700; t++) s = applyHysteresis(s, false, t);
    expect(s.plan.status).toBe("EVALUATED");
  });

  it("needsReevaluation after interval", () => {
    const p = makeFullPlan();
    p.updatedAt = 1000;
    expect(needsReevaluation(p, 1500)).toBe(true);
    expect(needsReevaluation(p, 1400)).toBe(false);
  });
});

// ─── 12. Explanation ──────────────────────────────────

describe("A3.2 Explanation", () => {
  it("APPROVE when all conditions met", () => {
    const c = makeCandidate({ score: 0.8, sourceCount: 2, distance: 1 });
    const cost = estimateExpansionCost(c);
    const payback = evaluatePayback(c, cost);
    const risk = evaluateRisk(c, cost, 50000, 0, 10000);
    const plan = createPlan({ candidate: c, reason: "resource", cost, payback, risk, tick: 1000 });
    const e = explainDecision({
      plan, pressure: makePressure(),
      budget: makeTieredBudget({ availableExpansion: 100000 }),
      readiness: makeReadiness(), tick: 1000,
    });
    expect(e.outcome).toBe("APPROVE");
    expect(e.enablers.length).toBeGreaterThan(0);
    expect(e.blockers.length).toBe(0);
  });

  it("NOT_READY when readiness fails", () => {
    const e = explainDecision({
      plan: makeFullPlan(), pressure: makePressure(),
      budget: makeTieredBudget(), readiness: makeReadiness({ readiness: "NOT_READY" }), tick: 1000,
    });
    expect(e.outcome).toBe("NOT_READY");
    expect(e.blockers.length).toBeGreaterThan(0);
  });

  it("explainShort one-line", () => {
    const s = explainShort(makeFullPlan(), "APPROVE");
    expect(s).toContain("W5N5");
    expect(s).toContain("APPROVE");
  });
});

// ─── 13. Dashboard ────────────────────────────────────

describe("A3.2 Dashboard", () => {
  it("builds with all sections", () => {
    const d = buildExpansionDashboard({
      tick: 1000, pressure: makePressure({ level: "MEDIUM" }),
      readiness: makeReadiness(), budget: makeTieredBudget(),
      candidates: [
        makeCandidate({ roomName: "A", score: 0.8, status: "QUALIFIED" }),
        makeCandidate({ roomName: "B", status: "REJECTED" }),
      ],
      plans: [],
    });
    expect(d.tick).toBe(1000);
    expect(d.pressure.level).toBe("MEDIUM");
    expect(d.candidates.total).toBe(2);
    expect(d.candidates.qualified).toBe(1);
    expect(d.summary).toContain("Expansion Dashboard");
  });
});

// ─── 14. Readiness Extended ───────────────────────────

describe("A3.2 Readiness Extended (G12-G15)", () => {
  it("all pass when candidate + budget + risk + core ok", () => {
    const c = makeCandidate({ score: 0.8 });
    const cost = estimateExpansionCost(c);
    const risk = evaluateRisk(c, cost, 50000, 0, 10000);
    const r = evaluateExpansionReadinessExtended(c, cost, risk, makeTieredBudget({ availableExpansion: 100000 }));
    expect(r.allPassed).toBe(true);
    expect(r.gates.length).toBe(4);
  });

  it("G12 fails when no candidate", () => {
    const r = evaluateExpansionReadinessExtended(undefined, undefined, undefined, undefined);
    expect(r.allPassed).toBe(false);
    expect(r.gates[0]?.passed).toBe(false);
  });

  it("G13 fails when budget < cost", () => {
    const c = makeCandidate({ score: 0.8 });
    const cost = estimateExpansionCost(c);
    const risk = evaluateRisk(c, cost, 50000, 0, 10000);
    const r = evaluateExpansionReadinessExtended(c, cost, risk, makeTieredBudget({ availableExpansion: 100 }));
    expect(r.gates.find(g => g.name.includes("G13"))?.passed).toBe(false);
  });

  it("G15 fails when core invaded", () => {
    const c = makeCandidate({ score: 0.8 });
    const cost = estimateExpansionCost(c);
    const risk = evaluateRisk(c, cost, 50000, 0, 10000);
    const r = evaluateExpansionReadinessExtended(c, cost, risk, makeTieredBudget({ coreInvaded: true }));
    expect(r.gates.find(g => g.name.includes("G15"))?.passed).toBe(false);
  });
});
