/** Tuning Engine */

import type { Priority, System, TickContext } from "../kernel/contracts";
import { CONFIG } from "../config";
import { getRoleBounds, TUNABLE_ROLES } from "../config/tuned";
import { evaluateTuning, verifyPendingAdjustments, applyFreezePolicy } from "../domain/tuning/evaluator";
import type { TuningSignals, RoomTuningState, PendingValidation, FrozenParamState } from "../domain/tuning/types";
import { readCpuSegment, readEconomySegment } from "../kernel/segment-store";
import { ringToArray } from "../kernel/ring-buffer";
import type { EconomySample, CpuSample } from "../kernel/timeseries";
import { recordEvent, EventKind, tuningParamCode } from "../kernel/event-log";
import { log } from "../kernel/log";

// ─── 自定义事件类型（扩展 EventKind）──
// 调优事件写入 event-log（segment 2 有界 ring），console.log 仅作运维提醒；
// EventKind.TuningAdjust/Rollback/Freeze/Blocked 已在 event-log.ts 登记，由
// recordEvent 写入 globalCache().eventBuffer，telemetry-collector 低频 flush。

/** 调优引擎的评估窗口大小（取最近 N 个 economy 采样点）。 */
const EVAL_WINDOW_SIZE = 20;

/** 最少需要的 economy 采样点数，低于此数跳过评估。 */
const MIN_SAMPLES = 10;

// ─── 系统定义 ───────────────────────────────────────────────

export const tuningEngineSystem: System = {
  name: "tuning-engine",
  priority: 3 as Priority,
  interval: CONFIG.tuning.evalInterval,
  run(ctx: TickContext): void {
    // P3 在 conserve/recovery 下不运行。
    if (ctx.budget.tier === "conserve" || ctx.budget.tier === "recovery") return;

    // 确保 tuning Memory 结构存在。
    if (!Memory.kernel) Memory.kernel = {};
    if (!Memory.kernel.tuning) {
      Memory.kernel.tuning = { lastTuned: 0, rooms: {} };
    }

    // P1-I：基线版本戳比对 — CONFIG.tuning.baselineVersion 升级后（如 CONFIG.roles 调整
    // 某角色 min/maxCount），存量 rooms 覆盖可能基于旧经济假设继续压制新基线。检测不匹配
    // 时清空 rooms 覆盖，自调优从新基线重新收敛（「清零重来」语义）。
    if (Memory.kernel.tuning.baselineVersion !== CONFIG.tuning.baselineVersion) {
      const oldVersion = Memory.kernel.tuning.baselineVersion;
      Memory.kernel.tuning.rooms = {};
      // lastEval 是诊断快照（per-room），清掉避免与 rooms 错位。
      delete Memory.kernel.tuning.lastEval;
      Memory.kernel.tuning.baselineVersion = CONFIG.tuning.baselineVersion;
      log.info("tuning-engine", `tuning: baselineVersion ${oldVersion ?? "undefined"}→${CONFIG.tuning.baselineVersion}, rooms cleared`,);
    }

    // 快照所有房间的当前 bounds —— 评估期间使用快照，避免多房循环中房间 A 的
    // applyAdjustment 写入 Memory 后污染房间 B 的 getRoleBounds 读取（读-写隔离：
    // 评估基于 tick 开头世界状态，调整在 tick 内缓冲）。
    //
    // P1-I：快照循环从 TUNABLE_ROLES（与 CONFIG.roles 对齐的 13 角色）派生，不再硬编码
    // 4 角色。evaluator 当前只对前 4 角色产出调整，其余快照项无规则消费即空转；
    // 补全集是为「未来 evaluator 加入新角色规则时无需改 tuning-engine」的前置准备。
    const snapshots = [...ctx.snapshots()];
    const roomBoundsSnapshot = new Map<string, Record<string, { minCount: number; maxCount: number }>>();
    for (const snap of snapshots) {
      const boundsMap: Record<string, { minCount: number; maxCount: number }> = {};
      for (const role of TUNABLE_ROLES) {
        boundsMap[role] = getRoleBounds(role, snap.roomName);
      }
      roomBoundsSnapshot.set(snap.roomName, boundsMap);
    }

    for (const snapshot of snapshots) {
      safeRunTuning(ctx, snapshot.roomName, roomBoundsSnapshot.get(snapshot.roomName)!);
    }

    Memory.kernel.tuning.lastTuned = ctx.tick;
  },
};

