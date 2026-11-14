/** Empire Logistics Planner */

import type { SupplyContract } from "../economy/supply-contract";
import { isContractActive, computeCycleAmount } from "../economy/supply-contract";
import type { DemandNode } from "../operation/demand-node";
import type { SupplyNode } from "../operation/supply-node";
import type { TransportRequestV2, TransportEndpoint } from "./transport-request";
import { createRequest } from "./transport-request";
import type { Route } from "./route";
import { routeScore, isRouteUsable } from "./route";
import type { RouteCache } from "./route-cache";
import type { TransportPlan } from "./transport-plan";
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

 * 规划步骤：
 *   1. 从 Contract 派生 Transport Request
 *   2. 从 Deficit 派生 Ad-hoc Transport Request
 *   3. 评估每个 Request 的 Route
 *   4. 输出 Transport Plan

 * 纯函数。
 */
export function planLogistics(input: PlannerInput): TransportPlan {
  const {
    contracts,
    deficits,
    surpluses,
    capacity: _capacity,
    routeCache,
    threats: _threats,
    tick,
  } = input;

  const requests: TransportRequestV2[] = [];
  const routes: Route[] = [];
  let totalCost = 0;
  let totalRisk = 0;
  let expectedDelivery = 0;

  // 供需索引：合同派单必须对着**当前**的供给/需求节点，而不是签发时的那一对。
  // 同一源/目标的多条合同共享额度，防止各自独立计算后合计越过安全储备。
  const supplyIndex = new Map<string, SupplyNode>();
  for (const supply of surpluses) supplyIndex.set(`${supply.room}|${supply.resource}`, supply);
  const demandIndex = new Map<string, DemandNode>();
  for (const demand of deficits) demandIndex.set(`${demand.room}|${demand.resource}`, demand);
  const claimedSupply = new Map<string, number>();
  const claimedDemand = new Map<string, number>();

  // 步骤 1: 从 Contract 派生 Request
  for (const contract of contracts) {
    if (!isContractActive(contract.status)) continue;

    const supplyKey = `${contract.sourceRoom}|${contract.resource}`;
    const demandKey = `${contract.targetRoom}|${contract.resource}`;
    const supply = supplyIndex.get(supplyKey);
    const demand = demandIndex.get(demandKey);
    // 供需任一消失 ⇒ 这条合同当前没有可执行的现实基础。合同本身由 specialization-planner
    // 的宽限窗口负责清理；这里只保证不继续派单（旧实现无条件派单，需求消失后仍永久抽源房）。
    if (!supply || !demand) continue;

    const demandLeft = Math.max(0, demand.remaining - (claimedDemand.get(demandKey) ?? 0));
    if (demandLeft <= 0) continue;

    // 安全储备：取合同声明与供给节点自带 safety 的较大者 —— 两者都是“不许抽走”的地板。
    const reserve = Math.max(contract.minimumReserve, supply.safety);
    const supplyLeft = Math.max(
      0,
      supply.available - supply.reserved - reserve - (claimedSupply.get(supplyKey) ?? 0),
    );
    if (supplyLeft <= 0) continue;

    const cycleAmount = Math.min(computeCycleAmount(contract, 100), demandLeft, supplyLeft);
    if (cycleAmount <= 0) continue;
    claimedSupply.set(supplyKey, (claimedSupply.get(supplyKey) ?? 0) + cycleAmount);
    claimedDemand.set(demandKey, (claimedDemand.get(demandKey) ?? 0) + cycleAmount);

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
  const estimatedTime = routes.length > 0 ? Math.max(...routes.map(r => r.travelTime)) : 0;

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
