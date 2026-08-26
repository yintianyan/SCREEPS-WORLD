/**
 * UOEM — Unified Outcome Event Model Type Foundation.
 *
 * Phase 38-B STEP 1.1：纯类型定义，零 Runtime 行为变更。
 *
 * 核心概念分离：
 *   Operation ≠ Decision
 *   Milestone ≠ Outcome
 *   Outcome ≠ Aggregate
 *   Latest State ≠ Event History
 *   Timeout ≠ Terminality
 *   RecordedAt ≠ OccurredAt
 *
 * 纯类型律：不引用 Game / Memory / RawMemory / CPU / 任何全局 Runtime。
 * 纯函数律：所有函数不依赖外部状态，相同输入→相同输出。
 */

// ═══════════════════════════════════════════════════════════
// §1. Branded Identity Types
// ═══════════════════════════════════════════════════════════

/**
 * OperationId — Operation 的唯一生命周期身份。
 *
 * 在 Operation 被 consume（tryConsumePlan）时铸造，写入 Memory，
 * global reset 后仍然存在，Operation 生命周期内不可改变。
 *
 * 格式：`op:{target}:{consumeTick}`
 *
 * 不允许从 target 单独推导。
 * 不允许从 startedAt 推导。
 * 不允许用 decisionId 代替。
 */
export type OperationId = string & { readonly __brand: "OperationId" };

/**
 * DecisionId — DecisionRecord 的唯一标识。
 *
 * 由 collectExpansionDecisions 分配（D-{tick}-{seq}），
 * 用于 Decision → Outcome attribution。
 *
 * decisionId ≠ operationId：
 * - decisionId 是 Decision 身份（attribution identity）
 * - operationId 是 Operation 身份（lifecycle identity）
 */
export type DecisionId = string & { readonly __brand: "DecisionId" };

/**
 * EventId — UOEM Event 的全局唯一标识。
 *
 * 格式：`E-{tick}-{seq}`
 * 确定性：由 tick + 自增 seq 组成，不依赖 Date.now() / Math.random()。
 */
export type EventId = string & { readonly __brand: "EventId" };

// ── Identity 工厂函数（纯函数，确定性）──────────────────────

/**
 * 铸造 OperationId。
 *
 * @param target 目标房名（business attribute，非 identity）
 * @param consumeTick Operation 消费 Plan 的 tick
 * @returns 确定性的 OperationId：`op:{target}:{consumeTick}`
 */
export function makeOperationId(target: string, consumeTick: number): OperationId {
  return `op:${target}:${consumeTick}` as OperationId;
}

/**
 * 铸造 EventId。
 *
 * @param tick 事件发生 tick
 * @param seq 自增序号
 * @returns 确定性的 EventId：`E-{tick}-{seq}`
 */
export function makeEventId(tick: number, seq: number): EventId {
  return `E-${tick}-${seq}` as EventId;
}

// ═══════════════════════════════════════════════════════════
// §2. Operation Interval — 不可变生命周期时间模型
// ═══════════════════════════════════════════════════════════

/**
 * Operation Interval — 不可变生命周期锚点。
 *
 * openedAt = Operation 创建时间（consume Plan 时铸造，永不修改）
 * closedAt = Operation 终态时间（terminal 时设置，只设置一次）
 *
 * 禁止：
 * - 状态转换修改 openedAt
 * - 用 expansion.startedAt 代替 openedAt
 * - 用当前 state transition tick 代替 openedAt
 */
export interface OperationInterval {
  /** Operation 创建 tick（immutable）。 */
  readonly openedAt: number;
  /** Operation 终态 tick（只在 terminal 时设置，undefined = 未终态）。 */
  readonly closedAt?: number;
}

/**
 * 关闭 Interval — 纯函数，返回新对象。
 *
 * 不修改原 interval（不可变）。
 * 如果 interval 已有 closedAt，返回原对象（幂等）。
 */
export function closeInterval(interval: OperationInterval, closedAt: number): OperationInterval {
  if (interval.closedAt !== undefined) return interval; // 幂等：已关闭
  return { openedAt: interval.openedAt, closedAt };
}

