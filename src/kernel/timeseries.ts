/**
 * Time Series — CPU 和经济指标的时序数据采集。
 *
 * 设计意图：将 per-tick 遥测数据从 heap（单 tick 生命周期）提升为
 * 持久化的时间序列（存入 RawMemory segment），供事后趋势分析。
 *
 * 数据流：
 *   per-tick heap telemetry → 采样（每 N tick）→ ring buffer → segment flush
 *
 * 采样频率策略：
 *   - CPU 时序：每 10 tick 采样一次（500 条 = 5000 tick 窗口）
 *   - 经济时序：每 50 tick 采样一次（300 条 = 15000 tick 窗口）
 *   - 人口普查：每 100 tick 采样一次（仅保留最新快照）
 *
 * 成本：采样 ~0 CPU（浅拷贝几个数字），flush ~0.1 CPU（JSON.stringify）。
 * 受 P3 budget 门禁：conserve/recovery tier 下跳过采集。
 */

import type { RingBuffer } from "./ring-buffer";
import type { Budget } from "./contracts";

// ─── CPU 时序采样点 ──────────────────────────────────────────

/**
 * 单个 CPU 采样点。
 * 紧凑 key 名以最小化 segment 序列化体积。
 */
export interface CpuSample {
  /** 采样 tick (Game.time)。 */
  t: number;
  /** 总 CPU (Game.cpu.getUsed())。 */
  cpu: number;
  /** Bucket 水位 (Game.cpu.bucket)。 */
  bk: number;
  /** CPU 档位 (0=healthy 1=guarded 2=conserve 3=recovery)。 */
  ti: number;
  /** 软上限。 */
  sl: number;
  /** 硬上限。 */
  hl: number;
  /** 本 tick skip 计数。 */
  sk: number;
  /** 本 tick error 计数。 */
  er: number;
  /** Top-1 系统名。 */
  s1: string;
  /** Top-1 系统 CPU。 */
  v1: number;
  /** Top-2 系统名。 */
  s2: string;
  /** Top-2 系统 CPU。 */
  v2: number;
  /** Top-3 系统名。 */
  s3: string;
  /** Top-3 系统 CPU。 */
  v3: number;
  /** Top-1 role 名（creep 执行 CPU — 点亮"系统之外"的最大 CPU 去向）。 */
  r1?: string;
  /** Top-1 role CPU。 */
  rv1?: number;
  /** Top-2 role 名。 */
  r2?: string;
  /** Top-2 role CPU。 */
  rv2?: number;
  /** Top-3 role 名。 */
  r3?: string;
  /** Top-3 role CPU。 */
  rv3?: number;
}

// ─── 经济时序采样点 ──────────────────────────────────────────

/**
 * 单个经济采样点（每房一条）。
 */
export interface EconomySample {
  /** 采样 tick。 */
  t: number;
  /** 房间名。 */
  r: string;
  /** 总储备 (reserve = energyAvailable + containers + storage + creepEnergy)。 */
  rs: number;
  /** 储备变化率 (reserveDelta)。 */
  d: number;
  /** 赤字分数 (drainScore 0-100)。 */
  ds: number;
  /** 经济压力 (economyPressure × 100，0-100 整数)。 */
  p: number;
  /** 可用能量 (energyAvailable)。 */
  ea: number;
  /** 能量容量 (energyCapacityAvailable)。 */
  ec: number;
  /** Storage 能量 (0 if none)。 */
  se: number;
  /** Harvester 数量。 */
  hc: number;
  /** Source 数量。 */
  sc: number;
  /** 殖民相位 (0=bootstrap 1=growth 2=crisis 3=recovery 4=steady)。 */
  ph: number;
  /** Container 总能量（所有 container 的 energy 之和）。*/
  cte?: number;
  /** Controller container 能量（站桩升级供能链健康度）。*/
  cce?: number;
}

// ─── 人口普查快照 ────────────────────────────────────────────

/**
 * 人口普查快照（全局，仅保留最新一份）。
 */
export interface PopulationSnapshot {
  /** 采样 tick。 */
  t: number;
  // 各角色存活数量
  hv: number; // harvester
  ha: number; // hauler
  up: number; // upgrader
  bd: number; // builder
  wk: number; // worker
  // 各角色平均 ticksToLive
  hvTtl: number;
  haTtl: number;
  upTtl: number;
  bdTtl: number;
  // 孵化状态
  sq: number; // spawnQueue 总长度
  sp: number; // spawning 数量
  p0: number; // P0 请求数量
  // mode 分布（全局 creep 状态概览）
  ma: number; // acquire（采集中）
  mw: number; // work（工作中）
  mi: number; // idle（待命）
  mf: number; // flee（逃跑中）
}

