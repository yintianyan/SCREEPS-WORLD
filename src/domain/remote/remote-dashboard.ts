/** Remote Economy Dashboard */

import type { RemoteMiningOperationContext } from "../operation/remote-mining-op";
import type { ResourceFlowSnapshot } from "./flow-accounting";
import type { EconomicAccountingResult } from "./economic-accounting";
import type { ROIResult } from "./roi";
import type { BudgetStatus } from "./operation-budget";
import type { ContainerSnapshot } from "./container-lifecycle";

// ─── Dashboard 条目 ─────────────────────────────────────

/**
 * Remote Economy Dashboard Entry — 单个远矿运营的全链路数据条目。
 */
export interface RemoteDashboardEntry {
  // ── 标识 ──
  operationId: string;
  sourceId: string;
  homeRoom: string;
  targetRoom: string;

  // ── 状态 ──
  status: string;
  checkpoint: string;
  economicHealth: string;

  // ── 生产 ──
  expectedYield: number;
  actualProduction: number;
  actualDelivered: number;
  actualLost: number;

  // ── 经济 ──
  grossProduction: number;
  transportCost: number;
  infrastructureCost: number;
  spawnCost: number;
  riskCost: number;
  netValue: number;
  profitable: boolean;

  // ── ROI ──
  expectedROI: number;
  actualROI: number;
  roiAchievement: number;

  // ── 预算 ──
  budgetLimit: number;
  budgetConsumed: number;
  budgetRemaining: number;
  budgetExhausted: boolean;

  // ── 威胁 ──
  threatLevel: number;

  // ── Container ──
  containerState: string;

  // ── 可解释性 ──
  /** 健康度原因。 */
  healthReason: string;
  /** "为什么赚钱" 或 "为什么暂停" 的解释。 */
  explanation: string;
}

// ─── Dashboard 汇总 ─────────────────────────────────────

/**
 * Remote Economy Dashboard — 帝国级远矿汇总。
 */
export interface RemoteDashboard {
  tick: number;
  /** 总活跃远矿数。 */
  activeOps: number;
  /** 总产出（e/tick）。 */
  totalProduction: number;
  /** 总交付（e/tick）。 */
  totalDelivered: number;
  /** 总净价值（e/tick）。 */
  totalNetValue: number;
  /** 健康运营数。 */
  healthyOps: number;
  /** 降级运营数。 */
  degradedOps: number;
  /** 暂停运营数。 */
  suspendedOps: number;
  /** 摘要文本。 */
  summary: string;
  /** 各远矿详细条目。 */
  entries: RemoteDashboardEntry[];
}

// ─── Dashboard 构建输入 ─────────────────────────────────

/**
 * 构建 Dashboard 所需的输入数据。
 */
export interface DashboardBuildInput {
  tick: number;
  ops: readonly RemoteMiningOperationContext[];
  flows: Map<string, ResourceFlowSnapshot>;
  accountings: Map<string, EconomicAccountingResult>;
  rois: Map<string, ROIResult>;
  budgets: Map<string, BudgetStatus>;
  threatLevels: Map<string, number>;
  containers: Map<string, ContainerSnapshot>;
  healthReasons: Map<string, string>;
}

// ─── Dashboard 构建 ─────────────────────────────────────

/**
 * 构建远矿经济 Dashboard。

 * 纯函数 — 不访问 Game/Memory。
 */
