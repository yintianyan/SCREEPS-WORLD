/** Telemetry Collector */

import type { Priority, System, TickContext } from "../kernel/contracts";
import { CONFIG } from "../config";
import { globalCache } from "../kernel/global-cache";
import { systemPhase } from "../kernel/phase";
import {
  readCpuSegment,
  readEconomySegment,
  readEventLogSegment,
  markCpuDirty,
  markEconomyDirty,
  markEventLogDirty,
} from "../kernel/segment-store";
import {
  sampleCpu,
  sampleEconomy,
  type CpuSample,
  type PopulationSnapshot,
} from "../kernel/timeseries";
import { drainEventBuffer, EventKind } from "../kernel/event-log";
import { ringPush, ringToArray } from "../kernel/ring-buffer";
import { getActionCpuSnapshot } from "../kernel/safe-run";

// ─── 系统定义 ───────────────────────────────────────────────

export const telemetryCollectorSystem: System = {
  name: "telemetry-collector",
  priority: 3 as Priority,
  interval: CONFIG.telemetry.cpuSampleInterval,
  // post 阶段：在 runCreeps 之后运行，确保 cpuByHome 等 per-tick 累积数据
  // 已被填充后再采样（main 阶段运行时 cpuByHome 是空 Map，采样无意义）。
  phase: "post",
  run(ctx: TickContext): void {
    // P3 在 recovery 下不运行 — 采集是非关键的。
    if (ctx.budget.tier === "recovery") return;
    // P2-9 修复：conserve 档做轻量 stats 更新（只采样 CPU，跳过事件检测和输出）。
    // 确保前馈预测使用新鲜 stats，避免 conserve→healthy 升级后前馈以旧值误判。
    if (ctx.budget.tier === "conserve") {
      const tick = ctx.tick;
      const tel = globalCache().telemetry;
      if (!tel || tel.tick !== tick) return;
      sampleCpuData(tick, ctx);
      updateStatsSummary(tick);
      return;
    }

    const tick = ctx.tick;
    const tel = globalCache().telemetry;
    if (!tel || tel.tick !== tick) return; // telemetry 未初始化

    // 1. CPU 时序采样（每 interval tick = 每 10 tick）
    sampleCpuData(tick, ctx);

    // K-6 相位适配：本系统被 kernel 错峰到 tick ≡ phase (mod interval)，
    // 内部二级采样门必须用相位相对判定 — 绝对对齐 tick % 50 === 0 与
    // 运行 tick 无交集，经济/人口采样会静默永久失效（tuning 输入断供）。
    const phase = systemPhase("telemetry-collector", CONFIG.telemetry.cpuSampleInterval);

    // 2. 经济时序采样（每 economySampleInterval tick = 每 50 tick）
    if ((tick - phase) % CONFIG.telemetry.economySampleInterval === 0) {
      sampleEconomyData(tick, ctx);
    }

    // 3. 人口普查（每 populationInterval tick = 每 100 tick）
    if ((tick - phase) % CONFIG.telemetry.populationInterval === 0) {
      samplePopulationData(tick);
      // P0-1: Memory 体积监控——与人口普查同频率（每 100 tick），
      // RawMemory.get().length 零 JSON 解析成本（只读字符串长度）[Fact: typings 验证]。
      // 官服上限 2MB（2*1024*1024）；超 1.5MB 告警留 25% 余量。
      sampleMemorySize(tick);
    }

    // 4. 差分事件检测 + 事件缓冲 flush
    detectAndFlushEvents(tick, ctx);

    // 5. 更新 Memory.kernel.stats 摘要
    updateStatsSummary(tick);

    // 6. 输出结构化遥测行供外部采集器（WebSocket console 订阅）接收。
    // 格式：@TELEMETRY {json} — 前缀过滤，不影响游戏控制台可读性。
    emitTelemetryLine(tick, ctx);

    // P2-1: 健康度告警最小版——每 10 tick 检查关键阈值，异常时 console.log 告警。
    // 不向 Memory 写入（告警是瞬时信号，外部采集器按 @ALERT 前缀过滤）。
    checkHealthAlerts(tick, ctx);
  },
};

// ─── CPU 时序采样 ────────────────────────────────────────────

function sampleCpuData(tick: number, ctx: TickContext): void {
  // 显式守卫：不依赖外部调用顺序，Global Reset 后 telemetry 未重建时直接跳过。
  const tel = globalCache().telemetry;
  if (!tel || tel.tick !== tick) return;
  const sample = sampleCpu(tick, ctx.budget, tel);

  const seg = readCpuSegment();
  ringPush(seg.cpu, sample);
  markCpuDirty();
}

