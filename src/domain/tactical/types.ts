/** A5.4.0 Tactical Combat — Domain Type Definitions. */

import type { CombatCapability, AggregateCapability } from "../combat/capability";
import type { TerrainContext, EffectiveCombatModifier } from "../defense/terrain-context";
import type { MultiDimensionalConfidence } from "../defense/confidence";
import type { PlayerIntelRecord, IntelConfidence } from "../defense/player-intel";
import type { AbortCondition } from "../military/operation";

// ═══════════════════════════════════════════════════════════
// §1. TacticalObjective — Operational Objective 的 Tactical 投影
// ═══════════════════════════════════════════════════════════

/** Tactical 目标类型 — Operational Objective 在战术层的投影。 */
export type TacticalObjectiveType =
  | "ENGAGE_ENEMY"        // 接敌
  | "DESTROY_STRUCTURE"   // 摧毁建筑
  | "DEFEND_POSITION"     // 防守阵位
  | "ESCORT"              // 护航
  | "HARASS"              // 骚扰
  | "DISMANTLE"           // 拆除
  | "BREACH"              // 突破
  | "HOLD_GROUND"         // 据守
  | "REINFORCE"           // 增援
  | "WITHDRAW";           // 撤出

/** 目标范围 — Tactical 严格受限的越权边界。 */
export type TargetScope =
  | "LOCAL"        // 当前视野内的局部目标排序（如先打 Tower A 还是 Tower B）
  | "OPERATIONAL"  // Operational 层指定的目标（如 Enemy Tower Cluster）
  | "STRATEGIC";   // Strategic 层目标（Tactical 禁止自行切换）

/** Tactical 目标的目标类型。 */
export type TacticalTargetType =
  | "creep"        // 敌方 creep
  | "structure"    // 敌方建筑
  | "controller"   // controller
  | "position"     // 阵位
  | "room";        // 房间级

/** TacticalObjective — 一个 Operational Objective 在战术层的投影。 */
export interface TacticalObjective {
  /** 唯一标识。 */
  readonly objectiveId: string;
  /** 所属 Operation ID。 */
  readonly operationId: string;
  /** 战术目标类型。 */
  readonly objectiveType: TacticalObjectiveType;
  /** 目标 ID（结构/creep 的 ID 或 packed pos）。 */
  readonly targetId: string;
  /** 目标类型。 */
  readonly targetType: TacticalTargetType;
  /** 目标范围 — Tactical 只能在 LOCAL 范围内排序。 */
  readonly targetScope: TargetScope;
  /** 授权状态。 */
  readonly authorization: TacticalAuthorization;
  /** 优先级（0-100，越高越优先）。 */
  readonly priority: number;
  /** 约束条件。 */
  readonly constraints: TacticalConstraints;
  /** 截止 tick。 */
  readonly deadline: number;
  /** 止损条件（消费 Operational AbortCondition）。 */
  readonly abortConditions: readonly AbortCondition[];
  /** 证据链。 */
  readonly evidence: string[];
  /** 创建 tick。 */
  readonly tick: number;
}

// ═══════════════════════════════════════════════════════════
// §2. TacticalAuthorization — 授权验证
// ═══════════════════════════════════════════════════════════

/** 授权状态。 */
export type AuthorizationState =
  | "PENDING"     // 待授权
  | "AUTHORIZED"  // 已授权
  | "EXPIRED"     // 授权过期
  | "REVOKED"     // 授权撤销（WarPlan abort / posture 变更）
  | "DENIED";     // 授权拒绝

/** TacticalAuthorization — 确认 Tactical 只在 WarPlan 授权下执行。 */
export interface TacticalAuthorization {
  /** 授权状态。 */
  readonly state: AuthorizationState;
  /** 关联 Operation ID。 */
  readonly operationId: string;
  /** 关联 WarPlan 的 posture（必须为 war 或 fortify 才授权进攻）。 */
  readonly warPosture: string;
  /** 目标房间（必须与 Operational target 一致）。 */
  readonly targetRoom: string;
  /** 授权过期 tick。 */
  readonly expiry: number;
  /** Operation 的 abort 状态（已 abort 则授权自动撤销）。 */
  readonly operationAborted: boolean;
  /** 授权原因。 */
  readonly reason: string;
}

