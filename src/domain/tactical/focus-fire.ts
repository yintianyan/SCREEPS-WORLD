/**
 * Tactical Engagement & Focus Fire — A5.4.3 Domain 纯函数。
 *
 * 核心目标：让已完成 Formation + Movement 的 Squad 具备
 *   "接敌 → 选择攻击目标 → 集火 → 攻击 → 目标死亡 → 重新选择 → 继续作战"
 * 的真正 Tactical Engagement Loop。
 *
 * 设计边界（严格）：
 *   Strategic（WHY）    → WarPosture / WarPlan — 不碰
 *   Operational（WHAT） → TacticalObjective / TargetScope — 只消费
 *   Tactical（HOW）     → 本模块：局部交战目标分配 + 火力协同
 *
 * 消费 Canonical 上游（不创建第二套）：
 *   - A5.1 G1 ThreatAssessment → 消费 estimatedPower / enemyCombatPower
 *   - A5.1 G2 CombatCapability → 消费 evaluateCombatCapability 输出
 *   - A5.4.0 TacticalSnapshot → 消费 enemies / squad / objective
 *   - A5.4.2 SquadSnapshot / SquadMovementIntent → 消费 formation / cohesion
 *
 * 输出：
 *   FocusFirePlan → AttackIntent[] → globalCache → Role Execution
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / Creep / Room / PathFinder / Kernel / Spawn / Transport / Recovery。
 * 所有运行时数据由调用方（系统层薄壳）注入为 Snapshot / DTO。
 */

import type {
  TacticalState,
  TargetScope,
} from "./types";
import type { CombatCapability } from "../combat/capability";

// ═══════════════════════════════════════════════════════════
// §1. TargetCandidate — 目标候选（消费 CombatCapability，不重新计算）
// ═══════════════════════════════════════════════════════════

/**
 * TargetCandidate — 一个敌方单位的战术候选快照。
 *
 * 从 EnemySnapshot + CombatCapability 构建。
 * 不直接引用 Game/Creep — 所有数据是 DTO。
 */
export interface TargetCandidate {
  /** 目标 ID（稳定标识）。 */
  readonly id: string;
  /** 位置 packed pos (x*50+y)。 */
  readonly pos: number;
  /** 所在房间。 */
  readonly room: string;
  /** 角色推断（attacker / healer / ranged / tank / scout / unknown）。 */
  readonly role: string;
  /** 当前血量。 */
  readonly hp: number;
  /** 最大血量。 */
  readonly maxHp: number;
  /** 有效血量（含 tough 减伤 + 自愈缓冲）。 */
  readonly effectiveHP: number;
  /** 攻击能力（来自 CombatCapability.attack）。 */
  readonly attackCapability: number;
  /** 远程攻击能力（来自 CombatCapability.rangedAttack）。 */
  readonly rangedCapability: number;
  /** 治疗能力（来自 CombatCapability.heal）。 */
  readonly healCapability: number;
  /** 移动力（0-1，来自 CombatCapability.mobility）。 */
  readonly mobility: number;
  /** 威胁评分（来自 G1 ThreatAssessment，不重新计算）。 */
  readonly threat: number;
  /** 到 Squad Anchor 的切比雪夫距离。 */
  readonly distance: number;
  /** 可达性（是否在射程/移动范围内）。 */
  readonly accessibility: TargetAccessibility;
  /** 战术价值评分（多维，不压缩为单一 powerScore）。 */
  readonly tacticalValue: TacticalValueBreakdown;
  /** 是否被 boost。 */
  readonly boosted: boolean;
  /** Boost tier（0=无, 1/2/3）。 */
  readonly boostTier: 0 | 1 | 2 | 3;
  /** 最后观测 tick。 */
  readonly lastSeenTick: number;
}

/** 目标可达性状态。 */
export type TargetAccessibility =
  | "IN_MELEE_RANGE"     // 近身攻击范围内（≤1 格）
  | "IN_RANGED_RANGE"   // 远程攻击范围内（≤3 格）
  | "IN_ENGAGEMENT_RANGE" // 交战范围内（≤5 格，需移动接近）
  | "OUT_OF_RANGE"      // 超出范围（需要 Movement Intent）
  | "BLOCKED"           // 被阻挡（地形/友方/不可达）
  | "INVALID";          // 目标无效（已死/消失）

/**
 * TacticalValueBreakdown — 多维战术价值评分。
 *
 * 禁止：单一 powerScore。
 * 必须分别考虑以下维度。
 */
export interface TacticalValueBreakdown {
  /** 威胁维度（敌方攻击力 × 距离权重）。 */
  readonly threat: number;
  /** 可达性维度（距离越近越优）。 */
  readonly accessibility: number;
  /** 有效血量维度（越脆越优 — 集火效率）。 */
  readonly effectiveHP: number;
  /** 预期伤害维度（我方对其的预期伤害效率）。 */
  readonly expectedDamage: number;
  /** 过量击杀风险维度（越低越优）。 */
  readonly overkill: number;
  /** 敌方治疗支持维度（敌方 healer 对此目标的覆盖）。 */
  readonly enemyHealSupport: number;
  /** 距离维度（越近越优）。 */
  readonly distance: number;
  /** 位置维度（是否在关键区域 — 如靠近我方 spawn/塔）。 */
  readonly position: number;
  /** 战术优先级（healer 优先 > 高伤害 > 残血 > 其他）。 */
  readonly tacticalPriority: number;
}

// ═══════════════════════════════════════════════════════════
// §2. AttackIntent — 攻击意图（Domain 产出，Role 执行）
// ═══════════════════════════════════════════════════════════

