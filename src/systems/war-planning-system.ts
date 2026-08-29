/** War Planning System */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import { CONFIG } from "../config";
import {
  planMilitaryOperation,
  type WarPlanningInput,
  type WarPlan,
} from "../domain/military/war-planning";
import type { TargetCandidate } from "../domain/military/target-selection";
import { queryRoomIntel, intelActionUsable } from "./intelligence";
import type { ThreatAssessment } from "../domain/defense/threat-assessment";
import type { TerrainContext } from "../domain/defense/terrain-context";
import type { PlayerIntelRecord } from "../domain/defense/player-intel";
import type { MultiDimensionalConfidence } from "../domain/defense/confidence";
import type { CombatPower } from "../domain/combat/capability";
import { EventKind, recordEvent } from "../kernel/event-log";
import { log } from "../kernel/log";

// ═══════════════════════════════════════════════════════════
// §1. 系统定义
// ═══════════════════════════════════════════════════════════

export const warPlanningSystem: System = {
  name: "war-planning",
  priority: 2 as Priority,
  interval: CONFIG.war.interval,

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

    // 3.5 写入 warLogisticsDemand 供 logistics-planner 消费
    if (plan) {
      const sponsor = plan.spawnRequirement[0]?.home ?? plan.operation.target.roomName;
      g.warLogisticsDemand = {
        tick,
        sponsor,
        targetRoom: plan.operation.target.roomName,
        energy: plan.logisticsRequirement.energy,
        boost: plan.logisticsRequirement.boost,
        transport: plan.logisticsRequirement.transport,
        replacement: plan.logisticsRequirement.replacement,
      };
    } else {
      g.warLogisticsDemand = undefined;
    }

    // 4. 兼容写入 Memory.kernel.warPlan（attacker/healer 无缝切换）
    if (plan) {
      writeCompatibleWarPlan(plan, tick);
      recordEvent(EventKind.WarPlanCreated, plan.operation.target.roomName, [
        PLAN_EVENT_CODES[plan.operation.status] ?? 0,
        plan.operation.priority.score,
      ]);
      log.error("war-planning-system", `war-planning: plan=${plan.operation.operationId}` +
        ` type=${plan.operation.type} target=${plan.operation.target.roomName}` +
        ` posture=${plan.posture.posture} risk=${plan.risk.level}` +
        ` econGuard=${plan.economicGuard.passed ? "PASS" : "FAIL"}` +
        ` netValue=${plan.expectedValue.netValue}`,);
    } else {
      // 无计划（无威胁/未授权/经济护栏失败）— 清除旧兼容 Memory
      // 但不调 demobilize（那是 war-planner 的职责）
      // 只在 posture 非 war 时清，避免误清
      const posture = Memory.kernel?.strategy?.posture;
      if (posture !== "war" && Memory.kernel?.warPlan) {
        // war-planner 会处理 demobilize，这里不重复
      }
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
  const threatAssessments: { roomName: string; assessment: ThreatAssessment; terrain?: TerrainContext }[] = [];
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
  const logisticsReliability = logisticsHealth ? Math.max(0, 1 - logisticsHealth.backlogCount / 20) : 0.5;

  // 恢复能力
  const recoveryStats = g.recoveryStats;
  const recoveryCapability = recoveryStats
    ? Math.min(1, recoveryStats.succeededCount / Math.max(1, recoveryStats.succeededCount + recoveryStats.failedCount))
    : 0.5;

  // 替换能力（spawn 空闲率近似）
  const replacementCapacity = spawnCapacity > 0 ? Math.min(1, spawnCapacity / 3) : 0;

  // 黑名单
  const blacklist: Readonly<Record<string, number>> = Memory.kernel?.warBlacklist ?? {};

  // 目标候选（从 intel 采集）
  const targetCandidates = buildTargetCandidates(tick);

  // 玩家情报（从 threatAssessments 中最高威胁房的 intelEvidence 推导）
  const maxThreat = threatAssessments.length > 0
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
const PART_ATTACK_POWER = 30;   // ATTACK part damage/tick
const PART_RANGED_POWER = 10;  // RANGED_ATTACK part damage/tick
const PART_HEAL_POWER = 12;    // HEAL part heal/tick (ranged: 4, melee: 12)
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
  const militaryCreeps = squadIndex.filter(e =>
    e.role === "attacker" || e.role === "healer" || e.role === "defender",
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
        case ATTACK: totalAttack += PART_ATTACK_POWER; break;
        case RANGED_ATTACK: totalRanged += PART_RANGED_POWER; break;
        case HEAL: totalHeal += PART_HEAL_POWER; break;
        case TOUGH: totalTough += 100; break;
        case WORK: totalDismantle += PART_DISMANTLE_POWER; break;
        case MOVE: totalMove++; break;
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
 * 将新 WarPlan 兼容写入 Memory.kernel.warPlan，
 * 使 attacker/healer 角色无感知切换。

 * 兼容格式：
 *   targetRoom, sponsor, squadSize, since, towersSeen, phase, spawned

 * 新字段（A5.3 运行时字段，无 schema 变更）：
 *   operationId, warPosture, operationType
 */
function writeCompatibleWarPlan(plan: WarPlan, tick: number): void {
  if (!Memory.kernel) Memory.kernel = {};

  const existing = Memory.kernel.warPlan;
  const targetRoom = plan.operation.target.roomName;
  const sponsor = plan.spawnRequirement[0]?.home ?? plan.operation.target.roomName;
  const squadSize = plan.forceRequirement.total;
  const towersSeen = plan.targetSelection.selected?.towers ?? 0;

  // 同目标续期：保留 spawned 和 spawnedKeys
  const keep = existing && existing.targetRoom === targetRoom;

  Memory.kernel.warPlan = {
    targetRoom,
    sponsor,
    squadSize: Math.max(1, squadSize),
    since: keep ? existing!.since : tick,
    towersSeen,
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
  wp.a5ForceReq = {
    attacker: plan.forceRequirement.attacker + plan.forceRequirement.ranged,
    healer: plan.forceRequirement.healer,
    tank: plan.forceRequirement.tank,
    dismantler: plan.forceRequirement.dismantler,
    total: plan.forceRequirement.total,
  };
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
