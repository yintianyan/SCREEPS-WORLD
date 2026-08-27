/** Tactical Runtime System */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache, querySquad, type GlobalCache } from "../kernel/global-cache";
import { CONFIG } from "../config";
import { recordEvent, EventKind } from "../kernel/event-log";
import {
  evaluateTacticalAction,
  assessObjectiveLifecycle,
  mapDecisionToRoleIntent,
  canTransitionObjective,
  isObjectiveTerminal,
  isObjectiveActive,
  type TacticalSnapshot,
  type TacticalDecision,
  type TacticalObjective,
  type TacticalAuthorization,
  type SquadPlan,
  type SquadMemberSnapshot,
  type EnemySnapshot,
  type EnemyStructureSnapshot,
  type TacticalAbortSignal,
  type ReinforcementDemand,
  type ForceShortage,
  type SupplyDemand,
  type TacticalDecisionRecord,
  type TacticalDecisionEvent,
  type RoleActionIntent,
  type ObjectiveLifecycleState,
  type TacticalObjectiveRecord,
  type LifecycleAssessmentInput,
  type FormationType,
  type TacticalState,
} from "../domain/tactical";
import type { CombatCapability, AggregateCapability } from "../domain/combat/capability";
import type { TerrainContext, EffectiveCombatModifier } from "../domain/defense/terrain-context";
import type { MultiDimensionalConfidence } from "../domain/defense/confidence";
import { validateAuthorization } from "../domain/tactical/authorization";

// ═══════════════════════════════════════════════════════════
// §1. GlobalCache 扩展 — Tactical Runtime 状态
// ═══════════════════════════════════════════════════════════

/** Tactical Runtime 在 globalCache 上的扩展字段。 */
interface TacticalRuntimeCache {
  /** 活跃 TacticalObjective 记录表。key = objectiveId。 */
  tacticalObjectives?: Map<string, TacticalObjectiveRecord>;
  /** 当前 tick 的 RoleActionIntent 映射。key = creepName。 */
  tacticalRoleIntents?: Map<string, RoleActionIntent>;
  /** 当前 tick 的 TacticalDecision 列表（供 decision-trace 消费）。 */
  tacticalDecisions?: TacticalDecision[];
  /** 战术止损信号列表（供 recovery-execution-system 消费）。 */
  tacticalAbortSignals?: TacticalAbortSignal[];
  /** 增援需求列表（已提交到 spawn queue 的，幂等去重用）。 */
  tacticalReinforcementDemands?: Set<string>;
  /** 补给需求列表（供 logistics-planner 消费）。 */
  tacticalSupplyDemands?: SupplyDemand[];
  /** 上次运行 tick（幂等去重）。 */
  tacticalLastRunTick?: number;
}

// ═══════════════════════════════════════════════════════════
// §2. 系统定义
// ═══════════════════════════════════════════════════════════

