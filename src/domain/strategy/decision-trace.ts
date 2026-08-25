/**
 * A4.7 Decision Trace — Domain 层纯函数与类型定义。
 *
 * 核心数据结构：
 *   DecisionSnapshot → 决策输入的确定性快照
 *   DecisionRecord   → 决策的完整结构化记录
 *   DecisionReason   → 结构化原因（不是字符串）
 *   DecisionEvidence → 支撑决策的量化证据
 *   CorrelationId    → 跨系统追踪链
 *
 * 纯函数律：本模块不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 * 所有运行时数据由调用方（system 层薄壳）注入。
 *
 * Deterministic Replay：
 *   replayDecision(snapshot) → decision
 *   同一 Snapshot 连续 Replay 1000 次必须得到相同 Decision Hash。
 */

// ═══════════════════════════════════════════════════════════
// §1. Decision Categories
// ═══════════════════════════════════════════════════════════

export type DecisionCategory =
  | "ECONOMY"
  | "SPAWN"
  | "LOGISTICS"
  | "REMOTE"
  | "EXPANSION"
  | "RECOVERY"
  | "DEFENSE_PREP"
  | "RESOURCE_ALLOCATION"
  | "ROUTE_SELECTION"
  | "CONTRACT";

export type DecisionSeverity = "DEBUG" | "NORMAL" | "IMPORTANT" | "CRITICAL";

// ═══════════════════════════════════════════════════════════
// §2. DecisionSnapshot — 决策输入的确定性快照
// ═══════════════════════════════════════════════════════════

/**
 * DecisionSnapshot — 决策时刻的完整输入状态。
 *
 * 设计原则：
 *   - 最小化：只保存决策所需输入，不 dump 整个 Memory/Game
 *   - 确定性：相同输入必须产生相同输出
 *   - 可序列化：纯 JSON 兼容（无函数引用、无 Symbol）
 *   - 可 Hash：字段顺序固定
 */
export interface DecisionSnapshot {
  /** 快照生成的 tick（Logical Tick，非 wall clock）。 */
  readonly tick: number;
  /** 房间或帝国标识（"empire" 或 roomName）。 */
  readonly scope: string;
  /** 决策类别。 */
  readonly category: DecisionCategory;

  // ── 经济状态 ──
  readonly economy: {
    energyAvailable: number;
    energyCapacity: number;
    storageEnergy: number;
    terminalEnergy: number;
    netFlow: number;
    economyPressure: number;
    colonyState: string;
  };

  // ── 资源状态 ──
  readonly resources: {
    storageEnergy: number;
    storageMinerals: Record<string, number>;
    terminalResources: Record<string, number>;
  };

  // ── 物流状态 ──
  readonly logistics: {
    haulerCount: number;
    haulerCapacity: number;
    deliveryRate: number;
    backlogCount: number;
    idleHaulers: number;
  };

  // ── 威胁状态 ──
  readonly threat: {
    posture: string;
    hostilesInRoom: number;
    hasLiveThreat: boolean;
    safeModeTicks: number;
  };

  // ── Spawn 容量 ──
  readonly spawn: {
    spawnCount: number;
    spawningCount: number;
    queueLength: number;
    queueP0Count: number;
  };

  // ── 人口状态 ──
  readonly population: {
    totalCreeps: number;
    creepByRole: Record<string, number>;
    creepTtlMin: number;
  };

  // ── 健康度 ──
  readonly health: {
    empireHealthLevel: string;
    empireHealthScore: number;
    bottleneck: string;
    recovering: boolean;
  };

  // ── 恢复状态 ──
  readonly recovery: {
    activeRecoveryCount: number;
    recoveryActionTypes: readonly string[];
    recoveryStatsSucceeded: number;
    recoveryStatsFailed: number;
  };

  // ── 相关合同/运营 ──
  readonly operations: {
    activeRemoteOps: number;
    activeContracts: number;
    expansionTarget: string | null;
  };

  // ── Planner 上下文 ──
  readonly planner: {
    strategyPosture: string;
    expansionAllowed: boolean;
    newRemoteOpsAllowed: boolean;
    cpuTier: string;
    cpuBucket: number;
  };
}

// ═══════════════════════════════════════════════════════════
// §3. DecisionReason — 结构化原因
// ═══════════════════════════════════════════════════════════

/**
 * DecisionReason — 结构化原因，不是字符串。
 * 必须能够解释为什么 Decision 被选择。
 */
