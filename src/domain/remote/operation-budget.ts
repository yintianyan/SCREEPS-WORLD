/**
 * Remote Operation Budget — A4.1 Phase 2：远矿运营预算追踪。
 *
 * 合同锚点：A4.1 Architecture Audit §4.2（Budget 字段）。
 *
 * 设计意图：
 *   每个远矿 Operation 拥有独立的预算上限，防止亏损 Operation 无限消耗资源。
 *
 *   预算消耗来源：
 *   - Spawn 成本（harvester + hauler + reserver + defender body 摊销）
 *   - 运输成本（hauler 燃料）
 *   - 基建成本（container 建造 + 维修）
 *   - 风险成本（creep 死亡损失 + defender 持续成本）
 *
 *   预算耗尽 → Operation 进入 failed 或 blocked（由 Economic Health 决定）。
 *
 *   与 remote-mining-op.ts 的 RemoteOperationBudget 的关系：
 *   - remote-mining-op.ts 定义了 Operation 上的 budget 字段（limit + consumed）
 *   - 本模块提供预算策略参数和超支检测逻辑
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

// ─── 预算策略 ──────────────────────────────────────────

/**
 * Budget Policy — 预算策略参数。
 */
export interface BudgetPolicy {
  /** 默认预算上限（能量）。 */
  defaultLimit: number;
  /** 最小剩余预算（低于此值标记 low）。 */
  minRemaining: number;
  /** 超支冷却 tick 数（预算耗尽后等多久才能重试）。 */
  exhaustionCooldown: number;
  /** 孵化成本摊销比例（0..1，从预算中扣除的比例）。 */
  spawnCostShare: number;
  /** 运输成本摊销比例。 */
  transportCostShare: number;
  /** 基建成本摊销比例。 */
  infrastructureCostShare: number;
  /** 风险成本摊销比例。 */
  riskCostShare: number;
}

/**
 * 默认预算策略参数。
 * 预算上限 5000 能量（约 50 个 creep body 的孵化成本）。
 */
export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  defaultLimit: 5000,
  minRemaining: 500,
  exhaustionCooldown: 1000,
  spawnCostShare: 0.5,
  transportCostShare: 0.2,
  infrastructureCostShare: 0.15,
  riskCostShare: 0.15,
};

// ─── 预算状态 ──────────────────────────────────────────

/**
 * Budget Status — 预算状态摘要。
 */
export interface BudgetStatus {
  /** 预算上限。 */
  limit: number;
  /** 已消耗。 */
  consumed: number;
  /** 剩余。 */
  remaining: number;
  /** 消耗比例（0..1）。 */
  consumedRatio: number;
  /** 剩余比例（0..1）。 */
  remainingRatio: number;
  /** 是否已耗尽。 */
  exhausted: boolean;
  /** 是否低于最小阈值。 */
  low: boolean;
}

/**
 * 计算预算状态。
 * 纯函数。
 */
export function computeBudgetStatus(
  limit: number,
  consumed: number,
  policy: BudgetPolicy = DEFAULT_BUDGET_POLICY,
): BudgetStatus {
  const remaining = Math.max(0, limit - consumed);
  const consumedRatio = limit > 0 ? Math.min(1, consumed / limit) : 1;
  const remainingRatio = limit > 0 ? Math.max(0, remaining / limit) : 0;
  return {
    limit,
    consumed,
    remaining,
    consumedRatio,
    remainingRatio,
    exhausted: remaining <= 0,
    low: remaining < policy.minRemaining,
  };
}

// ─── 成本记录 ──────────────────────────────────────────

/**
 * Budget Consumption Record — 单次预算消耗记录。
 */
export interface BudgetConsumptionRecord {
  /** Operation ID。 */
  operationId: string;
  /** 消耗 tick。 */
  tick: number;
  /** 消耗金额（能量）。 */
  amount: number;
  /** 消耗类别。 */
  category: BudgetConsumptionCategory;
}

/**
 * 预算消耗类别。
 */
export type BudgetConsumptionCategory =
  | "spawn"
  | "transport"
  | "infrastructure"
  | "risk"
  | "other";

/**
 * 记录一次预算消耗。
 * 纯函数 — 返回新记录。
 */
export function createConsumptionRecord(
  operationId: string,
  tick: number,
  amount: number,
  category: BudgetConsumptionCategory,
): BudgetConsumptionRecord {
  return {
    operationId,
    tick,
    amount: Math.max(0, amount),
    category,
  };
}

// ─── 超支检测 ──────────────────────────────────────────

/**
 * 检测预算是否超支。
 * 纯函数。
 */
export function isBudgetOverrun(
  limit: number,
  consumed: number,
): boolean {
  return consumed > limit;
}

/**
 * 检测预算是否即将超支（消耗比例 > 阈值）。
 * 纯函数。
 */
export function isBudgetNearOverrun(
  limit: number,
  consumed: number,
  threshold: number,
): boolean {
  if (limit <= 0) return true;
  return consumed / limit >= threshold;
}

/**
 * 计算超支冷却到期 tick。
 * 纯函数。
 */
export function computeExhaustionCooldown(
  tick: number,
  policy: BudgetPolicy = DEFAULT_BUDGET_POLICY,
): number {
  return tick + policy.exhaustionCooldown;
}

// ─── 预算分配 ──────────────────────────────────────────

/**
 * 根据策略分配预算上限。
 *
 * 可根据 sourceCount / expectedYield / riskLevel 动态调整预算：
 * - 高产出 → 更高预算（值得更多投资）
 * - 高风险 → 更低预算（限制潜在损失）
 *
 * 纯函数。
 */
export function allocateBudget(
  sourceCount: number,
  expectedYield: number,
  riskLevel: number,
  policy: BudgetPolicy = DEFAULT_BUDGET_POLICY,
): number {
  // 基础预算 × source 数
  let budget = policy.defaultLimit * sourceCount;

  // 产出调整：高产出提升 20%，低产出降 20%
  if (expectedYield >= 10) budget *= 1.2;
  else if (expectedYield < 5) budget *= 0.8;

  // 风险调整：每级风险降 10%
  budget *= Math.max(0.5, 1 - riskLevel * 0.1);

  return Math.round(budget);
}

// ─── 批量查询 ──────────────────────────────────────────

/**
 * 汇总多个 Operation 的预算消耗。
 * 纯函数。
 */
export function aggregateBudgetConsumption(
  records: readonly BudgetConsumptionRecord[],
): {
  totalConsumed: number;
  byCategory: Record<BudgetConsumptionCategory, number>;
} {
  const byCategory: Record<BudgetConsumptionCategory, number> = {
    spawn: 0,
    transport: 0,
    infrastructure: 0,
    risk: 0,
    other: 0,
  };
  let totalConsumed = 0;
  for (const r of records) {
    byCategory[r.category] += r.amount;
    totalConsumed += r.amount;
  }
  return { totalConsumed, byCategory };
}

/**
 * 按 Operation ID 分组消耗记录。
 * 纯函数。
 */
export function groupConsumptionByOp(
  records: readonly BudgetConsumptionRecord[],
): Map<string, BudgetConsumptionRecord[]> {
  const map = new Map<string, BudgetConsumptionRecord[]>();
  for (const r of records) {
    let arr = map.get(r.operationId);
    if (!arr) {
      arr = [];
      map.set(r.operationId, arr);
    }
    arr.push(r);
  }
  return map;
}
