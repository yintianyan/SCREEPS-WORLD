/** War Planner */
import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { EventKind, recordEvent } from "../kernel/event-log";
import {
  decideHealerCount,
  decideSquadSize,
  evaluateBoostGate,
  evaluateWarOutcome,
  isAttritionLost,
  nextWavePhase,
  NUKE_ENERGY_COST,
  NUKE_GHODIUM_COST,
  NUKE_LANDING_TIME,
  selectWarTarget,
  shouldLaunchNuke,
  type WarOutcome,
  type WarTargetCandidate,
  type WarTargetInput,
} from "../domain/war/planning";
import { roomLinearDistance } from "../domain/remote/targeting";
import {
  countPending,
  hasRequest,
  removeRequestsByRole,
  spawnKey,
  submitRequest,
} from "../domain/spawn/queue";
import { selectBody } from "../config/bodies";
import { querySquad, globalCache } from "../kernel/global-cache";

/** 收摊原因编码（WarOutcome 事件 d[2]）。 */
const REASON_POSTURE = 0;
const REASON_ATTRITION = 1;
const REASON_NO_TARGET = 2;
const REASON_PLAN_TIMEOUT = 3;

/** 核验结论编码（WarOutcome 事件 d[0]）。 */
const OUTCOME_CODES: Record<WarOutcome, number> = { success: 0, failure: 1, unknown: 2 };

