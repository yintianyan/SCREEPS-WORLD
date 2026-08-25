/**
 * Demand Batching — A4.3 Phase 1：需求批量聚合。
 *
 * 合同锚点：A4.3 Architecture Audit §2.1 #5（无 Demand Batching）、
 * §3.1（每源一请求，无聚合）、§10 #4。
 *
 * 设计意图：
 *   现有 request-pool.ts 每源一请求（每 container 一个 TransportRequest），
 *   无聚合能力。跨房每个 DemandNode 一个 Operation，也无批量聚合。
 *
 *   Demand Batching 将同房同资源多 Demand 聚合为批量请求，减少 Request 数量，
 *   提高 hauler 利用率（满载优化）。
 *
 * 聚合规则：
 *   - 同 destination room + 同 resource 的 demand 合并
 *   - priority 取最高（最小数字）
 *   - amount 求和
 *   - source 信息保留所有源（多源 fulfillment）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { ResourceType } from "../operation/agenda-item";
import type { RequestScope } from "../assignment/request-pool";
import type { TransportRequestV2, TransportEndpoint, EndpointType } from "./transport-request";
import { createRequest } from "./transport-request";

// ─── 输入 ──────────────────────────────────────────────────

/**
 * 单条需求输入。
 */
export interface DemandInput {
  /** 源端点。 */
  source: TransportEndpoint;
  /** 目标端点。 */
  destination: TransportEndpoint;
  /** 资源类型。 */
  resource: ResourceType;
  /** 需求量。 */
  amount: number;
  /** 优先级。 */
  priority: 0 | 1 | 2 | 3;
}

/**
 * 批量聚合输入。
 */
export interface BatchInput {
  /** 需求列表。 */
  demands: readonly DemandInput[];
  /** 请求归属域。 */
  scope: RequestScope;
  /** 截止 tick。 */
  deadline: number;
  /** 当前 tick。 */
  tick: number;
  /** 来源标识。 */
  origin: string;
  /** 最小批量。 */
  minBatch?: number;
  /** 最大批量。 */
  maxBatch?: number;
}

// ─── 聚合结果 ──────────────────────────────────────────────

/**
 * 聚合后的需求组。
 * 同 destination room + 同 resource 的 demand 合并为一组。
 */
interface DemandGroup {
  destinationRoom: string;
  destinationType: EndpointType;
  resource: ResourceType;
  demands: DemandInput[];
  totalAmount: number;
  highestPriority: 0 | 1 | 2 | 3;
  /** 组内所有源（去重）。 */
  sources: Set<string>;
}

/**
 * Demand Batching — 同房同资源多 Demand 聚合为批量请求。
 *
 * 算法：
 *   1. 按 (destination.room, resource) 分组
 *   2. 每组内 amount 求和，priority 取最高
 *   3. 每组生成一个 TransportRequestV2
 *   4. amount < minBatch 的组跳过（不值得运输）
 *
 * 纯函数 — 不访问 Game/Memory。
 */
export function batchDemands(input: BatchInput): TransportRequestV2[] {
  const minBatch = input.minBatch ?? 100;

  // 按 (destination.room, resource) 分组
  const groups = new Map<string, DemandGroup>();
  for (const demand of input.demands) {
    if (demand.amount <= 0) continue;
    const key = `${demand.destination.room}:${demand.resource}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        destinationRoom: demand.destination.room,
        destinationType: demand.destination.type,
        resource: demand.resource,
        demands: [],
        totalAmount: 0,
        highestPriority: 3,
        sources: new Set(),
      };
      groups.set(key, group);
    }
    group.demands.push(demand);
    group.totalAmount += demand.amount;
    group.highestPriority = Math.min(group.highestPriority, demand.priority) as 0 | 1 | 2 | 3;
    group.sources.add(demand.source.room);
  }

  // 每组生成一个 TransportRequestV2
  const requests: TransportRequestV2[] = [];
  for (const group of groups.values()) {
    // 低于最小批量的跳过
    if (group.totalAmount < minBatch) continue;

    // destination 取组内第一个 demand 的 destination（同房同类型）
    const destination = group.demands[0]!.destination;

    // source：如果只有一个源，用那个源；多个源时用第一个（多源由 Assignment 层处理）
    const source = group.demands[0]!.source;

    const request = createRequest(
      group.resource,
      group.totalAmount,
      source,
      destination,
      group.highestPriority,
      input.scope,
      input.deadline,
      input.tick,
      input.origin,
      minBatch,
      input.maxBatch ?? 5000,
    );
    requests.push(request);
  }

  return requests;
}

// ─── 拆分 ──────────────────────────────────────────────────

/**
 * 将大批量 Request 拆分为多个小批量（如果 amount > maxBatch）。
 * 用于单次运输量过大的场景。
 *
 * 纯函数 — 不访问 Game/Memory。
 */
export function splitBatch(
  req: TransportRequestV2,
  maxBatch: number,
): TransportRequestV2[] {
  if (req.amount <= maxBatch) return [req];

  const parts: TransportRequestV2[] = [];
  let remaining = req.amount;
  while (remaining > 0) {
    const batchSize = Math.min(remaining, maxBatch);
    // 复制 Request 但减少 amount（requestId 会不同因为 seq 不同）
    const part = createRequest(
      req.resource,
      batchSize,
      req.source,
      req.destination,
      req.priority,
      req.scope,
      req.deadline,
      req.createdAt,
      req.origin,
      req.minBatch,
      req.maxBatch,
      req.routePreference,
    );
    parts.push(part);
    remaining -= batchSize;
  }
  return parts;
}