// ─── 经济时序采样 ────────────────────────────────────────────

function sampleEconomyData(tick: number, ctx: TickContext): void {
  const seg = readEconomySegment();

  for (const snapshot of ctx.snapshots()) {
    const roomMem = Memory.rooms[snapshot.roomName];
    if (!roomMem?.phase) continue;

    const storageEnergy = snapshot.storage
      ? snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY)
      : 0;

    // P0-2: 采集 container 级别能量流数据，用于诊断物流瓶颈。
    // containerEnergy：所有 container 能量总和（物流缓冲健康度）；
    // controllerContainerEnergy：controller 旁 container 能量（站桩升级供能链健康度）。
    let containerEnergy = 0;
    for (const c of snapshot.containers) {
      containerEnergy += c.store.getUsedCapacity(RESOURCE_ENERGY);
    }
    const controllerContainerEnergy = snapshot.controllerContainer
      ? snapshot.controllerContainer.store.getUsedCapacity(RESOURCE_ENERGY)
      : 0;

    const sample = sampleEconomy(
      tick,
      snapshot.roomName,
      roomMem.phase,
      roomMem.economyPressure ?? 0,
      {
        energyAvailable: snapshot.energyAvailable,
        energyCapacityAvailable: snapshot.energyCapacityAvailable,
        storageEnergy,
        containerEnergy,
        controllerContainerEnergy,
      },
    );
    ringPush(seg.economy, sample);
  }
  markEconomyDirty();
}

// ─── 人口普查 ───────────────────────────────────────────────

function samplePopulationData(tick: number): void {
  const counts: Record<string, number> = {};
  const ttls: Record<string, number[]> = {};
  const modeCounts = { acquire: 0, work: 0, idle: 0, flee: 0 };

  for (const creep of Object.values(Game.creeps)) {
    const role = creep.memory.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
    const ttl = creep.ticksToLive ?? 1500;
    if (!ttls[role]) ttls[role] = [];
    ttls[role].push(ttl);
    // mode 分布采集
    const mode = creep.memory.mode ?? "idle";
    if (mode in modeCounts) modeCounts[mode as keyof typeof modeCounts]++;
  }

  // 孵化状态
  let sq = 0;
  let p0 = 0;
  for (const roomMem of Object.values(Memory.rooms)) {
    if (roomMem?.spawnQueue) {
      sq += roomMem.spawnQueue.length;
      p0 += roomMem.spawnQueue.filter(r => r.priority === 0).length;
    }
  }

  let sp = 0;
  for (const spawn of Object.values(Game.spawns)) {
    if (spawn.spawning) sp++;
  }

  const avg = (role: string): number => {
    const arr = ttls[role];
    if (!arr || arr.length === 0) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  };

  const snapshot: PopulationSnapshot = {
    t: tick,
    hv: counts["harvester"] ?? 0,
    ha: counts["hauler"] ?? 0,
    up: counts["upgrader"] ?? 0,
    bd: counts["builder"] ?? 0,
    wk: counts["worker"] ?? 0,
    hvTtl: avg("harvester"),
    haTtl: avg("hauler"),
    upTtl: avg("upgrader"),
    bdTtl: avg("builder"),
    sq,
    sp,
    p0,
    ma: modeCounts.acquire,
    mw: modeCounts.work,
    mi: modeCounts.idle,
    mf: modeCounts.flee,
  };

  const seg = readCpuSegment();
  seg.population = snapshot;
  markCpuDirty();
}

// ─── Memory 体积监控（P0-1）────────────────────────────

/** Memory 体积告警阈值（字符数）。官服 RawMemory.set 上限 2*1024*1024 [Fact: typings]。
 * 1.5MB 留 25% 余量——超此值 console.log 告警，玩家可介入清理。 */
const MEMORY_SIZE_ALERT = 1_500_000;

/** 采样 Memory 原始字符串体积并告警。RawMemory.get() 返回 Memory 的 JSON 字符串
 * [Fact: typings get(): string]，.length 是零成本属性读取（不解析 JSON）。
 * 写入 stats.memorySize 供 @TELEMETRY 外部采集器追踪体积趋势。 */
