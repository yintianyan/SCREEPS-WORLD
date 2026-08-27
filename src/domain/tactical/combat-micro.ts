/** A5.5 Advanced Tactical Combat Micro — Domain Pure Functions. */

import type { CombatCapability } from "../combat/capability";
import type { TerrainContext, EffectiveCombatModifier } from "../defense/terrain-context";
import type { TacticalState } from "./types";
import type { FocusFirePlan, AttackIntent } from "./focus-fire";
import type { CohesionMetric, FormationSlot, FormationAnchor } from "./squad-formation";

// ═══════════════════════════════════════════════════════════
// §1. CombatPressure — 多维压力评估（禁止单一 pressureScore）
// ═══════════════════════════════════════════════════════════

export interface CombatPressure {
  readonly enemyPressure: number;
  readonly damagePressure: number;
  readonly healPressure: number;
  readonly towerPressure: number;
  readonly mobilityPressure: number;
  readonly formationPressure: number;
  readonly retreatPressure: number;
  readonly aggregateRisk: number;
  readonly reason: string;
}

export function assessCombatPressure(snapshot: MicroSnapshot): CombatPressure {
  const { enemies, members, terrain, terrainModifier, cohesion } = snapshot;

  const enemyPressure = enemies.reduce(
    (s, e) => s + e.capability.attack + e.capability.rangedAttack, 0,
  );
  const totalHeal = members
    .filter(m => m.alive && m.role === "healer")
    .reduce((s, m) => s + m.capability.heal, 0);
  const totalIncoming = enemyPressure + terrainModifier.towerDamageFactor * 600;
  const damagePressure = Math.max(0, totalIncoming - totalHeal);
  const healDemand = members
    .filter(m => m.alive && m.hits < m.hitsMax)
    .reduce((s, m) => s + (m.hitsMax - m.hits), 0);
  const healPressure = totalHeal > 0 ? healDemand / totalHeal : (healDemand > 0 ? Infinity : 0);

  const towerMap: Record<string, number> = {
    NONE: 0, LOW: 0.2, MEDIUM: 0.5, HIGH: 0.8, CRITICAL: 1.0, UNKNOWN: 0.3,
  };
  const towerPressure = towerMap[terrain.towerCoverage] ?? 0.3;

  const ourMobility = avgMobility(members);
  const enemyMobility = avgMobilityEnemies(enemies);
  const mobilityPressure = ourMobility > 0 ? enemyMobility / ourMobility : (enemyMobility > 0 ? Infinity : 1);

  const formMap: Record<string, number> = { INTACT: 0, DEGRADED: 1, BROKEN: 2, CRITICAL: 3 };
  const formationPressure = formMap[cohesion?.status ?? "INTACT"] ?? 0;

  const retreatMap: Record<string, number> = { VERY_GOOD: 0, GOOD: 1, POOR: 2, CRITICAL: 3, UNKNOWN: 4 };
  const retreatPressure = retreatMap[terrain.retreatQuality] ?? 4;

  const weights = [0.2, 0.25, 0.15, 0.15, 0.1, 0.1, 0.05];
  const values = [enemyPressure, damagePressure, Math.min(healPressure, 10), towerPressure * 1000, mobilityPressure * 100, formationPressure * 100, retreatPressure * 100];
  let weightedSum = 0;
  for (let i = 0; i < weights.length; i++) weightedSum += weights[i]! * values[i]!;
  const aggregateRisk = weightedSum;

  return {
    enemyPressure, damagePressure, healPressure, towerPressure,
    mobilityPressure, formationPressure, retreatPressure, aggregateRisk,
    reason: `enemy=${enemyPressure}, dmg=${damagePressure}, heal=${healPressure === Infinity ? "INF" : healPressure.toFixed(1)}, tower=${towerPressure}, mob=${mobilityPressure.toFixed(2)}, form=${formationPressure}, retreat=${retreatPressure}`,
  };
}

// ═══════════════════════════════════════════════════════════
// §2. BodyAwareTacticalState — 基于 CombatCapability 的个体微操能力
// ═══════════════════════════════════════════════════════════