export const warPlannerSystem: System = {
  name: "war-planner",
  priority: 2 as Priority,
  interval: CONFIG.war.interval,
  run(ctx: TickContext): void {
    pruneWarBlacklist(ctx.tick);

    const posture = Memory.kernel?.strategy?.posture;
    if (posture !== "war") {
      // 战争结束：清休战闸（plan 已在收摊时清除）。
      if (Memory.kernel) delete Memory.kernel.warStandDownUntil;
      demobilize(ctx.tick, REASON_POSTURE);
      return;
    }

    // R4 休战期：战损止损后整军休战 — 黑名单只挡单目标，
    // 休战闸挡「A 止损 → 立刻打 B → 再止损 → 打 C」的跨目标添油循环。
    if ((Memory.kernel?.warStandDownUntil ?? 0) > ctx.tick) return;
    // 1. 维护战争计划：无计划 / 计划超期 → 重新选目标。
    //    LEGACY_COMPATIBILITY_ONLY：selectWarTarget / decideSquadSize 是 Legacy 路径，
    //    只在 A5.3 war-planning-system 未产出 WarPlan 时作为 fallback。
    //    删除条件：当 war-planning-system 完全接管 WarPlan 产出后，
    //    此块可安全删除（包括 selectWarTarget/decideSquadSize import）。
    //    不产生新决策权——最终 WarPlan 由 war-planning-system 的 planMilitaryOperation() 裁决。
    const existing = Memory.kernel?.warPlan;
    const needSelect = !existing || ctx.tick - existing.since > CONFIG.war.planTimeout;
    if (needSelect) {
      // LEGACY_COMPATIBILITY_ONLY: selectWarTarget fallback
      const next = selectWarTarget(buildTargetInput(ctx.tick));
      if (!next) {
        // 无合格目标（情报全过期 / 无玩家邻居 / 目标全在黑名单）：
        // 收摊并核验旧计划战果（无证据核验 → unknown → 黑名单）。
        demobilize(ctx.tick, REASON_NO_TARGET);
        return;
      }
      const keep = existing && existing.targetRoom === next.roomName;
      if (!keep) demobilize(ctx.tick, REASON_PLAN_TIMEOUT);
      if (!Memory.kernel) Memory.kernel = {};
      Memory.kernel.warPlan = {
        targetRoom: next.roomName,
        sponsor: next.sponsor,
        // LEGACY_COMPATIBILITY_ONLY: decideSquadSize fallback (A5.3 a5ForceReq overrides at runtime)
        squadSize: decideSquadSize(next.towersSeen, CONFIG.war.squadBase, CONFIG.war.squadPerTower),
        since: ctx.tick,
        towersSeen: next.towersSeen,
        // 同目标续期：保留相位与止损账本（spawned 是消耗战判定的依据，不能重置）。
        phase: keep && existing!.phase ? existing!.phase : "build",
        spawned: keep ? (existing!.spawned ?? 0) : 0,
        spawnedKeys: keep ? existing!.spawnedKeys : undefined,
      };
    }

    const plan = Memory.kernel!.warPlan!;
    const sponsor = plan.sponsor;
    const queue = Memory.rooms[sponsor]?.spawnQueue;
    if (!queue) return; // sponsor 失守/条目标丢 — 下轮 occupied 排除后会换目标

    // 计划存续期间目标进黑名单（他处止损）→ 立即收摊，防绕过滤选回。
    if (isBlacklisted(plan.targetRoom, ctx.tick)) {
      demobilize(ctx.tick, REASON_NO_TARGET);
      return;
    }

    // 2. 维持编队（heal-tank）：attacker 拆打 + healer 治疗，分 role 统计补位。
    //    编制合计口径：满编/止损基数 = squadSize + healerCount（缺谁都不成编队）。
    //    boost 完成度自下而上派生（body 任一部件带 boost 即计）— 不入 Memory，
    //    与 healerCount 同理；编队成员由 lab-system 在 build 相位经 boost 链强化。
    //    P0-1：从全局编队索引取子集，替代独立全量遍历 Game.creeps。
    //
    //    A5.3 集成：当 a5ForceReq 存在时（war-planning-system 写入），
    //    使用 A5.3 能力推导的编队需求替代旧 decideSquadSize/decideHealerCount。
    //    LEGACY_COMPATIBILITY_ONLY：当 a5ForceReq 不存在时（war-planning-system 未运行），
    //    fallback 到 decideHealerCount(plan.squadSize)。
    //    不产生新决策——plan.squadSize 已在 needSelect 块中由 Legacy 路径决定。
    //    删除条件：当 war-planning-system 完全接管后，a5ForceReq 永远存在，
    //    fallback 分支永远不会执行，可安全删除。
    const a5 = plan.a5ForceReq;
    const attackerTarget = a5 ? a5.attacker : plan.squadSize;
    const healerCount = a5 ? a5.healer : decideHealerCount(plan.squadSize, CONFIG.war.healerSquadRatio);
    let attackerLive = 0;
    let healerLive = 0;
    let boostedLive = 0;
    const squad = querySquad({ home: sponsor, remoteTarget: plan.targetRoom });
    for (const e of squad) {
      if (e.role === "attacker") attackerLive++;
      else if (e.role === "healer") healerLive++;
      else continue;
      if (e.boosted) boostedLive++;
    }
    markSquadMaterialized(plan, squad, sponsor);
    const pendingAttackers = countPending(queue, "attacker", sponsor);
    const pendingHealers = countPending(queue, "healer", sponsor);
    const sponsorSnapshot = ctx.getSnapshot(sponsor);
    const cap = sponsorSnapshot?.energyCapacityAvailable ?? CONFIG.war.fallbackCapacity;

    // live+pending < 编制时每轮至多补 1 个新 key — 队列被能量门禁卡住时
    // pending 封顶编制，spawned 不会因空转膨胀。
    // A5.3：attackerTarget 来自 a5ForceReq（attacker+ranged 合并编制）。
    if (attackerLive + pendingAttackers < attackerTarget) {
      submitSquadRequest(queue, plan, sponsor, "attacker", attackerLive + pendingAttackers, cap, ctx.tick);
    }
    if (healerLive + pendingHealers < healerCount) {
      submitSquadRequest(queue, plan, sponsor, "healer", healerLive + pendingHealers, cap, ctx.tick);
    }

    // 3. 波次相位（迟滞，合计口径 + boost 门禁）：满编且全员强化才 advance，
    //    被打残才回落 build 重组。门禁降级（无 lab / 宽限期过）→ undefined 豁免：
    //    sponsor 缺基础矿时反应链产不出 T3，永久等待等于不打，裸攻由止损链兜底。
    const liveTotal = attackerLive + healerLive;
    // A5.3：满编阈值使用 attackerTarget + healerCount（与 a5ForceReq 一致）
    const fullSquadSize = attackerTarget + healerCount;
    const boostGate = evaluateBoostGate(
      boostedLive,
      liveTotal,
      (sponsorSnapshot?.rcl ?? 0) >= 6 && (sponsorSnapshot?.labs.length ?? 0) > 0,
      ctx.tick - plan.since > CONFIG.war.boostGraceTicks,
    );
    plan.phase = nextWavePhase(
      plan.phase ?? "build",
      liveTotal,
      fullSquadSize,
      CONFIG.war.waveRegroupRatio,
      boostGate,
    );

    // 3.5 核弹威慑发射（nuker 战略威慑链）：war 姿态授权（本系统是唯一进攻
    //     执行决策者）+ 塔数门槛 + 满装填无冷却 + 射程内 + 无在途 → 对目标房
    //     中心（25,25）发射。intel 无结构坐标，中心是敌方基地密度期望最大点。
    //     在途判定走台账（引擎无全局核弹查询 API，FIND_NUKES 需目标房视野 —
    //     自发核弹只能自查）；发射成功后台账 push + cooldown 5000 双保险，
    //     同目标在途期间不重复发射（重叠只是把当量堆在同一片废墟上）。
    //     已知取舍（发射不可取消）：核弹 50k tick 落地，若期间我方占领目标房，
    //     落地时自伤 — 缓解：扩张目标重合不射 + 塔数门槛保证只射编队啃不动的
    //     重防房（短期不会被占领）。
    pruneNukeLedger(ctx.tick);
    const nuker = sponsorSnapshot?.nuker;
    const kernel = Memory.kernel;
    if (nuker && kernel && kernel.expansion?.target !== plan.targetRoom) {
      const nukerReady =
        nuker.store.getUsedCapacity(RESOURCE_ENERGY) >= NUKE_ENERGY_COST &&
        (nuker.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0) >= NUKE_GHODIUM_COST &&
        nuker.cooldown === 0;
      const inFlight = (kernel.nukesInFlight?.[plan.targetRoom] ?? [])
        .filter(landAt => landAt > ctx.tick).length;
      const launch = shouldLaunchNuke({
        nukerReady,
        nukesInFlightToTarget: inFlight,
        towersSeen: plan.towersSeen,
        towerThreshold: CONFIG.nuker.launchTowerThreshold,
        linearDistance: roomLinearDistance(sponsor, plan.targetRoom),
        maxRange: CONFIG.nuker.maxRange,
      });
      if (launch) {
        const pos = new RoomPosition(25, 25, plan.targetRoom);
        if (nuker.launchNuke(pos) === OK) {
          recordNukeLaunch(plan.targetRoom, ctx.tick);
          recordEvent(EventKind.NukeLaunched, plan.targetRoom, [plan.towersSeen]);
          console.log(
            `[${Game.time}] nuke-launch: ${sponsor} → ${plan.targetRoom} (towers=${plan.towersSeen})`,
          );
        }
      }
    }

    // 4. 战损止损（合计基数）：投入超过编制 × 倍数仍未见效 → 判消耗战失败收摊。
    //    A5.3：止损基数使用 fullSquadSize（attackerTarget + healerCount）。
    if (
      isAttritionLost(
        plan.spawned ?? 0,
        fullSquadSize,
        CONFIG.war.casualtyMultiplier,
      )
    ) {
      demobilize(ctx.tick, REASON_ATTRITION);
      // 收摊后整军休战 — 下一轮评估前先让经济喘息，防止换目标立即再送。
      Memory.kernel!.warStandDownUntil = ctx.tick + CONFIG.war.standDownTicks;
    }
  },
};

