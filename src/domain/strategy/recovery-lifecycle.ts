/** Recovery Lifecycle */

import type { RecoveryAction, RecoveryActionType } from "./recovery-priority";
import type { FailureNode, FailureDomain } from "./failure-propagation";

// ─── Recovery Action 生命周期 ──────────────────────────────

/** Recovery Action 执行状态。 */
export type RecoveryActionState =
  | "proposed"    // 已产生但尚未验证/提交
  | "validated"   // 验证通过（前置条件满足）
  | "submitted"   // 已提交到执行系统
  | "executing"   // 执行系统正在处理
  | "verifying"   // 执行完成，验证 World State
  | "succeeded"   // 验证通过，World State 已改善
  | "failed"      // 验证失败或执行失败
  | "retryable"   // 失败但可重试（资源不足等暂时性问题）
  | "terminal"    // 不可恢复的失败（maxAttempts 烧穿 / 不可行）
  | "blocked";    // 被外部条件阻塞（威胁 / CPU 降级）

/** Recovery Action 追踪记录（跨 tick 持久，heap 存储）。 */
export interface RecoveryActionRecord {
  /** 关联的 RecoveryAction.id。 */
  actionId: string;
  /** 关联的 FailureNode.id。 */
  failureId: string;
  /** Correlation ID（供 A4.7 Decision Trace 使用）。 */
  correlationId: string;
  /** Action 类型。 */
  type: RecoveryActionType;
  /** 目标领域。 */
  domain: FailureDomain;
  /** 目标房间。 */
  room?: string;
  /** 当前状态。 */
  state: RecoveryActionState;
  /** 尝试次数。 */
  attempts: number;
  /** 最大尝试次数。 */
  maxAttempts: number;
  /** 首次提交 tick。 */
  submittedAt: number;
  /** 最近一次状态变更 tick。 */
  updatedAt: number;
  /** 验证结果（verifying/succeeded/failed 时填充）。 */
  verificationResult?: RecoveryVerificationResult;
  /** 执行系统返回的追踪 ID（如 spawnRequestId / operationId）。 */
  executionRef?: string;
  /** 失败原因（failed/retryable/terminal/blocked 时填充）。 */
  failureReason?: string;
  /** 升级链：如果此 Action 失败并触发重新 Diagnosis，记录新 Action ID。 */
  escalatedTo?: string;
}

/** Recovery Action 追踪表（heap Map，跨 tick 持久）。 */
export type RecoveryActionTable = Map<string, RecoveryActionRecord>;

// ─── Idempotency ──────────────────────────────────────────

/**
 * 生成稳定的 Idempotency Key。

 * 不使用随机 ID——基于 domain + room + actionType + targetId 确定性生成。
 * 同一个失败在同一房间产生的同类型 Action 会得到相同的 key。

 * @param action RecoveryAction
 * @returns 稳定 key
 */
export function recoveryIdempotencyKey(action: RecoveryAction): string {
  const room = action.targetFailureId.includes(":")
    ? action.targetFailureId.split(":")[1] ?? "global"
    : "global";
  return `${action.domain}:${action.type}:${room}`;
}

/**
 * 检查 Action 是否已经在追踪表中（活跃状态）。

 * 活跃状态 = proposed/validated/submitted/executing/verifying。
 * succeeded/failed/terminal/blocked 的旧记录可以清理后重新创建。
 */
export function isActionActive(record: RecoveryActionRecord | undefined): boolean {
  if (!record) return false;
  return record.state === "proposed" ||
    record.state === "validated" ||
    record.state === "submitted" ||
    record.state === "executing" ||
    record.state === "verifying";
}

/**
 * 检查 RecoveryAction 是否应该被提交（Idempotency 检查）。

 * 规则：
 *   1. 追踪表中没有此 key → 可以提交
 *   2. 追踪表中有但状态为 succeeded/failed/terminal → 可以重新创建（新周期）
 *   3. 追踪表中有且状态为活跃 → 不重复提交
 *   4. 追踪表中有且状态为 retryable → 如果 cooldown 已过可以重试
 */
