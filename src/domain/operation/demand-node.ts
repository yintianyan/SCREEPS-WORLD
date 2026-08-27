/** Demand Node */

import type { RoomRegistryEntry } from "../strategy/room-registry";
import type { OperationPriority, ResourceType } from "./agenda-item";

/**
 * 需求紧急度分级。
 * - critical: 生存级（colonyState=recovery/bootstrap 或 riskBuffer < 100）
 * - high: 高危（riskBuffer < 400）
 * - normal: 正常（riskBuffer < 1000）
 * - low: 低（riskBuffer ≥ 1000）
 */
export type Criticality = "critical" | "high" | "normal" | "low";

/**
 * Demand Node — 单房单资源的需求节点。
 */
export interface DemandNode {
  /** 房间名。 */
  room: string;
  /** 资源类型。 */
  resource: ResourceType;
  /** 请求总量。 */
  requested: number;
  /** 优先级（由紧急度推导，0=最高）。 */
  priority: OperationPriority;
  /** 截止 tick（超过则过期）。 */
  deadline: number;
  /** 紧急度分级。 */
  criticality: Criticality;
  /** 已满足量（来自多个 Operation 的 deliveredAmount 之和）。 */
  fulfilled: number;
  /** 剩余需求量 = requested - fulfilled（≥ 0）。 */
  remaining: number;
  /** 首次发现 tick（用于 starvation 检测和 aging）。 */
  firstSeen: number;
  /** 最近更新 tick。 */
  timestamp: number;
}

/**
 * 从 RoomRegistryEntry 派生 Demand Node。

 * 只在 needsAid=true 时创建。
 * 返回 undefined 表示该房间不产生需求节点。

 * @param entry 房间注册项
 * @param inTransitAmount 已在途量（来自活跃 Operation 的 requestedAmount - deliveredAmount）
 * @param tick 当前 tick
 * @param deadline 截止 tick（默认 tick + 2000）
 * @param firstSeen 首次发现 tick（用于 aging，默认 = tick）

 * 纯函数 — 不访问 Game/Memory。
 */
export function buildDemandNode(
  entry: RoomRegistryEntry,
  inTransitAmount: number,
  tick: number,
  deadline: number = tick + 2000,
  firstSeen: number = tick,
  resource: ResourceType = "energy",
): DemandNode | undefined {
  if (!entry.needsAid) return undefined;

  const requested = estimateDeficitAmount(entry, inTransitAmount);
  if (requested <= 0) return undefined;

  const criticality = deriveCriticality(entry);
  const priority = criticalityToPriority(criticality);

  return {
    room: entry.roomName,
    resource,
    requested,
    priority,
    deadline,
    criticality,
    fulfilled: inTransitAmount,
    remaining: Math.max(0, requested - inTransitAmount),
    firstSeen,
    timestamp: tick,
  };
}

/**
 * 批量构建 Demand Nodes。
 * 从 RoomRegistry + 在途量派生所有活跃需求节点。
 * 返回按 criticality 升序（critical 优先）排列的列表。

 * 纯函数 — 不访问 Game/Memory。
 */
export function buildDemandNodes(
  deficitRooms: readonly RoomRegistryEntry[],
  inTransitByTarget: ReadonlyMap<string, number>,
  tick: number,
  firstSeenByRoom: ReadonlyMap<string, number> = new Map(),
): DemandNode[] {
  const nodes: DemandNode[] = [];
  for (const entry of deficitRooms) {
    const inTransit = inTransitByTarget.get(entry.roomName) ?? 0;
    const firstSeen = firstSeenByRoom.get(entry.roomName) ?? tick;
    const node = buildDemandNode(entry, inTransit, tick, tick + 2000, firstSeen);
    if (node) nodes.push(node);
  }
  // 排序：critical 优先，同 criticality 按 remaining 降序
  nodes.sort((a, b) => {
    const ca = criticalityRank(a.criticality);
    const cb = criticalityRank(b.criticality);
    if (ca !== cb) return ca - cb;
    return b.remaining - a.remaining;
  });
  return nodes;
}