export const tacticalRuntimeSystem: System = {
  name: "tactical-runtime",
  priority: 2 as Priority,
  interval: 10,

  run(ctx: TickContext): void {
    const g = globalCache() as unknown as GlobalCache & TacticalRuntimeCache;
    const tick = ctx.tick;

    // ── 1. 初始化缓存 ──
    if (!g.tacticalObjectives) g.tacticalObjectives = new Map();
    if (!g.tacticalRoleIntents) g.tacticalRoleIntents = new Map();
    if (!g.tacticalReinforcementDemands) g.tacticalReinforcementDemands = new Set();

    // 每 tick 重置 per-tick 数据
    g.tacticalRoleIntents.clear();
    g.tacticalDecisions = [];
    g.tacticalAbortSignals = [];
    g.tacticalSupplyDemands = [];

    // ── 2. 无 warPlan 时跳过（授权来源不存在） ──
    const plan = Memory.kernel?.warPlan;
    if (!plan) {
      // 无计划：清理终态 Objectives，退出
      cleanupTerminalObjectives(g, tick);
      return;
    }

    // ── 3. 确保有活跃 TacticalObjective ──
    //     从 warPlan 派生 TacticalObjective（如果尚无活跃的）
    const posture = Memory.kernel?.strategy?.posture ?? "develop";
    const operationAborted = false; // warPlan 存在即未 abort
    const expiry = tick + CONFIG.war.planTimeout;

    let objectiveRecord = findActiveObjective(g);
    if (!objectiveRecord) {
      // 创建新的 TacticalObjective
      const objective = buildTacticalObjective(plan, posture, operationAborted, expiry, tick);
      objectiveRecord = createObjectiveRecord(objective, tick);
      g.tacticalObjectives.set(objectiveRecord.objectiveId, objectiveRecord);
      recordTacticalEvent(
        "TACTICAL_OBJECTIVE_ACCEPTED",
        objectiveRecord.operationId,
        objectiveRecord.objectiveId,
        objectiveRecord.squadId,
        tick,
        "objective created from war plan",
        ["warPlan found, posture=" + posture],
        0.5,
        [],
      );
    }

    // ── 4. 评估生命周期 ──
    const lifecycleInput = buildLifecycleAssessmentInput(
      objectiveRecord,
      plan,
      tick,
    );
    const lifecycleResult = assessObjectiveLifecycle(lifecycleInput);

    if (lifecycleResult.shouldTransition) {
      if (canTransitionObjective(objectiveRecord.state, lifecycleResult.newState)) {
        objectiveRecord.state = lifecycleResult.newState;
        objectiveRecord.lastExecutedTick = tick;
        if (lifecycleResult.newState === "ABORTED") {
          objectiveRecord.abortSignal = lifecycleResult.reason;
        } else if (lifecycleResult.newState === "COMPLETED") {
          objectiveRecord.completionReason = lifecycleResult.reason;
        }
      }
    }

    // 终态 Objective 不产出决策
    if (isObjectiveTerminal(objectiveRecord.state)) {
      cleanupTerminalObjectives(g, tick);
      return;
    }

    // 非活跃 Objective 不产出决策（等待 squad 就绪）
    if (!isObjectiveActive(objectiveRecord.state)) {
      g.tacticalLastRunTick = tick;
      return;
    }

    // ── 5. 构建 TacticalSnapshot ──
    const squad = buildSquadPlan(plan, tick);
    if (!squad) {
      // 无编队成员 → 无法构建 snapshot
      g.tacticalLastRunTick = tick;
      return;
    }

    const objective = buildTacticalObjective(plan, posture, operationAborted, expiry, tick);
    const snapshot = buildTacticalSnapshot(squad, objective, plan, tick);

    // ── 6. 调用纯函数评估战术动作 ──
    const decision = evaluateTacticalAction(snapshot);
    g.tacticalDecisions!.push(decision);

    // ── 7. 映射为 RoleActionIntent 并写入缓存 ──
    const intent = mapDecisionToRoleIntent(decision);
    for (const member of squad.members) {
      g.tacticalRoleIntents!.set(member.name, intent);
    }

    // ── 8. 止损信号处理 ──
    //     evaluateTacticalAction 在 newState=ABORTED 时可能附带止损信号
    //     此处从 snapshot 提取（checkAbortConditions 在 domain 内已执行）
    if (decision.newState === "ABORTED") {
      const abortSignal = extractAbortSignal(snapshot, decision, tick);
      if (abortSignal) {
        g.tacticalAbortSignals!.push(abortSignal);
        // tacticalAbortSignals 供 recovery-execution-system 消费
        // 不直接写 warAbortSignals（A5.3.1 架构守卫：只有 recovery-execution-system / war-planner 可写）
        // recovery-execution-system 会读取 tacticalAbortSignals 并自行转换
      }
    }

    // ── 9. 增援需求提交（ReinforcementDemand → SpawnManager） ──
    const shortage = detectForceShortage(squad, plan);
    if (shortage) {
      submitReinforcementDemand(shortage, plan, tick);
    }

    // ── 9b. 补给需求提交（SupplyDemand → Logistics） ──
    const supplyDemand = detectSupplyDemand(squad, plan, tick);
    if (supplyDemand) {
      g.tacticalSupplyDemands!.push(supplyDemand);
    }

    // ── 10. DecisionTrace 记录 ──
    recordTacticalDecision(decision, objectiveRecord, snapshot, tick);

    // ── 11. 更新 Objective Record ──
    objectiveRecord.lastExecutedTick = tick;
    // 同步 TacticalState（来自 decision）
    // objectiveRecord 不存储 TacticalState（那是 Squad 级的），
    // 但存储 decision 的 newState 供下轮生命周期评估

    g.tacticalLastRunTick = tick;
  },
};