/**
 * 计算 Operation duration — 纯函数。
 *
 * duration = closedAt - openedAt
 *
 * 如果 interval 未 closed（closedAt 为 undefined），返回 undefined。
 * 不猜测，不使用当前 tick 替代 closedAt。
 */
export function computeDuration(interval: OperationInterval): number | undefined {
  if (interval.closedAt === undefined) return undefined;
  return interval.closedAt - interval.openedAt;
}

// ═══════════════════════════════════════════════════════════
// §3. Terminal Outcome Code — 复用项目现有码表
// ═══════════════════════════════════════════════════════════

/**
 * Terminal Outcome Code — 复用 expansion-manager.ts 现有常量。
 *
 * 禁止创造新的 outcome code。
 * 禁止修改现有码表。
 *
 * 现有码表（expansion-manager.ts:66-72）：
 *   OUTCOME_SUCCESS = 0
 *   OUTCOME_STOLEN = 1
 *   OUTCOME_TIMEOUT = 2
 *   OUTCOME_LOST = 3
 *   OUTCOME_ABORTED = 4
 *
 * EXISTING_CODE_CONTRACT: outcome.ts:337-342 的 classification 映射
 *   0 → "SUCCESS", 1 → "FAILURE", 2 → "EXPIRED", 3/4 → "UNKNOWN"
 * 此映射属于 A6.1 domain 层冻结契约，UOEM 不修改。
 */
export const TERMINAL_OUTCOME = {
  SUCCESS: 0,
  STOLEN: 1,
  TIMED_OUT: 2,
  LOST: 3,
  ABANDONED: 4,
} as const;

/** Terminal Outcome Code 类型。 */
export type TerminalOutcomeCode = typeof TERMINAL_OUTCOME[keyof typeof TERMINAL_OUTCOME];

/**
 * 判断 outcomeCode 是否为合法的 terminal code。
 *
 * 纯函数：相同输入→相同输出。
 */
export function isTerminalOutcomeCode(code: number): code is TerminalOutcomeCode {
  return code === 0 || code === 1 || code === 2 || code === 3 || code === 4;
}

// ═══════════════════════════════════════════════════════════
// §4. Milestone Event — 非终态事件
// ═══════════════════════════════════════════════════════════

/**
 * Milestone kind — 表达"状态推进但 Operation 尚未终态"的事件类型。
 *
 * 不使用 terminal outcome code（如 TIMEOUT/SUCCESS），
 * 而是使用独立的 milestone 语义标签。
 *
 * 关键区分：
 * - BOOTSTRAP_TIMEOUT milestone ≠ TERMINAL_OUTCOME.TIMED_OUT
 * - ECONOMIC_STARTUP_TIMEOUT milestone ≠ TERMINAL_OUTCOME.TIMED_OUT
 * - CLAIMED milestone ≠ TERMINAL_OUTCOME.SUCCESS
 */
export type MilestoneKind =
  | "CLAIMED"               // P1: claim 成功，Operation 继续
  | "FORCED_ADVANCE"        // P5/P7: 超时强推，Operation 继续
  | "CHECKPOINT_PASSED"     // CP1-CP4 通过
  | "VALIDATED";            // Gate 验证通过

/**
 * MilestoneEvent — Operation 生命周期中的非终态事件。
 *
 * 不允许包含 terminal outcome code。
 * 不允许进入 OutcomeChannel。
 * 不允许触发 terminal Experience resolution。
 * 不允许覆盖 previous terminal outcome。
 *
 * MilestoneEvent ≠ OutcomeEvent
 */
export interface MilestoneEvent {
  /** 判别字段：始终为 "milestone"。 */
  readonly kind: "milestone";
  /** 全局唯一事件 ID。 */
  readonly eventId: EventId;
  /** 所属 Operation 的稳定身份。 */
  readonly operationId: OperationId;
  /** 关联的 Decision ID（attribution 用，可选）。 */
  readonly decisionId?: DecisionId;
  /** Milestone 类型（独立于 terminal outcome code）。 */
  readonly milestoneKind: MilestoneKind;
  /** 事件实际发生 tick（不是系统记录 tick）。 */
  readonly occurredAt: number;
  /** 系统记录事件的 tick。 */
  readonly recordedAt: number;
  /** 事件发生时的状态机状态。 */
  readonly state: string;
  /** 是否经历过强推（metadata，不是 outcome）。 */
  readonly forcedAdvance: boolean;
  /** 业务关联元数据（target 等，非 identity）。 */
  readonly correlation: EventCorrelation;
}