export function shouldSubmitAction(
  table: RecoveryActionTable,
  action: RecoveryAction,
  currentTick: number,
  cooldownDuration: number = 200,
): { submit: boolean; reason: string; existing?: RecoveryActionRecord } {
  const key = recoveryIdempotencyKey(action);
  const existing = table.get(key);

  if (!existing) {
    return { submit: true, reason: "new action" };
  }

  if (isActionActive(existing)) {
    return { submit: false, reason: "already active", existing };
  }

  if (existing.state === "retryable") {
    const cooldownEnd = existing.updatedAt + cooldownDuration;
    if (currentTick >= cooldownEnd) {
      return { submit: true, reason: "cooldown expired, retrying", existing };
    }
    return { submit: false, reason: `cooldown ${cooldownEnd - currentTick}t remaining`, existing };
  }

  if (existing.state === "succeeded") {
    return { submit: false, reason: "already succeeded", existing };
  }

  if (existing.state === "terminal") {
    return { submit: false, reason: "terminal failure — no retry", existing };
  }

  if (existing.state === "blocked") {
    return { submit: false, reason: "blocked by external condition", existing };
  }

  // failed — 检查是否超过 maxAttempts
  if (existing.state === "failed") {
    if (existing.attempts >= existing.maxAttempts) {
      return { submit: false, reason: "max attempts exceeded", existing };
    }
    const cooldownEnd = existing.updatedAt + cooldownDuration;
    if (currentTick >= cooldownEnd) {
      return { submit: true, reason: "retry after failure cooldown", existing };
    }
    return { submit: false, reason: `cooldown ${cooldownEnd - currentTick}t remaining`, existing };
  }

  return { submit: false, reason: "unknown state", existing };
}

// ─── Action 状态转换 ────────────────────────────────────────

/**
 * 创建新的 Recovery Action 追踪记录。
 */
export function createActionRecord(
  action: RecoveryAction,
  tick: number,
  maxAttempts: number = 3,
): RecoveryActionRecord {
  return {
    actionId: action.id,
    failureId: action.targetFailureId,
    correlationId: `rcv-${action.id}-${tick}`,
    type: action.type,
    domain: action.domain,
    room: action.targetFailureId.split(":")[1] ?? undefined,
    state: "proposed",
    attempts: 0,
    maxAttempts,
    submittedAt: tick,
    updatedAt: tick,
  };
}

/**
 * 转换 Action 状态（纯函数——返回新记录）。
 */
export function transitionAction(
  record: RecoveryActionRecord,
  newState: RecoveryActionState,
  tick: number,
  extra?: Partial<RecoveryActionRecord>,
): RecoveryActionRecord {
  return {
    ...record,
    state: newState,
    updatedAt: tick,
    ...extra,
  };
}

/**
 * 标记 Action 为已提交。
 */
export function markSubmitted(
  record: RecoveryActionRecord,
  tick: number,
  executionRef?: string,
): RecoveryActionRecord {
  return transitionAction(record, "submitted", tick, {
    executionRef,
    attempts: record.attempts + 1,
  });
}

/**
 * 标记 Action 为执行中。
 */
export function markExecuting(record: RecoveryActionRecord, tick: number): RecoveryActionRecord {
  return transitionAction(record, "executing", tick);
}

/**
 * 标记 Action 为验证中。
 */
export function markVerifying(record: RecoveryActionRecord, tick: number): RecoveryActionRecord {
  return transitionAction(record, "verifying", tick);
}

/**
 * 标记 Action 为成功。
 */
export function markSucceeded(
  record: RecoveryActionRecord,
  tick: number,
  verification: RecoveryVerificationResult,
): RecoveryActionRecord {
  return transitionAction(record, "succeeded", tick, {
    verificationResult: verification,
  });
}

