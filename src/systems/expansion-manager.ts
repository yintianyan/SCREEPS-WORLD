/**
 * Expansion Manager — P3 系统，GCL 变现的唯一入口（claim 新房）。
 * 状态机（Memory.kernel.expansion，同一时刻至多一个扩张行动）：
 * idle →(GCL 余量 + sponsor 健康 + intel 有可行目标)→ claiming →(目标房 controller.my)→
 * pioneering →(新房 spawn 建成)→ idle；claiming 超时/被抢占 → idle + 目标黑名单冷却。
 *
 * 架构复用（关键决策）：占领后只做一件事 — 用约束推导（distance field + selectAnchors）
 * 选出锚点写入新房 layout.anchor，此后完全复用既有机器：layout-planner 的「spawn 被毁
 * 重建」路径 → construction-manager 紧急豁免 → 拓荒 builder 建造 → 新房自治接管。
 * 灾后恢复机器与殖民机器是同一台 — 不新造第二条建造管线。
 * 拓荒编队：worker×N + builder×N，home 指向新房（sponsor 队列代孵，countPending 的
 * home 过滤保证不污染 sponsor 人口预算），孵化后经 ensureHome 自行走到新房。
 */
import { CONFIG } from "../config";
import { selectBody } from "../config/bodies";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { EventKind, recordEvent } from "../kernel/event-log";
import { selectExpansionTarget } from "../domain/expansion/evaluator";
import {
  appendOutcome,
  evaluateExpansionRhythm,
  type ExpansionOutcomeKind,
} from "../domain/expansion/rhythm";
import { cancelRequestsByHome, hasRequest, submitRequest } from "../domain/spawn/queue";
import { querySquad } from "../kernel/global-cache";
import { selectAnchors } from "../domain/layout/anchor-selection";
import { computeDistanceField } from "../domain/layout/terrain-analysis";
import { packPos } from "../domain/layout/types";
import { COMPACT_CORE_V2 } from "../domain/layout/templates/compact-core-v2";
import type { RoomIntel } from "../domain/intel";

/** ExpansionOutcome 事件编码（与 event-log 注释对齐）。 */
const PHASE_CLAIM = 0;
const PHASE_PIONEER = 1;
const OUTCOME_SUCCESS = 0;
const OUTCOME_STOLEN = 1;
const OUTCOME_TIMEOUT = 2;
const OUTCOME_LOST = 3;
const OUTCOME_ABORTED = 4;

export const expansionManagerSystem: System = {
  name: "expansion-manager",
  priority: 3 as Priority,
  interval: CONFIG.expansion.interval,
  run(ctx: TickContext): void {
    if (!Memory.kernel) Memory.kernel = {};
    const expansion = Memory.kernel.expansion;

    if (!expansion) {
      // C-1：CPU 门禁只裁决「是否开启新行动」— 扩张是纯发展行为，CPU 紧张时不开新局。
      if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded") return;
      if ((Game.cpu.bucket ?? 0) < 5000) return;
      // R7b：连续失败暂停止损 — 「失败→立刻再试」是烧 GCL 窗口的循环。
      if ((Memory.kernel.expansionPausedUntil ?? 0) > ctx.tick) return;
      // 战略门禁：是否扩张由 empire-strategy 的姿态裁决（Strategy 层）— 本系统只在
      // 获得授权时评选目标，不自行判断时机。姿态未就绪（reset 首 tick）默认不扩张。
      if (Memory.kernel.strategy?.expansionAllowed !== true) return;
      tryStartExpansion(ctx);
      return;
    }

    // 进行中的扩张行动不因姿态回落而中断 — claimer/拓荒编队已是沉没投资，
    // 半途而废比完成更贵；姿态只裁决「是否开启新行动」。
    // C-1 修复：状态机推进不受 CPU 门禁 — 原先门禁在函数入口，conserve/recovery 期间
    // 整个状态机冻结：超时判定、被抢占检测、威胁止损全部停摆，abort 分支恰恰是
    // CPU 紧张时最需要跑的止损路径。
    // 审查修正：孵化补充（submitPioneers/claimer 重派）仍属新增投资，与「开新行动」
    // 同类 — 传入 CPU 门禁位，低 tier 下只判定不送兵。
    const spawningAllowed =
      (ctx.budget.tier === "healthy" || ctx.budget.tier === "guarded") &&
      (Game.cpu.bucket ?? 0) >= 5000;

    switch (expansion.state) {
      case "claiming":
        advanceClaiming(ctx, expansion, spawningAllowed);
        break;
      case "pioneering":
        advancePioneering(ctx, expansion, spawningAllowed);
        break;
    }
  },
};

