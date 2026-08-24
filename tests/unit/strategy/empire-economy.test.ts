/**
 * Empire Economy 链路单测 — A2B-006..A2B-012。
 *
 * 合同锚点：
 *   A2B-006 Empire Economic Health（economic-health.ts）
 *   A2B-007 Expansion Readiness（readiness.ts）
 *   A2B-008 Reserve Protection（budget.ts）
 *   A2B-009 Request Scope（request-pool.ts scope 字段 + imbalance.ts candidatesToEmpireRequests）
 *   A2B-010 Empire Request Routing（imbalance.ts detectImbalance）
 *   A2B-011 Capacity Calculation（capacity-profile.ts，已有测试补充）
 *   A2B-012 Economic Trend（safety-margin.ts）
 *
 * 加上 Multi-Room Simulation Scenario（A2B-S1）和
 * Expansion Readiness Scenario A–E（A2B-S2）。
 */
import { describe, it, expect } from "vitest";
import {
  evaluateEconomicHealth,
  DEFAULT_HEALTH_OPTIONS,
  type EmpireEconomicHealth,
} from "../../../src/domain/strategy/economic-health";
import {
  detectImbalance,
  computeSurplus,
  computeDeficit,
  candidatesToEmpireRequests,
} from "../../../src/domain/strategy/imbalance";
import {
  allocateEmpireBudget,
  DEFAULT_BUDGET_OPTIONS,
} from "../../../src/domain/strategy/budget";
import {
  evaluateExpansionReadiness,
  DEFAULT_READINESS_OPTIONS,
} from "../../../src/domain/strategy/readiness";
import {
  evaluateSafetyMargin,
  DEFAULT_SAFETY_MARGIN_OPTIONS,
} from "../../../src/domain/strategy/safety-margin";
import {
  buildEmpirePlannerInput,
  formatEmpireSummary,
} from "../../../src/domain/strategy/planner-input";
import { buildEmpireResourceView } from "../../../src/domain/strategy/resource-view";
import type { RoomEconomicProfile } from "../../../src/domain/economy/room-profile";
import type { RoomCapacityProfile } from "../../../src/domain/economy/capacity-profile";
import type { EmpireResourceView } from "../../../src/domain/strategy/resource-view";

// ─── 辅助构造器 ─────────────────────────────────────────────

function makeProfile(over?: Partial<RoomEconomicProfile>): RoomEconomicProfile {
  return {
    roomName: "W7N4",
    rcl: 7, hasSpawn: true, hasStorage: true, hasTerminal: true,
    netFlow: 5, contractReserve: 50000, riskBuffer: 1000,
    estimatedIncome: 14, efficiency: 0.7, drift: 0, economyTick: 1000,
    storageEnergy: 50000, storageCapacity: 1_000_000, storageRatio: 0.5,
    energyAvailable: 500, energyCapacityAvailable: 1000,
    storageNearFull: false, sourceCount: 2,
    colonyPhase: "growth", colonyState: "normal",
    economyPressure: 0.1, lastHostileAt: undefined, hasLiveThreat: false,
    controllerDowngradeRisk: false, claimSecure: false,
    economicClass: "core", netFlowPositive: true,
    selfSufficiency: 0.64, isStruggling: false,
    ...over,
  };
}

function makeCapacityProfile(over?: Partial<RoomCapacityProfile>): RoomCapacityProfile {
  return {
    roomName: "W7N4",
    sourceCount: 2,
    nominalCapacity: 20,
    efficiency: 0.7,
    effectiveCapacity: 14,
    utilization: 0.7,
    storageCapacity: 1_000_000,
    terminalCapacity: 30000,
    linkCapacity: 2000,
    totalReserveCapacity: 1_032_000,
    reserveUtilization: 0.048,
    spawnCapacity: 1000,
    spawnUtilization: 0.5,
    spawnCount: 1,
    haulerCount: 3,
    referenceCarry: 300,
    logisticsThroughput: 18,
    builderCount: 2,
    constructionThroughput: 100,
    bottleneck: "none",
    ...over,
  };
}