/**
 * 标记 Action 为失败。
 */
export function markFailed(
  record: RecoveryActionRecord,
  tick: number,
  reason: string,
  retryable: boolean = false,
): RecoveryActionRecord {
  const state: RecoveryActionState = retryable ? "retryable" :
    record.attempts >= record.maxAttempts ? "terminal" : "failed";
  return transitionAction(record, state, tick, {
    failureReason: reason,
  });
}

/**
 * 标记 Action 为阻塞。
 */
export function markBlocked(
  record: RecoveryActionRecord,
  tick: number,
  reason: string,
): RecoveryActionRecord {
  return transitionAction(record, "blocked", tick, {
    failureReason: reason,
  });
}

// ─── Verification ─────────────────────────────────────────

/** Recovery 验证结果。 */
export type RecoveryVerificationResult =
  | "success"       // World State 完全恢复
  | "partial"       // 部分恢复（有改善但未达标）
  | "failed"        // 无改善
  | "no_progress";  // 提交成功但 World State 零变化

/** Recovery 验证输入。 */
export interface RecoveryVerificationInput {
  /** Action 执行前的 World State 快照。 */
  beforeState: RecoveryWorldSnapshot;
  /** Action 执行后的 World State 快照。 */
  afterState: RecoveryWorldSnapshot;
  /** Recovery Action。 */
  action: RecoveryAction;
  /** 提交后经过的 tick 数。 */
  elapsedTicks: number;
}

/** Recovery World State 快照（用于验证的 Before/After 对比）。 */
export interface RecoveryWorldSnapshot {
  /** 帝国健康度分数（0..1）。 */
  healthScore: number;
  /** 健康度等级。 */
  healthLevel: string;
  /** 活跃失败数。 */
  activeFailureCount: number;
  /** 目标领域的健康度分数（0..1）。 */
  domainScore: number;
  /** 目标领域的健康度等级。 */
  domainLevel: string;
  /** 目标房间（如果适用）。 */
  room?: string;
  /** 房间能量可用量（如果适用）。 */
  energyAvailable?: number;
  /** 房间总人口。 */
  population?: number;
  /** 物流投递率（0..1）。 */
  deliveryRate?: number;
  /** 远矿活跃运营数。 */
  activeRemoteOps?: number;
}

/**
 * 评估 Recovery 结果（纯函数）。

 * 判定逻辑：
 *   - domainLevel 从 critical/degraded 改善 → success 或 partial
 *   - domainLevel 未变但有其他指标改善 → partial
 *   - domainLevel 未变且无任何改善 → no_progress 或 failed
 *   - 提交后经过足够时间（> estimatedRecoveryTime）仍无改善 → failed

 * @param input 验证输入
 * @returns 验证结果
 */