// ═══════════════════════════════════════════════════════════
// §3. TacticalObjective 构建
// ═══════════════════════════════════════════════════════════

/**
 * 从 WarPlan 派生 TacticalObjective。

 * Operational 层决定 WHAT（打哪个房），Tactical 层投影为 HOW 的目标。
 */
function buildTacticalObjective(
  plan: NonNullable<KernelMemory["warPlan"]>,
  posture: string,
  operationAborted: boolean,
  expiry: number,
  tick: number,
): TacticalObjective {
  const authorization: TacticalAuthorization = {
    state: "AUTHORIZED",
    operationId: `war-${plan.targetRoom}`,
    warPosture: posture,
    targetRoom: plan.targetRoom,
    expiry,
    operationAborted,
    reason: "authorized by war plan",
  };

  return {
    objectiveId: `tac-${plan.targetRoom}-${plan.since}`,
    operationId: `war-${plan.targetRoom}`,
    objectiveType: "ENGAGE_ENEMY",
    targetId: plan.targetRoom,
    targetType: "room",
    targetScope: "OPERATIONAL",
    authorization,
    priority: 50,
    constraints: {
      maxCpuPerTick: 5,
      maxEnergyBudget: 10000,
      maxDuration: CONFIG.war.planTimeout,
      minIntelConfidence: 0.2,
      allowBoost: true,
      allowPursuit: false,
      maxPursuitDistance: 0,
    },
    deadline: expiry,
    abortConditions: [],
    evidence: [`objective derived from war plan at tick ${tick}`],
    tick,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. SquadPlan 构建
// ═══════════════════════════════════════════════════════════

/**
 * 从 warPlan + globalCache.squadIndex 构建 SquadPlan。

 * 使用 querySquad 获取编队成员，构建纯函数可消费的快照。
 */
function buildSquadPlan(
  plan: NonNullable<KernelMemory["warPlan"]>,
  tick: number,
): SquadPlan | null {
  const squadEntries = querySquad({
    home: plan.sponsor,
    remoteTarget: plan.targetRoom,
  });

  if (squadEntries.length === 0) return null;

  // 过滤出 attacker / healer（PB 野采编队跳过——mission="powerBank"）
  const combatEntries = squadEntries.filter(
    e => (e.role === "attacker" || e.role === "healer") && e.mission !== "powerBank",
  );

  if (combatEntries.length === 0) return null;

  const members: SquadMemberSnapshot[] = [];
  const roles = new Map<string, string>();

  for (const entry of combatEntries) {
    const creep = Game.creeps[entry.name];
    if (!creep) continue;

    const capability = buildCreepCapability(creep);
    members.push({
      name: entry.name,
      role: entry.role,
      pos: creep.pos.y * 50 + creep.pos.x,
      room: creep.pos.roomName,
      hits: creep.hits,
      hitsMax: creep.hitsMax,
      boosted: entry.boosted,
      ticksToLive: creep.ticksToLive,
      capability,
    });
    roles.set(entry.name, entry.role);
  }

  if (members.length === 0) return null;

  const a5 = plan.a5ForceReq;
  const healerCount = a5 ? a5.healer : Math.ceil(plan.squadSize * CONFIG.war.healerSquadRatio);

  return {
    squadId: `squad-${plan.sponsor}-${plan.targetRoom}`,
    operationId: `war-${plan.targetRoom}`,
    objectiveId: `tac-${plan.targetRoom}-${plan.since}`,
    members,
    roles,
    formation: "CLUSTER" as FormationType,
    engagementPolicy: {
      engageRange: 3,
      focusTargetId: undefined,
      minimumHpThreshold: 50,
      retreatThreshold: CONFIG.war.retreatRatio,
      regroupThreshold: CONFIG.war.waveRegroupRatio,
      healerRequired: healerCount > 0,
      enemyCapability: {
        totalAttack: 0,
        totalRangedAttack: 0,
        totalHeal: 0,
        totalRangedHeal: 0,
        totalDismantle: 0,
        totalClaim: 0,
        totalEffectiveHP: 0,
        avgMobility: 0,
        totalSupport: 0,
        totalToughParts: 0,
        boostedCount: 0,
        maxBoostTier: 0,
        creepCount: 0,
      },
      terrainRisk: 0.5,
      confidence: 0.5,
    },
    retreatPolicy: {
      retreatRoom: plan.sponsor,
      threshold: CONFIG.war.retreatRatio,
      minRetreatQuality: "POOR",
      allowRearguard: false,
    },
    regroupPolicy: {
      regroupRoom: plan.sponsor,
      regroupPos: 25 * 50 + 25,
      memberRatioThreshold: CONFIG.war.waveRegroupRatio,
      timeoutTicks: 500,
    },
    constraints: {
      maxCpuPerTick: 5,
      maxEnergyBudget: 10000,
      maxDuration: CONFIG.war.planTimeout,
      minIntelConfidence: 0.2,
      allowBoost: true,
      allowPursuit: false,
      maxPursuitDistance: 0,
    },
    state: deriveTacticalStateFromPhase(plan.phase ?? "build"),
    createdTick: plan.since,
  };
}

/** 从 warPlan phase 推导初始 TacticalState。 */
function deriveTacticalStateFromPhase(phase: string): TacticalState {
  if (phase === "build") return "FORMING";
  if (phase === "advance") return "MOVING";
  return "FORMING";
}

// ═══════════════════════════════════════════════════════════
// §5. TacticalSnapshot 构建
// ═══════════════════════════════════════════════════════════

/**
 * 从 Runtime 数据构建 TacticalSnapshot。
 */
function buildTacticalSnapshot(
  squad: SquadPlan,
  objective: TacticalObjective,
  plan: NonNullable<KernelMemory["warPlan"]>,
  tick: number,
): TacticalSnapshot {
  // 采集敌方单位
  const enemies = collectEnemies(plan.targetRoom, tick);

  // 采集敌方建筑
  const enemyStructures = collectEnemyStructures(plan.targetRoom, tick);

  // 地形上下文（简化——使用默认值）
  const terrain: TerrainContext = {
    roomName: plan.targetRoom,
    terrainType: "UNKNOWN",
    walkability: "UNKNOWN",
    openTileRatio: 0.5,
    wallDensity: 0.5,
    chokepoints: [],
    corridors: [],
    rampartCoverage: "UNKNOWN",
    towerCoverage: "UNKNOWN",
    coreExposure: 0.5,
    retreatQuality: "UNKNOWN",
    mobilityModifier: 1.0,
    tick,
  };

  const terrainModifier: EffectiveCombatModifier = {
    mobilityModifier: 1.0,
    towerDamageFactor: 1.0,
    retreatDifficulty: 1.0,
    approachFactor: 1.0,
  };

  // 情报置信度（简化——基于 intel 新鲜度）
  const sponsorIntel = Memory.rooms[plan.sponsor]?.intel?.[plan.targetRoom];
  const intelAge = sponsorIntel?.lastSeen !== undefined ? tick - sponsorIntel.lastSeen : Infinity;
  const confidenceVal = intelAge <= 500 ? 0.8 : intelAge <= 2000 ? 0.5 : intelAge <= 10000 ? 0.2 : 0.05;
  const confidence: MultiDimensionalConfidence = {
    factConfidence: confidenceVal,
    combatConfidence: confidenceVal,
    intentConfidence: confidenceVal,
    terrainConfidence: 0.5,
    intelConfidence: confidenceVal,
    overallConfidence: confidenceVal,
  };

  // 我方聚合能力
  const memberCaps = squad.members.map(m => m.capability);
  const ourCapability: AggregateCapability = {
    totalAttack: memberCaps.reduce((s, c) => s + c.attack, 0),
    totalRangedAttack: memberCaps.reduce((s, c) => s + c.rangedAttack, 0),
    totalHeal: memberCaps.reduce((s, c) => s + c.heal, 0),
    totalRangedHeal: memberCaps.reduce((s, c) => s + c.rangedHeal, 0),
    totalDismantle: memberCaps.reduce((s, c) => s + c.dismantle, 0),
    totalClaim: memberCaps.reduce((s, c) => s + c.claim, 0),
    totalEffectiveHP: memberCaps.reduce((s, c) => s + c.effectiveHP, 0),
    avgMobility: memberCaps.length > 0 ? memberCaps.reduce((s, c) => s + c.mobility, 0) / memberCaps.length : 0,
    totalSupport: memberCaps.reduce((s, c) => s + c.support, 0),
    totalToughParts: memberCaps.reduce((s, c) => s + c.toughParts, 0),
    boostedCount: memberCaps.filter(c => c.boosted).length,
    maxBoostTier: memberCaps.reduce<0 | 1 | 2 | 3>((m, c) => c.maxBoostTier > m ? c.maxBoostTier : m, 0),
    creepCount: memberCaps.length,
  };

  const ourPower = {
    burstDamage: ourCapability.totalAttack + ourCapability.totalRangedAttack,
    effectiveHP: ourCapability.totalEffectiveHP,
    healOutput: ourCapability.totalHeal,
    dismantlePower: ourCapability.totalDismantle,
  };

  return {
    tick,
    squad,
    objective,
    enemies,
    enemyStructures,
    terrain,
    terrainModifier,
    confidence,
    ourCapability,
    ourPower,
  };
}

// ═══════════════════════════════════════════════════════════
// §6. 辅助：Creep 能力构建
// ═══════════════════════════════════════════════════════════

/** 从 Creep body 构建战斗能力快照。 */
function buildCreepCapability(creep: Creep): CombatCapability {
  let attack = 0;
  let rangedAttack = 0;
  let heal = 0;
  let rangedHeal = 0;
  let dismantle = 0;
  let claim = 0;
  let support = 0;
  let toughParts = 0;
  const totalParts = creep.body.length;
  let activeParts = 0;
  let maxBoostTier: 0 | 1 | 2 | 3 = 0;
  const boosted = creep.body.some(p => p.boost !== undefined);

  for (const part of creep.body) {
    if (part.type === TOUGH) toughParts++;
    activeParts++;
    const tier = part.boost ? 3 : 0;
    if (tier > maxBoostTier) maxBoostTier = tier;
    const mult = part.boost ? 4 : 1;
    switch (part.type) {
      case ATTACK:
        attack += 30 * mult;
        break;
      case RANGED_ATTACK:
        rangedAttack += 10 * mult;
        break;
      case HEAL:
        heal += 12 * mult;
        rangedHeal += 4 * mult;
        break;
      case WORK:
        dismantle += 50 * mult;
        support += 1;
        break;
      case CLAIM:
        claim += mult;
        break;
    }
  }

  const effectiveHP = creep.hits;
  const moveParts = creep.body.filter(p => p.type === MOVE).length;
  const bodyWeight = creep.body.filter(p => p.type !== MOVE && p.type !== CARRY).length;
  const mobility = bodyWeight > 0 ? moveParts / bodyWeight : moveParts > 0 ? 1 : 0;

  return {
    attack,
    rangedAttack,
    heal,
    rangedHeal,
    dismantle,
    claim,
    effectiveHP,
    mobility,
    support,
    toughParts,
    boosted,
    maxBoostTier,
    totalParts,
    activeParts,
  };
}

// ═══════════════════════════════════════════════════════════
// §7. 辅助：敌方单位/建筑采集
// ═══════════════════════════════════════════════════════════

/** 从目标房视野采集敌方 Creep 快照。 */
function collectEnemies(targetRoom: string, tick: number): EnemySnapshot[] {
  const room = Game.rooms[targetRoom];
  if (!room) return [];

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  return hostiles.map(c => ({
    id: c.id,
    name: c.name,
    pos: c.pos.y * 50 + c.pos.x,
    room: c.pos.roomName,
    hits: c.hits,
    hitsMax: c.hitsMax,
    capability: buildCreepCapability(c),
    lastSeenTick: tick,
    isNpc: c.owner.username === "Invader" || c.owner.username === "Source Keeper",
  }));
}

/** 从目标房视野采集敌方建筑快照。 */
function collectEnemyStructures(targetRoom: string, _tick: number): EnemyStructureSnapshot[] {
  const room = Game.rooms[targetRoom];
  if (!room) return [];

  const structs = room.find(FIND_HOSTILE_STRUCTURES);
  return structs.map(s => ({
    id: s.id,
    structureType: s.structureType,
    pos: s.pos.y * 50 + s.pos.x,
    room: s.pos.roomName,
    hits: s.hits,
    hitsMax: s.hitsMax,
    valueTier: structureValueTier(s.structureType),
  }));
}

/** 敌方结构价值分档（与 attacker.ts structureValueTier 对齐）。 */
function structureValueTier(t: StructureConstant): number {
  switch (t) {
    case STRUCTURE_SPAWN:
    case STRUCTURE_TOWER:
      return 4;
    case STRUCTURE_STORAGE:
      return 3;
    case STRUCTURE_EXTENSION:
      return 2;
    default:
      return 1;
  }
}

// ═══════════════════════════════════════════════════════════
// §8. 生命周期辅助
// ═══════════════════════════════════════════════════════════

/** 查找活跃（非终态）的 TacticalObjective。 */
function findActiveObjective(
  g: GlobalCache & TacticalRuntimeCache,
): TacticalObjectiveRecord | null {
  const table = g.tacticalObjectives;
  if (!table || table.size === 0) return null;
  for (const [, record] of table) {
    if (!isObjectiveTerminal(record.state)) return record;
  }
  return null;
}

/** 创建 ObjectiveRecord。 */
function createObjectiveRecord(
  objective: TacticalObjective,
  tick: number,
): TacticalObjectiveRecord {
  return {
    objectiveId: objective.objectiveId,
    operationId: objective.operationId,
    squadId: `squad-${objective.authorization.targetRoom}`,
    targetRoom: objective.authorization.targetRoom,
    state: "CREATED",
    createdTick: tick,
    lastExecutedTick: tick,
  };
}

/** 构建生命周期评估输入。 */
function buildLifecycleAssessmentInput(
  record: TacticalObjectiveRecord,
  plan: NonNullable<KernelMemory["warPlan"]>,
  tick: number,
): LifecycleAssessmentInput {
  const posture = Memory.kernel?.strategy?.posture ?? "develop";
  const isOffensive = true; // war plan 目标都是进攻性的
  const authCheck = validateAuthorization(
    {
      state: "AUTHORIZED",
      operationId: record.operationId,
      warPosture: posture,
      targetRoom: record.targetRoom,
      expiry: tick + CONFIG.war.planTimeout,
      operationAborted: false,
      reason: "check",
    },
    tick,
    isOffensive,
  );

  const squadEntries = querySquad({
    home: plan.sponsor,
    remoteTarget: plan.targetRoom,
  });
  const combatEntries = squadEntries.filter(
    e => (e.role === "attacker" || e.role === "healer") && e.mission !== "powerBank",
  );
  const squadValid = combatEntries.length > 0;

  const targetRoom = Game.rooms[plan.targetRoom];
  const targetExists = targetRoom !== undefined;
  const targetInScope = record.targetRoom === plan.targetRoom;

  return {
    record,
    currentTick: tick,
    authorizationValid: authCheck.valid,
    targetExists,
    targetInScope,
    squadValid,
    decisionState: "ENGAGING" as TacticalState, // 默认活跃态
    hasAbortSignal: false,
  };
}

/** 清理终态 Objective 记录（防止表膨胀）。 */
function cleanupTerminalObjectives(
  g: GlobalCache & TacticalRuntimeCache,
  tick: number,
): void {
  const table = g.tacticalObjectives;
  if (!table || table.size === 0) return;
  // 保留最近 1000 tick 内进入终态的记录（供 Decision Trace 追溯）
  for (const [id, record] of table) {
    if (isObjectiveTerminal(record.state) && tick - record.lastExecutedTick > 1000) {
      table.delete(id);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// §9. 止损信号提取
// ═══════════════════════════════════════════════════════════

/** 从决策结果提取止损信号。 */
function extractAbortSignal(
  snapshot: TacticalSnapshot,
  decision: TacticalDecision,
  tick: number,
): TacticalAbortSignal | null {
  if (decision.newState !== "ABORTED") return null;

  const { squad, objective } = snapshot;
  const reason = decision.reason.includes("authorization")
    ? "AUTHORIZATION_REVOKED"
    : decision.reason.includes("abort")
      ? "CASUALTY_EXCEEDED"
      : decision.reason.includes("intel")
        ? "INTEL_STALE"
        : "OBJECTIVE_UNACHIEVABLE";

  return {
    signalId: `tac-abort:${squad.squadId}:${tick}`,
    operationId: objective.operationId,
    objectiveId: objective.objectiveId,
    squadId: squad.squadId,
    reason: reason as TacticalAbortSignal["reason"],
    tick,
    detail: decision.reason,
    evidence: decision.evidence,
  };
}

// ═══════════════════════════════════════════════════════════
// §10. 增援需求提交
// ═══════════════════════════════════════════════════════════

/** 检测编队缺人并提交增援请求到 spawn queue。 */
function detectForceShortage(
  squad: SquadPlan,
  plan: NonNullable<KernelMemory["warPlan"]>,
): ForceShortage | null {
  const a5 = plan.a5ForceReq;
  const attackerTarget = a5 ? a5.attacker : plan.squadSize;
  const healerTarget = a5 ? a5.healer : Math.ceil(plan.squadSize * CONFIG.war.healerSquadRatio);

  const aliveAttackers = squad.members.filter(m => m.role === "attacker" && m.hits > 0).length;
  const aliveHealers = squad.members.filter(m => m.role === "healer" && m.hits > 0).length;

  // attacker 缺口
  if (aliveAttackers < attackerTarget) {
    return {
      squadId: squad.squadId,
      operationId: squad.operationId,
      role: "attacker",
      count: attackerTarget - aliveAttackers,
      urgency: 50,
      reason: `attacker shortage: ${aliveAttackers}/${attackerTarget}`,
    };
  }

  // healer 缺口
  if (aliveHealers < healerTarget) {
    return {
      squadId: squad.squadId,
      operationId: squad.operationId,
      role: "healer",
      count: healerTarget - aliveHealers,
      urgency: 50,
      reason: `healer shortage: ${aliveHealers}/${healerTarget}`,
    };
  }

  return null;
}

/** 提交增援需求到 spawn queue（幂等）。 */
function submitReinforcementDemand(
  shortage: ForceShortage,
  plan: NonNullable<KernelMemory["warPlan"]>,
  tick: number,
): void {
  const g = globalCache() as unknown as GlobalCache & TacticalRuntimeCache;
  const dedupKey = `${shortage.squadId}:${shortage.role}:${tick}`;
  if (g.tacticalReinforcementDemands?.has(dedupKey)) return;
  g.tacticalReinforcementDemands!.add(dedupKey);

  // 增援需求实际由 war-planner 的 submitSquadRequest 处理（它每 interval 检查编队缺口）。
  // 此处只记录 Demand 信号到 globalCache 供 Decision Trace 追踪。
  // 不重复提交 spawn 请求——war-planner 已有幂等的 submitSquadRequest 机制。
  // 这样避免双写 spawn queue（Tactical → Spawn 边界：只声明需求，war-planner 执行孵化）。

  // 但记录事件供追踪
  recordEvent(EventKind.WarPlanCreated, plan.targetRoom, [
    shortage.urgency,
    shortage.count,
  ]);
}

// ═══════════════════════════════════════════════════════════
// §10b. 补给需求检测（SupplyDemand → Logistics）
// ═══════════════════════════════════════════════════════════

/**
 * 检测编队补给需求（能量）并产出 SupplyDemand。

 * 战术编队在 advance/engage 相位需要持续能量补给（boost 等）。
 * SupplyDemand 写入 globalCache.tacticalSupplyDemands，
 * logistics-planner 消费并注入 DemandNode 管线。

 * 只在 advance 相位产出（build 相位编队在 home，不需要远征补给）。
 */
function detectSupplyDemand(
  squad: SquadPlan,
  plan: NonNullable<KernelMemory["warPlan"]>,
  tick: number,
): SupplyDemand | null {
  // 只在 advance 相位产出补给需求
  if (plan.phase !== "advance") return null;

  // 检查编队成员是否有 boosted creep（boost 消耗资源）
  const hasBoosted = squad.members.some(m => m.boosted);
  if (!hasBoosted) return null; // 无 boosted creep → 无额外补给需求

  // 基础能量补给需求（boost 补给 + 编队运转能量）
  const energyPerMember = 200; // 估算：每个 boosted creep 需要 200 energy 补给
  const totalEnergy = squad.members.length * energyPerMember;

  return {
    squadId: squad.squadId,
    operationId: squad.operationId,
    resource: "energy",
    amount: totalEnergy,
    targetRoom: plan.sponsor, // 补给送到 sponsor 房（编队从 home 出发）
    priority: 1, // P1：战争物资高优先级
    tick,
    reason: `tactical supply for ${squad.members.length} members (boosted)`,
  };
}

// ═══════════════════════════════════════════════════════════
// §11. DecisionTrace 记录
// ═══════════════════════════════════════════════════════════

/** 记录战术决策事件到 event-log。 */
function recordTacticalDecision(
  decision: TacticalDecision,
  record: TacticalObjectiveRecord,
  snapshot: TacticalSnapshot,
  tick: number,
): void {
  const event = mapDecisionToEvent(decision);
  recordTacticalEvent(
    event,
    record.operationId,
    record.objectiveId,
    record.squadId,
    tick,
    decision.reason,
    decision.evidence,
    snapshot.confidence.overallConfidence,
    decision.rejectedAlternatives,
  );
}

/** 将 TacticalDecision 的新状态映射为事件类型。 */
function mapDecisionToEvent(decision: TacticalDecision): TacticalDecisionEvent {
  switch (decision.newState) {
    case "MOVING":
      return "TACTICAL_STATE_CHANGED";
    case "POSITIONING":
      return "FORMATION_SELECTED";
    case "ENGAGING":
      return "ENGAGEMENT_DECIDED";
    case "DISENGAGING":
    case "RETREATING":
      return "RETREAT_DECIDED";
    case "REGROUPING":
      return "REGROUP_DECIDED";
    case "ABORTED":
      return "TACTICAL_ABORTED";
    case "COMPLETED":
      return "TACTICAL_STATE_CHANGED";
    default:
      return "TACTICAL_STATE_CHANGED";
  }
}

/** 记录战术事件（写入 event-log + console）。 */
function recordTacticalEvent(
  event: TacticalDecisionEvent,
  operationId: string,
  objectiveId: string,
  squadId: string | undefined,
  tick: number,
  reason: string,
  evidence: string[],
  confidence: number,
  rejected: readonly { action: string; reason: string }[],
): void {
  // 写入 event buffer（供 telemetry-collector flush 到 segment）
  // 使用 WarPlanCreated 作为复用事件类型（暂无专用 TacticalEvent 枚举）
  // 后续可扩展 EventKind 枚举
  recordEvent(EventKind.WarPlanCreated, objectiveId, [
    EVENT_CODE_MAP[event] ?? 0,
    Math.floor(confidence * 100),
  ]);

  // console 输出（可观测性）
  if (event === "TACTICAL_ABORTED" || event === "RETREAT_DECIDED") {
    console.log(
      `[${tick}] tactical: ${event} op=${operationId}` +
      ` squad=${squadId ?? "?"}` +
      ` reason="${reason}"` +
      ` conf=${confidence.toFixed(2)}` +
      ` evidence=${evidence.slice(0, 3).join("; ")}`,
    );
  }
}

/** 事件类型 → 稳定整数编码（供 event-log d[0] 字段）。 */
const EVENT_CODE_MAP: Record<TacticalDecisionEvent, number> = {
  TACTICAL_OBJECTIVE_ACCEPTED: 0,
  TACTICAL_STATE_CHANGED: 1,
  FORMATION_SELECTED: 2,
  ENGAGEMENT_DECIDED: 3,
  TARGET_SWITCHED: 4,
  RETREAT_DECIDED: 5,
  REGROUP_DECIDED: 6,
  TACTICAL_ABORTED: 7,
};

// ═══════════════════════════════════════════════════════════
// §12. 公共 API（供角色层查询）
// ═══════════════════════════════════════════════════════════

/**
 * 查询 creep 的战术指令（供角色层消费）。

 * 角色层（attacker/healer）在 RolePolicy 的 acquire/work 候选中调用此函数，
 * 获取当前 tick 的战术指令（移动方向 + 战斗目标）。

 * 如果返回 null，角色回退到原有行为（Legacy 兼容）。
 */
export function getTacticalIntent(creepName: string): RoleActionIntent | null {
  const g = globalCache() as unknown as GlobalCache & TacticalRuntimeCache;
  const intents = g.tacticalRoleIntents;
  if (!intents) return null;
  return intents.get(creepName) ?? null;
}

/**
 * 查询是否有活跃的 TacticalObjective。
 */
export function hasActiveTacticalObjective(): boolean {
  const g = globalCache() as unknown as GlobalCache & TacticalRuntimeCache;
  const table = g.tacticalObjectives;
  if (!table || table.size === 0) return false;
  for (const [, record] of table) {
    if (isObjectiveActive(record.state)) return true;
  }
  return false;
}