function makeView(over?: Partial<EmpireResourceView>): EmpireResourceView {
  return {
    tick: 1000,
    roomCount: 1,
    totalEnergy: 50000,
    totalProduction: 14,
    totalNetFlow: 5,
    totalReserve: 50000,
    minRiskBuffer: 1000,
    avgEfficiency: 0.7,
    coreRooms: 1,
    productionRooms: 0,
    candidateRooms: 0,
    strugglingRooms: 0,
    surplusRooms: [],
    deficitRooms: [],
    hasImbalance: false,
    hasStruggling: false,
    maxPressure: 0.1,
    hasLiveThreat: false,
    empireNetFlowPositive: true,
    empireSelfSufficiency: 0.64,
    ...over,
  };
}

// ─── A2B-006: Empire Economic Health ─────────────────────

describe("A2B-006: Empire Economic Health", () => {
  it("无房间 → critical", () => {
    const view = makeView({ roomCount: 0, totalEnergy: 0, totalProduction: 0 });
    const r = evaluateEconomicHealth(view);
    expect(r.health).toBe("critical");
  });

  it("有困难房 → critical", () => {
    const view = makeView({ hasStruggling: true, strugglingRooms: 1 });
    const r = evaluateEconomicHealth(view);
    expect(r.health).toBe("critical");
  });

  it("净流为负 + riskBuffer < 200 → critical", () => {
    const view = makeView({ totalNetFlow: -5, minRiskBuffer: 100, hasStruggling: false });
    const r = evaluateEconomicHealth(view);
    expect(r.health).toBe("critical");
  });

  it("净流为负 + 无困难房 → deficit", () => {
    const view = makeView({ totalNetFlow: -3, minRiskBuffer: 500, hasStruggling: false });
    const r = evaluateEconomicHealth(view);
    expect(r.health).toBe("deficit");
  });

  it("净流 ≥ 0 + riskBuffer 不足 → stable", () => {
    const view = makeView({ totalNetFlow: 2, minRiskBuffer: 300, coreRooms: 1, empireSelfSufficiency: 0.4 });
    const r = evaluateEconomicHealth(view);
    expect(r.health).toBe("stable");
  });

  it("净流 > 0 + core≥1 + 自给度达标 → growing", () => {
    const view = makeView({ totalNetFlow: 5, minRiskBuffer: 600, coreRooms: 1, empireSelfSufficiency: 0.6 });
    const r = evaluateEconomicHealth(view);
    expect(r.health).toBe("growing");
  });

  it("净流 > 0 + core≥2 + 自给度高 + riskBuffer≥1000 → healthy", () => {
    const view = makeView({ totalNetFlow: 10, minRiskBuffer: 1200, coreRooms: 2, empireSelfSufficiency: 0.75 });
    const r = evaluateEconomicHealth(view);
    expect(r.health).toBe("healthy");
  });

  it("growing 但不满足 healthy 条件 → growing（不升级）", () => {
    const view = makeView({ totalNetFlow: 5, minRiskBuffer: 700, coreRooms: 1, empireSelfSufficiency: 0.6 });
    const r = evaluateEconomicHealth(view);
    expect(r.health).toBe("growing");
  });

  it("evidence 字段非空", () => {
    const r = evaluateEconomicHealth(makeView());
    expect(r.evidence.length).toBeGreaterThan(0);
  });
});

// ─── A2B-007: Expansion Readiness ───────────────────────