// ═══════════════════════════════════════════════════════════
// §5. Outcome Event — 终态事件
// ═══════════════════════════════════════════════════════════

/**
 * OutcomeEvent — 一个 Operation 的 Terminal Outcome。
 *
 * 每个 Operation 至多一个 OutcomeEvent（由 OutcomeChannel 幂等保证）。
 *
 * OutcomeEvent ≠ MilestoneEvent
 *
 * forcedAdvance 是 metadata：
 * - forcedAdvance=true 且 outcomeCode=SUCCESS 是合法的（强推后成功）
 * - forcedAdvance=true 且 outcomeCode=TIMED_OUT 是合法的（强推后仍超时）
 * - forcedAdvance=true 不自动推导 outcomeCode=TIMED_OUT
 */
export interface OutcomeEvent {
  /** 判别字段：始终为 "outcome"。 */
  readonly kind: "outcome";
  /** 全局唯一事件 ID。 */
  readonly eventId: EventId;
  /** 所属 Operation 的稳定身份。 */
  readonly operationId: OperationId;
  /** 关联的 Decision ID（attribution 用，可选）。 */
  readonly decisionId?: DecisionId;
  /** Terminal outcome code（复用现有码表）。 */
  readonly outcomeCode: TerminalOutcomeCode;
  /** 事件实际发生 tick。 */
  readonly occurredAt: number;
  /** 系统记录事件的 tick。 */
  readonly recordedAt: number;
  /** Operation 生命周期 Interval（含 openedAt + closedAt）。 */
  readonly interval: OperationInterval;
  /** Operation duration = interval.closedAt - interval.openedAt。 */
  readonly duration: number;
  /** 是否经历过强推（metadata，不是 outcome，不是 terminality）。 */
  readonly forcedAdvance: boolean;
  /** 业务关联元数据。 */
  readonly correlation: EventCorrelation;
}

// ═══════════════════════════════════════════════════════════
// §6. Event Correlation — 关联元数据
// ═══════════════════════════════════════════════════════════

/**
 * Event Correlation — 事件的业务关联元数据。
 *
 * target 是 business attribute，不是 identity。
 * planId 可选（旧版 Memory 可能缺失）。
 * traceId 可选（用于跨系统追踪）。
 */
export interface EventCorrelation {
  /** 目标房名（business attribute，非 identity）。 */
  readonly target: string;
  /** 关联的 Plan ID（可选，旧版 Memory 可能缺失）。 */
  readonly planId?: string;
  /** 跨系统追踪 ID（可选）。 */
  readonly traceId?: string;
}

// ═══════════════════════════════════════════════════════════
// §7. UOEM Event Union — Discriminated Union
// ═══════════════════════════════════════════════════════════

/**
 * UOEM Event — MilestoneEvent | OutcomeEvent。
 *
 * Discriminated union on `kind`:
 * - `kind === "milestone"` → MilestoneEvent (无 terminal outcome)
 * - `kind === "outcome"` → OutcomeEvent (有 terminal outcome)
 *
 * 这是防止 EXP-1 的第一道结构性保护：
 * TypeScript 类型系统阻止 MilestoneEvent 被当作 OutcomeEvent。
 */
export type UOEMEvent = MilestoneEvent | OutcomeEvent;

// ═══════════════════════════════════════════════════════════
// §8. Terminal Semantics — 纯函数
// ═══════════════════════════════════════════════════════════

/**
 * 判断事件是否为 Terminal。
 *
 * Terminality 来自 `event.kind`，不是 `outcomeCode`。
 *
 * - MilestoneEvent → false（无论 milestoneKind）
 * - OutcomeEvent → true（无论 outcomeCode）
 *
 * 这是 TIMEOUT-SEMANTICS 的核心修复：
 * timeout milestone 的 kind 是 "milestone" → isTerminalEvent = false
 * timeout terminal 的 kind 是 "outcome" → isTerminalEvent = true
 *
 * Terminality 来自 lifecycle transition / event kind，
 * 不是来自 outcomeCode === TIMEOUT。
 */