/**
 * 计算所有 Demand Nodes 的总需求量。
 */
export function sumDemandRequested(nodes: readonly DemandNode[]): number {
  let sum = 0;
  for (const n of nodes) sum += n.requested;
  return sum;
}

/**
 * 计算所有 Demand Nodes 的总剩余需求量。
 */
export function sumDemandRemaining(nodes: readonly DemandNode[]): number {
  let sum = 0;
  for (const n of nodes) sum += n.remaining;
  return sum;
}

/**
 * 更新 Demand Node 的已满足量（部分满足）。
 * 返回新 Demand Node（不可变）。
 */
export function updateFulfillment(
  node: DemandNode,
  deliveredAmount: number,
  tick: number,
): DemandNode {
  const fulfilled = Math.min(node.requested, node.fulfilled + deliveredAmount);
  const remaining = Math.max(0, node.requested - fulfilled);
  return { ...node, fulfilled, remaining, timestamp: tick };
}

/**
 * 判断 Demand Node 是否已完全满足。
 */
export function isFulfilled(node: DemandNode): boolean {
  return node.remaining <= 0;
}

/**
 * 判断 Demand Node 是否处于饥饿状态（长期未被满足）。
 * 饥饿 = 非 critical 但 firstSeen 距今超过 starvationThreshold tick。
 */
export function isStarving(node: DemandNode, tick: number, starvationThreshold = 1000): boolean {
  if (node.criticality === "critical") return false; // critical 不算饥饿（它一直在最前面）
  if (node.remaining <= 0) return false; // 已满足
  return tick - node.firstSeen > starvationThreshold;
}

/**
 * 对饥饿的 Demand Node 应用 aging：提升优先级。
 * 每经过 starvationThreshold tick，priority 减 1（最高到 0）。
 */
export function applyAging(node: DemandNode, tick: number, starvationThreshold = 1000): DemandNode {
  if (node.remaining <= 0) return node;
  if (node.criticality === "critical") return node;

  const ageTicks = tick - node.firstSeen;
  const agingSteps = Math.floor(ageTicks / starvationThreshold);
  if (agingSteps <= 0) return node;

  const agedPriority = Math.max(0, node.priority - agingSteps) as OperationPriority;
  if (agedPriority === node.priority) return node;

  return { ...node, priority: agedPriority };
}

// ── 内部工具函数 ──────────────────────────────────────────

/**
 * 估算 deficit 需求量。
 * 基于 riskBuffer 和 estimatedIncome 推导。
 */
function estimateDeficitAmount(
  deficit: RoomRegistryEntry,
  inTransit: number,
): number {
  if (deficit.hasStorage && deficit.storageCapacity > 0) {
    const safetyTarget = deficit.storageCapacity * 0.3;
    const need = Math.max(0, safetyTarget - deficit.storageEnergy - inTransit);
    return Math.floor(need);
  }
  const seedNeed = Math.max(0, deficit.estimatedIncome * 500 - inTransit);
  return Math.floor(Math.min(seedNeed, 10000));
}

/**
 * 从房间状态推导紧急度。
 */
function deriveCriticality(entry: RoomRegistryEntry): Criticality {
  if (entry.isStruggling) return "critical";
  if (entry.riskBuffer < 100) return "critical";
  if (entry.riskBuffer < 400) return "high";
  if (entry.riskBuffer < 1000) return "normal";
  return "low";
}

/**
 * 紧急度 → 优先级映射。
 */
function criticalityToPriority(c: Criticality): OperationPriority {
  switch (c) {
    case "critical": return 0;
    case "high": return 1;
    case "normal": return 2;
    case "low": return 3;
  }
}

/**
 * 紧急度排序权重（用于 sort）。
 */
function criticalityRank(c: Criticality): number {
  switch (c) {
    case "critical": return 0;
    case "high": return 1;
    case "normal": return 2;
    case "low": return 3;
  }
}