/** 攻击类型 — 区分 Melee / Ranged。 */
export type AttackType =
  | "ATTACK"            // 近身攻击（range ≤ 1）
  | "RANGED_ATTACK"     // 远程攻击（range ≤ 3）
  | "RANGED_MASS_ATTACK" // 范围攻击（多个目标，需特殊条件）
  | "DISMANTLE"         // 拆除（对建筑）
  | "NO_ATTACK";        // 不攻击（目标不在射程 → 产生 MovementIntent）

/** 目标优先级。 */
export type TargetPriority = "PRIMARY" | "SECONDARY" | "NO_TARGET";

/**
 * AttackIntent — 单个 Creep 的攻击意图。
 *
 * Domain 只产出 Intent，不执行 attack()。
 * Role 层读取 Intent 调用实际 API。
 */
export interface AttackIntent {
  /** 编队 ID。 */
  readonly squadId: string;
  /** Creep 名称。 */
  readonly creepId: string;
  /** 目标 ID。 */
  readonly targetId: string;
  /** 目标位置 packed pos。 */
  readonly targetPos: number;
  /** 目标所在房间。 */
  readonly targetRoom: string;
  /** 攻击类型。 */
  readonly attackType: AttackType;
  /** 目标优先级（PRIMARY / SECONDARY）。 */
  readonly priority: TargetPriority;
  /** 预期伤害/tick。 */
  readonly expectedDamage: number;
  /** 目标预期 HP（攻击后）。 */
  readonly targetExpectedHP: number;
  /** 决策原因。 */
  readonly reason: string;
  /** 置信度（0-1）。 */
  readonly confidence: number;
  /** 产生 tick。 */
  readonly tick: number;
  /** 是否需要移动（目标不在射程内时为 true）。 */
  readonly requiresMovement: boolean;
}

// ═══════════════════════════════════════════════════════════
// §3. HealCoverage — 治疗覆盖模型
// ═══════════════════════════════════════════════════════════

/**
 * HealCoverage — 编队治疗覆盖状态。
 *
 * 不创建第二套 Healer Target Selection。
 * 只产出治疗需求信号，具体 heal target 由既有 Healer Role 执行。
 */
export interface HealCoverage {
  /** 编队 ID。 */
  readonly squadId: string;
  /** 存活 healer 数量。 */
  readonly healerCount: number;
  /** 需要治疗的成员数量。 */
  readonly woundedCount: number;
  /** 预期治疗输出/tick（所有存活 healer 合计）。 */
  readonly expectedHeal: number;
  /** 治疗需求（受伤成员需要的治疗量/tick）。 */
  readonly healSupportDemand: number;
  /** 治疗覆盖率（expectedHeal / healSupportDemand，≥1 = 完全覆盖）。 */
  readonly coverageRatio: number;
  /** 是否需要撤退（治疗覆盖不足 + 持续受伤）。 */
  readonly retreatRecommended: boolean;
  /** 评估原因。 */
  readonly reason: string;
}

// ═══════════════════════════════════════════════════════════
// §4. EnemyHealSupport — 敌方治疗能力评估
// ═══════════════════════════════════════════════════════════

/**
 * EnemyHealSupport — 评估敌方对某个目标的 heal 支持。
 *
 * 不实现"先杀 healer"战略算法。
 * 只将 EnemyHealSupport 作为 Tactical 指标。
 */
export interface EnemyHealSupport {
  /** 被评估的目标 ID。 */
  readonly targetId: string;
  /** 敌方 healer 数量（在治疗范围内）。 */
  readonly healerCount: number;
  /** 敌方合计治疗输出/tick（对目标可达的 heal 总量）。 */
  readonly totalHealPerTick: number;
  /** 净击杀难度（targetEffectiveHP / (ourDamage - enemyHeal) 的 tick 数估计）。 */
  readonly killDifficultyTicks: number;
  /** 是否被有效治疗（enemyHeal ≥ ourDamage → 打不动）。 */
  readonly effectivelyUnkillable: boolean;
  /** 评估原因。 */
  readonly reason: string;
}

// ═══════════════════════════════════════════════════════════
// §5. FocusFirePlan — 核心输出
// ═══════════════════════════════════════════════════════════

/**
 * FocusFirePlan — 一个 Squad 在某一 tick 的完整集火计划。
 *
 * 包含：
 *   - 选中的主目标 + 次目标
 *   - 每个 attacker 的攻击分配
 *   - 过量击杀风险
 *   - 敌方治疗评估
 *   - 治疗覆盖状态
 *   - 决策确定性 Hash
 */