export function evaluateRecoveryResult(input: RecoveryVerificationInput): RecoveryVerificationResult {
  const { beforeState, afterState, action, elapsedTicks } = input;

  // ── 1. 检查 domain level 是否改善 ──
  const levelRank: Record<string, number> = {
    critical: 1, degraded: 2, stable: 3, healthy: 4,
  };
  const beforeRank = levelRank[beforeState.domainLevel] ?? 0;
  const afterRank = levelRank[afterState.domainLevel] ?? 0;

  if (afterRank > beforeRank) {
    // 等级提升 → success
    return "success";
  }

  // ── 2. 检查 domain score 是否改善 ──
  const scoreDelta = afterState.domainScore - beforeState.domainScore;
  if (scoreDelta > 0.1) {
    // 分数显著改善（>10%） → partial
    return "partial";
  }

  // ── 3. 检查其他指标 ──
  const failureDelta = beforeState.activeFailureCount - afterState.activeFailureCount;
  if (failureDelta > 0) {
    // 活跃失败数减少 → partial
    return "partial";
  }

  // ── 4. 检查特定 Action 类型的指标 ──
  switch (action.type) {
    case "spawn_recovery":
    case "population_rebuild":
      // 检查人口是否增长
      if (beforeState.population !== undefined && afterState.population !== undefined) {
        const popDelta = afterState.population - beforeState.population;
        if (popDelta > 0) return "partial";
      }
      break;
    case "logistics_fix":
    case "route_fix":
      // 检查投递率是否改善
      if (beforeState.deliveryRate !== undefined && afterState.deliveryRate !== undefined) {
        const rateDelta = afterState.deliveryRate - beforeState.deliveryRate;
        if (rateDelta > 0.05) return "partial";
      }
      break;
    case "energy_redirect":
      // 检查能量是否增加
      if (beforeState.energyAvailable !== undefined && afterState.energyAvailable !== undefined) {
        const energyDelta = afterState.energyAvailable - beforeState.energyAvailable;
        if (energyDelta > 100) return "partial";
      }
      break;
    case "remote_stall":
      // remote_stall 的目标是暂停（不是恢复）—— 检查活跃远矿数是否减少
      if (beforeState.activeRemoteOps !== undefined && afterState.activeRemoteOps !== undefined) {
        const opsDelta = beforeState.activeRemoteOps - afterState.activeRemoteOps;
        if (opsDelta > 0) return "success"; // 暂停成功 = success
      }
      break;
  }

  // ── 5. 无任何改善 ──
  if (elapsedTicks > action.estimatedRecoveryTime * 2) {
    // 超过 2 倍预估恢复时间仍无改善 → failed
    return "failed";
  }

  // ── 6. 提交成功但还没到恢复时间 → no_progress ──
  return "no_progress";
}

// ─── Retry Policy ─────────────────────────────────────────

/** Retry 分类。 */
export type RetryClassification =
  | "retryable"          // 可重试（暂时性问题：资源不足、spawn 忙）
  | "non_retryable"      // 不可重试（永久性问题：body 超容量、目标消失）
  | "blocked"            // 被阻塞（威胁/CPU 降级——等待外部条件解除）
  | "resource_constrained" // 资源受限（能量不足——等待能量恢复）
  | "threat_blocked";    // 威胁阻塞（需要先处理威胁）

/** Retry Policy 配置。 */
export interface RetryPolicy {
  /** 最大尝试次数。 */
  maxAttempts: number;
  /** 冷却时长（tick）。 */
  cooldownDuration: number;
  /** Retry 分类。 */
  classification: RetryClassification;
}

/** 默认 Retry Policy 映射（按 Action 类型）。 */
const DEFAULT_RETRY_POLICIES: Record<RecoveryActionType, RetryPolicy> = {
  spawn_recovery: { maxAttempts: 3, cooldownDuration: 100, classification: "retryable" },
  logistics_fix: { maxAttempts: 3, cooldownDuration: 200, classification: "retryable" },
  energy_redirect: { maxAttempts: 2, cooldownDuration: 300, classification: "retryable" },
  defense_response: { maxAttempts: 5, cooldownDuration: 50, classification: "retryable" },
  population_rebuild: { maxAttempts: 2, cooldownDuration: 500, classification: "retryable" },
  route_fix: { maxAttempts: 3, cooldownDuration: 200, classification: "retryable" },
  remote_stall: { maxAttempts: 1, cooldownDuration: 0, classification: "non_retryable" },
  expansion_pause: { maxAttempts: 1, cooldownDuration: 0, classification: "non_retryable" },
  terminal_trade: { maxAttempts: 3, cooldownDuration: 200, classification: "retryable" },
  cpu_conserve: { maxAttempts: 1, cooldownDuration: 0, classification: "non_retryable" },
  manual_intervention: { maxAttempts: 0, cooldownDuration: 0, classification: "non_retryable" },
  auto_resolve: { maxAttempts: 1, cooldownDuration: 0, classification: "non_retryable" },
};

/**
 * 获取 Action 的 Retry Policy。
 */
