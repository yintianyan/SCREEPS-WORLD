/** A6.1 Experience Model — Domain 层纯函数与类型定义。 */

// ═══════════════════════════════════════════════════════════
// §1. Experience Types
// ═══════════════════════════════════════════════════════════

/** 经验类型 — 映射到已有 DecisionCategory 的子集。 */
export type ExperienceType =
  | "war"
  | "expansion"
  | "economic"
  | "defense"
  | "logistics"
  | "spawn"
  | "recovery";

/** 经验生命周期状态。 */
export type ExperienceLifecycle =
  | "OBSERVED"     // 决策已观测到，Outcome 尚未采集
  | "OPEN"         // Outcome 采集中
  | "EVALUATING"   // 归因评估中
  | "ATTRIBUTED"   // 归因完成
  | "FINALIZED"     // 最终化（不可修改）
  | "ARCHIVED"      // 已归档
  | "EXPIRED"       // DecisionRecord 已被 GC，无法采集
  | "UNRESOLVED";   // 无法确定结果

/** 结果分类 — 禁止简单二元化。 */
export type OutcomeClassification =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "FAILURE"
  | "ABORTED"
  | "EXPIRED"
  | "UNKNOWN";

/** 归因方法。 */
export type AttributionMethod =
  | "direct"         // 直接归因（单因单果）
  | "correlation"    // 相关性归因（统计相关）
  | "expert"         // 专家规则归因（CONFIG 规则）
  | "unknown";       // 无法可靠归因

/** 归因因素 — 尝试回答"为什么成功/失败"。 */
export type AttributionFactor =
  | "DECISION_QUALITY"
  | "EXECUTION_QUALITY"
  | "RESOURCE_AVAILABILITY"
  | "LOGISTICS_QUALITY"
  | "COMBAT_OUTCOME"
  | "EXTERNAL_THREAT"
  | "TIMING"
  | "INFRASTRUCTURE"
  | "INTEL_QUALITY"
  | "ECONOMIC_GUARD"
  | "UNKNOWN";

// ═══════════════════════════════════════════════════════════
// §2. Experience Identity
// ═══════════════════════════════════════════════════════════

/** 经验的稳定唯一标识。 */
export interface ExperienceIdentity {
  /** 稳定唯一 ID（格式：E-{tick}-{seq}）。 */
  readonly experienceId: string;
  /** 经验记录 tick（不是决策 tick）。 */
  readonly tick: number;
  /** 经验来源（如 "experience-collector"）。 */
  readonly source: string;
  /** 经验类型。 */
  readonly type: ExperienceType;
}

// ═══════════════════════════════════════════════════════════
// §3. Decision Reference — 引用 A4.7 DecisionRecord
// ═══════════════════════════════════════════════════════════

/**
 * DecisionRef — 对 A4.7 DecisionRecord 的轻量引用。

 * 不复制完整 DecisionRecord，只存摘要 + decisionId。
 * 可通过 decisionId 从 Ring Buffer 追溯到完整记录。
 */
export interface DecisionRef {
  /** 关联的 DecisionRecord ID（A4.7 DecisionTrace）。 */
  readonly decisionId: string;
  /** 决策发生 tick。 */
  readonly decisionTick: number;
  /** 决策类别（来自 DecisionRecord.category）。 */
  readonly category: string;
  /** 决策者（来自 DecisionRecord.actor）。 */
  readonly actor: string;
  /** 选中的动作（来自 DecisionRecord.selectedAction）。 */
  readonly selectedAction: string;
  /** 决策 hash（来自 DecisionRecord.decisionHash，可 Replay）。 */
  readonly decisionHash: string;
  /** Correlation ID（跨系统追踪链）。 */
  readonly correlationId: string;
}

// ═══════════════════════════════════════════════════════════
// §4. Experience Context
// ═══════════════════════════════════════════════════════════

/**
 * 决策时的上下文摘要。

 * 不存完整状态快照（太大），只存关键指标 + stateHash。
 */
export interface ExperienceContext {
  /** 作用域（"empire" 或 roomName）。 */
  readonly scope: string;
  /** 帝国姿态（如 "develop" / "war" / "fortify"）。 */
  readonly posture: string;
  /** 帝国健康度等级。 */
  readonly empireHealthLevel: string;
  /** 帝国健康度分数。 */
  readonly empireHealthScore: number;
  /** CPU 档位。 */
  readonly cpuTier: string;
  /** 决策前状态 hash（来自 DecisionSnapshot hash）。 */
  readonly stateBeforeHash: string;
  /** 关键上下文指标（按类型不同）。 */
  readonly metrics: Readonly<Record<string, number>>;
}

