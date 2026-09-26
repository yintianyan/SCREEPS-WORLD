/** War Planning System */
import type { Priority, System, TickContext } from "../../kernel/contracts";
import { globalCache } from "../../kernel/global-cache";
import { CONFIG } from "../../config";
import {
  planMilitaryOperation,
  type WarPlanningInput,
  type WarPlan,
} from "../../domain/military/war-planning";
import { isOffensive } from "../../domain/military/operation";
import type { TargetCandidate } from "../../domain/military/target-selection";
import { queryRoomIntel, intelActionUsable } from "../intelligence";
import type { ThreatAssessment } from "../../domain/defense/threat-assessment";
import type { TerrainContext } from "../../domain/defense/terrain-context";
import type { PlayerIntelRecord } from "../../domain/defense/player-intel";
import type { MultiDimensionalConfidence } from "../../domain/defense/confidence";
import type { CombatPower } from "../../domain/combat/capability";
import { EventKind, recordEvent } from "../../kernel/event-log";
import { log } from "../../kernel/log";
import { roomLinearDistance } from "../../domain/remote/targeting";
import { demobilize, REASON_TARGET_SWITCH } from "./war-planner";

// ═══════════════════════════════════════════════════════════
// §1. 系统定义
// ═══════════════════════════════════════════════════════════

export const warPlanningSystem: System = {
  name: "war-planning",
  priority: 2 as Priority,
  interval: CONFIG.war.interval,
  // FINDING-08 修复：war 姿态下必须运行——否则 Recovery tier 跳过 war-planning-system，
  // war-planner 的 Legacy fallback 路径会产出与 A5.3 不一致的编制（decideSquadSize vs a5ForceReq），
  // 导致编队在两套逻辑间震荡。
  recoveryEligible: () => Memory.kernel?.strategy?.posture === "war",

  run(ctx: TickContext): void {
    const tick = ctx.tick;

    // 1. 采集运行时状态，适配为 WarPlanningInput
    const input = buildWarPlanningInput(ctx, tick);
    if (!input) return;

    // 2. 调用纯函数 planMilitaryOperation
    const plan = planMilitaryOperation(input);

    // 3. 写入 globalCache.warPlanCache
    const g = globalCache();
    g.warPlanCache = { tick, plan };

    // 3.5 + 4. 有可执行的计划 → 解析 sponsor → 写物流需求 + 兼容 warPlan
    if (plan) {
      // sponsor 只解析一次：demand 与 warPlan 两个落点各自推导会漂移。
      const sponsor = resolveSponsor(plan.operation.target.roomName, ctx);
      if (!sponsor) {
        // 一个能孵兵的自有房都找不到（视野全丢）— 本轮不落笔，更不覆写既有计划：
        // 目标房名当 sponsor 写进 warPlan 会让 war-planner 整链静默停摆（见 resolveSponsor）。
        g.warLogisticsDemand = undefined;
        log.warn(
          "war-planning",
          `no sponsor room for target=${plan.operation.target.roomName} — plan not published`,
        );
        return;
      }
      g.warLogisticsDemand = {
        tick,
        sponsor,
        targetRoom: plan.operation.target.roomName,
        energy: plan.logisticsRequirement.energy,
        boost: plan.logisticsRequirement.boost,
        transport: plan.logisticsRequirement.transport,
        replacement: plan.logisticsRequirement.replacement,
      };
      writeCompatibleWarPlan(plan, tick, sponsor);
      recordEvent(EventKind.WarPlanCreated, plan.operation.target.roomName, [
        PLAN_EVENT_CODES[plan.operation.status] ?? 0,
        plan.operation.priority.score,
      ]);
      log.error(
        "war-planning-system",
        `war-planning: plan=${plan.operation.operationId}` +
          ` type=${plan.operation.type} target=${plan.operation.target.roomName}` +
          ` sponsor=${sponsor}` +
          ` posture=${plan.posture.posture} risk=${plan.risk.level}` +
          ` econGuard=${plan.economicGuard.passed ? "PASS" : "FAIL"}` +
          ` netValue=${plan.expectedValue.netValue}`,
      );
    } else {
      // 无计划（无威胁 / 未授权 / 经济护栏失败）：撤掉物流需求，但不清 warPlan —
      // 收摊（recycle + 撤请求 + 核验）是 war-planner 的职责，它每轮自己复核授权证据，
      // 断供超窗才撤军。这里抢着清 warPlan 会让旧编队变成没人回收的孤儿。
      g.warLogisticsDemand = undefined;
    }
  },
};

