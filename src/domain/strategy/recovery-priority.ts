/**
 * Recovery Priority — A4.5：恢复优先级 + ROI + Cooldown。
 *
 * 合同锚点：A4.5 Task Spec §22 Recovery Priority + §23 ROI + §24 Cooldown。
 *
 * 设计意图：
 *   帝国同时面临多个失败时，需要决定先恢复哪个。
 *   不是所有的失败都需要立即处理——有些可以等，有些必须立即修。
 *
 *   恢复优先级取决于：
 *   1. 失败严重度（critical > error > warning > info）
 *   2. 影响范围（影响多房 > 影响单房 > 全局无影响）
 *   3. 恢复 ROI（投入产出比——低成本高收益优先）
 *   4. Cooldown（同一失败类型最近已尝试恢复 → 冷却中不再重试）
 *   5. 依赖关系（根因失败优先于下游症状）
 *
 *   输出排序后的恢复动作列表，供 empire-health-system 消费。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { FailureNode, FailureSeverity, FailureDomain } from "./failure-propagation";
import type { RootCauseResult, ImpactAnalysisResult } from "./failure-propagation";

// ─── 恢复动作 ──────────────────────────────────────────────

/** 恢复动作类型。 */
export type RecoveryActionType =
  | "spawn_recovery"       // 恢复 spawn（紧急孵化）
  | "logistics_fix"        // 修复物流（补充 hauler）
  | "energy_redirect"      // 重定向能量（跨房调拨）
  | "defense_response"     // 防御响应
  | "population_rebuild"   // 人口重建
  | "route_fix"            // 路由修复
  | "remote_stall"         // 远矿暂停
  | "expansion_pause"      // 扩张暂停
  | "terminal_trade"       // 终端交易（买/卖）
  | "cpu_conserve"         // CPU 降级
  | "manual_intervention"  // 需要人工干预
  | "auto_resolve";        // 自动恢复（无需特殊动作）

/** 单个恢复动作。 */
export interface RecoveryAction {
  /** 唯一标识。 */
  id: string;
  /** 动作类型。 */
  type: RecoveryActionType;
  /** 目标失败节点 ID。 */
  targetFailureId: string;
  /** 目标领域。 */
  domain: FailureDomain;
  /** 优先级分数（0..100，越高越优先）。 */
  priority: number;
  /** 预估成本（CPU/tick 或能量）。 */
  estimatedCost: number;
  /** 预估收益（恢复的概率 × 影响范围）。 */
  estimatedBenefit: number;
  /** ROI = benefit / cost。 */
  roi: number;
  /** 是否需要立即执行（不可延迟）。 */
  urgent: boolean;
  /** 预估恢复时间（tick）。 */
  estimatedRecoveryTime: number;
  /** 人类可读描述。 */
  description: string;
  /** 建议的恢复动作详情。 */
  recommendation: string;
}

// ─── Cooldown 追踪 ────────────────────────────────────────

/** Cooldown 条目。 */
export interface CooldownEntry {
  /** 失败领域。 */
  domain: FailureDomain;
  /** 目标房间（可选）。 */
  room?: string;
  /** 上次尝试恢复的 tick。 */
  lastAttemptTick: number;
  /** 冷却时长（tick）。 */
  cooldownDuration: number;
  /** 尝试次数。 */
  attemptCount: number;
  /** 上次尝试是否成功。 */
  lastSuccess: boolean;
}

/** Cooldown 表。 */
export type CooldownTable = Map<string, CooldownEntry>;

/**
 * 生成 cooldown key。
 */
export function cooldownKey(domain: FailureDomain, room?: string): string {
  return room ? `${domain}:${room}` : domain;
}

/**
 * 检查某个恢复动作是否在冷却中（纯函数）。
 *
 * @param cooldowns cooldown 表
 * @param domain 失败领域
 * @param room 目标房间（可选）
 * @param currentTick 当前 tick
 * @returns 是否在冷却中
 */
export function isOnCooldown(
  cooldowns: CooldownTable,
  domain: FailureDomain,
  room: string | undefined,
  currentTick: number,
): boolean {
  const key = cooldownKey(domain, room);
  const entry = cooldowns.get(key);
  if (!entry) return false;
  return currentTick < entry.lastAttemptTick + entry.cooldownDuration;
}