function sampleMemorySize(tick: number): void {
  // safeRun 包裹：私服或测试环境可能无 RawMemory.get（typings 不保证所有环境）。
  try {
    const size = RawMemory.get().length;
    if (!Memory.kernel) Memory.kernel = {};
    if (!Memory.kernel.stats) {
      Memory.kernel.stats = {
        lastSample: 0,
        cpuAvg10: 0,
        cpuMax10: 0,
        bucketMin10: 0,
        crisisCount: 0,
        tierTransitions: 0,
        errorHotspot: "",
        skipHotspot: "",
      };
    }
    Memory.kernel.stats.memorySize = size;
    if (size > MEMORY_SIZE_ALERT) {
      console.log(
        `[${tick}] WARNING: Memory size ${size} bytes (${(size / 1024 / 1024).toFixed(2)}MB) ` +
        `approaching 2MB limit — consider pruning Memory.rooms / remoteOps`,
      );
    }
  } catch {
    // RawMemory 不可用（测试环境）——静默跳过。
  }
}

// ─── 差分事件检测 + 事件 flush ───────────────────────────────

/**
 * 对比 Memory 前后状态，检测关键转换并记录为事件；同时把 per-tick eventBuffer
 * 的显式事件 flush 到 segment 2。差分检测不修改现有系统 — 纯观察者，每次运行
 * 读取当前 Memory 状态与上次记录的「前值」对比。
 */
function detectAndFlushEvents(tick: number, ctx: TickContext): void {
  const g = globalCache() as any;
  if (!g.__telemetryPrevState) g.__telemetryPrevState = {};

  const prev = g.__telemetryPrevState as {
    tier?: string;
    rooms?: Record<string, {
      phase?: string;
      colonyState?: string;
      rcl?: number;
      hadThreats?: boolean;
      downgradeRisk?: boolean;
      structures?: { sp: number; tw: number; ct: number; st: number };
    }>;
  };

  // 1. Tier 转换检测
  const currentTier = ctx.budget.tier;
  if (prev.tier !== undefined && prev.tier !== currentTier) {
    const prevRank = tierRank(prev.tier);
    const currRank = tierRank(currentTier);
    if (currRank > prevRank) {
      drainEventBuffer(); // 先 flush 显式事件
      pushEventDirect(EventKind.TierDowngrade, "", [prevRank, currRank]);
    } else {
      drainEventBuffer();
      pushEventDirect(EventKind.TierUpgrade, "", [prevRank, currRank]);
    }
  }
  prev.tier = currentTier;

  // 2. 房间级差分检测
  if (!prev.rooms) prev.rooms = {};

  for (const snapshot of ctx.snapshots()) {
    const roomName = snapshot.roomName;
    const roomMem = Memory.rooms[roomName];
    if (!roomMem) continue;

    const prevRoom = prev.rooms[roomName] ?? {};
    if (!prev.rooms[roomName]) prev.rooms[roomName] = {};

    // Phase 转换
    const currentPhase = roomMem.phase?.phase;
    if (
      prevRoom.phase !== undefined &&
      currentPhase !== undefined &&
      prevRoom.phase !== currentPhase
    ) {
      pushEventDirect(
        EventKind.PhaseTransition,
        roomName,
        [phaseRank(prevRoom.phase), phaseRank(currentPhase)],
      );
      // 进入 crisis 计数
      if (currentPhase === "crisis") {
        incrementCrisisCount();
      }
    }
    prev.rooms[roomName].phase = currentPhase;

    // ColonyState 转换
    const currentColony = roomMem.colonyState;
    if (
      prevRoom.colonyState !== undefined &&
      currentColony !== undefined &&
      prevRoom.colonyState !== currentColony
    ) {
      pushEventDirect(
        EventKind.ColonyStateChange,
        roomName,
        [colonyStateRank(prevRoom.colonyState), colonyStateRank(currentColony)],
      );
    }
    prev.rooms[roomName].colonyState = currentColony;

    // RCL 变化
    const currentRcl = snapshot.rcl;
    if (
      prevRoom.rcl !== undefined &&
      prevRoom.rcl !== currentRcl &&
      currentRcl > prevRoom.rcl
    ) {
      pushEventDirect(
        EventKind.ControllerLevelUp,
        roomName,
        [prevRoom.rcl, currentRcl],
      );
    }
    prev.rooms[roomName].rcl = currentRcl;

    // 敌人入侵/清除
    const hasThreats = snapshot.threatCreeps.length > 0;
    if (prevRoom.hadThreats !== undefined) {
      if (hasThreats && !prevRoom.hadThreats) {
        // 战斗黑匣子（M9）：入侵事件附带敌方编队构成（数量/治疗/远程/近战
        // 部件合计），供事后复盘敌方火力与杀伤链。
        let heals = 0, ranged = 0, melee = 0;
        for (const h of snapshot.threatCreeps as Creep[]) {
          for (const p of h.body) {
            if (p.type === HEAL) heals++;
            else if (p.type === RANGED_ATTACK) ranged++;
            else if (p.type === ATTACK) melee++;
          }
        }
        pushEventDirect(EventKind.EnemyInvasion, roomName, [
          snapshot.threatCreeps.length, heals, ranged, melee,
        ]);
      } else if (!hasThreats && prevRoom.hadThreats) {
        pushEventDirect(EventKind.EnemyCleared, roomName, []);
      }
    }
    prev.rooms[roomName].hadThreats = hasThreats;

    // Controller 降级风险
    const downgradeRisk = roomMem.controllerDowngradeRisk === true;
    if (downgradeRisk && !prevRoom.downgradeRisk) {
      const ctrl = snapshot.controller;
      const ticks = ctrl?.ticksToDowngrade ?? 0;
      pushEventDirect(EventKind.ControllerDowngradeRisk, roomName, [ticks]);
    }
    prev.rooms[roomName].downgradeRisk = downgradeRisk;

    // 关键结构被毁检测 — spawn/tower/container/storage 数量减少时记录事件。
    // structureTypeCode: 0=spawn, 1=tower, 2=container, 3=storage
    const currStructures = {
      sp: snapshot.spawns.length,
      tw: snapshot.towers.length,
      ct: snapshot.containers.length,
      st: snapshot.storage ? 1 : 0,
    };
    if (prevRoom.structures) {
      if (currStructures.sp < prevRoom.structures.sp) {
        pushEventDirect(EventKind.StructureDestroyed, roomName, [0, prevRoom.structures.sp, currStructures.sp]);
      }
      if (currStructures.tw < prevRoom.structures.tw) {
        pushEventDirect(EventKind.StructureDestroyed, roomName, [1, prevRoom.structures.tw, currStructures.tw]);
      }
      if (currStructures.ct < prevRoom.structures.ct) {
        pushEventDirect(EventKind.StructureDestroyed, roomName, [2, prevRoom.structures.ct, currStructures.ct]);
      }
      if (currStructures.st < prevRoom.structures.st) {
        pushEventDirect(EventKind.StructureDestroyed, roomName, [3, prevRoom.structures.st, currStructures.st]);
      }
    }
    prev.rooms[roomName].structures = currStructures;
  }

  // 3. Flush per-tick 事件缓冲区中的显式事件
  const explicitEvents = drainEventBuffer();
  if (explicitEvents.length > 0) {
    const seg = readEventLogSegment();
    for (const evt of explicitEvents) {
      ringPush(seg.events, evt);
    }
    markEventLogDirty();
  }
}