// ─── 核心逻辑 ───────────────────────────────────────────────

/**
 * 单房间调优评估（包裹在 safeRun 语义中）。
 * 流程：聚合信号 → 获取/创建 roomTuning → pending-lock（excludedParams = pending + 冻结）
 * → verifyPendingAdjustments（到期验证 → rollbacks/cleared/blocked）→ applyFreezePolicy
 * （回滚计数 + 冻结复位到 CONFIG 基线）→ 应用 rollbacks → evaluateTuning（boundsSnapshot +
 * excludedParams）→ 应用 adjustments（写 Memory + pendingValidation + 事件日志）→
 * 保存 lastTrend + lastEval 诊断。
 * @param boundsSnapshot 本 tick 开头快照的角色边界 — 防止多房读-写污染
 */
function safeRunTuning(
  ctx: TickContext,
  roomName: string,
  boundsSnapshot: Record<string, { minCount: number; maxCount: number }>,
): void {
  try {
    // 1. 聚合信号
    const signals = aggregateSignals(ctx, roomName);
    if (!signals) return;

    // 2. 获取当前调优状态
    const roomTuning = getOrCreateRoomTuning(roomName);

    // 3. [A] pending-lock（附录 D.2）：构造 excludedParams。
    //    包含所有有 pendingValidation 的参数 + 冻结中的参数（frozenUntil > tick）。
    //    注意：excludedParams 在 verify 之前构造，本 tick 即将被 cleared 的参数
    //    仍在排除集内——这是有意的：刚验证完的参数本 tick 不评估，下 tick 从 none
    //    重新积累 trend，防「反向调整早于验证触发」竞态。
    const excludedParams = buildExcludedParams(roomTuning, ctx.tick);

    // P1-2：srcStallTicks > 50 时强制解冻 harvester/hauler maxCount
    // 配合 P0-1 的 srcStallTicks（srcRatio>0.9 AND storageDrainAccum>1000 持续计数）。
    // 在 forceCrisis 触发前（srcStallEnterTicks=50）解冻，让 tuning 有机会上调采集/搬运能力。
    // 只解冻 maxCount 不解冻 minCount（保守，防振荡），且只解冻冻结参数不影响 pending。
    const roomMem = Memory.rooms[roomName];
    const srcStallTicks = roomMem?.phase?.srcStallTicks ?? 0;
    if (signals.srcRatio > 0.9 && srcStallTicks > 50) {
      const criticalParams = ["harvester.maxCount", "hauler.maxCount"];
      for (const p of criticalParams) {
        if (roomTuning.frozenParams?.[p]?.frozenUntil && roomTuning.frozenParams[p]!.frozenUntil > ctx.tick) {
          delete roomTuning.frozenParams[p];
          log.info("tuning-engine", `tuning/${roomName}: FORCE_UNFREEZE ${p} (srcRatio=${signals.srcRatio.toFixed(2)}, stallTicks=${srcStallTicks})`);
        }
        excludedParams.delete(p);
      }
    }

    // 捕获 verify 前的 pending 快照（用于回滚事件的 preAdjustValue 查询）
    const pendingBefore = roomTuning.pendingValidation ?? {};

    // 4. [A] 验证 pass：检查到期 pending 的调整效果
    // P3 修复（附录 E.2）：verify 前继承 evaluateTuning 的全局门禁 —
    // 危机/低 bucket 期间 containerFill/storage 外生暴跌 → 误判未改善 → 误回滚 + 误冻结。
    // 门禁未通过时跳过 verify：pending 保留、excludedParams 仍含 pending、不计回滚，
    // 下周期复验。
    const verifyGate = checkVerifyGate(signals);
    let verifyResult: ReturnType<typeof verifyPendingAdjustments> = {
      rollbacks: [],
      clearedParams: [],
      blockedParams: [],
    };
    let freezeResult: { newlyFrozen: Array<{ param: string; reason: string }> } = { newlyFrozen: [] };
    // P1 诊断：blocked 参数的 blockedSinceTick + lastCheckedTick（仅在 verify 执行时填充）
    let blockedDiag: Record<string, { blockedSinceTick: number; lastCheckedTick: number }> | undefined;

    if (verifyGate.passed) {
      verifyResult = verifyPendingAdjustments(
        signals,
        pendingBefore,
        boundsSnapshot,
        ctx.tick,
      );

      // 5. [A] 冻结策略：确保 frozenParams 容器存在后调用（applyFreezePolicy 原地修改）
      if (!roomTuning.frozenParams) {
        roomTuning.frozenParams = {};
      }
      freezeResult = applyFreezePolicy(
        roomTuning.frozenParams,
        verifyResult.rollbacks,
        verifyResult.clearedParams,
        buildConfigBaselines(),
        ctx.tick,
      );

      // 6. [A] 应用 rollbacks + 清空 cleared pending + 写事件日志
      applyRollbacksAndClearPending(ctx, roomName, roomTuning, verifyResult, pendingBefore);

      // 写冻结事件（D.5）
      writeFreezeEvents(ctx, roomName, freezeResult, roomTuning);

      // P1：写 TuningBlocked 事件 + 构造 blockedParams 诊断
      blockedDiag = writeBlockedEventsAndDiag(ctx, roomName, verifyResult, pendingBefore);
    }

    // 7. [A] 评估（使用 boundsSnapshot 快照 + excludedParams）
    const evaluation = evaluateTuning(
      signals,
      boundsSnapshot,
      roomTuning.lastAdjusted,
      ctx.tick,
      roomTuning.lastTrend ?? {},
      excludedParams,
    );

    // 8. [A] 应用 evaluation.adjustments + 写 pendingValidation + 事件日志
    applyEvaluationAdjustments(ctx, roomName, roomTuning, evaluation);

    // 9. 保存 lastTrend + lastEval 诊断（含 pending/frozen 精简快照 + P3 verifySkipped + P1 blockedParams）
    roomTuning.lastTrend = evaluation.newTrend;
    saveLastEval(
      ctx,
      roomName,
      evaluation,
      roomTuning,
      {
        ...(verifyGate.skippedReason ? { verifySkipped: verifyGate.skippedReason } : {}),
        ...(blockedDiag ? { blockedParams: blockedDiag } : {}),
      },
    );
  } catch (error) {
    // 调优错误不得中断 tick——静默记录，下次再试。
    log.error("tuning-engine", `tuning/${roomName}: error ${(error as Error).message}`,);
  }
}