export interface BodyAwareTacticalState {
  readonly canFight: boolean;
  readonly canKite: boolean;
  readonly canRetreat: boolean;
  readonly canSupport: boolean;
  readonly canChase: boolean;
  readonly canHold: boolean;
  readonly optimalRange: number;
  readonly minRange: number;
  readonly maxRange: number;
}

export function deriveBodyAwareState(
  capability: CombatCapability, role: string, enemyMobility: number,
): BodyAwareTacticalState {
  const hasAttack = capability.attack > 0;
  const hasRanged = capability.rangedAttack > 0;
  const hasHeal = capability.heal > 0;
  const hasDismantle = capability.dismantle > 0;
  const myMobility = capability.mobility;

  const canFight = hasAttack || hasRanged || hasDismantle;
  const canKite = hasRanged && myMobility >= enemyMobility * 0.9;
  const canRetreat = myMobility > 0;
  const canSupport = hasHeal;
  const canChase = myMobility > enemyMobility;
  const canHold = hasAttack || (hasRanged && hasHeal);

  let optimalRange = 1;
  if (hasRanged) optimalRange = 3;
  else if (hasHeal) optimalRange = 1;
  else if (hasDismantle) optimalRange = 1;

  let minRange = 0;
  let maxRange = 1;
  if (hasRanged) { minRange = 2; maxRange = 3; }
  else if (hasHeal) { minRange = 1; maxRange = 3; }
  else if (hasAttack) { minRange = 0; maxRange = 1; }

  return { canFight, canKite, canRetreat, canSupport, canChase, canHold, optimalRange, minRange, maxRange };
}

// ═══════════════════════════════════════════════════════════
// §3. MicroIntent Types
// ═══════════════════════════════════════════════════════════

export type MicroActionType =
  | "RETREAT" | "SURVIVAL" | "HEAL_SUPPORT" | "ATTACK_RANGE"
  | "KITE" | "FORMATION" | "REPOSITION" | "PATROL" | "HOLD";

export interface KiteIntent {
  readonly creepId: string;
  readonly targetId: string;
  readonly desiredRange: number;
  readonly currentRange: number;
  readonly direction: number;
  readonly urgency: number;
  readonly reason: string;
  readonly confidence: number;
  readonly tick: number;
}

export interface RangeControlIntent {
  readonly creepId: string;
  readonly targetId: string;
  readonly desiredRange: number;
  readonly currentRange: number;
  readonly inOptimalRange: boolean;
  readonly requiresMovement: boolean;
  readonly moveDirection: number;
  readonly reason: string;
  readonly tick: number;
}

export interface ProtectIntent {
  readonly healerId: string;
  readonly threatId: string;
  readonly protectors: readonly string[];
  readonly urgency: number;
  readonly reason: string;
  readonly tick: number;
}

export interface ReformIntent {
  readonly squadId: string;
  readonly reformType: "REFORM" | "REGROUP" | "RETREAT" | "CONTINUE";
  readonly deviatingMembers: readonly string[];
  readonly reason: string;
  readonly tick: number;
}

export interface TargetSwitchIntent {
  readonly creepId: string;
  readonly currentTargetId: string | null;
  readonly candidateTargetId: string | null;
  readonly switchScore: number;
  readonly switchMargin: number;
  readonly lockUntil: number;
  readonly shouldSwitch: boolean;
  readonly reason: string;
  readonly tick: number;
}

export interface TowerAvoidanceIntent {
  readonly creepId: string;
  readonly towerExposure: string;
  readonly damageFactor: number;
  readonly advisedAction: "AVOID" | "PROCEED" | "RETREAT";
  readonly reason: string;
  readonly tick: number;
}

// ═══════════════════════════════════════════════════════════
// §4. CombatMovementDecision — 统一仲裁输出
// ═══════════════════════════════════════════════════════════

export interface CombatMovementDecision {
  readonly creepId: string;
  readonly squadId: string;
  readonly action: MicroActionType;
  readonly targetId: string | null;
  readonly moveDirection: number;
  readonly executeAttack: boolean;
  readonly attackType: string | null;
  readonly rejectedAlternatives: readonly MicroRejectedAlternative[];
  readonly reason: string;
  readonly confidence: number;
  readonly decisionHash: string;
  readonly tick: number;
}