export interface FocusFirePlan {
  /** 编队 ID。 */
  readonly squadId: string;
  /** 所属 Objective ID。 */
  readonly objectiveId: string;
  /** 主目标 ID（集火优先目标）。 */
  readonly primaryTargetId: string | null;
  /** 主目标位置 packed pos。 */
  readonly primaryTargetPos: number | null;
  /** 主目标优先级。 */
  readonly primaryTargetPriority: TargetPriority;
  /** 次目标 ID（过量分配的攻击者目标）。 */
  readonly secondaryTargetId: string | null;
  /** 分配的 attacker 列表（攻击主目标）。 */
  readonly assignedAttackers: readonly string[];
  /** 分配的 ranged 列表。 */
  readonly assignedRanged: readonly string[];
  /** 分配的 healer 列表（治疗覆盖）。 */
  readonly assignedHealers: readonly string[];
  /** 预期总伤害/tick（对主目标）。 */
  readonly expectedDamage: number;
  /** 预期总治疗/tick（编队内）。 */
  readonly expectedHeal: number;
  /** 主目标有效 HP。 */
  readonly targetEffectiveHP: number;
  /** 过量击杀风险（0-1，0 = 无风险，1 = 全部过量）。 */
  readonly overkillRisk: number;
  /** 敌方治疗支持评估。 */
  readonly enemyHealSupport: EnemyHealSupport | null;
  /** 治疗覆盖状态。 */
  readonly healCoverage: HealCoverage | null;
  /** 置信度（0-1）。 */
  readonly confidence: number;
  /** 决策原因。 */
  readonly reason: string;
  /** 被拒绝的备选目标。 */
  readonly rejectedTargets: readonly RejectedTarget[];
  /** 产生 tick。 */
  readonly tick: number;
  /** 决策 Hash（确定性验证）。 */
  readonly decisionHash: string;
  /** 攻击意图列表（每个分配的成员一个）。 */
  readonly attackIntents: readonly AttackIntent[];
  /** 焦点射击状态机当前状态。 */
  readonly engagementState: EngagementState;
}

/** 被拒绝的目标候选。 */
export interface RejectedTarget {
  readonly targetId: string;
  readonly reason: string;
}

// ═══════════════════════════════════════════════════════════
// §6. EngagementState — 焦点射击状态机
// ═══════════════════════════════════════════════════════════

/**
 * EngagementState — Focus Fire 级别的状态机。
 *
 * 复用 A5.4 TacticalState（Squad 级）作为上层状态。
 * 本状态机是 TacticalState=ENGAGING 时的子状态。
 *
 * 状态流：
 *   TARGET_ACQUIRED
 *     ↓
 *   ATTACKING
 *     ↓ (目标 HP < 30%)
 *   TARGET_DYING
 *     ↓ (目标 HP = 0 或消失)
 *   TARGET_DEAD
 *     ↓
 *   REASSESSING
 *     ↓
 *   NEW_TARGET → TARGET_ACQUIRED
 *
 * 异常：
 *   TARGET_LOST → REASSESSING（或 REGROUP）
 *   TARGET_OUT_OF_RANGE → REQUEST_MOVEMENT（不直接进入 Strategic Planning）
 */
export type EngagementState =
  | "IDLE"                // 无目标待命
  | "TARGET_ACQUIRED"     // 已选择目标
  | "ATTACKING"           // 正在攻击
  | "TARGET_DYING"        // 目标即将死亡（HP < 30%）
  | "TARGET_DEAD"         // 目标已死亡
  | "TARGET_LOST"         // 目标突然消失（不在视野/被其他单位击杀）
  | "TARGET_OUT_OF_RANGE" // 目标超出射程
  | "TARGET_ESCAPED"      // 目标逃跑（连续多 tick OUT_OF_RANGE）
  | "TARGET_BLOCKED"      // 目标被阻挡（地形/友方）
  | "REASSESSING"         // 重新评估中
  | "REQUEST_MOVEMENT"    // 请求移动进入射程
  | "REGROUP";            // 需要重新集结（不打）

// ═══════════════════════════════════════════════════════════
// §7. FocusFireSnapshot — 纯函数输入
// ═══════════════════════════════════════════════════════════

/**
 * FocusFireSnapshot — planFocusFire() 的唯一输入。
 *
 * 系统层薄壳负责构建此快照并注入。
 * 包含：Squad 成员状态 + 目标候选列表 + 上 tick 计划 + 授权信息。
 */
export interface FocusFireSnapshot {
  /** 当前 tick。 */
  readonly tick: number;
  /** 编队 ID。 */
  readonly squadId: string;
  /** Objective ID。 */
  readonly objectiveId: string;
  /** Squad Anchor 位置 packed pos。 */
  readonly anchorPos: number;
  /** Squad Anchor 所在房间。 */
  readonly anchorRoom: string;
  /** 当前 TacticalState（Squad 级）。 */
  readonly tacticalState: TacticalState;
  /** Target Scope（来自 Objective）。 */
  readonly targetScope: TargetScope;
  /** 授权的目标房间（Tactical 不得越界）。 */
  readonly authorizedTargetRoom: string;
  /** WarPosture（非 war 禁止进攻 Intent）。 */
  readonly warPosture: string;
  /** 目标候选列表。 */
  readonly candidates: readonly TargetCandidate[];
  /** 编队成员战斗能力快照。 */
  readonly members: readonly FocusFireMemberSnapshot[];
  /** 上 tick 的 FocusFirePlan（用于状态机连续性）。 */
  readonly prevPlan: FocusFirePlan | null;
  /** 凝聚力状态（来自 A5.4.2 CohesionMetric.status）。 */
  readonly cohesionStatus: string;
  /** 是否在交战范围内（来自 Formation）。 */
  readonly inEngagementRange: boolean;
}

/** 编队成员快照 — Focus Fire 需要的成员信息。 */
export interface FocusFireMemberSnapshot {
  /** Creep 名称。 */
  readonly name: string;
  /** 角色。 */
  readonly role: string;
  /** 战斗能力（来自 A5.1 G2 CombatCapability）。 */
  readonly capability: CombatCapability;
  /** 当前位置 packed pos。 */
  readonly pos: number;
  /** 所在房间。 */
  readonly room: string;
  /** 当前血量。 */
  readonly hits: number;
  /** 最大血量。 */
  readonly hitsMax: number;
  /** 是否存活。 */
  readonly alive: boolean;
}

// ═══════════════════════════════════════════════════════════
// §8. 核心纯函数 — planFocusFire
// ═══════════════════════════════════════════════════════════

