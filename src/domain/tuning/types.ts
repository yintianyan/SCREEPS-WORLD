/**
 * 遥测自调参类型契约（在静态 CONFIG 之上叠加运行时覆盖）。
 * 数据流：ring buffer + 活快照 → TuningSignals → evaluateTuning → 调整写入
 * Memory.kernel.tuning.rooms[*].roleBounds → 查询时覆盖 CONFIG。
 * evaluator 保持纯函数，不依赖 Game/Memory。
 */

// ─── 聚合信号 ───────────────────────────────────────────────

/** 聚合遥测信号（tuning-engine 在评估时构建，传入纯函数 evaluator）。 */
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
  /** spawn+extension 平均填充率 — 消费端饱和度（高=消费端已满，加 hauler 无益；由 EconomySample.ea/ec 均值算）。 */
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
  /** P1-2：最满 source 的填充率 — 持续 >0.9 = source 满载但采不动（采集塌方信号），配合 RoomMemory.phase.srcStallTicks 判断强制解冻。 */
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
  /** 上次评估的期望方向（P1-1 趋势确认）：连续 2 次同方向才触发调整；调整后置 none 重新积累。 */
  lastTrend?: Record<string, TrendDirection>;
  /**
   * 调整效果验证闭环（改进 A）：触发调整时写入信号快照 + 期望方向，verifyDelay
   * 到期后信号未按期望改善 → 回滚，闭环结束清空。pending 存在期间该参数整体排除
   * 评估（D.2 pending-lock，防「反向调整早于验证触发」竞态）。
   */
  pendingValidation?: Record<string, PendingValidation>;
  /**
   * P3 冻结：连续 ROLLBACK_FREEZE_THRESHOLD(3) 次回滚 → 冻结 FROZEN_DURATION(10000)
   * tick 跳过评估。D.5 评审修正：冻结只停评估不停值 — 复位 CONFIG 基线避免钉死错误值；
   * 解冻后 rollbackCount 清零（P4）重新累积；frozenUntil=0 = 未冻结仅计数。
   */
  frozenParams?: Record<string, FrozenParamState>;
}

/** 验证用的信号子集 — 只记该参数依赖的 1-2 个核心信号（避免噪声 + 控 Memory 体积）。 */
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

/** 待验证调整记录：evaluator 触发调整时构造（confirmAndBuild），tuning-engine 在 verifyDelay 到期后验证。 */
export interface PendingValidation {
  /** 调整前的 signals 快照（仅记本参数相关的子集，控体积）。 */
  preAdjustSignals: AdjustSignalsSnapshot;
  /** 期望信号方向："improve"=朝好方向（如 containerFillRatio 下降）；"worsen"=主动恶化（如 upgrader 上调期望 storage 下降=节能生效）。 */
  expectedDirection: "improve" | "worsen";
  /** 调整方向："up"=增加参数值 / "down"=减少参数值。 */
  adjustDirection: "up" | "down";
  /** 调整时的 tick（= lastAdjusted[param]）。 */
  adjustTick: number;
  /** 调整前的值（用于回滚）。 */
  preAdjustValue: number;
  /** D.3 人口合同前置：true=人口未到位（下周期复验，不计回滚）；false/undefined=正常验证。 */
  contractBlocked?: boolean;
  /**
   * P1（附录 E.2）blocked TTL 基准 tick：首次 blocked 写入 currentTick、后续保留、
   * 人口满足时 delete；连续 2 个 verifyDelay 窗口未达人口 → 回滚 + 计次 + 写 TuningBlocked 事件。
   * 依据：tuning 触发阈值（containerFill>0.7）与 demand 孵化阈值（0.4/0.8 分档）口径不同
   * + 能量饥饿排队，合同可能长期不满足 — TTL 防参数被 pending-lock 永久排除且零告警。
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

/** 调整方向：up=信号倾向增 / down=减 / none=无倾向（条件不满足或已调整后重置）。 */
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
  /** 最新趋势记录：调用方写回 RoomTuningState.lastTrend；调整触发的参数置 none，其余保留。 */
  newTrend: Record<string, TrendDirection>;
  /** 触发调整时返回的 pendingValidation 写入指令（tuning-engine 落 Memory，adjustTick 由它填）。 */
  pendingValidations?: Record<string, PendingValidation>;
}