describe("A2B-007: Expansion Readiness", () => {
  function makeBudget(over?: Partial<ReturnType<typeof allocateEmpireBudget>>) {
    const base = allocateEmpireBudget(makeView(), "growing", 1000);
    return { ...base, ...over };
  }

  it("全部门控通过 → READY", () => {
    const view = makeView({ totalNetFlow: 10, coreRooms: 1, hasStruggling: false, hasLiveThreat: false });
    const budget = makeBudget({ expansion: 5000 });
    const r = evaluateExpansionReadiness(view, "growing", budget, "comfortable", true);
    expect(r.readiness).toBe("READY");
    expect(r.gates.filter(g => g.passed).length).toBeGreaterThanOrEqual(7);
  });

  it("全部门控通过 + 强力条件 → STRONGLY_READY", () => {
    const view = makeView({ totalNetFlow: 20, coreRooms: 2, hasStruggling: false, hasLiveThreat: false });
    const budget = makeBudget({ expansion: 5000 });
    const r = evaluateExpansionReadiness(view, "healthy", budget, "abundant", true);
    expect(r.readiness).toBe("STRONGLY_READY");
  });

  it("有活威胁 → NOT_READY", () => {
    const view = makeView({ hasLiveThreat: true });
    const budget = makeBudget();
    const r = evaluateExpansionReadiness(view, "growing", budget, "comfortable", true);
    expect(r.readiness).toBe("NOT_READY");
    expect(r.evidence).toContain("G1");
  });

  it("有困难房 → NOT_READY", () => {
    const view = makeView({ hasStruggling: true, strugglingRooms: 1 });
    const budget = makeBudget();
    const r = evaluateExpansionReadiness(view, "growing", budget, "comfortable", true);
    expect(r.readiness).toBe("NOT_READY");
    expect(r.evidence).toContain("G2");
  });

  it("posture 不允许 → NOT_READY", () => {
    const view = makeView();
    const budget = makeBudget();
    const r = evaluateExpansionReadiness(view, "growing", budget, "comfortable", false);
    expect(r.readiness).toBe("NOT_READY");
    expect(r.evidence).toContain("G0");
  });

  it("净流不足 → NOT_READY", () => {
    const view = makeView({ totalNetFlow: 1 });
    const budget = makeBudget();
    const r = evaluateExpansionReadiness(view, "growing", budget, "comfortable", true);
    expect(r.readiness).toBe("NOT_READY");
    expect(r.evidence).toContain("G4");
  });

  it("CPU tier constrained → NOT_READY", () => {
    const view = makeView();
    const budget = makeBudget();
    const r = evaluateExpansionReadiness(view, "growing", budget, "constrained", true);
    expect(r.readiness).toBe("NOT_READY");
    expect(r.evidence).toContain("G6");
  });

  it("扩张预算不足 → NOT_READY", () => {
    const view = makeView();
    const budget = makeBudget({ expansion: 100 });
    const r = evaluateExpansionReadiness(view, "growing", budget, "comfortable", true);
    expect(r.readiness).toBe("NOT_READY");
    expect(r.evidence).toContain("G7");
  });
});

// ─── A2B-008: Reserve Protection ─────────────────────────