export interface MicroRejectedAlternative {
  readonly action: MicroActionType;
  readonly reason: string;
}

// ═══════════════════════════════════════════════════════════
// §5. MicroSnapshot — 纯函数输入
// ═══════════════════════════════════════════════════════════

export interface MicroEnemySnapshot {
  readonly id: string;
  readonly name: string;
  readonly pos: number;
  readonly room: string;
  readonly hits: number;
  readonly hitsMax: number;
  readonly capability: CombatCapability;
  readonly role: string;
  readonly lastSeenTick: number;
}

export interface MicroMemberSnapshot {
  readonly name: string;
  readonly role: string;
  readonly pos: number;
  readonly room: string;
  readonly hits: number;
  readonly hitsMax: number;
  readonly fatigue: number;
  readonly alive: boolean;
  readonly capability: CombatCapability;
  readonly bodyState: BodyAwareTacticalState;
}

export interface MicroSnapshot {
  readonly tick: number;
  readonly squadId: string;
  readonly objectiveId: string;
  readonly tacticalState: TacticalState;
  readonly warPosture: string;
  readonly authorizedTargetRoom: string;
  readonly members: readonly MicroMemberSnapshot[];
  readonly enemies: readonly MicroEnemySnapshot[];
  readonly terrain: TerrainContext;
  readonly terrainModifier: EffectiveCombatModifier;
  readonly cohesion: CohesionMetric | null;
  readonly slots: readonly FormationSlot[];
  readonly anchor: FormationAnchor | null;
  readonly prevPlan: FocusFirePlan | null;
  readonly attackIntents: readonly AttackIntent[];
  readonly prevMicroDecisions: readonly CombatMovementDecision[];
  readonly targetLocks: ReadonlyMap<string, number>;
}

// ═══════════════════════════════════════════════════════════
// §6. MicroPlan — 核心输出
// ═══════════════════════════════════════════════════════════

export interface MicroPlan {
  readonly squadId: string;
  readonly tick: number;
  readonly pressure: CombatPressure;
  readonly decisions: readonly CombatMovementDecision[];
  readonly kiteIntents: readonly KiteIntent[];
  readonly rangeIntents: readonly RangeControlIntent[];
  readonly switchIntents: readonly TargetSwitchIntent[];
  readonly protectIntents: readonly ProtectIntent[];
  readonly reformIntents: readonly ReformIntent[];
  readonly towerIntents: readonly TowerAvoidanceIntent[];
  readonly decisionHash: string;
}

// ═══════════════════════════════════════════════════════════
// §7. 核心纯函数 — planCombatMicro
// ═══════════════════════════════════════════════════════════

/**
 * planCombatMicro — 从 MicroSnapshot 产出每成员的 CombatMovementDecision。

 * 决策链：
 *   1. 授权 / 姿态检查
 *   2. CombatPressure 评估
 *   3. 对每个 alive member：评估各 Intent → 仲裁 → 唯一 Decision

 * 纯函数 — 相同输入必产生相同输出。禁止 Math.random / Date.now。
 */
