/**
 * Room Economic Contract — A2 后半·Room 向 Empire 暴露的标准化经济接口。
 *
 * 合同锚点：EMPIRE_SYSTEM_MODEL §1 Room 接口（Report/Request/Directive-channel）、
 * ECONOMY §2 九概念 + §3 三指标、STATE_OWNERSHIP §3.5–§3.6。
 *
 * 设计意图：当前 Empire 层（empire-strategy.ts）直接遍历 Memory 字段拼凑
 * RoomStrategyInput——这是蓝图允许的（DATA_FLOW §1），但缺少一个显式的
 * Room Economic Contract。本模块把分散的 Memory 字段 + Economy 快照 + RoomSnapshot
 * 组装为一个标准化、类型安全的 Read Model，供 Empire 级纯函数消费。
 *
 * 纯函数律（DEP_GRAPH §3-5，SYSTEM_BOUNDARIES §2.3-3）：
 *   - 不引用 Game / Memory / RawMemory（lint 红线）
 *   - 全部输入由参数注入（调用方 = 系统侧薄壳）
 *   - 不写任何状态——只读组装
 *
 * 数据来源（三个输入源，均已在 tick 执行前更新）：
 *   1. RoomSnapshot — kernel 每 tick 重建（活对象快照）
 *   2. RoomMemory — room-state (P0) + economy (P1/50t) 写入的结构化字段
 *   3. EconomyQuery — economy.ts 的 queryEconomy() 公开接口返回值
 */

import type { RoomSnapshot, ColonyState } from "../../kernel/contracts";
import type { ColonyPhase } from "./phase";

/**
 * Economy 查询结果接口（镜像 systems/economy.ts EconomyQuery）。
 * domain 层不能 import systems 层（合规测试 R1），故在此定义结构等效类型。
 * 系统侧薄壳调用 buildRoomEconomicProfile 时传入 EconomyQuery（结构兼容）。
 */
export interface EconomyQueryInput {
  tick: number;
  netFlow: number;
  contractReserve: number;
  riskBuffer: number;
  drift: number;
  estimatedIncome: number;
  efficiency: number;
}

// ─── Room Economic Classification ──────────────────────────

/**
 * Room 经济分类（EMPIRE_SYSTEM_MODEL §1 Room「能力门槛 phase」隐含定义）。
 *
 * 从 colonyState + RCL + storage + netFlow 派生的经济能力层级，
 * 供 Empire 判断房间在帝国经济中的角色定位。
 *
 * - Core：经济成熟的自有房（RCL≥6 + storage + netFlow≥0 + colonyState=normal）
 *   — 帝国基座，可承担调拨源 / 代孵 / 远矿 sponsor 职责
 * - Production：发展中的自有房（RCL4-5 或 storage 刚建 + colonyState=normal）
 *   — 自立但尚未有余力对外输出
 * - Candidate：低 RCL 的新房（RCL<4 或无 storage）
 *   — 需帝国关注/扶植，不具备对外输出能力
 * - Struggling：经济困难房（colonyState=recovery/bootstrap/defense）
 *   — 净消耗者，需要支援或至少不被抽离
 */
export type RoomEconomicClass = "core" | "production" | "candidate" | "struggling";

// ─── Room Economic Profile ────────────────────────────────

/**
 * Room Economic Profile — 房间向 Empire 暴露的标准化经济只读视图。
 *
 * 合同映射：
 * - Report 通道（EMPIRE_SYSTEM_MODEL §1 Room）：净流/缺口/风险 → 本 Profile 的
 *   netFlow / deficit / riskBuffer 字段
 * - Economy 三指标（ECONOMY §3）：netFlow / reserve / riskBuffer → 本 Profile
 *   的对应字段（从 EconomyQuery 派生）
 * - 九概念快照（ECONOMY §2）：Income/Consumption/Storage/Reservation →
 *   本 Profile 的 income / consumption / storage / reserved 字段
 * - Room Economic Classification：economicClass 字段
 *
 * 不变量：
 * - 所有字段从调用方注入的三个源派生，不做任何 Game/Memory 访问
 * - storageCapacity 为 0 时 storageRatio = 0（不 NaN）
 * - economyQuery 为 undefined（未核算过）时，三指标字段回退为 0/安全默认值
 */
export interface RoomEconomicProfile {
  /** 房间名。 */
  roomName: string;

  // ── 基础设施状态 ──
  /** RCL 等级。 */
  rcl: number;
  /** 是否有 spawn。 */
  hasSpawn: boolean;
  /** 是否有 storage。 */
  hasStorage: boolean;
  /** 是否有 terminal。 */
  hasTerminal: boolean;

  // ── Economy 三指标（ECONOMY §3，从 EconomyQuery 派生）──
  /** 净流 EMA（能量/tick，可负）。未核算过为 0。 */
  netFlow: number;
  /** 合同储备（storage + terminal + link 水位）。 */
  contractReserve: number;
  /** 风险缓冲（断供耐受 tick 数）。 */
  riskBuffer: number;
  /** 估计收入（产能 × 效率系数，能量/tick）。 */
  estimatedIncome: number;
  /** 效率系数（0..1）。 */
  efficiency: number;
  /** 最近一次核算 drift。 */
  drift: number;
  /** 最近一次核算 tick。 */
  economyTick: number;

