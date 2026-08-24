/**
 * A4.0 Phase 3 — Remote Economy Foundation 单元测试。
 *
 * 覆盖：
 * - remote-source.ts：Remote Source Model、状态判定、创建、从 Intel 派生、查询、序列化
 * - remote-value.ts：净价值评估、成本计算、等级判定、批量评估
 * - remote-opportunity.ts：Opportunity 模型、状态转换、过期检测、查询
 * - opportunity-ranking.ts：多维评分、排序、Top-N、可解释
 */
import { describe, it, expect } from "vitest";
import {
  createRemoteSource,
  deriveRemoteSource,
  updateRemoteSourceStatus,
  updateRemoteSourceRisk,
  getSourcesByHome,
  filterEvaluatable,
  filterOperational,
  findRemoteSource,
  computeExpectedYield,
  makeRemoteSourceId,
  isEvaluatable,
  isOperational,
  isRemoteSourceTerminal,
  REMOTE_SOURCE_STATUSES,
  serializeRemoteSource,
  deserializeRemoteSource,
  type RemoteSource,
  type RemoteSourceStatus,
  type IntelForRemoteSource,
  type RemoteSourceInput,
} from "../../../src/domain/remote/remote-source";
import {
  assessRemoteValue,
  computeTransportCost,
  computeRiskCost,
  computeInfrastructureCost,
  gradeValue,
  batchAssessValues,
  filterWorthInvesting,
  DEFAULT_VALUE_CONFIG,
  type ValueAssessmentConfig,
} from "../../../src/domain/remote/remote-value";
import {
  createOpportunity,
  updateOpportunityStatus,
  approveOpportunity,
  rejectOpportunity,
  markExecuting,
  completeOpportunity,
  expireOpportunity,
  isExpired,
  expireStaleOpportunities,
  isOpportunityActive,
  isOpportunityTerminal,
  filterWaitingExecution,
  filterActiveOpportunities,
  filterTerminalOpportunities,
  findActiveOpportunity,
  hasActiveOpportunity,
  type RemoteOpportunity,
} from "../../../src/domain/remote/remote-opportunity";
import {
  scoreOpportunity,
  scoreValue,
  scoreDistance,
  scoreRisk,
  scoreReliability,
  rankOpportunities,
  topOpportunities,
  bestOpportunity,
  rankWorthInvesting,
  DEFAULT_RANKING_CONFIG,
} from "../../../src/domain/remote/opportunity-ranking";
import type { RemoteResourceValue } from "../../../src/domain/remote/remote-value";

// ─── 辅助构造函数 ─────────────────────────────────────────

function makeRemoteSource(over?: Partial<RemoteSource>): RemoteSource {
  return {
    id: "remote:W7N4:W8N4",
    homeRoom: "W7N4",
    targetRoom: "W8N4",
    resource: "energy",
    sourceCount: 2,
    expectedYield: 20,
    reserved: true,
    pathCost: 70,
    linearDistance: 1,
    hasRoad: true,
    riskLevel: 0,
    lastHostileAt: undefined,
    hasInvaderCore: false,
    status: "available",
    createdAt: 1000,
    updatedAt: 1000,
    origin: "test",
    ...over,
  };
}

function makeIntel(over?: Partial<IntelForRemoteSource>): IntelForRemoteSource {
  return {
    kind: "normal",
    status: "normal",
    sources: 2,
    pathCost: 70,
    reservedBy: undefined,
    owner: undefined,
    lastSeen: 1000,
    ...over,
  };
}

function makeValue(over?: Partial<RemoteResourceValue>): RemoteResourceValue {
  return {
    sourceId: "remote:W7N4:W8N4",
    targetRoom: "W8N4",
    expectedYield: 20,
    transportCost: 0.21,
    riskCost: 0.5,
    infrastructureCost: 0.5,
    netValue: 18.79,
    grade: "premium",
    worthInvesting: true,
    ...over,
  };
}

