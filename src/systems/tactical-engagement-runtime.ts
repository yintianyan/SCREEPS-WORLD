/**
 * Tactical Engagement Runtime — A5.4.3 系统层薄壳。
 *
 * 合同锚点：A5.4.3 §16 Runtime Integration。
 *
 * 职责（薄壳——只采集和编排，不做决策）：
 *   1. 从 globalCache / Game / Memory 采集运行时状态
 *   2. 构建 FocusFireSnapshot（纯函数输入格式）
 *   3. 调用 domain 纯函数 planFocusFire() → FocusFirePlan
 *   4. 将 AttackIntent[] 写入 globalCache 供角色层消费
 *   5. FocusFirePlan 写入 globalCache 供 decision-trace 消费
 *   6. 上 tick Plan 保留用于状态机连续性
 *
 * 禁止：
 *   - 不做任何战术决策（决策由 domain 纯函数 planFocusFire 裁决）
 *   - 不直接调用 attack() / rangedAttack() / heal() / move() / spawnCreep()
 *   - 不修改 domain 层纯函数的输入/输出结构
 *   - 不修改 WarPosture / 不创建 Operation / 不创建 Strategic Target
 *
 * 频率：interval=3（低频——Focus Fire 不需要每 tick 重算，3 tick 间隔足够响应目标死亡/逃跑）
 * 优先级：P2（在 tactical-runtime 和 squad-movement 之后运行）
 * 阶段：main（在角色之前——先产出 AttackIntent 供角色消费）
 * 存储：heap only — global reset 可丢（下个周期重建）。
 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache, querySquad, type GlobalCache } from "../kernel/global-cache";
import { CONFIG } from "../config";
import {
  planFocusFire,
  buildTargetCandidate,
  type FocusFireSnapshot,
  type FocusFirePlan,
  type AttackIntent,
  type FocusFireMemberSnapshot,
  type TargetCandidate,
} from "../domain/tactical";
import type { CombatCapability } from "../domain/combat/capability";
import type { SquadPlan, TacticalState, TargetScope } from "../domain/tactical/types";
import { getSquadMovementIntent } from "./squad-movement-runtime";

// ═══════════════════════════════════════════════════════════
// §1. GlobalCache 扩展 — Tactical Engagement Runtime 状态
// ═══════════════════════════════════════════════════════════

/** Tactical Engagement Runtime 在 globalCache 上的扩展字段。 */
interface TacticalEngagementCache {
  /** 当前 tick 的 FocusFirePlan（供 decision-trace / 调试消费）。key = squadId。 */
  focusFirePlans?: Map<string, FocusFirePlan>;
  /** 当前 tick 的 AttackIntent 映射。key = creepName。 */
  attackIntents?: Map<string, AttackIntent>;
  /** 上 tick 的 FocusFirePlan（状态机连续性用）。key = squadId。 */
  prevFocusFirePlans?: Map<string, FocusFirePlan>;
  /** 上次运行 tick。 */
  tacticalEngagementLastRunTick?: number;
}

// ═══════════════════════════════════════════════════════════
// §2. 系统定义
// ═══════════════════════════════════════════════════════════

