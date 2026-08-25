/**
 * Tactical Authorization — A5.4.0 纯函数。
 *
 * 确保 Tactical 层只在 WarPlan 授权下执行。
 *
 * 验证维度：
 *   1. operationId 匹配
 *   2. objectiveId 有效
 *   3. warPosture = war 或 fortify（进攻需 war，防御可 fortify）
 *   4. authorization state = AUTHORIZED
 *   5. target 匹配（Tactical target 在 Operational target scope 内）
 *   6. expiry 未过期
 *   7. operation 未 abort
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / 任何 Runtime。
 */

import type {
  TacticalAuthorization,
  AuthorizationState,
  TacticalObjective,
} from "./types";
import type { MilitaryOperation } from "../military/operation";

// ═══════════════════════════════════════════════════════════
// §1. 授权验证
// ═══════════════════════════════════════════════════════════

/** 授权验证结果。 */
export interface AuthorizationCheckResult {
  readonly valid: boolean;
  readonly state: AuthorizationState;
  readonly reason: string;
  readonly evidence: string[];
}

/**
 * 验证 TacticalAuthorization 是否有效。
 *
 * 检查项：
 *   - state === AUTHORIZED
 *   - expiry > currentTick
 *   - operationAborted === false
 *   - warPosture 允许该操作类型
 */
export function validateAuthorization(
  auth: TacticalAuthorization,
  currentTick: number,
  isOffensive: boolean,
): AuthorizationCheckResult {
  const evidence: string[] = [];

  // 1. 操作已 abort → 授权自动撤销
  if (auth.operationAborted) {
    evidence.push("operation aborted → authorization revoked");
    return {
      valid: false,
      state: "REVOKED",
      reason: "operation aborted",
      evidence,
    };
  }

  // 2. 授权过期
  if (currentTick > auth.expiry) {
    evidence.push(`expired: ${currentTick} > ${auth.expiry}`);
    return {
      valid: false,
      state: "EXPIRED",
      reason: "authorization expired",
      evidence,
    };
  }

  // 3. 授权状态检查
  if (auth.state !== "AUTHORIZED") {
    evidence.push(`state=${auth.state} (expected AUTHORIZED)`);
    return {
      valid: false,
      state: auth.state,
      reason: `authorization state is ${auth.state}`,
      evidence,
    };
  }

  // 4. 姿态检查：进攻性操作需要 war posture
  if (isOffensive && auth.warPosture !== "war") {
    evidence.push(`offensive requires war posture, got ${auth.warPosture}`);
    return {
      valid: false,
      state: "DENIED",
      reason: `offensive operation requires war posture, got ${auth.warPosture}`,
      evidence,
    };
  }

  // 5. 防御性操作允许 fortify 或 war
  if (!isOffensive && auth.warPosture !== "war" && auth.warPosture !== "fortify") {
    evidence.push(`defensive requires war/fortify, got ${auth.warPosture}`);
    return {
      valid: false,
      state: "DENIED",
      reason: `defensive operation requires war/fortify posture, got ${auth.warPosture}`,
      evidence,
    };
  }

  evidence.push(`state=AUTHORIZED, posture=${auth.warPosture}, expiry=${auth.expiry}`);
  return {
    valid: true,
    state: "AUTHORIZED",
    reason: "authorization valid",
    evidence,
  };
}

/**
 * 从 MilitaryOperation 和 WarPosture 构建 TacticalAuthorization。
 *
 * 这是系统层的辅助函数——从 Operational 层信息派生 Tactical 授权。
 */
export function buildAuthorization(
  operation: MilitaryOperation,
  warPosture: string,
  operationAborted: boolean,
  expiryTick: number,
): TacticalAuthorization {
  const isOff = isOffensiveOperation(operation.type);
  const valid = !operationAborted
    && (isOff ? warPosture === "war" : warPosture === "war" || warPosture === "fortify");

  return {
    state: valid ? "AUTHORIZED" : operationAborted ? "REVOKED" : "PENDING",
    operationId: operation.operationId,
    warPosture,
    targetRoom: operation.target.roomName,
    expiry: expiryTick,
    operationAborted,
    reason: valid
      ? "authorized by war plan"
      : operationAborted
        ? "operation aborted"
        : `posture ${warPosture} insufficient`,
  };
}

/** 判断 OperationType 是否为进攻性。 */
export function isOffensiveOperation(type: string): boolean {
  return type === "ASSAULT"
    || type === "RAID"
    || type === "SIEGE"
    || type === "HARASS"
    || type === "CONTROLLER_ATTACK"
    || type === "REMOTE_DENIAL";
}

// ═══════════════════════════════════════════════════════════
// §2. Target Scope 验证
// ═══════════════════════════════════════════════════════════

/** Target Scope 验证结果。 */
export interface TargetScopeCheckResult {
  readonly valid: boolean;
  readonly reason: string;
  readonly evidence: string[];
}

/**
 * 验证 Tactical 目标是否在允许的 Target Scope 内。
 *
 * 规则：
 *   - LOCAL: Tactical 可以在当前视野内排序目标（先打 A 还是 B）
 *   - OPERATIONAL: Tactical 必须执行 Operational 指定的目标
 *   - STRATEGIC: Tactical 禁止自行切换战略目标
 *
 * 禁止：Tactical 看到另一个 Enemy 就自行切换战略目标。
 */
export function validateTargetScope(
  objective: TacticalObjective,
  candidateTargetRoom: string,
  operationalTargetRoom: string,
): TargetScopeCheckResult {
  const evidence: string[] = [];

  // Tactical 目标必须在 Operational 目标房间内
  if (candidateTargetRoom !== operationalTargetRoom) {
    evidence.push(
      `target room mismatch: candidate=${candidateTargetRoom} operational=${operationalTargetRoom}`,
    );
    return {
      valid: false,
      reason: "target outside operational scope — tactical cannot switch strategic target",
      evidence,
    };
  }

  // LOCAL scope: 允许在目标房内排序
  if (objective.targetScope === "LOCAL") {
    evidence.push(`LOCAL scope: target within operational room ${operationalTargetRoom}`);
    return {
      valid: true,
      reason: "local target within operational scope",
      evidence,
    };
  }

  // OPERATIONAL scope: 目标必须匹配
  if (objective.targetScope === "OPERATIONAL") {
    evidence.push(`OPERATIONAL scope: target matches operational room`);
    return {
      valid: true,
      reason: "operational target confirmed",
      evidence,
    };
  }

  // STRATEGIC scope: Tactical 禁止切换
  evidence.push(`STRATEGIC scope: tactical cannot switch strategic target`);
  return {
    valid: false,
    reason: "strategic scope — tactical layer cannot select strategic targets",
    evidence,
  };
}