/**
 * 编队补位请求（attacker/healer 同模式）：稳定 key 幂等提交，
 * spawned 账本在提交新 key 时 +1（消耗战判定依据）。
 */
export function submitSquadRequest(
  queue: NonNullable<RoomMemory["spawnQueue"]>,
  plan: NonNullable<KernelMemory["warPlan"]>,
  sponsor: string,
  role: "attacker" | "healer",
  index: number,
  cap: number,
  tick: number,
): void {
  const key = spawnKey(role, sponsor, index, plan.targetRoom);
  if (hasRequest(queue, key)) return;
  // 计数口径（修复 churn 虚增止损基数）：
  //   - 首次见到的 key → 计入（初始编制承诺）；
  //   - 前任已实际孵化（markSquadMaterialized 置位）的同键重提交 → 计入（战损替换）；
  //   - 其余（前任从未孵化的 TTL 过期/重试烧穿重提交）→ 不计入 —— 能量紧张时
  //     请求反复 churn 曾把没孵化出的请求也计入基数，提前误触 attrition 收摊。
  const materialized = plan.spawnedKeys?.[key] === true;
  const firstSubmit = plan.spawnedKeys?.[key] === undefined;
  if (firstSubmit || materialized) {
    plan.spawned = (plan.spawned ?? 0) + 1;
  }
  // 计数后一律归位：前任的兑现已消费，本任必须重新物化才能触发下一次替换计数
  // （否则「兑现→替换请求又 churn→再重提交」会沿 true 旗标连续误计）。
  if (!plan.spawnedKeys) plan.spawnedKeys = {};
  plan.spawnedKeys[key] = false;
  const body = selectBody(role, cap);
  submitRequest(queue, {
    key,
    role,
    home: sponsor,
    priority: 2,
    body,
    memory: {
      role,
      home: sponsor,
      mode: "acquire",
      spawnIndex: index,
      remoteTarget: plan.targetRoom,
    },
    createdAt: tick,
    expiresAt: tick + CONFIG.spawn.requestTtl,
    retries: 0,
  });
}