/**
 * P3 修复（附录 E.2）：verify pass 全局门禁 — 与 evaluateTuning 的门禁一致：
 * tierRank < 2（healthy/guarded 才验证）；crisisRatio <= 0.3（危机比例超阈值时
 * 外生信号不可信）；rcl >= 2（RCL 过低时经济信号无意义）。门禁未通过返回
 * skippedReason，调用方据此跳过 verify 并记录诊断。
 */
function checkVerifyGate(signals: TuningSignals): { passed: boolean; skippedReason?: string } {
  // 检查顺序与 evaluateTuning 一致：tier → crisis → rcl
  if (signals.tierRank >= 2) {
    return { passed: false, skippedReason: "verify_skipped_cpu_tier" };
  }
  if (signals.crisisRatio > 0.3) {
    return { passed: false, skippedReason: "verify_skipped_crisis" };
  }
  if (signals.rcl < 2) {
    return { passed: false, skippedReason: "verify_skipped_rcl" };
  }
  return { passed: true };
}

// ─── 改进 A 辅助函数 ───────────────────────────────────────

/**
 * 构造 pending-lock + frozen 排除集（附录 D.2）。
 * 排除集中的参数在 evaluateTuning 中跳过评估，newTrend 置为 "none"。
 */
function buildExcludedParams(roomTuning: RoomTuningState, currentTick: number): Set<string> {
  const excluded = new Set<string>();
  // pending 验证中的参数
  if (roomTuning.pendingValidation) {
    for (const param in roomTuning.pendingValidation) {
      excluded.add(param);
    }
  }
  // 冻结未到期的参数（frozenUntil > tick）
  if (roomTuning.frozenParams) {
    for (const param in roomTuning.frozenParams) {
      const fp = roomTuning.frozenParams[param];
      if (fp && fp.frozenUntil > currentTick) {
        excluded.add(param);
      }
    }
  }
  return excluded;
}