export function planCombatMicro(snapshot: MicroSnapshot): MicroPlan {
  const { tick, squadId, tacticalState, warPosture, members } = snapshot;

  if (warPosture !== "war") {
    return buildEmptyMicroPlan(snapshot, `warPosture=${warPosture} → no offensive micro`);
  }
  if (tacticalState === "RETREATING" || tacticalState === "DISENGAGING" ||
      tacticalState === "REGROUPING" || tacticalState === "COMPLETED" || tacticalState === "ABORTED") {
    return buildEmptyMicroPlan(snapshot, `tacticalState=${tacticalState} → no aggressive micro`);
  }

  const pressure = assessCombatPressure(snapshot);
  const decisions: CombatMovementDecision[] = [];
  const kiteIntents: KiteIntent[] = [];
  const rangeIntents: RangeControlIntent[] = [];
  const switchIntents: TargetSwitchIntent[] = [];
  const protectIntents: ProtectIntent[] = [];
  const reformIntents: ReformIntent[] = [];
  const towerIntents: TowerAvoidanceIntent[] = [];

  // ReformIntent 评估
  if (snapshot.cohesion) {
    const cs = snapshot.cohesion.status;
    if (cs === "BROKEN" || cs === "CRITICAL") {
      const deviating = computeDeviatingMembers(snapshot);
      reformIntents.push({
        squadId, reformType: cs === "CRITICAL" ? "RETREAT" : "REGROUP",
        deviatingMembers: deviating,
        reason: `cohesion ${cs}: ${snapshot.cohesion.reason}`,
        tick,
      });
    } else if (cs === "DEGRADED") {
      const deviating = computeDeviatingMembers(snapshot);
      if (deviating.length > 0) {
        reformIntents.push({
          squadId, reformType: "REFORM", deviatingMembers: deviating,
          reason: `cohesion DEGRADED: reform ${deviating.length} members`, tick,
        });
      }
    }
  }

  // Healer protection
  const healerProt = assessHealerProtection(snapshot);
  if (healerProt) protectIntents.push(healerProt);

  for (const member of members) {
    if (!member.alive) continue;
    const attackIntent = snapshot.attackIntents.find(a => a.creepId === member.name);

    const kiteIntent = evaluateKiteIntent(member, snapshot);
    if (kiteIntent) kiteIntents.push(kiteIntent);

    const rangeIntent = evaluateRangeControlIntent(member, snapshot, attackIntent);
    if (rangeIntent) rangeIntents.push(rangeIntent);

    const switchIntent = evaluateTargetSwitchIntent(member, snapshot, attackIntent);
    if (switchIntent) switchIntents.push(switchIntent);

    const towerIntent = evaluateTowerAvoidanceIntent(member, snapshot);
    if (towerIntent) towerIntents.push(towerIntent);

    const decision = arbitrateMicro(
      member, snapshot, pressure, attackIntent, kiteIntent,
      rangeIntent, reformIntents[0] ?? null, protectIntents[0] ?? null, towerIntent,
    );
    decisions.push(decision);
  }

  const plan: MicroPlan = {
    squadId, tick, pressure, decisions, kiteIntents, rangeIntents,
    switchIntents, protectIntents, reformIntents, towerIntents, decisionHash: "",
  };
  return { ...plan, decisionHash: microPlanHash(plan) };
}

// ═══════════════════════════════════════════════════════════
// §8. 仲裁函数 — arbitrateMicro
// ═══════════════════════════════════════════════════════════

/**
 * arbitrateMicro — 统一仲裁，唯一输出 CombatMovementDecision。

 * 优先级（从高到低）：
 *   1. RETREAT — hp < retreatThreshold OR authorization revoked
 *   2. SURVIVAL — 即将死亡（1 tick 致死量）
 *   3. HEAL_SUPPORT — healer 需治疗濒死队友
 *   4. ATTACK_RANGE — 在射程内且有有效目标
 *   5. KITE — 敌方接近 + 我方 ranged 优势
 *   6. FORMATION — 偏离阵型
 *   7. REPOSITION — 地形不利
 *   8. PATROL
 */