export function getRetryPolicy(actionType: RecoveryActionType): RetryPolicy {
  return DEFAULT_RETRY_POLICIES[actionType] ?? DEFAULT_RETRY_POLICIES.auto_resolve;
}

/**
 * 分类失败原因 → Retry Classification。
 */
export function classifyFailure(
  reason: string,
  actionType: RecoveryActionType,
): RetryClassification {
  const lower = reason.toLowerCase();

  if (lower.includes("threat") || lower.includes("hostile") || lower.includes("attack")) {
    return "threat_blocked";
  }
  if (lower.includes("energy") || lower.includes("resource")) {
    return "resource_constrained";
  }
  if (lower.includes("cpu") || lower.includes("bucket") || lower.includes("tier")) {
    return "blocked";
  }
  if (lower.includes("not found") || lower.includes("gone") || lower.includes("destroyed")) {
    return "non_retryable";
  }
  if (lower.includes("busy") || lower.includes("queue") || lower.includes("timeout")) {
    return "retryable";
  }

  return DEFAULT_RETRY_POLICIES[actionType]?.classification ?? "retryable";
}

// ─── Recovery Budget ───────────────────────────────────────

/** Recovery Budget 输入。 */
export interface RecoveryBudgetInput {
  /** 当前 tick。 */
  tick: number;
  /** 可用 CPU 预算（剩余 bucket）。 */
  cpuBudget: number;
  /** 帝国总能量储备。 */
  empireEnergyReserve: number;
  /** 活跃 Recovery Action 数量。 */
  activeRecoveryCount: number;
  /** 单次 Recovery 最大 CPU 成本。 */
  maxCpuPerRecovery: number;
  /** 单次 Recovery 最大能量成本。 */
  maxEnergyPerRecovery: number;
}

/** Recovery Budget 判定结果。 */
export interface RecoveryBudgetResult {
  /** 是否允许执行 Recovery。 */
  allowed: boolean;
  /** 允许的 Recovery 数量上限。 */
  maxConcurrent: number;
  /** 允许的单次能量成本上限。 */
  energyBudget: number;
  /** 原因。 */
  reason: string;
}

/**
 * 评估 Recovery Budget（纯函数）。

 * 规则：
 *   - CPU bucket < 1000 → 不允许任何 Recovery（保命优先）
 *   - 帝国能量储备 < 500 → 只允许 spawn_recovery（生存级）
 *   - 活跃 Recovery 数 ≥ 5 → 不再新增（避免风暴）
 *   - 低价值远矿房持续失败 → RECOVERY_UNVIABLE
 */
export function evaluateRecoveryBudget(input: RecoveryBudgetInput): RecoveryBudgetResult {
  // CPU 门槛
  if (input.cpuBudget < 1000) {
    return { allowed: false, maxConcurrent: 0, energyBudget: 0, reason: "CPU bucket too low" };
  }

  // 并发上限
  const maxConcurrent = Math.min(5, Math.floor(input.cpuBudget / 500));
  if (input.activeRecoveryCount >= maxConcurrent) {
    return {
      allowed: false,
      maxConcurrent,
      energyBudget: 0,
      reason: `max concurrent reached (${input.activeRecoveryCount}/${maxConcurrent})`,
    };
  }

  // 能量预算
  const energyBudget = Math.min(
    input.maxEnergyPerRecovery,
    Math.floor(input.empireEnergyReserve * 0.1), // 最多用 10% 储备
  );

  if (input.empireEnergyReserve < 500) {
    return {
      allowed: true,
      maxConcurrent: 1,
      energyBudget: 0, // 只允许零成本 Recovery（如 cpu_conserve）
      reason: "low energy — only zero-cost recovery allowed",
    };
  }

  return {
    allowed: true,
    maxConcurrent,
    energyBudget,
    reason: "budget available",
  };
}

