/**
 * Empire Strategy — P1 系统，帝国姿态/议程/容量的唯一裁决者与发布者（Strategy 层）：
 * State（room-state 写入的 colonyState/economyPressure/lastHostileAt）
 *   → posture（domain/strategy/posture 纯函数）→ Memory.kernel.strategy
 *   → agenda（domain/strategy/agenda 纯函数）→ Memory.kernel.agenda
 *   → capacity（domain/strategy/capacity 纯函数）→ Memory.kernel.capacity
 * 执行系统只消费指令（expansion-manager / remote-mining-manager / 未来进攻系统）。
 * 铁律：执行系统不得自行裁决「是否该扩张/开战」；局部安全门禁只能收紧不得放宽。
 * 姿态回答「处于什么状态」，议程回答「主动在做什么」，容量回答「养得起多大规模」。
 * 切换均记录事件（AgendaChange / AgendaOutcome），容量分档变更打日志。
 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import {
  evaluateEmpirePosture,
  DEFAULT_POSTURE_OPTIONS,
  type RoomStrategyInput,
} from "../domain/strategy/posture";
import { evaluateAgenda } from "../domain/strategy/agenda";
import { evaluateCapacity } from "../domain/strategy/capacity";
import { evaluateEnvironment } from "../domain/strategy/environment";
import { CONFIG } from "../config";
import { EventKind, recordEvent } from "../kernel/event-log";

/** AgendaChange 事件的 initiative 编码（与 event-log 注释对齐）。 */
const AGENDA_CODES: Record<string, number> = {
  recovery: 0,
  "defense-readiness": 1,
  "rcl-push": 2,
  develop: 3,
};

export const empireStrategySystem: System = {
  name: "empire-strategy",
  priority: 1 as Priority,
  interval: 1,
  run(ctx: TickContext): void {
    // 采集各房战略输入（room-state P0 已在本 tick 更新过这些字段）。
    const rooms: RoomStrategyInput[] = [];
    // R7a：controller 进度合计（AgendaOutcome 归因 rcl-push 窗口的升级速率）。
    let totalProgress = 0;
    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;
      totalProgress += snapshot.controller?.progress ?? 0;
      rooms.push({
        colonyState: roomMem.colonyState ?? "normal",
        economyPressure: roomMem.economyPressure ?? 0,
        lastHostileAt: roomMem.lastHostileAt,
        // 零滞回「此刻有敌」：snapshot.threatCreeps 已是剔除盟友的真实威胁列表。
        // 透传给姿态层，使新远矿/扩张冻结跟随真实在房威胁而非过期记忆（恐吓税修复）。
        hasLiveThreat: (snapshot.threatCreeps?.length ?? 0) > 0,
        rcl: snapshot.rcl,
        storageEnergy: snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
      });
    }

    if (!Memory.kernel) Memory.kernel = {};
    const prev = Memory.kernel.strategy;

    const result = evaluateEmpirePosture(
      {
        tick: ctx.tick,
        rooms,
        gclLevel: Game.gcl?.level ?? 1,
        bucket: Game.cpu.bucket ?? 10000,
        prev: prev ? { posture: prev.posture, since: prev.since } : undefined,
        // R4：war 可持续性计数跨 tick 回传（pressure 滞回输入）。
        warPressureTicks: prev?.warPressureTicks,
        // P2-2：per-room CPU 记账 → 扩张 ROI 门禁。从 stats.cpuByHome 汇总
        // 各房归属 CPU 总量，与有效 CPU limit 对比。CPU 余量不足时拒绝扩张。
        totalCreepCpu: sumCpuByHome(),
        effectiveCpuLimit: Math.min(
          Game.cpu.limit ?? 20,
          Game.cpu.tickLimit ?? 20,
        ),
      },
      // 姿态参数全部经 CONFIG 可调（修复原先写死 DEFAULT_POSTURE_OPTIONS 的隐藏 bug）。
      { ...DEFAULT_POSTURE_OPTIONS, ...CONFIG.posture },
    );

    // 姿态变更时打日志 — 战略转向是帝国级事件，必须可观测。
    if (prev?.posture !== result.posture) {
      console.log(
        `[${ctx.tick}] strategy: posture ${prev?.posture ?? "(none)"} → ${result.posture}` +
        ` (rooms=${rooms.length}, gcl=${Game.gcl?.level ?? 1}, bucket=${Game.cpu.bucket ?? "?"})`,
      );
    }

    Memory.kernel.strategy = {
      posture: result.posture,
      since: result.since,
      expansionAllowed: result.expansionAllowed,
      newRemoteOpsAllowed: result.newRemoteOpsAllowed,
      warPressureTicks: result.warPressureTicks,
    };

    // ── R6a：帝国议程 — 姿态回答状态，议程回答主动目标 ──
    const prevAgenda = Memory.kernel.agenda;
    const agenda = evaluateAgenda(
      {
        tick: ctx.tick,
        rooms,
        prev: prevAgenda,
      },
      {
        threatWindow: CONFIG.agenda.threatWindow,
        rclPushStorage: CONFIG.agenda.rclPushStorage,
        rclPushMaxPressure: CONFIG.agenda.rclPushMaxPressure,
        minDwell: CONFIG.agenda.minDwell,
      },
    );

    let progressBase = prevAgenda?.progressBase;
    if (prevAgenda?.initiative !== agenda.initiative) {
      // R7a：退出 rcl-push 时归因窗口收益（controller 进度增量 → 升级速率证据）。
      if (prevAgenda?.initiative === "rcl-push" && progressBase !== undefined) {
        const gained = Math.max(0, totalProgress - progressBase);
        const duration = ctx.tick - (prevAgenda.since ?? ctx.tick);
        recordEvent(EventKind.AgendaOutcome, "", [AGENDA_CODES["rcl-push"]!, gained, duration]);
      }
      console.log(
        `[${ctx.tick}] agenda: ${prevAgenda?.initiative ?? "(none)"} → ${agenda.initiative}`,
      );
      recordEvent(EventKind.AgendaChange, "", [AGENDA_CODES[agenda.initiative] ?? 3]);
      progressBase = agenda.initiative === "rcl-push" ? totalProgress : undefined;
    }
    Memory.kernel.agenda = {
      initiative: agenda.initiative,
      since: agenda.since,
      progressBase,
    };

    // ── R7a：算力容量 — 规模规划的前馈层（「养得起多大规模」）──
    const capacity = evaluateCapacity(
      {
        cpuLimit: Game.cpu.limit,
        tickLimit: Game.cpu.tickLimit,
        bucket: Game.cpu.bucket ?? 10000,
        cpuAvg10: Memory.kernel.stats?.cpuAvg10 ?? 0,
        cpuMax10: Memory.kernel.stats?.cpuMax10 ?? 0,
      },
      Memory.kernel.capacity,
      ctx.tick,
      {
        abundantRatio: CONFIG.capacity.abundantRatio,
        tightRatio: CONFIG.capacity.tightRatio,
        constrainedRatio: CONFIG.capacity.constrainedRatio,
        upgradeWindowTicks: CONFIG.capacity.upgradeWindowTicks,
      },
    );
    if (Memory.kernel.capacity?.tier !== capacity.tier) {
      console.log(
        `[${ctx.tick}] capacity: ${Memory.kernel.capacity?.tier ?? "(none)"} → ${capacity.tier}` +
        ` (headroom=${Math.round(capacity.headroom * 100)}%, limit=${Math.min(Game.cpu.limit, Game.cpu.tickLimit)})`,
      );
    }
    Memory.kernel.capacity = {
      tier: capacity.tier,
      since: capacity.since,
      upgradeTicks: capacity.upgradeTicks,
    };

    // ── P1-3：环境画像 — 低频采样（每 100 tick），getAllOrders 是 CPU 大户 ──
    if (ctx.tick % 100 === 0) {
      sampleEnvironment(ctx);
    }
  },
};