function arbitrateMicro(
  member: MicroMemberSnapshot,
  snapshot: MicroSnapshot,
  pressure: CombatPressure,
  attackIntent: AttackIntent | undefined,
  kiteIntent: KiteIntent | null,
  rangeIntent: RangeControlIntent | null,
  reformIntent: ReformIntent | null,
  protectIntent: ProtectIntent | null,
  towerIntent: TowerAvoidanceIntent | null,
): CombatMovementDecision {
  const tick = snapshot.tick;
  const rejected: MicroRejectedAlternative[] = [];
  const hpRatio = member.hitsMax > 0 ? member.hits / member.hitsMax : 0;

  // ── 1. RETREAT ──
  // Retreat state OR tower CRITICAL OR formation CRITICAL
  if (snapshot.tacticalState === "RETREATING" || snapshot.tacticalState === "DISENGAGING") {
    rejected.push({ action: "ATTACK_RANGE", reason: "retreating → no attack" });
    return buildDecision(member, snapshot, "RETREAT", null, 1, false, null, rejected,
      `tacticalState=${snapshot.tacticalState} → retreat`, 1.0, tick);
  }
  if (towerIntent?.advisedAction === "RETREAT") {
    rejected.push({ action: "ATTACK_RANGE", reason: "tower CRITICAL → retreat" });
    return buildDecision(member, snapshot, "RETREAT", null, 1, false, null, rejected,
      `tower=${towerIntent.towerExposure} → retreat`, 0.9, tick);
  }
  if (reformIntent?.reformType === "RETREAT") {
    rejected.push({ action: "ATTACK_RANGE", reason: "formation CRITICAL → retreat" });
    return buildDecision(member, snapshot, "RETREAT", null, 1, false, null, rejected,
      reformIntent.reason, 0.9, tick);
  }

  // ── 2. SURVIVAL ── hp < 0.2 且 damagePressure > 0
  if (hpRatio < 0.2 && pressure.damagePressure > 0 && member.bodyState.canRetreat) {
    rejected.push({ action: "ATTACK_RANGE", reason: `hp=${hpRatio.toFixed(2)} < 0.2 → survival retreat` });
    return buildDecision(member, snapshot, "SURVIVAL", null, 1, false, null, rejected,
      `hp ratio ${hpRatio.toFixed(2)} + damage pressure → survival`, 0.95, tick);
  }

  // ── 3. HEAL_SUPPORT ── healer 且有受伤队友
  if (member.role === "healer" && member.bodyState.canSupport) {
    const wounded = snapshot.members.find(m => m.alive && m.hits < m.hitsMax * 0.5);
    if (wounded) {
      rejected.push({ action: "ATTACK_RANGE", reason: "healer → heal support" });
      return buildDecision(member, snapshot, "HEAL_SUPPORT", null, 0, false, "HEAL", rejected,
        `healer healing ${wounded.name}`, 0.85, tick);
    }
  }

  // ── 4. ATTACK_RANGE ── 在射程内且有有效目标
  if (attackIntent && attackIntent.attackType !== "NO_ATTACK" && !attackIntent.requiresMovement) {
    // 可以攻击 — 但检查是否有更高优先级的 micro 需求
    // Tower AVOID 时降低攻击优先级
    if (towerIntent?.advisedAction === "AVOID" && pressure.towerPressure > 0.5) {
      rejected.push({ action: "ATTACK_RANGE", reason: "tower avoidance priority" });
      return buildDecision(member, snapshot, "REPOSITION", attackIntent.targetId, 1, false, null, rejected,
        `tower avoid while target in range`, 0.7, tick);
    }
    // Kite urgency 高时优先 kite
    if (kiteIntent && kiteIntent.urgency > 0.7 && member.bodyState.canKite) {
      rejected.push({ action: "ATTACK_RANGE", reason: `kite urgency=${kiteIntent.urgency.toFixed(2)} > 0.7` });
      return buildDecision(member, snapshot, "KITE", kiteIntent.targetId, kiteIntent.direction, false, null, rejected,
        kiteIntent.reason, kiteIntent.confidence, tick);
    }
    // 正常攻击
    rejected.push({ action: "KITE", reason: "in range → attack priority" });
    return buildDecision(member, snapshot, "ATTACK_RANGE", attackIntent.targetId, 0, true, attackIntent.attackType, rejected,
      `attack target ${attackIntent.targetId}`, 0.85, tick);
  }

  // ── 5. KITE ──
  if (kiteIntent && member.bodyState.canKite && kiteIntent.direction === 1) {
    rejected.push({ action: "FORMATION", reason: "kite priority over formation" });
    return buildDecision(member, snapshot, "KITE", kiteIntent.targetId, kiteIntent.direction, false, null, rejected,
      kiteIntent.reason, kiteIntent.confidence, tick);
  }

  // ── 6. FORMATION ──
  if (reformIntent && (reformIntent.reformType === "REFORM" || reformIntent.reformType === "REGROUP")) {
    const isDeviating = reformIntent.deviatingMembers.includes(member.name);
    if (isDeviating || reformIntent.reformType === "REGROUP") {
      rejected.push({ action: "REPOSITION", reason: "formation reform priority" });
      return buildDecision(member, snapshot, "FORMATION", null, 0, false, null, rejected,
        reformIntent.reason, 0.75, tick);
    }
  }

  // ── 7. REPOSITION ── tower AVOID
  if (towerIntent?.advisedAction === "AVOID") {
    rejected.push({ action: "PATROL", reason: "tower avoid → reposition" });
    return buildDecision(member, snapshot, "REPOSITION", null, 1, false, null, rejected,
      towerIntent.reason, 0.7, tick);
  }

  // ── 8. PATROL / HOLD ──
  if (attackIntent && attackIntent.requiresMovement) {
    // 需要移动接近目标
    return buildDecision(member, snapshot, "REPOSITION", attackIntent.targetId, -1, false, null, [],
      `move to engage target ${attackIntent.targetId}`, 0.6, tick);
  }

  return buildDecision(member, snapshot, "HOLD", null, 0, false, null, [],
    `no action — hold position`, 0.5, tick);
}

