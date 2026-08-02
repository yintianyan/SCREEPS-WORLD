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
  /**
   * 评估窗口内 spawn+extension 平均填充率 (0.0–1.0)。
   * 消费端饱和度指标——高值表示消费端已满，加 hauler 无益。
   * 从 EconomySample.ea/ec 的平均值计算。
   */
  spawnFillRatio: number;
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
  /**
   * P1-2：最满 source 的填充率 (0.0–1.0)。
   * srcRatio > 0.9 持续 = source 满载但采不动（采集塌方信号）。
   * 配合 RoomMemory.phase.srcStallTicks 判断是否强制解冻关键参数。
   */
  srcRatio: number;

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
  /**
   * 每个参数上次评估的期望方向，用于趋势确认（P1-1 调整置信度）。
   * 机制：连续 2 次同方向信号才触发实际调整，防止单次噪声驱动决策。
   * 调整后重置为 "none"，确保下次调整需要重新积累 2 次同方向确认。
   */
  lastTrend?: Record<string, TrendDirection>;
  /**
   * 改进 A 新增：调整效果验证闭环。
   *
   * 每个参数路径记录调整时的 signals 快照与可验证的「期望改善方向」。
   * - 调整触发时写入：preAdjustSignals + expectedDirection + adjustTick + adjustDirection
   * - verifyDelay(1500 tick) 到期后验证：若 signals 未按期望方向改善 → 回滚
   * - 验证完成后清空此字段（无论回滚与否，闭环结束）
   *
   * 评审修正（附录 D.2 pending-lock）：pending 存在期间该参数从 evaluator
   * evals 整体排除（含 trend 记录），验证完成（接受/回滚）清空 pending 后
   * trend 从 none 重新积累。防「反向调整早于验证触发」竞态。
   */
  pendingValidation?: Record<string, PendingValidation>;
  /**
   * 改进 A 新增（P3 冻结机制）：连续 ROLLBACK_FREEZE_THRESHOLD(3) 次回滚
   * → 冻结该参数 FROZEN_DURATION(10000) tick，评估跳过。
   *
   * 评审修正（附录 D.5）：冻结只停评估不停值 — 冻结时参数复位到 CONFIG 基线，
   * 避免「振荡结束停在错误值被钉 10000 tick」。
   * rollbackCount 解冻后保留，用于再次冻结判定。
   * frozenUntil=0 表示「未冻结但跟踪 rollbackCount」（用于累积计数）。
   */
  frozenParams?: Record<string, FrozenParamState>;
}

/**
 * 闭环验证用的信号子集 — 只记与该参数相关的字段，控制 Memory 体积。
 *
 * 设计原则：每个参数只验证它当时触发调整所依据的 1-2 个核心信号，
 * 不验证全部 signals（避免噪声 + 控体积）。
 */
export interface AdjustSignalsSnapshot {
  /** hauler.maxCount/minCount 验证 container 填充率。 */
  containerFillRatio?: number;
  /** harvester.maxCount 验证 reserveDelta。 */
  avgReserveDelta?: number;
  /** upgrader.maxCount 验证 storageEnergy（主动恶化时希望 storage 上升）。 */
  avgStorageEnergy?: number;
  /** builder.maxCount 验证 buildQueueBacklog。 */
  buildQueueBacklog?: number;
  /** 改进 P2：hauler 验证 spawn 填充率（能量再分配证据）。 */
  spawnFillRatio?: number;
  /** 改进 P2/D.3：人口合同前置 — 调整时角色的存活数。 */
  roleCount?: number;
  /** 改进 D.4：upgrader 下调护栏 — 经济压力。 */
  avgPressure?: number;
}

/**
 * 单个参数的待验证调整记录。
 *
 * 由 evaluator 触发调整时构造（confirmAndBuild），由 tuning-engine
 * 在 verifyDelay 到期后验证。
 */
export interface PendingValidation {
  /** 调整前的 signals 快照（仅记本参数相关的子集，控体积）。 */
  preAdjustSignals: AdjustSignalsSnapshot;
  /**
   * 期望的改善方向：
   * - "improve" = 希望信号朝「好」方向移动（如 containerFillRatio 下降）
   * - "worsen" = 主动恶化（如 upgrader 上调期望 storage 下降=节能生效）
   */
  expectedDirection: "improve" | "worsen";
  /** 调整方向："up"=增加参数值 / "down"=减少参数值。 */
  adjustDirection: "up" | "down";
  /** 调整时的 tick（= lastAdjusted[param]）。 */
  adjustTick: number;
  /** 调整前的值（用于回滚）。 */
  preAdjustValue: number;
  /**
   * 评审修正（附录 D.3 人口合同前置）：roleCount 未达新边界时标记 blocked。
   * - true = 人口未到位，下周期复验，不判失败不计回滚次数
   * - false/undefined = 人口已到位，正常验证效果信号
   */
  contractBlocked?: boolean;
  /**
   * P1 修复（附录 E.2）：首次检测到人口合同未满足的 tick（用于 blocked TTL 判断）。
   *
   * - 首次 blocked 时写入 currentTick
   * - 后续 blocked 保留原值（不更新）
   * - 人口合同满足时清空（delete）
   * - 连续 2 个 verifyDelay 窗口（blockedSinceTick + 2 * verifyDelay <= currentTick）
   *   仍未达人口 → 回滚到 preAdjustValue + 计 1 次回滚 + 写 TuningBlocked 事件
   *
   * 设计依据：tuning 触发阈值（containerFill>0.7）与 demand 孵化阈值（0.4/0.8 分档）
   * 口径不同 + 能量饥饿排队 → 合同可能长期不满足 → pending-lock 永久排除该参数。
   * TTL 机制防止「参数被永久排除且零告警」。
   */
  blockedSinceTick?: number;
}

/**
 * 参数冻结状态（P3 冻结机制）。
 */
export interface FrozenParamState {
  /** 冻结起始 tick。0 表示未冻结（仅跟踪 rollbackCount）。 */
  frozenAt: number;
  /** 冻结到期 tick（frozenAt + FROZEN_DURATION）。0 表示未冻结。 */
  frozenUntil: number;
  /** 冻结原因（人类可读，供诊断）。 */
  reason: string;
  /** 累计回滚次数。P4 修复（附录 E.2）：解冻后从 frozenParams 移除，rollbackCount 清零重新累积。 */
  rollbackCount: number;
}

/**
 * 参数调整方向。
 * - "up": 信号倾向于增加参数值
 * - "down": 信号倾向于减少参数值
 * - "none": 无调整倾向（条件不满足或已调整后重置）
 */
export type TrendDirection = "up" | "down" | "none";

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
  /**
   * 本次评估产生的最新趋势记录（每个参数的期望方向）。
   * 调用方需将其写回 RoomTuningState.lastTrend，供下次评估确认。
   * 调整触发的参数重置为 "none"；未触发的保留当前方向供下次确认。
   */
  newTrend: Record<string, TrendDirection>;
  /**
   * 改进 A 新增：本次评估触发调整时返回的 pendingValidation 写入指令。
   * key = 参数路径（如 "hauler.maxCount"），value = 待验证记录。
   * 由 tuning-engine 落 Memory（adjustTick 由 tuning-engine 填入当前 tick）。
   */
  pendingValidations?: Record<string, PendingValidation>;
}
