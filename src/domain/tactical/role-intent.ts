/**
 * Tactical Role Intent — A5.4.1 TacticalDecision → RoleAction 映射。
 *
 * 将 Tactical Domain 产出的 TacticalDecision（纯函数输出）
 * 转换为现有 RolePolicy 可消费的 RoleActionIntent。
 *
 * 设计原则：
 *   - Domain 只输出 Intent（MovementIntent / CombatIntent）
 *   - 本模块将 Intent 映射为 Role 可执行的结构化指令
 *   - Role 负责将指令转换为实际 Creep API 调用
 *   - 不创建第二套 Creep 行为系统
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / 任何 Runtime。
 */

import type {
  TacticalDecision,
  MovementIntent,
  CombatIntent,
  TacticalState,
  FormationType,
} from "./types";

// ═══════════════════════════════════════════════════════════
// §1. RoleActionIntent — 角色可执行的结构化指令
// ═══════════════════════════════════════════════════════════

/** 角色移动指令。 */
export type RoleMoveDirective =
  | "MOVE_TO_OBJECTIVE"     // 前进向目标
  | "HOLD_POSITION"         // 原地据守
  | "MOVE_TO_FLANK"         // 侧翼包抄
  | "RETREAT_TO_SAFE"       // 撤退到安全房
  | "MOVE_TO_REGROUP"       // 重新集结
  | "MOVE_TO_TACTICAL_POS"  // 移动到战术阵位
  | "BREAK_CONTACT"         // 脱离接触
  | "NO_MOVE";              // 不移动

/** 角色战斗指令。 */
export type RoleCombatDirective =
  | "ATTACK_TARGET"         // 攻击指定目标
  | "RANGED_ATTACK_TARGET"  // 远程攻击指定目标
  | "HEAL_TARGET"           // 治疗指定目标
  | "RANGED_HEAL_TARGET"    // 远程治疗指定目标
  | "DISMANTLE_TARGET"      // 拆除指定目标
  | "NO_COMBAT";            // 无战斗动作

/** RoleActionIntent — 映射后的角色指令。 */
export interface RoleActionIntent {
  /** 移动指令。 */
  readonly moveDirective: RoleMoveDirective;
  /** 战斗指令。 */
  readonly combatDirective: RoleCombatDirective;
  /** 目标 ID（攻击/治疗/拆除目标，如有）。 */
  readonly targetId?: string;
  /** 建议阵型。 */
  readonly formation: FormationType;
  /** 新的战术状态（供角色层状态同步）。 */
  readonly tacticalState: TacticalState;
  /** 决策原因（供 DecisionTrace）。 */
  readonly reason: string;
  /** 决策 Hash（确定性验证）。 */
  readonly decisionHash: string;
}

// ═══════════════════════════════════════════════════════════
// §2. TacticalDecision → RoleActionIntent 映射纯函数
// ═══════════════════════════════════════════════════════════

/**
 * 将 TacticalDecision 映射为 RoleActionIntent。
 *
 * 映射规则（明确对应关系）：
 *   ADVANCE  → MOVE_TO_OBJECTIVE
 *   HOLD     → HOLD_POSITION
 *   FLANK    → MOVE_TO_FLANK
 *   RETREAT  → RETREAT_TO_SAFE
 *   REGROUP  → MOVE_TO_REGROUP
 *   POSITION → MOVE_TO_TACTICAL_POS
 *
 *   ATTACK        → ATTACK_TARGET
 *   RANGED_ATTACK → RANGED_ATTACK_TARGET
 *   HEAL          → HEAL_TARGET
 *   RANGED_HEAL   → RANGED_HEAL_TARGET
 *   DISMANTLE     → DISMANTLE_TARGET
 *   NONE          → NO_COMBAT
 *
 * 纯函数 — 相同 Decision 必产生相同 Intent。
 */
export function mapDecisionToRoleIntent(decision: TacticalDecision): RoleActionIntent {
  return {
    moveDirective: mapMovementIntent(decision.movementIntent),
    combatDirective: mapCombatIntent(decision.combatIntent),
    targetId: decision.targetId,
    formation: decision.formation,
    tacticalState: decision.newState,
    reason: decision.reason,
    decisionHash: decision.decisionHash,
  };
}

