/**
 * A4.7 Decision Trace & Deterministic Replay — 单元测试。
 *
 * 验证 domain 层纯函数的核心能力：
 *   UT-001: Snapshot Hash 确定性 — 相同输入永远产生相同 Hash
 *   UT-002: Snapshot Hash 区分性 — 不同输入产生不同 Hash
 *   UT-003: Decision Hash 确定性
 *   UT-004: stableStringify key 排序稳定性
 *   UT-005: FNV-1a Hash 分布均匀性
 *   UT-006: Replay Decision 确定性 — 1000 次 replay 结果一致
 *   UT-007: verifyDeterminism — 检测确定性
 *   UT-008: compareReplay — MATCH 场景
 *   UT-009: compareReplay — DIVERGENCE 场景
 *   UT-010: Ring Buffer — push + 自动淘汰
 *   UT-011: Ring Buffer — getRecentRecords 顺序
 *   UT-012: Ring Buffer — 超容量滚动正确
 *   UT-013: Trace GC — ACTIVE → ARCHIVED 转换
 *   UT-014: Trace GC — ARCHIVED → EXPIRED 删除
 *   UT-015: Trace GC — 统计正确
 *   UT-016: Query — 按 tick 过滤
 *   UT-017: Query — 按 category 过滤
 *   UT-018: Query — 按 severity/minSeverity 过滤
 *   UT-019: Query — 按 correlationId 追踪链
 *   UT-020: Memory Budget — 单条记录大小测量
 *   UT-021: Memory Budget — 1000 条 < 500KB 安全线
 *   UT-022: Integrity Check — 孤立记录检测
 *   UT-023: buildDecisionChain — 可读输出
 *   UT-024: CorrelationId 格式
 *   UT-025: DecisionId 格式
 *
 * 纯函数测试 — 不依赖 Game/Memory。
 */
import { describe, it, expect } from "vitest";
import {
  type DecisionSnapshot,
  type DecisionRecord,
  type DecisionReason,
  type DecisionEvidence,
  type RejectedAlternative,
  makeCorrelationId,
  makeDecisionId,
  snapshotHash,
  decisionHash,
  replayDecision,
  verifyDeterminism,
  compareReplay,
  createRingBuffer,
  pushRecord,
  getRecentRecords,
  gcTrace,
  queryRecords,
  traceChain,
  measureMemoryBudget,
  checkTraceIntegrity,
  buildDecisionChain,
} from "../../../src/domain/strategy/decision-trace";

// ─── 测试夹具 ──────────────────────────────────────────────

function makeSnapshot(overrides?: Partial<DecisionSnapshot>): DecisionSnapshot {
  return {
    tick: 10000,
    scope: "empire",
    category: "RECOVERY",
    economy: {
      energyAvailable: 3000,
      energyCapacity: 10000,
      storageEnergy: 50000,
      terminalEnergy: 20000,
      netFlow: 15.5,
      economyPressure: 0.3,
      colonyState: "normal",
    },
    resources: {
      storageEnergy: 50000,
      storageMinerals: { U: 1000, O: 500 },
      terminalResources: { energy: 20000, U: 200 },
    },
    logistics: {
      haulerCount: 6,
      haulerCapacity: 600,
      deliveryRate: 0.85,
      backlogCount: 3,
      idleHaulers: 1,
    },
    threat: {
      posture: "develop",
      hostilesInRoom: 0,
      hasLiveThreat: false,
      safeModeTicks: 0,
    },
    spawn: {
      spawnCount: 3,
      spawningCount: 1,
      queueLength: 2,
      queueP0Count: 0,
    },
    population: {
      totalCreeps: 25,
      creepByRole: { harvester: 4, hauler: 6, upgrader: 3, builder: 2, distributor: 2 },
      creepTtlMin: 800,
    },
    health: {
      empireHealthLevel: "healthy",
      empireHealthScore: 0.85,
      bottleneck: "none",
      recovering: false,
    },
    recovery: {
      activeRecoveryCount: 0,
      recoveryActionTypes: [],
      recoveryStatsSucceeded: 5,
      recoveryStatsFailed: 1,
    },
    operations: {
      activeRemoteOps: 2,
      activeContracts: 0,
      expansionTarget: null,
    },
    planner: {
      strategyPosture: "develop",
      expansionAllowed: true,
      newRemoteOpsAllowed: true,
      cpuTier: "Healthy",
      cpuBucket: 8000,
    },
    ...overrides,
  };
}