type ExpansionState = NonNullable<KernelMemory["expansion"]>;

/** R7a：扩张阶段收摊归因（决策结果台账）— 供节奏自适应归因失败条件。
 * R7b：任务级结果（每任务一条，claim 成功视为任务延续不追加）追加到节奏 ring，
 * 并重算自适应调节（暂停/门禁/黑名单缩放）写入 Memory。 */
function recordExpansionOutcome(expansion: ExpansionState, tick: number, phase: number, outcome: number): void {
  recordEvent(EventKind.ExpansionOutcome, expansion.target, [
    phase,
    outcome,
    tick - expansion.startedAt,
  ]);

  // 任务级归因：phase 0 的 success 是阶段中转（继续 pioneering），不追加。
  const kind = toOutcomeKind(phase, outcome);
  if (!kind) return;

  const rhythm = Memory.kernel!.expansionRhythm;
  const ring = appendOutcome(
    (rhythm?.ring ?? []).map(codeToKind),
    kind,
    CONFIG.expansion.rhythm.ringSize,
  );
  const result = evaluateExpansionRhythm(ring, {
    ringSize: CONFIG.expansion.rhythm.ringSize,
    pauseFailures: CONFIG.expansion.rhythm.pauseFailures,
    pauseTicks: CONFIG.expansion.rhythm.pauseTicks,
    minSourcesBase: CONFIG.expansion.rhythm.minSourcesBase,
    minSourcesOnStolen: CONFIG.expansion.rhythm.minSourcesOnStolen,
    stolenWindow: CONFIG.expansion.rhythm.stolenWindow,
    stolenThreshold: CONFIG.expansion.rhythm.stolenThreshold,
    relaxWindow: CONFIG.expansion.rhythm.relaxWindow,
    successRatioRelax: CONFIG.expansion.rhythm.successRatioRelax,
  });

  const prev = Memory.kernel!.expansionRhythm;
  if (
    prev?.blacklistMultiplier !== result.blacklistMultiplier ||
    prev?.minSources !== result.minSources
  ) {
    console.log(
      `[${tick}] expansion-rhythm: multiplier=${result.blacklistMultiplier}` +
      ` minSources=${result.minSources} consecFail=${result.consecutiveFailures}`,
    );
  }
  Memory.kernel!.expansionRhythm = {
    ring: ring.map(kindToCode),
    blacklistMultiplier: result.blacklistMultiplier,
    minSources: result.minSources,
  };
  if (result.pauseTicks > 0) {
    Memory.kernel!.expansionPausedUntil = tick + result.pauseTicks;
    console.log(`[${tick}] expansion: ${result.consecutiveFailures} 连败 — 暂停扩张 ${result.pauseTicks} tick`);
  }
}

function toOutcomeKind(phase: number, outcome: number): ExpansionOutcomeKind | undefined {
  if (phase === 0) {
    if (outcome === OUTCOME_SUCCESS) return undefined; // claim 成功 → 任务延续
    if (outcome === OUTCOME_STOLEN) return "stolen";
    if (outcome === OUTCOME_TIMEOUT) return "timeout";
    if (outcome === OUTCOME_LOST) return "lost";
    return "aborted";
  }
  if (outcome === OUTCOME_SUCCESS) return "success";
  if (outcome === OUTCOME_STOLEN) return "stolen";
  if (outcome === OUTCOME_TIMEOUT) return "timeout";
  return "lost";
}

function codeToKind(code: number): ExpansionOutcomeKind {
  return (["success", "stolen", "timeout", "lost", "aborted"] as const)[code] ?? "aborted";
}