/**
 * 标记编队槽位的「已实际孵化」状态（Game.creeps 含 spawning 中的 creep，故
 * 孵化一开始即算兑现）。供 submitSquadRequest 区分战损替换（计数）与纯
 * churn 重提交（不计数）；只更新 log 中已存在的 key（计划建立前的存量
 * 编队成员不入账）。导出仅供单元测试注入编队条目。
 */
export function markSquadMaterialized(
  plan: NonNullable<KernelMemory["warPlan"]>,
  squad: readonly { name: string; role: string }[],
  sponsor: string,
): void {
  if (!plan.spawnedKeys) return;
  for (const e of squad) {
    const mem = Game.creeps[e.name]?.memory as { spawnIndex?: number } | undefined;
    const idx = mem?.spawnIndex;
    if (idx === undefined) continue;
    const key = spawnKey(e.role, sponsor, idx, plan.targetRoom);
    if (key in plan.spawnedKeys) plan.spawnedKeys[key] = true;
  }
}

/**
 * 收摊（幂等）：核验战果 → 失败/unknown 进黑名单 → 记录 WarOutcome 事件 →
 * 回收在役 attacker（标记 recycle，spawn-manager 归航回收）→ 撤销寄宿请求 → 清除计划。
 * reason：收摊原因编码（WarOutcome 事件 d[2]，黑匣子复盘用）。

 * P0-2 核验盲区修复：unknown（intel 过期/无视野）用更短的黑名单冷却 —
 * 区分「确定性打不赢」（failure，满额冷却）与「不知道打没打赢」（unknown，半额冷却）。
 * 根因：战后 attacker 撤退路径不一定经过目标房 → sponsor 的 intel 可能在战前就过期。
 * 将 unknown 与 failure 等同拉黑 20000 tick 会让一个「可能打赢了但没看到」的目标长期不可重选。
 * 缩短 unknown 冷却让系统在 intel 自然刷新后有更早的重评窗口。
 */