/**
 * P1-3：环境画像采样。采集市场可用性 + 邻居密度 + GCL 趋势，
 * 写入 Memory.kernel.environment 供策略层消费。
 * 每 100 tick 调用一次（getAllOrders ~0.5-1 CPU，不可每 tick 调）。
 */
function sampleEnvironment(ctx: TickContext): void {
  if (!Memory.kernel) Memory.kernel = {};
  // 1. 市场快照 — getAllOrders 是 CPU 大户，每 100 tick 调一次可接受。
  let totalOrders = 0;
  let buyOrders = 0;
  let sellOrders = 0;
  let credits = 0;
  try {
    const orders = Game.market?.getAllOrders?.() ?? [];
    totalOrders = orders.length;
    for (const o of orders) {
      if (o.type === "buy") buyOrders++;
      else sellOrders++;
    }
    credits = Game.market?.credits ?? 0;
  } catch {
    // 私服可能无 market API — 静默跳过。
  }

  // 2. 邻居密度 — 从各房 intel 汇总。
  let totalNeighbors = 0;
  let ownedNeighbors = 0;
  for (const roomName in Memory.rooms) {
    const intel = Memory.rooms[roomName]?.intel;
    if (!intel) continue;
    for (const neighborName in intel) {
      const entry = intel[neighborName];
      if (!entry) continue;
      totalNeighbors++;
      if (entry.owner) ownedNeighbors++;
    }
  }

  // 3. GCL 趋势 — 与上次采样对比。
  const prevEnv = Memory.kernel.environment;
  const gclLevel = Game.gcl?.level ?? 1;
  const gclProgress = Game.gcl?.progress ?? 0;

  const profile = evaluateEnvironment(
    ctx.tick,
    { totalOrders, buyOrders, sellOrders, credits },
    { totalNeighbors, ownedNeighbors },
    {
      level: gclLevel,
      progress: gclProgress,
      prevTick: prevEnv?.tick,
      prevProgress: prevEnv?.gclProgress,
    },
  );

  // 写入 Memory（字段精简：只存分级结果 + 采样 tick + GCL progress 供下次计算）。
  Memory.kernel.environment = {
    marketActivity: profile.marketActivity,
    neighborPressure: profile.neighborPressure,
    gclProgressRate: profile.gclProgressRate,
    tick: ctx.tick,
    gclProgress,
  };
}

function sumCpuByHome(): number {
  const stats = Memory.kernel?.stats;
  if (stats?.cpuByHome) {
    return Object.values(stats.cpuByHome).reduce((a, b) => a + b, 0);
  }
  // 回退：当前 tick 的实时 globalCache（telemetry-collector 尚未采样时）
  const byHome = globalCache().cpuByHome;
  if (byHome && byHome.size > 0) {
    let sum = 0;
    for (const cpu of byHome.values()) sum += cpu;
    return sum;
  }
  return 0;
}