function makeOpportunity(over?: Partial<RemoteOpportunity>): RemoteOpportunity {
  const source = makeRemoteSource();
  const value = makeValue();
  return {
    id: source.id,
    sourceId: source.id,
    homeRoom: source.homeRoom,
    targetRoom: source.targetRoom,
    value,
    valueGrade: value.grade,
    sourceSnapshot: {
      sourceCount: source.sourceCount,
      expectedYield: source.expectedYield,
      pathCost: source.pathCost,
      linearDistance: source.linearDistance,
      riskLevel: source.riskLevel,
      hasInvaderCore: source.hasInvaderCore,
      reserved: source.reserved,
    },
    status: "waiting_execution",
    createdAt: 1000,
    updatedAt: 1000,
    expiresAt: 2000,
    rejectReason: undefined,
    approveReason: undefined,
    ...over,
  };
}

// ═════════════════════════════════════════════════════════
// §1  remote-source.ts
// ═════════════════════════════════════════════════════════

describe("remote-source.ts", () => {
  describe("状态判定", () => {
    it("available 和 degraded 可评估", () => {
      expect(isEvaluatable("available")).toBe(true);
      expect(isEvaluatable("degraded")).toBe(true);
    });
    it("assigned/blocked/inactive 不可评估", () => {
      expect(isEvaluatable("assigned")).toBe(false);
      expect(isEvaluatable("blocked")).toBe(false);
      expect(isEvaluatable("inactive")).toBe(false);
    });
    it("assigned 和 degraded 活跃运营", () => {
      expect(isOperational("assigned")).toBe(true);
      expect(isOperational("degraded")).toBe(true);
    });
    it("available/blocked/inactive 非运营", () => {
      expect(isOperational("available")).toBe(false);
      expect(isOperational("blocked")).toBe(false);
    });
    it("inactive 是终态", () => {
      expect(isRemoteSourceTerminal("inactive")).toBe(true);
      expect(isRemoteSourceTerminal("available")).toBe(false);
    });
  });

  describe("REMOTE_SOURCE_STATUSES", () => {
    it("包含 5 个状态", () => {
      expect(REMOTE_SOURCE_STATUSES).toHaveLength(5);
      expect(REMOTE_SOURCE_STATUSES).toContain("available");
      expect(REMOTE_SOURCE_STATUSES).toContain("assigned");
      expect(REMOTE_SOURCE_STATUSES).toContain("degraded");
      expect(REMOTE_SOURCE_STATUSES).toContain("blocked");
      expect(REMOTE_SOURCE_STATUSES).toContain("inactive");
    });
  });

  describe("makeRemoteSourceId", () => {
    it("生成正确格式", () => {
      expect(makeRemoteSourceId("W7N4", "W8N4")).toBe("remote:W7N4:W8N4");
    });
  });

  describe("computeExpectedYield", () => {
    it("reserved = 10/source", () => {
      expect(computeExpectedYield(2, true)).toBe(20);
    });
    it("unreserved = 5/source", () => {
      expect(computeExpectedYield(2, false)).toBe(10);
    });
    it("1 source reserved", () => {
      expect(computeExpectedYield(1, true)).toBe(10);
    });
  });

  describe("createRemoteSource", () => {
    it("正确创建 Remote Source", () => {
      const input: RemoteSourceInput = {
        homeRoom: "W7N4",
        targetRoom: "W8N4",
        sourceCount: 2,
        pathCost: 70,
        linearDistance: 1,
        reserved: true,
        hasRoad: true,
        riskLevel: 0,
        lastHostileAt: undefined,
        hasInvaderCore: false,
        status: "available",
        tick: 1000,
      };
      const s = createRemoteSource(input);
      expect(s.id).toBe("remote:W7N4:W8N4");
      expect(s.homeRoom).toBe("W7N4");
      expect(s.targetRoom).toBe("W8N4");
      expect(s.sourceCount).toBe(2);
      expect(s.expectedYield).toBe(20);
      expect(s.reserved).toBe(true);
      expect(s.pathCost).toBe(70);
      expect(s.linearDistance).toBe(1);
      expect(s.status).toBe("available");
      expect(s.resource).toBe("energy");
    });
  });

  describe("deriveRemoteSource", () => {
    it("从正常 intel 派生", () => {
      const s = deriveRemoteSource("W7N4", "W8N4", makeIntel(), 1, 0, undefined, false, true, 1000);
      expect(s).toBeDefined();
      expect(s!.sourceCount).toBe(2);
      expect(s!.pathCost).toBe(70);
      expect(s!.reserved).toBe(false); // reservedBy undefined → false
      expect(s!.expectedYield).toBe(10); // 2 sources × 5 (unreserved)
    });
    it("有 InvaderCore 时默认 blocked", () => {
      const s = deriveRemoteSource("W7N4", "W8N4", makeIntel(), 1, 0, undefined, true, true, 1000);
      expect(s!.status).toBe("blocked");
    });
    it("非 normal 房返回 undefined", () => {
      expect(deriveRemoteSource("W7N4", "W8N4", makeIntel({ kind: "sk" }), 1, 0, undefined, false, true, 1000)).toBeUndefined();
    });
    it("非正常 status 返回 undefined", () => {
      expect(deriveRemoteSource("W7N4", "W8N4", makeIntel({ status: "novice" }), 1, 0, undefined, false, true, 1000)).toBeUndefined();
    });
    it("有主返回 undefined", () => {
      expect(deriveRemoteSource("W7N4", "W8N4", makeIntel({ owner: "Other" }), 1, 0, undefined, false, true, 1000)).toBeUndefined();
    });
    it("pathCost 缺失回退线性距离×70", () => {
      const s = deriveRemoteSource("W7N4", "W8N4", makeIntel({ pathCost: undefined }), 3, 0, undefined, false, true, 1000);
      expect(s!.pathCost).toBe(210); // 3 × 70
    });
    it("sources 缺失默认 1", () => {
      const s = deriveRemoteSource("W7N4", "W8N4", makeIntel({ sources: undefined }), 1, 0, undefined, false, true, 1000);
      expect(s!.sourceCount).toBe(1);
    });
  });

  describe("updateRemoteSourceStatus", () => {
    it("更新状态", () => {
      const s = makeRemoteSource({ status: "available" });
      const u = updateRemoteSourceStatus(s, "assigned", 1100);
      expect(u.status).toBe("assigned");
      expect(u.updatedAt).toBe(1100);
      expect(s.status).toBe("available"); // 不可变
    });
  });

  describe("updateRemoteSourceRisk", () => {
    it("更新风险信息", () => {
      const s = makeRemoteSource({ riskLevel: 0, hasInvaderCore: false });
      const u = updateRemoteSourceRisk(s, 2, 1000, true, 1100);
      expect(u.riskLevel).toBe(2);
      expect(u.hasInvaderCore).toBe(true);
      expect(u.lastHostileAt).toBe(1000);
    });
  });

  describe("查询函数", () => {
    const sources = [
      makeRemoteSource({ id: "remote:W7N4:W8N4", homeRoom: "W7N4", targetRoom: "W8N4", status: "available" }),
      makeRemoteSource({ id: "remote:W7N4:W9N4", homeRoom: "W7N4", targetRoom: "W9N4", status: "assigned" }),
      makeRemoteSource({ id: "remote:W7N3:W8N3", homeRoom: "W7N3", targetRoom: "W8N3", status: "degraded" }),
    ];
    it("getSourcesByHome", () => {
      expect(getSourcesByHome(sources, "W7N4")).toHaveLength(2);
    });
    it("filterEvaluatable", () => {
      expect(filterEvaluatable(sources)).toHaveLength(2); // available + degraded
    });
    it("filterOperational", () => {
      expect(filterOperational(sources)).toHaveLength(2); // assigned + degraded
    });
    it("findRemoteSource", () => {
      const found = findRemoteSource(sources, "W7N4", "W8N4");
      expect(found).toBeDefined();
      expect(found!.targetRoom).toBe("W8N4");
    });
    it("findRemoteSource 不存在返回 undefined", () => {
      expect(findRemoteSource(sources, "W7N4", "W0N0")).toBeUndefined();
    });
  });

  describe("序列化", () => {
    it("往返一致", () => {
      const original = makeRemoteSource({
        status: "degraded",
        riskLevel: 2,
        hasInvaderCore: true,
        lastHostileAt: 500,
      });
      const restored = deserializeRemoteSource(serializeRemoteSource(original));
      expect(restored.id).toBe(original.id);
      expect(restored.homeRoom).toBe(original.homeRoom);
      expect(restored.targetRoom).toBe(original.targetRoom);
      expect(restored.sourceCount).toBe(original.sourceCount);
      expect(restored.expectedYield).toBe(original.expectedYield);
      expect(restored.reserved).toBe(original.reserved);
      expect(restored.pathCost).toBe(original.pathCost);
      expect(restored.riskLevel).toBe(original.riskLevel);
      expect(restored.hasInvaderCore).toBe(true);
      expect(restored.lastHostileAt).toBe(500);
      expect(restored.status).toBe("degraded");
    });
  });
});

