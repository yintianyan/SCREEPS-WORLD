/**
 * Resource Flow Accounting — A4.1 Phase 2：远矿资源流追踪。
 *
 * 合同锚点：A4.1 Architecture Audit §9.2（Resource Flow 追踪缺失）。
 *
 * 设计意图：
 *   追踪远矿资源从采集到交付的完整链路：
 *   Produced → Transported → Delivered → Lost → Consumed → Stored
 *
 *   不修改角色代码——从 Creep 行为间接采集数据：
 *   - Produced: remoteHarvester 的 harvest 量
 *   - Transported: remoteHauler 的 withdraw 量
 *   - Delivered: remoteHauler 的 transfer 量（到达 home）
 *   - Lost: drop + container 满溢出 + creep 死亡携带
 *
 *   用途：供 Economic Accounting 计算 Net Value，供 ROI 计算 Actual ROI，
 *   供 Economic Health 检测 Over/Underproduction。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

// ─── 资源流快照 ─────────────────────────────────────────

/**
 * Resource Flow Snapshot — 某一时间段内的资源流统计。
 */
export interface ResourceFlowSnapshot {
  /** 关联的 RemoteMiningOperation ID。 */
  operationId: string;
  /** 统计起始 tick。 */
  periodStart: number;
  /** 统计结束 tick。 */
  periodEnd: number;
  /** 产出量（harvester 采集总量，能量）。 */
  produced: number;
  /** 运输量（hauler 从 container 取出总量，能量）。 */
  transported: number;
  /** 交付量（hauler 到达 home 后 transfer 总量，能量）。 */
  delivered: number;
  /** 损失量（drop + container 溢出 + creep 死亡携带，能量）。 */
  lost: number;
  /** 消费量（被其他 creep 取用，如 builder 从 container 取，能量）。 */
  consumed: number;
  /** 当前 container 存量（快照时点，能量）。 */
  stored: number;
}

/** 创建空快照。纯函数。 */
export function createEmptyFlow(
  operationId: string,
  periodStart: number,
  periodEnd: number,
): ResourceFlowSnapshot {
  return {
    operationId,
    periodStart,
    periodEnd,
    produced: 0,
    transported: 0,
    delivered: 0,
    lost: 0,
    consumed: 0,
    stored: 0,
  };
}

// ─── 累加操作 ──────────────────────────────────────────

/**
 * 累加产出。纯函数 — 返回新对象。
 */
export function addProduced(
  flow: ResourceFlowSnapshot,
  amount: number,
): ResourceFlowSnapshot {
  return { ...flow, produced: flow.produced + Math.max(0, amount) };
}

/**
 * 累加运输。纯函数 — 返回新对象。
 */
export function addTransported(
  flow: ResourceFlowSnapshot,
  amount: number,
): ResourceFlowSnapshot {
  return { ...flow, transported: flow.transported + Math.max(0, amount) };
}

/**
 * 累加交付。纯函数 — 返回新对象。
 */
export function addDelivered(
  flow: ResourceFlowSnapshot,
  amount: number,
): ResourceFlowSnapshot {
  return { ...flow, delivered: flow.delivered + Math.max(0, amount) };
}

/**
 * 累加损失。纯函数 — 返回新对象。
 */
export function addLost(
  flow: ResourceFlowSnapshot,
  amount: number,
): ResourceFlowSnapshot {
  return { ...flow, lost: flow.lost + Math.max(0, amount) };
}

/**
 * 累加消费。纯函数 — 返回新对象。
 */
export function addConsumed(
  flow: ResourceFlowSnapshot,
  amount: number,
): ResourceFlowSnapshot {
  return { ...flow, consumed: flow.consumed + Math.max(0, amount) };
}

/**
 * 更新 container 存量。纯函数 — 返回新对象。
 */
export function setStored(
  flow: ResourceFlowSnapshot,
  amount: number,
): ResourceFlowSnapshot {
  return { ...flow, stored: Math.max(0, amount) };
}

// ─── 分析 ──────────────────────────────────────────────

/**
 * 计算时间段长度（tick 数）。纯函数。
 */