export function demobilize(tick: number, reason: number): void {
  const plan = Memory.kernel?.warPlan;
  if (!plan) return;

  // 战后核验：以 sponsor 记录的最新目标房 intel 判定战果。
  const intel = Memory.rooms[plan.sponsor]?.intel?.[plan.targetRoom];
  const outcome = evaluateWarOutcome(
    plan.towersSeen,
    intel?.towers,
    intel?.owner,
    intel?.lastSeen,
    tick,
    CONFIG.war.targetFreshness,
  );
  if (outcome !== "success") {
    // P0-2：unknown 用半额冷却 — intel 过期不是目标的错，缩短冷却让 intel 自然刷新后可重评。
    // failure 是确定性「打不赢」，用满额冷却防重选循环。
    const cooldown = outcome === "unknown"
      ? Math.floor(CONFIG.war.warBlacklistTicks / 2)
      : CONFIG.war.warBlacklistTicks;
    blacklistWarTarget(plan.targetRoom, tick + cooldown);
    console.log(
      `[${tick}] war: demobilize ${plan.targetRoom} outcome=${outcome}` +
      ` (intel_age=${intel?.lastSeen !== undefined ? tick - intel.lastSeen : "never"},` +
      ` blacklist=${cooldown}t, reason=${reason})`,
    );
  }

  // A5.3.1 GAP-1 修复：写入止损信号供 recovery-execution-system 消费。
  // recovery-execution-system 通过纯函数 mapAbortSignalsToRecoveryActions 将信号
  // 转换为 RecoveryAction，复用 A4.6 lifecycle 幂等机制（recoveryIdempotencyKey 去重）。
  // Military 只产出 Signal，不执行 Recovery。A4.6 负责 Signal → Action → 执行。
  const REASON_LABELS = ["POSTURE", "ATTRITION", "NO_TARGET", "PLAN_TIMEOUT"];
  const g = globalCache();
  // 读取 A5.3 operationId（如果 war-planning-system 已写入兼容字段）
  const compatOp = plan as typeof plan & { operationId?: string };
  g.warAbortSignals = {
    tick,
    reason: REASON_LABELS[reason] ?? `UNKNOWN(${reason})`,
    targetRoom: plan.targetRoom,
    sponsor: plan.sponsor,
    spawned: plan.spawned ?? 0,
    outcome,
    operationId: compatOp.operationId,
  };
  recordEvent(EventKind.WarOutcome, plan.targetRoom, [
    OUTCOME_CODES[outcome],
    plan.spawned ?? 0,
    reason,
  ]);

  // P0-1：从全局编队索引取编队成员，按 name 精确定位 Creep 对象标记 recycle。
  // 只需遍历编队子集（通常 ≤ 十几条），而非全量 Game.creeps。
  const warSquad = querySquad({ home: plan.sponsor, remoteTarget: plan.targetRoom });
  for (const e of warSquad) {
    // heal-tank 编队双角色同收（healer 独存无意义 — 奶车不作战）。
    if (e.role === "attacker" || e.role === "healer") {
      const creep = Game.creeps[e.name];
      if (creep) creep.memory.recycle = true;
    }
  }
  const queue = Memory.rooms[plan.sponsor]?.spawnQueue;
  if (queue) {
    removeRequestsByRole(queue, "attacker", plan.sponsor);
    removeRequestsByRole(queue, "healer", plan.sponsor);
  }
  delete Memory.kernel!.warPlan;
}

/** 目标是否处于战争黑名单冷却期内。 */
function isBlacklisted(roomName: string, tick: number): boolean {
  const bl = Memory.kernel?.warBlacklist;
  if (!bl) return false;
  return (bl[roomName] ?? 0) > tick;
}