/** Recovery Unviability 判定输入。 */
export interface RecoveryUnviabilityInput {
  /** 目标房间。 */
  room: string;
  /** 失败领域。 */
  domain: FailureDomain;
  /** 累计尝试次数。 */
  totalAttempts: number;
  /** 累计投入资源。 */
  totalInvested: number;
  /** 累计恢复时间（tick）。 */
  totalRecoveryTime: number;
  /** 当前 tick。 */
  tick: number;
}

/** Recovery Unviability 判定结果。 */
export interface RecoveryUnviabilityResult {
  /** 是否判定为不可恢复。 */
  unviable: boolean;
  /** 原因。 */
  reason: string;
  /** 建议动作。 */
  recommendation: string;
}

/**
 * 评估 Recovery 是否不可行（纯函数）。

 * 规则：
 *   - 累计尝试 > 10 → unviable
 *   - 累计投入 > 5000 能量且无改善 → unviable
 *   - 累计恢复时间 > 5000 tick 且无改善 → unviable
 */
export function evaluateRecoveryUnviability(input: RecoveryUnviabilityInput): RecoveryUnviabilityResult {
  if (input.totalAttempts > 10) {
    return {
      unviable: true,
      reason: `too many attempts (${input.totalAttempts})`,
      recommendation: `abandon recovery for ${input.room}:${input.domain} — mark as permanently degraded`,
    };
  }

  if (input.totalInvested > 5000 && input.totalRecoveryTime > 5000) {
    return {
      unviable: true,
      reason: `excessive investment (${input.totalInvested} energy, ${input.totalRecoveryTime} ticks)`,
      recommendation: `abandon recovery for ${input.room}:${input.domain} — ROI negative`,
    };
  }

  return { unviable: false, reason: "viable", recommendation: "continue recovery" };
}

// ─── Recovery Escalation ───────────────────────────────────

/** Escalation 输入。 */
export interface EscalationInput {
  /** 失败的 Recovery Action Record。 */
  failedRecord: RecoveryActionRecord;
  /** 关联的 FailureNode。 */
  failureNode: FailureNode;
  /** 当前活跃的所有 Failure 节点。 */
  allFailures: readonly FailureNode[];
  /** 当前 tick。 */
  tick: number;
}

/** Escalation 结果。 */
export interface EscalationResult {
  /** 是否需要升级（重新 Diagnosis）。 */
  shouldEscalate: boolean;
  /** 升级原因。 */
  reason: string;
  /** 建议的新 Action 类型（如果需要改变方向）。 */
  suggestedActionType?: RecoveryActionType;
  /** 建议的新目标领域（如果根因变了）。 */
  suggestedDomain?: FailureDomain;
}

/**
 * 评估是否需要 Recovery Escalation（纯函数）。

 * 规则：
 *   - 同一 Action 失败 ≥ 2 次 → 重新 Diagnosis
 *   - Action 类型是 spawn_recovery 但失败原因是能量不足 → 应该先修 Energy
 *   - Action 类型是 logistics_fix 但失败原因是威胁 → 应该先修 Defense
 *   - 累计 3+ 次不同 Action 都失败 → 标记整个领域为 unviable
 */
export function evaluateEscalation(input: EscalationInput): EscalationResult {
  const { failedRecord, failureNode, tick } = input;

  // ── 1. 同一 Action 失败 ≥ 2 次 ──
  if (failedRecord.attempts >= 2 && failedRecord.state === "failed") {
    // 重新 Diagnosis：可能根因不是当前 domain
    const reason = failedRecord.failureReason ?? "unknown";

    // spawn 失败因为能量不足 → 先修 Energy
    if (failedRecord.type === "spawn_recovery" &&
        (reason.includes("energy") || reason.includes("resource"))) {
      return {
        shouldEscalate: true,
        reason: `spawn failed due to energy — root cause may be energy, not spawn`,
        suggestedActionType: "energy_redirect",
        suggestedDomain: "energy",
      };
    }

    // logistics 失败因为威胁 → 先修 Defense
    if (failedRecord.type === "logistics_fix" &&
        (reason.includes("threat") || reason.includes("hostile"))) {
      return {
        shouldEscalate: true,
        reason: `logistics failed due to threat — root cause may be defense`,
        suggestedActionType: "defense_response",
        suggestedDomain: "defense",
      };
    }

    // 通用升级：标记为需要重新 Diagnosis
    return {
      shouldEscalate: true,
      reason: `action failed ${failedRecord.attempts} times — re-diagnose root cause`,
    };
  }

  // ── 2. Action 到达 terminal 状态 ──
  if (failedRecord.state === "terminal") {
    return {
      shouldEscalate: true,
      reason: `action reached terminal state — must find alternative recovery path`,
    };
  }

  return {
    shouldEscalate: false,
    reason: "no escalation needed",
  };
}

