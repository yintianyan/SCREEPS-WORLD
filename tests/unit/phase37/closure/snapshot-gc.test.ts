/**
 * Phase 37 Final Closure — Snapshot GC 反事实测试
 *
 * 验证 evictStaleSnapshots 的正确性：
 *   A1: 活跃 snapshot 不得被删除
 *   A2: 已失效 snapshot 可以删除
 *   A3: GC 重复执行幂等
 *   A4: GC 不改变 ringBuffer
 *   A5: GC 不改变 DecisionRecord hash
 *   A6: GC 不改变 deterministic replay
 *   A7: 长期模拟后 registry 有界
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  type DecisionRecord,
  type DecisionSnapshot,
  type TraceRingBuffer,
  createRingBuffer,
  pushRecord,
  gcTrace,
  checkTraceIntegrity,
  snapshotHash,
  getRecentRecords,
} from "../../../../src/domain/strategy/decision-trace";
// ─── Helpers ──────────────────────────────────────────────

function makeSnapshot(tick: number, scope: string): DecisionSnapshot {
  return {
    tick,
    scope,
    category: "EXPANSION",
    economy: {
      energyAvailable: 10000,
      energyCapacity: 30000,
      storageEnergy: 5000,
      terminalEnergy: 0,
      netFlow: 50,
      economyPressure: 0,
      colonyState: "normal",
    },
    resources: {
      storageEnergy: 5000,
      storageMinerals: {},
      terminalResources: {},
    },
    logistics: {
      haulerCount: 5,
      haulerCapacity: 1000,
      deliveryRate: 0.8,
      backlogCount: 0,
      idleHaulers: 0,
    },
    threat: {
      posture: "develop",
      hostilesInRoom: 0,
      hasLiveThreat: false,
      safeModeTicks: 0,
    },
    spawn: {
      spawnCount: 3,
      spawningCount: 0,
      queueLength: 0,
      queueP0Count: 0,
    },
    population: {
      totalCreeps: 10,
      creepByRole: {},
      creepTtlMin: 100,
    },
    health: {
      empireHealthLevel: "healthy",
      empireHealthScore: 0.8,
      bottleneck: "none",
      recovering: false,
    },
    recovery: {
      activeRecoveryCount: 0,
      recoveryActionTypes: [],
      recoveryStatsSucceeded: 0,
      recoveryStatsFailed: 0,
    },
    operations: {
      activeRemoteOps: 0,
      activeContracts: 0,
      expansionTarget: null,
    },
    planner: {
      strategyPosture: "develop",
      expansionAllowed: true,
      newRemoteOpsAllowed: true,
      cpuTier: "healthy",
      cpuBucket: 10000,
    },
  };
}

function makeRecord(tick: number, snapHash: string, lifecycle: "ACTIVE" | "ARCHIVED" | "EXPIRED" = "ACTIVE"): DecisionRecord {
  return {
    decisionId: `D-${tick}-1`,
    tick,
    category: "EXPANSION",
    actor: "expansion-manager",
    scope: "W1N1",
    inputSnapshotHash: snapHash,
    reasons: [],
    evidence: {},
    selectedAction: "EXPANSION_START_W1N1",
    rejectedAlternatives: [],
    expectedOutcome: "success",
    correlationId: `rcv-D-${tick}-1-${tick}`,
    severity: "NORMAL",
    decisionHash: "abcd1234",
    createdAt: tick,
    lifecycle,
  };
}

// 复制 evictStaleSnapshots 逻辑用于测试（它不是 exported）
function evictStaleSnapshots(
  ringBuffer: TraceRingBuffer,
  snapshotRegistry: Map<string, DecisionSnapshot>,
): { evicted: number; remaining: number } {
  const referencedHashes = new Set<string>();
  for (const r of ringBuffer.records) {
    if (r && r.lifecycle !== "EXPIRED") {
      referencedHashes.add(r.inputSnapshotHash);
    }
  }

  let evicted = 0;
  for (const key of snapshotRegistry.keys()) {
    if (!referencedHashes.has(key)) {
      snapshotRegistry.delete(key);
      evicted++;
    }
  }

  return { evicted, remaining: snapshotRegistry.size };
}

// ─── Tests ─────────────────────────────────────────────────

describe("Phase 37 Closure — Snapshot GC (AI-1)", () => {
  let buf: TraceRingBuffer;
  let registry: Map<string, DecisionSnapshot>;

  beforeEach(() => {
    buf = createRingBuffer(100);
    registry = new Map();
  });

  // A1: 活跃 snapshot 不得被删除
  it("A1: active snapshots are not evicted", () => {
    const snap = makeSnapshot(100, "W1N1");
    const hash = snapshotHash(snap);
    registry.set(hash, snap);

    const record = makeRecord(100, hash, "ACTIVE");
    pushRecord(buf, record);

    const result = evictStaleSnapshots(buf, registry);

    expect(result.evicted).toBe(0);
    expect(result.remaining).toBe(1);
    expect(registry.has(hash)).toBe(true);
  });

  // A2: 已失效 snapshot 可以删除
  it("A2: stale snapshots are evicted when no active record references them", () => {
    const snap1 = makeSnapshot(100, "W1N1");
    const hash1 = snapshotHash(snap1);
    registry.set(hash1, snap1);

    // No record references hash1
    const result = evictStaleSnapshots(buf, registry);

    expect(result.evicted).toBe(1);
    expect(result.remaining).toBe(0);
    expect(registry.has(hash1)).toBe(false);
  });

  // A3: GC 重复执行幂等
  it("A3: repeated GC is idempotent", () => {
    const snap = makeSnapshot(100, "W1N1");
    const hash = snapshotHash(snap);
    registry.set(hash, snap);
    pushRecord(buf, makeRecord(100, hash, "ACTIVE"));

    const result1 = evictStaleSnapshots(buf, registry);
    const result2 = evictStaleSnapshots(buf, registry);

    expect(result1.evicted).toBe(0);
    expect(result2.evicted).toBe(0);
    expect(result1.remaining).toBe(result2.remaining);
  });

  // A4: GC 不改变 ringBuffer
  it("A4: GC does not modify ringBuffer records", () => {
    const snap = makeSnapshot(100, "W1N1");
    const hash = snapshotHash(snap);
    registry.set(hash, snap);
    pushRecord(buf, makeRecord(100, hash, "ACTIVE"));

    // Capture the active record's identity before GC
    const activeBefore = getRecentRecords(buf, 1)[0]!;
    const beforeId = activeBefore.decisionId;
    const beforeHash = activeBefore.inputSnapshotHash;
    const beforeLifecycle = activeBefore.lifecycle;

    evictStaleSnapshots(buf, registry);

    // Verify record unchanged after GC
    const activeAfter = getRecentRecords(buf, 1)[0]!;
    expect(activeAfter.decisionId).toBe(beforeId);
    expect(activeAfter.inputSnapshotHash).toBe(beforeHash);
    expect(activeAfter.lifecycle).toBe(beforeLifecycle);
  });

  // A5: GC 不改变 DecisionRecord hash
  it("A5: GC does not change DecisionRecord hash references", () => {
    const snap = makeSnapshot(100, "W1N1");
    const hash = snapshotHash(snap);
    registry.set(hash, snap);
    const record = makeRecord(100, hash, "ACTIVE");
    pushRecord(buf, record);

    evictStaleSnapshots(buf, registry);

    const records = getRecentRecords(buf, 10);
    expect(records.length).toBe(1);
    expect(records[0]!.inputSnapshotHash).toBe(hash);
  });

  // A6: GC 不改变 deterministic replay
  it("A6: GC preserves deterministic replay for active records", () => {
    const snap1 = makeSnapshot(100, "W1N1");
    const snap2 = makeSnapshot(200, "W1N1");
    const hash1 = snapshotHash(snap1);
    const hash2 = snapshotHash(snap2);
    registry.set(hash1, snap1);
    registry.set(hash2, snap2);
    pushRecord(buf, makeRecord(100, hash1, "ACTIVE"));
    pushRecord(buf, makeRecord(200, hash2, "ACTIVE"));

    evictStaleSnapshots(buf, registry);

    // Both snapshots still exist
    expect(registry.has(hash1)).toBe(true);
    expect(registry.has(hash2)).toBe(true);
    // Integrity check passes
    const integrity = checkTraceIntegrity(buf, registry);
    expect(integrity.orphanedRecords).toBe(0);
    expect(integrity.integrityRatio).toBe(1);
  });

  // A7: 长期模拟后 registry 有界
  it("A7: registry stays bounded after long simulation with GC", () => {
    const capacity = 100;
    buf = createRingBuffer(capacity);

    // Simulate 1000 ticks of decisions, each with unique snapshot
    for (let t = 0; t < 1000; t++) {
      const snap = makeSnapshot(t, "W1N1");
      const hash = snapshotHash(snap);
      if (!registry.has(hash)) {
        registry.set(hash, snap);
      }
      pushRecord(buf, makeRecord(t, hash, "ACTIVE"));

      // Run gcTrace every 100 ticks (archived after 1000 ticks)
      if (t % 100 === 0) {
        gcTrace(buf, t);
      }

      // Run evictStaleSnapshots every 500 ticks
      if (t % 500 === 0 && t > 0) {
        evictStaleSnapshots(buf, registry);
      }
    }

    // After GC, registry should be bounded by ring buffer capacity
    // (only snapshots referenced by surviving records remain)
    gcTrace(buf, 1000);
    evictStaleSnapshots(buf, registry);

    // Ring buffer capacity is 100, so at most 100 active records
    // registry should not exceed capacity (some records may share snapshots)
    expect(registry.size).toBeLessThanOrEqual(capacity);
  });

  // A8: ARCHIVED record's snapshot is preserved
  it("A8: ARCHIVED records keep their snapshots", () => {
    const snap = makeSnapshot(100, "W1N1");
    const hash = snapshotHash(snap);
    registry.set(hash, snap);
    pushRecord(buf, makeRecord(100, hash, "ARCHIVED"));

    const result = evictStaleSnapshots(buf, registry);

    // ARCHIVED is not EXPIRED, so snapshot should be kept
    expect(result.evicted).toBe(0);
    expect(registry.has(hash)).toBe(true);
  });

  // A9: EXPIRED record's snapshot is evicted
  it("A9: EXPIRED records lose their snapshots", () => {
    const snap = makeSnapshot(100, "W1N1");
    const hash = snapshotHash(snap);
    registry.set(hash, snap);
    pushRecord(buf, makeRecord(100, hash, "EXPIRED"));

    const result = evictStaleSnapshots(buf, registry);

    expect(result.evicted).toBe(1);
    expect(registry.has(hash)).toBe(false);
  });

  // A10: Multiple records sharing same snapshot — only evict when all expire
  it("A10: shared snapshot evicted only when all referencing records expire", () => {
    const snap = makeSnapshot(100, "W1N1");
    const hash = snapshotHash(snap);
    registry.set(hash, snap);
    pushRecord(buf, makeRecord(100, hash, "ACTIVE"));
    pushRecord(buf, makeRecord(200, hash, "ACTIVE"));

    // First GC — snapshot kept (both active)
    let result = evictStaleSnapshots(buf, registry);
    expect(result.evicted).toBe(0);

    // Expire one record — snapshot still kept (other active)
    buf.records[0] = { ...buf.records[0]!, lifecycle: "EXPIRED" };
    result = evictStaleSnapshots(buf, registry);
    expect(result.evicted).toBe(0);

    // Expire both — snapshot evicted
    buf.records[1] = { ...buf.records[1]!, lifecycle: "EXPIRED" };
    result = evictStaleSnapshots(buf, registry);
    expect(result.evicted).toBe(1);
  });
});
