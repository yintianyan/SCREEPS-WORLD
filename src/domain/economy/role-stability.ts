/**
 * Role Stability — A4.0 Phase 1：防 Role 振荡的迟滞机制。
 *
 * 合同锚点：A4.0 Architecture Audit §9（Role Stability / Hysteresis）。
 *
 * 设计意图：
 *   Role Evaluation 每 100 tick 重算一次，评分会因经济波动而抖动。
 *   如果每次都直接采用推荐角色，会导致 Role 频繁切换——
 *   Role 切换会触发 Supply Contract 重建、Spawn 优先级变化等连锁效应。
 *
 *   防振荡三防线（与 Colony Phase / Expansion Plan 同模式）：
 *   1. Hysteresis — 推荐角色分数必须超过当前角色分数一定裕度才允许切换
 *   2. Minimum Duration — 角色分配后至少保持 N 个评估周期（tick）不可切换
 *   3. Re-evaluation Threshold — 角色分数低于阈值时触发重评（即使未到周期）
 *
 *   这三道防线确保：
 *   - 短期经济波动不会导致 Role 抖动
 *   - 真实的经济结构变化（如 RCL 升级、远矿开点）能及时反映
 *   - Role 切换有最小驻留期，避免 churn
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { EmpireRoomRole } from "./empire-role";
import type { RoleEvaluationResult } from "./role-evaluation";

// ─── 配置 ─────────────────────────────────────────────────

/**
 * Role Stability 配置参数。
 */
export interface RoleStabilityConfig {
  /**
   * Hysteresis 裕度——推荐角色分数需超过当前角色分数 + 此值才允许切换。
   * 值域 [0, 1]，默认 0.15。
   * 0.15 = 推荐角色分数需比当前角色高 15 个百分点才切换。
   */
  hysteresisMargin: number;

  /**
   * 最小驻留评估周期数——角色分配后至少保持 N 次评估不可切换。
   * 默认 5（每 100 tick 评估一次 → 500 tick 最小驻留）。
   * 覆盖一轮远矿开点/ Spawn 轮换 + 经济波动恢复周期。
   */
  minDurationEpochs: number;

  /**
   * 重评阈值——当前角色分数低于此值时强制触发重评（即使未到周期）。
   * 默认 0.25。
   * 当角色分数跌到 0.25 以下时，即使 hysteresis 和 minDuration 未满足也允许切换。
   */
  reevaluationThreshold: number;

  /**
   * 零分阈值——所有角色分数都低于此值时视为「无适配角色」。
   * 默认 0.15。
   * 此时保持当前角色不变（避免在无数据时乱切）。
   */
  noRoleThreshold: number;
}

/** 默认配置。 */
export const DEFAULT_ROLE_STABILITY_CONFIG: RoleStabilityConfig = {
  hysteresisMargin: 0.15,
  minDurationEpochs: 5,
  reevaluationThreshold: 0.25,
  noRoleThreshold: 0.15,
};

// ─── 持久化状态 ───────────────────────────────────────────

/**
 * Role Stability State — 跨 tick 持久化的角色稳定性状态。
 *
 * 存入 Memory.kernel.roleStability[roomName]（瘦快照）。
 * 由系统侧薄壳负责持久化。
 */
export interface RoleStabilityState {
  /** 当前分配的角色。 */
  currentRole: EmpireRoomRole;
  /** 角色分配时的 tick。 */
  assignedAtTick: number;
  /** 当前角色的最新分数（0..1）。 */
  currentScore: number;
  /** 自上次角色分配以来的评估周期数。 */
  epochsSinceAssignment: number;
  /** 最近一次评估的 tick。 */
  lastEvaluatedTick: number;
}

// ─── 结果类型 ─────────────────────────────────────────────

/**
 * Role Stability Decision — 迟滞机制裁决结果。
 */