/**
 * 构建 CONFIG 基线值表（用于 D.5 冻结复位）。
 * key = "role.maxCount"/"role.minCount"，value = CONFIG 默认值。
 */
function buildConfigBaselines(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const role of TUNABLE_ROLES) {
    const cfg = CONFIG.roles[role as keyof typeof CONFIG.roles];
    if (cfg) {
      result[`${role}.maxCount`] = cfg.maxCount;
      result[`${role}.minCount`] = cfg.minCount;
    }
  }
  return result;
}

/**
 * 应用回滚到 Memory + 清空已验证 pending + 写 TuningRollback 事件。
 * 回滚走 applyAdjustment（lastAdjusted=ctx.tick 触发冷却，防同 tick 反向调整）；
 * clearedParams（含回滚与验证通过）的 pendingValidation 全部清空，闭环结束。
 */
function applyRollbacksAndClearPending(
  ctx: TickContext,
  roomName: string,
  roomTuning: RoomTuningState,
  verifyResult: { rollbacks: Array<{ param: string; oldValue: number; newValue: number; reason: string }>; clearedParams: string[] },
  pendingBefore: Record<string, PendingValidation>,
): void {
  // 应用回滚值（applyFreezePolicy 可能已把冻结参数的 newValue 改为 CONFIG 基线）
  for (const rb of verifyResult.rollbacks) {
    applyAdjustment(roomName, rb.param, rb.newValue, ctx.tick);
    const pv = pendingBefore[rb.param];
    const preAdjustValue = pv?.preAdjustValue ?? rb.newValue;
    // TuningRollback: d=[paramCode, rolledBackValue, preAdjustValue]
    // rolledBackValue = 回滚到的值（冻结时为 CONFIG 基线，否则等于 preAdjustValue）
    recordEvent(EventKind.TuningRollback, roomName, [
      tuningParamCode(rb.param),
      rb.newValue,
      preAdjustValue,
    ]);
    log.info("tuning-engine", `tuning/${roomName}: ROLLBACK ${rb.param} ${rb.oldValue}→${rb.newValue} (${rb.reason})`,);
  }

  // 清空 clearedParams 的 pendingValidation（验证完成，闭环结束）。
  if (roomTuning.pendingValidation) {
    for (const param of verifyResult.clearedParams) {
      delete roomTuning.pendingValidation[param];
    }
    // 空对象回收，控体积
    if (Object.keys(roomTuning.pendingValidation).length === 0) {
      delete roomTuning.pendingValidation;
    }
  }
}
/**
 * 写 TuningFreeze 事件 + 运维 console.log。
 * d=[paramCode, rollbackCount, frozenUntilDelta]
 */
function writeFreezeEvents(
  ctx: TickContext,
  roomName: string,
  freezeResult: { newlyFrozen: Array<{ param: string; reason: string }> },
  roomTuning: RoomTuningState,
): void {
  for (const f of freezeResult.newlyFrozen) {
    const fp = roomTuning.frozenParams?.[f.param];
    if (!fp) continue;
    recordEvent(EventKind.TuningFreeze, roomName, [
      tuningParamCode(f.param),
      fp.rollbackCount,
      fp.frozenUntil - ctx.tick,
    ]);
    log.info("tuning-engine", `tuning/${roomName}: FROZEN ${f.param} (rollbackCount=${fp.rollbackCount}, until Δ=${fp.frozenUntil - ctx.tick})`,);
  }
}

/**
 * P1 修复（附录 E.2）：写 TuningBlocked 事件 + 构造 blockedParams 诊断。
 * blockedDurationTicks = ctx.tick - pv.blockedSinceTick（「已 blocked 多久」可观测性）。
 * 注意：blocked 不清空 pending（保留，下周期继续验证）；仅 TTL 超时（verifyPending
 * Adjustments 内判定）才加入 rollbacks + clearedParams。
 */