// ═══════════════════════════════════════════════════════════
// §2. 运行时数据采集 → WarPlanningInput
// ═══════════════════════════════════════════════════════════

/**
 * 从运行时状态采集并适配为 WarPlanningInput。

 * 采集来源：
 * - Memory.kernel.strategy.posture → empirePosture
 * - globalCache.empireHealth → empireHealth
 * - globalCache.threatAssessments → threatAssessments
 * - globalCache.multiResourceHealth → empireEnergyReserve（近似）
 * - Memory.kernel.warBlacklist → blacklist
 * - ctx.snapshots() → spawnCapacity, ourPower
 * - Memory.rooms[].intel → targetCandidates
 * - CONFIG.war.* → freshnessThreshold, maxTowers, maxDistance
 */
function buildWarPlanningInput(ctx: TickContext, tick: number): WarPlanningInput | undefined {
  const g = globalCache();

  // 帝国姿态
  const strategy = Memory.kernel?.strategy;
  const empirePosture = strategy?.posture ?? "develop";

  // 帝国健康度
  const empireHealth = g.empireHealth;
  if (!empireHealth) return undefined;

  // 威胁评估
  const threatMap = g.threatAssessments;
  const threatAssessments: {
    roomName: string;
    assessment: ThreatAssessment;
    terrain?: TerrainContext;
  }[] = [];
  if (threatMap) {
    for (const [roomName, assessment] of threatMap) {
      threatAssessments.push({ roomName, assessment });
    }
  }

  // CPU tier
  const cpuTier = ctx.budget.tier;

  // 帝国能量储备（从 storage 合计近似）
  let empireEnergyReserve = 0;
  let spawnCapacity = 0;
  let activeRemoteCount = 0;

  for (const snap of ctx.snapshots()) {
    const room = Game.rooms[snap.roomName];
    empireEnergyReserve += room?.storage?.store.energy ?? 0;
    empireEnergyReserve += room?.terminal?.store.energy ?? 0;
    spawnCapacity += snap.spawns.filter(s => !s.spawning).length;

    const remoteOps = Memory.rooms[snap.roomName]?.remoteOps;
    if (remoteOps) {
      for (const op of Object.values(remoteOps)) {
        if (op && op.state === "active") activeRemoteCount++;
      }
    }
  }

  // 我方战斗力（从 squadIndex 聚合 attacker/healer/defender）
  const ourPower = computeOurPower(g);

  // 物流可靠性（从 logisticsHealth 近似）
  const logisticsHealth = g.logisticsHealth;
  const logisticsReliability = logisticsHealth
    ? Math.max(0, 1 - logisticsHealth.backlogCount / 20)
    : 0.5;

  // 恢复能力
  const recoveryStats = g.recoveryStats;
  const recoveryCapability = recoveryStats
    ? Math.min(
        1,
        recoveryStats.succeededCount /
          Math.max(1, recoveryStats.succeededCount + recoveryStats.failedCount),
      )
    : 0.5;

  // 替换能力（spawn 空闲率近似）
  const replacementCapacity = spawnCapacity > 0 ? Math.min(1, spawnCapacity / 3) : 0;

  // 黑名单
  const blacklist: Readonly<Record<string, number>> = Memory.kernel?.warBlacklist ?? {};

  // 目标候选（从 intel 采集）
  const targetCandidates = buildTargetCandidates(tick);

  // 玩家情报（从 threatAssessments 中最高威胁房的 intelEvidence 推导）
  const maxThreat =
    threatAssessments.length > 0
      ? threatAssessments.reduce((max, t) => {
          const rank: Record<string, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
          const r = rank[t.assessment.level] ?? 0;
          const mr = rank[max.assessment.level] ?? 0;
          return r > mr ? t : max;
        }, threatAssessments[0]!)
      : undefined;

  const playerIntel: PlayerIntelRecord | undefined = undefined; // PlayerIntel 系统由 A5.2 管理
  const confidence: MultiDimensionalConfidence | undefined = maxThreat?.assessment.multiConfidence;

  // 是否有活跃 Operation
  const hasActiveOperation = !!Memory.kernel?.warPlan;

  return {
    tick,
    empirePosture,
    empireHealth,
    empireEnergyReserve,
    cpuTier,
    threatAssessments,
    playerIntel,
    confidence,
    targetCandidates,
    ourPower,
    spawnCapacity,
    activeRemoteCount,
    logisticsReliability,
    recoveryCapability,
    replacementCapacity,
    blacklist,
    freshnessThreshold: CONFIG.war.targetFreshness,
    maxTowers: CONFIG.war.maxTowers,
    maxDistance: 10,
    hasActiveOperation,
    energyPerCreep: 300,
    boostCostPerCreep: 200,
    seq: (g.warPlanCache?.tick ?? 0) === tick ? 1 : 0,
  };
}