// ═══════════════════════════════════════════════════════════
// §9. 微操评估辅助函数
// ═══════════════════════════════════════════════════════════

function evaluateKiteIntent(member: MicroMemberSnapshot, snapshot: MicroSnapshot): KiteIntent | null {
  if (!member.bodyState.canKite) return null;
  let nearestThreat: MicroEnemySnapshot | null = null;
  let nearestDist = Infinity;
  for (const enemy of snapshot.enemies) {
    if (enemy.room !== member.room) continue;
    if (enemy.capability.attack <= 0) continue;
    const dist = chebyshevDist(member.pos, enemy.pos);
    if (dist <= 2 && dist < nearestDist) { nearestDist = dist; nearestThreat = enemy; }
  }
  if (!nearestThreat) return null;
  const desiredRange = member.bodyState.maxRange;
  const currentRange = nearestDist;
  const direction = currentRange < desiredRange ? 1 : 0;
  const urgency = currentRange <= 1 ? 1.0 : Math.max(0, 1 - (currentRange - 1) / 2);
  return {
    creepId: member.name, targetId: nearestThreat.id, desiredRange, currentRange,
    direction, urgency, reason: `kite: enemy melee at dist=${currentRange}, desired=${desiredRange}`,
    confidence: 0.8, tick: snapshot.tick,
  };
}

function evaluateRangeControlIntent(
  member: MicroMemberSnapshot, snapshot: MicroSnapshot, attackIntent: AttackIntent | undefined,
): RangeControlIntent | null {
  if (!attackIntent || attackIntent.attackType === "NO_ATTACK") return null;
  const target = snapshot.enemies.find(e => e.id === attackIntent.targetId);
  if (!target || target.room !== member.room) return null;
  const currentRange = chebyshevDist(member.pos, target.pos);
  const desiredRange = member.bodyState.optimalRange;
  const inOptimalRange = currentRange >= member.bodyState.minRange && currentRange <= member.bodyState.maxRange;
  const requiresMovement = !inOptimalRange;
  const moveDirection = currentRange < member.bodyState.minRange ? 1 : (currentRange > member.bodyState.maxRange ? -1 : 0);
  return {
    creepId: member.name, targetId: target.id, desiredRange, currentRange,
    inOptimalRange, requiresMovement, moveDirection,
    reason: `range: cur=${currentRange}, desired=${desiredRange}, inRange=${inOptimalRange}`, tick: snapshot.tick,
  };
}

