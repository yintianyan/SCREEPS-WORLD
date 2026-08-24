/**
 * Transport Planner — A3.0 跨房运输规划纯函数
 *（LOGISTICS §2.1 Route）。
 *
 * 从 AllocationPlan 生成 TransportRequest 候选：
 *   - 路由规划（Game.map.findRoute 由系统侧执行，domain 只做路由检查）
 *   - Carrier Body 计算
 *   - ETA 估算
 *   - 生成 TransportRequest(scope="empire")
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { AllocationPlan } from "./allocation";
import type { TransportRequest } from "../assignment/request-pool";
import type { OperationPriority } from "./agenda-item";

/** 路由结果（由系统侧执行 Game.map.findRoute 后注入）。 */
export interface RouteResult {
  /** 源房名。 */
  from: string;
  /** 目标房名。 */
  to: string;
  /** 路由跳数（跨房数，-1 = 不可达）。 */
  hops: number;
  /** 路由是否可达。 */
  reachable: boolean;
}

/** 运输计划产出。 */
export interface TransportPlan {
  /** 对应的 AllocationPlan。 */
  allocation: AllocationPlan;
  /** 路由结果。 */
  route: RouteResult;
  /** 估算的 Carrier body。 */
  carrierBody: BodyPartConstant[];
  /** 估算单程 tick 数。 */
  eta: number;
  /** 生成的 TransportRequest 候选（route 不可达时为 null）。 */
  request: TransportRequest | null;
}

/** Carrier body 配置（按 RCL 分档）。 */
function selectCarrierBody(
  amount: number,
  routeHops: number,
  sourceRcl: number,
): BodyPartConstant[] {
  // 路由越远，单次运量越大越经济（减少跨房次数）
  // 基础 body = [CARRY, CARRY, MOVE, MOVE]（200 能量，运 100）
  // 扩展 body = [CARRY×N, MOVE×N]（每 N 个 CARRY 配 N 个 MOVE）

  const carryPerPart = 50;
  const desiredCarry = Math.min(
    Math.ceil(amount / Math.max(1, routeHops)),
    800, // 单次最大 800（8 CARRY + 8 MOVE = 1600 能量）
  );
  const carryParts = Math.max(2, Math.min(8, Math.ceil(desiredCarry / carryPerPart)));

  // RCL 4 以下用基础 body（路径上可能有 swamp，多配 MOVE）
  const moveRatio = sourceRcl < 4 ? 1 : 1; // 1:1 确保平原不减速

  const body: BodyPartConstant[] = [];
  for (let i = 0; i < carryParts; i++) body.push(CARRY);
  for (let i = 0; i < carryParts * moveRatio; i++) body.push(MOVE);

  return body;
}

/** 估算 ETA（单程 tick 数）。 */
function estimateEta(routeHops: number): number {
  if (routeHops < 0) return -1;
  // 每房约 50 tick 寻路 + 跨房移动
  // 加 50 tick 装载/卸载
  return routeHops * 50 + 50;
}

/**
 * 从 AllocationPlan + RouteResult 生成 TransportPlan。
 *
 * 纯函数 — 不执行 Game.map.findRoute（由系统侧注入）。
 */
export function planTransport(
  allocation: AllocationPlan,
  route: RouteResult,
  sourceRcl: number,
): TransportPlan {
  if (!route.reachable || route.hops < 0) {
    return {
      allocation,
      route,
      carrierBody: [],
      eta: -1,
      request: null,
    };
  }

  const carrierBody = selectCarrierBody(allocation.amount, route.hops, sourceRcl);
  const eta = estimateEta(route.hops);

  // 生成 TransportRequest 候选
  const request: TransportRequest = {
    key: `empire-supply:${allocation.sourceRoom}:${allocation.targetRoom}`,
    resource: "energy",
    amount: allocation.amount,
    sourceId: undefined, // 由系统侧在提交时填充（需要查 storage id）
    pos: undefined, // 由系统侧在提交时填充
    priority: allocation.priority as 0 | 1 | 2 | 3,
    scope: "empire",
    targetRoom: allocation.targetRoom,
  };

  return {
    allocation,
    route,
    carrierBody,
    eta,
    request,
  };
}

/**
 * 批量规划运输 — 对一组 AllocationPlan 生成 TransportPlan 列表。
 * 路由表由系统侧执行 Game.map.findRoute 后注入。
 */
export function planTransportsBatch(
  allocations: readonly AllocationPlan[],
  routes: ReadonlyMap<string, RouteResult>,
  sourceRclByRoom: ReadonlyMap<string, number>,
): TransportPlan[] {
  const plans: TransportPlan[] = [];
  for (const allocation of allocations) {
    const routeKey = `${allocation.sourceRoom}:${allocation.targetRoom}`;
    const route = routes.get(routeKey);
    if (!route) {
      // 路由未计算 — 跳过（系统侧下次补充）
      continue;
    }
    const sourceRcl = sourceRclByRoom.get(allocation.sourceRoom) ?? 1;
    plans.push(planTransport(allocation, route, sourceRcl));
  }
  return plans;
}

/**
 * 过滤可达且有有效 request 的运输计划。
 */
export function filterExecutable(
  plans: readonly TransportPlan[],
): TransportPlan[] {
  return plans.filter(p => p.request !== null && p.eta > 0);
}