// ─── 清理过期记录 ───────────────────────────────────────────

/**
 * 清理过期的 Recovery Action 记录（防止 Map 无限增长）。

 * 清理规则：
 *   - succeeded 记录保留 500 tick 后清理
 *   - failed/terminal 记录保留 1000 tick 后清理
 *   - blocked 记录保留 500 tick 后清理
 *   - 活跃记录不清理

 * @param table Recovery Action 追踪表
 * @param currentTick 当前 tick
 * @returns 新的追踪表（不可变更新）
 */
export function cleanupRecoveryTable(
  table: RecoveryActionTable,
  currentTick: number,
): RecoveryActionTable {
  const RETENTION = {
    succeeded: 500,
    failed: 1000,
    terminal: 1000,
    blocked: 500,
  };

  const newTable = new Map(table);

  for (const [key, record] of newTable) {
    if (isActionActive(record)) continue;

    const retention = RETENTION[record.state as keyof typeof RETENTION] ?? 500;
    if (currentTick - record.updatedAt > retention) {
      newTable.delete(key);
    }
  }

  // 安全上限：最多保留 100 条记录
  if (newTable.size > 100) {
    // 删除最老的记录
    const sorted = [...newTable.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    const toRemove = sorted.slice(0, newTable.size - 100);
    for (const [key] of toRemove) {
      newTable.delete(key);
    }
  }

  return newTable;
}

// ─── 统计 ──────────────────────────────────────────────────

/** Recovery 统计数据。 */
export interface RecoveryStats {
  /** 活跃 Action 数。 */
  activeCount: number;
  /** 成功 Action 数（累计）。 */
  succeededCount: number;
  /** 失败 Action 数（累计）。 */
  failedCount: number;
  /** 终态 Action 数。 */
  terminalCount: number;
  /** 阻塞 Action 数。 */
  blockedCount: number;
  /** 总尝试次数。 */
  totalAttempts: number;
  /** 平均恢复时间（tick）。 */
  avgRecoveryTime: number;
}

/**
 * 从追踪表计算统计数据（纯函数）。
 */
export function computeRecoveryStats(
  table: RecoveryActionTable,
  currentTick: number,
): RecoveryStats {
  let activeCount = 0;
  let succeededCount = 0;
  let failedCount = 0;
  let terminalCount = 0;
  let blockedCount = 0;
  let totalAttempts = 0;
  let totalRecoveryTime = 0;

  for (const record of table.values()) {
    totalAttempts += record.attempts;

    if (isActionActive(record)) {
      activeCount++;
    } else if (record.state === "succeeded") {
      succeededCount++;
      totalRecoveryTime += record.updatedAt - record.submittedAt;
    } else if (record.state === "failed" || record.state === "retryable") {
      failedCount++;
    } else if (record.state === "terminal") {
      terminalCount++;
    } else if (record.state === "blocked") {
      blockedCount++;
    }
  }

  const avgRecoveryTime = succeededCount > 0 ? Math.round(totalRecoveryTime / succeededCount) : 0;

  return {
    activeCount,
    succeededCount,
    failedCount,
    terminalCount,
    blockedCount,
    totalAttempts,
    avgRecoveryTime,
  };
}