  // ── 储备与可用量（ECONOMY §2.1 Storage + Income）──
  /** storage 内能量（无 storage 为 0）。 */
  storageEnergy: number;
  /** storage 总容量（无 storage 为 0）。 */
  storageCapacity: number;
  /** storage 水位比例（0..1，无 storage 为 0）。 */
  storageRatio: number;
  /** 立即可用能量（spawn + extension）。 */
  energyAvailable: number;
  /** spawn + extension 总容量。 */
  energyCapacityAvailable: number;
  /** 是否满仓（storageRatio ≥ storageFullThreshold）。 */
  storageNearFull: boolean;
  /** source 数量。 */
  sourceCount: number;

  // ── 殖民相位（从 RoomMemory.phase 派生）──
  /** 殖民相位。 */
  colonyPhase: ColonyPhase;
  /** 殖民地状态（从 phase 映射 + 威胁叠加）。 */
  colonyState: ColonyState;
  /** 经济压力梯度（0.0–1.0）。 */
  economyPressure: number;
  /** 最近一次房内出现威胁的 tick（无记录为 undefined）。 */
  lastHostileAt: number | undefined;
  /** 本 tick 是否有真实在房威胁。 */
  hasLiveThreat: boolean;
  /** 控制器降级风险标记。 */
  controllerDowngradeRisk: boolean;
  /** 脆弱新房护栏标记。 */
  claimSecure: boolean;

  // ── 派生判定 ──
  /** 经济分类。 */
  economicClass: RoomEconomicClass;
  /**
   * 本土净流是否为正（ECONOMY §1.2 调拨门控前置 + DECISION_AUTHORITY §2 Q1）。
   * 净流 EMA > 0 即视为正（平滑值，非单 tick 脉冲）。
   */
  netFlowPositive: boolean;
  /**
   * 房间经济自给度（0..1）：estimatedIncome > 0 时 = clamp(1 - |netFlow|/estimatedIncome)，
   * 含义：净流接近 0 时自给度高（收支平衡），净流远偏离 0 时自给度低。
   * estimatedIncome = 0 时为 0。
   */
  selfSufficiency: number;
  /**
   * 房间是否处于经济困难态（colonyState 为 bootstrap/recovery/defense）。
   * 困难房应停止被均衡抽离、优先注入（ECONOMY §1.2 异常房例外）。
   */
  isStruggling: boolean;
}

// ─── 输入类型 ───────────────────────────────────────────────

/**
 * RoomMemory 子集 — 只取 room-state + phase 写入的与经济相关的字段。
 * 从 RoomMemory 中结构化提取，避免 Profile 纯函数直接依赖全局 RoomMemory 类型。
 */
export interface RoomEconomicMemory {
  colonyState?: ColonyState;
  economyPressure?: number;
  lastHostileAt?: number;
  controllerDowngradeRisk?: boolean;
  claimSecure?: boolean;
  storageNearFull?: boolean;
  phase?: {
    phase: ColonyPhase;
    reserve: number;
    reserveDelta: number;
    drainScore: number;
    liquidityScore: number;
    harvesterCount: number;
    sourceCount: number;
    rcl: number;
  };
  economy?: {
    t: number;
    nf: number;
    cr: number;
    rb: number;
    dr: number;
    ei: number;
    ef: number;
  };
}

// ─── 纯函数 ─────────────────────────────────────────────────

/**
 * 判定房间经济分类（EMPIRE_SYSTEM_MODEL §1 Room 能力门槛）。
 *
 * 优先级：struggling > candidate > production > core
 * - struggling: colonyState 为 bootstrap/recovery/defense
 * - candidate: RCL < 4 或无 storage
 * - production: RCL 4-5 且有 storage 且 colonyState=normal
 * - core: RCL ≥ 6 且有 storage 且 colonyState=normal
 *
 * 纯函数 — 不触 Game/Memory。
 */
export function classifyRoomEconomic(
  rcl: number,
  hasStorage: boolean,
  colonyState: ColonyState,
): RoomEconomicClass {
  if (
    colonyState === "bootstrap" ||
    colonyState === "recovery" ||
    colonyState === "defense"
  ) {
    return "struggling";
  }
  if (rcl < 4 || !hasStorage) {
    return "candidate";
  }
  if (rcl < 6) {
    return "production";
  }
  return "core";
}

/**
 * 计算经济自给度。
 * 净流接近 0（收支平衡）→ 自给度高；净流偏离 0（入不敷出或大量盈余）→ 自给度低。
 * 纯函数。
 */
export function computeSelfSufficiency(
  netFlow: number,
  estimatedIncome: number,
): number {
  if (estimatedIncome <= 0) return 0;
  const ratio = Math.abs(netFlow) / estimatedIncome;
  return Math.max(0, Math.min(1, 1 - ratio));
}