// ═══════════════════════════════════════════════════════════
// §3. TacticalConstraints
// ═══════════════════════════════════════════════════════════

/** Tactical 约束 — 来自 Operational 层，Tactical 不可自行放宽。 */
export interface TacticalConstraints {
  /** 最大允许 CPU/tick。 */
  readonly maxCpuPerTick: number;
  /** 最大能量预算。 */
  readonly maxEnergyBudget: number;
  /** 最大持续时间（tick）。 */
  readonly maxDuration: number;
  /** 最小 IntelConfidence 要求。 */
  readonly minIntelConfidence: number;
  /** 是否允许 boost。 */
  readonly allowBoost: boolean;
  /** 是否允许追击（跨房追击需 Operational 授权）。 */
  readonly allowPursuit: boolean;
  /** 最大追击距离（格数）。 */
  readonly maxPursuitDistance: number;
}

// ═══════════════════════════════════════════════════════════
// §4. TacticalState — 战术状态机
// ═══════════════════════════════════════════════════════════

/**
 * TacticalState — Squad 的战术生命周期。

 * 设计理由（与 OperationStatus 区分）：
 * - OperationStatus 是 Operational 层的宏观生命周期（PLANNED → ACTIVE → COMPLETED）。
 * - TacticalState 是战术层的微观执行状态（FORMING → MOVING → ENGAGING → ...）。
 * - 一个 ACTIVE Operation 下的 Squad 可能在 FORMING / ENGAGING / RETREATING 之间反复切换。
 * - 新增 POSITIONING：Squad 到达目标房后需要在房内找到战术阵位（chokepoint / tower range edge），
 *   这是 MOVING（跨房行军）和 ENGAGING（接敌）之间的中间态——直接从 MOVING 跳到 ENGAGING
 *   会丢失"到达目标房但尚未接敌"的语义（此时应评估地形选择阵位而非直接冲向敌人）。
 * - 新增 DISENGAGING：从交战中脱离到撤退的中间态——Squad 需要先断开接战（拉开距离/阻断追击）
 *   再进入 RETREATING（撤退行军）。直接从 ENGAGING 跳到 RETREATING 会丢失"正在脱离接触"的语义。
 */
export type TacticalState =
  | "FORMING"       // 集结编队中
  | "MOVING"        // 跨房行军中
  | "POSITIONING"   // 到达目标房，选择战术阵位
  | "ENGAGING"      // 接敌交战中
  | "DISENGAGING"   // 脱离接触中
  | "RETREATING"    // 撤退行军中
  | "REGROUPING"    // 重新集结（被打散后重组）
  | "COMPLETED"     // 目标完成
  | "ABORTED";      // 目标中止

// ═══════════════════════════════════════════════════════════
// §5. SquadPlan — 编队计划
// ═══════════════════════════════════════════════════════════

/** Squad 成员快照 — 不持有 Runtime 对象。 */
export interface SquadMemberSnapshot {
  /** Creep 名称（稳定标识）。 */
  readonly name: string;
  /** 角色（attacker / healer / ranged / tank / dismantler）。 */
  readonly role: string;
  /** 当前位置 packed pos。 */
  readonly pos: number;
  /** 所在房间。 */
  readonly room: string;
  /** 当前血量。 */
  readonly hits: number;
  /** 最大血量。 */
  readonly hitsMax: number;
  /** 是否被 boost。 */
  readonly boosted: boolean;
  /** 剩余寿命。 */
  readonly ticksToLive?: number;
  /** 战斗能力快照。 */
  readonly capability: CombatCapability;
}

/** 阵型类型。 */
export type FormationType =
  | "LINE"      // 线形 — 开阔地形正面展开
  | "WEDGE"     // 楔形 — 开阔地形突击
  | "COLUMN"    // 纵队 — 狭窄通道行军
  | "CLUSTER"   // 密集 — 撤退/防守紧凑编队
  | "SCATTER";  // 散开 — 规避 AoE / 分散吸引火力