/**
 * 获取剩余冷却时间（tick）。
 */
export function remainingCooldown(
  cooldowns: CooldownTable,
  domain: FailureDomain,
  room: string | undefined,
  currentTick: number,
): number {
  const key = cooldownKey(domain, room);
  const entry = cooldowns.get(key);
  if (!entry) return 0;
  return Math.max(0, entry.lastAttemptTick + entry.cooldownDuration - currentTick);
}

/**
 * 记录一次恢复尝试（纯函数——返回新的 cooldown 表）。
 */
export function recordRecoveryAttempt(
  cooldowns: CooldownTable,
  domain: FailureDomain,
  room: string | undefined,
  currentTick: number,
  success: boolean,
  cooldownDuration: number = 200,
): CooldownTable {
  const key = cooldownKey(domain, room);
  const existing = cooldowns.get(key);
  const newEntry: CooldownEntry = {
    domain,
    room,
    lastAttemptTick: currentTick,
    cooldownDuration,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    lastSuccess: success,
  };
  const newTable = new Map(cooldowns);
  newTable.set(key, newEntry);
  return newTable;
}

// ─── 优先级计算 ────────────────────────────────────────────

/** 严重度权重。 */
const SEVERITY_WEIGHT: Record<FailureSeverity, number> = {
  info: 10,
  warning: 30,
  error: 60,
  critical: 100,
};

/** 领域权重（某些领域的失败影响更大）。 */
const DOMAIN_WEIGHT: Record<FailureDomain, number> = {
  energy: 1.5,
  logistics: 1.3,
  spawn: 1.4,
  colony: 1.2,
  network: 1.1,
  threat: 1.3,
  cpu: 1.0,
  remote: 0.8,
  expansion: 0.6,
  terminal: 0.7,
  mineral: 0.7,
  defense: 1.4,
};

/** 恢复动作推荐映射。 */
const RECOVERY_RECOMMENDATIONS: Record<FailureDomain, { type: RecoveryActionType; recommendation: string; cost: number; time: number }> = {
  energy: { type: "energy_redirect", recommendation: "redirect energy from surplus rooms via terminal or carrier", cost: 500, time: 200 },
  logistics: { type: "logistics_fix", recommendation: "spawn replacement hauler + verify route", cost: 300, time: 150 },
  spawn: { type: "spawn_recovery", recommendation: "emergency spawn [WORK,CARRY,MOVE] with available energy", cost: 200, time: 50 },
  colony: { type: "population_rebuild", recommendation: "rebuild population via spawn priority adjustment", cost: 800, time: 500 },
  network: { type: "energy_redirect", recommendation: "rebalance network via agenda-manager allocation", cost: 100, time: 100 },
  threat: { type: "defense_response", recommendation: "activate defense: tower focus + defender spawn", cost: 1000, time: 10 },
  cpu: { type: "cpu_conserve", recommendation: "activate CPU conservation mode: skip P3 systems", cost: 0, time: 0 },
  remote: { type: "remote_stall", recommendation: "pause remote mining ops until route safe", cost: 0, time: 0 },
  expansion: { type: "expansion_pause", recommendation: "pause expansion until stability restored", cost: 0, time: 0 },
  terminal: { type: "terminal_trade", recommendation: "execute terminal trade to rebalance resources", cost: 200, time: 100 },
  mineral: { type: "terminal_trade", recommendation: "buy missing minerals via terminal market", cost: 500, time: 200 },
  defense: { type: "defense_response", recommendation: "activate safe mode + spawn defenders", cost: 1000, time: 5 },
};

// ─── 核心函数 ──────────────────────────────────────────────

/**
 * 计算单个失败的恢复优先级（纯函数）。
 *
 * 优先级 = 严重度权重 × 领域权重 × 影响因子 × 紧急因子 × ROI 因素
 *
 * @param failure 失败节点
 * @param rootCauses 根因检测结果（如果是根因，优先级更高）
 * @param impact 影响范围分析结果
 * @param cooldowns cooldown 表
 * @param currentTick 当前 tick
 * @returns 恢复动作（或 null 如果在冷却中）
 */