// ═══════════════════════════════════════════════════════════
// §5. Outcome Record
// ═══════════════════════════════════════════════════════════

/**
 * OutcomeRecord — 决策执行后的世界状态变化。

 * 消费已有系统的产出（evaluateWarOutcome / empireHealth / recoveryStats），
 * 不建立第二套 Outcome 评估。
 */
export interface OutcomeRecord {
  /** 关联的 DecisionRecord ID。 */
  readonly decisionId: string;
  /** 决策发生 tick。 */
  readonly decisionTick: number;
  /** 结果测量 tick。 */
  readonly measurementTick: number;
  /** 测量延迟（measurementTick - decisionTick）。 */
  readonly delay: number;

  // ── 结果量化 ──
  /** 结果分类。 */
  readonly classification: OutcomeClassification;
  /** 结果指标名（如 "warOutcome", "healthDelta", "energyDelta"）。 */
  readonly metric: string;
  /** 量化值。 */
  readonly value: number;
  /** 结果数据来源（已有系统名）。 */
  readonly source: string;

  // ── 状态变化 ──
  /** 结果测量时的状态 hash。 */
  readonly stateAfterHash: string;
  /** 关键状态 delta。 */
  readonly stateDelta: StateDelta;
}

/** 关键状态变化量。 */
export interface StateDelta {
  /** 能量变化。 */
  readonly energyDelta?: number;
  /** 人口变化。 */
  readonly populationDelta?: number;
  /** 健康度变化。 */
  readonly healthDelta?: number;
  /** 威胁变化。 */
  readonly threatDelta?: number;
  /** 活跃恢复数量变化。 */
  readonly recoveryDelta?: number;
}

// ═══════════════════════════════════════════════════════════
// §6. Attribution
// ═══════════════════════════════════════════════════════════

/**
 * 单条 Evidence — 可追溯到事实的证据。

 * 禁止 "if failed then cause = logistics" 这种无证据归因。
 * 每一个 attribution 都应该能够追溯到 Evidence。
 */
export interface AttributionEvidence {
  /** 证据指标名。 */
  readonly metric: string;
  /** 实际值。 */
  readonly actual: number | string | boolean;
  /** 判定阈值。 */
  readonly threshold: number | string | boolean;
  /** 证据指向的因素。 */
  readonly suggestsFactor: AttributionFactor;
  /** 证据强度（0-1）。 */
  readonly strength: number;
}

/**
 * Attribution — 结果归因。

 * Evidence-based：每条 attribution 都有 evidence 支撑。
 * 形成可审计链：Experience → Attribution → Evidence → DecisionTrace。
 */
export interface Attribution {
  /** 主要归因因素。 */
  readonly primaryCause: AttributionFactor;
  /** 次要因素。 */
  readonly contributingFactors: readonly AttributionFactor[];
  /** 外部因素。 */
  readonly externalFactors: readonly AttributionFactor[];
  /** 系统归因（哪个系统对结果负责）。 */
  readonly systemAttribution: string;
  /** 归因置信度（0-1）。 */
  readonly confidence: number;
  /** 归因方法。 */
  readonly method: AttributionMethod;
  /** 支撑证据列表。 */
  readonly evidence: readonly AttributionEvidence[];
  /** 归因 hash（确定性验证）。 */
  readonly attributionHash: string;
}

// ═══════════════════════════════════════════════════════════
// §7. Experience Record
// ═══════════════════════════════════════════════════════════

/**
 * ExperienceRecord — 完整经验记录。

 * = Identity + DecisionRef + Context + Outcome + Attribution

 * 不复制完整 DecisionRecord，只引用 decisionId。
 * 不存完整状态快照，只存 stateHash。
 */
export interface ExperienceRecord {
  // ── 标识 ──
  readonly identity: ExperienceIdentity;

  // ── 决策引用 ──
  readonly decision: DecisionRef;

  // ── 上下文 ──
  readonly context: ExperienceContext;

  // ── 结果 ──
  outcome: OutcomeRecord | undefined;

  // ── 归因 ──
  attribution: Attribution | undefined;

  // ── 元数据 ──
  /** 产出此 Experience 的模型版本。 */
  readonly modelVersion: number;
  /** 记录创建 tick。 */
  readonly createdAt: number;
  /** 生命周期状态。 */
  lifecycle: ExperienceLifecycle;
}

// ═══════════════════════════════════════════════════════════
// §8. Experience Ring Buffer
// ═══════════════════════════════════════════════════════════

