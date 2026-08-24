/**
 * Role Transition — A4.0 Phase 1：角色变更条件与转换规则。
 *
 * 合同锚点：A4.0 Architecture Audit §9（Role Transition：Role 变更条件 + 滞回）。
 *
 * 设计意图：
 *   Role Stability 的三防线决定「是否允许切换」，但不决定「切换是否合理」。
 *   Role Transition 在 Stability 裁决之上增加一层语义验证：
 *
 *   1. Transition Validity — 某些角色转换是不允许的（如 REMOTE → CORE 跳级）
 *      必须经过中间角色（REMOTE → PRODUCTION → CORE）
 *   2. Transition Trigger — 记录触发转换的经济事件（RCL 升级、远矿开点等）
 *      供 Dashboard 展示和审计追溯
 *   3. Transition Impact — 评估转换对 Supply Contract 的影响
 *      （哪些 Contract 需要重建、哪些可以保留）
 *
 *   Role Transition 是 Role Stability 的补充层，不替换 Stability 裁决。
 *   流程：evaluateRoomRole → decideRoleStability → validateRoleTransition
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { EmpireRoomRole } from "./empire-role";
import type { RoleStabilityDecision } from "./role-stability";

// ─── 转换规则 ─────────────────────────────────────────────

/**
 * 允许的角色直接转换路径。
 *
 * 设计理念——角色层级与渐进路径：
 * - CORE ↔ PRODUCTION：双向允许（核心房可降级为产能房，反之亦然）
 * - PRODUCTION ↔ SUPPORT：双向允许
 * - PRODUCTION ↔ REMOTE：双向允许
 * - SUPPORT ↔ REMOTE：双向允许
 * - CORE ↔ SUPPORT：双向允许（核心房可转为物流枢纽，反之亦然）
 * - CORE ↔ REMOTE：不允许直接转换——必须经过 PRODUCTION 或 SUPPORT
 *   （基座房与远矿房差异太大，跳级转换不合理）
 *
 * 任何角色 → 同角色 = 无转换（stable）。
 */
const ALLOWED_TRANSITIONS: ReadonlySet<string> = new Set([
  // 同角色（不算转换）
  "core→core",
  "production→production",
  "support→support",
  "remote→remote",
  // 允许的直接转换
  "core→production",
  "production→core",
  "core→support",
  "support→core",
  "production→support",
  "support→production",
  "production→remote",
  "remote→production",
  "support→remote",
  "remote→support",
]);

/**
 * 角色转换触发事件类型。
 */
export type TransitionTrigger =
  | "rcl_upgrade"        // RCL 升级解锁新能力
  | "rcl_downgrade"      // RCL 降级失去能力
  | "storage_built"      // storage 建成
  | "terminal_built"     // terminal 建成
  | "remote_opened"      // 新远矿开点
  | "remote_closed"      // 远矿关闭/止损
  | "economic_shift"     // 经济指标变化（效率/净流/储备）
  | "empire_growth"      // 帝国扩张（新房加入影响地理中心性）
  | "empire_shrink"      // 帝国收缩（失房影响地理中心性）
  | "stability_hysteresis" // 稳定性迟滞触发
  | "prerequisites_lost" // 前置条件不再满足
  | "initial_assignment"; // 初始分配

// ─── 结果类型 ─────────────────────────────────────────────

/**
 * Role Transition Validation Result — 转换验证结果。
 */
export interface RoleTransitionResult {
  /** 是否允许转换。 */
  allowed: boolean;
  /** 转换前角色。 */
  fromRole: EmpireRoomRole;
  /** 转换后角色。 */
  toRole: EmpireRoomRole;
  /** 触发事件。 */
  trigger: TransitionTrigger;
  /** 转换路径（如果需要中间角色）。 */
  intermediateRole: EmpireRoomRole | undefined;
  /** 人类可读原因。 */
  reason: string;
  /** 转换影响评估。 */
  impact: RoleTransitionImpact;
}

/**
 * 转换影响评估——对 Supply Contract 的潜在影响。
 */