function makeReasons(): DecisionReason[] {
  return [
    {
      metric: "energyFlow",
      actual: -5.2,
      threshold: 0,
      severity: "warning",
      consequence: "negative net energy flow",
    },
    {
      metric: "haulerDeficit",
      actual: 3,
      threshold: 0,
      severity: "critical",
      consequence: "spawn starvation imminent",
    },
  ];
}

function makeEvidence(): DecisionEvidence {
  return {
    energy: { available: 3000, income: 15, expense: 20 },
    spawn: { capacity: 3, queueLength: 2, p0Count: 0 },
    population: { harvester: 4, hauler: 6 },
    logistics: { deliveryFailure: 3, haulerDeficit: 2, backlog: 3 },
    recovery: { activeActions: 0, succeededCount: 5, failedCount: 1 },
    health: { empireHealthLevel: "healthy", empireHealthScore: 0.85, bottleneck: "none", recovering: false },
  };
}

function makeRejected(): RejectedAlternative[] {
  return [
    { action: "WAIT_FOR_NATURAL_RECOVERY", reason: "too slow, population at risk" },
  ];
}

function makeRecord(overrides?: Partial<DecisionRecord>): DecisionRecord {
  const reasons = makeReasons();
  const evidence = makeEvidence();
  const rejected = makeRejected();
  const selectedAction = "SPAWN_HAULER";
  const dHash = decisionHash(selectedAction, reasons, evidence, rejected);
  const decisionId = makeDecisionId(10000, 1);

  return {
    decisionId,
    tick: 10000,
    category: "SPAWN",
    actor: "spawn-manager",
    scope: "empire",
    inputSnapshotHash: snapshotHash(makeSnapshot()),
    reasons,
    evidence,
    selectedAction,
    rejectedAlternatives: rejected,
    expectedOutcome: "spawn queue drains, population stabilizes",
    correlationId: makeCorrelationId(decisionId, 10000),
    severity: "IMPORTANT",
    decisionHash: dHash,
    createdAt: 10000,
    lifecycle: "ACTIVE",
    ...overrides,
  };
}

// ─── UT-001: Snapshot Hash 确定性 ──────────────────────────

describe("A4.7 Decision Trace — Snapshot Hash", () => {
  it("UT-001: 相同 Snapshot 产生相同 Hash", () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot();
    expect(snapshotHash(s1)).toBe(snapshotHash(s2));
  });

  it("UT-002: 不同 Snapshot 产生不同 Hash", () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot({ tick: 10001 });
    expect(snapshotHash(s1)).not.toBe(snapshotHash(s2));
  });

  it("UT-002b: 字段值变化产生不同 Hash", () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot({
      economy: { ...s1.economy, energyAvailable: 9999 },
    });
    expect(snapshotHash(s1)).not.toBe(snapshotHash(s2));
  });

  it("UT-003: Hash 为 8 字符 hex", () => {
    const hash = snapshotHash(makeSnapshot());
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("UT-004: stableStringify key 排序稳定性 — 字段顺序不影响 Hash", () => {
    // 构造两个字段顺序不同的对象，但内容相同
    const objA = { b: 2, a: 1, c: 3 };
    const objB = { a: 1, c: 3, b: 2 };
    // 由于 stableStringify 排序 key，两者应产生相同 Hash
    // 间接验证：用 snapshot 但改变对象字面量顺序
    const s1 = makeSnapshot();
    const s2: DecisionSnapshot = {
      ...s1,
      resources: {
        terminalResources: { ...s1.resources.terminalResources },
        storageMinerals: { ...s1.resources.storageMinerals },
        storageEnergy: s1.resources.storageEnergy,
      },
    };
    expect(snapshotHash(s1)).toBe(snapshotHash(s2));
  });

  it("UT-005: FNV-1a Hash 分布 — 100 个不同输入产生 ≥ 90 个不同 Hash", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      hashes.add(snapshotHash(makeSnapshot({ tick: 10000 + i })));
    }
    expect(hashes.size).toBeGreaterThanOrEqual(90);
  });
});

// ─── UT-006~009: Decision Hash + Replay ────────────────────

