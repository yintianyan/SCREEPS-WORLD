/** Event Log — 离散事件日志的采集与持久化。 */

import type { RingBuffer } from "./ring-buffer";
import { globalCache } from "./global-cache";
import { CONFIG } from "../config";

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
  /** Creep 死亡（战斗黑匣子）。d = [roleCode, x, y, age, natural(0/1)]。
   * 位置来自 creepLastSeen 缓存，缺位时 x=y=-1；natural = 寿终正寝
   * （age 达到寿命阈值），非 natural 死亡是战损/事故的复盘线索。 */
  CreepDeath = 17,
  /** 塔齐射（战斗黑匣子）。d = [firedCount, targetX, targetY, targetHealParts, floor(targetHits/100)]。
   * 每 tick 每房至多一条（全塔集火同一目标），战斗期形成连续弹道记录。 */
  TowerVolley = 18,
  /** 改进 A：tuning 参数调整。d = [paramCode, oldValue, newValue, adjustDirectionCode(0=up/1=down)]。
   * 由 tuning-engine 在 applyAdjustment 时记录，提供附录 C.1 缺失的 adjustHistory 审计源。 */
  TuningAdjust = 19,
  /** 改进 A：tuning 参数回滚（验证失败）。d = [paramCode, rolledBackValue, preAdjustValue]。
   * 验证 pass 发现调整未改善信号时触发回滚。 */
  TuningRollback = 20,
  /** 改进 A：tuning 参数冻结（连续回滚达阈值）。d = [paramCode, rollbackCount, frozenUntilDelta]。
   * 冻结时参数复位到 CONFIG 基线（附录 D.5），console.log 降级为运维提醒。 */
  TuningFreeze = 21,
  /** P1 修复（附录 E.2）：tuning 人口合同 blocked 超时回滚。
   * d = [paramCode, preAdjustValue, blockedDurationTicks]；roleCount 持续未达新边界
   * 超过 2 个 verifyDelay 窗口 → 回滚。与 TuningRollback（效果验证失败）区分。 */
  TuningBlocked = 22,
  /** R4 战争收摊核验（战后验收闭环）：一次战争计划收摊时的战果结论。
   * d = [outcomeCode(0=success/1=failure/2=unknown), spawned, reasonCode(0=姿态退出/1=战损止损/2=无合格目标/3=计划超期换目标)]。
   * 供战斗黑匣子复盘：投入多少孵化请求、因何收摊、核验结论如何。 */
  WarOutcome = 23,
  /** R5 跨房能量互济：一笔 terminal.send 救助成交。d = [amount]；r = 受助房名。
   * 捐赠房名见 console.log 明细（事件体积优先，r 保留「谁被救」这一复盘焦点）。 */
  EnergyTransfer = 24,
  /** R6a 帝国议程切换：短期目标变更。d = [initiativeCode(0=recovery/1=defense-readiness/2=rcl-push/3=develop)]；
   * r = ""（帝国级事件）。观测「帝国当前在主动做什么」与目标切换节奏。 */
  AgendaChange = 25,
  /** R6b 侦察任务收摊：一次主动情报任务的结论。d = [outcomeCode(0=success/1=timeout/2=death/3=aborted), spawned]；
   * r = 目标房。复盘侦察成功率与「谁值得再侦察」。 */
  ProspectOutcome = 26,
  /** R7a 扩张任务归因：claim 或 pioneering 阶段的收摊结论。
   * d = [phaseCode(0=claim/1=pioneer), outcomeCode(0=success/1=stolen/2=timeout/3=lostOrHostile/4=aborted), durationTicks]；
   * r = 目标房。供扩张节奏自适应（R7b）归因「什么条件下扩张会失败」。 */
  ExpansionOutcome = 28,
  /** R7a 议程窗口归因：退出某议程时记录窗口收益。
   * d = [initiativeCode, progressGained, durationTicks]；r = ""。rcl-push 窗口的
   * controller 进度增量 → 升级速率证据（评估冲级议程是否值得）。 */
  AgendaOutcome = 29,
  /** 跨房矿物互济：一笔 terminal.send 矿物救助成交。d = [amount]；r = 受助房名。
   * 矿物类型与捐赠房见 console.log 明细（事件体积优先，口径与 EnergyTransfer 对齐）。 */
  MineralTransfer = 30,
  /** Power Creep 里程碑（v34）：d = [阶段码]，0=create / 1=upgrade(+power) /
   * 2=spawn 孵化 / 3=enableRoom。失败静默不记事件（下轮自然重试）。 */
  PowerCreepMilestone = 31,
  /** 核弹发射（nuker 威慑链）：d = [目标塔数]；r = 目标房名。发射失败静默
   * （下轮自然重试）；同目标在途期间不重复发射（shouldLaunchNuke 门禁）。 */
  NukeLaunched = 32,
  /** 敌方核弹落点预警（nuke 感知链，审计缺口 1）：d = [timeToLand]；r = 落点房。
   * 同一 nuke id 只报一次（globalCache 差分；global reset 后重报一次无害 —
   * 环形缓冲的幂等记录）。 */
  NukeDetected = 33,
  /** nuke 资产抢救发运（抢救链，审计缺口 3）：d = [resourceCode(0=power/1=G/
   * 2=化合物/3=battery/4=基础矿物/5=能量), amount]；r = 抢救房名。
   * 接收房名见 console.log 明细（口径与 EnergyTransfer 对齐）。 */
  NukeSalvage = 34,
  /** PB 野采任务收摊（野采链，审计缺口 2）：d = [reasonCode(0=done/1=attrition/
   * 2=timeout/3=war-preempt), spawned]；r = PB 目标房。开任务记 reasonCode=4。 */
  PowerFarmOutcome = 35,
  /** 态势条件变迁（empire-strategy 写）。d = [severity]。r = 条件 id。 */
  SituationChange = 36,
  /** 期望自检违例（kernel 写 —— 帝国自我诊断通道）。d = [violationCount]。 */
  ExpectationViolation = 37,
  /** P3 能量核算连续漂移超容差（economy 写，先修核算再发展）。d = [drift, streak]。 */
  AccountingDrift = 38,
  /** P3 物流请求 TTL 过期出池（不静默丢单回执）。r = 房间，d = [key]。 */
  RequestExpired = 39,
  /** A5.3 军事行动计划创建：war-planning-system 产出一个新 WarPlan。
   * d = [statusCode(0=PLANNED~9=EXPIRED), priorityScore]；r = 目标房名。
   * 供战斗黑匣子复盘：计划创建时的初始状态与优先级。 */
  WarPlanCreated = 40,
}