/** EngagementPolicy — 交战策略。 */
export interface EngagementPolicy {
  /** 接敌距离（格数）。 */
  readonly engageRange: number;
  /** 集火目标 ID（优先攻击的目标）。 */
  readonly focusTargetId?: string;
  /** 最低 HP 阈值（低于此值不主动接敌）。 */
  readonly minimumHpThreshold: number;
  /** 撤退血量阈值（0-1，低于此比例撤退）。 */
  readonly retreatThreshold: number;
  /** 重新集结阈值（0-1，存活成员低于此比例时 regroup）。 */
  readonly regroupThreshold: number;
  /** 治疗依赖（是否必须有存活 healer 才接敌）。 */
  readonly healerRequired: boolean;
  /** 敌方能力评估。 */
  readonly enemyCapability: AggregateCapability;
  /** 地形风险系数（0-1）。 */
  readonly terrainRisk: number;
  /** 情报置信度。 */
  readonly confidence: number;
}

/** RetreatPolicy — 撤退策略。 */
export interface RetreatPolicy {
  /** 撤退目标房间。 */
  readonly retreatRoom: string;
  /** 撤退血量阈值（0-1）。 */
  readonly threshold: number;
  /** 撤退路线质量要求。 */
  readonly minRetreatQuality: "VERY_GOOD" | "GOOD" | "POOR" | "CRITICAL" | "UNKNOWN";
  /** 是否允许断后（healer 留下掩护）。 */
  readonly allowRearguard: boolean;
}

/** RegroupPolicy — 重新集结策略。 */
export interface RegroupPolicy {
  /** 集结点房间。 */
  readonly regroupRoom: string;
  /** 集结点 packed pos。 */
  readonly regroupPos: number;
  /** 重新集结的成员比例阈值（0-1）。 */
  readonly memberRatioThreshold: number;
  /** 集结超时 tick。 */
  readonly timeoutTicks: number;
}

/** SquadPlan — 一个编队的完整战术计划。 */
export interface SquadPlan {
  /** 编队唯一标识。 */
  readonly squadId: string;
  /** 所属 Operation ID。 */
  readonly operationId: string;
  /** 所属 TacticalObjective ID。 */
  readonly objectiveId: string;
  /** 编队成员。 */
  readonly members: readonly SquadMemberSnapshot[];
  /** 成员角色映射。 */
  readonly roles: ReadonlyMap<string, string>;
  /** 阵型类型。 */
  readonly formation: FormationType;
  /** 交战策略。 */
  readonly engagementPolicy: EngagementPolicy;
  /** 撤退策略。 */
  readonly retreatPolicy: RetreatPolicy;
  /** 重新集结策略。 */
  readonly regroupPolicy: RegroupPolicy;
  /** 战术约束。 */
  readonly constraints: TacticalConstraints;
  /** 当前战术状态。 */
  readonly state: TacticalState;
  /** 创建 tick。 */
  readonly createdTick: number;
}

// ═══════════════════════════════════════════════════════════
// §6. TacticalSnapshot — 纯函数输入
// ═══════════════════════════════════════════════════════════

/** 敌方单位快照。 */
export interface EnemySnapshot {
  /** ID。 */
  readonly id: string;
  /** 名称/类型。 */
  readonly name: string;
  /** 位置 packed pos。 */
  readonly pos: number;
  /** 所在房间。 */
  readonly room: string;
  /** 血量。 */
  readonly hits: number;
  /** 最大血量。 */
  readonly hitsMax: number;
  /** 战斗能力。 */
  readonly capability: CombatCapability;
  /** 最后观测 tick。 */
  readonly lastSeenTick: number;
  /** 是否为 NPC。 */
  readonly isNpc: boolean;
}

/** 敌方建筑快照。 */
export interface EnemyStructureSnapshot {
  /** ID。 */
  readonly id: string;
  /** 结构类型。 */
  readonly structureType: string;
  /** 位置 packed pos。 */
  readonly pos: number;
  /** 所在房间。 */
  readonly room: string;
  /** 当前血量。 */
  readonly hits: number;
  /** 最大血量。 */
  readonly hitsMax: number;
  /** 价值分档（spawn/tower=4, storage=3, extension=2, other=1）。 */
  readonly valueTier: number;
}