/**
 * 从 RoomSnapshot + RoomMemory 子集 + EconomyQuery 组装 RoomEconomicProfile。
 *
 * 这是 Room Economic Contract 的核心纯函数：
 * - 不访问 Game/Memory/RawMemory（DEP_GRAPH §3-5 红线）
 * - 三个输入源由调用方（系统侧薄壳）注入
 * - 只读组装，不写任何状态
 *
 * 调用方：empire-economy 系统（A2 后半新增薄壳）或 empire-strategy 扩展。
 * 频率：每 N tick（50–100，与 economy 同频或更低）。
 */
export function buildRoomEconomicProfile(
  snapshot: RoomSnapshot,
  roomMem: RoomEconomicMemory,
  economy: EconomyQueryInput | undefined,
  tick: number,
): RoomEconomicProfile {
  const rcl = snapshot.rcl;
  const hasSpawn = snapshot.spawns.length > 0;
  const hasStorage = snapshot.storage !== undefined;
  const hasTerminal = snapshot.terminal !== undefined;

  // ── Economy 三指标 ──
  const netFlow = economy?.netFlow ?? 0;
  const contractReserve = economy?.contractReserve ?? 0;
  const riskBuffer = economy?.riskBuffer ?? 0;
  const estimatedIncome = economy?.estimatedIncome ?? 0;
  const efficiency = economy?.efficiency ?? 0;
  const drift = economy?.drift ?? 0;
  const economyTick = economy?.tick ?? 0;

  // ── 储备与可用量 ──
  const storageEnergy = snapshot.storage
    ? snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY)
    : 0;
  const storageCapacity = snapshot.storage
    ? snapshot.storage.store.getCapacity(RESOURCE_ENERGY)
    : 0;
  const storageRatio = storageCapacity > 0 ? storageEnergy / storageCapacity : 0;
  const energyAvailable = snapshot.energyAvailable;
  const energyCapacityAvailable = snapshot.energyCapacityAvailable;
  const storageNearFull = roomMem.storageNearFull ?? false;
  const sourceCount = snapshot.sources.length;

  // ── 殖民相位 ──
  const colonyPhase = roomMem.phase?.phase ?? "growth";
  const colonyState = roomMem.colonyState ?? "normal";
  const economyPressure = roomMem.economyPressure ?? 0;
  const lastHostileAt = roomMem.lastHostileAt;
  const hasLiveThreat = (snapshot.threatCreeps?.length ?? 0) > 0;
  const controllerDowngradeRisk = roomMem.controllerDowngradeRisk ?? false;
  const claimSecure = roomMem.claimSecure ?? false;

  // ── 派生判定 ──
  const economicClass = classifyRoomEconomic(rcl, hasStorage, colonyState);
  const netFlowPositive = netFlow > 0;
  const selfSufficiency = computeSelfSufficiency(netFlow, estimatedIncome);
  const isStruggling =
    colonyState === "bootstrap" ||
    colonyState === "recovery" ||
    colonyState === "defense";

  return {
    roomName: snapshot.roomName,
    rcl,
    hasSpawn,
    hasStorage,
    hasTerminal,
    netFlow,
    contractReserve,
    riskBuffer,
    estimatedIncome,
    efficiency,
    drift,
    economyTick,
    storageEnergy,
    storageCapacity,
    storageRatio,
    energyAvailable,
    energyCapacityAvailable,
    storageNearFull,
    sourceCount,
    colonyPhase,
    colonyState,
    economyPressure,
    lastHostileAt,
    hasLiveThreat,
    controllerDowngradeRisk,
    claimSecure,
    economicClass,
    netFlowPositive,
    selfSufficiency,
    isStruggling,
  };
}

/**
 * 判定房间是否具备对外输出能力（ECONOMY §1.2 调拨门控前置）。
 *
 * 前置条件（全部满足）：
 * 1. 非困难态（colonyState=normal）
 * 2. 有 storage
 * 3. 本土净流为正（netFlowPositive）
 * 4. storage 水位 ≥ 最低安全线（storageRatio ≥ 0.3）
 *
 * 纯函数 — 用于 Empire Resource View 的 surplus 检测，不执行调拨。
 */
export function canExportEnergy(profile: RoomEconomicProfile): boolean {
  if (profile.isStruggling) return false;
  if (!profile.hasStorage) return false;
  if (!profile.netFlowPositive) return false;
  if (profile.storageRatio < 0.3) return false;
  return true;
}

/**
 * 判定房间是否需要外部能量援助（ECONOMY §1.2 调拨门控受援侧）。
 *
 * 前置条件（任一满足即视为需要援助）：
 * 1. colonyState 为 recovery/bootstrap（经济困难态）
 * 2. 净流为负 且 riskBuffer < 400（断供耐受 < 400 tick）
 * 3. storageRatio < 0.1 且 estimatedIncome < 5（储备近空 + 产能极低）
 *
 * 纯函数 — 用于 Empire Resource View 的 deficit 检测，不执行调拨。
 */
export function needsEnergyAid(profile: RoomEconomicProfile): boolean {
  if (profile.isStruggling) return true;
  if (!profile.netFlowPositive && profile.riskBuffer < 400) return true;
  if (profile.storageRatio < 0.1 && profile.estimatedIncome < 5) return true;
  return false;
}