function writeBlockedEventsAndDiag(
  ctx: TickContext,
  roomName: string,
  verifyResult: { blockedParams: string[] },
  pendingBefore: Record<string, PendingValidation>,
): Record<string, { blockedSinceTick: number; lastCheckedTick: number }> | undefined {
  if (verifyResult.blockedParams.length === 0) return undefined;
  const diag: Record<string, { blockedSinceTick: number; lastCheckedTick: number }> = {};
  for (const param of verifyResult.blockedParams) {
    const pv = pendingBefore[param];
    const blockedSinceTick = pv?.blockedSinceTick ?? ctx.tick;
    const blockedDurationTicks = ctx.tick - blockedSinceTick;
    recordEvent(EventKind.TuningBlocked, roomName, [
      tuningParamCode(param),
      pv?.preAdjustValue ?? 0,
      blockedDurationTicks,
    ]);
    log.info("tuning-engine", `tuning/${roomName}: BLOCKED ${param} (blockedSince Δ=${blockedDurationTicks}, preAdjustValue=${pv?.preAdjustValue ?? 0})`,);
    diag[param] = {
      blockedSinceTick,
      lastCheckedTick: ctx.tick,
    };
  }
  return diag;
}

/**
 * 应用 evaluation 产出的调整：写 Memory + 写 pendingValidation + 写 TuningAdjust 事件。
 */
function applyEvaluationAdjustments(
  ctx: TickContext,
  roomName: string,
  roomTuning: RoomTuningState,
  evaluation: { adjustments: Array<{ param: string; oldValue: number; newValue: number; reason: string }>; pendingValidations?: Record<string, PendingValidation> },
): void {
  for (const adj of evaluation.adjustments) {
    applyAdjustment(roomName, adj.param, adj.newValue, ctx.tick);
    // adjustDirectionCode: 0=up, 1=down
    const directionCode = adj.newValue > adj.oldValue ? 0 : 1;
    recordEvent(EventKind.TuningAdjust, roomName, [
      tuningParamCode(adj.param),
      adj.oldValue,
      adj.newValue,
      directionCode,
    ]);
    log.info("tuning-engine", `tuning/${roomName}: ${adj.param} ${adj.oldValue}→${adj.newValue} (${adj.reason})`,);
  }

  // 写 pendingValidation（覆盖旧记录，adjustTick 由 evaluator 填入）
  if (evaluation.pendingValidations) {
    if (!roomTuning.pendingValidation) {
      roomTuning.pendingValidation = {};
    }
    for (const param in evaluation.pendingValidations) {
      roomTuning.pendingValidation[param] = evaluation.pendingValidations[param]!;
    }
  }
}

/**
 * 保存 lastEval 诊断快照（含 pending/frozen 精简状态，控体积不存完整快照）。
 * P3/P1 修复（附录 E.2）：diagnostics 参数注入 verifySkipped（危机期 verify 跳过原因）
 * 与 blockedParams（人口合同 blocked 诊断），避免修改 evaluation 数据结构。
 */
function saveLastEval(
  ctx: TickContext,
  roomName: string,
  evaluation: { adjustments: Array<{ param: string; oldValue: number; newValue: number; reason: string }>; signals: Record<string, number>; skipped?: string; newTrend: Record<string, "up" | "down" | "none"> },
  roomTuning: RoomTuningState,
  diagnostics?: {
    /** P3：verify pass 被跳过的原因（危机/低 bucket/rcl 过低）。 */
    verifySkipped?: string;
    /** P1：人口合同 blocked 参数诊断。 */
    blockedParams?: Record<string, { blockedSinceTick: number; lastCheckedTick: number }>;
  },
): void {
  if (!Memory.kernel!.tuning!.lastEval) {
    Memory.kernel!.tuning!.lastEval = {};
  }
  const pendingDiag = buildPendingDiag(roomTuning.pendingValidation);
  const frozenDiag = buildFrozenDiag(roomTuning.frozenParams);
  // 用展开装配可选字段，避免复杂索引类型表达式；新字段类型由 global.d.ts 登记
  Memory.kernel!.tuning!.lastEval[roomName] = {
    tick: ctx.tick,
    adjustments: evaluation.adjustments.map(a => `${a.param}=${a.oldValue}→${a.newValue}`),
    signals: evaluation.signals,
    ...(evaluation.skipped !== undefined ? { skipped: evaluation.skipped } : {}),
    ...(diagnostics?.verifySkipped ? { verifySkipped: diagnostics.verifySkipped } : {}),
    trend: evaluation.newTrend,
    ...(pendingDiag ? { pendingValidations: pendingDiag } : {}),
    ...(frozenDiag ? { frozenParams: frozenDiag } : {}),
    ...(diagnostics?.blockedParams ? { blockedParams: diagnostics.blockedParams } : {}),
  };
}