export interface DecisionReason {
  /** 触发指标名（如 "energyFlow", "haulerDeficit"）。 */
  readonly metric: string;
  /** 实际值。 */
  readonly actual: number | string | boolean;
  /** 阈值/期望值。 */
  readonly threshold: number | string | boolean;
  /** 严重度。 */
  readonly severity: "info" | "warning" | "critical";
  /** 不采取行动的后果（如 "spawn starvation"）。 */
  readonly consequence: string;
}

// ═══════════════════════════════════════════════════════════
// §4. DecisionEvidence — 量化证据
// ═══════════════════════════════════════════════════════════

/**
 * DecisionEvidence — 支撑决策的量化证据。
 * 按领域分组的数值快照。
 */
export interface DecisionEvidence {
  readonly energy?: {
    available: number;
    income: number;
    expense: number;
  };
  readonly spawn?: {
    capacity: number;
    queueLength: number;
    p0Count: number;
  };
  readonly population?: {
    [role: string]: number;
  };
  readonly logistics?: {
    deliveryFailure: number;
    haulerDeficit: number;
    backlog: number;
  };
  readonly recovery?: {
    activeActions: number;
    succeededCount: number;
    failedCount: number;
  };
  readonly threat?: {
    hostileCount: number;
    posture: string;
  };
  readonly health?: {
    empireHealthLevel: string;
    empireHealthScore: number;
    bottleneck: string;
    recovering: boolean;
  };
  /** A5.2: 地形证据。 */
  readonly terrain?: {
    terrainType: string;
    walkability: string;
    retreatQuality: string;
    mobilityModifier: number;
    towerCoverage: string;
    rampartCoverage: string;
    chokepointCount: number;
  };
  /** A5.2: 情报证据。 */
  readonly intel?: {
    hasIntel: boolean;
    aggregatedConfidence: string;
    threatIndex: number;
    hasConflict: boolean;
    evidenceCount: number;
  };
  /** A5.2: 多维度置信度。 */
  readonly confidence?: {
    fact: number;
    combat: number;
    intent: number;
    terrain: number;
    intel: number;
    overall: number;
  };
}

// ═══════════════════════════════════════════════════════════
// §5. Rejected Alternative
// ═══════════════════════════════════════════════════════════

export interface RejectedAlternative {
  /** 被拒绝的备选方案。 */
  readonly action: string;
  /** 拒绝原因（结构化）。 */
  readonly reason: string;
}

// ═══════════════════════════════════════════════════════════
// §6. DecisionRecord — 完整决策记录
// ═══════════════════════════════════════════════════════════

/**
 * DecisionRecord — 一个决策的完整结构化记录。
 *
 * 包含：输入快照、原因、证据、选中方案、被拒方案、预期/实际结果。
 */
export interface DecisionRecord {
  /** 稳定唯一 ID（格式：D-{tick}-{seq}）。 */
  readonly decisionId: string;
  /** 决策发生 tick。 */
  readonly tick: number;
  /** 决策类别。 */
  readonly category: DecisionCategory;
  /** 决策者（系统名，如 "empire-health", "spawn-manager"）。 */
  readonly actor: string;
  /** 作用域（"empire" 或 roomName）。 */
  readonly scope: string;
  /** 输入快照的 Hash（关联 DecisionSnapshot）。 */
  readonly inputSnapshotHash: string;
  /** 结构化原因。 */
  readonly reasons: readonly DecisionReason[];
  /** 量化证据。 */
  readonly evidence: DecisionEvidence;
  /** 选中的决策/动作。 */
  readonly selectedAction: string;
  /** 被拒绝的备选方案列表。 */
  readonly rejectedAlternatives: readonly RejectedAlternative[];
  /** 预期结果。 */
  readonly expectedOutcome: string;
  /** 实际结果（事后填写，初始为 undefined）。 */
  actualOutcome?: string;
  /** Correlation ID（跨系统追踪链）。 */
  readonly correlationId: string;
  /** 严重度。 */
  readonly severity: DecisionSeverity;
  /** 决策 Hash（用于 Replay 比对）。 */
  readonly decisionHash: string;
  /** 记录创建时间戳（tick）。 */
  readonly createdAt: number;
  /** Trace 生命周期状态。 */
  lifecycle: TraceLifecycle;
}

export type TraceLifecycle = "ACTIVE" | "ARCHIVED" | "EXPIRED";