/**
 * planFocusFire — 从 Snapshot 产出 FocusFirePlan + AttackIntent[]。
 *
 * 决策链：
 *   1. 授权 / 姿态检查 → 非 war 或 RETREATING → 禁止 AttackIntent
 *   2. TargetScope 检查 → 越界目标拒绝
 *   3. 凝聚力检查 → BROKEN → REGROUP
 *   4. 状态机连续性 → 从 prevPlan 推导 EngagementState
 *   5. 目标候选排序 → 多维评分（非单一 powerScore）
 *   6. Overkill 计算 → 分配 attacker（不全部集中一个目标）
 *   7. Attack Assignment → 每个 attacker 分配目标
 *   8. HealCoverage 评估
 *   9. EnemyHealSupport 评估
 *   10. 产出 FocusFirePlan + AttackIntent[]
 *
 * 纯函数 — 相同输入必产生相同输出。
 */
export function planFocusFire(snapshot: FocusFireSnapshot): FocusFirePlan {
  const { tick, squadId, objectiveId, tacticalState, targetScope, warPosture, candidates, members, prevPlan, cohesionStatus, authorizedTargetRoom } = snapshot;

  const rejected: RejectedTarget[] = [];
  const evidence: string[] = [];

  // ── 1. 授权 / 姿态检查 ──
  // 非 war 姿态 → 禁止进攻 Intent
  if (warPosture !== "war") {
    evidence.push(`warPosture=${warPosture} (requires war for offensive)`);
    return buildEmptyPlan(
      squadId, objectiveId, tick,
      "IDLE",
      `warPosture=${warPosture} → no offensive intent`,
      evidence, rejected, prevPlan,
    );
  }

  // RETREATING / DISENGAGING / REGROUPING / ABORTED → 禁止 AttackIntent
  if (tacticalState === "RETREATING" || tacticalState === "DISENGAGING" || tacticalState === "ABORTED") {
    evidence.push(`tacticalState=${tacticalState} → no attack intent`);
    return buildEmptyPlan(
      squadId, objectiveId, tick,
      "REGROUP",
      `tacticalState=${tacticalState} → disengage`,
      evidence, rejected, prevPlan,
    );
  }

  // ── 2. 凝聚力检查 ──
  if (cohesionStatus === "BROKEN" || cohesionStatus === "CRITICAL") {
    evidence.push(`cohesion=${cohesionStatus} → regroup before engagement`);
    return buildEmptyPlan(
      squadId, objectiveId, tick,
      "REGROUP",
      `cohesion ${cohesionStatus} → regroup`,
      evidence, rejected, prevPlan,
    );
  }

  // ── 3. 目标候选过滤 + TargetScope 验证 ──
  const validCandidates = candidates.filter(c => {
    // 目标必须授权目标房间内
    if (c.room !== authorizedTargetRoom) {
      rejected.push({ targetId: c.id, reason: `room=${c.room} outside authorized=${authorizedTargetRoom}` });
      return false;
    }
    // 目标必须可达（非 INVALID / BLOCKED）
    if (c.accessibility === "INVALID") {
      rejected.push({ targetId: c.id, reason: "target invalid" });
      return false;
    }
    return true;
  });

  if (validCandidates.length === 0) {
    evidence.push("no valid candidates after scope filter");
    return buildEmptyPlan(
      squadId, objectiveId, tick,
      "IDLE",
      "no valid engagement targets",
      evidence, rejected, prevPlan,
    );
  }

  // ── 4. 状态机连续性 ──
  const engagementState = deriveEngagementState(snapshot, prevPlan);

  // TARGET_DEAD / TARGET_LOST / REASSESSING → 重新选择目标
  // REGROUP → 不产出攻击
  if (engagementState === "REGROUP") {
    return buildEmptyPlan(
      squadId, objectiveId, tick,
      "REGROUP",
      "engagement state REGROUP",
      evidence, rejected, prevPlan,
    );
  }

  // ── 5. 目标候选多维评分 + 排序 ──
  const scored = validCandidates.map(c => ({
    candidate: c,
    score: scoreCandidate(c, snapshot),
  }));

  // 确定性排序：tacticalPriority 降序 → effectiveHP 分数降序（越脆越优） → distance 升序 → id 字典序
  scored.sort((a, b) => {
    const pa = a.score.tacticalPriority;
    const pb = b.score.tacticalPriority;
    if (pa !== pb) return pb - pa;
    const ha = a.score.effectiveHP;
    const hb = b.score.effectiveHP;
    if (ha !== hb) return hb - ha;
    const da = a.score.distance;
    const db = b.score.distance;
    if (da !== db) return db - da;
    return a.candidate.id < b.candidate.id ? -1 : 1;
  });

  const primary = scored[0]!.candidate;
  evidence.push(`primary target=${primary.id} (priority=${primary.tacticalValue.tacticalPriority})`);

  // ── 6. Overkill 计算 ──
  const aliveAttackers = members.filter(m => m.alive && (m.role === "attacker" || m.role === "ranged"));
  const aliveHealers = members.filter(m => m.alive && m.role === "healer");

  // 计算每个 attacker 对主目标的预期伤害
  const attackerDamages = aliveAttackers.map(a => ({
    name: a.name,
    role: a.role,
    damage: computeExpectedDamage(a, primary, snapshot),
    inRange: isInRange(a, primary),
  }));

  const totalDamage = attackerDamages.reduce((s, a) => s + a.damage, 0);
  const targetEffectiveHP = primary.effectiveHP;

  // Overkill 判断：总伤害 > 目标有效 HP × 1.5 → 需要分流
  const overkillThreshold = targetEffectiveHP * 1.5;
  const needsRedistribution = totalDamage > overkillThreshold;

  // ── 7. Attack Assignment ──
  const attackIntents: AttackIntent[] = [];
  let assignedToPrimary: string[] = [];
  let assignedToSecondary: string[] = [];

  if (needsRedistribution && scored.length > 1) {
    // 分流：计算需要多少 attacker 击杀主目标，多余的分配给次目标
    const secondary = scored[1]!.candidate;
    const requiredForPrimary = Math.max(1, Math.ceil(targetEffectiveHP / Math.max(1, attackerDamages[0]!.damage)));

    // 按伤害降序排序（高伤害优先分配给主目标）
    const sortedAttackers = [...attackerDamages].sort((a, b) => {
      if (b.damage !== a.damage) return b.damage - a.damage;
      return a.name < b.name ? -1 : 1;
    });

    for (let i = 0; i < sortedAttackers.length; i++) {
      const a = sortedAttackers[i]!;
      if (i < requiredForPrimary) {
        assignedToPrimary.push(a.name);
        attackIntents.push(buildAttackIntent(a, primary, "PRIMARY", tick, squadId));
      } else {
        assignedToSecondary.push(a.name);
        attackIntents.push(buildAttackIntent(a, secondary, "SECONDARY", tick, squadId));
      }
    }

    evidence.push(`overkill: totalDamage=${totalDamage} > threshold=${overkillThreshold.toFixed(0)} → ${requiredForPrimary} primary, ${sortedAttackers.length - requiredForPrimary} secondary`);
  } else {
    // 不需要分流：全部分配给主目标
    for (const a of attackerDamages) {
      assignedToPrimary.push(a.name);
      attackIntents.push(buildAttackIntent(a, primary, "PRIMARY", tick, squadId));
    }
  }

  // ── 8. HealCoverage 评估 ──
  const healCoverage = assessHealCoverage(members, squadId);

  // ── 9. EnemyHealSupport 评估 ──
  const enemyHealSupport = assessEnemyHealSupport(primary, candidates, totalDamage);

  // ── 10. 计算 overkillRisk ──
  const overkillRisk = computeOverkillRisk(totalDamage, targetEffectiveHP);

  // ── 构建最终 Plan ──
  const plan: FocusFirePlan = {
    squadId,
    objectiveId,
    primaryTargetId: primary.id,
    primaryTargetPos: primary.pos,
    primaryTargetPriority: "PRIMARY",
    secondaryTargetId: assignedToSecondary.length > 0 ? scored[1]!.candidate.id : null,
    assignedAttackers: assignedToPrimary.filter(n => attackerDamages.find(a => a.name === n && a.role === "attacker")),
    assignedRanged: assignedToPrimary.filter(n => attackerDamages.find(a => a.name === n && a.role === "ranged")),
    assignedHealers: aliveHealers.map(h => h.name),
    expectedDamage: totalDamage,
    expectedHeal: healCoverage?.expectedHeal ?? 0,
    targetEffectiveHP,
    overkillRisk,
    enemyHealSupport,
    healCoverage,
    confidence: computeConfidence(snapshot, primary, totalDamage),
    reason: evidence.join("; "),
    rejectedTargets: rejected,
    tick,
    decisionHash: "",
    attackIntents,
    engagementState,
  };

  return { ...plan, decisionHash: focusFirePlanHash(plan) };
}