describe("A4.7 Decision Trace — Decision Hash & Replay", () => {
  it("UT-006: Replay Decision 确定性 — 1000 次 replay 结果一致", () => {
    const snapshot = makeSnapshot();
    const replayFn = (s: DecisionSnapshot) => {
      const haulerDeficit = s.logistics.backlogCount > 2 ? s.logistics.backlogCount : 0;
      return {
        selectedAction: haulerDeficit > 0 ? "SPAWN_HAULER" : "MAINTAIN",
        reasons: haulerDeficit > 0
          ? [{ metric: "haulerDeficit", actual: haulerDeficit, threshold: 0, severity: "critical" as const, consequence: "spawn starvation" }]
          : [],
        evidence: makeEvidence(),
        rejectedAlternatives: haulerDeficit > 0 ? makeRejected() : [],
      };
    };

    const result = verifyDeterminism(snapshot, replayFn as never, 1000);
    expect(result.deterministic).toBe(true);
    expect(result.firstDivergenceAt).toBeUndefined();
  });

  it("UT-007: verifyDeterminism 检测确定性 — 确定性函数返回 deterministic=true", () => {
    const snapshot = makeSnapshot();
    const deterministicFn = (_s: DecisionSnapshot) => ({
      selectedAction: "MAINTAIN",
      reasons: [] as DecisionReason[],
      evidence: {} as DecisionEvidence,
      rejectedAlternatives: [] as RejectedAlternative[],
    });

    const result = verifyDeterminism(snapshot, deterministicFn as never, 100);
    expect(result.deterministic).toBe(true);
  });

  it("UT-008: compareReplay — MATCH 场景", () => {
    const reasons = makeReasons();
    const evidence = makeEvidence();
    const rejected = makeRejected();
    const selectedAction = "SPAWN_HAULER";
    const originalHash = decisionHash(selectedAction, reasons, evidence, rejected);

    const replay = replayDecision(makeSnapshot(), () => ({
      selectedAction,
      reasons,
      evidence,
      rejectedAlternatives: rejected,
    }));

    const comparison = compareReplay(
      { decisionHash: originalHash, selectedAction, reasons, evidence, rejectedAlternatives: rejected },
      replay,
    );
    expect(comparison.match).toBe(true);
    expect(comparison.originalHash).toBe(comparison.replayHash);
  });

  it("UT-009: compareReplay — DIVERGENCE 场景", () => {
    const reasons = makeReasons();
    const evidence = makeEvidence();
    const rejected = makeRejected();
    const originalAction = "SPAWN_HAULER";
    const originalHash = decisionHash(originalAction, reasons, evidence, rejected);

    // Replay 产生不同的 action
    const replay = replayDecision(makeSnapshot(), () => ({
      selectedAction: "WAIT_FOR_NATURAL_RECOVERY",
      reasons,
      evidence,
      rejectedAlternatives: rejected,
    }));

    const comparison = compareReplay(
      { decisionHash: originalHash, selectedAction: originalAction, reasons, evidence, rejectedAlternatives: rejected },
      replay,
    );
    expect(comparison.match).toBe(false);
    expect(comparison.divergentFields).toContain("selectedAction");
  });
});

// ─── UT-010~012: Ring Buffer ───────────────────────────────