export interface RoleTransitionImpact {
  /** 是否影响 producer 角色（如果房间的 canBeProducer 变化）。 */
  affectsProducer: boolean;
  /** 是否影响 consumer 角色。 */
  affectsConsumer: boolean;
  /** 是否影响物流枢纽角色。 */
  affectsLogisticsHub: boolean;
  /** 预估受影响的 Supply Contract 数量（由调用方填充，默认 0）。 */
  affectedContractCount: number;
  /** 是否需要重建 Contract（true = 需要清理并重建，false = 可保留现有 Contract）。 */
  requiresContractRebuild: boolean;
  /** 人类可读影响描述。 */
  description: string;
}

// ─── 核心函数 ─────────────────────────────────────────────

/**
 * 验证角色转换是否允许。
 *
 * 检查转换路径是否合法，并评估转换影响。
 * 如果 Stability 裁决 roleChanged=false（无变更），返回 allowed=true + trigger=stable。
 *
 * 纯函数 — 不引用 Game/Memory。
 *
 * @param decision Role Stability 裁决结果
 * @param trigger 触发事件（由调用方判定）
 * @param affectedContracts 受影响的 Contract 数量（由调用方查询）
 */
export function validateRoleTransition(
  decision: RoleStabilityDecision,
  trigger: TransitionTrigger,
  affectedContracts: number,
): RoleTransitionResult {
  const fromRole = decision.newState.currentRole;
  const toRole = decision.decidedRole;

  // 无变更
  if (!decision.roleChanged) {
    return {
      allowed: true,
      fromRole,
      toRole,
      trigger,
      intermediateRole: undefined,
      reason: `stable: ${fromRole} unchanged`,
      impact: assessTransitionImpact(fromRole, toRole, affectedContracts),
    };
  }

  // 检查直接转换是否允许
  const transitionKey = `${fromRole}→${toRole}`;
  const directAllowed = ALLOWED_TRANSITIONS.has(transitionKey);

  if (directAllowed) {
    return {
      allowed: true,
      fromRole,
      toRole,
      trigger,
      intermediateRole: undefined,
      reason: `direct: ${transitionKey} allowed`,
      impact: assessTransitionImpact(fromRole, toRole, affectedContracts),
    };
  }

  // 不允许直接转换——找中间角色
  // CORE ↔ REMOTE 需要经过 PRODUCTION 或 SUPPORT
  const intermediate = findIntermediateRole(fromRole, toRole);

  if (intermediate) {
    return {
      allowed: true, // 允许，但需要分两步
      fromRole,
      toRole,
      trigger,
      intermediateRole: intermediate,
      reason: `indirect: ${fromRole}→${intermediate}→${toRole} (direct ${transitionKey} not allowed)`,
      impact: assessTransitionImpact(fromRole, toRole, affectedContracts),
    };
  }

  // 不允许的转换
  return {
    allowed: false,
    fromRole,
    toRole,
    trigger,
    intermediateRole: undefined,
    reason: `forbidden: ${transitionKey} not allowed and no intermediate path found`,
    impact: assessTransitionImpact(fromRole, toRole, affectedContracts),
  };
}

/**
 * 查找中间角色（用于不允许直接转换的路径）。
 *
 * 当前仅 CORE ↔ REMOTE 需要中间角色：
 * - CORE → REMOTE：经过 PRODUCTION（降级为产能房→再降为远矿房）
 * - REMOTE → CORE：经过 PRODUCTION（升级为产能房→再升为核心房）
 *
 * 纯函数。
 */
function findIntermediateRole(
  from: EmpireRoomRole,
  to: EmpireRoomRole,
): EmpireRoomRole | undefined {
  const key = `${from}→${to}`;

  // CORE ↔ REMOTE 需要经过 PRODUCTION
  if (key === "core→remote") return "production";
  if (key === "remote→core") return "production";

  return undefined;
}

/**
 * 评估转换对 Supply Contract 的影响。
 *
 * 比较转换前后角色的 economicBehavior，判断哪些能力发生了变化。
 * 纯函数。
 */