// ═════════════════════════════════════════════════════════
// §2  remote-value.ts
// ═════════════════════════════════════════════════════════

describe("remote-value.ts", () => {
  describe("computeTransportCost", () => {
    it("有路：pathCost × weight", () => {
      const s = makeRemoteSource({ pathCost: 100, hasRoad: true });
      expect(computeTransportCost(s)).toBeCloseTo(100 * 0.003, 5);
    });
    it("无路：加 noRoadPenalty", () => {
      const s = makeRemoteSource({ pathCost: 100, hasRoad: false });
      expect(computeTransportCost(s)).toBeCloseTo(100 * 0.003 + 1.0, 5);
    });
  });

  describe("computeRiskCost", () => {
    it("riskLevel 0 = base", () => {
      const s = makeRemoteSource({ riskLevel: 0, hasInvaderCore: false });
      expect(computeRiskCost(s)).toBeCloseTo(0.5, 5);
    });
    it("riskLevel 2 = base + 2×perLevel", () => {
      const s = makeRemoteSource({ riskLevel: 2, hasInvaderCore: false });
      expect(computeRiskCost(s)).toBeCloseTo(0.5 + 2 * 1.0, 5);
    });
    it("InvaderCore 加惩罚", () => {
      const s = makeRemoteSource({ riskLevel: 0, hasInvaderCore: true });
      expect(computeRiskCost(s)).toBeCloseTo(0.5 + 5.0, 5);
    });
  });

  describe("computeInfrastructureCost", () => {
    it("固定值", () => {
      expect(computeInfrastructureCost(makeRemoteSource())).toBe(0.5);
    });
  });

  describe("gradeValue", () => {
    it(">=15 → premium", () => { expect(gradeValue(15)).toBe("premium"); });
    it(">=8 → profitable", () => { expect(gradeValue(8)).toBe("profitable"); });
    it(">=3 → marginal", () => { expect(gradeValue(3)).toBe("marginal"); });
    it("<3 → unprofitable", () => { expect(gradeValue(2.9)).toBe("unprofitable"); });
  });

  describe("assessRemoteValue", () => {
    it("高风险远矿评估正确", () => {
      const s = makeRemoteSource({
        expectedYield: 20,
        pathCost: 200,
        hasRoad: false,
        riskLevel: 3,
        hasInvaderCore: false,
      });
      const v = assessRemoteValue(s);
      expect(v.sourceId).toBe(s.id);
      expect(v.expectedYield).toBe(20);
      expect(v.transportCost).toBeGreaterThan(0);
      expect(v.riskCost).toBeGreaterThan(0);
      expect(v.netValue).toBeLessThan(20);
      expect(v.netValue).toBe(v.expectedYield - v.transportCost - v.riskCost - v.infrastructureCost);
    });
    it("低风险近矿评估为 premium", () => {
      const s = makeRemoteSource({
        expectedYield: 20,
        pathCost: 50,
        hasRoad: true,
        riskLevel: 0,
      });
      const v = assessRemoteValue(s);
      expect(v.grade).toBe("premium");
      expect(v.worthInvesting).toBe(true);
    });
    it("InvaderCore 严重影响净价值", () => {
      const s = makeRemoteSource({
        expectedYield: 20,
        hasInvaderCore: true,
        riskLevel: 3,
      });
      const v = assessRemoteValue(s);
      expect(v.netValue).toBeLessThan(12);
    });
  });

  describe("batchAssessValues", () => {
    it("按 netValue 降序排列", () => {
      const sources = [
        makeRemoteSource({ id: "low", targetRoom: "W1N1", expectedYield: 8, riskLevel: 2 }),
        makeRemoteSource({ id: "high", targetRoom: "W2N2", expectedYield: 20, riskLevel: 0 }),
      ];
      const values = batchAssessValues(sources);
      expect(values[0]!.netValue).toBeGreaterThanOrEqual(values[1]!.netValue);
    });
  });

  describe("filterWorthInvesting", () => {
    it("只返回 worthInvesting=true", () => {
      const sources = [
        makeRemoteSource({ id: "good", expectedYield: 20, riskLevel: 0 }),
        makeRemoteSource({ id: "bad", expectedYield: 5, riskLevel: 3, hasInvaderCore: true }),
      ];
      const worth = filterWorthInvesting(sources);
      expect(worth.every(v => v.worthInvesting)).toBe(true);
    });
  });
});