/** 直接推入事件到 segment（绕过 heap buffer，用于差分检测）。 */
function pushEventDirect(kind: EventKind, roomName: string, data: number[]): void {
  const seg = readEventLogSegment();
  ringPush(seg.events, {
    t: Game.time,
    k: kind,
    r: roomName,
    d: data,
  });
  markEventLogDirty();
}

// ─── Memory.kernel.stats 摘要 ────────────────────────────────

function updateStatsSummary(tick: number): void {
  if (!Memory.kernel) Memory.kernel = {};
  if (!Memory.kernel.stats) {
    Memory.kernel.stats = {
      lastSample: 0,
      cpuAvg10: 0,
      cpuMax10: 0,
      bucketMin10: 0,
      crisisCount: 0,
      tierTransitions: 0,
      errorHotspot: "",
      skipHotspot: "",
    };
  }

  const stats = Memory.kernel.stats!;
  const seg = readCpuSegment();
  const cpuSamples = ringToArray(seg.cpu);

  // 取最近 10 个采样点
  const recent = cpuSamples.slice(-10);
  if (recent.length > 0) {
    let sum = 0;
    let max = 0;
    let bucketMin = Infinity;
    for (const s of recent) {
      sum += s.cpu;
      if (s.cpu > max) max = s.cpu;
      if (s.bk < bucketMin) bucketMin = s.bk;
    }
    stats.cpuAvg10 = Math.round((sum / recent.length) * 10) / 10;
    stats.cpuMax10 = Math.round(max * 10) / 10;
    stats.bucketMin10 = bucketMin === Infinity ? 0 : bucketMin;
  }

  stats.lastSample = tick;

  // Per-room CPU 记账：从 globalCache.cpuByHome 采样写入 Memory。
  // 供 empire-strategy / capacity 评估每房真实 CPU 成本。
  const byHome = globalCache().cpuByHome;
  if (byHome && byHome.size > 0) {
    const record: Record<string, number> = {};
    for (const [room, cpu] of byHome) {
      record[room] = Math.round(cpu * 1000) / 1000;
    }
    stats.cpuByHome = record;
  }

  // 最频繁的 skip 原因
  if (Memory.kernel.skipReasons) {
    let maxSkip = 0;
    let hotspot = "";
    for (const [reason, count] of Object.entries(Memory.kernel.skipReasons)) {
      if (count > maxSkip) {
        maxSkip = count;
        hotspot = reason;
      }
    }
    stats.skipHotspot = hotspot;
  }

  // 最频繁的错误 label（从 globalCache 读取，per-tick 限频日志的计数）
  const g = globalCache();
  if (g.errorCounts && g.errorCounts.size > 0) {
    let maxErr = 0;
    let hotspot = "";
    for (const [label, count] of g.errorCounts) {
      if (count > maxErr) {
        maxErr = count;
        hotspot = label;
      }
    }
    stats.errorHotspot = hotspot;
  } else if ((g.telemetry?.errors ?? 0) === 0) {
    // 审计修复：boot 后零错误时回写空串 —— 旧实现保留上一 boot 的陈旧
    // hotspot，误导线上诊断（本次事故实证：terminal-manager 陈旧值残留）。
    // 本 tick 仍有错误但 counts 为空的理论态不清理（粘滞语义，测试契约）。
    stats.errorHotspot = "";
  }
}

