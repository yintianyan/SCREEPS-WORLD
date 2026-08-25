/**
 * Empire Logistics Planner — A4.3 Phase 5：帝国物流规划器。
 *
 * 合同锚点：A4.3 Architecture Audit §10 #35。
 *
 * 设计意图：
 *   Planner 只规划不执行。
 *   输入：Deficit/Contract/Capacity/Route/Threat/Priority/Deadline
 *   输出：Transport Plan
 *
 *   规划频率：Event/Dirty Flag/Periodic 三档
 *   - Event: ReplanEvent 触发（carrier-death, room-lost 等）
 *   - Dirty Flag: Network Snapshot 变化 > 阈值
 *   - Periodic: 每 100 tick（与 agenda-manager 同频）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { SupplyContract } from "../economy/supply-contract";
import { isContractActive, computeCycleAmount } from "../economy/supply-contract";
import type { DemandNode } from "../operation/demand-node";
import type { SupplyNode } from "../operation/supply-node";
import type { ResourceType, OperationPriority } from "../operation/agenda-item";
import type { TransportRequestV2, TransportEndpoint } from "./transport-request";
import { createRequest } from "./transport-request";
import type { TransportAssignment } from "./transport-assignment";
import type { Route } from "./route";
import { routeScore, isRouteUsable } from "./route";
import type { RouteCache } from "./route-cache";
import type { TransportPlan } from "./transport-plan";
import { createEmptyPlan } from "./transport-plan";
import type { EmpireCapacityResult } from "./capacity-planning";

// ─── Planner 输入 ─────────────────────────────────────────

/**
 * Planner 输入。
 */
export interface PlannerInput {
  /** 活跃 Supply Contracts。 */
  contracts: readonly SupplyContract[];
  /** 当前 Deficit 节点。 */
  deficits: readonly DemandNode[];
  /** 当前 Surplus 节点。 */
  surpluses: readonly SupplyNode[];
  /** 运力规划。 */
  capacity: EmpireCapacityResult;
  /** 可用路由缓存。 */
  routeCache: RouteCache;
  /** 威胁评估（room → threat 0..1）。 */
  threats: ReadonlyMap<string, number>;
  /** 当前 tick。 */
  tick: number;
}

// ─── 核心规划算法 ──────────────────────────────────────────

/**
 * Empire Logistics Planner。
 *
 * 规划步骤：
 *   1. 从 Contract 派生 Transport Request
 *   2. 从 Deficit 派生 Ad-hoc Transport Request
 *   3. 评估每个 Request 的 Route
 *   4. 输出 Transport Plan
 *
 * 纯函数。
 */
export function planLogistics(input: PlannerInput): TransportPlan {
  const { contracts, deficits, surpluses, capacity, routeCache, threats, tick } = input;

  const requests: TransportRequestV2[] = [];
  const routes: Route[] = [];
  let totalCost = 0;
  let totalRisk = 0;
  let expectedDelivery = 0;

  // 步骤 1: 从 Contract 派生 Request
  for (const contract of contracts) {
    if (!isContractActive(contract.status)) continue;

    const cycleAmount = computeCycleAmount(contract, 100);
    if (cycleAmount <= 0) continue;

    const source: TransportEndpoint = {
      room: contract.sourceRoom,
      type: "storage",
    };
    const destination: TransportEndpoint = {
      room: contract.targetRoom,
      type: "storage",
    };

    const request = createRequest(
      contract.resource,
      cycleAmount,
      source,
      destination,
      contract.priority,
      "empire",
      tick + 2000,
      tick,
      contract.id,
    );
    requests.push(request);

    // 评估 Route
    const route = routeCache.get(contract.sourceRoom, contract.targetRoom);
    if (route && isRouteUsable(route.status)) {
      routes.push(route);
      totalCost += route.cost;
      totalRisk = Math.max(totalRisk, route.risk);
      expectedDelivery += Math.min(cycleAmount, route.successRate * cycleAmount);
    }
  }

  // 步骤 2: 从 Deficit 派生 Ad-hoc Request
  for (const deficit of deficits) {
    if (deficit.remaining <= 0) continue;

    // 找最优 supply
    const bestSupply = findBestSupply(deficit, surpluses, routeCache);
    if (!bestSupply) continue;

    const source: TransportEndpoint = {
      room: bestSupply.room,
      type: "storage",
    };
    const destination: TransportEndpoint = {
      room: deficit.room,
      type: "storage",
    };

    const request = createRequest(
      deficit.resource,
      deficit.remaining,
      source,
      destination,
      deficit.priority,
      "empire",
      deficit.deadline,
      tick,
      "deficit-adhoc",
    );
    requests.push(request);

    // 评估 Route
    const route = routeCache.get(bestSupply.room, deficit.room);
    if (route && isRouteUsable(route.status)) {
      routes.push(route);
      totalCost += route.cost;
      totalRisk = Math.max(totalRisk, route.risk);
      expectedDelivery += Math.min(deficit.remaining, route.successRate * deficit.remaining);
    }
  }

  // 步骤 3: 估算总时间
  const estimatedTime = routes.length > 0
    ? Math.max(...routes.map(r => r.travelTime))
    : 0;

  return {
    requests,
    assignments: [], // assignments 由系统侧在执行时创建
    routes,
    estimatedCost: totalCost,
    estimatedTime,
    risk: totalRisk,
    expectedDelivery: Math.floor(expectedDelivery),
    plannedAt: tick,
    reason: `planned ${requests.length} requests from ${contracts.filter(c => isContractActive(c.status)).length} contracts + ${deficits.length} deficits`,
  };
}

// ─── 内部工具 ──────────────────────────────────────────────

/**
 * 找最优 supply（transferable 最大 + route 可用 + 距离最近）。
 */
function findBestSupply(
  deficit: DemandNode,
  surpluses: readonly SupplyNode[],
  routeCache: RouteCache,
): SupplyNode | undefined {
  let best: SupplyNode | undefined;
  let bestScore = -1;

  for (const supply of surpluses) {
    if (supply.resource !== deficit.resource) continue;
    if (supply.transferable <= 0) continue;

    const route = routeCache.get(supply.room, deficit.room);
    if (!route || !isRouteUsable(route.status)) continue;

    // 评分 = transferable × routeScore
    const score = supply.transferable * routeScore(route);
    if (score > bestScore) {
      bestScore = score;
      best = supply;
    }
  }

  return best;
}