// ─── Segment 1 数据结构（CPU + 人口）──────────────────────────

/** Segment 1 的顶层结构：CPU 时序 + 人口普查。 */
export interface CpuSegmentData {
  /** CPU 时序环形缓冲（全局，每 10 tick 一条）。 */
  cpu: RingBuffer<CpuSample>;
  /** 最新人口普查快照（仅保留最后一份）。 */
  population?: PopulationSnapshot;
}

// ─── Segment 3 数据结构（经济）──────────────────────────────

/** Segment 3 的顶层结构：经济时序环形缓冲。 */
export interface EconomySegmentData {
  /** 经济时序环形缓冲（按房间混合，每 50 tick 一条）。 */
  economy: RingBuffer<EconomySample>;
}

// ─── 兼容类型（迁移用）──────────────────────────────────────

/** 旧 Segment 1 的合并结构 — 仅用于迁移检测。 */
export interface LegacyTimeseriesData {
  cpu: RingBuffer<CpuSample>;
  economy: RingBuffer<EconomySample>;
  population?: PopulationSnapshot;
}

// ─── 采样逻辑（纯函数，便于测试）──────────────────────────────

/** 从 per-tick 遥测数据构建一个 CPU 采样点。 */
export function sampleCpu(
  tick: number,
  budget: Budget,
  telemetry: {
    systemCpu: Record<string, number>;
    roleCpu: Record<string, number>;
    skipped: number;
    errors: number;
  },
): CpuSample {
  const cpu = Game.cpu.getUsed();
  const bucket = Game.cpu.bucket ?? 0;
  const tierRank = budget.tier === "healthy" ? 0
    : budget.tier === "guarded" ? 1
    : budget.tier === "conserve" ? 2
    : 3;

  // Top-3 系统按 CPU 降序
  const sys = Object.entries(telemetry.systemCpu)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Top-3 role 按 CPU 降序（creep 执行 CPU — 点亮"系统之外"的大头）。
  const roles = Object.entries(telemetry.roleCpu)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return {
    t: tick,
    cpu: Math.round(cpu * 10) / 10,
    bk: bucket,
    ti: tierRank,
    sl: Math.round(budget.softLimit * 10) / 10,
    hl: Math.round(budget.hardLimit * 10) / 10,
    sk: telemetry.skipped,
    er: telemetry.errors,
    s1: sys[0]?.[0] ?? "",
    v1: sys[0]?.[1] ? Math.round(sys[0][1] * 10) / 10 : 0,
    s2: sys[1]?.[0] ?? "",
    v2: sys[1]?.[1] ? Math.round(sys[1][1] * 10) / 10 : 0,
    s3: sys[2]?.[0] ?? "",
    v3: sys[2]?.[1] ? Math.round(sys[2][1] * 10) / 10 : 0,
    r1: roles[0]?.[0] ?? "",
    rv1: roles[0]?.[1] ? Math.round(roles[0][1] * 10) / 10 : 0,
    r2: roles[1]?.[0] ?? "",
    rv2: roles[1]?.[1] ? Math.round(roles[1][1] * 10) / 10 : 0,
    r3: roles[2]?.[0] ?? "",
    rv3: roles[2]?.[1] ? Math.round(roles[2][1] * 10) / 10 : 0,
  };
}

/** 从 RoomMemory.phase 构建一个经济采样点。 */
export function sampleEconomy(
  tick: number,
  roomName: string,
  phase: {
    phase: string;
    reserve: number;
    reserveDelta: number;
    drainScore: number;
    harvesterCount: number;
    sourceCount: number;
    rcl: number;
  },
  economyPressure: number,
  snapshot: {
    energyAvailable: number;
    energyCapacityAvailable: number;
    storageEnergy: number;
    containerEnergy?: number;
    controllerContainerEnergy?: number;
  },
): EconomySample {
  const phaseRank = phase.phase === "bootstrap" ? 0
    : phase.phase === "growth" ? 1
    : phase.phase === "crisis" ? 2
    : phase.phase === "recovery" ? 3
    : 4; // steady

  return {
    t: tick,
    r: roomName,
    rs: phase.reserve,
    d: phase.reserveDelta,
    ds: phase.drainScore,
    p: Math.round(economyPressure * 100),
    ea: snapshot.energyAvailable,
    ec: snapshot.energyCapacityAvailable,
    se: snapshot.storageEnergy,
    hc: phase.harvesterCount,
    sc: phase.sourceCount,
    ph: phaseRank,
    cte: snapshot.containerEnergy,
    cce: snapshot.controllerContainerEnergy,
  };
}
