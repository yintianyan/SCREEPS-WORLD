/** Combat Micro Runtime */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache, querySquad, type GlobalCache } from "../kernel/global-cache";
import {
  planCombatMicro,
  deriveBodyAwareState,
  type MicroSnapshot,
  type MicroPlan,
  type CombatMovementDecision,
  type MicroMemberSnapshot,
  type MicroEnemySnapshot,
} from "../domain/tactical";
import type { CombatCapability } from "../domain/combat/capability";
import type { TerrainContext, EffectiveCombatModifier } from "../domain/defense/terrain-context";
import type { CohesionMetric, FormationSlot, FormationAnchor } from "../domain/tactical";
import { getFocusFirePlan, getAttackIntent } from "./tactical-engagement-runtime";
import { getSquadMovementIntent } from "./squad-movement-runtime";

// ═══════════════════════════════════════════════════════════
// §1. GlobalCache 扩展 — Combat Micro Runtime 状态
// ═══════════════════════════════════════════════════════════

interface CombatMicroCache {
  /** 当前 tick 的 MicroPlan（诊断观测用）。key = squadId。 */
  microPlans?: Map<string, MicroPlan>;
  /** 当前 tick 的 CombatMovementDecision 映射。key = creepName。 */
  microDecisions?: Map<string, CombatMovementDecision>;
  /** 上 tick 的 MicroDecisions（用于连续性）。 */
  prevMicroDecisions?: Map<string, CombatMovementDecision>;
  /** TargetLock 状态（creepId → lockUntil tick）。 */
  targetLocks?: Map<string, number>;
  /** 上次运行 tick。 */
  combatMicroLastRunTick?: number;
}

// ═══════════════════════════════════════════════════════════
// §2. 系统定义
// ═══════════════════════════════════════════════════════════

export const combatMicroSystem: System = {
  name: "combat-micro",
  priority: 2 as Priority,
  interval: 3,
  phase: "main",

  run(ctx: TickContext): void {
    const g = globalCache() as unknown as GlobalCache & CombatMicroCache;
    const tick = ctx.tick;

    // ── 1. 初始化缓存 ──
    if (!g.microPlans) g.microPlans = new Map();
    if (!g.microDecisions) g.microDecisions = new Map();
    if (!g.prevMicroDecisions) g.prevMicroDecisions = new Map();
    if (!g.targetLocks) g.targetLocks = new Map();

    // 保存上 tick decisions 到 prev
    g.prevMicroDecisions.clear();
    for (const [k, v] of g.microDecisions) g.prevMicroDecisions.set(k, v);

    // 每 tick 重置 per-tick 数据
    g.microPlans.clear();
    g.microDecisions.clear();

    // GC targetLocks（清除过期 lock）
    for (const [k, lockTick] of g.targetLocks) {
      if (lockTick < tick) g.targetLocks.delete(k);
    }

    // ── 2. 无 warPlan 时跳过 ──
    const plan = Memory.kernel?.warPlan;
    if (!plan) {
      g.combatMicroLastRunTick = tick;
      return;
    }

    // ── 3. 构建 MicroSnapshot ──
    const snapshot = buildMicroSnapshot(plan, tick, g);
    if (!snapshot) {
      g.combatMicroLastRunTick = tick;
      return;
    }

    // ── 4. 调用纯函数产出 MicroPlan ──
    const microPlan = planCombatMicro(snapshot);

    // ── 5. 写入缓存 ──
    g.microPlans.set(snapshot.squadId, microPlan);

    // 将 CombatMovementDecision 写入 creep → decision 映射
    for (const decision of microPlan.decisions) {
      g.microDecisions.set(decision.creepId, decision);

      // 更新 targetLocks
      if (decision.action === "ATTACK_RANGE" && decision.targetId) {
        // 保持现有 lock（由 planCombatMicro 内部管理）
      }
    }

    g.combatMicroLastRunTick = tick;
  },
};

// ═══════════════════════════════════════════════════════════
// §3. MicroSnapshot 构建
// ═══════════════════════════════════════════════════════════