// ─── 结构化 console 输出（外部采集通道）──────────────────────

/**
 * 输出一行 @TELEMETRY 前缀的 JSON，供外部 WebSocket console 订阅器接收
 * （外部采集脚本按前缀过滤写入 telemetry.jsonl；同现于游戏控制台但不干扰阅读）。
 * CPU 开销：单次 console.log 约 0.02-0.05 CPU [Experience]；每 10 tick 评估一次，
 * 仅命中信号门禁的 tick 实际输出（摘要指标随信号行附带）。
 */
function emitTelemetryLine(tick: number, ctx: TickContext): void {
  // 显式守卫：不依赖外部调用顺序，Global Reset 后 telemetry 未重建时直接跳过。
  const tel = globalCache().telemetry;
  if (!tel || tel.tick !== tick) return;
  const stats = Memory.kernel?.stats;

  // 仅在有值得关注的信号时输出，避免健康 tick 刷屏：
  // CPU > softLimit*0.7、有错误、有 skip 任一满足才输出。
  // 修复：曾含 "|| stats != null" —— stats 首次采样后恒存在，条件恒真击穿门禁，
  // 健康 tick 全量灌入 @TELEMETRY，外部采集通道信噪比归零（告警语义失效）。
  const cpu = Game.cpu.getUsed();
  const hasSignal = cpu > ctx.budget.softLimit * 0.7
    || tel.errors > 0
    || tel.skipped > 0;

  if (!hasSignal) return;

  const payload = {
    t: tick,
    cpu: Math.round(cpu * 10) / 10,
    bk: Game.cpu.bucket ?? 0,
    tier: ctx.budget.tier,
    sk: tel.skipped,
    er: tel.errors,
    // 摘要指标（如果已更新）
    avg: stats?.cpuAvg10 ?? 0,
    max: stats?.cpuMax10 ?? 0,
    bkm: stats?.bucketMin10 ?? 0,
    crisis: stats?.crisisCount ?? 0,
    errHot: stats?.errorHotspot ?? "",
    skipHot: stats?.skipHotspot ?? "",
    mem: stats?.memorySize ?? 0,
  };

  // actionProfiling 开启时附挂 top 3 action 热点（按 totalCpu 降序）。
  // 格式："actionKey=totalCpu|count|maxCpu"，逗号分隔。
  // 外部采集脚本可解析此字段定位 CPU 热点 action。
  if (CONFIG.debug.actionProfiling) {
    const actionData = getActionCpuSnapshot();
    if (actionData && actionData.size > 0) {
      const topActions = [...actionData.entries()]
        .sort((a, b) => b[1].totalCpu - a[1].totalCpu)
        .slice(0, 3);
      (payload as Record<string, unknown>).act = topActions.map(([key, e]) =>
        `${key}=${e.totalCpu.toFixed(2)}|${e.count}|${e.maxCpu.toFixed(2)}`,
      ).join(",");
    }
  }

  console.log(`@TELEMETRY ${JSON.stringify(payload)}`);
}