/** MovementIntent → RoleMoveDirective 映射。 */
function mapMovementIntent(intent: MovementIntent): RoleMoveDirective {
  switch (intent) {
    case "ADVANCE":   return "MOVE_TO_OBJECTIVE";
    case "HOLD":      return "HOLD_POSITION";
    case "FLANK":     return "MOVE_TO_FLANK";
    case "RETREAT":   return "RETREAT_TO_SAFE";
    case "REGROUP":   return "MOVE_TO_REGROUP";
    case "POSITION":  return "MOVE_TO_TACTICAL_POS";
    default:          return "NO_MOVE";
  }
}

/** CombatIntent → RoleCombatDirective 映射。 */
function mapCombatIntent(intent: CombatIntent): RoleCombatDirective {
  switch (intent) {
    case "ATTACK":         return "ATTACK_TARGET";
    case "RANGED_ATTACK":  return "RANGED_ATTACK_TARGET";
    case "HEAL":           return "HEAL_TARGET";
    case "RANGED_HEAL":    return "RANGED_HEAL_TARGET";
    case "DISMANTLE":      return "DISMANTLE_TARGET";
    case "NONE":           return "NO_COMBAT";
    default:               return "NO_COMBAT";
  }
}

// ═══════════════════════════════════════════════════════════
// §3. TacticalObjective 生命周期状态
// ═══════════════════════════════════════════════════════════

/** TacticalObjective 运行时生命周期状态。 */
export type ObjectiveLifecycleState =
  | "CREATED"    // 刚创建，待验证
  | "ACCEPTED"   // 授权验证通过，待激活
  | "ACTIVE"     // 已激活，正在执行
  | "COMPLETED"  // 目标完成
  | "REJECTED"   // 授权验证失败
  | "ABORTED";   // 中止（止损 / 授权撤销 / 超时）

/** Objective 生命周期状态转换是否合法。 */
export function canTransitionObjective(
  from: ObjectiveLifecycleState,
  to: ObjectiveLifecycleState,
): boolean {
  const VALID: Record<ObjectiveLifecycleState, readonly ObjectiveLifecycleState[]> = {
    CREATED:    ["ACCEPTED", "REJECTED"],
    ACCEPTED:   ["ACTIVE", "REJECTED"],
    ACTIVE:     ["COMPLETED", "ABORTED"],
    COMPLETED:  [],
    REJECTED:   [],
    ABORTED:    [],
  };
  return VALID[from]?.includes(to) ?? false;
}

/** 判断 Objective 是否处于终态。 */
export function isObjectiveTerminal(state: ObjectiveLifecycleState): boolean {
  return state === "COMPLETED" || state === "REJECTED" || state === "ABORTED";
}

/** 判断 Objective 是否处于活跃态（可产出 TacticalDecision）。 */
export function isObjectiveActive(state: ObjectiveLifecycleState): boolean {
  return state === "ACTIVE";
}

// ═══════════════════════════════════════════════════════════
// §4. TacticalObjective 运行时记录
// ═══════════════════════════════════════════════════════════

/** TacticalObjective 运行时记录 — 生命周期管理用。 */
export interface TacticalObjectiveRecord {
  /** 目标 ID。 */
  readonly objectiveId: string;
  /** 关联 Operation ID。 */
  readonly operationId: string;
  /** 关联 Squad ID。 */
  readonly squadId: string;
  /** 目标房间。 */
  readonly targetRoom: string;
  /** 生命周期状态。 */
  state: ObjectiveLifecycleState;
  /** 创建 tick。 */
  readonly createdTick: number;
  /** 最后执行 tick。 */
  lastExecutedTick: number;
  /** 止损信号（如有）。 */
  abortSignal?: string;
  /** 完成原因（如有）。 */
  completionReason?: string;
}

// ═══════════════════════════════════════════════════════════
// §5. 生命周期评估纯函数
// ═══════════════════════════════════════════════════════════