/** Experience Ring Buffer — 固定长度环形缓冲。 */
export interface ExperienceRingBuffer {
  /** 底层数组。 */
  records: (ExperienceRecord | undefined)[];
  /** 容量。 */
  capacity: number;
  /** 当前条数。 */
  count: number;
  /** 总写入数（含覆盖）。 */
  totalWritten: number;
  /** 写入游标（环形覆盖位置）。 */
  cursor: number;
}

/**
 * 创建 Experience Ring Buffer。
 */
export function createExperienceRingBuffer(capacity: number): ExperienceRingBuffer {
  return {
    records: new Array(capacity).fill(undefined),
    capacity,
    count: 0,
    totalWritten: 0,
    cursor: 0,
  };
}

/**
 * 向 Ring Buffer 写入一条 Experience（环形覆盖最旧数据）。
 */
export function pushExperience(
  buf: ExperienceRingBuffer,
  record: ExperienceRecord,
): void {
  buf.records[buf.cursor] = record;
  buf.cursor = (buf.cursor + 1) % buf.capacity;
  buf.totalWritten++;
  if (buf.count < buf.capacity) buf.count++;
}

/**
 * 获取最近的 N 条 Experience。
 */
export function getRecentExperiences(
  buf: ExperienceRingBuffer,
  limit: number,
): ExperienceRecord[] {
  const result: ExperienceRecord[] = [];
  const start = (buf.cursor - 1 + buf.capacity) % buf.capacity;
  for (let i = 0; i < buf.count && i < limit; i++) {
    const idx = (start - i + buf.capacity) % buf.capacity;
    const r = buf.records[idx];
    if (r) result.push(r);
  }
  return result;
}

/**
 * 获取所有未归因的 Experience（lifecycle = OBSERVED / OPEN / EVALUATING）。
 */
export function getUnattributed(buf: ExperienceRingBuffer): ExperienceRecord[] {
  const result: ExperienceRecord[] = [];
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (
      r.lifecycle === "OBSERVED" ||
      r.lifecycle === "OPEN" ||
      r.lifecycle === "EVALUATING"
    ) {
      result.push(r);
    }
  }
  // 按 tick 升序（最旧优先处理）
  result.sort((a, b) => a.identity.tick - b.identity.tick);
  return result;
}

/**
 * 获取所有未采集 Outcome 的 Experience（outcome === undefined）。
 */
export function getPendingOutcomes(buf: ExperienceRingBuffer): ExperienceRecord[] {
  const result: ExperienceRecord[] = [];
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (r.outcome === undefined && r.lifecycle !== "EXPIRED") {
      result.push(r);
    }
  }
  result.sort((a, b) => a.identity.tick - b.identity.tick);
  return result;
}

// ═══════════════════════════════════════════════════════════
// §9. Experience Construction
// ═══════════════════════════════════════════════════════════

/**
 * 创建 Experience ID（确定性：E-{tick}-{seq}）。
 */
export function makeExperienceId(tick: number, seq: number): string {
  return `E-${tick}-${seq}`;
}

/**
 * 构建 DecisionRef from DecisionRecord 摘要字段。

 * 只提取必要字段，不复制完整 DecisionRecord。
 */
export function buildDecisionRef(input: {
  decisionId: string;
  tick: number;
  category: string;
  actor: string;
  selectedAction: string;
  decisionHash: string;
  correlationId: string;
}): DecisionRef {
  return {
    decisionId: input.decisionId,
    decisionTick: input.tick,
    category: input.category,
    actor: input.actor,
    selectedAction: input.selectedAction,
    decisionHash: input.decisionHash,
    correlationId: input.correlationId,
  };
}

/**
 * 创建新的 ExperienceRecord（初始 lifecycle = OBSERVED）。

 * 纯函数 — 不修改输入参数，返回新对象。
 */
export function createExperience(
  identity: ExperienceIdentity,
  decision: DecisionRef,
  context: ExperienceContext,
  modelVersion: number,
): ExperienceRecord {
  return {
    identity,
    decision,
    context,
    outcome: undefined,
    attribution: undefined,
    modelVersion,
    createdAt: identity.tick,
    lifecycle: "OBSERVED",
  };
}

/**
 * 为 Experience 附加 Outcome。

 * 返回新对象（不可变更新）。
 * lifecycle: OBSERVED → OPEN。
 */
export function attachOutcome(
  exp: ExperienceRecord,
  outcome: OutcomeRecord,
): ExperienceRecord {
  return {
    ...exp,
    outcome,
    lifecycle: "OPEN",
  };
}

/**
 * 为 Experience 附加 Attribution。

 * 返回新对象（不可变更新）。
 * lifecycle: OPEN → ATTRIBUTED。
 */
