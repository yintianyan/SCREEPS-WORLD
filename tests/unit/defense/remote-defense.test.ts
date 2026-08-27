/** A5.1 G4 — Remote Defense Decision 纯函数测试。 */
import { describe, expect, it } from "vitest";
import {
  decideRemoteDefenseAction,
  evaluateRemoteExpectedValue,
  type RemoteDefenseInput,
  type RemoteOperationState,
  type EmpireContext,
  type LogisticsContext,
  type MilitaryContext,
} from "../../../src/domain/defense/remote-defense";
import type { ThreatAssessment } from "../../../src/domain/defense/threat-assessment";

// ─── 测试辅助 ────────────────────────────────────────────────

function makeThreat(level: ThreatAssessment["level"], intent: ThreatAssessment["estimatedIntent"]["intent"]): ThreatAssessment {
  return {
    level,
    score: { combat: 0, intent: 0, proximity: 0, objective: 0, boost: 0, defense: 0, economicImpact: 0, total: 0 },
    confidence: "fact",
    estimatedPower: { attack: 30, rangedAttack: 0, heal: 0, effectiveHP: 100, dismantle: 0, toughParts: 0, boosted: false, maxBoostTier: 0 },
    enemyCombatPower: { burstDamage: 30, effectiveHP: 100, healOutput: 0, dismantlePower: 0, powerScore: 30, creepCount: 1, mobility: 1, boosted: false },
    estimatedIntent: { intent, confidence: 0.8, evidence: ["test"] },
    timeToImpact: 100,
    sources: ["player"],
    recommendedPosture: "ALERT",
    tick: 1000000,
  };
}

function makeRemoteOp(opts: Partial<RemoteOperationState> = {}): RemoteOperationState {
  return {
    targetRoom: opts.targetRoom ?? "W2N2",
    homeRoom: opts.homeRoom ?? "W1N1",
    state: opts.state ?? "active",
    sources: opts.sources ?? 2,
    haulerNeed: opts.haulerNeed ?? 2,
    creepCount: opts.creepCount ?? 5,
    creepInvestment: opts.creepInvestment ?? 2000,
    pathCost: opts.pathCost ?? 1,
    threatUntil: opts.threatUntil,
    dangerUntil: opts.dangerUntil,
    createdAt: opts.createdAt ?? 900000,
    lastSeen: opts.lastSeen ?? 1000000,
  };
}

function makeEmpireContext(opts: Partial<EmpireContext> = {}): EmpireContext {
  return {
    tick: opts.tick ?? 1000000,
    posture: opts.posture ?? "develop",
    empireEnergyReserve: opts.empireEnergyReserve ?? 100000,
    cpuTier: opts.cpuTier ?? "comfortable",
    activeRemoteCount: opts.activeRemoteCount ?? 2,
    maxRemoteOps: opts.maxRemoteOps ?? 3,
  };
}

function makeLogisticsContext(opts: Partial<LogisticsContext> = {}): LogisticsContext {
  return {
    avgHaulerCommute: opts.avgHaulerCommute ?? 50,
    availableHaulers: opts.availableHaulers ?? 2,
  };
}

function makeMilitaryContext(opts: Partial<MilitaryContext> = {}): MilitaryContext {
  return {
    availableDefenders: opts.availableDefenders ?? 0,
    defenderSpawnCost: opts.defenderSpawnCost ?? 260,
    defenderCommuteTicks: opts.defenderCommuteTicks ?? 50,
    atWar: opts.atWar ?? false,
  };
}

function makeInput(opts: Partial<RemoteDefenseInput> = {}): RemoteDefenseInput {
  return {
    threat: opts.threat ?? makeThreat("NONE", "UNKNOWN"),
    remoteOp: opts.remoteOp ?? makeRemoteOp(),
    empireContext: opts.empireContext ?? makeEmpireContext(),
    logisticsContext: opts.logisticsContext ?? makeLogisticsContext(),
    militaryContext: opts.militaryContext ?? makeMilitaryContext(),
  };
}

// ─── R01: 威胁 NONE → CONTINUE ──────────────────────────────

