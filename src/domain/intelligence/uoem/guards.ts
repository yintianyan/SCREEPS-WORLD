/** UOEM Core — Event Guards & Terminal Semantics. */

import type {
  OperationId,
  DecisionId,
  EventId,
} from "./identity";
import type { OperationInterval } from "./interval";

// ── Terminal Outcome Code（复用现有码表）──────────────────────

/**
 * Terminal Outcome Code — 复用 expansion-manager.ts 现有常量。

 * 禁止创造新的 outcome code。禁止修改现有码表。

 * 现有码表（expansion-manager.ts:66-72）：
 *   OUTCOME_SUCCESS = 0, OUTCOME_STOLEN = 1, OUTCOME_TIMEOUT = 2,
 *   OUTCOME_LOST = 3, OUTCOME_ABORTED = 4

 * EXISTING_CODE_CONTRACT: outcome.ts:337-342 的 classification 映射
 *   0→"SUCCESS", 1→"FAILURE", 2→"EXPIRED", 3/4→"UNKNOWN"
 * 此映射属于 A6.1 domain 层冻结契约，UOEM 不修改。
 */
export const TERMINAL_OUTCOME = {
  SUCCESS: 0,
  STOLEN: 1,
  TIMED_OUT: 2,
  LOST: 3,
  ABANDONED: 4,
} as const;

export type TerminalOutcomeCode = typeof TERMINAL_OUTCOME[keyof typeof TERMINAL_OUTCOME];

/**
 * 判断 outcomeCode 是否为合法的 terminal code。
 */
export function isTerminalOutcomeCode(code: number): code is TerminalOutcomeCode {
  return code === 0 || code === 1 || code === 2 || code === 3 || code === 4;
}

// ── Milestone Kind（独立于 terminal outcome code）─────────────

/**
 * Milestone kind — 表达"状态推进但 Operation 尚未终态"的事件类型。

 * 不使用 terminal outcome code（如 TIMEOUT/SUCCESS）。
 * milestoneKind ≠ terminalOutcomeCode：
 *   FORCED_ADVANCE ≠ TERMINAL_OUTCOME.TIMED_OUT
 *   CLAIMED ≠ TERMINAL_OUTCOME.SUCCESS
 */
export type MilestoneKind =
  | "CLAIMED"
  | "FORCED_ADVANCE"
  | "CHECKPOINT_PASSED"
  | "VALIDATED";

// ── Event Correlation ─────────────────────────────────────────

/**
 * Event Correlation — 事件的业务关联元数据。
 * target 是 business attribute，不是 identity。
 */
export interface EventCorrelation {
  readonly target: string;
  readonly planId?: string;
  readonly traceId?: string;
}

// ── Milestone Event ──────────────────────────────────────────

/**
 * MilestoneEvent — Operation 生命周期中的非终态事件。

 * 没有 outcomeCode 字段。
 * 不进入 OutcomeChannel。
 * 不触发 terminal Experience resolution。
 * 不覆盖 previous terminal outcome。
 */
export interface MilestoneEvent {
  readonly kind: "milestone";
  readonly eventId: EventId;
  readonly operationId: OperationId;
  readonly decisionId?: DecisionId;
  readonly milestoneKind: MilestoneKind;
  readonly occurredAt: number;
  readonly recordedAt: number;
  readonly state: string;
  readonly forcedAdvance: boolean;
  readonly correlation: EventCorrelation;
}

// ── Outcome Event ─────────────────────────────────────────────

/**
 * OutcomeEvent — 一个 Operation 的 Terminal Outcome。

 * 每 Operation 至多一个（由 OutcomeChannel 幂等保证）。
 * forcedAdvance 是 metadata：
 *   forcedAdvance=true + outcomeCode=SUCCESS 合法（强推后成功）
 *   forcedAdvance=true + outcomeCode=TIMED_OUT 合法（强推后仍超时）
 *   forcedAdvance=true 不自动推导 outcomeCode=TIMED_OUT
 */
export interface OutcomeEvent {
  readonly kind: "outcome";
  readonly eventId: EventId;
  readonly operationId: OperationId;
  readonly decisionId?: DecisionId;
  readonly outcomeCode: TerminalOutcomeCode;
  readonly occurredAt: number;
  readonly recordedAt: number;
  readonly interval: OperationInterval;
  readonly duration: number;
  readonly forcedAdvance: boolean;
  readonly correlation: EventCorrelation;
}

// ── Discriminated Union ──────────────────────────────────────

/**
 * UOEM Event — MilestoneEvent | OutcomeEvent。

 * Discriminated union on `kind`：
 * - kind === "milestone" → 无 terminal outcome
 * - kind === "outcome" → 有 terminal outcome

 * 防止 EXP-1 的第一道结构性保护。
 */
export type UOEMEvent = MilestoneEvent | OutcomeEvent;

// ── Terminal Semantics ───────────────────────────────────────

/**
 * 判断事件是否为 Terminal。

 * Terminality 来自 event.kind，不来自 outcomeCode。

 * - MilestoneEvent → false（无论 milestoneKind / forcedAdvance）
 * - OutcomeEvent → true（无论 outcomeCode / forcedAdvance）

 * TIMEOUT-SEMANTICS 核心修复：
 * timeout milestone 的 kind 是 "milestone" → isTerminalEvent = false
 * timeout terminal 的 kind 是 "outcome" → isTerminalEvent = true
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

// ── forcedAdvance 语义验证 ────────────────────────────────────

/**
 * forcedAdvance 不改变 terminality。

 * 证明：
 * - MilestoneEvent + forcedAdvance=true → isTerminalEvent = false（因为 kind="milestone"）
 * - OutcomeEvent + forcedAdvance=true → isTerminalEvent = true（因为 kind="outcome"）
 * - forcedAdvance 是 boolean，不改变 kind
 */
export function forcedAdvanceDoesNotImplyTerminality(
  event: UOEMEvent,
): boolean {
  if (event.forcedAdvance && event.kind === "milestone") {
    return isTerminalEvent(event) === false;
  }
  if (event.forcedAdvance && event.kind === "outcome") {
    return isTerminalEvent(event) === true;
  }
  return true;
}

// ── Timestamp 验证 ────────────────────────────────────────────

/**
 * 验证 occurredAt <= recordedAt。

 * 事件实际发生 tick <= 系统记录 tick。
 * 事件可能在发生后才被系统记录（delayed recording）。
 */
export function isValidTimestampOrder(event: UOEMEvent): boolean {
  return event.occurredAt <= event.recordedAt;
}

// ── Outcome Identity（幂等去重）────────────────────────────────

/**
 * Outcome Identity — 用于 terminal outcome 幂等去重。
 * 去重 key = operationId（不是 target / startedAt / decisionId）。
 */
export interface OutcomeIdentity {
  readonly operationId: OperationId;
}

/**
 * 幂等检查 — 判断新 event 是否与已存在 event 重复。
 * 同一 operationId 的第二条 OutcomeEvent 是 duplicate。
 */
export function isDuplicateOutcome(
  existing: OutcomeIdentity,
  incoming: OutcomeIdentity,
): boolean {
  return existing.operationId === incoming.operationId;
}