// ═════════════════════════════════════════════════════════
// §3  remote-opportunity.ts
// ═════════════════════════════════════════════════════════

describe("remote-opportunity.ts", () => {
  describe("状态判定", () => {
    it("waiting_execution 和 approved 是活跃", () => {
      expect(isOpportunityActive("waiting_execution")).toBe(true);
      expect(isOpportunityActive("approved")).toBe(true);
    });
    it("executing 不是活跃", () => {
      expect(isOpportunityActive("executing")).toBe(false);
    });
    it("completed/rejected/expired 是终态", () => {
      expect(isOpportunityTerminal("completed")).toBe(true);
      expect(isOpportunityTerminal("rejected")).toBe(true);
      expect(isOpportunityTerminal("expired")).toBe(true);
    });
  });

  describe("createOpportunity", () => {
    it("创建 WAITING_EXECUTION 状态", () => {
      const source = makeRemoteSource();
      const value = makeValue();
      const opp = createOpportunity({ source, value, tick: 1000, validityTicks: 1000 });
      expect(opp.id).toBe(source.id);
      expect(opp.sourceId).toBe(source.id);
      expect(opp.homeRoom).toBe("W7N4");
      expect(opp.targetRoom).toBe("W8N4");
      expect(opp.status).toBe("waiting_execution");
      expect(opp.createdAt).toBe(1000);
      expect(opp.expiresAt).toBe(2000);
      expect(opp.valueGrade).toBe("premium");
      expect(opp.sourceSnapshot.sourceCount).toBe(2);
      expect(opp.sourceSnapshot.expectedYield).toBe(20);
      expect(opp.rejectReason).toBeUndefined();
    });
  });

  describe("状态转换", () => {
    it("approveOpportunity", () => {
      const opp = makeOpportunity();
      const u = approveOpportunity(opp, 1100, "good-value");
      expect(u.status).toBe("approved");
      expect(u.approveReason).toBe("good-value");
      expect(u.updatedAt).toBe(1100);
    });
    it("rejectOpportunity", () => {
      const opp = makeOpportunity();
      const u = rejectOpportunity(opp, 1100, "too-risky");
      expect(u.status).toBe("rejected");
      expect(u.rejectReason).toBe("too-risky");
    });
    it("markExecuting", () => {
      const opp = makeOpportunity({ status: "approved" });
      expect(markExecuting(opp, 1200).status).toBe("executing");
    });
    it("completeOpportunity", () => {
      const opp = makeOpportunity({ status: "executing" });
      expect(completeOpportunity(opp, 1500).status).toBe("completed");
    });
    it("expireOpportunity", () => {
      const opp = makeOpportunity();
      expect(expireOpportunity(opp, 2001).status).toBe("expired");
    });
  });

  describe("过期检测", () => {
    it("未过期返回 false", () => {
      const opp = makeOpportunity({ expiresAt: 2000 });
      expect(isExpired(opp, 1500)).toBe(false);
    });
    it("过期返回 true", () => {
      const opp = makeOpportunity({ expiresAt: 2000 });
      expect(isExpired(opp, 2001)).toBe(true);
    });
    it("终态不算过期", () => {
      const opp = makeOpportunity({ status: "completed", expiresAt: 1000 });
      expect(isExpired(opp, 5000)).toBe(false);
    });
  });

  describe("expireStaleOpportunities", () => {
    it("批量过期", () => {
      const opps = [
        makeOpportunity({ id: "a", expiresAt: 500 }),
        makeOpportunity({ id: "b", expiresAt: 5000 }),
      ];
      const updated = expireStaleOpportunities(opps, 1000);
      expect(updated[0]!.status).toBe("expired");
      expect(updated[1]!.status).toBe("waiting_execution");
    });
    it("不修改原数组", () => {
      const opps = [makeOpportunity({ expiresAt: 500 })];
      expireStaleOpportunities(opps, 1000);
      expect(opps[0]!.status).toBe("waiting_execution");
    });
  });

  describe("查询函数", () => {
    const opps = [
      makeOpportunity({ id: "a", sourceId: "a", status: "waiting_execution" }),
      makeOpportunity({ id: "b", sourceId: "b", status: "approved" }),
      makeOpportunity({ id: "c", sourceId: "c", status: "rejected" }),
    ];
    it("filterWaitingExecution", () => {
      expect(filterWaitingExecution(opps)).toHaveLength(1);
    });
    it("filterActiveOpportunities", () => {
      expect(filterActiveOpportunities(opps)).toHaveLength(2);
    });
    it("filterTerminalOpportunities", () => {
      expect(filterTerminalOpportunities(opps)).toHaveLength(1);
    });
    it("findActiveOpportunity", () => {
      expect(findActiveOpportunity(opps, "a")?.status).toBe("waiting_execution");
    });
    it("findActiveOpportunity 终态不算", () => {
      expect(findActiveOpportunity(opps, "c")).toBeUndefined();
    });
    it("hasActiveOpportunity", () => {
      expect(hasActiveOpportunity(opps, "a")).toBe(true);
      expect(hasActiveOpportunity(opps, "c")).toBe(false);
    });
  });
});

