/** UOEM (Unified Outcome Event Model) — 类型定义。 */

// ─── Operation Identity ──────────────────────────────────

/** Operation 唯一身份标识。格式: `op:{target}:{consumeTick}`。
 * 在 consume/立项时一次性铸造，写入 Memory，跨 global reset 稳定。 */
export type OperationId = string;

/** 构造 operationId — consume 时一次性铸造。 */
export function makeOperationId(target: string, consumeTick: number): OperationId {
  return `op:${target}:${consumeTick}`;
}

// ─── Event 基类 ───────────────────────────────────────────

/** 所有 UOEM 事件的基类。 */
export interface BaseEvent {
  /** 事件唯一标识：`E-{tick}-{seq}` — 确定性、有序、可去重。 */
  readonly eventId: string;
  /** 所属 Operation 的身份标识。 */
  readonly operationId: OperationId;
}

// ─── Milestone Event ──────────────────────────────────────

/** 非终态事件 — 不进入 OutcomeChannel，不 finalize Experience。
 * - P1 claim 成功 → Milestone("CLAIMED")
 * - P5 forced advance → Milestone("FORCED_ADVANCE")
 * - P7 forced success → Milestone("FORCED_ADVANCE") */
export interface MilestoneEvent extends BaseEvent {
  readonly kind: "MILESTONE";
  /** 里程碑名称：CLAIMED / FORCED_ADVANCE / STATE_TRANSITION 等。 */
  readonly milestone: string;
  /** 发生 tick。 */
  readonly at: number;
}

// ─── Outcome Event ────────────────────────────────────────

/** 扩张终态结果。只有这些才能进入 OutcomeChannel。
 * - COMPLETED / COMPLETED_FORCED: 终态成功（后者经历过 forcedAdvance）
 * - TIMED_OUT / LOST / STOLEN / ABANDONED: 终态失败 */
export type ExpansionResult =
  | "COMPLETED"
  | "COMPLETED_FORCED"
  | "TIMED_OUT"
  | "LOST"
  | "STOLEN"
  | "ABANDONED";

/** 终态结果的集合（用于运行时校验）。 */
export const TERMINAL_RESULTS: ReadonlySet<string> = new Set<ExpansionResult>([
  "COMPLETED",
  "COMPLETED_FORCED",
  "TIMED_OUT",
  "LOST",
  "STOLEN",
  "ABANDONED",
]);

/** 配对观测 — 强制双端点（A6-R/A6-SL 修复）。 */
export interface PairedObservation {
  /** 决策时刻冻结的 before 值。 */
  readonly before: number;
  /** 终态时刻采集的 after 值。 */
  readonly after: number;
}

/** 增量观测 — 取代终身累计值（A6-R 修复）。 */
export interface DeltaObservation {
  /** 自 open 以来的成功增量。 */
  readonly succeededSinceOpen: number;
  /** 自 open 以来的失败增量。 */
  readonly failedSinceOpen: number;
}

/** Operation 生命周期区间 — openedAt 不可变（TMP-1 修复）。 */
export interface Interval {
  /** Operation 开始 tick（consume 时铸造，不可变）。 */
  readonly openedAt: number;
  /** Operation 终态 tick。 */
  readonly closedAt: number;
}

/** 终态事件 — 唯一能进入 OutcomeChannel 的事件类型。
 * 同一 Operation 只能有一个 terminal Outcome。 */
export interface OutcomeEvent extends BaseEvent {
  readonly kind: "OUTCOME";
  /** 事件域（当前只有 expansion）。 */
  readonly domain: "expansion";
  /** 终态结果。 */
  readonly result: ExpansionResult;
  /** Operation 生命周期区间。 */
  readonly interval: Interval;
  /** 是否经历过 forced advance（P5/P7 milestone 传播）。 */
  readonly forcedAdvance: boolean;
  /** 配对观测（可选 — 无 before 冻结时不产生）。 */
  readonly observation?: PairedObservation;
  /** 增量观测（可选 — recovery 通道使用）。 */
  readonly delta?: DeltaObservation;
}

/** UOEM 事件联合类型。 */
export type UOEMEvent = OutcomeEvent | MilestoneEvent;

// ─── Outcome Channel ──────────────────────────────────────

/** 入队结果。 */
export type EnqueueResult = "ACCEPTED" | "DUPLICATE_REJECTED";

/** Channel 溢出计数接口。 */
export interface ChannelOverflowInfo {
  /** 被拒绝的重复 outcome 数。 */
  readonly duplicateRejected: number;
  /** 因容量不足被丢弃的最老事件数。 */
  readonly overflowEvicted: number;
}