export function flowDuration(flow: ResourceFlowSnapshot): number {
  return Math.max(1, flow.periodEnd - flow.periodStart);
}

/**
 * 计算产出速率（e/tick）。纯函数。
 */
export function productionRate(flow: ResourceFlowSnapshot): number {
  return flow.produced / flowDuration(flow);
}

/**
 * 计算交付速率（e/tick）。纯函数。
 */
export function deliveryRate(flow: ResourceFlowSnapshot): number {
  return flow.delivered / flowDuration(flow);
}

/**
 * 计算运输效率 = delivered / produced。纯函数。
 * 返回 0..1 的比率。
 */
export function transportEfficiency(flow: ResourceFlowSnapshot): number {
  if (flow.produced <= 0) return 0;
  return Math.min(1, flow.delivered / flow.produced);
}

/**
 * 计算损失率 = lost / produced。纯函数。
 * 返回 0..1 的比率。
 */
export function lossRate(flow: ResourceFlowSnapshot): number {
  if (flow.produced <= 0) return 0;
  return Math.min(1, flow.lost / flow.produced);
}

/**
 * 判定是否为过量生产（Production > Transport Capacity）。
 * 即 container 在持续积压。
 * 纯函数。
 */
export function isOverproducing(
  flow: ResourceFlowSnapshot,
  /** 容器最大容量。 */
  containerCapacity: number,
): boolean {
  // 存量接近满 + 产出 > 运输
  return flow.stored >= containerCapacity * 0.9 &&
    flow.produced > flow.transported;
}

/**
 * 判定是否为生产不足（Transport Capacity > Production）。
 * 即 hauler 有运力但无矿可运。
 * 纯函数。
 */
export function isUnderproducing(
  flow: ResourceFlowSnapshot,
  /** 预期产出速率。 */
  expectedRate: number,
): boolean {
  const actualRate = productionRate(flow);
  return actualRate < expectedRate * 0.5;
}

// ─── 合并 ──────────────────────────────────────────────

/**
 * 合并两个资源流快照（同一 Operation 不同时间段）。
 * 纯函数。
 */
export function mergeFlows(
  a: ResourceFlowSnapshot,
  b: ResourceFlowSnapshot,
): ResourceFlowSnapshot {
  return {
    operationId: a.operationId,
    periodStart: Math.min(a.periodStart, b.periodStart),
    periodEnd: Math.max(a.periodEnd, b.periodEnd),
    produced: a.produced + b.produced,
    transported: a.transported + b.transported,
    delivered: a.delivered + b.delivered,
    lost: a.lost + b.lost,
    consumed: a.consumed + b.consumed,
    stored: b.stored, // 取最新的快照值
  };
}

// ─── 序列化 ──────────────────────────────────────────────

/**
 * 资源流瘦快照（存入 Memory）。
 */
export interface FlowSnapshotSerialized {
  oi: string; // operationId
  ps: number; // periodStart
  pe: number; // periodEnd
  pr: number; // produced
  tr: number; // transported
  de: number; // delivered
  lo: number; // lost
  co: number; // consumed
  st: number; // stored
}

/**
 * 序列化资源流快照。纯函数。
 */
export function serializeFlow(flow: ResourceFlowSnapshot): FlowSnapshotSerialized {
  return {
    oi: flow.operationId,
    ps: flow.periodStart,
    pe: flow.periodEnd,
    pr: Math.round(flow.produced),
    tr: Math.round(flow.transported),
    de: Math.round(flow.delivered),
    lo: Math.round(flow.lost),
    co: Math.round(flow.consumed),
    st: Math.round(flow.stored),
  };
}

/**
 * 反序列化资源流快照。纯函数。
 */
export function deserializeFlow(s: FlowSnapshotSerialized): ResourceFlowSnapshot {
  return {
    operationId: s.oi,
    periodStart: s.ps,
    periodEnd: s.pe,
    produced: s.pr,
    transported: s.tr,
    delivered: s.de,
    lost: s.lo,
    consumed: s.co,
    stored: s.st,
  };
}
