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

// ─── Memory 投影（紧凑字段，供消费侧与遥测读取）──────────────

/** 状态 → 稳定整数编码（Memory 里存短码，禁止重排）。 */
export const RESOURCE_FLOW_STATE_CODES: Readonly<Record<ResourceFlowState, number>> = {
  critical: 0,
  deficit: 1,
  healthy: 2,
  surplus: 3,
  stuck: 4,
  unknown: 5,
};

/** 状态编码；未知字符串落到 unknown。 */
export function encodeResourceFlowState(state: ResourceFlowState): number {
  return RESOURCE_FLOW_STATE_CODES[state] ?? RESOURCE_FLOW_STATE_CODES.unknown;
}

/** 解码状态码；未知数字按 unknown 处理（旧 Memory/损坏数据不抛异常）。 */
export function decodeResourceFlowState(code: number): ResourceFlowState {
  for (const [state, value] of Object.entries(RESOURCE_FLOW_STATE_CODES)) {
    if (value === code) return state as ResourceFlowState;
  }
  return "unknown";
}

/** 单资源在 Memory 里的紧凑投影。 */
export interface ResourceFlowMemoryEntry {
  /** 状态码（RESOURCE_FLOW_STATE_CODES）。 */
  s: number;
  /** 连续累积的 stuck 计数（>0 时写入；surplus 期的累积也要留，否则永远到不了阈值）。 */
  k?: number;
  /** 库存。 */
  q: number;
  /** 流入速率 ×100（整数化，单位/tick）。 */
  i: number;
  /** 流出速率 ×100。 */
  o: number;
}

/** RoomMemory.resourceFlow 的完整形状。 */
export interface ResourceFlowMemory {
  /** 评估拍。 */
  t: number;
  /** 评估覆盖的拍数（窗口长度）。 */
  w: number;
  /** 截断前的资源数；`r` 超过上限被切时有它才能发现「榜是全集」不成立。 */
  n?: number;
  /** 资源 → 紧凑投影。 */
  r: Record<string, ResourceFlowMemoryEntry>;
}

/** 每房保留的资源条目上限（Memory 体积护栏；资源种类实际远小于此）。 */
const MAX_RESOURCE_FLOW_ENTRIES = 16;

/**
 * 把一次评估结果写成 Memory 投影。
 *
 * 只保留 enabled 且非 unknown 的资源：disabled（ops/pixel/credit）与 unknown
 * 落盘只会白涨字节，消费侧读不到键时按「没有信号」处理。
 * `samples` 与 `evaluations` 必须来自同一批资源（调用方一次构造、一次评估）。
 */
export function toResourceFlowMemory(
  evaluations: readonly ResourceFlowEvaluation[],
  samples: readonly ResourceFlowSample[],
  tick: number,
  windowTicks: number,
): ResourceFlowMemory {
  const byResource = new Map(samples.map(sample => [sample.resource, sample]));
  const entries: [string, ResourceFlowMemoryEntry][] = [];
  for (const evaluation of evaluations) {
    if (evaluation.state === "unknown") continue;
    const sample = byResource.get(evaluation.resource);
    if (!sample) continue;
    entries.push([
      evaluation.resource,
      {
        s: encodeResourceFlowState(evaluation.state),
        ...(evaluation.stuckTicks > 0 ? { k: Math.round(evaluation.stuckTicks) } : {}),
        q: Math.round(sample.stock),
        i: Math.round(Math.max(0, sample.inflowPerTick) * 100),
        o: Math.round(Math.max(0, sample.outflowPerTick) * 100),
      },
    ]);
  }
  // 按资源名排序后截断：状态本身不参与排序，避免「贵的资源」把「有信号的资源」挤掉。
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const kept = entries.slice(0, MAX_RESOURCE_FLOW_ENTRIES);
  const r: Record<string, ResourceFlowMemoryEntry> = Object.fromEntries(kept);
  return {
    t: tick,
    w: Math.max(1, windowTicks),
    ...(entries.length > kept.length ? { n: entries.length } : {}),
    r,
  };
}

/** 读数最大年龄（拍）：3 个 50 拍评估窗，超过视为「没有信号」。 */
export const RESOURCE_FLOW_MAX_AGE_TICKS = 150;

/** 读取某资源的状态；读数超龄/未覆盖该资源时返回 undefined。 */
export function readResourceFlowState(
  memory: ResourceFlowMemory | undefined,
  resource: string,
  tick: number,
  maxAgeTicks = RESOURCE_FLOW_MAX_AGE_TICKS,
): ResourceFlowState | undefined {
  if (!memory) return undefined;
  if (tick - memory.t > maxAgeTicks) return undefined;
  const entry = memory.r[resource];
  if (!entry) return undefined;
  return decodeResourceFlowState(entry.s);
}