export function isTerminalEvent(event: UOEMEvent): event is OutcomeEvent {
  return event.kind === "outcome";
}

/**
 * 判断事件是否为 Milestone。
 */
export function isMilestoneEvent(event: UOEMEvent): event is MilestoneEvent {
  return event.kind === "milestone";
}

// ═══════════════════════════════════════════════════════════
// §9. OutcomeChannel Entry — 只接受 OutcomeEvent
// ═══════════════════════════════════════════════════════════

/**
 * OutcomeChannel Entry — 只能接受 OutcomeEvent。
 *
 * 类型系统阻止 MilestoneEvent 进入 channel：
 * ```typescript
 * const entry: OutcomeChannelEntry = milestone; // ❌ Type Error
 * ```
 *
 * 这是防止 EXP-1 的第二道结构性保护。
 */
export interface OutcomeChannelEntry {
  /** 唯一接受 OutcomeEvent，不接受 MilestoneEvent。 */
  readonly event: OutcomeEvent;
  /** channel 内的序号（FIFO 顺序）。 */
  readonly sequence: number;
}

/**
 * Outcome Identity — 用于 terminal outcome 幂等去重。
 *
 * 去重 key = operationId。
 * 不使用 target / startedAt / decisionId 作为 Operation terminal identity。
 *
 * decisionId 是 attribution identity，不是 lifecycle identity。
 * operationId 是 lifecycle identity，不是 attribution identity。
 */
export interface OutcomeIdentity {
  readonly operationId: OperationId;
}

/**
 * 幂等检查 — 判断新 event 是否与已存在 event 重复。
 *
 * 同一 operationId 的第二条 OutcomeEvent 是 duplicate。
 * 返回 true 表示重复（应被拒绝）。
 */
export function isDuplicateOutcome(
  existing: OutcomeIdentity,
  incoming: OutcomeIdentity,
): boolean {
  return existing.operationId === incoming.operationId;
}

// ═══════════════════════════════════════════════════════════
// §10. Domain Invariants（类型级证明）
// ═══════════════════════════════════════════════════════════

/**
 * I-UOEM-01: Every OutcomeEvent is terminal.
 *
 * 证明：OutcomeEvent.kind === "outcome" → isTerminalEvent = true
 * 证明方式：isTerminalEvent(OutcomeEvent) === true（类型保证）
 *
 * I-UOEM-02: No MilestoneEvent is terminal.
 *
 * 证明：MilestoneEvent.kind === "milestone" → isTerminalEvent = false
 *
 * I-UOEM-03: MilestoneEvent cannot enter OutcomeChannel.
 *
 * 证明：OutcomeChannelEntry.event: OutcomeEvent
 * TypeScript 编译器拒绝 MilestoneEvent 赋值。
 *
 * I-UOEM-04: OperationId remains distinct from DecisionId.
 *
 * 证明：OperationId = string & { __brand: "OperationId" }
 *       DecisionId = string & { __brand: "DecisionId" }
 * TypeScript 编译器拒绝互相赋值。
 *
 * I-UOEM-05: Operation openedAt is immutable.
 *
 * 证明：OperationInterval.openedAt: readonly number
 * TypeScript 编译器拒绝 openedAt = ...
 *
 * I-UOEM-06: Duration is derived from OperationInterval.
 *
 * 证明：computeDuration(interval) 使用 interval.openedAt + interval.closedAt
 * 不读取 expansion.startedAt。
 *
 * I-UOEM-07: forcedAdvance does not imply terminality.
 *
 * 证明：MilestoneEvent.forcedAdvance: boolean（与 OutcomeEvent.forcedAdvance: boolean 同类型）
 * 但 MilestoneEvent.kind === "milestone" → isTerminalEvent = false
 * forcedAdvance=true 不改变 kind。
 *
 * I-UOEM-08: Outcome code does not determine event kind.
 *
 * 证明：outcomeCode 只存在于 OutcomeEvent（kind="outcome"）
 * MilestoneEvent 没有 outcomeCode 字段
 * terminality 来自 kind，不来自 outcomeCode。
 */