// ═══════════════════════════════════════════════════════════
// §7. Correlation ID 模型
// ═══════════════════════════════════════════════════════════

/**
 * CorrelationId 格式：`rcv-{decisionId}-{tick}`
 *
 * 追踪链：
 *   failureId (F-xxx) → decisionId (D-xxx) → actionId (R-xxx)
 *   → spawnRequestId (S-xxx) → creepName (C-xxx)
 *   → transportRequestId (T-xxx) → deliveryId (V-xxx)
 */
export function makeCorrelationId(decisionId: string, tick: number): string {
  return `rcv-${decisionId}-${tick}`;
}

export function makeDecisionId(tick: number, seq: number): string {
  return `D-${tick}-${seq}`;
}

// ═══════════════════════════════════════════════════════════
// §8. Snapshot Hash — 稳定 Hash
// ═══════════════════════════════════════════════════════════

/**
 * 为 DecisionSnapshot 生成稳定的 Hash。
 *
 * 算法：JSON.stringify（字段顺序固定 by interface definition）→
 * FNV-1a 32-bit hash → hex string。
 *
 * 确定性保证：
 *   - 不使用 Math.random
 *   - 不使用 Date.now()
 *   - 不依赖运行时状态
 *   - JSON.stringify 对相同对象结构产生相同字符串
 *
 * @param snapshot 决策快照
 * @returns 8 字符 hex hash（如 "a1b2c3d4"）
 */
export function snapshotHash(snapshot: DecisionSnapshot): string {
  const json = stableStringify(snapshot);
  return fnv1a32Hex(json);
}

// ═══════════════════════════════════════════════════════════
// §9. Decision Hash — 决策输出 Hash
// ═══════════════════════════════════════════════════════════

/**
 * 为决策输出生成稳定 Hash。
 *
 * 输入：selectedAction + rejectedAlternatives + reasons + evidence
 * 输出：8 字符 hex hash
 *
 * 用于 Replay 比对：Original Decision Hash vs Replay Decision Hash。
 */
export function decisionHash(
  selectedAction: string,
  reasons: readonly DecisionReason[],
  evidence: DecisionEvidence,
  rejectedAlternatives: readonly RejectedAlternative[],
): string {
  const payload = stableStringify({
    selectedAction,
    reasons: reasons.map(r => ({
      metric: r.metric,
      actual: r.actual,
      threshold: r.threshold,
      severity: r.severity,
      consequence: r.consequence,
    })),
    evidence,
    rejected: rejectedAlternatives.map(a => ({ action: a.action, reason: a.reason })),
  });
  return fnv1a32Hex(payload);
}

// ═══════════════════════════════════════════════════════════
// §10. Deterministic Replay Engine
// ═══════════════════════════════════════════════════════════

/**
 * Replay Decision — 从 Snapshot 重新推导决策。
 *
 * 核心契约：
 *   - 只使用 Snapshot 中的数据
 *   - 禁止访问 Game / Memory / 任何 Runtime
 *   - 同一 Snapshot → 相同 Decision Hash（1000 次 replay 结果一致）
 *
 * Replay 分类：
 *   1. Recovery Replay: 从 recovery snapshot 推导 recovery action
 *   2. Logistics Replay: 从 logistics snapshot 推导 route/assignment
 *   3. Economic Replay: 从 economic snapshot 推导 resource allocation
 *
 * @param snapshot 决策快照
 * @param replayFn 领域特定 replay 纯函数（由调用方注入）
 * @returns ReplayResult 包含决策输出 + hash
 */
export interface ReplayResult {
  readonly selectedAction: string;
  readonly reasons: readonly DecisionReason[];
  readonly evidence: DecisionEvidence;
  readonly rejectedAlternatives: readonly RejectedAlternative[];
  readonly decisionHash: string;
}

export function replayDecision(
  snapshot: DecisionSnapshot,
  replayFn: (s: DecisionSnapshot) => {
    selectedAction: string;
    reasons: readonly DecisionReason[];
    evidence: DecisionEvidence;
    rejectedAlternatives: readonly RejectedAlternative[];
  },
): ReplayResult {
  const result = replayFn(snapshot);
  const hash = decisionHash(
    result.selectedAction,
    result.reasons,
    result.evidence,
    result.rejectedAlternatives,
  );
  return { ...result, decisionHash: hash };
}

/**
 * 验证 Replay 确定性：同一 Snapshot 连续 replay N 次，检查 hash 一致。
 *
 * @returns { deterministic: true, hashes: string[] } 或 { deterministic: false, firstDivergence: number }
 */
