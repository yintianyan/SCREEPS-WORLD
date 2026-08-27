/** Resource Flow */

import type { ResourceType } from "../operation/agenda-item";

// ─── 损失分类 ──────────────────────────────────────────────

/** 资源损失分类。 */
export type LossCategory =
  | "production_loss"   // 生产点到存储点之间丢失
  | "transport_loss"     // 运输过程中丢失
  | "overflow_loss"      // 存储满溢出
  | "death_loss"         // creep 死亡携带
  | "decay_loss"         // 自然衰减
  | "other_loss";        // 其他

/** 损失记录。 */
export interface LossRecord {
  /** 损失分类。 */
  category: LossCategory;
  /** 损失量。 */
  amount: number;
  /** 发生 tick。 */
  tick: number;
  /** 源房名（损失发生地）。 */
  room: string;
  /** 损失原因描述。 */
  reason: string;
}

// ─── 资源流图 ──────────────────────────────────────────────

/**
 * 单资源在一个核算周期内的完整流图。
 */
export interface ResourceFlowGraph {
  /** 资源类型。 */
  resource: ResourceType;
  /** 核算周期起始 tick。 */
  t0: number;
  /** 核算周期结束 tick。 */
  t1: number;
  /** 周期 tick 数。 */
  ticks: number;

  // ── 生产 ──
  /** 本地生产量。 */
  produced: number;
  /** 从其他房调入量。 */
  imported: number;
  /** 市场买入量。 */
  bought: number;

  // ── 转移 ──
  /** 调出到其他房量。 */
  exported: number;
  /** 市场卖出量。 */
  sold: number;

  // ── 存储 ──
  /** 期初存储量。 */
  stockStart: number;
  /** 期末存储量。 */
  stockEnd: number;
  /** 期内存储变化。 */
  stockDelta: number;

  // ── 消费 ──
  /** 消费量（spawn/build/upgrade/repair/tower/lab）。 */
  consumed: number;

  // ── 损失 ──
  /** 总损失量。 */
  totalLoss: number;
  /** 按分类的损失明细。 */
  lossByCategory: Record<LossCategory, number>;

  // ── 恒等式校验 ──
  /**
   * 期望期末存量 = stockStart + produced + imported + bought
   *               - exported - sold - consumed - totalLoss
   * drift = stockEnd - expectedEnd
   * drift ≈ 0 表示流图闭合。
   */
  expectedEnd: number;
  /** drift = stockEnd - expectedEnd。 */
  drift: number;
}

// ─── 构建函数 ──────────────────────────────────────────────

/**
 * 构建资源流图。纯函数。

 * @param resource 资源类型
 * @param t0 起始 tick
 * @param t1 结束 tick
 * @param stockStart 期初存量
 * @param stockEnd 期末存量
 * @param produced 生产量
 * @param imported 调入量
 * @param bought 买入量
 * @param exported 调出量
 * @param sold 卖出量
 * @param consumed 消费量
 * @param losses 损失记录列表
 */
export function buildResourceFlow(
  resource: ResourceType,
  t0: number,
  t1: number,
  stockStart: number,
  stockEnd: number,
  produced: number,
  imported: number,
  bought: number,
  exported: number,
  sold: number,
  consumed: number,
  losses: readonly LossRecord[],
): ResourceFlowGraph {
  const ticks = Math.max(1, t1 - t0);

  // 按分类汇总损失
  const lossByCategory: Record<LossCategory, number> = {
    production_loss: 0,
    transport_loss: 0,
    overflow_loss: 0,
    death_loss: 0,
    decay_loss: 0,
    other_loss: 0,
  };
  let totalLoss = 0;
  for (const loss of losses) {
    lossByCategory[loss.category] += loss.amount;
    totalLoss += loss.amount;
  }

  // 期望期末存量
  const expectedEnd = stockStart + produced + imported + bought
    - exported - sold - consumed - totalLoss;
  const drift = stockEnd - expectedEnd;

  return {
    resource,
    t0,
    t1,
    ticks,
    produced,
    imported,
    bought,
    exported,
    sold,
    stockStart,
    stockEnd,
    stockDelta: stockEnd - stockStart,
    consumed,
    totalLoss,
    lossByCategory,
    expectedEnd,
    drift,
  };
}

/**
 * 判断流图 drift 是否在容差内。纯函数。
 */
export function isFlowGraphBalanced(
  flow: ResourceFlowGraph,
  tolerance: number,
): boolean {
  return Math.abs(flow.drift) <= tolerance;
}

/**
 * 生成流图摘要文本（供日志/Dashboard）。纯函数。
 */
export function summarizeFlowGraph(flow: ResourceFlowGraph): string {
  return `${flow.resource}: `
    + `prod=${Math.round(flow.produced)} `
    + `imp=${Math.round(flow.imported)} `
    + `buy=${Math.round(flow.bought)} `
    + `exp=${Math.round(flow.exported)} `
    + `sold=${Math.round(flow.sold)} `
    + `con=${Math.round(flow.consumed)} `
    + `loss=${Math.round(flow.totalLoss)} `
    + `dStock=${Math.round(flow.stockDelta)} `
    + `drift=${Math.round(flow.drift)}`;
}

// ─── Accounting Invariant ─────────────────────────────────

/**
 * 核算恒等式验证。

 * 不变量：stockEnd = stockStart + produced + imported + bought
 *                   - exported - sold - consumed - totalLoss

 * 等价于：drift = 0。

 * 纯函数。
 */
export function verifyAccountingInvariant(flow: ResourceFlowGraph): {
  valid: boolean;
  drift: number;
  message: string;
} {
  const drift = flow.drift;
  const valid = drift === 0;
  return {
    valid,
    drift,
    message: valid
      ? "balanced"
      : `drift=${drift} (expected=${Math.round(flow.expectedEnd)}, actual=${Math.round(flow.stockEnd)})`,
  };
}