describe("A2B-008: Reserve Protection (Empire Budget)", () => {
  it("正常健康下 reserve = totalEnergy × (emergency + core)", () => {
    const view = makeView({ totalEnergy: 10000 });
    const budget = allocateEmpireBudget(view, "growing", 1000);
    const expectedReserve = Math.floor(10000 * (0.2 + 0.1));
    expect(budget.reserve).toBe(expectedReserve);
    expect(budget.reserveRatio).toBeCloseTo(0.3, 2);
  });

  it("critical 下 reserve = totalEnergy × emergency only", () => {
    const view = makeView({ totalEnergy: 10000, hasStruggling: true, strugglingRooms: 1 });
    const budget = allocateEmpireBudget(view, "critical", 1000);
    expect(budget.reserve).toBe(Math.floor(10000 * 0.2));
    expect(budget.reserveRatio).toBeCloseTo(0.2, 2);
  });

  it("有困难房时 survival > 0", () => {
    const view = makeView({ totalEnergy: 10000, hasStruggling: true, strugglingRooms: 1 });
    const budget = allocateEmpireBudget(view, "critical", 1000);
    expect(budget.survival).toBeGreaterThan(0);
  });

  it("无困难房时 survival = 0", () => {
    const view = makeView({ totalEnergy: 10000, hasStruggling: false });
    const budget = allocateEmpireBudget(view, "growing", 1000);
    expect(budget.survival).toBe(0);
  });

  it("critical 下 expansion = 0（不扩张）", () => {
    const view = makeView({ totalEnergy: 10000, hasStruggling: true, strugglingRooms: 1 });
    const budget = allocateEmpireBudget(view, "critical", 1000);
    expect(budget.expansion).toBe(0);
  });

  it("growing 下 expansion > 0", () => {
    const view = makeView({ totalEnergy: 10000 });
    const budget = allocateEmpireBudget(view, "growing", 1000);
    expect(budget.expansion).toBeGreaterThan(0);
  });

  it("各预算域之和 ≤ totalEnergy", () => {
    const view = makeView({ totalEnergy: 10000 });
    const budget = allocateEmpireBudget(view, "growing", 1000);
    const sum = budget.reserve + budget.survival + budget.production + budget.infrastructure + budget.expansion + budget.free;
    expect(sum).toBeLessThanOrEqual(10000);
  });
});

// ─── A2B-009 + A2B-010: Imbalance + Request Scope ────────

describe("A2B-009/010: Resource Imbalance Detection + Request Scope", () => {
  it("单房无 imbalance", () => {
    const profiles = [makeProfile()];
    const view = buildEmpireResourceView(profiles, 1000);
    const r = detectImbalance(profiles, view, 1000);
    expect(r.hasImbalance).toBe(false);
    expect(r.candidates).toHaveLength(0);
  });

  it("surplus 房 + deficit 房 → 有 imbalance + 候选", () => {
    const surplusRoom = makeProfile({
      roomName: "W7N4", storageEnergy: 80000, storageRatio: 0.8,
      netFlow: 10, netFlowPositive: true, estimatedIncome: 14,
    });
    const deficitRoom = makeProfile({
      roomName: "W8N3", storageEnergy: 100, storageRatio: 0.01,
      netFlow: -5, netFlowPositive: false, estimatedIncome: 3, riskBuffer: 100,
      isStruggling: false, colonyState: "normal",
      economicClass: "production",
    });
    const profiles = [surplusRoom, deficitRoom];
    const view = buildEmpireResourceView(profiles, 1000);
    const r = detectImbalance(profiles, view, 1000);
    expect(r.hasImbalance).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates[0]!.fromRoom).toBe("W7N4");
    expect(r.candidates[0]!.toRoom).toBe("W8N3");
    expect(r.candidates[0]!.amount).toBeGreaterThan(0);
  });

  it("困难房 deficit = true（needsEnergyAid）", () => {
    const struggling = makeProfile({
      roomName: "W9N2", isStruggling: true, colonyState: "recovery",
      economicClass: "struggling",
    });
    expect(computeDeficit(struggling)).toBeGreaterThan(0);
  });

  it("正常房 surplus = storageEnergy × 0.3", () => {
    const p = makeProfile({ storageEnergy: 100000, storageRatio: 0.5, netFlow: 10, netFlowPositive: true });
    expect(computeSurplus(p, 0.3)).toBe(30000);
  });

  it("困难房 surplus = 0（canExportEnergy false）", () => {
    const p = makeProfile({ isStruggling: true, colonyState: "recovery" });
    expect(computeSurplus(p)).toBe(0);
  });

  it("candidatesToEmpireRequests 生成带 scope=empire 的请求", () => {
    const surplusRoom = makeProfile({
      roomName: "W7N4", storageEnergy: 80000, storageRatio: 0.8,
      netFlow: 10, netFlowPositive: true, estimatedIncome: 14,
    });
    const deficitRoom = makeProfile({
      roomName: "W8N3", storageEnergy: 100, storageRatio: 0.01,
      netFlow: -5, netFlowPositive: false, estimatedIncome: 3, riskBuffer: 100,
      isStruggling: false, colonyState: "normal", economicClass: "production",
    });
    const profiles = [surplusRoom, deficitRoom];
    const view = buildEmpireResourceView(profiles, 1000);
    const r = detectImbalance(profiles, view, 1000);
    const reqs = candidatesToEmpireRequests(r.candidates);
    expect(reqs.length).toBe(r.candidates.length);
    expect(reqs[0]!.scope).toBe("empire");
    expect(reqs[0]!.targetRoom).toBe("W8N3");
    expect(reqs[0]!.resource).toBe("energy");
    expect(reqs[0]!.priority).toBe(1);
  });

  it("不自己给自己调拨", () => {
    const surplusRoom = makeProfile({
      roomName: "W7N4", storageEnergy: 80000, storageRatio: 0.8,
      netFlow: 10, netFlowPositive: true,
    });
    // 只有一个 surplus 房，无 deficit 房 → 无候选
    const profiles = [surplusRoom];
    const view = buildEmpireResourceView(profiles, 1000);
    const r = detectImbalance(profiles, view, 1000);
    expect(r.candidates).toHaveLength(0);
  });
});