// ═════════════════════════════════════════════════════════
// §4  opportunity-ranking.ts
// ═════════════════════════════════════════════════════════

describe("opportunity-ranking.ts", () => {
  describe("scoreValue", () => {
    it("premium → 满分", () => {
      const opp = makeOpportunity({ valueGrade: "premium" });
      expect(scoreValue(opp)).toBe(DEFAULT_RANKING_CONFIG.valueWeight);
    });
    it("profitable → 75%", () => {
      const opp = makeOpportunity({ valueGrade: "profitable" });
      expect(scoreValue(opp)).toBe(DEFAULT_RANKING_CONFIG.valueWeight * 0.75);
    });
    it("marginal → 50%", () => {
      const opp = makeOpportunity({ valueGrade: "marginal" });
      expect(scoreValue(opp)).toBe(DEFAULT_RANKING_CONFIG.valueWeight * 0.5);
    });
    it("unprofitable → 10%", () => {
      const opp = makeOpportunity({ valueGrade: "unprofitable" });
      expect(scoreValue(opp)).toBe(DEFAULT_RANKING_CONFIG.valueWeight * 0.1);
    });
  });

  describe("scoreDistance", () => {
    it("距离≤min → 满分", () => {
      const opp = makeOpportunity({});
      opp.sourceSnapshot.linearDistance = 1;
      expect(scoreDistance(opp)).toBe(DEFAULT_RANKING_CONFIG.distanceWeight);
    });
    it("距离≥max → 0", () => {
      const opp = makeOpportunity({});
      opp.sourceSnapshot.linearDistance = 5;
      expect(scoreDistance(opp)).toBe(0);
    });
    it("中间距离线性映射", () => {
      const opp = makeOpportunity({});
      opp.sourceSnapshot.linearDistance = 3;
      // (5-3)/(5-1) = 0.5 → weight × 0.5
      expect(scoreDistance(opp)).toBe(Math.round(DEFAULT_RANKING_CONFIG.distanceWeight * 0.5));
    });
  });

  describe("scoreRisk", () => {
    it("riskLevel 0 → 满分", () => {
      const opp = makeOpportunity({});
      opp.sourceSnapshot.riskLevel = 0;
      expect(scoreRisk(opp)).toBe(DEFAULT_RANKING_CONFIG.riskWeight);
    });
    it("riskLevel 3 → 10%", () => {
      const opp = makeOpportunity({});
      opp.sourceSnapshot.riskLevel = 3;
      expect(scoreRisk(opp)).toBe(DEFAULT_RANKING_CONFIG.riskWeight * 0.1);
    });
    it("InvaderCore 减半", () => {
      const opp = makeOpportunity({});
      opp.sourceSnapshot.riskLevel = 0;
      opp.sourceSnapshot.hasInvaderCore = true;
      expect(scoreRisk(opp)).toBe(Math.round(DEFAULT_RANKING_CONFIG.riskWeight * 0.5));
    });
  });

  describe("scoreReliability", () => {
    it("有 sources 和 yield → 满分", () => {
      const opp = makeOpportunity({});
      opp.sourceSnapshot.sourceCount = 2;
      opp.sourceSnapshot.expectedYield = 20;
      expect(scoreReliability(opp)).toBe(DEFAULT_RANKING_CONFIG.reliabilityWeight);
    });
    it("sources=0 → 50%", () => {
      const opp = makeOpportunity({});
      opp.sourceSnapshot.sourceCount = 0;
      opp.sourceSnapshot.expectedYield = 20;
      expect(scoreReliability(opp)).toBe(Math.round(DEFAULT_RANKING_CONFIG.reliabilityWeight * 0.5));
    });
  });

  describe("scoreOpportunity", () => {
    it("总分 = 各维度之和", () => {
      const opp = makeOpportunity({
        valueGrade: "premium",
        value: makeValue({ netValue: 18 }),
      });
      opp.sourceSnapshot.linearDistance = 1;
      opp.sourceSnapshot.riskLevel = 0;
      opp.sourceSnapshot.hasInvaderCore = false;
      const score = scoreOpportunity(opp);
      expect(score.totalScore).toBe(
        score.valueScore + score.distanceScore + score.riskScore + score.reliabilityScore,
      );
      expect(score.reason).toContain("value=premium");
      expect(score.reason).toContain("dist=1");
    });
  });

  describe("rankOpportunities", () => {
    it("按总分降序排列", () => {
      const opps = [
        makeOpportunity({ id: "low", targetRoom: "W1N1", valueGrade: "marginal", value: makeValue({ netValue: 4, targetRoom: "W1N1" }) }),
        makeOpportunity({ id: "high", targetRoom: "W2N2", valueGrade: "premium", value: makeValue({ netValue: 18, targetRoom: "W2N2" }) }),
      ];
      opps[0]!.sourceSnapshot.linearDistance = 3;
      opps[0]!.sourceSnapshot.riskLevel = 2;
      opps[1]!.sourceSnapshot.linearDistance = 1;
      opps[1]!.sourceSnapshot.riskLevel = 0;
      const ranked = rankOpportunities(opps);
      expect(ranked[0]!.id).toBe("high");
      expect(ranked[1]!.id).toBe("low");
      expect(ranked[0]!.rank).toBe(1);
      expect(ranked[1]!.rank).toBe(2);
    });
    it("空列表返回空", () => {
      expect(rankOpportunities([])).toHaveLength(0);
    });
  });

  describe("topOpportunities", () => {
    it("返回前 N 个", () => {
      const opps = [
        makeOpportunity({ id: "a", targetRoom: "A", valueGrade: "premium", value: makeValue({ netValue: 18, targetRoom: "A" }) }),
        makeOpportunity({ id: "b", targetRoom: "B", valueGrade: "profitable", value: makeValue({ netValue: 10, targetRoom: "B" }) }),
        makeOpportunity({ id: "c", targetRoom: "C", valueGrade: "marginal", value: makeValue({ netValue: 4, targetRoom: "C" }) }),
      ];
      const top = topOpportunities(opps, 2);
      expect(top).toHaveLength(2);
      expect(top[0]!.rank).toBe(1);
    });
  });

  describe("bestOpportunity", () => {
    it("返回排名第一", () => {
      const opps = [
        makeOpportunity({ id: "a", targetRoom: "A", valueGrade: "marginal", value: makeValue({ netValue: 4, targetRoom: "A" }) }),
        makeOpportunity({ id: "b", targetRoom: "B", valueGrade: "premium", value: makeValue({ netValue: 18, targetRoom: "B" }) }),
      ];
      const best = bestOpportunity(opps);
      expect(best).toBeDefined();
      expect(best!.id).toBe("b");
    });
    it("空列表返回 undefined", () => {
      expect(bestOpportunity([])).toBeUndefined();
    });
  });

  describe("rankWorthInvesting", () => {
    it("只排序 worthInvesting=true", () => {
      const opps = [
        makeOpportunity({ id: "good", targetRoom: "G", valueGrade: "premium", value: makeValue({ netValue: 18, targetRoom: "G", worthInvesting: true }) }),
        makeOpportunity({ id: "bad", targetRoom: "B", valueGrade: "unprofitable", value: makeValue({ netValue: 1, targetRoom: "B", worthInvesting: false }) }),
      ];
      const ranked = rankWorthInvesting(opps);
      expect(ranked).toHaveLength(1);
      expect(ranked[0]!.id).toBe("good");
    });
  });
});