export interface RoleStabilityDecision {
  /** 裁决后的角色（可能 = currentRole，也可能 = recommendedRole）。 */
  decidedRole: EmpireRoomRole;
  /** 裁决后的角色分数。 */
  decidedScore: number;
  /** 是否发生了角色变更。 */
  roleChanged: boolean;
  /** 变更原因（人类可读）。 */
  reason: string;
  /** 更新后的稳定性状态。 */
  newState: RoleStabilityState;
}

// ─── 核心函数 ─────────────────────────────────────────────

/**
 * 判定是否应该切换角色（综合三防线）。
 *
 * 防振荡三防线：
 * 1. Hysteresis — 推荐角色分数 > 当前角色分数 + hysteresisMargin
 * 2. Min Duration — epochsSinceAssignment ≥ minDurationEpochs
 * 3. Re-evaluation Threshold — 当前角色分数 < reevaluationThreshold 时绕过 1+2
 *
 * 特殊情况：
 * - 所有角色分数 < noRoleThreshold → 保持当前角色（数据不足）
 * - 当前角色分数 = 0（前置条件不再满足）→ 立即切换到推荐角色
 *
 * 纯函数 — 不引用 Game/Memory。
 *
 * @param evaluation 角色评估结果
 * @param state 当前稳定性状态
 * @param config 稳定性配置
 * @param tick 当前 tick
 */
export function decideRoleStability(
  evaluation: RoleEvaluationResult,
  state: RoleStabilityState,
  config: RoleStabilityConfig,
  tick: number,
): RoleStabilityDecision {
  const { recommendedRole, recommendedScore, scores } = evaluation;
  const currentRole = state.currentRole;
  const currentScore = scores[currentRole]?.totalScore ?? 0;

  const epochsSinceAssignment = state.epochsSinceAssignment + 1;
  const minDurationMet = epochsSinceAssignment >= config.minDurationEpochs;

  // ── 情况 1：所有角色分数都低于 noRoleThreshold → 保持当前角色 ──
  const allScoresLow = (Object.values(scores) as { totalScore: number }[])
    .every(s => s.totalScore < config.noRoleThreshold);

  if (allScoresLow) {
    return buildDecision(
      currentRole,
      currentScore,
      false,
      `no-role: all scores < ${config.noRoleThreshold}`,
      state,
      tick,
      epochsSinceAssignment,
      currentScore,
    );
  }

  // ── 情况 2：当前角色分数 = 0（前置条件不再满足）→ 立即切换 ──
  if (currentScore <= 0) {
    if (recommendedScore > 0) {
      return buildDecision(
        recommendedRole,
        recommendedScore,
        true,
        `prerequisites-lost: ${currentRole} score=0 → ${recommendedRole} score=${recommendedScore.toFixed(2)}`,
        state,
        tick,
        0, // 重置 epochs
        recommendedScore,
      );
    }
    // 推荐角色也为 0 → 保持当前（等前置条件恢复）
    return buildDecision(
      currentRole,
      0,
      false,
      `prerequisites-lost but no alternative`,
      state,
      tick,
      epochsSinceAssignment,
      0,
    );
  }

  // ── 情况 3：推荐角色 = 当前角色 → 无需切换 ──
  if (recommendedRole === currentRole) {
    return buildDecision(
      currentRole,
      recommendedScore,
      false,
      `stable: ${currentRole} score=${recommendedScore.toFixed(2)}`,
      state,
      tick,
      epochsSinceAssignment,
      recommendedScore,
    );
  }

  // ── 情况 4：当前角色分数低于重评阈值 → 绕过 hysteresis + minDuration ──
  if (currentScore < config.reevaluationThreshold) {
    return buildDecision(
      recommendedRole,
      recommendedScore,
      true,
      `re-eval: ${currentRole} score=${currentScore.toFixed(2)} < ${config.reevaluationThreshold} → ${recommendedRole} score=${recommendedScore.toFixed(2)}`,
      state,
      tick,
      0,
      recommendedScore,
    );
  }

  // ── 情况 5：Hysteresis + Min Duration 联合门控 ──
  const hysteresisMet = recommendedScore > currentScore + config.hysteresisMargin;

  if (hysteresisMet && minDurationMet) {
    return buildDecision(
      recommendedRole,
      recommendedScore,
      true,
      `hysteresis: ${recommendedRole}(${recommendedScore.toFixed(2)}) > ${currentRole}(${currentScore.toFixed(2)}) + ${config.hysteresisMargin}, duration=${epochsSinceAssignment}≥${config.minDurationEpochs}`,
      state,
      tick,
      0,
      recommendedScore,
    );
  }

  // ── 默认：保持当前角色 ──
  const reasons: string[] = [];
  if (!hysteresisMet) {
    reasons.push(`hysteresis-not-met: ${recommendedScore.toFixed(2)} ≤ ${currentScore.toFixed(2)} + ${config.hysteresisMargin}`);
  }
  if (!minDurationMet) {
    reasons.push(`min-duration-not-met: ${epochsSinceAssignment} < ${config.minDurationEpochs}`);
  }

  return buildDecision(
    currentRole,
    currentScore,
    false,
    `hold: ${reasons.join(", ")}`,
    state,
    tick,
    epochsSinceAssignment,
    currentScore,
  );
}