/** 战争失败目标黑名单：房名 → 冷却到期 tick。唯一写者：本系统。 */
function blacklistWarTarget(roomName: string, until: number): void {
  if (!Memory.kernel) Memory.kernel = {};
  Memory.kernel.warBlacklist ??= {};
  Memory.kernel.warBlacklist[roomName] = until;
}

/** 清理到期黑名单条目（每次运行调用，O(条目数)，防膨胀）。 */
function pruneWarBlacklist(tick: number): void {
  const bl = Memory.kernel?.warBlacklist;
  if (!bl) return;
  for (const roomName in bl) {
    if (bl[roomName]! <= tick) delete bl[roomName];
  }
  if (Object.keys(bl).length === 0) delete Memory.kernel!.warBlacklist;
}

/** 在途核弹台账登记一次发射（落地到期 = 当前 tick + 引擎飞行时长 50k）。 */
function recordNukeLaunch(targetRoom: string, tick: number): void {
  if (!Memory.kernel) Memory.kernel = {};
  Memory.kernel.nukesInFlight ??= {};
  const entries = Memory.kernel.nukesInFlight[targetRoom] ?? [];
  entries.push(tick + NUKE_LANDING_TIME);
  Memory.kernel.nukesInFlight[targetRoom] = entries;
}

/** 清理已落地的在途核弹台账条目（每次运行调用，O(条目数)，防膨胀）。 */
function pruneNukeLedger(tick: number): void {
  const ledger = Memory.kernel?.nukesInFlight;
  if (!ledger) return;
  for (const target in ledger) {
    const live = ledger[target]!.filter(landAt => landAt > tick);
    if (live.length === 0) delete ledger[target];
    else ledger[target] = live;
  }
  if (Object.keys(ledger).length === 0) delete Memory.kernel!.nukesInFlight;
}

/** 从内存采集战争目标候选（世界可见态 → 纯函数输入）。 */
function buildTargetInput(tick: number): WarTargetInput {
  // 占用集合：我方殖民地 / 远矿运营目标 / 当前扩张目标 — 不打自己正在用的房。
  const occupied = new Set<string>();
  for (const rn of Object.keys(Game.rooms)) {
    if (Game.rooms[rn]?.controller?.my) occupied.add(rn);
  }
  for (const rn of Object.keys(Memory.rooms)) {
    const ops = Memory.rooms[rn]?.remoteOps;
    if (ops) {
      for (const target of Object.keys(ops)) {
        if (ops[target] && ops[target]!.state !== "abandoned") occupied.add(target);
      }
    }
  }
  const expansionTarget = Memory.kernel?.expansion?.target;
  if (expansionTarget) occupied.add(expansionTarget);

  // 我方用户名（首个自有房 controller owner）— 用于排除假冒目标。
  let myUsername = "";
  for (const rn of Object.keys(Game.rooms)) {
    const room = Game.rooms[rn];
    if (room?.controller?.my && room.controller.owner) {
      myUsername = room.controller.owner.username;
      break;
    }
  }

  const candidates: WarTargetCandidate[] = [];
  for (const home of Object.keys(Memory.rooms)) {
    const intel = Memory.rooms[home]?.intel;
    if (!intel) continue;
    for (const roomName of Object.keys(intel)) {
      const e = intel[roomName];
      if (!e) continue;
      candidates.push({
        roomName,
        home,
        kind: e.kind,
        owner: e.owner,
        lastSeen: e.lastSeen,
        towers: e.towers,
        pathCost: e.pathCost,
        occupied: occupied.has(roomName),
      });
    }
  }

  return {
    tick,
    myUsername,
    candidates,
    freshness: CONFIG.war.targetFreshness,
    maxTowers: CONFIG.war.maxTowers,
    blacklist: Memory.kernel?.warBlacklist,
  };
}