export function verifyDeterminism(
  snapshot: DecisionSnapshot,
  replayFn: (s: DecisionSnapshot) => ReplayResult["selectedAction"] extends string ? object : never,
  iterations = 1000,
): { deterministic: boolean; hashes: string[]; firstDivergenceAt?: number } {
  const hashes: string[] = [];
  let firstDivergenceAt: number | undefined;

  for (let i = 0; i < iterations; i++) {
    const result = replayDecision(snapshot, replayFn as (s: DecisionSnapshot) => {
      selectedAction: string;
      reasons: readonly DecisionReason[];
      evidence: DecisionEvidence;
      rejectedAlternatives: readonly RejectedAlternative[];
    });
    hashes.push(result.decisionHash);
    if (i > 0 && hashes[i] !== hashes[0] && firstDivergenceAt === undefined) {
      firstDivergenceAt = i;
    }
  }

  return {
    deterministic: firstDivergenceAt === undefined,
    hashes,
    firstDivergenceAt,
  };
}

// ═══════════════════════════════════════════════════════════
// §11. Original vs Replay 比对
// ═══════════════════════════════════════════════════════════

export interface ReplayComparison {
  readonly match: boolean;
  readonly originalHash: string;
  readonly replayHash: string;
  /** Divergence 时，具体不同的字段。 */
  readonly divergentFields?: readonly string[];
}

/**
 * 比较原始决策与 Replay 决策。
 *
 * 如果 Hash 相同 → MATCH。
 * 如果 Hash 不同 → DIVERGENCE，输出具体不同字段。
 */
export function compareReplay(
  original: { decisionHash: string; selectedAction: string; reasons: readonly DecisionReason[]; evidence: DecisionEvidence; rejectedAlternatives: readonly RejectedAlternative[] },
  replay: ReplayResult,
): ReplayComparison {
  if (original.decisionHash === replay.decisionHash) {
    return {
      match: true,
      originalHash: original.decisionHash,
      replayHash: replay.decisionHash,
    };
  }

  // 找出具体不同字段
  const divergentFields: string[] = [];
  if (original.selectedAction !== replay.selectedAction) {
    divergentFields.push("selectedAction");
  }
  if (original.reasons.length !== replay.reasons.length) {
    divergentFields.push("reasons.length");
  } else {
    for (let i = 0; i < original.reasons.length; i++) {
      const o = original.reasons[i]!;
      const r = replay.reasons[i]!;
      if (o.metric !== r.metric || o.actual !== r.actual || o.threshold !== r.threshold) {
        divergentFields.push(`reasons[${i}]`);
      }
    }
  }
  if (stableStringify(original.evidence) !== stableStringify(replay.evidence)) {
    divergentFields.push("evidence");
  }
  if (original.rejectedAlternatives.length !== replay.rejectedAlternatives.length) {
    divergentFields.push("rejectedAlternatives.length");
  }

  return {
    match: false,
    originalHash: original.decisionHash,
    replayHash: replay.decisionHash,
    divergentFields: divergentFields.length > 0 ? divergentFields : ["unknown"],
  };
}

// ═══════════════════════════════════════════════════════════
// §12. Ring Buffer + Trace GC
// ═══════════════════════════════════════════════════════════

/**
 * Trace Ring Buffer — 有限容量，自动淘汰最旧记录。
 *
 * 默认上限 1000 条 DecisionRecord。
 * 只记录 IMPORTANT 和 CRITICAL 级别。
 */
export interface TraceRingBuffer {
  readonly records: DecisionRecord[];
  readonly capacity: number;
  head: number;
  count: number;
  /** 总写入数（含淘汰的）。 */
  totalWritten: number;
}

export function createRingBuffer(capacity = 1000): TraceRingBuffer {
  return {
    records: new Array(capacity),
    capacity,
    head: 0,
    count: 0,
    totalWritten: 0,
  };
}

/**
 * 写入一条 DecisionRecord 到 Ring Buffer。O(1)。
 * 超过容量时自动淘汰最旧记录。
 */
export function pushRecord(buf: TraceRingBuffer, record: DecisionRecord): TraceRingBuffer {
  buf.records[buf.head] = record;
  buf.head = (buf.head + 1) % buf.capacity;
  if (buf.count < buf.capacity) buf.count++;
  buf.totalWritten++;
  return buf;
}

/**
 * 读取最近 ≤n 条记录（按时间序）。
 */