function kindToCode(kind: ExpansionOutcomeKind): number {
  return (["success", "stolen", "timeout", "lost", "aborted"] as const).indexOf(kind);
}

/** 把失败目标记入黑名单（冷却时长按节奏台账缩放：成功多 → 缩短，零成功 → 加长）。 */
function blacklistTarget(roomName: string, tick: number): void {
  if (!Memory.kernel) Memory.kernel = {};
  Memory.kernel.expansionBlacklist ??= {};
  const multiplier = Memory.kernel.expansionRhythm?.blacklistMultiplier ?? 1;
  const cooldown = Math.round(CONFIG.expansion.blacklistCooldown * multiplier);
  Memory.kernel.expansionBlacklist[roomName] = tick + cooldown;
}

/**
 * 召回扩张行动的存活 creep（claimer + 拓荒编队）。
 *
 * abort 只清 Memory 不触碰 creep 会留下孤儿：拓荒者 home=新房，
 * 失守后 home 房无 snapshot → role-runner 每 tick 静默 return，
 * recyclePass 按自有房遍历也覆盖不到 — 整支编队原地呆立至寿终。
 * 把 home 改回 sponsor 并标记 recycle，让既有回收链（role-runner 停工 +
 * spawn-manager recyclePass 归航）接管；同时清掉 sponsor 队列中
 * 尚未孵化的本目标请求，防止 abort 后继续送兵。
 *
 * @internal 导出仅供接线级单元测试使用，业务代码经由 abort 路径调用。
 */
export function reclaimExpeditionCreeps(target: string, sponsor: string): void {
  for (const creep of Object.values(Game.creeps)) {
    const mem = creep.memory;
    if (mem.home !== target && !(mem.remoteTarget === target && mem.role === "claimer")) continue;
    mem.home = sponsor;
    mem.remoteTarget = undefined;
    mem.assignment = undefined;
    mem.recycle = true;
  }
  // P1-H：经纯函数通道撤销寄宿在 sponsor 队列的拓荒请求，
  // 不再直接 splice — spawn-manager 是队列属主，外模块不得直接动 splice。
  const queue = Memory.rooms[sponsor]?.spawnQueue;
  if (queue) cancelRequestsByHome(queue, target);
}

/** 清理已到期的黑名单条目（防无限累积）。 */
function pruneBlacklist(tick: number): void {
  const bl = Memory.kernel?.expansionBlacklist;
  if (!bl) return;
  for (const [room, retryAt] of Object.entries(bl)) {
    if (tick >= retryAt) delete bl[room];
  }
}

// ─── idle → claiming ────────────────────────────────────────

function tryStartExpansion(ctx: TickContext): void {
  pruneBlacklist(ctx.tick);

  // GCL 余量（测试环境无 Game.gcl 时按 1 处理 — 单房间下永远无余量，安全）。
  const gclLevel = Game.gcl?.level ?? 1;

  // sponsor 候选：经济成熟（RCL 门槛）且状态健康的自有房。
  const ownedRoomNames: string[] = [];
  const intelBySponsor: Record<string, Readonly<Record<string, RoomIntel>>> = {};
  // P1-G：从各 sponsor 的 remoteOps 提取 dangerUntil 映射，供 evaluator 过滤危险候选。
  const dangerUntilBySponsor: Record<string, Record<string, number>> = {};
  let myUsername: string | undefined;
  for (const snapshot of ctx.snapshots()) {
    ownedRoomNames.push(snapshot.roomName);
    myUsername ??= snapshot.controller?.owner?.username;
    if (snapshot.rcl < CONFIG.expansion.sponsorMinRcl) continue;
    const roomMem = Memory.rooms[snapshot.roomName];
    if (roomMem?.colonyState !== "normal") continue;
    if (roomMem.intel) intelBySponsor[snapshot.roomName] = roomMem.intel;
    // 提取本 sponsor 的 remoteOps 中的 dangerUntil 记录。
    if (roomMem.remoteOps) {
      const dangers: Record<string, number> = {};
      for (const [rn, op] of Object.entries(roomMem.remoteOps)) {
        if (op.dangerUntil !== undefined) dangers[rn] = op.dangerUntil;
      }
      if (Object.keys(dangers).length > 0) {
        dangerUntilBySponsor[snapshot.roomName] = dangers;
      }
    }
  }
  if (Object.keys(intelBySponsor).length === 0) return;

  const target = selectExpansionTarget({
    ownedRoomNames,
    gclLevel,
    intelBySponsor,
    dangerUntilBySponsor,
    tick: ctx.tick,
    blacklist: Memory.kernel?.expansionBlacklist,
    myUsername,
    // R7b：节奏台账驱动的目标门禁（stolen 频发 → 只选 ≥2 source 的高价值房）。
    minSources: Memory.kernel?.expansionRhythm?.minSources ?? CONFIG.expansion.rhythm.minSourcesBase,
  });
  if (!target) return;

  Memory.kernel!.expansion = {
    state: "claiming",
    target: target.roomName,
    sponsor: target.sponsorRoom,
    startedAt: ctx.tick,
  };
  submitClaimer(target.sponsorRoom, target.roomName, ctx.tick);
  console.log(
    `[${ctx.tick}] expansion: claiming ${target.roomName} (sponsor=${target.sponsorRoom}, sources=${target.sources})`,
  );
}

