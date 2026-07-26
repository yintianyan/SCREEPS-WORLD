/**
 * Event Log — 离散事件日志的采集与持久化。
 *
 * 设计意图：Screeps 控制台是流式的，滚过去就没了。关键状态转换
 * (Phase 变迁、Tier 降级、P0 孵化、敌人入侵等) 需要持久化到 segment
 * 供事后追溯——Debug Investigation Protocol 的"收集日志"步骤依赖此数据。
 *
 * 数据流：
 *   任意系统调用 recordEvent() → globalCache().eventBuffer (heap, per-tick)
 *   → telemetry-collector 每 10 tick flush → segment 2 环形缓冲
 *
 * 事件检测策略：
 *   1. 显式记录：关键路径调用 recordEvent()（如 spawn-manager 创建 P0 请求）
 *   2. 差分检测：telemetry-collector 对比 Memory 中前后状态差值
 *   优先用差分检测（不改现有系统），显式记录仅用于差分无法覆盖的事件。
 *
 * 容量：segment 2 = 100KB，每事件 ~30 bytes，保留最近 500 条。
 */

import type { RingBuffer } from "./ring-buffer";
import { globalCache } from "./global-cache";

// ─── 事件类型枚举 ────────────────────────────────────────────

/** 事件种类 — 整数枚举以最小化序列化体积。 */
export const enum EventKind {
  /** 殖民相位转换 (bootstrap→growth→crisis→recovery→steady)。 */
  PhaseTransition = 0,
  /** CPU Tier 降级 (如 healthy→guarded)。 */
  TierDowngrade = 1,
  /** CPU Tier 升级 (如 recovery→conserve)。 */
  TierUpgrade = 2,
  /** ColonyState 转换 (bootstrap/recovery/normal/defense)。 */
  ColonyStateChange = 3,
  /** Controller 等级变化 (RCL up)。 */
  ControllerLevelUp = 4,
  /** Controller 降级风险触发。 */
  ControllerDowngradeRisk = 5,
  /** P0 孵化请求创建。 */
  P0SpawnRequest = 6,
  /** 敌人入侵（threatCreeps 从 0 变 >0）。 */
  EnemyInvasion = 7,
  /** 敌人清除（threatCreeps 回归 0）。 */
  EnemyCleared = 8,
  /** Safe Mode 激活。 */
  SafeModeActivated = 9,
  /** 非关键插件进入冷却（连续错误 ≥ 3）。 */
  PluginCooldown = 10,
  /** Creep 卡位超限。 */
  CreepStuck = 11,
  /** 建造完成。 */
  BuildComplete = 12,
  /** 关键结构被毁（spawn/tower/container 数量减少）。d = [structureTypeCode, prevCount, currCount]。 */
  StructureDestroyed = 13,
  /** Assignment 续约成功（lease 有效 → 续约）。d = []。 */
  AssignmentRenewed = 14,
  /** Assignment 新分配（从任务池选择新任务）。d = [priority]。 */
  AssignmentAssigned = 15,
  /** Assignment 失效（lease 过期/revision 变化/target 消失/source 消失）。d = [failReasonCode]。 */
  AssignmentExpired = 16,
}

// ─── 事件数据结构 ────────────────────────────────────────────

/**
 * 单个游戏事件。
 * d 数组按 EventKind 不同解释不同字段，
 * 紧凑整数编码以最小化 segment 占用。
 */
export interface GameEvent {
  /** 事件发生的 tick (Game.time)。 */
  t: number;
  /** 事件种类 (EventKind)。 */
  k: number;
  /** 关联房间名（可空，用空串表示全局事件）。 */
  r: string;
  /** 数据字段（变长，按 kind 解释）。 */
  d: number[];
}

// ─── Segment 2 数据结构 ──────────────────────────────────────

/** Segment 2 的顶层结构：事件日志环形缓冲区。 */
export interface EventLogSegmentData {
  /** 事件环形缓冲（保留最近 N 条）。 */
  events: RingBuffer<GameEvent>;
}

// ─── 事件 buffer（per-tick heap）──────────────────────────────

/**
 * per-tick 事件缓冲区接口。
 * 挂在 globalCache().eventBuffer 上，每 tick 初始化为空数组。
 */
export interface EventBuffer {
  events: GameEvent[];
}

// ─── 公共 API ───────────────────────────────────────────────

/**
 * 记录一个离散事件。
 * 写入 globalCache().eventBuffer（heap），由 telemetry-collector 低频 flush 到 segment。
 *
 * 此函数可从任意系统安全调用 — 不访问 Memory/segment，CPU 开销极低（数组 push）。
 */
export function recordEvent(
  kind: EventKind,
  roomName: string,
  data: number[],
): void {
  const g = globalCache();
  if (!g.eventBuffer) g.eventBuffer = { events: [] };
  g.eventBuffer.events.push({
    t: Game.time,
    k: kind,
    r: roomName,
    d: data,
  });
}

/** 获取并清空 per-tick 事件缓冲区。返回的事件由调用者持久化到 segment。 */
export function drainEventBuffer(): GameEvent[] {
  const g = globalCache();
  if (!g.eventBuffer || !g.eventBuffer.events || g.eventBuffer.events.length === 0) {
    return [];
  }
  const events = g.eventBuffer.events;
  g.eventBuffer = { events: [] };
  return events;
}