export function buildRemoteDashboard(
  input: DashboardBuildInput,
): RemoteDashboard {
  const entries: RemoteDashboardEntry[] = [];

  let totalProduction = 0;
  let totalDelivered = 0;
  let totalNetValue = 0;
  let healthyOps = 0;
  let degradedOps = 0;
  let suspendedOps = 0;

  for (const op of input.ops) {
    const flow = input.flows.get(op.id);
    const accounting = input.accountings.get(op.id);
    const roi = input.rois.get(op.id);
    const budget = input.budgets.get(op.id);
    const threatLevel = input.threatLevels.get(op.sourceId) ?? 0;
    const container = input.containers.get(op.sourceId);
    const healthReason = input.healthReasons.get(op.id) ?? "unknown";

    const entry: RemoteDashboardEntry = {
      operationId: op.id,
      sourceId: op.sourceId,
      homeRoom: op.sourceRoom,
      targetRoom: op.targetRoom,
      status: op.status,
      checkpoint: op.checkpoint,
      economicHealth: op.economicHealth,
      expectedYield: op.expectedYield,
      actualProduction: op.actualProduction,
      actualDelivered: op.actualDelivered,
      actualLost: op.actualLost,
      grossProduction: accounting?.grossProduction ?? 0,
      transportCost: accounting?.transportCost ?? 0,
      infrastructureCost: accounting?.infrastructureCost ?? 0,
      spawnCost: accounting?.spawnCost ?? 0,
      riskCost: accounting?.riskCost ?? 0,
      netValue: accounting?.netValue ?? 0,
      profitable: accounting?.profitable ?? false,
      expectedROI: roi?.expectedROI ?? 0,
      actualROI: roi?.actualROI ?? 0,
      roiAchievement: roi?.roiAchievement ?? 0,
      budgetLimit: op.budget.limit,
      budgetConsumed: op.budget.consumed,
      budgetRemaining: op.budget.limit - op.budget.consumed,
      budgetExhausted: op.budget.consumed >= op.budget.limit,
      threatLevel,
      containerState: container?.state ?? "unknown",
      healthReason,
      explanation: buildExplanation(
        op.economicHealth,
        healthReason,
        accounting?.netValue ?? 0,
        threatLevel,
        op.budget.consumed >= op.budget.limit,
      ),
    };

    entries.push(entry);

    totalProduction += accounting?.grossProduction ?? 0;
    totalDelivered += flow?.delivered ?? 0;
    totalNetValue += accounting?.netValue ?? 0;

    switch (op.economicHealth) {
      case "healthy":
        healthyOps++;
        break;
      case "degraded":
      case "unprofitable":
        degradedOps++;
        break;
      case "suspended":
      case "failed":
        suspendedOps++;
        break;
    }
  }

  const summary = `active=${entries.length} healthy=${healthyOps} ` +
    `degraded=${degradedOps} suspended=${suspendedOps} ` +
    `production=${totalProduction.toFixed(1)}e/t ` +
    `delivered=${totalDelivered.toFixed(1)}e/t ` +
    `net=${totalNetValue.toFixed(1)}e/t`;

  return {
    tick: input.tick,
    activeOps: entries.length,
    totalProduction,
    totalDelivered,
    totalNetValue,
    healthyOps,
    degradedOps,
    suspendedOps,
    summary,
    entries,
  };
}

// ─── 可解释性 ──────────────────────────────────────────

/**
 * 构建可解释性文本——回答 "为什么赚钱" 或 "为什么暂停"。

 * 纯函数。
 */
export function buildExplanation(
  health: string,
  reason: string,
  netValue: number,
  threatLevel: number,
  budgetExhausted: boolean,
): string {
  if (health === "healthy") {
    return `赚钱中：netValue=${netValue.toFixed(1)}e/t，原因=${reason}`;
  }
  if (health === "suspended") {
    if (threatLevel >= 3) {
      return `暂停：威胁等级 CRITICAL(${threatLevel})，等待威胁消除`;
    }
    if (budgetExhausted) {
      return `暂停：预算耗尽，等待预算补充`;
    }
    return `暂停：${reason}`;
  }
  if (health === "unprofitable") {
    return `不盈利：netValue=${netValue.toFixed(1)}e/t ≤ 0，持续亏损中`;
  }
  if (health === "degraded") {
    return `降级：${reason}`;
  }
  if (health === "failed") {
    return `失败：${reason}`;
  }
  return `状态未知：${reason}`;
}

// ─── 瘦快照 ──────────────────────────────────────────────

/**
 * Remote Economy Dashboard 瘦快照（存入 Memory.kernel.remoteEconomyDashboard）。
 */
export interface RemoteDashboardSnapshot {
  t: number;
  ao: number;
  tp: number;
  td: number;
  nv: number;
  ho: number;
  dg: number;
  sp: number;
  s: string;
}

/**
 * 序列化 Dashboard 为瘦快照。
 * 纯函数。
 */
export function serializeDashboard(
  dashboard: RemoteDashboard,
): RemoteDashboardSnapshot {
  return {
    t: dashboard.tick,
    ao: dashboard.activeOps,
    tp: Math.round(dashboard.totalProduction * 10) / 10,
    td: Math.round(dashboard.totalDelivered * 10) / 10,
    nv: Math.round(dashboard.totalNetValue * 10) / 10,
    ho: dashboard.healthyOps,
    dg: dashboard.degradedOps,
    sp: dashboard.suspendedOps,
    s: dashboard.summary,
  };
}