function evaluateTargetSwitchIntent(
  member: MicroMemberSnapshot, snapshot: MicroSnapshot, attackIntent: AttackIntent | undefined,
): TargetSwitchIntent | null {
  if (!attackIntent || !attackIntent.targetId) return null;
  const tick = snapshot.tick;
  const currentTargetId = attackIntent.targetId;
  const lockUntil = snapshot.targetLocks.get(member.name) ?? 0;
  const isLocked = tick < lockUntil;
  const currentTarget = snapshot.enemies.find(e => e.id === currentTargetId);
  if (!currentTarget) {
    return {
      creepId: member.name, currentTargetId, candidateTargetId: null,
      switchScore: Infinity, switchMargin: 0, lockUntil: 0, shouldSwitch: true,
      reason: "current target disappeared → switch", tick,
    };
  }
  let bestCandidate: MicroEnemySnapshot | null = null;
  let bestScore = -Infinity;
  for (const enemy of snapshot.enemies) {
    if (enemy.id === currentTargetId) continue;
    if (enemy.room !== member.room) continue;
    const score = scoreTargetForMicro(enemy, member, snapshot);
    if (score > bestScore) { bestScore = score; bestCandidate = enemy; }
  }
  const currentScore = scoreTargetForMicro(currentTarget, member, snapshot);
  const switchScore = bestCandidate ? bestScore - currentScore : 0;
  const switchMargin = Math.max(10, currentScore * 0.15);
  let shouldSwitch = false;
  let reason = `locked until ${lockUntil}`;
  if (isLocked) {
    if (switchScore > switchMargin * 2) { shouldSwitch = true; reason = `switch despite lock: score=${switchScore.toFixed(1)} > 2x margin`; }
  } else {
    if (switchScore > switchMargin) { shouldSwitch = true; reason = `switch: score=${switchScore.toFixed(1)} > margin=${switchMargin.toFixed(1)}`; }
    else { reason = `keep: score=${switchScore.toFixed(1)} <= margin=${switchMargin.toFixed(1)}`; }
  }
  return {
    creepId: member.name, currentTargetId, candidateTargetId: bestCandidate?.id ?? null,
    switchScore, switchMargin, lockUntil: shouldSwitch ? tick + 5 : lockUntil,
    shouldSwitch, reason, tick,
  };
}

function evaluateTowerAvoidanceIntent(member: MicroMemberSnapshot, snapshot: MicroSnapshot): TowerAvoidanceIntent | null {
  const tc = snapshot.terrain.towerCoverage;
  const df = snapshot.terrainModifier.towerDamageFactor;
  let act: "AVOID" | "PROCEED" | "RETREAT";
  if (tc === "CRITICAL") act = "RETREAT";
  else if (tc === "HIGH" || tc === "MEDIUM") act = (member.bodyState.canRetreat && df > 0.6) ? "AVOID" : "PROCEED";
  else act = "PROCEED";
  if (act === "PROCEED" && df === 0) return null;
  return {
    creepId: member.name, towerExposure: tc, damageFactor: df, advisedAction: act,
    reason: `tower=${tc}, df=${df.toFixed(2)} → ${act}`, tick: snapshot.tick,
  };
}