export const tacticalEngagementSystem: System = {
  name: "tactical-engagement",
  priority: 2 as Priority,
  interval: 3,
  phase: "main",

  run(ctx: TickContext): void {
    const g = globalCache() as unknown as GlobalCache & TacticalEngagementCache;
    const tick = ctx.tick;

    // ── 1. 初始化缓存 ──
    if (!g.focusFirePlans) g.focusFirePlans = new Map();
    if (!g.attackIntents) g.attackIntents = new Map();
    if (!g.prevFocusFirePlans) g.prevFocusFirePlans = new Map();

    // 每 tick 重置 per-tick 数据
    g.focusFirePlans.clear();
    g.attackIntents.clear();

    // ── 2. 无 warPlan 时跳过 ──
    const plan = Memory.kernel?.warPlan;
    if (!plan) {
      // 保存当前为 prev（下 tick 可用于连续性）
      g.tacticalEngagementLastRunTick = tick;
      return;
    }

    // ── 3. 构建 SquadPlan（复用 squad-movement 的构建逻辑） ──
    const squadPlan = buildSquadPlanFromWarPlan(plan, tick);
    if (!squadPlan) {
      g.tacticalEngagementLastRunTick = tick;
      return;
    }

    // ── 4. 采集成员运行时数据 ──
    const members = collectMemberSnapshots(squadPlan);
    if (members.length === 0) {
      g.tacticalEngagementLastRunTick = tick;
      return;
    }

    // ── 5. 采集目标候选 ──
    const targetRoom = plan.targetRoom;
    const candidates = collectTargetCandidates(targetRoom, squadPlan);

    // ── 6. 获取 SquadMovementIntent（A5.4.2 产出） ──
    const movementIntent = getSquadMovementIntent(squadPlan.squadId);
    const cohesionStatus = movementIntent?.cohesion.status ?? "INTACT";
    const anchorPos = movementIntent?.anchor.pos ?? 25 * 50 + 25;
    const anchorRoom = movementIntent?.anchor.room ?? targetRoom;

    // ── 7. 推导当前 TacticalState ──
    const tacticalState = deriveTacticalState(squadPlan, plan.phase ?? "build");

    // ── 8. 推导 WarPosture / TargetScope ──
    const warPosture = Memory.kernel?.strategy?.posture ?? "develop";
    const targetScope: TargetScope = "LOCAL";
    const authorizedTargetRoom = targetRoom;

    // ── 9. 获取上 tick 的 Plan（状态机连续性） ──
    const prevPlan = g.prevFocusFirePlans.get(squadPlan.squadId) ?? null;

    // ── 10. 构建 FocusFireSnapshot ──
    const snapshot: FocusFireSnapshot = {
      tick,
      squadId: squadPlan.squadId,
      objectiveId: squadPlan.objectiveId,
      anchorPos,
      anchorRoom,
      tacticalState,
      targetScope,
      authorizedTargetRoom,
      warPosture,
      candidates,
      members,
      prevPlan,
      cohesionStatus,
      inEngagementRange: candidates.some(c =>
        c.accessibility === "IN_MELEE_RANGE" ||
        c.accessibility === "IN_RANGED_RANGE" ||
        c.accessibility === "IN_ENGAGEMENT_RANGE",
      ),
    };

    // ── 11. 调用纯函数产出 FocusFirePlan ──
    const focusFirePlan = planFocusFire(snapshot);

    // ── 12. 写入缓存 ──
    g.focusFirePlans.set(squadPlan.squadId, focusFirePlan);
    g.prevFocusFirePlans.set(squadPlan.squadId, focusFirePlan);

    // 将 AttackIntent 写入 creep → intent 映射
    for (const intent of focusFirePlan.attackIntents) {
      g.attackIntents.set(intent.creepId, intent);
    }

    g.tacticalEngagementLastRunTick = tick;
  },
};

// ═══════════════════════════════════════════════════════════
// §3. SquadPlan 构建（简化版 — 复用 squad-movement 模式）
// ═══════════════════════════════════════════════════════════