export function computeRecoveryPriority(
  failure: FailureNode,
  isRootCause: boolean,
  impact: ImpactAnalysisResult | null,
  cooldowns: CooldownTable,
  currentTick: number,
): RecoveryAction | null {
  // 检查冷却
  if (isOnCooldown(cooldowns, failure.domain, failure.room, currentTick)) {
    return null;
  }

  const severityW = SEVERITY_WEIGHT[failure.severity] ?? 30;
  const domainW = DOMAIN_WEIGHT[failure.domain] ?? 1.0;

  // 影响因子：受影响节点数
  const impactFactor = impact
    ? Math.min(2, 1 + impact.affectedNodes.length * 0.1)
    : 1;

  // 紧急因子：critical 且无 cooldown → urgent
  const urgent = failure.severity === "critical" || failure.severity === "error";

  // 根因优先：根因的优先级提升 50%
  const rootCauseBoost = isRootCause ? 1.5 : 1.0;

  // 获取恢复建议
  const rec = RECOVERY_RECOMMENDATIONS[failure.domain] ?? RECOVERY_RECOMMENDATIONS.energy;

  // ROI 计算
  const estimatedCost = rec.cost;
  const estimatedBenefit = severityW * domainW * impactFactor;
  const roi = estimatedCost > 0 ? estimatedBenefit / estimatedCost : estimatedBenefit;

  // 最终优先级分数
  const priority = Math.min(100, Math.round(
    severityW * domainW * impactFactor * rootCauseBoost,
  ));

  return {
    id: `recovery:${failure.id}`,
    type: rec.type,
    targetFailureId: failure.id,
    domain: failure.domain,
    priority,
    estimatedCost,
    estimatedBenefit,
    roi,
    urgent,
    estimatedRecoveryTime: rec.time,
    description: failure.description,
    recommendation: rec.recommendation,
  };
}

/**
 * 对多个失败节点排序恢复优先级（纯函数）。
 *
 * 排序规则：
 *   1. urgent 优先
 *   2. 根因优先（isRootCause）
 *   3. priority 分数降序
 *   4. ROI 降序（同分时）
 *
 * @param failures 失败节点列表
 * @param rootCauseIds 根因节点 ID 集合
 * @param impacts 影响范围分析结果映射
 * @param cooldowns cooldown 表
 * @param currentTick 当前 tick
 * @returns 排序后的恢复动作列表（已过滤冷却中的）
 */
export function prioritizeRecovery(
  failures: readonly FailureNode[],
  rootCauseIds: ReadonlySet<string>,
  impacts: ReadonlyMap<string, ImpactAnalysisResult>,
  cooldowns: CooldownTable,
  currentTick: number,
): RecoveryAction[] {
  const actions: RecoveryAction[] = [];

  for (const failure of failures) {
    if (failure.resolved) continue;

    const isRoot = rootCauseIds.has(failure.id);
    const impact = impacts.get(failure.id) ?? null;

    const action = computeRecoveryPriority(
      failure,
      isRoot,
      impact,
      cooldowns,
      currentTick,
    );

    if (action) actions.push(action);
  }

  // 排序：urgent → rootCause → priority desc → roi desc
  actions.sort((a, b) => {
    // urgent 优先
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    // 根因优先
    const aRoot = rootCauseIds.has(a.targetFailureId) ? 1 : 0;
    const bRoot = rootCauseIds.has(b.targetFailureId) ? 1 : 0;
    if (aRoot !== bRoot) return bRoot - aRoot;
    // priority 降序
    if (a.priority !== b.priority) return b.priority - a.priority;
    // ROI 降序
    return b.roi - a.roi;
  });

  return actions;
}

/**
 * 从恢复动作列表中选择下一个要执行的动作（纯函数）。
 *
 * 选择逻辑：
 *   1. 过滤冷却中的
 *   2. 取优先级最高的
 *   3. 如果最高优先级是 urgent，立即返回
 *   4. 否则考虑 ROI（避免高成本低收益的动作）
 *
 * @param actions 已排序的恢复动作列表
 * @param maxConcurrent 最大并发恢复数
 * @returns 选中的恢复动作（或 null 如果无可用）
 */
export function selectNextRecovery(
  actions: readonly RecoveryAction[],
  maxConcurrent: number = 3,
): RecoveryAction | null {
  if (actions.length === 0) return null;

  // 取前 maxConcurrent 个
  const candidates = actions.slice(0, maxConcurrent);

  // 第一个就是最优选
  return candidates[0] ?? null;
}