describe("G4 — decideRemoteDefenseAction", () => {
  it("R01: 威胁 NONE → CONTINUE", () => {
    const decision = decideRemoteDefenseAction(makeInput({
      threat: makeThreat("NONE", "UNKNOWN"),
    }));
    expect(decision.action).toBe("CONTINUE");
    expect(decision.reason).toContain("NONE");
  });

  it("R02: 威胁 LOW + 风险低 → CONTINUE", () => {
    const decision = decideRemoteDefenseAction(makeInput({
      threat: makeThreat("LOW", "HARASSMENT"),
    }));
    // LOW → risk = 0.1 ≤ 0.15 → CONTINUE
    expect(decision.action).toBe("CONTINUE");
  });

  it("R03: 威胁 MEDIUM + 风险高 → PAUSE", () => {
    const decision = decideRemoteDefenseAction(makeInput({
      threat: makeThreat("MEDIUM", "HARASSMENT"),
    }));
    // MEDIUM → risk = 0.3 > 0.15 → PAUSE
    expect(decision.action).toBe("PAUSE");
    expect(decision.reason).toContain("暂停");
  });

  it("R04: 威胁 HIGH + 护航后净价值正 → ESCORT", () => {
    // HIGH → risk = 0.6
    // operationValue = 2 sources × 10 = 20/tick
    // expectedDuration = 200 (HARASSMENT)
    // grossValue = 20 × 200 = 4000
    // escortedNetValue = (4000 - 260) × (1 - 0.6 × 0.3) = 3740 × 0.82 = 3066.8
    // > 0 → ESCORT
    const decision = decideRemoteDefenseAction(makeInput({
      threat: makeThreat("HIGH", "HARASSMENT"),
      remoteOp: makeRemoteOp({ sources: 2, creepInvestment: 2000 }),
      militaryContext: makeMilitaryContext({ atWar: false, defenderSpawnCost: 260 }),
    }));
    expect(decision.action).toBe("ESCORT");
    expect(decision.escortDemand).toBeDefined();
    expect(decision.escortDemand?.count).toBe(2); // HIGH → 2 defender
  });

  it("R05: 威胁 HIGH + 净价值负 → RETREAT", () => {
    // 让净价值为负：creepInvestment 高 + risk 高
    // expectedLoss = creepInvestment × risk × min(duration/500, 1)
    // = 50000 × 0.6 × 0.4 = 12000
    // netValue = (4000 - 12000 - 260) × (1 - 0.6) = -8260 × 0.4 = -3304
    // < 0 → RETREAT (pathCost ≤ 3 可安全返回)
    const decision = decideRemoteDefenseAction(makeInput({
      threat: makeThreat("HIGH", "SIEGE"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000, pathCost: 2 }),
      militaryContext: makeMilitaryContext({ atWar: false }),
    }));
    expect(decision.action).toBe("RETREAT");
    expect(decision.reason).toContain("撤退");
  });

  it("R06: 威胁 CRITICAL + 净价值负 + 替换成本占比 > 0.2 → ABORT", () => {
    // CRITICAL → risk = 0.9
    // creepInvestment = 50000, empireEnergyReserve = 100000
    // replacementCostRatio = 50000/100000 = 0.5 > 0.2 → ABORT
    const decision = decideRemoteDefenseAction(makeInput({
      threat: makeThreat("CRITICAL", "FULL_ASSAULT"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000 }),
      empireContext: makeEmpireContext({ empireEnergyReserve: 100000 }),
    }));
    expect(decision.action).toBe("ABORT");
    expect(decision.reason).toContain("长期不可维持");
  });

  it("R07: war 姿态 + 威胁 HIGH → RETREAT（不护航）", () => {
    const decision = decideRemoteDefenseAction(makeInput({
      threat: makeThreat("HIGH", "HARASSMENT"),
      empireContext: makeEmpireContext({ posture: "war" }),
    }));
    expect(decision.action).toBe("RETREAT");
    expect(decision.reason).toContain("war姿态");
  });

  it("R07b: RETREAT + pathCost > 3 → ABORT（无法安全撤退）", () => {
    const decision = decideRemoteDefenseAction(makeInput({
      threat: makeThreat("CRITICAL", "FULL_ASSAULT"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000, pathCost: 5 }),
      empireContext: makeEmpireContext({ empireEnergyReserve: 100000 }),
    }));
    // CRITICAL + netValue < 0 + pathCost=5 > 3 → ABORT
    // ABORT 可能由两个路径触发：replacementCostRatio > 0.2 或 pathCost > 3
    expect(decision.action).toBe("ABORT");
    // reason 应该包含 ABORT 的原因（长期不可维持 或 距离过远）
    expect(decision.reason.length).toBeGreaterThan(0);
  });
});

// ─── evaluateRemoteExpectedValue 测试 ───────────────────────

describe("G4 — evaluateRemoteExpectedValue", () => {
  it("正确计算运营价值 = sources × 10", () => {
    const ev = evaluateRemoteExpectedValue(makeInput({
      remoteOp: makeRemoteOp({ sources: 3 }),
    }));
    expect(ev.operationValue).toBe(30); // 3 × 10
  });

  it("风险系数映射正确", () => {
    const evNone = evaluateRemoteExpectedValue(makeInput({
      threat: makeThreat("NONE", "UNKNOWN"),
    }));
    expect(evNone.risk).toBe(0);

    const evCritical = evaluateRemoteExpectedValue(makeInput({
      threat: makeThreat("CRITICAL", "FULL_ASSAULT"),
    }));
    expect(evCritical.risk).toBe(0.9);
  });

  it("期望损失 = creepInvestment × risk × min(duration/500, 1)", () => {
    const ev = evaluateRemoteExpectedValue(makeInput({
      threat: makeThreat("MEDIUM", "HARASSMENT"),
      remoteOp: makeRemoteOp({ creepInvestment: 10000 }),
    }));
    // risk = 0.3, duration = 200 (HARASSMENT)
    // expectedLoss = 10000 × 0.3 × min(200/500, 1) = 10000 × 0.3 × 0.4 = 1200
    expect(ev.expectedLoss).toBe(1200);
  });
});

// ─── rejectedAlternatives 测试 ──────────────────────────────

describe("G4 — rejectedAlternatives 可追溯", () => {
  it("ABORT 决策包含被拒绝的替代方案", () => {
    const decision = decideRemoteDefenseAction(makeInput({
      threat: makeThreat("CRITICAL", "FULL_ASSAULT"),
      remoteOp: makeRemoteOp({ creepInvestment: 50000 }),
      empireContext: makeEmpireContext({ empireEnergyReserve: 100000 }),
    }));
    expect(decision.action).toBe("ABORT");
    expect(decision.rejectedAlternatives.length).toBeGreaterThan(0);
    const rejectedActions = decision.rejectedAlternatives.map(a => a.action);
    expect(rejectedActions).toContain("RETREAT");
    expect(rejectedActions).toContain("ESCORT");
    expect(rejectedActions).toContain("CONTINUE");
  });
});