// ═══════════════════════════════════════════════════════════
// §3. 目标候选采集
// ═══════════════════════════════════════════════════════════

/**
 * 从 Memory.rooms[].intel 采集战争目标候选。
 */
function buildTargetCandidates(tick: number): TargetCandidate[] {
  const candidates: TargetCandidate[] = [];
  const occupied = new Set<string>();

  // 我方房
  for (const rn of Object.keys(Game.rooms)) {
    if (Game.rooms[rn]?.controller?.my) occupied.add(rn);
  }
  // 远矿运营目标
  for (const rn of Object.keys(Memory.rooms)) {
    const ops = Memory.rooms[rn]?.remoteOps;
    if (ops) {
      for (const target of Object.keys(ops)) {
        if (ops[target] && ops[target]!.state !== "abandoned") occupied.add(target);
      }
    }
  }
  // 扩张目标
  const expansionTarget = Memory.kernel?.expansion?.target;
  if (expansionTarget) occupied.add(expansionTarget);

  // 我方用户名
  let myUsername = "";
  for (const rn of Object.keys(Game.rooms)) {
    const room = Game.rooms[rn];
    if (room?.controller?.my && room.controller.owner) {
      myUsername = room.controller.owner.username;
      break;
    }
  }

  // 从 intel 采集候选
  const blacklist = Memory.kernel?.warBlacklist ?? {};
  for (const entry of queryRoomIntel()) {
    // 授权硬门槛：非 fact 级情报不进入战争目标候选（INTELLIGENCE §5）。
    if (!intelActionUsable(entry.subject, tick)) continue;
    const e = entry.payload;
    // 只选有主非我方房
    if (!e.owner || e.owner === myUsername) continue;
    if (e.kind !== "normal") continue;

    candidates.push({
      roomName: entry.subject,
      occupied: occupied.has(entry.subject),
      owner: e.owner,
      towers: e.towers,
      rcl: undefined,
      distance: e.pathCost ?? 5,
      intelAge: tick - entry.observedAt,
      blacklisted: (blacklist[entry.subject] ?? 0) > tick,
      isRemote: false,
      isCore: false,
    });
  }

  return candidates;
}

// ═══════════════════════════════════════════════════════════
// §4. 我方战斗力聚合
// ═══════════════════════════════════════════════════════════

/**
 * 从 squadIndex 聚合我方军事 creep 的战斗力。

 * 统计 attacker + healer + defender 的 body parts，
 * 用 computeCombatPower 的简化版估计。
 */
// ─── Screeps body part 常量 ────────────────────────────────
// ATTACK=ATTACK, RANGED_ATTACK=RANGED_ATTACK, HEAL=HEAL, WORK=WORK, TOUGH=TOUGH, MOVE=MOVE
// 均为 Screeps 全局常量。伤害值用硬编码（跨引擎一致）。
const PART_ATTACK_POWER = 30; // ATTACK part damage/tick
const PART_RANGED_POWER = 10; // RANGED_ATTACK part damage/tick
const PART_HEAL_POWER = 12; // HEAL part heal/tick (ranged: 4, melee: 12)
const PART_DISMANTLE_POWER = 50; // WORK part dismantle/tick

