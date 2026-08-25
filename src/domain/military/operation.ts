/**
 * Military Operation Model — A5.3 Domain 纯函数。
 *
 * 核心链路中的位置：
 *   Threat + CombatCapability + Terrain + PlayerIntel + Confidence
 *   + EmpireContext + EconomicContext + StrategicContext
 *   → Military Operation → Operation Proposal → War Plan
 *   → Force Requirement → Logistics Requirement → Spawn Requirement
 *   → Execution Authorization
 *
 * A5.3 只负责 Planning。不负责 Tactical Execution。
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / Creep / Room / 任何 Runtime 对象。
 */

// ═══════════════════════════════════════════════════════════
// §1. OperationType — 12 种军事行动类型
// ═══════════════════════════════════════════════════════════

export type OperationType =
  | "DEFEND"             // 防守核心房
  | "ESCORT"             // 远矿护航
  | "HARASS"             // 骚扰敌方经济
  | "SIEGE"              // 围困敌方房间
  | "ASSAULT"            // 全面进攻
  | "RAID"               // 快速掠夺
  | "CONTROLLER_ATTACK"  // 攻击 controller
  | "REMOTE_DENIAL"      // 远矿否定（阻止敌方远矿）
  | "CLAIM"              // 占领房间
  | "RESERVE"            // 储备 controller
  | "RETREAT"            // 撤退保存力量
  | "ABORT";             // 终止行动

// ═══════════════════════════════════════════════════════════
// §2. WarObjective — 为什么打
// ═══════════════════════════════════════════════════════════

export type WarObjective =
  | "DEFEND_CORE"              // 防守核心房
  | "DEFEND_REMOTE"            // 防守远矿
  | "DENY_RESOURCE"            // 否定敌方资源
  | "BREAK_SIEGE"              // 打破围困
  | "DESTROY_ECONOMIC_ASSET"   // 摧毁敌方经济设施
  | "DISRUPT_LOGISTICS"        // 破坏敌方物流
  | "CAPTURE_CONTROLLER"       // 占领 controller
  | "SECURE_ROOM"              // 安全化房间
  | "ESCORT_OPERATION"         // 护航运营
  | "RETREAT_AND_PRESERVE_FORCE"; // 撤退保存力量

// ═══════════════════════════════════════════════════════════
// §3. OperationStatus — 生命周期
// ═══════════════════════════════════════════════════════════

export type OperationStatus =
  | "PLANNED"     // 已规划，待授权
  | "AUTHORIZED"  // 已授权，待准备
  | "PREPARING"   // 准备中（集结/boost/物流）
  | "READY"       // 准备就绪
  | "ACTIVE"      // 正在执行
  | "DEGRADED"    // 降级运行（部分能力缺失/情报过期）
  | "ABORTING"    // 正在终止
  | "COMPLETED"   // 成功完成
  | "FAILED"      // 执行失败
  | "EXPIRED";    // 超时过期

// ═══════════════════════════════════════════════════════════
// §4. OperationPriority
// ═══════════════════════════════════════════════════════════

export type OperationPriorityFactor =
  | "EMERGENCY"      // 紧急（核心房被攻）
  | "STRATEGIC"      // 战略目标
  | "ECONOMIC"       // 经济保护
  | "DEFENSIVE"      // 防御
  | "OFFENSIVE"      // 进攻
  | "OPPORTUNISTIC"; // 机会主义

export interface OperationPriority {
  /** 数值优先级（0-100，越高越优先）。 */
  score: number;
  /** 主导因素。 */
  factor: OperationPriorityFactor;
  /** 证据。 */
  evidence: string[];
}

// ═══════════════════════════════════════════════════════════
// §5. OperationTarget
// ═══════════════════════════════════════════════════════════

export interface OperationTarget {
  /** 目标房间名。 */
  roomName: string;
  /** 目标类型（room/controller/structure/creep）。 */
  targetType: "room" | "controller" | "structure" | "creep";
  /** 目标坐标 packed pos（可选）。 */
  pos?: number;
  /** 目标战略价值评分。 */
  valueScore: number;
  /** 证据。 */
  evidence: string[];
}

// ═══════════════════════════════════════════════════════════
// §6. OperationConstraints
// ═══════════════════════════════════════════════════════════

export interface OperationConstraints {
  /** 最大允许 CPU/tick。 */
  maxCpuPerTick: number;
  /** 最大能量预算。 */
  maxEnergyBudget: number;
  /** 最大持续时间（tick）。 */
  maxDuration: number;
  /** 最小 IntelConfidence 要求。 */
  minIntelConfidence: number;
  /** 是否允许 boost。 */
  allowBoost: boolean;
  /** 是否允许核弹。 */
  allowNuke: boolean;
  /** 退出条件（Abort conditions）。 */
  abortConditions: AbortCondition[];
}