// ─── 角色编码表（CreepDeath 事件的 roleCode）─────────────────

/** 角色名 → 稳定整数编码。新增角色只能追加，不得重排（历史事件依赖）。 */
const ROLE_CODES: Record<string, number> = {
  harvester: 0,
  hauler: 1,
  distributor: 2,
  upgrader: 3,
  builder: 4,
  worker: 5,
  defender: 6,
  remoteHarvester: 7,
  remoteHauler: 8,
  reserver: 9,
  claimer: 10,
  remoteDefender: 11,
  mineralMiner: 12,
  attacker: 13,
};

/** 角色名编码；未知角色返回 99。 */
export function roleCode(role: string): number {
  return ROLE_CODES[role] ?? 99;
}

/** roleCode 反查（离线分析用）。 */
export function roleName(code: number): string {
  for (const [name, c] of Object.entries(ROLE_CODES)) {
    if (c === code) return name;
  }
  return "unknown";
}

// ─── tuning 参数编码表（TuningAdjust/Rollback/Freeze 事件的 paramCode）──

/** tuning 参数路径 → 稳定整数编码。新增参数只能追加，不得重排。 */
const TUNING_PARAM_CODES: Record<string, number> = {
  "hauler.maxCount": 0,
  "hauler.minCount": 1,
  "harvester.maxCount": 2,
  "upgrader.maxCount": 3,
  "builder.maxCount": 4,
};

/** tuning 参数路径编码；未知参数返回 99。 */
export function tuningParamCode(param: string): number {
  return TUNING_PARAM_CODES[param] ?? 99;
}

// ─── 事件数据结构 ────────────────────────────────────────────

/**
 * 单个游戏事件。
 * d 数组按 EventKind 不同解释不同字段，
 * 紧凑整数编码以最小化 segment 占用。
 */
export interface GameEvent {
  t: number;
  k: number;
  /** 关联房间名（可空，用空串表示全局事件）。 */
  r: string;
  /** 数据字段（变长，按 kind 解释）。 */
  d: number[];
}

// ─── Segment 2 数据结构 ──────────────────────────────────────

/** Segment 2 的顶层结构：事件日志环形缓冲区。 */
export interface EventLogSegmentData {
  events: RingBuffer<GameEvent>;
}

// ─── 事件 buffer（per-tick heap）──────────────────────────────

/** per-tick 事件缓冲区接口（挂在 globalCache().eventBuffer 上）。 */
export interface EventBuffer {
  events: GameEvent[];
}

// ─── 公共 API ───────────────────────────────────────────────

/** 记录一个离散事件：写入 globalCache().eventBuffer（heap），telemetry-collector 低频 flush 到 segment。
 * 可从任意系统安全调用 — 不访问 Memory/segment，CPU 开销极低（数组 push）。 */
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

/** 记录 creep 死亡事件（战斗黑匣子 M9）。
 * 由 maintainMemory 在清理死者 memory 时调用 — 死者已不在 Game.creeps，
 * 位置取自上 tick 预构建的 creepLastSeen（maintainMemory 先于 buildSnapshots）。
 * 出生 tick 从 creep 名解析（role-home-idx-birthTick-rand）；natural 阈值留
 * 60 tick 余量吸收孵化时长与位置滞后。非标准命名（手工注入/外部 creep）静默跳过。 */
export function recordCreepDeath(name: string): void {
  const parts = name.split("-");
  if (parts.length < 5) return;
  const role = parts[0]!;
  const birth = Number(parts[parts.length - 2]);
  if (!Number.isFinite(birth)) return;
  const age = Game.time - birth;
  // CLAIM 部件角色寿命 600，其余 1500。
  const lifespan = role === "reserver" || role === "claimer" ? 600 : 1500;
  const natural = age >= lifespan - 60 ? 1 : 0;
  const seen = globalCache().creepLastSeen?.get(name);
  recordEvent(EventKind.CreepDeath, seen?.r ?? "", [
    roleCode(role),
    seen?.x ?? -1,
    seen?.y ?? -1,
    age,
    natural,
  ]);
  // M11 safe mode 熔断的战损计数：仅非自然死亡入账（寿终不是战损）。
  // 惰性清理两倍窗口前的旧记录，防止数组无界增长。
  if (natural === 0) {
    const g = globalCache();
    const fuseWindow = CONFIG.defense.fleetLossFuse.windowTicks;
    const list = (g.recentCombatDeaths ?? []).filter(d => Game.time - d.t <= fuseWindow * 2);
    list.push({ t: Game.time, r: seen?.r ?? "" });
    g.recentCombatDeaths = list;
  }
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
