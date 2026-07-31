/**
 * Tuning Engine — P3 系统：基于遥测数据的参数自调优引擎。
 *
 * 职责：
 *   1. 每 500 tick 读取时序数据（economy ring buffer + CPU ring buffer）
 *   2. 读取活快照信号（container 填充率、角色计数、build queue）
 *   3. 聚合为 TuningSignals
 *   4. 调用纯函数 evaluateTuning() 产出调整决策
 *   5. 将调整写入 Memory.kernel.tuning（持久化覆盖值）
 *   6. 记录事件日志供事后追溯
 *
 * 优先级：P3 — 自调优是非关键的后台优化。
 * interval: 500 — 每 500 tick 运行一次（= 10 次 economy 采样窗口）。
 *
 * CPU 预算：正常态 ~0.1-0.2 CPU/run（ring buffer 遍历 + 聚合计算）。
 * 受 P3 budget 门禁：conserve/recovery tier 下跳过。
 *
 * 安全保证：
 *   - 数据不足（< 10 个 economy 采样点）时跳过。
 *   - 所有调整经 clampParam 安全钳制。
 *   - 每个参数有 1000 tick 冷却期防振荡。
 *   - 经济不稳定时完全锁定。
 */

import type { Priority, System, TickContext } from "../kernel/contracts";
import { CONFIG } from "../config";
import { getRoleBounds, TUNABLE_ROLES } from "../config/tuned";
import { evaluateTuning } from "../domain/tuning/evaluator";
import type { TuningSignals, RoomTuningState } from "../domain/tuning/types";
import { readCpuSegment, readEconomySegment } from "../kernel/segment-store";
import { ringToArray } from "../kernel/ring-buffer";
import type { EconomySample, CpuSample } from "../kernel/timeseries";
import { recordEvent, EventKind } from "../kernel/event-log";

// ─── 自定义事件类型（扩展 EventKind）──
// 使用现有 EventKind 的 PluginCooldown 槽位不太合适，
// 这里直接用 console.log 记录调优事件——它们不是游戏状态转换，是运维诊断。

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

    // P1-I：基线版本戳比对 — CONFIG.tuning.baselineVersion 升级后
    // （如 CONFIG.roles 调整了某角色的 min/maxCount），存量 rooms 覆盖
    // 可能基于旧经济假设继续压制新基线。检测不匹配时清空 rooms 覆盖，
    // 自调优从新基线重新收敛。task summary 已确认此为预期行为
    // （「清零重来」语义）。
    if (Memory.kernel.tuning.baselineVersion !== CONFIG.tuning.baselineVersion) {
      const oldVersion = Memory.kernel.tuning.baselineVersion;
      Memory.kernel.tuning.rooms = {};
      // lastEval 是诊断快照（per-room），清掉避免与 rooms 错位。
      delete Memory.kernel.tuning.lastEval;
      Memory.kernel.tuning.baselineVersion = CONFIG.tuning.baselineVersion;
      console.log(
        `[${ctx.tick}] tuning: baselineVersion ${oldVersion ?? "undefined"}→${CONFIG.tuning.baselineVersion}, rooms cleared`,
      );
    }

    // 快照所有房间的当前 bounds —— 评估期间使用快照，避免多房循环中
    // 房间 A 的 applyAdjustment 写入 Memory 后污染房间 B 的 getRoleBounds 读取。
    // 这是"读-写隔离"原则：评估基于 tick 开头的世界状态，调整在 tick 内缓冲。
    //
    // P1-I：快照循环从 TUNABLE_ROLES（与 CONFIG.roles 对齐的 13 角色）派生，
    // 不再硬编码 4 角色。evaluator 当前只对前 4 角色产出调整，其余角色的
    // 快照项无 evaluator 规则消费即空转；补全集是为「未来 evaluator 加入
    // 新角色调整规则时无需改 tuning-engine」做前置准备。
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
 *
 * @param ctx          Tick 上下文
 * @param roomName     被评估房间
 * @param boundsSnapshot 本 tick 开头快照的角色边界——防止多房读-写污染
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

    // 2. 使用 tick 开头的 bounds 快照（而非实时 getRoleBounds）
    const boundsMap = boundsSnapshot;

    // 3. 获取当前调优状态（含上次趋势记录，用于 P1-1 趋势确认）
    const roomTuning = getOrCreateRoomTuning(roomName);
    const prevTrend = roomTuning.lastTrend ?? {};

    // 4. 调用纯函数评估（传入上次趋势，获取新趋势）
    const evaluation = evaluateTuning(
      signals,
      boundsMap,
      roomTuning.lastAdjusted,
      ctx.tick,
      prevTrend,
    );

    // 5. 应用调整
    if (evaluation.adjustments.length > 0) {
      for (const adj of evaluation.adjustments) {
        applyAdjustment(roomName, adj.param, adj.newValue, ctx.tick);
        console.log(
          `[${ctx.tick}] tuning/${roomName}: ${adj.param} ${adj.oldValue}→${adj.newValue} (${adj.reason})`,
        );
      }
    }

    // 6. 保存新趋势记录（P1-1：连续 2 次同方向才调整，单次只记录方向）
    roomTuning.lastTrend = evaluation.newTrend;

    // 7. 保存诊断快照（per-room，避免多房间评估时互相覆盖）
    if (!Memory.kernel!.tuning!.lastEval) {
      Memory.kernel!.tuning!.lastEval = {};
    }
    Memory.kernel!.tuning!.lastEval[roomName] = {
      tick: ctx.tick,
      adjustments: evaluation.adjustments.map(a => `${a.param}=${a.oldValue}→${a.newValue}`),
      signals: evaluation.signals,
      skipped: evaluation.skipped,
      trend: evaluation.newTrend,
    };
  } catch (error) {
    // 调优错误不得中断 tick——静默记录，下次再试。
    console.log(
      `[${ctx.tick}] tuning/${roomName}: error ${(error as Error).message}`,
    );
  }
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

  // 消费端饱和度：spawn+extension 平均填充率。
  // 从 EconomySample.ea/ec 计算，反映评估窗口内的趋势而非瞬时值。
  // ec 为 0（无 spawn）的采样点跳过，避免除零。
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
