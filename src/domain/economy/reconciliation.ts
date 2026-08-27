/** Resource Reconciliation */

import type { ResourceType } from "../operation/agenda-item";
import type { ResourceLedger, ResourceStockSnapshot } from "./resource-ledger";
import { stockTotal } from "./resource-ledger";

// ─── 对账结果 ──────────────────────────────────────────────

/** 单资源对账状态。 */
export type ReconciliationStatus =
  | "balanced"             // 账实一致
  | "minor_drift"          // 轻微漂移（容差内）
  | "major_drift"          // 严重漂移（超容差）
  | "missing_in_ledger"    // 实际有库存但 ledger 无条目
  | "missing_in_actual"     // ledger 有条目但实际无库存
  | "reconciliation_required"; // 需要重置

/** 单资源对账结果。 */
export interface ReconciliationResult {
  /** 资源类型。 */
  resource: ResourceType;
  /** 对账状态。 */
  status: ReconciliationStatus;
  /** Ledger 记录的存量。 */
  ledgerStock: number;
  /** 实际存量。 */
  actualStock: number;
  /** 差异 = actual - ledger。 */
  difference: number;
  /** 差异比例 = |difference| / max(actual, ledger, 1)。 */
  differenceRatio: number;
  /** 人类可读原因。 */
  reason: string;
}

/** 帝国级对账汇总。 */
export interface ReconciliationSummary {
  /** 采样 tick。 */
  tick: number;
  /** 校验的资源数。 */
  checkedResources: number;
  /** balanced 数量。 */
  balanced: number;
  /** minor_drift 数量。 */
  minorDrift: number;
  /** major_drift 数量。 */
  majorDrift: number;
  /** 需要重置的资源列表。 */
  reconciliationRequired: ResourceType[];
  /** 各资源对账结果。 */
  results: ReconciliationResult[];
  /** 总体是否通过（无 major_drift + 无 reconciliation_required）。 */
  passed: boolean;
}

// ─── 对账参数 ──────────────────────────────────────────────

/** 对账参数。 */
export interface ReconciliationOptions {
  /** minor drift 容差比例（< 此值 = minor，> 此值 = major）。 */
  minorDriftTolerance: number;
  /** major drift 阈值比例（> 此值触发 reconciliation_required）。 */
  majorDriftThreshold: number;
  /** 触发 reconciliation_required 的绝对差异量。 */
  majorDriftAbsolute: number;
}

/** 默认参数。 */
export const DEFAULT_RECONCILIATION_OPTIONS: ReconciliationOptions = {
  minorDriftTolerance: 0.05,   // 5%
  majorDriftThreshold: 0.20,    // 20%
  majorDriftAbsolute: 500,      // 500 单位
};

// ─── 对账函数 ──────────────────────────────────────────────

/**
 * 对账单个资源。纯函数。

 * @param resource 资源类型
 * @param ledgerStock Ledger 记录的存量
 * @param actualStock 实际存量（从 RoomSnapshot 采集）
 * @param options 对账参数
 */