function buildSquadPlanFromWarPlan(
  plan: NonNullable<KernelMemory["warPlan"]>,
  _tick: number,
): SquadPlan | null {
  const squadEntries = querySquad({
    home: plan.sponsor,
    remoteTarget: plan.targetRoom,
  });

  if (squadEntries.length === 0) return null;

  const combatEntries = squadEntries.filter(
    e => (e.role === "attacker" || e.role === "healer") && e.mission !== "powerBank",
  );

  if (combatEntries.length === 0) return null;

  // 简化构建 — 与 squad-movement-runtime 同型
  const members = combatEntries.map(entry => ({
    name: entry.name,
    role: entry.role,
    pos: 25 * 50 + 25,
    room: plan.sponsor,
    hits: 0,
    hitsMax: 0,
    boosted: entry.boosted,
    ticksToLive: 0,
    capability: {
      attack: 0, rangedAttack: 0, heal: 0, rangedHeal: 0,
      dismantle: 0, claim: 0, effectiveHP: 0, mobility: 0,
      support: 0, toughParts: 0, boosted: entry.boosted,
      maxBoostTier: 0 as 0 | 1 | 2 | 3, totalParts: 0, activeParts: 0,
    },
  }));

  const roles = new Map<string, string>();
  for (const m of members) roles.set(m.name, m.role);

  return {
    squadId: `squad-${plan.sponsor}-${plan.targetRoom}`,
    operationId: `war-${plan.targetRoom}`,
    objectiveId: `tac-${plan.targetRoom}-${plan.since}`,
    members,
    roles,
    formation: "CLUSTER" as const,
    engagementPolicy: {
      engageRange: 3,
      focusTargetId: undefined,
      minimumHpThreshold: 50,
      retreatThreshold: CONFIG.war.retreatRatio,
      regroupThreshold: CONFIG.war.waveRegroupRatio,
      healerRequired: true,
      enemyCapability: {
        totalAttack: 0, totalRangedAttack: 0, totalHeal: 0,
        totalRangedHeal: 0, totalDismantle: 0, totalClaim: 0,
        totalEffectiveHP: 0, avgMobility: 0, totalSupport: 0,
        totalToughParts: 0, boostedCount: 0, maxBoostTier: 0,
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

function deriveTacticalStateFromPhase(phase: string): TacticalState {
  if (phase === "build") return "FORMING";
  if (phase === "advance") return "MOVING";
  return "FORMING";
}

function deriveTacticalState(squad: SquadPlan, warPhase: string): TacticalState {
  // 如果 squad 已有 state 用 squad state
  if (squad.state === "ENGAGING" || squad.state === "POSITIONING") {
    return squad.state;
  }
  // 否则从 warPhase 推导
  if (warPhase === "advance") return "MOVING";
  return "FORMING";
}

// ═══════════════════════════════════════════════════════════
// §4. 成员快照采集 — 从 Game.creeps 构建含能力快照
// ═══════════════════════════════════════════════════════════

function collectMemberSnapshots(squad: SquadPlan): FocusFireMemberSnapshot[] {
  const result: FocusFireMemberSnapshot[] = [];

  for (const member of squad.members) {
    const creep = Game.creeps[member.name];
    if (!creep) {
      // Creep 不存在 — 标记为死亡（capability/hitsMax 全 0 因无 body 信息；
      // planFocusFire 会过滤 alive=false 的成员，0 值不影响决策）
      result.push({
        name: member.name,
        role: member.role,
        capability: member.capability,
        pos: member.pos,
        room: member.room,
        hits: 0,
        hitsMax: member.hitsMax,
        alive: false,
      });
      continue;
    }

    // 从 body 构建 CombatCapability（消费 A5.1 G2 — 不重新实现）
    const capability = buildCreepCapability(creep);

    result.push({
      name: member.name,
      role: member.role,
      capability,
      // pos 编码格式: x * 50 + y（与 buildTargetCandidate / chebyshevDist 一致）
      pos: creep.pos.x * 50 + creep.pos.y,
      room: creep.pos.roomName,
      hits: creep.hits,
      hitsMax: creep.hitsMax,
      alive: creep.hits > 0,
    });
  }

  return result;
}

/** 从 Creep body 构建 CombatCapability（与 tactical-runtime-system 同型）。 */
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
// §5. 目标候选采集 — 从 Game.rooms 采集敌方 creep
// ═══════════════════════════════════════════════════════════

function collectTargetCandidates(
  targetRoom: string,
  squad: SquadPlan,
): TargetCandidate[] {
  const room = Game.rooms[targetRoom];
  if (!room) return [];

  // 使用 getHostilesCached 模式 — per-tick per-room 共享缓存
  const hostiles = getHostilesCached(room);
  if (hostiles.length === 0) return [];

  // Squad Anchor 位置（从 movement intent 或 fallback 到 25,25）
  const anchorPos = 25 * 50 + 25;
  const anchorRoom = targetRoom;

  const candidates: TargetCandidate[] = [];

  for (const hostile of hostiles) {
    const capability = buildHostileCapability(hostile);
    const threatScore = estimateThreatScore(capability);

    candidates.push(
      buildTargetCandidate(
        hostile.id as string,
        hostile.pos.x * 50 + hostile.pos.y,
        hostile.pos.roomName,
        "", // role 从 capability 推断
        hostile.hits,
        hostile.hitsMax,
        capability,
        threatScore,
        anchorPos,
        anchorRoom,
        Game.time,
      ),
    );
  }

  return candidates;
}

/** 从 hostile creep body 构建 CombatCapability — 消费 G2 同型逻辑。 */
function buildHostileCapability(hostile: Creep): CombatCapability {
  let attack = 0;
  let rangedAttack = 0;
  let heal = 0;
  let rangedHeal = 0;
  let dismantle = 0;
  let claim = 0;
  let support = 0;
  let toughParts = 0;
  const totalParts = hostile.body.length;
  let activeParts = 0;
  let maxBoostTier: 0 | 1 | 2 | 3 = 0;
  const boosted = hostile.body.some(p => p.boost !== undefined);

  for (const part of hostile.body) {
    if (part.type === TOUGH) toughParts++;
    activeParts++;
    const tier = part.boost ? 3 : 0;
    if (tier > maxBoostTier) maxBoostTier = tier;
    const mult = part.boost ? 4 : 1;
    switch (part.type) {
      case ATTACK: attack += 30 * mult; break;
      case RANGED_ATTACK: rangedAttack += 10 * mult; break;
      case HEAL: heal += 12 * mult; rangedHeal += 4 * mult; break;
      case WORK: dismantle += 50 * mult; support += 1; break;
      case CLAIM: claim += mult; break;
    }
  }

  const effectiveHP = hostile.hits;
  const moveParts = hostile.body.filter(p => p.type === MOVE).length;
  const bodyWeight = hostile.body.filter(p => p.type !== MOVE && p.type !== CARRY).length;
  const mobility = bodyWeight > 0 ? moveParts / bodyWeight : moveParts > 0 ? 1 : 0;

  return {
    attack, rangedAttack, heal, rangedHeal, dismantle, claim,
    effectiveHP, mobility, support, toughParts, boosted, maxBoostTier,
    totalParts, activeParts,
  };
}

/** 粗略威胁评分（消费 G1 结果而非重新计算完整 ThreatAssessment）。 */
function estimateThreatScore(cap: CombatCapability): number {
  return cap.attack + cap.rangedAttack + cap.heal * 0.5 + cap.toughParts * 10;
}

/** per-tick per-room hostile creep 共享缓存。 */
function getHostilesCached(room: Room): Creep[] {
  const g = globalCache() as { __tacticalHostiles?: Record<string, { tick: number; list: Creep[] }> };
  if (!g.__tacticalHostiles) g.__tacticalHostiles = {};
  const cached = g.__tacticalHostiles[room.name];
  if (cached && cached.tick === Game.time) return cached.list;
  const list = room.find(FIND_HOSTILE_CREEPS) as Creep[];
  g.__tacticalHostiles[room.name] = { tick: Game.time, list };
  return list;
}

// ═══════════════════════════════════════════════════════════
// §6. 公共 API（供角色层查询）
// ═══════════════════════════════════════════════════════════

/**
 * 查询 creep 的攻击意图（供角色层消费）。
 *
 * 角色层（attacker）在 RolePolicy 的 acquire/work 候选中调用此函数，
 * 获取当前 tick 的攻击指令（目标 ID + 攻击类型 + 优先级）。
 *
 * 如果返回 null，角色回退到原有行为（Legacy 兼容）。
 */
export function getAttackIntent(creepName: string): AttackIntent | null {
  const g = globalCache() as unknown as GlobalCache & TacticalEngagementCache;
  const intents = g.attackIntents;
  if (!intents) return null;
  return intents.get(creepName) ?? null;
}

/**
 * 查询编队的 FocusFirePlan（供 decision-trace / 调试消费）。
 */
export function getFocusFirePlan(squadId: string): FocusFirePlan | null {
  const g = globalCache() as unknown as GlobalCache & TacticalEngagementCache;
  const plans = g.focusFirePlans;
  if (!plans) return null;
  return plans.get(squadId) ?? null;
}