/** 向 sponsor 队列提交 claimer 请求（稳定 key，幂等）。 */
function submitClaimer(sponsor: string, target: string, tick: number): void {
  const roomMem = Memory.rooms[sponsor];
  if (!roomMem) return;
  const queue = roomMem.spawnQueue ?? [];
  const key = `claimer:${sponsor}:${target}`;
  if (hasRequest(queue, key)) return;

  const capacity = Game.rooms[sponsor]?.energyCapacityAvailable ?? 650;
  submitRequest(queue, {
    key,
    role: "claimer",
    home: sponsor,
    priority: 2,
    body: selectBody("claimer", capacity),
    memory: { role: "claimer", home: sponsor, mode: "acquire", remoteTarget: target },
    createdAt: tick,
    expiresAt: tick + CONFIG.spawn.requestTtl,
    retries: 0,
  });
  roomMem.spawnQueue = queue;
}

// ─── claiming → pioneering ──────────────────────────────────

function advanceClaiming(ctx: TickContext, expansion: ExpansionState, spawningAllowed: boolean): void {
  const targetRoom = Game.rooms[expansion.target];

  // 占领成功 → 选锚点、写 layout、进入拓荒。
  if (targetRoom?.controller?.my) {
    if (seedLayoutAnchor(targetRoom)) {
      recordExpansionOutcome(expansion, ctx.tick, PHASE_CLAIM, OUTCOME_SUCCESS);
      expansion.state = "pioneering";
      expansion.startedAt = ctx.tick;
      submitPioneers(ctx, expansion);
      console.log(`[${ctx.tick}] expansion: claimed ${expansion.target}, pioneering`);
    } else {
      // 无可行锚点 — 极罕见（开阔度门槛已带回退），放弃并冷却。
      console.log(`[${ctx.tick}] expansion: no viable anchor in ${expansion.target}, aborting`);
      recordExpansionOutcome(expansion, ctx.tick, PHASE_CLAIM, OUTCOME_ABORTED);
      blacklistTarget(expansion.target, ctx.tick);
      reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
      Memory.kernel!.expansion = undefined;
    }
    return;
  }

  // 被他人抢占 → 立即放弃。
  if (targetRoom?.controller?.owner && !targetRoom.controller.my) {
    console.log(`[${ctx.tick}] expansion: ${expansion.target} taken by ${targetRoom.controller.owner.username}, aborting`);
    recordExpansionOutcome(expansion, ctx.tick, PHASE_CLAIM, OUTCOME_STOLEN);
    blacklistTarget(expansion.target, ctx.tick);
    reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
    Memory.kernel!.expansion = undefined;
    return;
  }

  // 超时 → 放弃（claimer 迷路/被杀/GCL 边界竞争失败）。
  if (ctx.tick - expansion.startedAt > CONFIG.expansion.claimTimeout) {
    console.log(`[${ctx.tick}] expansion: claim ${expansion.target} timed out, aborting`);
    recordExpansionOutcome(expansion, ctx.tick, PHASE_CLAIM, OUTCOME_TIMEOUT);
    blacklistTarget(expansion.target, ctx.tick);
    reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
    Memory.kernel!.expansion = undefined;
    return;
  }

  // claimer 阵亡且无 pending → 幂等重派。
  // C-2：重派前查危险情报 — 目标房 dangerUntil 冷却未过（claimer 大概率
  // 死于威胁）时不再送兵，直接止损。无此闸的后果：claimer 被杀 → 重派 →
  // 再被杀 — 送兵循环最长跑满 claimTimeout。
  // P1-G：dangerUntil 从 intel 迁移到 remoteOps（remote-mining-manager 唯一写入）。
  // P0-1：claimer 有 remoteTarget，在 squadIndex 中 — 用 querySquad 替代全量遍历。
  const claimerAlive = querySquad({ role: "claimer", remoteTarget: expansion.target }).length > 0;
  if (!claimerAlive) {
    const dangerUntil = Memory.rooms[expansion.sponsor]?.remoteOps?.[expansion.target]?.dangerUntil;
    if (dangerUntil !== undefined && ctx.tick < dangerUntil) {
      console.log(`[${ctx.tick}] expansion: ${expansion.target} hostile (claimer lost), aborting`);
      recordExpansionOutcome(expansion, ctx.tick, PHASE_CLAIM, OUTCOME_LOST);
      blacklistTarget(expansion.target, ctx.tick);
      reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
      Memory.kernel!.expansion = undefined;
      return;
    }
    // 低 tier 下不重派（止损判定已在上方照常运行 — 送兵是新增投资）。
    if (!spawningAllowed) return;
    submitClaimer(expansion.sponsor, expansion.target, ctx.tick);
  }
}