/** 构造 pendingValidation 精简诊断（不含 preAdjustSignals 完整快照，控体积）。 */
function buildPendingDiag(
  pending: Record<string, PendingValidation> | undefined,
): Record<string, { adjustTick: number; expectedDirection: "improve" | "worsen"; adjustDirection: "up" | "down"; contractBlocked?: boolean }> | undefined {
  if (!pending || Object.keys(pending).length === 0) return undefined;
  const result: Record<string, { adjustTick: number; expectedDirection: "improve" | "worsen"; adjustDirection: "up" | "down"; contractBlocked?: boolean }> = {};
  for (const param in pending) {
    const pv = pending[param]!;
    const diag: { adjustTick: number; expectedDirection: "improve" | "worsen"; adjustDirection: "up" | "down"; contractBlocked?: boolean } = {
      adjustTick: pv.adjustTick,
      expectedDirection: pv.expectedDirection,
      adjustDirection: pv.adjustDirection,
    };
    if (pv.contractBlocked) diag.contractBlocked = true;
    result[param] = diag;
  }
  return result;
}

/** 构造 frozenParams 精简诊断。 */
function buildFrozenDiag(
  frozen: Record<string, FrozenParamState> | undefined,
): Record<string, { frozenUntil: number; rollbackCount: number; reason: string }> | undefined {
  if (!frozen || Object.keys(frozen).length === 0) return undefined;
  const result: Record<string, { frozenUntil: number; rollbackCount: number; reason: string }> = {};
  for (const param in frozen) {
    const fp = frozen[param]!;
    result[param] = {
      frozenUntil: fp.frozenUntil,
      rollbackCount: fp.rollbackCount,
      reason: fp.reason,
    };
  }
  return result;
}

// ─── 信号聚合 ───────────────────────────────────────────────

/**
 * 从时序数据和活快照聚合 TuningSignals。
 * 返回 null 表示数据不足，调用方应跳过评估。
 */