function computeOurPower(g: ReturnType<typeof globalCache>): CombatPower {
  const squadIndex = g.squadIndex;
  if (!squadIndex || squadIndex.length === 0) {
    return {
      burstDamage: 0,
      effectiveHP: 0,
      healOutput: 0,
      dismantlePower: 0,
      powerScore: 0,
      creepCount: 0,
      mobility: 1,
      boosted: false,
    };
  }

  // 只统计军事角色
  const militaryCreeps = squadIndex.filter(
    e => e.role === "attacker" || e.role === "healer" || e.role === "defender",
  );

  if (militaryCreeps.length === 0) {
    return {
      burstDamage: 0,
      effectiveHP: 0,
      healOutput: 0,
      dismantlePower: 0,
      powerScore: 0,
      creepCount: 0,
      mobility: 1,
      boosted: false,
    };
  }

  let totalAttack = 0;
  let totalRanged = 0;
  let totalHeal = 0;
  let totalDismantle = 0;
  let totalTough = 0;
  let totalMove = 0;
  let boosted = false;

  for (const entry of militaryCreeps) {
    const creep = Game.creeps[entry.name];
    if (!creep || creep.spawning) continue;
    for (const part of creep.body) {
      switch (part.type) {
        case ATTACK:
          totalAttack += PART_ATTACK_POWER;
          break;
        case RANGED_ATTACK:
          totalRanged += PART_RANGED_POWER;
          break;
        case HEAL:
          totalHeal += PART_HEAL_POWER;
          break;
        case TOUGH:
          totalTough += 100;
          break;
        case WORK:
          totalDismantle += PART_DISMANTLE_POWER;
          break;
        case MOVE:
          totalMove++;
          break;
      }
      if (part.boost) boosted = true;
    }
  }

  const burstDamage = totalAttack + totalRanged;
  const effectiveHP = totalTough + militaryCreeps.length * 200; // 粗估
  const healOutput = totalHeal;
  const dismantlePower = totalDismantle;
  const powerScore = Math.round(
    burstDamage * 1.0 + effectiveHP * 0.1 + healOutput * 0.5 + dismantlePower * 0.3,
  );

  return {
    burstDamage,
    effectiveHP,
    healOutput,
    dismantlePower,
    powerScore,
    creepCount: militaryCreeps.length,
    mobility: totalMove > 0 ? Math.min(2, totalMove / militaryCreeps.length) : 1,
    boosted,
  };
}

// ═══════════════════════════════════════════════════════════
// §5. 兼容写入 Memory.kernel.warPlan
// ═══════════════════════════════════════════════════════════

/**
 * 解析编队的孵化房（sponsor）= 「谁来出这支兵」。
 *
 * 这不是 domain 能回答的问题：`plan.spawnRequirement[].home` 填的是**目标房**
 * （纯函数只有情报视野，没有"我方哪间房"的概念），把它当 sponsor 用会让
 * war-planner 去读 `Memory.rooms[目标房].spawnQueue` —— 敌房/远矿恒无此条，
 * :117 直接 return，编队维持/波次相位/核弹/止损整链静默停摆（防御型目标恰好
 * 是同值才一直没暴露）。同理，止损信号的 `room` 也会记到一间不属于我们的房上。
 *
 * 推导次序（越靠前越确定）：
 * 1. 目标就是自有房 → 就地防御，本房自孵；
 * 2. 目标是某自有房的在运营远矿 → 由运营它的 host 出兵（谁受益谁付）；
 * 3. 通勤最近的、有空闲孵化位的自有房。
 */
function resolveSponsor(targetRoom: string, ctx: TickContext): string | undefined {
  if (Game.rooms[targetRoom]?.controller?.my === true) return targetRoom;

  for (const [host, mem] of Object.entries(Memory.rooms)) {
    const op = mem?.remoteOps?.[targetRoom];
    if (op && op.state !== "abandoned" && Game.rooms[host]?.controller?.my === true) {
      return host;
    }
  }

  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const snap of ctx.snapshots()) {
    if (snap.spawns.length === 0) continue;
    const distance = roomLinearDistance(snap.roomName, targetRoom);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = snap.roomName;
    }
  }
  return best;
}

/**
 * 将新 WarPlan 兼容写入 Memory.kernel.warPlan，
 * 使 attacker/healer 角色无感知切换。

 * 兼容格式：
 *   targetRoom, sponsor, squadSize, since, towersSeen, phase, spawned

 * 新字段（A5.3 运行时字段，无 schema 变更）：
 *   operationId, warPosture, operationType

 * sponsor 由调用方解析后传入（见 resolveSponsor）——本函数只负责投影，
 * 不再自己猜孵化房。
 */