/**
 * 用约束推导为新房选锚点并写入 layout — 之后交给既有的
 * layout-planner（spawn 重建路径）+ construction-manager（紧急豁免）。
 */
function seedLayoutAnchor(room: Room): boolean {
  const terrain = room.getTerrain();
  const getTerrain = (x: number, y: number): boolean => terrain.get(x, y) === TERRAIN_MASK_WALL;
  const field = computeDistanceField(getTerrain);
  const sources = room.find(FIND_SOURCES).map(s => ({ x: s.pos.x, y: s.pos.y }));
  const controller = room.controller
    ? { x: room.controller.pos.x, y: room.controller.pos.y }
    : undefined;
  const exits = room.find(FIND_EXIT).map(p => ({ x: p.x, y: p.y }));
  const mineral = room.find(FIND_MINERALS)[0];
  const mineralPos = mineral ? { x: mineral.pos.x, y: mineral.pos.y } : undefined;

  const base = { field, sources, controller, exits, mineral: mineralPos, getTerrain };
  // 开阔度 4 优先；地形逼仄的房间回退到 2（能放下 spawn 即可，核心可后续 relocation）。
  let candidates = selectAnchors({ ...base, maxCandidates: 1 });
  if (candidates.length === 0) {
    candidates = selectAnchors({ ...base, maxCandidates: 1, minOpenness: 2 });
  }
  const best = candidates[0];
  if (!best) return false;

  Memory.rooms[room.name] ??= { spawnQueue: [], buildQueue: [] };
  const roomMem = Memory.rooms[room.name]!;
  roomMem.layout = {
    version: 2,
    templateId: COMPACT_CORE_V2.id,
    state: "accepted",
    revision: 0,
    nextPlanTick: 0, // 立即触发首次规划。
    anchor: packPos(best.x, best.y),
    anchorScore: best.score,
  };
  return true;
}

// ─── pioneering → done ──────────────────────────────────────