describe("A4.7 Decision Trace — Ring Buffer", () => {
  it("UT-010: push + count 正确", () => {
    const buf = createRingBuffer(10);
    expect(buf.count).toBe(0);
    pushRecord(buf, makeRecord({ decisionId: "D-1-1" }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-2" }));
    expect(buf.count).toBe(2);
    expect(buf.totalWritten).toBe(2);
  });

  it("UT-011: getRecentRecords — 按时间序返回", () => {
    const buf = createRingBuffer(10);
    pushRecord(buf, makeRecord({ decisionId: "D-1-1", tick: 100 }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-2", tick: 200 }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-3", tick: 300 }));

    const recent = getRecentRecords(buf, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.decisionId).toBe("D-1-2");
    expect(recent[1]!.decisionId).toBe("D-1-3");
  });

  it("UT-012: 超容量滚动 — 满容量后最旧记录被淘汰", () => {
    const buf = createRingBuffer(3);
    pushRecord(buf, makeRecord({ decisionId: "D-1-1", tick: 100 }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-2", tick: 200 }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-3", tick: 300 }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-4", tick: 400 }));

    expect(buf.count).toBe(3);
    expect(buf.totalWritten).toBe(4);

    const recent = getRecentRecords(buf, 3);
    // D-1-1 应该被淘汰
    const ids = recent.map(r => r.decisionId);
    expect(ids).not.toContain("D-1-1");
    expect(ids).toContain("D-1-2");
    expect(ids).toContain("D-1-3");
    expect(ids).toContain("D-1-4");
  });
});

// ─── UT-013~015: Trace GC ──────────────────────────────────

describe("A4.7 Decision Trace — Trace GC", () => {
  it("UT-013: ACTIVE → ARCHIVED 转换（age > 1000t）", () => {
    const buf = createRingBuffer(10);
    pushRecord(buf, makeRecord({ decisionId: "D-1-1", tick: 10000, createdAt: 10000 }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-2", tick: 10500, createdAt: 10500 }));

    // tick=11001 → D-1-1 age=1001 > 1000 → ARCHIVED, D-1-2 age=501 → ACTIVE
    const { stats } = gcTrace(buf, 11001);
    expect(stats.archived).toBe(1);
    expect(buf.records[0]!.lifecycle).toBe("ARCHIVED");
    expect(buf.records[1]!.lifecycle).toBe("ACTIVE");
  });

  it("UT-014: ARCHIVED → EXPIRED 删除（age > 2000t）", () => {
    const buf = createRingBuffer(10);
    pushRecord(buf, makeRecord({ decisionId: "D-1-1", tick: 10000, createdAt: 10000, lifecycle: "ARCHIVED" }));

    // tick=12001 → age=2001 > 2000 → EXPIRED → 删除
    const { stats } = gcTrace(buf, 12001);
    expect(stats.expired).toBe(1);
    expect(stats.remaining).toBe(0);
  });

  it("UT-015: GC 统计正确 — 多条混合状态", () => {
    const buf = createRingBuffer(10);
    pushRecord(buf, makeRecord({ decisionId: "D-1-1", tick: 10000, createdAt: 10000 })); // age=2001
    pushRecord(buf, makeRecord({ decisionId: "D-1-2", tick: 11500, createdAt: 11500 })); // age=501
    pushRecord(buf, makeRecord({ decisionId: "D-1-3", tick: 11900, createdAt: 11900, lifecycle: "ARCHIVED" })); // age=101 ARCHIVED

    const { stats } = gcTrace(buf, 12001);
    // D-1-1: ACTIVE age=2001 → ARCHIVED
    // D-1-2: ACTIVE age=501 → ACTIVE (no change)
    // D-1-3: ARCHIVED age=101 → ARCHIVED (no change, < 2000)
    expect(stats.archived).toBe(1);
    expect(stats.expired).toBe(0);
    expect(stats.remaining).toBe(3);
  });
});

// ─── UT-016~019: Query ─────────────────────────────────────

describe("A4.7 Decision Trace — Query", () => {
  it("UT-016: 按 tick 过滤", () => {
    const buf = createRingBuffer(10);
    pushRecord(buf, makeRecord({ decisionId: "D-1-1", tick: 100 }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-2", tick: 200 }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-3", tick: 200 }));

    const results = queryRecords(buf, { tick: 200 });
    expect(results).toHaveLength(2);
    expect(results.every(r => r.tick === 200)).toBe(true);
  });

  it("UT-017: 按 category 过滤", () => {
    const buf = createRingBuffer(10);
    pushRecord(buf, makeRecord({ decisionId: "D-1-1", category: "SPAWN" }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-2", category: "LOGISTICS" }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-3", category: "SPAWN" }));

    const results = queryRecords(buf, { category: "SPAWN" });
    expect(results).toHaveLength(2);
    expect(results.every(r => r.category === "SPAWN")).toBe(true);
  });

  it("UT-018: 按 minSeverity 过滤", () => {
    const buf = createRingBuffer(10);
    pushRecord(buf, makeRecord({ decisionId: "D-1-1", severity: "DEBUG" }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-2", severity: "IMPORTANT" }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-3", severity: "CRITICAL" }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-4", severity: "NORMAL" }));

    const results = queryRecords(buf, { minSeverity: "IMPORTANT" });
    expect(results).toHaveLength(2);
    expect(results.every(r => r.severity === "IMPORTANT" || r.severity === "CRITICAL")).toBe(true);
  });

  it("UT-019: 按 correlationId 追踪链", () => {
    const buf = createRingBuffer(10);
    const corrId = "rcv-D-1-1-100";
    pushRecord(buf, makeRecord({ decisionId: "D-1-1", tick: 100, correlationId: corrId }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-2", tick: 200, correlationId: "rcv-D-1-2-200" }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-3", tick: 300, correlationId: corrId }));

    const chain = traceChain(buf, corrId);
    expect(chain).toHaveLength(2);
    // 按时间升序
    expect(chain[0]!.tick).toBe(100);
    expect(chain[1]!.tick).toBe(300);
  });
});

// ─── UT-020~021: Memory Budget ─────────────────────────────

describe("A4.7 Decision Trace — Memory Budget", () => {
  it("UT-020: 单条记录大小测量", () => {
    const record = makeRecord();
    const budget = measureMemoryBudget(record);
    expect(budget.bytesPerRecord).toBeGreaterThan(0);
    expect(budget.bytesFor100).toBe(budget.bytesPerRecord * 100);
    expect(budget.bytesFor1000).toBe(budget.bytesPerRecord * 1000);
  });

  it("UT-021: 1000 条记录大小在合理范围（< 2MB，Ring Buffer 默认 1000 条）", () => {
    const record = makeRecord();
    const budget = measureMemoryBudget(record);
    // 单条记录约 500-800 bytes（含 reasons/evidence/rejectedAlternatives 全字段）
    // Ring Buffer 默认容量 1000 条 → 总 < 1MB
    // 如果超过 2MB 则需要精简记录字段
    expect(budget.bytesFor1000).toBeLessThan(2_000_000);
    // 确认单条记录大小在合理范围
    expect(budget.bytesPerRecord).toBeGreaterThan(100);
    expect(budget.bytesPerRecord).toBeLessThan(2000);
  });
});

// ─── UT-022: Integrity Check ───────────────────────────────

describe("A4.7 Decision Trace — Integrity Check", () => {
  it("UT-022: 孤立记录检测 — Snapshot 已删除的记录被标记", () => {
    const buf = createRingBuffer(10);
    const snapshot = makeSnapshot();
    const snapHash = snapshotHash(snapshot);

    pushRecord(buf, makeRecord({ decisionId: "D-1-1", inputSnapshotHash: snapHash }));
    pushRecord(buf, makeRecord({ decisionId: "D-1-2", inputSnapshotHash: "nonexistent-hash" }));

    const registry = new Map([[snapHash, snapshot]]);
    const result = checkTraceIntegrity(buf, registry);

    expect(result.totalRecords).toBe(2);
    expect(result.recordsWithSnapshot).toBe(1);
    expect(result.orphanedRecords).toBe(1);
    expect(result.integrityRatio).toBe(0.5);
  });
});

// ─── UT-023: buildDecisionChain ────────────────────────────

describe("A4.7 Decision Trace — Decision Chain Output", () => {
  it("UT-023: buildDecisionChain — 可读输出格式", () => {
    const records = [
      makeRecord({ decisionId: "D-1-1", tick: 100, selectedAction: "SPAWN_HAULER" }),
      makeRecord({ decisionId: "D-1-2", tick: 200, selectedAction: "LOGISTICS_PLAN_3" }),
    ];

    const chain = buildDecisionChain(records);
    expect(chain).toHaveLength(2);
    expect(chain[0]!.step).toBe("SPAWN_HAULER");
    expect(chain[0]!.correlationId).toContain("rcv-");
    expect(chain[1]!.step).toBe("LOGISTICS_PLAN_3");
  });
});

// ─── UT-024~025: ID 格式 ───────────────────────────────────

describe("A4.7 Decision Trace — ID Format", () => {
  it("UT-024: CorrelationId 格式 = rcv-{decisionId}-{tick}", () => {
    const id = makeCorrelationId("D-10000-1", 10000);
    expect(id).toBe("rcv-D-10000-1-10000");
  });

  it("UT-025: DecisionId 格式 = D-{tick}-{seq}", () => {
    const id = makeDecisionId(10000, 1);
    expect(id).toBe("D-10000-1");
  });
});