// ─── 辅助函数 ─────────────────────────────────────────────

/**
 * 构造 RoleStabilityDecision + 更新后的 RoleStabilityState。
 * 纯函数。
 */
function buildDecision(
  decidedRole: EmpireRoomRole,
  decidedScore: number,
  roleChanged: boolean,
  reason: string,
  prevState: RoleStabilityState,
  tick: number,
  newEpochs: number,
  newScore: number,
): RoleStabilityDecision {
  const newState: RoleStabilityState = {
    currentRole: decidedRole,
    assignedAtTick: roleChanged ? tick : prevState.assignedAtTick,
    currentScore: newScore,
    epochsSinceAssignment: newEpochs,
    lastEvaluatedTick: tick,
  };

  return {
    decidedRole,
    decidedScore,
    roleChanged,
    reason,
    newState,
  };
}

/**
 * 创建初始 RoleStabilityState（新房或首次评估）。
 * 纯函数。
 */
export function createInitialRoleStability(
  role: EmpireRoomRole,
  score: number,
  tick: number,
): RoleStabilityState {
  return {
    currentRole: role,
    assignedAtTick: tick,
    currentScore: score,
    epochsSinceAssignment: 0,
    lastEvaluatedTick: tick,
  };
}

/**
 * 将 RoleStabilityState 序列化为 Memory 瘦快照。
 * 纯函数。
 */
export function serializeRoleStability(state: RoleStabilityState): {
  r: string; // role code
  a: number; // assignedAtTick
  s: number; // currentScore ×100
  e: number; // epochsSinceAssignment
  t: number; // lastEvaluatedTick
} {
  // 延迟 import 避免循环依赖——直接内联 roleToCode 逻辑
  const roleCode = state.currentRole === "core" ? "C"
    : state.currentRole === "production" ? "P"
    : state.currentRole === "support" ? "S"
    : "R";
  return {
    r: roleCode,
    a: state.assignedAtTick,
    s: Math.round(state.currentScore * 100),
    e: state.epochsSinceAssignment,
    t: state.lastEvaluatedTick,
  };
}

/**
 * 从 Memory 瘦快照反序列化 RoleStabilityState。
 * 纯函数。
 */
export function deserializeRoleStability(
  data: { r: string; a: number; s: number; e: number; t: number } | undefined,
  fallbackRole: EmpireRoomRole,
  fallbackTick: number,
): RoleStabilityState {
  if (!data) {
    return createInitialRoleStability(fallbackRole, 0, fallbackTick);
  }
  const role: EmpireRoomRole = data.r === "C" ? "core"
    : data.r === "P" ? "production"
    : data.r === "S" ? "support"
    : data.r === "R" ? "remote"
    : fallbackRole;
  return {
    currentRole: role,
    assignedAtTick: data.a,
    currentScore: data.s / 100,
    epochsSinceAssignment: data.e,
    lastEvaluatedTick: data.t,
  };
}