function writeCompatibleWarPlan(plan: WarPlan, tick: number, sponsor: string): void {
  if (!Memory.kernel) Memory.kernel = {};

  const existing = Memory.kernel.warPlan;
  const targetRoom = plan.operation.target.roomName;
  const squadSize = plan.forceRequirement.total;
  const freshTowers = plan.targetSelection.selected?.towers ?? 0;

  // 换目标必须先收摊（demobilize 是唯一实现）：旧目标的在役编队要标 recycle、
  // 旧 sponsor 的在队 attacker/healer 请求要撤、止损信号要报给 recovery。
  // 只重置 since/spawned 而不收摊 = 旧编队永久孤儿（squadIndex 按
  // home+remoteTarget 键死，新计划再也不会查到它们）+ 旧房队列滞留。
  const switching = existing !== undefined && existing.targetRoom !== targetRoom;
  if (switching) demobilize(tick, REASON_TARGET_SWITCH);
  // switching 后 warPlan 已被 demobilize 删除，此处必须用切换前的结论，不能再读 existing。
  const keep = !switching && existing !== undefined;

  Memory.kernel.warPlan = {
    targetRoom,
    sponsor,
    squadSize: Math.max(1, squadSize),
    since: keep ? existing!.since : tick,
    // 恒 0，且这是正确值不是丢失：A5 只产防御型目标（受威胁的自有房/远矿房），
    // deriveTarget 的合成候选 towers=undefined。towersSeen 的用途是「进去时要拆掉几座
    // 塔」（核弹门槛 + 战后核验基线），对自家/远矿房本就无从谈起 —— 核弹门在防御型
    // 计划上不发射是期望行为，真正的进攻型计划由 war-planner 的选目标路径给出塔数。
    towersSeen: freshTowers,
    phase: keep && existing!.phase ? existing!.phase : "build",
    spawned: keep ? (existing!.spawned ?? 0) : 0,
    spawnedKeys: keep ? existing!.spawnedKeys : undefined,
  };

  // A5.3 运行时扩展字段（无 schema 变更，遵循 R12 先例）
  const wp = Memory.kernel.warPlan as typeof Memory.kernel.warPlan & {
    operationId?: string;
    warPosture?: string;
    operationType?: string;
    warPlanHash?: string;
  };
  wp.operationId = plan.operation.operationId;
  wp.warPosture = plan.posture.posture;
  wp.operationType = plan.operation.type;
  wp.warPlanHash = plan.hash;

  // A5.3 编队需求：写入 a5ForceReq 供 war-planner 消费
  // war-planner 用它替代旧 decideSquadSize/decideHealerCount
  const a5 = {
    attacker: plan.forceRequirement.attacker + plan.forceRequirement.ranged,
    healer: plan.forceRequirement.healer,
    tank: plan.forceRequirement.tank,
    dismantler: plan.forceRequirement.dismantler,
    total: plan.forceRequirement.total,
  };
  // 防御性行动且目标为自有房：威胁在本房，塔 + 本地 defender 已覆盖，
  // attacker/healer 编队（remoteTarget=自家）无敌可打、集结后只能整队回收
  // （线上实证：编队从未出击即被回收，自有房反被拉进 warBlacklist）。
  // 编队需求清零——战争姿态保留，进攻编队只对外。
  const defensiveOwnTarget =
    !isOffensive(plan.operation.type) && Game.rooms[targetRoom]?.controller?.my === true;
  if (defensiveOwnTarget) {
    a5.attacker = 0;
    a5.healer = 0;
    a5.tank = 0;
    a5.dismantler = 0;
    a5.total = 0;
  }
  wp.a5ForceReq = a5;
}

// ═══════════════════════════════════════════════════════════
// §6. 事件编码
// ═══════════════════════════════════════════════════════════

const PLAN_EVENT_CODES: Record<string, number> = {
  PLANNED: 0,
  AUTHORIZED: 1,
  PREPARING: 2,
  READY: 3,
  ACTIVE: 4,
  DEGRADED: 5,
  ABORTING: 6,
  COMPLETED: 7,
  FAILED: 8,
  EXPIRED: 9,
};