// ─── 健康度告警（P2-1）──────────────────────────────────────

/** 健康度告警限频间隔（tick）——同类型告警至少间隔此 tick 数，防刷屏。 */
const ALERT_THROTTLE = 100;

/** 告警类型与上次告警 tick 的全局缓存（reset 后重建，非持久化）。 */
function alertState(): Record<string, number> {
  const g = globalCache() as Record<string, unknown>;
  if (!g.__alertThrottle) g.__alertThrottle = {} as Record<string, number>;
  return g.__alertThrottle as Record<string, number>;
}

/** 检查关键健康度阈值并告警。每 10 tick 调用一次（与 telemetry 采样同步）。
 * 告警格式：@ALERT {type}:{message} — 外部采集器按前缀过滤。
 * 告警不写 Memory（瞬时信号，限频防刷屏）。 */
function checkHealthAlerts(tick: number, ctx: TickContext): void {
  const stats = Memory.kernel?.stats;
  const tel = globalCache().telemetry;
  if (!tel || tel.tick !== tick) return;

  const throttle = alertState();

  /** 限频后输出告警。 */
  function alert(type: string, msg: string): void {
    const last = throttle[type] ?? 0;
    if (tick - last < ALERT_THROTTLE) return;
    throttle[type] = tick;
    console.log(`@ALERT ${type}:${msg}`);
  }

  // 1. CPU 持续高位告警
  if (stats && stats.cpuAvg10 >= ctx.budget.softLimit * 0.9) {
    alert("cpu-high",
      `cpuAvg10=${stats.cpuAvg10} >= softLimit*0.9=${(ctx.budget.softLimit * 0.9).toFixed(1)}` +
      ` (tier=${ctx.budget.tier}, max10=${stats.cpuMax10})`,
    );
  }

  // 2. bucket 危急告警
  if (stats && stats.bucketMin10 < 2000) {
    alert("bucket-critical",
      `bucketMin10=${stats.bucketMin10} < 2000 (recovery threshold=1000)`,
    );
  }

  // 3. 错误频发告警
  if (tel.errors > 0 && stats?.errorHotspot) {
    alert("error-hotspot",
      `errors this cycle=${tel.errors}, hotspot=${stats.errorHotspot}`,
    );
  }

  // 4. skip 频发告警
  if (tel.skipped > 5 && stats?.skipHotspot) {
    alert("skip-hotspot",
      `skipped this cycle=${tel.skipped}, hotspot=${stats.skipHotspot}`,
    );
  }

  // 5. Memory 体积告警（与 P0-1 联动，但这里是周期性检查而非仅采样时）
  if (stats?.memorySize !== undefined && stats.memorySize > 1_500_000) {
    alert("memory-size",
      `memorySize=${stats.memorySize} (${(stats.memorySize / 1024 / 1024).toFixed(2)}MB) > 1.5MB`,
    );
  }
}

// ─── 辅助函数 ───────────────────────────────────────────────

function tierRank(tier: string): number {
  return tier === "healthy" ? 0
    : tier === "guarded" ? 1
    : tier === "conserve" ? 2
    : 3;
}

function phaseRank(phase: string): number {
  return phase === "bootstrap" ? 0
    : phase === "growth" ? 1
    : phase === "crisis" ? 2
    : phase === "recovery" ? 3
    : 4; // steady
}

function colonyStateRank(state: string): number {
  return state === "bootstrap" ? 0
    : state === "recovery" ? 1
    : state === "normal" ? 2
    : 3; // defense
}

function incrementCrisisCount(): void {
  if (!Memory.kernel) Memory.kernel = {};
  if (!Memory.kernel.stats) {
    Memory.kernel.stats = {
      lastSample: 0,
      cpuAvg10: 0,
      cpuMax10: 0,
      bucketMin10: 0,
      crisisCount: 0,
      tierTransitions: 0,
      errorHotspot: "",
      skipHotspot: "",
    };
  }
  Memory.kernel.stats.crisisCount++;
}