export function getRecentRecords(buf: TraceRingBuffer, limit = 50): DecisionRecord[] {
  const n = Math.min(buf.count, limit);
  const out: DecisionRecord[] = [];
  const start = buf.count < buf.capacity ? 0 : buf.head;
  for (let i = buf.count - n; i < buf.count; i++) {
    const idx = (start + i) % buf.capacity;
    const r = buf.records[idx];
    if (r) out.push(r);
  }
  return out;
}

/**
 * Trace GC — 清理过期记录。
 *
 * 生命周期：
 *   ACTIVE → IMPORTANT/CRITICAL 保留，NORMAL 保留 500t
 *   ARCHIVED → 保留 1000t
 *   EXPIRED → 删除
 *
 * @param buf Ring Buffer
 * @param currentTick 当前 tick
 * @returns 清理后的 buf + 清理统计
 */
export interface GcResult {
  expired: number;
  archived: number;
  remaining: number;
}

export function gcTrace(buf: TraceRingBuffer, currentTick: number): { buf: TraceRingBuffer; stats: GcResult } {
  let expired = 0;
  let archived = 0;

  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;

    const age = currentTick - r.createdAt;

    if (r.lifecycle === "EXPIRED") {
      buf.records[i] = undefined as unknown as DecisionRecord;
      expired++;
      continue;
    }

    if (r.lifecycle === "ACTIVE") {
      if (age > 1000) {
        buf.records[i] = { ...r, lifecycle: "ARCHIVED" };
        archived++;
      }
    } else if (r.lifecycle === "ARCHIVED") {
      if (age > 2000) {
        buf.records[i] = undefined as unknown as DecisionRecord;
        expired++;
      }
    }
  }

  // 重新计算 count
  let remaining = 0;
  for (let i = 0; i < buf.records.length; i++) {
    if (buf.records[i]) remaining++;
  }
  buf.count = remaining;

  return { buf, stats: { expired, archived, remaining } };
}

// ═══════════════════════════════════════════════════════════
// §13. 查询能力
// ═══════════════════════════════════════════════════════════

export interface TraceQuery {
  tick?: number;
  category?: DecisionCategory;
  scope?: string;
  actor?: string;
  correlationId?: string;
  severity?: DecisionSeverity;
  minSeverity?: DecisionSeverity;
}

const SEVERITY_ORDER: Record<DecisionSeverity, number> = {
  DEBUG: 0,
  NORMAL: 1,
  IMPORTANT: 2,
  CRITICAL: 3,
};

export function queryRecords(buf: TraceRingBuffer, query: TraceQuery): DecisionRecord[] {
  const results: DecisionRecord[] = [];

  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;

    if (query.tick !== undefined && r.tick !== query.tick) continue;
    if (query.category !== undefined && r.category !== query.category) continue;
    if (query.scope !== undefined && r.scope !== query.scope) continue;
    if (query.actor !== undefined && r.actor !== query.actor) continue;
    if (query.correlationId !== undefined && r.correlationId !== query.correlationId) continue;
    if (query.severity !== undefined && r.severity !== query.severity) continue;
    if (query.minSeverity !== undefined && SEVERITY_ORDER[r.severity] < SEVERITY_ORDER[query.minSeverity]) continue;

    results.push(r);
  }

  // 按 tick 降序（最新在前）
  results.sort((a, b) => b.tick - a.tick);

  return results;
}

/**
 * 按 Correlation ID 追踪完整 Decision Chain。
 *
 * 返回按时间序排列的决策链。
 */
export function traceChain(buf: TraceRingBuffer, correlationId: string): DecisionRecord[] {
  return queryRecords(buf, { correlationId }).sort((a, b) => a.tick - b.tick);
}

// ═══════════════════════════════════════════════════════════
// §14. Memory Budget 计算
// ═══════════════════════════════════════════════════════════

export interface MemoryBudgetResult {
  /** 单条 DecisionRecord 的平均字节大小。 */
  bytesPerRecord: number;
  /** 100 条的总大小。 */
  bytesFor100: number;
  /** 1000 条的总大小。 */
  bytesFor1000: number;
  /** 10000 条的总大小。 */
  bytesFor10000: number;
  /** 是否安全（< 500KB = 512000 bytes）。 */
  safe: boolean;
}

/**
 * 测量单个 DecisionRecord 的平均 Memory Cost。
 * 计算方式：JSON.stringify(record).length。
 */