// ─── A2B-012: Economic Trend (Safety Margin) ────────────

describe("A2B-012: Economic Trend / Safety Margin", () => {
  it("正常健康 → score > 0.5", () => {
    const view = makeView({
      totalNetFlow: 10, minRiskBuffer: 1000, hasStruggling: false, hasLiveThreat: false,
      empireSelfSufficiency: 0.7, strugglingRooms: 0, roomCount: 1,
    });
    const r = evaluateSafetyMargin(view, "growing");
    expect(r.score).toBeGreaterThan(0.5);
  });

  it("净流为负 → productionSafety = 0", () => {
    const view = makeView({ totalNetFlow: -5 });
    const r = evaluateSafetyMargin(view, "deficit");
    expect(r.productionSafety).toBe(0);
  });

  it("有困难房 → healthSafety = 0", () => {
    const view = makeView({ hasStruggling: true });
    const r = evaluateSafetyMargin(view, "critical");
    expect(r.healthSafety).toBe(0);
  });

  it("有活威胁 → healthSafety = 0.3", () => {
    const view = makeView({ hasLiveThreat: true, hasStruggling: false });
    const r = evaluateSafetyMargin(view, "stable");
    expect(r.healthSafety).toBeCloseTo(0.3, 1);
  });

  it("riskBuffer 低于 passMark → reserveSafety = 0", () => {
    const view = makeView({ minRiskBuffer: 100 });
    const r = evaluateSafetyMargin(view, "stable");
    expect(r.reserveSafety).toBe(0);
  });

  it("所有维度满分 → score = 1", () => {
    const view = makeView({
      totalNetFlow: 20, minRiskBuffer: 2000, hasStruggling: false, hasLiveThreat: false,
      empireSelfSufficiency: 0.9, strugglingRooms: 0, roomCount: 2,
    });
    const r = evaluateSafetyMargin(view, "healthy");
    expect(r.score).toBeCloseTo(1, 1);
  });

  it("库存高但产能低 → 低分（防假富裕）", () => {
    const view = makeView({
      totalEnergy: 100000, totalNetFlow: -2, minRiskBuffer: 500,
      hasStruggling: false, hasLiveThreat: false,
      empireSelfSufficiency: 0.3, strugglingRooms: 0, roomCount: 1,
    });
    const r = evaluateSafetyMargin(view, "deficit");
    expect(r.score).toBeLessThan(0.5);
  });
});

// ─── A2B-S1: Multi-Room Simulation ──────────────────────