export function reconcileResource(
  resource: ResourceType,
  ledgerStock: number,
  actualStock: number,
  options: ReconciliationOptions = DEFAULT_RECONCILIATION_OPTIONS,
): ReconciliationResult {
  const difference = actualStock - ledgerStock;
  const maxVal = Math.max(actualStock, ledgerStock, 1);
  const differenceRatio = Math.abs(difference) / maxVal;

  // 无差异
  if (difference === 0) {
    return {
      resource,
      status: "balanced",
      ledgerStock,
      actualStock,
      difference,
      differenceRatio,
      reason: "exact match",
    };
  }

  // 实际有但 ledger 无
  if (ledgerStock === 0 && actualStock > 0) {
    return {
      resource,
      status: "missing_in_ledger",
      ledgerStock,
      actualStock,
      difference,
      differenceRatio,
      reason: `actual=${actualStock}, ledger=0`,
    };
  }

  // ledger 有但实际无
  if (ledgerStock > 0 && actualStock === 0) {
    return {
      resource,
      status: "missing_in_actual",
      ledgerStock,
      actualStock,
      difference,
      differenceRatio,
      reason: `ledger=${ledgerStock}, actual=0`,
    };
  }

  // 判断 drift 严重度
  const absDiff = Math.abs(difference);
  if (differenceRatio >= options.majorDriftThreshold
    || absDiff >= options.majorDriftAbsolute) {
    // 是否需要重置
    if (differenceRatio >= options.majorDriftThreshold * 2
      || absDiff >= options.majorDriftAbsolute * 5) {
      return {
        resource,
        status: "reconciliation_required",
        ledgerStock,
        actualStock,
        difference,
        differenceRatio,
        reason: `diff=${difference.toFixed(0)} ratio=${differenceRatio.toFixed(2)} exceeds reset threshold`,
      };
    }
    return {
      resource,
      status: "major_drift",
      ledgerStock,
      actualStock,
      difference,
      differenceRatio,
      reason: `diff=${difference.toFixed(0)} ratio=${differenceRatio.toFixed(2)} > ${options.majorDriftThreshold}`,
    };
  }

  // minor drift
  if (differenceRatio <= options.minorDriftTolerance) {
    return {
      resource,
      status: "minor_drift",
      ledgerStock,
      actualStock,
      difference,
      differenceRatio,
      reason: `diff=${difference.toFixed(0)} ratio=${differenceRatio.toFixed(2)} <= ${options.minorDriftTolerance}`,
    };
  }

  // 介于 minor 和 major 之间
  return {
    resource,
    status: "major_drift",
    ledgerStock,
    actualStock,
    difference,
    differenceRatio,
    reason: `diff=${difference.toFixed(0)} ratio=${differenceRatio.toFixed(2)}`,
  };
}

/**
 * 对账整个 Ledger。纯函数。

 * @param tick 当前 tick
 * @param ledger ResourceLedger
 * @param actualStocks 实际存量快照（从 RoomSnapshot 采集）
 * @param options 对账参数
 */
export function reconcileLedger(
  tick: number,
  ledger: ResourceLedger,
  actualStocks: ReadonlyMap<ResourceType, number>,
  options: ReconciliationOptions = DEFAULT_RECONCILIATION_OPTIONS,
): ReconciliationSummary {
  const results: ReconciliationResult[] = [];
  const reconciliationRequired: ResourceType[] = [];

  // 检查 ledger 中所有资源
  const allResources = new Set<ResourceType>([
    ...ledger.keys(),
    ...actualStocks.keys(),
  ]);

  for (const resource of allResources) {
    const entry = ledger.get(resource);
    const ledgerStock = entry ? stockTotal(entry.stock) : 0;
    const actualStock = actualStocks.get(resource) ?? 0;

    const result = reconcileResource(resource, ledgerStock, actualStock, options);
    results.push(result);

    if (result.status === "reconciliation_required") {
      reconciliationRequired.push(resource);
    }
  }

  // 统计
  const balanced = results.filter(r => r.status === "balanced").length;
  const minorDrift = results.filter(r => r.status === "minor_drift").length;
  const majorDrift = results.filter(r =>
    r.status === "major_drift"
    || r.status === "missing_in_ledger"
    || r.status === "missing_in_actual"
  ).length;

  return {
    tick,
    checkedResources: results.length,
    balanced,
    minorDrift,
    majorDrift,
    reconciliationRequired,
    results,
    passed: reconciliationRequired.length === 0 && majorDrift === 0,
  };
}

/**
 * 生成对账摘要文本（供日志/Dashboard）。纯函数。
 */
export function summarizeReconciliation(summary: ReconciliationSummary): string {
  const parts = [
    `checked=${summary.checkedResources}`,
    `balanced=${summary.balanced}`,
    `minor=${summary.minorDrift}`,
    `major=${summary.majorDrift}`,
  ];
  if (summary.reconciliationRequired.length > 0) {
    parts.push(`reset=${summary.reconciliationRequired.join(",")}`);
  }
  parts.push(summary.passed ? "PASS" : "FAIL");
  return parts.join(" ");
}