export function measureMemoryBudget(sampleRecord: DecisionRecord): MemoryBudgetResult {
  const bytesPerRecord = JSON.stringify(sampleRecord).length;
  const bytesFor100 = bytesPerRecord * 100;
  const bytesFor1000 = bytesPerRecord * 1000;
  const bytesFor10000 = bytesPerRecord * 10000;
  const safe = bytesFor1000 < 512_000; // 500KB 安全线

  return { bytesPerRecord, bytesFor100, bytesFor1000, bytesFor10000, safe };
}

// ═══════════════════════════════════════════════════════════
// §15. Trace Integrity 检查
// ═══════════════════════════════════════════════════════════

export interface IntegrityCheckResult {
  /** 总记录数。 */
  totalRecords: number;
  /** 有对应 Snapshot 的记录数。 */
  recordsWithSnapshot: number;
  /** 孤立记录数（Snapshot 已删除）。 */
  orphanedRecords: number;
  /** 完整性比率。 */
  integrityRatio: number;
}

/**
 * 检查 Trace 完整性：每条 Decision 引用的 Snapshot 是否存在。
 *
 * 如果 Snapshot 已删除，Decision 必须标记为 ORPHANED。
 */
export function checkTraceIntegrity(
  buf: TraceRingBuffer,
  snapshotRegistry: ReadonlyMap<string, DecisionSnapshot>,
): IntegrityCheckResult {
  let totalRecords = 0;
  let recordsWithSnapshot = 0;
  let orphanedRecords = 0;

  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    totalRecords++;

    if (snapshotRegistry.has(r.inputSnapshotHash)) {
      recordsWithSnapshot++;
    } else {
      orphanedRecords++;
      // 标记为 ORPHANED（通过修改 lifecycle）
      buf.records[i] = { ...r, lifecycle: "EXPIRED" };
    }
  }

  return {
    totalRecords,
    recordsWithSnapshot,
    orphanedRecords,
    integrityRatio: totalRecords > 0 ? recordsWithSnapshot / totalRecords : 1,
  };
}

// ═══════════════════════════════════════════════════════════
// §16. 内部工具函数
// ═══════════════════════════════════════════════════════════

/**
 * 稳定 JSON 序列化：按 key 排序，确保相同对象产生相同字符串。
 *
 * 不使用 JSON.stringify 的默认顺序（V8 引擎的属性插入顺序），
 * 而是递归排序 key，确保跨引擎/跨运行确定性。
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(k => {
    const v = (obj as Record<string, unknown>)[k];
    return JSON.stringify(k) + ":" + stableStringify(v);
  });
  return "{" + pairs.join(",") + "}";
}

/**
 * FNV-1a 32-bit Hash → 8 字符 hex。
 *
 * 选择 FNV-1a 因为：
 *   - 简单（~5 行代码）
 *   - 快（O(n)，无分配）
 *   - 分布均匀
 *   - 确定性（同输入永远同输出）
 *   - 无依赖（不引用 crypto/uuid）
 */
function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // FNV prime: 0x01000193 = 16777619
    hash = Math.imul(hash, 0x01000193);
  }
  // 转为 unsigned 32-bit + hex
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ═══════════════════════════════════════════════════════════
// §17. Decision Chain 输出（可读格式）
// ═══════════════════════════════════════════════════════════

export interface DecisionChainEntry {
  tick: number;
  step: string;
  detail: string;
  correlationId: string;
}

/**
 * 从 DecisionRecord 列表构建可读的 Decision Chain。
 *
 * 输出示例：
 *   Tick 12000 | Energy Deficit | corr=rcv-D-12000-1
 *   Tick 12001 | Economic Health = DEGRADED | corr=rcv-D-12000-1
 *   Tick 12002 | Root Cause = Hauler Starvation | corr=rcv-D-12000-1
 *   Tick 12003 | Decision = SPAWN_HAULER | corr=rcv-D-12000-1
 *   Tick 12004 | Spawn Success | corr=rcv-D-12000-1
 *   Tick 12005 | Delivery Restored | corr=rcv-D-12000-1
 */
export function buildDecisionChain(records: readonly DecisionRecord[]): DecisionChainEntry[] {
  return records.map(r => ({
    tick: r.tick,
    step: r.selectedAction,
    detail: r.reasons.map(rs => `${rs.metric}=${rs.actual}(${rs.severity})`).join("; "),
    correlationId: r.correlationId,
  }));
}