export type AbortCondition =
  | "ENEMY_CAPABILITY_INCREASED"   // 敌方能力显著增加
  | "INTEL_STALE"                  // 情报过期
  | "LOGISTICS_COLLAPSED"          // 物流崩溃
  | "REINFORCEMENT_TIMEOUT"        // 增援超时
  | "RECOVERY_NOT_GUARANTEED"      // 恢复不可保证
  | "EXPECTED_VALUE_NEGATIVE"       // 期望价值转负
  | "CASUALTY_EXCEEDED";           // 伤亡超限

// ═══════════════════════════════════════════════════════════
// §7. MilitaryOperation
// ═══════════════════════════════════════════════════════════

export interface MilitaryOperation {
  /** 唯一标识。 */
  operationId: string;
  /** 行动类型。 */
  type: OperationType;
  /** 战争目标。 */
  objective: WarObjective;
  /** 目标。 */
  target: OperationTarget;
  /** 姿态（DEFENSIVE/CONTAIN/LIMITED_OFFENSIVE/FULL_OFFENSIVE）。 */
  posture: string;
  /** 优先级。 */
  priority: OperationPriority;
  /** 风险等级。 */
  risk: string; // LOW | MEDIUM | HIGH | CRITICAL
  /** 当前状态。 */
  status: OperationStatus;
  /** 约束条件。 */
  constraints: OperationConstraints;
  /** 创建 tick。 */
  createdTick: number;
  /** 过期 tick。 */
  expiresTick: number;
  /** 置信度（0-1）。 */
  confidence: number;
  /** 决策原因。 */
  reason: string;
  /** 证据链。 */
  evidence: string[];
}

// ═══════════════════════════════════════════════════════════
// §8. Lifecycle 状态转换纯函数
// ═══════════════════════════════════════════════════════════

/** 合法状态转换表。 */
const VALID_TRANSITIONS: Record<OperationStatus, readonly OperationStatus[]> = {
  PLANNED: ["AUTHORIZED", "EXPIRED", "FAILED"],
  AUTHORIZED: ["PREPARING", "ABORTING", "EXPIRED", "FAILED"],
  PREPARING: ["READY", "DEGRADED", "ABORTING", "EXPIRED", "FAILED"],
  READY: ["ACTIVE", "DEGRADED", "ABORTING", "EXPIRED"],
  ACTIVE: ["DEGRADED", "ABORTING", "COMPLETED", "FAILED"],
  DEGRADED: ["ACTIVE", "ABORTING", "FAILED", "COMPLETED"],
  ABORTING: ["COMPLETED", "FAILED", "EXPIRED"],
  COMPLETED: [],
  FAILED: [],
  EXPIRED: [],
};

export function canTransition(from: OperationStatus, to: OperationStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function transition(
  op: MilitaryOperation,
  to: OperationStatus,
  tick: number,
  reason: string,
): MilitaryOperation {
  if (!canTransition(op.status, to)) {
    return op; // 非法转换，不变
  }
  return { ...op, status: to, evidence: [...op.evidence, `[${tick}] ${op.status}→${to}: ${reason}`] };
}

// ═══════════════════════════════════════════════════════════
// §9. Preparation Gate
// ═══════════════════════════════════════════════════════════

export interface PreparationGate {
  forceReady: boolean;
  logisticsReady: boolean;
  intelReady: boolean;
  targetValid: boolean;
  strategicAuthorization: boolean;
  recoveryReady: boolean;
}

export function checkPreparationGate(gate: PreparationGate): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!gate.forceReady) blockers.push("FORCE_NOT_READY");
  if (!gate.logisticsReady) blockers.push("LOGISTICS_NOT_READY");
  if (!gate.intelReady) blockers.push("INTEL_NOT_READY");
  if (!gate.targetValid) blockers.push("TARGET_INVALID");
  if (!gate.strategicAuthorization) blockers.push("NO_AUTHORIZATION");
  if (!gate.recoveryReady) blockers.push("RECOVERY_NOT_GUARANTEED");
  return { ready: blockers.length === 0, blockers };
}

// ═══════════════════════════════════════════════════════════
// §10. Operation 确定性 Hash
// ═══════════════════════════════════════════════════════════

export function operationHash(op: MilitaryOperation): string {
  const payload = JSON.stringify({
    id: op.operationId,
    type: op.type,
    objective: op.objective,
    target: op.target.roomName,
    posture: op.posture,
    status: op.status,
    risk: op.risk,
    priority: op.priority.score,
    confidence: op.confidence,
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

// ═══════════════════════════════════════════════════════════
// §11. 便捷工厂
// ═══════════════════════════════════════════════════════════

export function makeOperationId(tick: number, seq: number): string {
  return `OP-${tick}-${seq}`;
}

export function isOffensive(type: OperationType): boolean {
  return type === "ASSAULT" || type === "SIEGE" || type === "RAID"
    || type === "CONTROLLER_ATTACK" || type === "REMOTE_DENIAL"
    || type === "CLAIM";
}

export function isDefensive(type: OperationType): boolean {
  return type === "DEFEND" || type === "ESCORT" || type === "RETREAT";
}

export function isTerminal(status: OperationStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "EXPIRED";
}