describe("A2B-S1: Multi-Room Simulation (3 rooms)", () => {
  it("3 房帝国：core + production + deficit → 正确聚合", () => {
    const roomA = makeProfile({
      roomName: "RoomA", storageEnergy: 50000, storageRatio: 0.5,
      netFlow: 10, estimatedIncome: 14, economicClass: "core",
    });
    const roomB = makeProfile({
      roomName: "RoomB", storageEnergy: 30000, storageRatio: 0.3,
      netFlow: 8, estimatedIncome: 12, economicClass: "production",
      rcl: 5,
    });
    const roomC = makeProfile({
      roomName: "RoomC", storageEnergy: 100, storageRatio: 0.01,
      netFlow: -5, estimatedIncome: 3, riskBuffer: 100,
      netFlowPositive: false, economicClass: "production",
      isStruggling: false, colonyState: "normal", rcl: 4,
    });

    const profiles = [roomA, roomB, roomC];
    const view = buildEmpireResourceView(profiles, 1000);

    expect(view.roomCount).toBe(3);
    expect(view.totalEnergy).toBe(80100);
    expect(view.totalProduction).toBe(29);
    expect(view.totalNetFlow).toBe(13);
    expect(view.coreRooms).toBe(1);
    expect(view.productionRooms).toBe(2);
    expect(view.hasImbalance).toBe(true);
    expect(view.surplusRooms.length).toBeGreaterThan(0);
    expect(view.deficitRooms).toContain("RoomC");
  });

  it("Empire Planner Input 完整链路", () => {
    const roomA = makeProfile({ roomName: "RoomA", netFlow: 10, storageEnergy: 50000 });
    const roomB = makeProfile({ roomName: "RoomB", netFlow: 5, storageEnergy: 30000, rcl: 5, economicClass: "production" });

    const profiles = [roomA, roomB];
    const capProfiles = [makeCapacityProfile({ roomName: "RoomA" }), makeCapacityProfile({ roomName: "RoomB" })];

    const view = buildEmpireResourceView(profiles, 1000);
    const health = evaluateEconomicHealth(view);
    const imbalance = detectImbalance(profiles, view, 1000);
    const budget = allocateEmpireBudget(view, health.health, 1000);
    const readiness = evaluateExpansionReadiness(view, health.health, budget, "comfortable", true);
    const safety = evaluateSafetyMargin(view, health.health);

    const plannerInput = buildEmpirePlannerInput(
      1000, profiles, capProfiles, view, health, imbalance, budget, readiness, safety,
    );

    expect(plannerInput.tick).toBe(1000);
    expect(plannerInput.profiles).toHaveLength(2);
    expect(plannerInput.capacityProfiles).toHaveLength(2);
    expect(plannerInput.resourceView.roomCount).toBe(2);
    expect(plannerInput.health.health).toBeDefined();
    expect(plannerInput.budget.totalEnergy).toBe(80000);
    expect(plannerInput.readiness.readiness).toBeDefined();
    expect(plannerInput.safetyMargin.score).toBeGreaterThanOrEqual(0);
    expect(plannerInput.summary).toContain("Empire");
    expect(plannerInput.summary).toContain("Rooms: 2");
    expect(plannerInput.summary).toContain("Net:");
  });
});

// ─── A2B-S2: Expansion Readiness Scenarios A–E ──────────