// ═══════════════════════════════════════════════════════════
// §9. 辅助纯函数
// ═══════════════════════════════════════════════════════════

/** 构建空 Plan（无目标时的 fallback）。 */
function buildEmptyPlan(
  squadId: string,
  objectiveId: string,
  tick: number,
  state: EngagementState,
  reason: string,
  evidence: string[],
  rejected: readonly RejectedTarget[],
  prevPlan: FocusFirePlan | null,
): FocusFirePlan {
  const plan: FocusFirePlan = {
    squadId,
    objectiveId,
    primaryTargetId: null,
    primaryTargetPos: null,
    primaryTargetPriority: "NO_TARGET",
    secondaryTargetId: null,
    assignedAttackers: [],
    assignedRanged: [],
    assignedHealers: [],
    expectedDamage: 0,
    expectedHeal: 0,
    targetEffectiveHP: 0,
    overkillRisk: 0,
    enemyHealSupport: null,
    healCoverage: null,
    confidence: 0,
    reason: `${reason} | evidence: ${evidence.join(", ")}`,
    rejectedTargets: rejected,
    tick,
    decisionHash: "",
    attackIntents: [],
    engagementState: state,
  };
  return { ...plan, decisionHash: focusFirePlanHash(plan) };
}

/** 多维评分 — 禁止单一 powerScore。 */
function scoreCandidate(c: TargetCandidate, snapshot: FocusFireSnapshot): TacticalValueBreakdown {
  // 1. Threat 维度
  const threat = c.threat;

  // 2. Accessibility 维度（可达性越好分数越高）
  const accessibilityMap: Record<TargetAccessibility, number> = {
    IN_MELEE_RANGE: 100,
    IN_RANGED_RANGE: 80,
    IN_ENGAGEMENT_RANGE: 50,
    OUT_OF_RANGE: 10,
    BLOCKED: 0,
    INVALID: 0,
  };
  const accessibility = accessibilityMap[c.accessibility];

  // 3. EffectiveHP 维度（越脆分数越高，使用反比）
  const effectiveHP = c.effectiveHP > 0 ? 10000 / c.effectiveHP : 0;

  // 4. ExpectedDamage 维度（由调用方在 planFocusFire 中精细计算，这里用粗略估计）
  const expectedDamage = c.attackCapability + c.rangedCapability;

  // 5. Overkill 维度（在 planFocusFire 中计算，这里用 0 占位）
  const overkill = 0;

  // 6. EnemyHealSupport 维度（在 planFocusFire 中评估，这里用粗略估计）
  const enemyHealSupport = c.healCapability;

  // 7. Distance 维度（越近分数越高）
  const distance = c.distance > 0 ? 100 / c.distance : 100;

  // 8. Position 维度（简化：在目标房内即为好位置）
  const position = c.room === snapshot.authorizedTargetRoom ? 50 : 0;

  // 9. TacticalPriority 维度（healer 优先 > 高伤害 > 残血 > 其他）
  let tacticalPriority = 50; // 基础优先级
  if (c.role === "healer") tacticalPriority = 100; // 治疗者优先
  else if (c.attackCapability > 0 || c.rangedCapability > 0) tacticalPriority = 70; // 武装单位
  else if (c.hp < c.maxHp * 0.3) tacticalPriority = 60; // 残血优先
  else tacticalPriority = 30; // 其他

  // Boost 加成
  if (c.boosted && c.boostTier >= 2) tacticalPriority += 10;

  return {
    threat,
    accessibility,
    effectiveHP,
    expectedDamage,
    overkill,
    enemyHealSupport,
    distance,
    position,
    tacticalPriority,
  };
}