function advancePioneering(ctx: TickContext, expansion: ExpansionState, spawningAllowed: boolean): void {
  const targetRoom = Game.rooms[expansion.target];

  // 房间失守（被抢/降级）→ 结束行动并冷却。
  if (!targetRoom?.controller?.my) {
    console.log(`[${ctx.tick}] expansion: lost ${expansion.target} during pioneering, aborting`);
    recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_STOLEN);
    blacklistTarget(expansion.target, ctx.tick);
    reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
    Memory.kernel!.expansion = undefined;
    return;
  }

  // 完成判据：新房 spawn 建成 — 此后新房的 demand/bootstrap 闭环自治。
  if (targetRoom.find(FIND_MY_SPAWNS).length > 0) {
    console.log(`[${ctx.tick}] expansion: ${expansion.target} spawn online, expansion complete`);
    recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_SUCCESS);
    Memory.kernel!.expansion = undefined;
    return;
  }

  // C-2：拓荒期威胁止损 — 拓荒编队零战力，威胁在场时全员 flee，
  // 补充的每一批都是给对手送经验。判据：目标房有威胁且编队已全灭
  // （worker+builder 存活 0）→ 放弃 + 黑名单冷却 + 撤单。
  // 审查修正：编队存活时只暂停补充，超时/完成判定继续运行 —
  // 原先直接 return 会让长期骚扰无限推迟超时判定。
  const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS, {
    filter: c => !CONFIG.defense.allies.includes(c.owner.username) &&
      c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK),
  });
  if (hostiles.length > 0) {
    const squadAlive = Object.values(Game.creeps).some(
      c => c.memory.home === expansion.target &&
        (c.memory.role === "worker" || c.memory.role === "builder"),
    );
    if (!squadAlive) {
      console.log(`[${ctx.tick}] expansion: ${expansion.target} squad wiped by hostiles, aborting`);
      recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_LOST);
      blacklistTarget(expansion.target, ctx.tick);
      reclaimExpeditionCreeps(expansion.target, expansion.sponsor);
      Memory.kernel!.expansion = undefined;
      return;
    }
  }

  // 超时：房已占下，仅停止编队补充（残余拓荒者继续干活至寿终）。
  if (ctx.tick - expansion.startedAt > CONFIG.expansion.pioneerTimeout) {
    console.log(`[${ctx.tick}] expansion: pioneering ${expansion.target} timed out, squad replenishment stopped`);
    recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_TIMEOUT);
    Memory.kernel!.expansion = undefined;
    return;
  }

  // 补充编队：威胁在场（不送新兵进战场）或低 CPU tier（新增投资暂停）时跳过。
  if (hostiles.length === 0 && spawningAllowed) {
    submitPioneers(ctx, expansion);
  }
}

/** 维持拓荒编队规模（sponsor 队列代孵，稳定 key 幂等）。 */
function submitPioneers(_ctx: TickContext, expansion: ExpansionState): void {
  const roomMem = Memory.rooms[expansion.sponsor];
  if (!roomMem) return;
  const queue = roomMem.spawnQueue ?? [];
  const capacity = Game.rooms[expansion.sponsor]?.energyCapacityAvailable ?? 300;
  const sponsorRcl = Game.rooms[expansion.sponsor]?.controller?.level ?? 4;

  // 存活计数（home 指向目标房的拓荒者）。
  const living: Record<string, number> = {};
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.home !== expansion.target) continue;
    const role = creep.memory.role;
    living[role] = (living[role] ?? 0) + 1;
  }

  const squad: ReadonlyArray<{ role: string; count: number }> = [
    { role: "worker", count: CONFIG.expansion.pioneerWorkers },
    { role: "builder", count: CONFIG.expansion.pioneerBuilders },
  ];

  for (const { role, count } of squad) {
    const pending = queue.filter(r => r.role === role && r.home === expansion.target).length;
    const total = (living[role] ?? 0) + pending;
    for (let i = total; i < count; i++) {
      const key = `expansion:${role}:${expansion.target}:${i}`;
      if (hasRequest(queue, key)) continue;
      submitRequest(queue, {
        key,
        role,
        home: expansion.target, // home = 新房：孵化后 ensureHome 自行迁徙。
        priority: 2,
        body: selectBody(role, capacity, { rcl: sponsorRcl }),
        memory: { role, home: expansion.target, mode: "acquire", spawnIndex: i },
        createdAt: Game.time,
        expiresAt: Game.time + CONFIG.spawn.requestTtl,
        retries: 0,
      });
    }
  }
  roomMem.spawnQueue = queue;
}
