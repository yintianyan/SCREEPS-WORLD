/** Network Rebalance */

/** Rebalance 触发事件类型。 */
export type RebalanceTrigger =
  | "new-demand"
  | "new-supply"
  | "operation-failure"
  | "reservation-released"
  | "room-health-changed"
  | "priority-changed"
  | "deadline-approaching"
  | "target-fulfilled"
  | "source-capacity-lost";

/** Rebalance 事件记录。 */
export interface RebalanceEvent {
  /** 事件类型。 */
  trigger: RebalanceTrigger;
  /** 相关房间。 */
  room?: string;
  /** 相关 Operation ID。 */
  operationId?: string;
  /** 事件 tick。 */
  tick: number;
}

/** Rebalance 判定结果。 */
export interface RebalanceDecision {
  /** 是否应该 rebalance。 */
  shouldRebalance: boolean;
  /** 待处理事件列表。 */
  pendingEvents: RebalanceEvent[];
  /** 最近一次 rebalance tick。 */
  lastRebalanceTick: number;
  /** 原因。 */
  reason: string;
}

/** Debounce 窗口：事件发生后等待 N tick 再触发 rebalance。 */
const DEBOUNCE_TICKS = 50;

/** 最小 rebalance 间隔（与 stability.ts 的 cooldown 对齐）。 */
const MIN_REBALANCE_INTERVAL = 200;

/**
 * Rebalance Manager — 纯函数状态机。

 * 不持久化状态——状态由调用方（系统侧）持有并注入。
 */
export class RebalanceState {
  /** 待处理事件缓冲。 */
  private events: RebalanceEvent[] = [];
  /** 上次 rebalance tick。 */
  lastRebalanceTick = 0;

  /** 添加事件到缓冲。 */
  addEvent(event: RebalanceEvent): void {
    // 去重：同类型 + 同房间的事件只保留最新
    this.events = this.events.filter(
      e => !(e.trigger === event.trigger && e.room === event.room)
    );
    this.events.push(event);
  }

  /** 获取待处理事件数。 */
  get pendingCount(): number {
    return this.events.length;
  }

  /** 清空事件缓冲。 */
  clear(): void {
    this.events = [];
  }

  /** 获取待处理事件列表（只读）。 */
  getPendingEvents(): readonly RebalanceEvent[] {
    return this.events;
  }
}

/**
 * 判定是否应该触发 rebalance。

 * 逻辑：
 *   1. 有待处理事件
 *   2. 距上次 rebalance 超过 MIN_REBALANCE_INTERVAL
 *   3. 最早的事件已超过 DEBOUNCE_TICKS

 * @param state rebalance 状态
 * @param tick 当前 tick

 * 纯函数。
 */
export function decideRebalance(
  state: RebalanceState,
  tick: number,
): RebalanceDecision {
  const events = state.getPendingEvents();

  if (events.length === 0) {
    return {
      shouldRebalance: false,
      pendingEvents: [],
      lastRebalanceTick: state.lastRebalanceTick,
      reason: "no pending events",
    };
  }

  // Cooldown 检查
  if (tick - state.lastRebalanceTick < MIN_REBALANCE_INTERVAL) {
    return {
      shouldRebalance: false,
      pendingEvents: [...events],
      lastRebalanceTick: state.lastRebalanceTick,
      reason: `cooldown: ${MIN_REBALANCE_INTERVAL - (tick - state.lastRebalanceTick)} ticks remaining`,
    };
  }

  // Debounce：最早事件是否已超过窗口
  const oldestEventTick = Math.min(...events.map(e => e.tick));
  if (tick - oldestEventTick < DEBOUNCE_TICKS) {
    return {
      shouldRebalance: false,
      pendingEvents: [...events],
      lastRebalanceTick: state.lastRebalanceTick,
      reason: `debounce: ${DEBOUNCE_TICKS - (tick - oldestEventTick)} ticks remaining`,
    };
  }

  return {
    shouldRebalance: true,
    pendingEvents: [...events],
    lastRebalanceTick: state.lastRebalanceTick,
    reason: `${events.length} events ready`,
  };
}

/**
 * 标记 rebalance 完成（清空事件缓冲 + 更新 lastRebalanceTick）。

 * 纯函数 — 修改 state 对象（调用方持有）。
 */
export function markRebalanced(state: RebalanceState, tick: number): void {
  state.clear();
  state.lastRebalanceTick = tick;
}