/** 计算成员对目标的预期伤害/tick。 */
function computeExpectedDamage(
  member: FocusFireMemberSnapshot,
  target: TargetCandidate,
  _snapshot: FocusFireSnapshot,
): number {
  const cap = member.capability;
  // 根据距离决定可用攻击方式
  const dist = chebyshevDist(member.pos, target.pos);
  const sameRoom = member.room === target.room;

  if (!sameRoom) return 0; // 跨房无法攻击

  let damage = 0;
  if (dist <= 1) {
    // 近身攻击
    damage += cap.attack;
  }
  if (dist <= 3) {
    // 远程攻击
    damage += cap.rangedAttack;
  }
  // dismantle 对建筑有效（但 target 是 creep 时无效）
  // 这里只处理 creep 目标

  return damage;
}

/** 成员是否在目标攻击范围内。 */
function isInRange(member: FocusFireMemberSnapshot, target: TargetCandidate): boolean {
  if (member.room !== target.room) return false;
  const dist = chebyshevDist(member.pos, target.pos);
  return dist <= 3; // 最大 ranged attack 范围
}

/** 构建 AttackIntent。 */
function buildAttackIntent(
  attacker: { name: string; role: string; damage: number; inRange: boolean },
  target: TargetCandidate,
  priority: TargetPriority,
  tick: number,
  squadId: string,
): AttackIntent {
  // 决定攻击类型
  let attackType: AttackType;
  if (!attacker.inRange) {
    attackType = "NO_ATTACK";
  } else if (attacker.role === "ranged") {
    attackType = "RANGED_ATTACK";
  } else if (attacker.role === "dismantler") {
    attackType = "DISMANTLE";
  } else {
    // attacker — 检查距离决定 melee 还是 ranged
    attackType = "ATTACK"; // 简化：attacker 默认近身
  }

  const targetExpectedHP = Math.max(0, target.effectiveHP - attacker.damage);

  return {
    squadId,
    creepId: attacker.name,
    targetId: target.id,
    targetPos: target.pos,
    targetRoom: target.room,
    attackType,
    priority,
    expectedDamage: attacker.damage,
    targetExpectedHP,
    reason: `assigned to ${priority} target ${target.id}`,
    confidence: 0.8,
    tick,
    requiresMovement: !attacker.inRange,
  };
}

/** 计算 overkill 风险（0-1）。 */
function computeOverkillRisk(totalDamage: number, targetEffectiveHP: number): number {
  if (targetEffectiveHP <= 0) return 0;
  if (totalDamage <= targetEffectiveHP) return 0;
  // 过量部分 / 总伤害 = overkill 风险
  const overkill = totalDamage - targetEffectiveHP;
  return Math.min(1, overkill / totalDamage);
}

/** 评估编队治疗覆盖。 */
function assessHealCoverage(
  members: readonly FocusFireMemberSnapshot[],
  squadId: string,
): HealCoverage | null {
  const aliveHealers = members.filter(m => m.alive && m.role === "healer");
  const wounded = members.filter(m => m.alive && m.hits < m.hitsMax);

  if (aliveHealers.length === 0) {
    return {
      squadId,
      healerCount: 0,
      woundedCount: wounded.length,
      expectedHeal: 0,
      healSupportDemand: wounded.reduce((s, m) => s + (m.hitsMax - m.hits), 0),
      coverageRatio: 0,
      retreatRecommended: wounded.length > 0,
      reason: "no alive healers",
    };
  }

  const expectedHeal = aliveHealers.reduce((s, h) => s + h.capability.heal, 0);
  const healSupportDemand = wounded.reduce((s, m) => s + (m.hitsMax - m.hits), 0);
  const coverageRatio = healSupportDemand > 0 ? expectedHeal / healSupportDemand : 1;

  return {
    squadId,
    healerCount: aliveHealers.length,
    woundedCount: wounded.length,
    expectedHeal,
    healSupportDemand,
    coverageRatio,
    retreatRecommended: coverageRatio < 0.3 && wounded.length > 0,
    reason: `${aliveHealers.length} healers, ${wounded.length} wounded, ratio=${coverageRatio.toFixed(2)}`,
  };
}