function assessTransitionImpact(
  fromRole: EmpireRoomRole,
  toRole: EmpireRoomRole,
  affectedContracts: number,
): RoleTransitionImpact {
  // 内联 ROLE_CHARACTERISTICS 查询避免循环依赖
  const behaviorMap: Record<EmpireRoomRole, {
    canBeProducer: boolean;
    canBeConsumer: boolean;
    canBeLogisticsHub: boolean;
  }> = {
    core: { canBeProducer: true, canBeConsumer: false, canBeLogisticsHub: true },
    production: { canBeProducer: true, canBeConsumer: false, canBeLogisticsHub: false },
    support: { canBeProducer: true, canBeConsumer: true, canBeLogisticsHub: true },
    remote: { canBeProducer: true, canBeConsumer: false, canBeLogisticsHub: false },
  };

  const from = behaviorMap[fromRole];
  const to = behaviorMap[toRole];

  const affectsProducer = from.canBeProducer !== to.canBeProducer;
  const affectsConsumer = from.canBeConsumer !== to.canBeConsumer;
  const affectsLogisticsHub = from.canBeLogisticsHub !== to.canBeLogisticsHub;

  // 如果 producer/consumer 能力变化，需要重建 Contract
  const requiresContractRebuild = affectsProducer || affectsConsumer;

  const changes: string[] = [];
  if (affectsProducer) changes.push(`producer:${from.canBeProducer}→${to.canBeProducer}`);
  if (affectsConsumer) changes.push(`consumer:${from.canBeConsumer}→${to.canBeConsumer}`);
  if (affectsLogisticsHub) changes.push(`hub:${from.canBeLogisticsHub}→${to.canBeLogisticsHub}`);

  const description = changes.length > 0
    ? `behavior changes: ${changes.join(", ")}`
    : "no behavior changes (same economic capabilities)";

  return {
    affectsProducer,
    affectsConsumer,
    affectsLogisticsHub,
    affectedContractCount: affectedContracts,
    requiresContractRebuild,
    description,
  };
}

// ─── 辅助函数 ─────────────────────────────────────────────

/**
 * 推断转换触发事件（供调用方辅助判定）。
 *
 * 从评估输入的变化推断最可能的触发原因。
 * 这只是提示——调用方应根据实际运行时事件覆盖。
 *
 * 纯函数。
 */
export function inferTransitionTrigger(
  prevRcl: number,
  currRcl: number,
  prevHasStorage: boolean,
  currHasStorage: boolean,
  prevHasTerminal: boolean,
  currHasTerminal: boolean,
  prevRemoteOps: number,
  currRemoteOps: number,
): TransitionTrigger {
  if (currRcl > prevRcl) return "rcl_upgrade";
  if (currRcl < prevRcl) return "rcl_downgrade";
  if (currHasStorage && !prevHasStorage) return "storage_built";
  if (currHasTerminal && !prevHasTerminal) return "terminal_built";
  if (currRemoteOps > prevRemoteOps) return "remote_opened";
  if (currRemoteOps < prevRemoteOps) return "remote_closed";
  return "economic_shift";
}

/**
 * 获取角色层级（用于比较角色「等级」）。
 * CORE=3, PRODUCTION=2, SUPPORT=2, REMOTE=1。
 * 注意：SUPPORT 与 PRODUCTION 同级——它们是平行的职能，不是层级关系。
 * 纯函数。
 */
export function getRoleTier(role: EmpireRoomRole): number {
  switch (role) {
    case "core": return 3;
    case "production": return 2;
    case "support": return 2;
    case "remote": return 1;
  }
}

/**
 * 判定转换是否为「升级」（角色层级提升）。
 * 纯函数。
 */
export function isRoleUpgrade(from: EmpireRoomRole, to: EmpireRoomRole): boolean {
  return getRoleTier(to) > getRoleTier(from);
}

/**
 * 判定转换是否为「降级」（角色层级下降）。
 * 纯函数。
 */
export function isRoleDowngrade(from: EmpireRoomRole, to: EmpireRoomRole): boolean {
  return getRoleTier(to) < getRoleTier(from);
}