export function attachAttribution(
  exp: ExperienceRecord,
  attribution: Attribution,
): ExperienceRecord {
  return {
    ...exp,
    attribution,
    lifecycle: "ATTRIBUTED",
  };
}

/**
 * 最终化 Experience（不可变更新）。
 * lifecycle: ATTRIBUTED → FINALIZED。
 */
export function finalizeExperience(exp: ExperienceRecord): ExperienceRecord {
  return { ...exp, lifecycle: "FINALIZED" };
}

/**
 * 标记 Experience 为 EXPIRED（DecisionRecord 已被 GC）。
 */
export function expireExperience(exp: ExperienceRecord): ExperienceRecord {
  return { ...exp, lifecycle: "EXPIRED" };
}

/**
 * 标记 Experience 为 UNRESOLVED（无法确定结果）。
 */
export function unresolveExperience(exp: ExperienceRecord): ExperienceRecord {
  return { ...exp, lifecycle: "UNRESOLVED" };
}

// ═══════════════════════════════════════════════════════════
// §10. Measurement Delay
// ═══════════════════════════════════════════════════════════

/**
 * 各 Experience 类型的默认测量延迟（tick）。

 * 决策后多少 tick 才能可靠测量结果。
 */
export const MEASUREMENT_DELAYS: Readonly<Record<ExperienceType, number>> = {
  war: 500,
  expansion: 2000,
  economic: 500,
  defense: 200,
  logistics: 200,
  spawn: 150,
  recovery: 100,
};

/**
 * 判断 DecisionRecord 是否已到期（可以采集 Outcome）。

 * 纯函数 — 不依赖运行时状态。
 */
export function isDecisionReadyForOutcome(
  decisionTick: number,
  currentTick: number,
  type: ExperienceType,
): boolean {
  const delay = MEASUREMENT_DELAYS[type] ?? 500;
  return currentTick - decisionTick >= delay;
}

/**
 * 将 DecisionCategory 映射到 ExperienceType。
 */
export function categoryToExperienceType(category: string): ExperienceType {
  switch (category) {
    case "MILITARY": return "war";
    case "EXPANSION": return "expansion";
    case "ECONOMY": return "economic";
    case "DEFENSE_PREP": return "defense";
    case "LOGISTICS": return "logistics";
    case "SPAWN": return "spawn";
    case "RECOVERY": return "recovery";
    case "REMOTE": return "logistics";
    case "RESOURCE_ALLOCATION": return "economic";
    case "ROUTE_SELECTION": return "logistics";
    case "CONTRACT": return "economic";
    default: return "economic";
  }
}

// ═══════════════════════════════════════════════════════════
// §11. Experience Ring Buffer GC
// ═══════════════════════════════════════════════════════════

/**
 * 清理 Ring Buffer 中过老的记录。

 * 删除超过 maxAge tick 的记录（设为 undefined）。
 * 不改变 cursor 位置，只释放空间。
 */
export function gcExperienceBuffer(
  buf: ExperienceRingBuffer,
  currentTick: number,
  maxAge: number,
): { cleaned: number } {
  let cleaned = 0;
  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    if (currentTick - r.identity.tick > maxAge) {
      buf.records[i] = undefined;
      cleaned++;
      if (buf.count > 0) buf.count--;
    }
  }
  return { cleaned };
}

/**
 * 统计 Ring Buffer 中的 Experience 分布。

 * 用于可观测性：各类经验数量、归因率、未知率。
 */
export function experienceStats(buf: ExperienceRingBuffer): {
  total: number;
  byType: Record<string, number>;
  byLifecycle: Record<string, number>;
  attributed: number;
  unattributed: number;
  unknownAttribution: number;
} {
  let total = 0;
  const byType: Record<string, number> = {};
  const byLifecycle: Record<string, number> = {};
  let attributed = 0;
  let unattributed = 0;
  let unknownAttribution = 0;

  for (let i = 0; i < buf.records.length; i++) {
    const r = buf.records[i];
    if (!r) continue;
    total++;
    byType[r.identity.type] = (byType[r.identity.type] ?? 0) + 1;
    byLifecycle[r.lifecycle] = (byLifecycle[r.lifecycle] ?? 0) + 1;

    if (r.attribution) {
      attributed++;
      if (r.attribution.primaryCause === "UNKNOWN" || r.attribution.method === "unknown") {
        unknownAttribution++;
      }
    } else {
      unattributed++;
    }
  }

  return { total, byType, byLifecycle, attributed, unattributed, unknownAttribution };
}