/** 评估敌方对目标的 heal 支持。 */
function assessEnemyHealSupport(
  target: TargetCandidate,
  allCandidates: readonly TargetCandidate[],
  ourDamage: number,
): EnemyHealSupport | null {
  // 找到在目标治疗范围内的敌方 healer
  // HEAL range = 1 (melee heal), RANGED_HEAL range = 3
  const healers = allCandidates.filter(c =>
    c.id !== target.id &&
    c.healCapability > 0 &&
    c.room === target.room &&
    chebyshevDist(c.pos, target.pos) <= 3,
  );

  const totalHealPerTick = healers.reduce((s, h) => s + h.healCapability, 0);
  const netDamage = Math.max(0, ourDamage - totalHealPerTick);
  const killDifficultyTicks = netDamage > 0 ? Math.ceil(target.effectiveHP / netDamage) : Infinity;
  const effectivelyUnkillable = netDamage <= 0;

  return {
    targetId: target.id,
    healerCount: healers.length,
    totalHealPerTick,
    killDifficultyTicks,
    effectivelyUnkillable,
    reason: `${healers.length} enemy healers, heal=${totalHealPerTick}/t, netDamage=${netDamage}/t, killTicks=${killDifficultyTicks === Infinity ? "INF" : killDifficultyTicks}`,
  };
}

/**
 * 推导 EngagementState — 从上 tick 的 Plan + 当前 Snapshot 推导。
 *
 * 状态流：
 *   无 prevPlan → IDLE
 *   prevPlan.primaryTargetId 在当前候选中存在:
 *     hp > 30% maxHp → ATTACKING
 *     hp ≤ 30% maxHp → TARGET_DYING
 *     hp ≤ 0 或不在候选中 → TARGET_DEAD（或 TARGET_LOST）
 *   prevPlan.primaryTargetId 不在当前候选中:
 *     OUT_OF_RANGE → TARGET_OUT_OF_RANGE
 *     其他 → TARGET_LOST
 *
 * TARGET_DEAD / TARGET_LOST → REASSESSING（本 tick 重新选择目标）
 * REASSESSING → TARGET_ACQUIRED（选到新目标后）
 */
function deriveEngagementState(
  snapshot: FocusFireSnapshot,
  prevPlan: FocusFirePlan | null,
): EngagementState {
  // 无前序计划 → IDLE（首次选择目标）
  if (!prevPlan || !prevPlan.primaryTargetId) {
    return "IDLE";
  }

  // 非 ENGAGING 状态 → 不进入 Focus Fire 状态机
  if (snapshot.tacticalState !== "ENGAGING" && snapshot.tacticalState !== "POSITIONING") {
    return "IDLE";
  }

  // 检查主目标是否仍在候选列表中
  const prevTarget = snapshot.candidates.find(c => c.id === prevPlan.primaryTargetId);

  if (!prevTarget) {
    // 目标不在候选列表 — 可能死亡或离开视野
    // 检查是否有 OUT_OF_RANGE 候选匹配
    const outOfRangeMatch = snapshot.candidates.find(c =>
      c.id === prevPlan.primaryTargetId && c.accessibility === "OUT_OF_RANGE",
    );
    if (outOfRangeMatch) {
      return "TARGET_OUT_OF_RANGE";
    }
    return "TARGET_LOST";
  }

  // 目标仍在 — 检查 HP 状态
  if (prevTarget.hp <= 0) {
    return "TARGET_DEAD";
  }
  if (prevTarget.hp < prevTarget.maxHp * 0.3) {
    return "TARGET_DYING";
  }

  // 目标仍然存活且 HP > 30% → 继续攻击
  return "ATTACKING";
}

/** 计算决策置信度。 */
function computeConfidence(
  snapshot: FocusFireSnapshot,
  target: TargetCandidate,
  totalDamage: number,
): number {
  let conf = 0.5; // 基础置信度

  // 伤害足够 → +0.3
  if (totalDamage > target.effectiveHP) {
    conf += 0.3;
  } else if (totalDamage > target.effectiveHP * 0.5) {
    conf += 0.15;
  }

  // 目标在射程内 → +0.1
  if (target.accessibility === "IN_MELEE_RANGE" || target.accessibility === "IN_RANGED_RANGE") {
    conf += 0.1;
  }

  // 凝聚力好 → +0.1
  if (snapshot.cohesionStatus === "INTACT") {
    conf += 0.1;
  }

  return Math.min(1, conf);
}

/**
 * 焦点射击状态机转换验证。
 *
 * 验证 EngagementState 转换是否合法。
 */
const VALID_ENGAGEMENT_TRANSITIONS: Record<EngagementState, readonly EngagementState[]> = {
  IDLE: ["TARGET_ACQUIRED", "REGROUP"],
  TARGET_ACQUIRED: ["ATTACKING", "TARGET_LOST", "REGROUP"],
  ATTACKING: ["TARGET_DYING", "TARGET_DEAD", "TARGET_LOST", "TARGET_OUT_OF_RANGE", "TARGET_ESCAPED", "TARGET_BLOCKED", "REGROUP"],
  TARGET_DYING: ["TARGET_DEAD", "TARGET_LOST", "ATTACKING"],
  TARGET_DEAD: ["REASSESSING"],
  TARGET_LOST: ["REASSESSING", "REGROUP"],
  TARGET_OUT_OF_RANGE: ["REQUEST_MOVEMENT", "TARGET_ESCAPED", "REASSESSING", "ATTACKING"],
  TARGET_ESCAPED: ["REASSESSING", "REGROUP"],
  TARGET_BLOCKED: ["REASSESSING", "REGROUP"],
  REASSESSING: ["TARGET_ACQUIRED", "IDLE", "REGROUP"],
  REQUEST_MOVEMENT: ["ATTACKING", "TARGET_OUT_OF_RANGE", "REASSESSING"],
  REGROUP: ["IDLE", "TARGET_ACQUIRED"],
};