function aggregateSignals(ctx: TickContext, roomName: string): TuningSignals | null {
  const cpuSeg = readCpuSegment();
  const econSeg = readEconomySegment();

  // ── 经济趋势信号（从 economy ring buffer）──
  const allEconomy = ringToArray(econSeg.economy) as EconomySample[];
  const roomEconomy = allEconomy.filter(s => s.r === roomName);
  const recentEconomy = roomEconomy.slice(-EVAL_WINDOW_SIZE);

  if (recentEconomy.length < MIN_SAMPLES) return null;

  const avgReserveDelta = avg(recentEconomy.map(s => s.d));
  const avgPressure = avg(recentEconomy.map(s => s.p / 100));
  const avgDrainScore = avg(recentEconomy.map(s => s.ds));
  const crisisRatio = recentEconomy.filter(s => s.ph === 2 || s.ph === 3).length / recentEconomy.length;
  const avgStorageEnergy = avg(recentEconomy.map(s => s.se));

  // 消费端饱和度：spawn+extension 平均填充率 — 从 EconomySample.ea/ec 计算，
  // 反映评估窗口内的趋势而非瞬时值；ec 为 0（无 spawn）的采样点跳过，避免除零。
  const fillSamples = recentEconomy.filter(s => s.ec > 0);
  const avgSpawnFillRatio = fillSamples.length > 0
    ? avg(fillSamples.map(s => s.ea / s.ec))
    : 0;

  // ── CPU 信号（从 CPU ring buffer，全局）──
  const cpuSamples = ringToArray(cpuSeg.cpu) as CpuSample[];
  const recentCpu = cpuSamples.slice(-EVAL_WINDOW_SIZE);
  const tierRank = recentCpu.length > 0
    ? Math.round(avg(recentCpu.map(s => s.ti)))
    : 0;

  // ── 活快照信号 ──
  const snapshot = ctx.getSnapshot(roomName);
  if (!snapshot) return null;

  // container 填充率
  let containerFillRatio = 0;
  if (snapshot.containers.length > 0) {
    let totalFill = 0;
    for (const c of snapshot.containers) {
      const cap = c.store.getCapacity(RESOURCE_ENERGY) || 1;
      totalFill += c.store.getUsedCapacity(RESOURCE_ENERGY) / cap;
    }
    containerFillRatio = totalFill / snapshot.containers.length;
  }

  // 角色计数（从 Game.creeps）
  const counts = countRolesByHome(roomName);

  // build queue backlog
  const roomMem = Memory.rooms[roomName];
  const buildQueueBacklog = roomMem?.buildQueue
    ? roomMem.buildQueue.filter(t => t.state === "queued").length
    : 0;

  // P1-2：srcRatio 信号（采集塌方检测）— 取最满 source 填充率
  let srcRatio = 0;
  for (const s of snapshot.sources) {
    const cap = (s as Source).energyCapacity ?? 3000;
    if (cap > 0) {
      const fill = ((s as Source).energy ?? 0) / cap;
      if (fill > srcRatio) srcRatio = fill;
    }
  }

  return {
    avgReserveDelta,
    avgPressure,
    avgDrainScore,
    crisisRatio,
    avgStorageEnergy,
    containerFillRatio,
    spawnFillRatio: avgSpawnFillRatio,
    haulerCount: counts.hauler ?? 0,
    harvesterCount: counts.harvester ?? 0,
    upgraderCount: counts.upgrader ?? 0,
    builderCount: counts.builder ?? 0,
    buildQueueBacklog,
    srcRatio,
    tierRank,
    rcl: snapshot.rcl,
  };
}

// ─── 调整应用 ───────────────────────────────────────────────

/** 将调整写入 Memory.kernel.tuning。 */
function applyAdjustment(
  roomName: string,
  param: string,
  newValue: number,
  tick: number,
): void {
  const roomTuning = getOrCreateRoomTuning(roomName);

  // param 格式: "role.field"，如 "hauler.maxCount"
  const [role, field] = parseParam(param);
  if (!role || !field) return;

  if (!roomTuning.roleBounds[role]) {
    roomTuning.roleBounds[role] = {};
  }

  if (field === "maxCount") {
    roomTuning.roleBounds[role]!.maxCount = newValue;
  } else if (field === "minCount") {
    roomTuning.roleBounds[role]!.minCount = newValue;
  }

  roomTuning.lastAdjusted[param] = tick;
}

/** 获取或创建房间的调优状态。 */
function getOrCreateRoomTuning(roomName: string): RoomTuningState {
  if (!Memory.kernel) Memory.kernel = {};
  if (!Memory.kernel.tuning) {
    Memory.kernel.tuning = { lastTuned: 0, rooms: {} };
  }
  if (!Memory.kernel.tuning.rooms[roomName]) {
    Memory.kernel.tuning.rooms[roomName] = {
      roleBounds: {},
      lastAdjusted: {},
    };
  }
  return Memory.kernel.tuning.rooms[roomName]!;
}

// ─── 辅助函数 ───────────────────────────────────────────────

/** 数组平均值。 */
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** 统计指定 home 房间各角色的存活 creep 数。 */
function countRolesByHome(roomName: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (!creep) continue;
    if ((creep.memory.home ?? creep.room.name) !== roomName) continue;
    const role = creep.memory.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

/** 解析参数路径 "hauler.maxCount" → ["hauler", "maxCount"]。 */
function parseParam(param: string): [string, string] | [undefined, undefined] {
  const idx = param.indexOf(".");
  if (idx === -1) return [undefined, undefined];
  return [param.slice(0, idx), param.slice(idx + 1)];
}
