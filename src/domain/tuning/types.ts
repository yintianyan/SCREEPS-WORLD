/**
 * Telemetry-Based Parameter Self-Tuning — 类型定义。
 *
 * 设计意图：系统当前使用静态 CONFIG 参数（如 hauler maxCount=6）。
 * 本模块定义从遥测数据聚合的信号、运行时覆盖值和评估结果的类型契约，
 * 使 evaluator 可作为纯函数独立测试，不依赖 Game/Memory。
 *
 * 数据流：
 *   timeseries ring buffer + live snapshot → TuningSignals
 *   → evaluateTuning(signals, overrides, lastAdjusted, tick)
 *   → TuningEvaluation { adjustments[] }
 *   → Memory.kernel.tuning.rooms[roomName].roleBounds
 *   → getRoleBounds(role, roomName) 查询时覆盖 CONFIG
 */

// ─── 聚合信号 ───────────────────────────────────────────────

/**
 * 从遥测时序数据和活快照聚合的调优信号。
 * 由 tuning-engine（系统层）在评估时构建，传入纯函数 evaluator。
 */
export interface TuningSignals {
  // ── 经济趋势（来自 economy ring buffer，evaluation window 内聚合）──
  /** 评估窗口内平均储备变化量。正值=盈余，负值=赤字。 */
  avgReserveDelta: number;
  /** 评估窗口内平均经济压力 (0.0–1.0)。 */
  avgPressure: number;
  /** 评估窗口内平均赤字分数 (0–100)。 */
  avgDrainScore: number;
  /** 评估窗口内处于 crisis/recovery 相位的采样点比例 (0–1)。 */
  crisisRatio: number;
  /** 评估窗口内平均 storage 能量。无 storage 时为 0。 */
  avgStorageEnergy: number;

  // ── 活快照信号（来自当前 TickContext）──
  /** 当前 container 平均填充率 (0.0–1.0)。无 container 时为 0。 */
  containerFillRatio: number;
  /** 当前 hauler 存活数。 */
  haulerCount: number;
  /** 当前 harvester 存活数。 */
  harvesterCount: number;
  /** 当前 upgrader 存活数。 */
  upgraderCount: number;
  /** 当前 builder 存活数。 */
  builderCount: number;
  /** 当前 buildQueue 中 queued 状态的任务数。 */
  buildQueueBacklog: number;

  // ── CPU 信号（来自 CPU ring buffer，全局聚合）──
  /** 当前 CPU tier rank (0=healthy, 1=guarded, 2=conserve, 3=recovery)。 */
  tierRank: number;

  // ── 房间元数据 ──
  /** 被评估房间的 RCL。 */
  rcl: number;
}

// ─── 覆盖值 ─────────────────────────────────────────────────

/** 单个角色的数量边界覆盖。 */
export interface RoleBoundsOverride {
  /** 覆盖的 minCount。undefined 表示不覆盖，使用 CONFIG 默认值。 */
  minCount?: number;
  /** 覆盖的 maxCount。undefined 表示不覆盖，使用 CONFIG 默认值。 */
  maxCount?: number;
}

/** 单个房间的调优状态。 */
export interface RoomTuningState {
  /** 角色数量边界覆盖。key = 角色名。 */
  roleBounds: Record<string, RoleBoundsOverride>;
  /** 每个参数路径上次调整的 tick。key = "hauler.maxCount" 等。 */
  lastAdjusted: Record<string, number>;
}

// ─── 评估结果 ───────────────────────────────────────────────

/** 单个参数的调整决策。 */
export interface TuningAdjustment {
  /** 参数路径，如 "hauler.maxCount"。 */
  param: string;
  /** 调整前的值（CONFIG 默认或当前覆盖值）。 */
  oldValue: number;
  /** 调整后的新值。 */
  newValue: number;
  /** 人类可读的调整原因（供控制台日志和诊断）。 */
  reason: string;
}

/** 一次评估的完整结果。 */
export interface TuningEvaluation {
  /** 本次评估产出的调整列表。空 = 无需调整。 */
  adjustments: TuningAdjustment[];
  /** 诊断快照：评估使用的信号值（供控制台查看）。 */
  signals: Record<string, number>;
  /** 如果评估被跳过，记录原因。 */
  skipped?: string;
}