function buildMicroSnapshot(
  warPlan: NonNullable<KernelMemory["warPlan"]>,
  tick: number,
  g: CombatMicroCache,
): MicroSnapshot | null {
  // 从 warPlan 构建 squad
  const squadEntries = querySquad({
    home: warPlan.sponsor,
    remoteTarget: warPlan.targetRoom,
  });
  if (squadEntries.length === 0) return null;

  const combatEntries = squadEntries.filter(
    e => (e.role === "attacker" || e.role === "healer") && e.mission !== "powerBank",
  );
  if (combatEntries.length === 0) return null;

  // 采集成员快照
  const members: MicroMemberSnapshot[] = [];
  for (const entry of combatEntries) {
    const creep = Game.creeps[entry.name];
    if (!creep) {
      members.push({
        name: entry.name, role: entry.role, pos: 25 * 50 + 25,
        room: warPlan.sponsor, hits: 0, hitsMax: 0, fatigue: 0, alive: false,
        capability: emptyCapability(),
        bodyState: deriveBodyAwareState(emptyCapability(), entry.role, 0),
      });
      continue;
    }
    const capability = buildCreepCapability(creep);
    const enemyMobility = 0.5; // 简化：后续从敌方快照取
    const bodyState = deriveBodyAwareState(capability, entry.role, enemyMobility);
    members.push({
      name: entry.name, role: entry.role,
      pos: creep.pos.x * 50 + creep.pos.y, room: creep.pos.roomName,
      hits: creep.hits, hitsMax: creep.hitsMax, fatigue: creep.fatigue,
      alive: creep.hits > 0, capability, bodyState,
    });
  }

  // 采集敌方快照
  const enemies = collectEnemySnapshots(warPlan.targetRoom);

  // 获取 FocusFirePlan
  const focusFirePlan = getFocusFirePlan(`squad-${warPlan.sponsor}-${warPlan.targetRoom}`);
  const attackIntents = focusFirePlan?.attackIntents ?? [];

  // 获取 SquadMovementIntent
  const movementIntent = getSquadMovementIntent(`squad-${warPlan.sponsor}-${warPlan.targetRoom}`);
  const cohesion = movementIntent?.cohesion ?? null;
  const slots = movementIntent?.slots ?? [];
  const anchor = movementIntent?.anchor ?? null;

  // 获取地形上下文（简化：从 globalCache 获取或构建默认）
  const terrain = getTerrainContext(warPlan.targetRoom, tick);
  const terrainModifier = getTerrainModifier(terrain);

  // 推导 TacticalState
  const tacticalState = deriveTacticalState(warPlan.phase ?? "build");

  // 推导 WarPosture
  const warPosture = Memory.kernel?.strategy?.posture ?? "develop";

  // 获取上 tick 的微操决策
  const prevMicroDecisions = g.prevMicroDecisions ? Array.from(g.prevMicroDecisions.values()) : [];

  return {
    tick,
    squadId: `squad-${warPlan.sponsor}-${warPlan.targetRoom}`,
    objectiveId: `tac-${warPlan.targetRoom}-${warPlan.since}`,
    tacticalState,
    warPosture,
    authorizedTargetRoom: warPlan.targetRoom,
    members,
    enemies,
    terrain,
    terrainModifier,
    cohesion,
    slots,
    anchor,
    prevPlan: focusFirePlan,
    attackIntents,
    prevMicroDecisions,
    targetLocks: g.targetLocks!,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. 辅助函数
// ═══════════════════════════════════════════════════════════

function emptyCapability(): CombatCapability {
  return {
    attack: 0, rangedAttack: 0, heal: 0, rangedHeal: 0, dismantle: 0,
    claim: 0, effectiveHP: 0, mobility: 0, support: 0, toughParts: 0,
    boosted: false, maxBoostTier: 0, totalParts: 0, activeParts: 0,
  };
}

function buildCreepCapability(creep: Creep): CombatCapability {
  let attack = 0, rangedAttack = 0, heal = 0, rangedHeal = 0;
  let dismantle = 0, claim = 0, support = 0, toughParts = 0;
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
      case ATTACK: attack += 30 * mult; break;
      case RANGED_ATTACK: rangedAttack += 10 * mult; break;
      case HEAL: heal += 12 * mult; rangedHeal += 4 * mult; break;
      case WORK: dismantle += 50 * mult; support += 1; break;
      case CLAIM: claim += mult; break;
    }
  }

  const effectiveHP = creep.hits;
  const moveParts = creep.body.filter(p => p.type === MOVE).length;
  const bodyWeight = creep.body.filter(p => p.type !== MOVE && p.type !== CARRY).length;
  const mobility = bodyWeight > 0 ? moveParts / bodyWeight : moveParts > 0 ? 1 : 0;

  return {
    attack, rangedAttack, heal, rangedHeal, dismantle, claim,
    effectiveHP, mobility, support, toughParts, boosted, maxBoostTier,
    totalParts, activeParts,
  };
}