/** 生命周期评估输入。 */
export interface LifecycleAssessmentInput {
  readonly record: TacticalObjectiveRecord;
  readonly currentTick: number;
  readonly authorizationValid: boolean;
  readonly targetExists: boolean;
  readonly targetInScope: boolean;
  readonly squadValid: boolean;
  readonly decisionState: TacticalState;
  readonly hasAbortSignal: boolean;
}

/** 生命周期评估结果。 */
export interface LifecycleAssessmentResult {
  readonly newState: ObjectiveLifecycleState;
  readonly reason: string;
  readonly shouldTransition: boolean;
}

/**
 * 评估 Objective 是否应转换生命周期状态。
 *
 * 处理条件：
 *   - authorization expired → REJECTED/ABORTED
 *   - operation aborted → ABORTED
 *   - target disappeared → COMPLETED (if was ENGAGING) or ABORTED
 *   - target moved outside scope → ABORTED
 *   - objective completed (decisionState=COMPLETED) → COMPLETED
 *   - confidence degraded → ABORTED (via hasAbortSignal)
 *   - squad invalid → ABORTED
 *   - enemy capability changed → handled by TacticalDecision (RETREATING)
 */
export function assessObjectiveLifecycle(
  input: LifecycleAssessmentInput,
): LifecycleAssessmentResult {
  const { record, currentTick, authorizationValid, targetExists, targetInScope, squadValid, decisionState, hasAbortSignal } = input;

  // 终态不转换
  if (isObjectiveTerminal(record.state)) {
    return { newState: record.state, reason: "already terminal", shouldTransition: false };
  }

  // CREATED → ACCEPTED (authorization valid) or REJECTED
  if (record.state === "CREATED") {
    if (authorizationValid) {
      return { newState: "ACCEPTED", reason: "authorization validated", shouldTransition: true };
    }
    return { newState: "REJECTED", reason: "authorization invalid at creation", shouldTransition: true };
  }

  // ACCEPTED → ACTIVE (squad valid) or REJECTED
  if (record.state === "ACCEPTED") {
    if (squadValid) {
      return { newState: "ACTIVE", reason: "squad ready, activating", shouldTransition: true };
    }
    // 等待 squad 就绪，不急于 reject
    return { newState: "ACCEPTED", reason: "awaiting squad", shouldTransition: false };
  }

  // ACTIVE → COMPLETED / ABORTED
  if (record.state === "ACTIVE") {
    // 止损信号 → ABORTED
    if (hasAbortSignal) {
      return { newState: "ABORTED", reason: "tactical abort signal received", shouldTransition: true };
    }

    // 授权失效 → ABORTED
    if (!authorizationValid) {
      return { newState: "ABORTED", reason: "authorization expired or revoked", shouldTransition: true };
    }

    // 目标超出 scope → ABORTED
    if (!targetInScope) {
      return { newState: "ABORTED", reason: "target moved outside operational scope", shouldTransition: true };
    }

    // 编队无效 → ABORTED
    if (!squadValid) {
      return { newState: "ABORTED", reason: "squad invalid (broken / no members)", shouldTransition: true };
    }

    // 目标消失 → COMPLETED (ENGAGE_ENEMY 完成语义) 或 ABORTED
    if (!targetExists) {
      if (decisionState === "ENGAGING" || decisionState === "COMPLETED") {
        return { newState: "COMPLETED", reason: "target destroyed / cleared", shouldTransition: true };
      }
      return { newState: "ABORTED", reason: "target disappeared before engagement", shouldTransition: true };
    }

    // 决策状态为 COMPLETED → COMPLETED
    if (decisionState === "COMPLETED") {
      return { newState: "COMPLETED", reason: "tactical state reached COMPLETED", shouldTransition: true };
    }

    // 决策状态为 ABORTED → ABORTED
    if (decisionState === "ABORTED") {
      return { newState: "ABORTED", reason: "tactical state reached ABORTED", shouldTransition: true };
    }
  }

  return { newState: record.state, reason: "no transition needed", shouldTransition: false };
}