describe("A2B-S2: Expansion Readiness Scenarios", () => {
  function makeBudget(over?: Partial<ReturnType<typeof allocateEmpireBudget>>) {
    const base = allocateEmpireBudget(makeView(), "growing", 1000);
    return { ...base, ...over };
  }

  it("Scenario A: Empire Healthy → STRONGLY_READY", () => {
    const view = makeView({
      totalNetFlow: 20, coreRooms: 2, minRiskBuffer: 1500,
      hasStruggling: false, hasLiveThreat: false, empireSelfSufficiency: 0.8,
    });
    const budget = makeBudget({ expansion: 5000 });
    const r = evaluateExpansionReadiness(view, "healthy", budget, "abundant", true);
    expect(r.readiness).toBe("STRONGLY_READY");
  });

  it("Scenario B: Core Room Energy Deficit → NOT_READY", () => {
    const view = makeView({ totalNetFlow: -3, hasStruggling: false });
    const budget = makeBudget();
    const r = evaluateExpansionReadiness(view, "deficit", budget, "comfortable", false);
    expect(r.readiness).toBe("NOT_READY");
  });

  it("Scenario C: Storage High 但 Production Low → 不应 STRONGLY_READY", () => {
    const view = makeView({
      totalEnergy: 100000, totalNetFlow: 2, minRiskBuffer: 1500,
      coreRooms: 2, empireSelfSufficiency: 0.3,
    });
    const budget = makeBudget({ expansion: 5000 });
    // netFlow=2 < stronglyMinNetFlow=15 → 不 STRONGLY_READY
    const r = evaluateExpansionReadiness(view, "stable", budget, "abundant", true);
    expect(r.readiness).not.toBe("STRONGLY_READY");
  });

  it("Scenario D: 有困难房 → NOT_READY（降级）", () => {
    const view = makeView({ hasStruggling: true, strugglingRooms: 1 });
    const budget = makeBudget();
    const r = evaluateExpansionReadiness(view, "critical", budget, "comfortable", true);
    expect(r.readiness).toBe("NOT_READY");
    expect(r.evidence).toContain("G2");
  });

  it("Scenario E: Core Room 处于 Recovery → 禁止扩张", () => {
    const view = makeView({
      hasStruggling: true, strugglingRooms: 1,
      totalNetFlow: -2, hasLiveThreat: false,
    });
    const budget = makeBudget();
    const r = evaluateExpansionReadiness(view, "critical", budget, "comfortable", true);
    expect(r.readiness).toBe("NOT_READY");
  });
});

// ─── A2B-011: Empire Resource View 聚合一致性 ──────────

describe("A2B-011: Empire Resource View Aggregation", () => {
  it("空数组安全（无房间）", () => {
    const view = buildEmpireResourceView([], 1000);
    expect(view.roomCount).toBe(0);
    expect(view.totalEnergy).toBe(0);
    expect(view.totalProduction).toBe(0);
    expect(view.totalNetFlow).toBe(0);
  });

  it("5 房聚合：各指标正确", () => {
    const profiles: RoomEconomicProfile[] = [
      makeProfile({ roomName: "A", storageEnergy: 10000, netFlow: 5, estimatedIncome: 14, economicClass: "core" }),
      makeProfile({ roomName: "B", storageEnergy: 20000, netFlow: 3, estimatedIncome: 12, economicClass: "core", rcl: 8 }),
      makeProfile({ roomName: "C", storageEnergy: 5000, netFlow: -2, estimatedIncome: 8, economicClass: "production", rcl: 5 }),
      makeProfile({ roomName: "D", storageEnergy: 500, netFlow: -1, estimatedIncome: 2, economicClass: "candidate", rcl: 3, hasStorage: false, storageRatio: 0, storageCapacity: 0 }),
      makeProfile({ roomName: "E", storageEnergy: 1000, netFlow: -3, estimatedIncome: 0, economicClass: "struggling", colonyState: "recovery", isStruggling: true }),
    ];
    const view = buildEmpireResourceView(profiles, 1000);
    expect(view.roomCount).toBe(5);
    expect(view.totalEnergy).toBe(36500);
    expect(view.totalProduction).toBe(36);
    expect(view.totalNetFlow).toBe(2);
    expect(view.coreRooms).toBe(2);
    expect(view.productionRooms).toBe(1);
    expect(view.candidateRooms).toBe(1);
    expect(view.strugglingRooms).toBe(1);
    expect(view.hasStruggling).toBe(true);
    expect(view.empireNetFlowPositive).toBe(true);
  });
});