function collectEnemySnapshots(targetRoom: string): MicroEnemySnapshot[] {
  const room = Game.rooms[targetRoom];
  if (!room) return [];

  const g = globalCache() as { __tacticalHostiles?: Record<string, { tick: number; list: Creep[] }> };
  if (!g.__tacticalHostiles) g.__tacticalHostiles = {};
  const cached = g.__tacticalHostiles[room.name];
  let hostiles: Creep[];
  if (cached && cached.tick === Game.time) {
    hostiles = cached.list;
  } else {
    hostiles = room.find(FIND_HOSTILE_CREEPS) as Creep[];
    g.__tacticalHostiles[room.name] = { tick: Game.time, list: hostiles };
  }

  const result: MicroEnemySnapshot[] = [];
  for (const hostile of hostiles) {
    const capability = buildHostileCapability(hostile);
    const role = inferRole(capability);
    result.push({
      id: hostile.id as string,
      name: hostile.name,
      pos: hostile.pos.x * 50 + hostile.pos.y,
      room: hostile.pos.roomName,
      hits: hostile.hits,
      hitsMax: hostile.hitsMax,
      capability,
      role,
      lastSeenTick: Game.time,
    });
  }
  return result;
}

function buildHostileCapability(hostile: Creep): CombatCapability {
  let attack = 0, rangedAttack = 0, heal = 0, rangedHeal = 0;
  let dismantle = 0, claim = 0, support = 0, toughParts = 0;
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

function inferRole(cap: CombatCapability): string {
  if (cap.heal > 0) return "healer";
  if (cap.rangedAttack > 0) return "ranged";
  if (cap.attack > 0) return "attacker";
  if (cap.dismantle > 0) return "dismantler";
  return "unknown";
}

function deriveTacticalState(phase: string): import("../domain/tactical/types").TacticalState {
  if (phase === "build") return "FORMING";
  if (phase === "advance") return "MOVING";
  return "FORMING";
}

function getTerrainContext(roomName: string, tick: number): TerrainContext {
  // 简化：尝试从 globalCache 获取预构建的地形上下文
  // 如果不存在，返回 UNKNOWN 默认值
  const g = globalCache() as { __terrainContext?: Record<string, TerrainContext> };
  if (g.__terrainContext && g.__terrainContext[roomName]) {
    return g.__terrainContext[roomName];
  }
  return {
    roomName,
    terrainType: "UNKNOWN",
    walkability: "UNKNOWN",
    openTileRatio: 0.5,
    wallDensity: 0.1,
    chokepoints: [],
    corridors: [],
    rampartCoverage: "UNKNOWN",
    towerCoverage: "UNKNOWN",
    coreExposure: 0.5,
    retreatQuality: "UNKNOWN",
    mobilityModifier: 1.0,
    tick,
  };
}

function getTerrainModifier(terrain: TerrainContext): EffectiveCombatModifier {
  const towerMap: Record<string, number> = {
    NONE: 0, LOW: 0.3, MEDIUM: 0.6, HIGH: 0.85, CRITICAL: 1.0, UNKNOWN: 0.5,
  };
  const retreatMap: Record<string, number> = {
    VERY_GOOD: 0.5, GOOD: 0.8, POOR: 1.3, CRITICAL: 2.0, UNKNOWN: 1.0,
  };
  const significantChokepoints = terrain.chokepoints.filter(c => c.significance > 0.5).length;
  return {
    mobilityModifier: terrain.mobilityModifier,
    towerDamageFactor: towerMap[terrain.towerCoverage] ?? 0.5,
    retreatDifficulty: retreatMap[terrain.retreatQuality] ?? 1.0,
    approachFactor: Math.max(0.3, 1 - significantChokepoints * 0.2),
  };
}

// ═══════════════════════════════════════════════════════════
// §5. 公共 API（供角色层查询）
// ═══════════════════════════════════════════════════════════

/**
 * 查询 creep 的微操决策（供角色层消费）。

 * 角色层在 RolePolicy 的 acquire/work 候选中调用此函数，
 * 获取当前 tick 的微操指令（动作 + 目标 + 移动方向）。

 * 如果返回 null，角色回退到 A5.4.3 FocusFire → A5.4.1 TacticalIntent → Legacy。
 */
export function getMicroDecision(creepName: string): CombatMovementDecision | null {
  const g = globalCache() as unknown as GlobalCache & CombatMicroCache;
  const decisions = g.microDecisions;
  if (!decisions) return null;
  return decisions.get(creepName) ?? null;
}

/**
 * 查询编队的 MicroPlan（诊断观测用）。
 */
export function getMicroPlan(squadId: string): MicroPlan | null {
  const g = globalCache() as unknown as GlobalCache & CombatMicroCache;
  const plans = g.microPlans;
  if (!plans) return null;
  return plans.get(squadId) ?? null;
}