/** TacticalSnapshot — 纯函数的唯一输入。 */
export interface TacticalSnapshot {
  /** 当前 tick。 */
  readonly tick: number;
  /** Squad 计划。 */
  readonly squad: SquadPlan;
  /** Tactical Objective。 */
  readonly objective: TacticalObjective;
  /** 敌方单位列表。 */
  readonly enemies: readonly EnemySnapshot[];
  /** 敌方建筑列表。 */
  readonly enemyStructures: readonly EnemyStructureSnapshot[];
  /** 地形上下文。 */
  readonly terrain: TerrainContext;
  /** 地形修正。 */
  readonly terrainModifier: EffectiveCombatModifier;
  /** 情报置信度。 */
  readonly confidence: MultiDimensionalConfidence;
  /** 玩家情报。 */
  readonly playerIntel?: PlayerIntelRecord;
  /** 我方编队聚合能力。 */
  readonly ourCapability: AggregateCapability;
  /** 我方编队 CombatPower（复用 A5.1）。 */
  readonly ourPower: {
    readonly burstDamage: number;
    readonly effectiveHP: number;
    readonly healOutput: number;
    readonly dismantlePower: number;
  };
}

// ═══════════════════════════════════════════════════════════
// §7. TacticalDecision — 纯函数输出
// ═══════════════════════════════════════════════════════════

/** 移动意图 — Domain 层只决定 Intent，不执行 Path。 */
export type MovementIntent =
  | "ADVANCE"    // 前进向目标
  | "HOLD"       // 原地据守
  | "FLANK"      // 侧翼包抄
  | "RETREAT"    // 撤退
  | "REGROUP"    // 重新集结
  | "POSITION";  // 移动到战术阵位

/** CombatIntent — 角色层执行的战斗意图。 */
export type CombatIntent =
  | "ATTACK"         // 近身攻击
  | "RANGED_ATTACK"  // 远程攻击
  | "HEAL"           // 治疗
  | "RANGED_HEAL"    // 远程治疗
  | "DISMANTLE"      // 拆除
  | "NONE";          // 无战斗动作（移动中）

/** TacticalDecision — 纯函数的输出。 */
export interface TacticalDecision {
  /** 新的战术状态。 */
  readonly newState: TacticalState;
  /** 移动意图。 */
  readonly movementIntent: MovementIntent;
  /** 战斗意图。 */
  readonly combatIntent: CombatIntent;
  /** 目标 ID（攻击/治疗/拆除目标）。 */
  readonly targetId?: string;
  /** 选择的阵型。 */
  readonly formation: FormationType;
  /** 决策原因。 */
  readonly reason: string;
  /** 证据链。 */
  readonly evidence: string[];
  /** 被拒绝的备选方案。 */
  readonly rejectedAlternatives: readonly RejectedTacticalAlternative[];
  /** 决策 Hash（确定性）。 */
  readonly decisionHash: string;
}

/** 被拒绝的战术备选方案。 */
export interface RejectedTacticalAlternative {
  readonly action: string;
  readonly reason: string;
}

// ═══════════════════════════════════════════════════════════
// §8. TacticalAbortSignal — 止损信号
// ═══════════════════════════════════════════════════════════

/** TacticalAbortReason — Tactical 层发现不可继续的原因。 */
export type TacticalAbortReason =
  | "SQUAD_BROKEN"             // 编队被打散
  | "HEALER_LOST"              // 治疗者损失
  | "ENEMY_CAPABILITY_SURGE"   // 敌方能力激增
  | "INTEL_STALE"              // 情报过期
  | "LOGISTICS_FAILURE"        // 后勤失败
  | "CASUALTY_EXCEEDED"        // 伤亡超限
  | "OBJECTIVE_UNACHIEVABLE"   // 目标不可达
  | "AUTHORIZATION_REVOKED";   // 授权撤销