function assessHealerProtection(snapshot: MicroSnapshot): ProtectIntent | null {
  const healers = snapshot.members.filter(m => m.alive && m.role === "healer");
  if (healers.length === 0) return null;
  for (const healer of healers) {
    for (const enemy of snapshot.enemies) {
      if (enemy.room !== healer.room) continue;
      if (enemy.capability.attack <= 0) continue;
      const dist = chebyshevDist(healer.pos, enemy.pos);
      if (dist <= 2) {
        const protectors = snapshot.members
          .filter(m => m.alive && m.role !== "healer" && m.bodyState.canFight && m.room === healer.room)
          .map(m => m.name);
        return {
          healerId: healer.name, threatId: enemy.id, protectors,
          urgency: dist <= 1 ? 1.0 : 0.7,
          reason: `healer ${healer.name} threatened by ${enemy.id} at dist=${dist}`, tick: snapshot.tick,
        };
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// §10. 辅助函数
// ═══════════════════════════════════════════════════════════

function buildEmptyMicroPlan(snapshot: MicroSnapshot, reason: string): MicroPlan {
  const plan: MicroPlan = {
    squadId: snapshot.squadId, tick: snapshot.tick,
    pressure: {
      enemyPressure: 0, damagePressure: 0, healPressure: 0, towerPressure: 0,
      mobilityPressure: 0, formationPressure: 0, retreatPressure: 0, aggregateRisk: 0, reason,
    },
    decisions: [], kiteIntents: [], rangeIntents: [], switchIntents: [],
    protectIntents: [], reformIntents: [], towerIntents: [], decisionHash: "",
  };
  return { ...plan, decisionHash: microPlanHash(plan) };
}

function buildDecision(
  member: MicroMemberSnapshot, snapshot: MicroSnapshot,
  action: MicroActionType, targetId: string | null, moveDirection: number,
  executeAttack: boolean, attackType: string | null,
  rejected: readonly MicroRejectedAlternative[], reason: string, confidence: number, tick: number,
): CombatMovementDecision {
  const decision: CombatMovementDecision = {
    creepId: member.name, squadId: snapshot.squadId, action, targetId,
    moveDirection, executeAttack, attackType, rejectedAlternatives: rejected,
    reason, confidence, decisionHash: "", tick,
  };
  return { ...decision, decisionHash: microDecisionHash(decision) };
}

function scoreTargetForMicro(
  enemy: MicroEnemySnapshot, member: MicroMemberSnapshot, snapshot: MicroSnapshot,
): number {
  let score = 0;
  // healer 优先
  if (enemy.role === "healer") score += 100;
  // 高伤害优先
  score += enemy.capability.attack + enemy.capability.rangedAttack;
  // 残血优先
  if (enemy.hitsMax > 0 && enemy.hits < enemy.hitsMax * 0.3) score += 50;
  // 近距优先
  if (enemy.room === member.room) score += Math.max(0, 50 - chebyshevDist(enemy.pos, member.pos) * 10);
  // boosted 优先
  if (enemy.capability.maxBoostTier > 0) score += 10 * enemy.capability.maxBoostTier;
  return score;
}

function computeDeviatingMembers(snapshot: MicroSnapshot): string[] {
  if (!snapshot.cohesion || !snapshot.slots.length) return [];
  const deviating: string[] = [];
  for (const slot of snapshot.slots) {
    const m = snapshot.members.find(mm => mm.name === slot.creepName);
    if (!m || !m.alive) continue;
    if (m.room !== slot.desiredRoom) { deviating.push(m.name); continue; }
    const dist = chebyshevDist(m.pos, slot.desiredPosition);
    if (dist > slot.tolerance) deviating.push(m.name);
  }
  deviating.sort();
  return deviating;
}

function avgMobility(members: readonly MicroMemberSnapshot[]): number {
  const alive = members.filter(m => m.alive);
  if (alive.length === 0) return 0;
  return alive.reduce((s, m) => s + m.capability.mobility, 0) / alive.length;
}

function avgMobilityEnemies(enemies: readonly MicroEnemySnapshot[]): number {
  if (enemies.length === 0) return 0;
  return enemies.reduce((s, e) => s + e.capability.mobility, 0) / enemies.length;
}

function chebyshevDist(pos1: number, pos2: number): number {
  const x1 = Math.floor(pos1 / 50);
  const y1 = pos1 % 50;
  const x2 = Math.floor(pos2 / 50);
  const y2 = pos2 % 50;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

// ═══════════════════════════════════════════════════════════
// §11. Determinism — 确定性 Hash
// ═══════════════════════════════════════════════════════════

export function microPlanHash(plan: MicroPlan): string {
  const payload = JSON.stringify({
    sq: plan.squadId,
    t: plan.tick,
    dc: plan.decisions.length,
    dh: plan.decisions.map(d => d.decisionHash).join(","),
    ki: plan.kiteIntents.length,
    ri: plan.rangeIntents.length,
    si: plan.switchIntents.length,
    pi: plan.protectIntents.length,
    fi: plan.reformIntents.length,
    ti: plan.towerIntents.length,
    ar: plan.pressure.aggregateRisk.toFixed(2),
  });
  return fnv1a32Hex(payload);
}

export function microDecisionHash(decision: CombatMovementDecision): string {
  const payload = JSON.stringify({
    c: decision.creepId,
    sq: decision.squadId,
    a: decision.action,
    t: decision.targetId ?? "",
    md: decision.moveDirection,
    ea: decision.executeAttack,
    at: decision.attackType ?? "",
    r: decision.reason,
    cf: decision.confidence.toFixed(2),
    t2: decision.tick,
  });
  return fnv1a32Hex(payload);
}

function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}