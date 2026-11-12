/**
 * 资源流量状态评估（Phase A）。
 *
 * 输入是观测层采集的库存与净流量，输出是契约表 §6 的状态机结果：
 * critical / deficit / healthy / surplus / stuck / unknown。
 *
 * 只做判定，不触发任何停止阀或搬运动作；Phase B/C 再消费这些状态。
 */
import {
  getResourceContract,
  type FlowResourceClass,
  type ResourceCriticality,
} from "./resource-contract";

/** 资源流量状态。 */
export type ResourceFlowState =
  "critical" | "deficit" | "healthy" | "surplus" | "stuck" | "unknown";

/** 单次观测样本。 */
export interface ResourceFlowSample {
  /** 资源常量（energy/battery/H/GH2O/…）。 */
  resource: string;
  /** 当前长周期库存（契约表 §1.4 口径）。 */
  stock: number;
  /** 观测窗口内的流入速率（单位/tick）。 */
  inflowPerTick: number;
  /** 观测窗口内的流出速率（单位/tick）。 */
  outflowPerTick: number;
  /** 上一次评估累计的 stuck tick 数；首次观测缺省 0。 */
  previousStuckTicks?: number;
  /** 本次观测覆盖的 tick 数；缺省 1。 */
  elapsedTicks?: number;
}

/** 单资源评估结果。 */
export interface ResourceFlowEvaluation {
  resource: string;
  flowClass: FlowResourceClass;
  criticality: ResourceCriticality;
  state: ResourceFlowState;
  /**
   * 现有库存可支撑的 tick 数（stock / outflow）。
   * -1 表示无流出数据或资源不参与库存观测。
   */
  stockTicks: number;
  /** 连续 stuck 的 tick 数（0 = 未 stuck）。 */
  stuckTicks: number;
  /** 供日志/遥测的证据链。 */
  evidence: string;
}

/**
 * 评估单资源流量状态。纯函数。
 *
 * 判定顺序：
 * 1. 契约未启用（pixel/credit/ops）→ unknown；
 * 2. stock < criticalWater → critical；
 * 3. stock < lowWater → deficit；
 * 4. stock > hardCap → stuck（硬上限必须立即处理，不看流量方向）；
 * 5. stock > highWater：
 *    - 净流入为正且零流出 → 累计 stuckTicks；
 *    - 达到 stuckTicksThreshold → stuck，否则 surplus；
 *    - 有流出时视为仍在流动 → surplus；
 * 6. 其余 → healthy。
 */
export function evaluateResourceFlow(sample: ResourceFlowSample): ResourceFlowEvaluation {
  const contract = getResourceContract(sample.resource);
  const stock = Math.max(0, sample.stock);
  const inflow = Math.max(0, sample.inflowPerTick);
  const outflow = Math.max(0, sample.outflowPerTick);
  const elapsed = Math.max(1, sample.elapsedTicks ?? 1);
  const previousStuck = Math.max(0, sample.previousStuckTicks ?? 0);
  const stockTicks = outflow > 0 ? stock / outflow : -1;

  if (!contract.enabled) {
    return {
      resource: sample.resource,
      flowClass: contract.flowClass,
      criticality: contract.criticality,
      state: "unknown",
      stockTicks: -1,
      stuckTicks: 0,
      evidence: `disabled class=${contract.flowClass}`,
    };
  }

  const overHardCap = contract.hardCap > 0 && stock > contract.hardCap;
  if (overHardCap) {
    const stuckTicks = previousStuck + elapsed;
    return {
      resource: sample.resource,
      flowClass: contract.flowClass,
      criticality: contract.criticality,
      state: "stuck",
      stockTicks,
      stuckTicks,
      evidence: `over hardCap: stock=${stock}>${contract.hardCap}`,
    };
  }

  if (stock < contract.criticalWater) {
    return {
      resource: sample.resource,
      flowClass: contract.flowClass,
      criticality: contract.criticality,
      state: "critical",
      stockTicks,
      stuckTicks: 0,
      evidence: `stock=${stock}<critical=${contract.criticalWater}`,
    };
  }

  if (stock < contract.lowWater) {
    return {
      resource: sample.resource,
      flowClass: contract.flowClass,
      criticality: contract.criticality,
      state: "deficit",
      stockTicks,
      stuckTicks: 0,
      evidence: `stock=${stock}<low=${contract.lowWater}`,
    };
  }

  if (stock > contract.highWater) {
    const accumulating = inflow > 0 && outflow <= 0;
    const stuckTicks = accumulating ? previousStuck + elapsed : 0;
    const state: ResourceFlowState =
      stuckTicks >= contract.stuckTicksThreshold ? "stuck" : "surplus";
    return {
      resource: sample.resource,
      flowClass: contract.flowClass,
      criticality: contract.criticality,
      state,
      stockTicks,
      stuckTicks,
      evidence: accumulating
        ? `stock=${stock}>high=${contract.highWater}, inflow=${inflow}, outflow=0, stuck=${stuckTicks}`
        : `stock=${stock}>high=${contract.highWater}, outflow=${outflow}`,
    };
  }

  return {
    resource: sample.resource,
    flowClass: contract.flowClass,
    criticality: contract.criticality,
    state: "healthy",
    stockTicks,
    stuckTicks: 0,
    evidence: `stock=${stock} in [${contract.lowWater}, ${contract.highWater}]`,
  };
}

/** 批量评估（供观测层一次处理整房资源）。纯函数。 */
export function evaluateResourceFlows(
  samples: readonly ResourceFlowSample[],
): ResourceFlowEvaluation[] {
  return samples.map(evaluateResourceFlow);
}