/** TacticalAbortSignal — 交给 Operational / A4.6 处理。 */
export interface TacticalAbortSignal {
  /** 信号 ID。 */
  readonly signalId: string;
  /** 关联 Operation ID。 */
  readonly operationId: string;
  /** 关联 Objective ID。 */
  readonly objectiveId: string;
  /** 关联 Squad ID。 */
  readonly squadId: string;
  /** 止损原因。 */
  readonly reason: TacticalAbortReason;
  /** 信号产生 tick。 */
  readonly tick: number;
  /** 详细描述。 */
  readonly detail: string;
  /** 证据链。 */
  readonly evidence: string[];
}

// ═══════════════════════════════════════════════════════════
// §9. ForceShortage / ReinforcementDemand — Spawn 边界
// ═══════════════════════════════════════════════════════════

/** ForceShortage — 编队缺人信号。 */
export interface ForceShortage {
  /** 关联 Squad ID。 */
  readonly squadId: string;
  /** 关联 Operation ID。 */
  readonly operationId: string;
  /** 缺失角色。 */
  readonly role: string;
  /** 缺失数量。 */
  readonly count: number;
  /** 紧急程度（0-100）。 */
  readonly urgency: number;
  /** 原因。 */
  readonly reason: string;
}

/** ReinforcementDemand — 提交给 Spawn 的增援需求。 */
export interface ReinforcementDemand {
  /** 关联 Squad ID。 */
  readonly squadId: string;
  /** 关联 Operation ID。 */
  readonly operationId: string;
  /** 增援角色列表。 */
  readonly demands: readonly ForceShortage[];
  /** 目标房间（spawn 完成后前往的房间）。 */
  readonly targetRoom: string;
  /** 发起方房间（sponsor）。 */
  readonly sponsor: string;
  /** 产生 tick。 */
  readonly tick: number;
}

// ═══════════════════════════════════════════════════════════
// §10. SupplyDemand — Logistics 边界
// ═══════════════════════════════════════════════════════════

/** SupplyDemand — 提交给 Unified Logistics 的补给需求。 */
export interface SupplyDemand {
  /** 关联 Squad ID。 */
  readonly squadId: string;
  /** 关联 Operation ID。 */
  readonly operationId: string;
  /** 资源类型。 */
  readonly resource: string;
  /** 需求数量。 */
  readonly amount: number;
  /** 目标房间。 */
  readonly targetRoom: string;
  /** 优先级（0-3，0 最高）。 */
  readonly priority: 0 | 1 | 2 | 3;
  /** 产生 tick。 */
  readonly tick: number;
  /** 原因。 */
  readonly reason: string;
}

// ═══════════════════════════════════════════════════════════
// §11. TacticalDecisionTrace — A4.7 集成
// ═══════════════════════════════════════════════════════════

/** Tactical 决策事件类型 — 复用 A4.7 DecisionTrace。 */
export type TacticalDecisionEvent =
  | "TACTICAL_OBJECTIVE_ACCEPTED"
  | "TACTICAL_STATE_CHANGED"
  | "FORMATION_SELECTED"
  | "ENGAGEMENT_DECIDED"
  | "TARGET_SWITCHED"
  | "RETREAT_DECIDED"
  | "REGROUP_DECIDED"
  | "TACTICAL_ABORTED";

/** Tactical 决策事件记录。 */
export interface TacticalDecisionRecord {
  /** 事件类型。 */
  readonly event: TacticalDecisionEvent;
  /** 关联 Operation ID。 */
  readonly operationId: string;
  /** 关联 Objective ID。 */
  readonly objectiveId: string;
  /** 关联 Squad ID。 */
  readonly squadId?: string;
  /** 当前 tick。 */
  readonly tick: number;
  /** 决策原因。 */
  readonly reason: string;
  /** 量化证据。 */
  readonly evidence: string[];
  /** 置信度（0-1）。 */
  readonly confidence: number;
  /** 被拒绝的备选方案。 */
  readonly rejectedAlternatives: readonly RejectedTacticalAlternative[];
  /** 决策 Hash。 */
  readonly decisionHash: string;
}