export function canTransitionEngagement(from: EngagementState, to: EngagementState): boolean {
  const allowed = VALID_ENGAGEMENT_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

// ═══════════════════════════════════════════════════════════
// §10. 确定性 Hash
// ═══════════════════════════════════════════════════════════

/**
 * 计算 FocusFirePlan 的确定性 Hash。
 *
 * 相同 Snapshot → 相同 Plan → 相同 Hash。
 * 用于验证确定性（1000 次 Replay → Hash 完全一致）。
 */
export function focusFirePlanHash(plan: FocusFirePlan): string {
  const payload = JSON.stringify({
    sq: plan.squadId,
    obj: plan.objectiveId,
    pt: plan.primaryTargetId ?? "",
    pp: plan.primaryTargetPos ?? 0,
    st: plan.secondaryTargetId ?? "",
    aa: plan.assignedAttackers.join(","),
    ar: plan.assignedRanged.join(","),
    ah: plan.assignedHealers.join(","),
    ed: plan.expectedDamage,
    eh: plan.expectedHeal,
    hp: plan.targetEffectiveHP,
    ok: plan.overkillRisk.toFixed(3),
    cf: plan.confidence.toFixed(3),
    es: plan.engagementState,
    ai: plan.attackIntents.length,
    t: plan.tick,
  });
  return fnv1a32Hex(payload);
}

/** 切比雪夫距离（Screeps 使用的距离公式）。 */
function chebyshevDist(pos1: number, pos2: number): number {
  const x1 = Math.floor(pos1 / 50);
  const y1 = pos1 % 50;
  const x2 = Math.floor(pos2 / 50);
  const y2 = pos2 % 50;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

/** FNV-1a 32-bit hash（确定性，无 Math.random）。 */
function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ═══════════════════════════════════════════════════════════
// §11. 构建辅助函数（供系统层薄壳使用）
// ═══════════════════════════════════════════════════════════

/**
 * 从 EnemySnapshot + CombatCapability 构建 TargetCandidate。
 *
 * 系统层薄壳调用此函数将 Runtime 数据转换为 Domain 输入。
 */
export function buildTargetCandidate(
  enemyId: string,
  enemyPos: number,
  enemyRoom: string,
  enemyRole: string,
  enemyHits: number,
  enemyHitsMax: number,
  enemyCapability: CombatCapability,
  threatScore: number,
  anchorPos: number,
  anchorRoom: string,
  lastSeenTick: number,
): TargetCandidate {
  // 计算可达性
  const sameRoom = enemyRoom === anchorRoom;
  const dist = sameRoom ? chebyshevDist(enemyPos, anchorPos) : Infinity;

  let accessibility: TargetAccessibility;
  if (enemyHits <= 0) {
    accessibility = "INVALID";
  } else if (!sameRoom) {
    accessibility = "OUT_OF_RANGE";
  } else if (dist <= 1) {
    accessibility = "IN_MELEE_RANGE";
  } else if (dist <= 3) {
    accessibility = "IN_RANGED_RANGE";
  } else if (dist <= 5) {
    accessibility = "IN_ENGAGEMENT_RANGE";
  } else {
    accessibility = "OUT_OF_RANGE";
  }

  // 有效 HP（含 tough 减伤）
  const toughReduction = enemyCapability.toughParts > 0
    ? 1 / Math.max(0.1, enemyCapability.toughParts * 0.1) // 简化估计
    : 1;
  const effectiveHP = Math.floor(enemyHits * toughReduction);

  // 推断角色
  let role = enemyRole;
  if (!role || role === "unknown") {
    if (enemyCapability.heal > 0) role = "healer";
    else if (enemyCapability.rangedAttack > 0) role = "ranged";
    else if (enemyCapability.attack > 0) role = "attacker";
    else role = "unknown";
  }

  const tacticalValue: TacticalValueBreakdown = {
    threat: threatScore,
    accessibility: dist === Infinity ? 0 : Math.max(0, 100 - dist * 10),
    effectiveHP: effectiveHP > 0 ? 10000 / effectiveHP : 0,
    expectedDamage: enemyCapability.attack + enemyCapability.rangedAttack,
    overkill: 0,
    enemyHealSupport: enemyCapability.heal,
    distance: dist === Infinity ? 0 : Math.max(0, 100 - dist * 10),
    position: 50,
    tacticalPriority: role === "healer" ? 100 : (enemyCapability.attack > 0 || enemyCapability.rangedAttack > 0 ? 70 : 30),
  };

  return {
    id: enemyId,
    pos: enemyPos,
    room: enemyRoom,
    role,
    hp: enemyHits,
    maxHp: enemyHitsMax,
    effectiveHP,
    attackCapability: enemyCapability.attack,
    rangedCapability: enemyCapability.rangedAttack,
    healCapability: enemyCapability.heal,
    mobility: enemyCapability.mobility,
    threat: threatScore,
    distance: dist === Infinity ? 999 : dist,
    accessibility,
    tacticalValue,
    boosted: enemyCapability.boosted,
    boostTier: enemyCapability.maxBoostTier,
    lastSeenTick,
  };
}