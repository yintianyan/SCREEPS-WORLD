/**
 * FlowPlanner — 房间级能量流分配（Phase 0 纯函数）。
 *
 * 设计要点：
 * - link 可传同房间任意 link；cooldown = Chebyshev 距离，容量 ≈ capacity/(距离+1)。
 * - 先走 link，link 不足再分配 creep 承运人；两者共享源侧账本。
 * - 汇是组（core/upgrade/...），任务执行时再解析具体结构。
 * - 不访问 Game/Memory/globalCache；所有输入由调用方注入。
 */

import type {
  FlowAllocation,
  FlowLinkNode,
  FlowLane,
  FlowLinkTransfer,
  FlowPlannerInput,
  FlowPoint,
  FlowSpawnNeed,
  FlowUnmet,
  FlowUnmetReason,
  RoomFlowPlan,
} from "./flow-types";

export const DEFAULT_LINK_CAPACITY = 800;
export const DEFAULT_LINK_LOSS_RATIO = 0.03;

/** Chebyshev 距离 — 与引擎 link cooldown 的度量一致。 */
export function chebyshev(a: FlowPoint, b: FlowPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * 单条 link 边的持续发送容量。
 *
 * 引擎：每次发送后 `cooldown += LINK_COOLDOWN(1) × 距离`，每 tick 减 1。
 * 持续速率 ≈ capacity / (距离 + 1)。
 */
export function linkSendCapacity(distance: number, capacity = DEFAULT_LINK_CAPACITY): number {
  const d = Math.max(1, Math.floor(distance));
  return Math.max(1, Math.floor(capacity / (d + 1)));
}

/**
 * 最短跳数的 link 路径（BFS）。同房间内任意两 link 均可连边。
 * 返回含起点和终点的 id 数组；无路径返回 undefined。
 */
export function findShortestLinkPath(
  fromId: string,
  toId: string,
  links: readonly FlowLinkNode[],
): string[] | undefined {
  if (fromId === toId) return [fromId];
  const byId = new Map(links.map(l => [l.id, l] as const));
  if (!byId.has(fromId) || !byId.has(toId)) return undefined;

  const queue: string[][] = [[fromId]];
  const visited = new Set<string>([fromId]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1]!;
    for (const link of links) {
      if (link.id === last || visited.has(link.id)) continue;
      const next = [...path, link.id];
      if (link.id === toId) return next;
      visited.add(link.id);
      queue.push(next);
    }
  }
  return undefined;
}

export interface LinkPathRate {
  /** 源 link 的发送速率（未扣损耗）。 */
  readonly sendRatePerTick: number;
  /** 到达目标的速率（逐跳扣损耗）。 */
  readonly deliveredRatePerTick: number;
  readonly hops: number;
}

/** 给定路径，计算瓶颈速率与逐跳损耗后的到达速率。 */
export function linkPathRate(
  path: readonly string[],
  links: readonly FlowLinkNode[],
  capacity = DEFAULT_LINK_CAPACITY,
  lossRatio = DEFAULT_LINK_LOSS_RATIO,
): LinkPathRate | undefined {
  if (path.length < 2) return undefined;
  const byId = new Map(links.map(l => [l.id, l] as const));
  let bottleneck = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = byId.get(path[i]!);
    const b = byId.get(path[i + 1]!);
    if (!a || !b) return undefined;
    bottleneck = Math.min(bottleneck, linkSendCapacity(chebyshev(a.pos, b.pos), capacity));
  }
  const hops = path.length - 1;
  const delivered = Math.floor(bottleneck * Math.pow(1 - lossRatio, hops));
  return { sendRatePerTick: bottleneck, deliveredRatePerTick: delivered, hops };
}

/** 每只承运人每 tick 的运力。 */
export function carrierRate(carry: number, roundTripTicks: number): number {
  if (carry <= 0 || roundTripTicks <= 0) return 0;
  return carry / roundTripTicks;
}

/** 运送 rate e/tick 需要多少只承运人。 */
export function computeCarrierCount(rate: number, roundTripTicks: number, carry: number): number {
  if (rate <= 0 || roundTripTicks <= 0 || carry <= 0) return 0;
  return Math.ceil((rate * roundTripTicks) / carry);
}

/**
 * core 车道需求 — 单一现金口径。
 *
 * `cashBand = cashCap - spawnReserve - pendingHostedBodyCost`，
 * 只把 band 与当前现金的差额按 horizon 摊平；不再叠加第二份 pending。
 */
export interface CoreDemandInput {
  readonly cashCap: number;
  readonly spawnReserve: number;
  readonly pendingHostedBodyCost: number;
  readonly energyAvailable: number;
  readonly horizonTicks: number;
}

export function computeCoreDemand(input: CoreDemandInput): number {
  if (input.horizonTicks <= 0) return 0;
  const energy = Math.max(0, input.energyAvailable);
  // 目标水位 = cashCap - reserve。pending bodyCost 是**需求**，不能从目标里扣掉：
  // 扣掉会让「队列里有 4200 body、ext 只剩 2500」时 core demand=0，ext 永远补不上，
  // 随后 spawn degradeGateClosed（Phase 2 实盘 W8N3 实测）。
  // 目标水位取 min(cashCap - reserve, 70% cashCap)：70% 以上仍继续满速补能会与
  // upgrade 抢承运人（Phase 2 实盘 W7N2 progress 从 45 掉到 14）。留 30% 缓冲即可。
  const band = Math.max(
    0,
    Math.min(input.cashCap - input.spawnReserve, Math.floor(input.cashCap * 0.7)),
  );
  const base = Math.ceil(Math.max(0, band - energy) / input.horizonTicks);
  // pending 作为急迫下限：现金不够付队首 body 时，至少按缺口/horizon 补。
  const pendingRate = Math.ceil(
    Math.max(0, Math.max(0, input.pendingHostedBodyCost) - energy) / input.horizonTicks,
  );
  return Math.max(base, pendingRate);
}

/** upgrade 车道需求 — 实际在岗 WORK 数，不再固定 40。 */
export function computeUpgradeDemand(
  liveWorkParts: number,
  policyCap: number,
  linkTargetCapacity?: number,
): number {
  const work = Math.max(0, Math.floor(liveWorkParts));
  const cap = Math.max(0, policyCap);
  const linkCap =
    linkTargetCapacity === undefined ? Number.POSITIVE_INFINITY : Math.max(0, linkTargetCapacity);
  return Math.min(work, cap, linkCap);
}

/**
 * upgrade 车道的可持续供给估计（用于 spawn 编制封顶）。
 *
 * 供给 = link 到达 + source link 直供 + 剩余承运人 creep 运力。
 * 注意：link feeder 也占承运人，所以 creep 运力按 `distributorCount - feederCarrierCount` 计算。
 */
export interface UpgradeFeedInput {
  readonly linkDeliveredRate: number;
  readonly externalSupplyPerTick: number;
  readonly distributorCount: number;
  readonly feederCarrierCount: number;
  readonly carry: number;
  readonly creepRoundTripTicks: number;
}

export function estimateUpgradeFeed(input: UpgradeFeedInput): number {
  const remainingCarriers = Math.max(0, input.distributorCount - input.feederCarrierCount);
  const creepRate =
    input.creepRoundTripTicks > 0
      ? remainingCarriers * carrierRate(input.carry, input.creepRoundTripTicks)
      : 0;
  return Math.max(
    0,
    Math.max(0, input.linkDeliveredRate) + Math.max(0, input.externalSupplyPerTick) + creepRate,
  );
}

/** 速率 EMA — 防止 plan 间隔内跳变。 */
export function smoothRate(previous: number, next: number, alpha: number): number {
  const a = Math.max(0, Math.min(1, alpha));
  return previous + a * (next - previous);
}

/** 编制变化是否需要 rebase（避免 ±1 抖动）。 */
export function shouldRebaseCarriers(previous: number, next: number, threshold = 1): boolean {
  return Math.abs(next - previous) >= Math.max(1, threshold);
}

/**
 * 规划单房能量流。
 *
 * 顺序：priority 升序 → 外部供给 → link 中继 → creep 承运 → unmet。
 * 源侧账本共享：link 灌入（若由 storage 供给）与 creep 取能都从 storageAvailable 扣减。
 */
export function planRoomFlows(input: FlowPlannerInput): RoomFlowPlan {
  const linkCapacity = input.policy.linkCapacity ?? DEFAULT_LINK_CAPACITY;
  const lossRatio = input.policy.linkLossRatio ?? DEFAULT_LINK_LOSS_RATIO;
  const maxPerLane = input.policy.maxCarriersPerLane ?? Number.POSITIVE_INFINITY;

  let storageAvailable = Math.max(0, input.storageEnergy - Math.max(0, input.policy.storageFloor));
  let carriersRemaining = Math.max(0, input.carrierPool.count);

  const allocations: FlowAllocation[] = [];
  const linkTransfers: FlowLinkTransfer[] = [];
  const unmet: FlowUnmet[] = [];
  const spawnMap = new Map<string, FlowSpawnNeed>();
  let totalCreepRate = 0;

  const addSpawnNeed = (role: FlowSpawnNeed["role"], lane: FlowLane, count: number): void => {
    if (count <= 0) return;
    const key = `${role}:${lane}`;
    const prev = spawnMap.get(key);
    spawnMap.set(key, {
      role,
      lane,
      count: (prev?.count ?? 0) + count,
      carry: input.carrierPool.carry,
    });
  };

  const sinks = [...input.sinks].sort((a, b) => a.priority - b.priority);
  for (const sink of sinks) {
    let remaining = Math.max(0, sink.demandPerTick);
    const external = Math.max(0, sink.externalSupplyPerTick ?? 0);
    remaining = Math.max(0, remaining - external);
    if (remaining <= 0) continue;

    // ── link 中继 ──
    let linkMissing = false;
    if (sink.linkFromId !== undefined && sink.linkToId !== undefined && remaining > 0) {
      const path = findShortestLinkPath(sink.linkFromId, sink.linkToId, input.links);
      if (!path) {
        linkMissing = true;
      } else {
        const info = linkPathRate(path, input.links, linkCapacity, lossRatio);
        if (info) {
          const storageFed = sink.linkSourceIsStorageFed !== false;
          // 按剩余需求反推最多需要发送多少（含逐跳损耗），避免 over-send。
          const maxSendForRemaining = Math.ceil(remaining / Math.pow(1 - lossRatio, info.hops));
          let sendRate = Math.min(info.sendRatePerTick, maxSendForRemaining);
          if (storageFed) sendRate = Math.min(sendRate, storageAvailable);

          let feederNeeded = 0;
          const feederRT = sink.linkFeederRoundTripTicks ?? 0;
          if (feederRT > 0) {
            feederNeeded = computeCarrierCount(sendRate, feederRT, input.carrierPool.carry);
            const laneCarrierCap = Math.min(
              carriersRemaining,
              maxPerLane,
              sink.carrierCap ?? Number.POSITIVE_INFINITY,
            );
            if (feederNeeded > laneCarrierCap) {
              sendRate = Math.max(
                0,
                Math.floor((laneCarrierCap * input.carrierPool.carry) / feederRT),
              );
              feederNeeded = computeCarrierCount(sendRate, feederRT, input.carrierPool.carry);
            }
            // Phase 2：如果少 1 只 feeder 的损失 ≤ 释放那只承运人的 creep 运力，
            // 就向下取整释放它。例：sendRate 32、feederRT 10、carry 300 ⇒ 2 只；
            // 1 只 30，损失 2 e/t；释放的 carrier 在 56 tick 往返可做 5.3 e/t ⇒ 净赚。
            if (feederNeeded > 1) {
              const capacityWithFewer = ((feederNeeded - 1) * input.carrierPool.carry) / feederRT;
              const freedCarrierRate = carrierRate(
                input.carrierPool.carry,
                sink.creepRoundTripTicks ?? input.carrierPool.roundTripTicks,
              );
              if (sendRate - capacityWithFewer <= Math.max(1, freedCarrierRate)) {
                sendRate = Math.max(0, Math.floor(capacityWithFewer));
                feederNeeded -= 1;
              }
            }
          }
          if (sendRate > 0) {
            const delivered = Math.min(
              remaining,
              Math.floor(sendRate * Math.pow(1 - lossRatio, info.hops)),
            );
            if (delivered > 0) {
              allocations.push({
                lane: sink.lane,
                groupId: sink.groupId,
                via: "link",
                fromId: sink.linkFromId,
                toId: sink.linkToId,
                rate: delivered,
                carriersNeeded: feederNeeded,
                priority: sink.priority,
              });
              linkTransfers.push({
                fromId: sink.linkFromId,
                toId: sink.linkToId,
                path,
                ratePerTick: sendRate,
                burstAmount: linkCapacity,
                hops: info.hops,
              });
              if (storageFed) storageAvailable -= sendRate;
              carriersRemaining -= feederNeeded;
              addSpawnNeed("distributor", sink.lane, feederNeeded);
              remaining -= delivered;
            }
          }
        }
      }
    }

    // ── creep 承运 ──
    if (remaining > 0 && sink.creepSourceId !== undefined) {
      const creepRT = sink.creepRoundTripTicks ?? 0;
      if (creepRT > 0) {
        const isStorageSource =
          input.storageId !== undefined && sink.creepSourceId === input.storageId;
        const sourceAvailable = isStorageSource ? storageAvailable : Number.POSITIVE_INFINITY;
        const laneCarrierCap = Math.min(
          carriersRemaining,
          maxPerLane,
          sink.carrierCap ?? Number.POSITIVE_INFINITY,
        );
        const capacityByCarriers = laneCarrierCap * carrierRate(input.carrierPool.carry, creepRT);
        const rate = Math.floor(
          Math.max(0, Math.min(remaining, capacityByCarriers, sourceAvailable)),
        );
        if (rate > 0) {
          let needed = computeCarrierCount(rate, creepRT, input.carrierPool.carry);
          if (needed > laneCarrierCap) {
            needed = laneCarrierCap;
          }
          const delivered = Math.min(
            rate,
            Math.floor(needed * carrierRate(input.carrierPool.carry, creepRT)),
          );
          allocations.push({
            lane: sink.lane,
            groupId: sink.groupId,
            via: "creep",
            fromId: sink.creepSourceId,
            toId: sink.groupId,
            rate: delivered,
            carriersNeeded: needed,
            priority: sink.priority,
          });
          totalCreepRate += delivered;
          if (isStorageSource) storageAvailable -= delivered;
          carriersRemaining -= needed;
          addSpawnNeed(isStorageSource ? "distributor" : "hauler", sink.lane, needed);
          remaining -= delivered;
        }
      }
    }

    // ── unmet ──
    if (remaining > 0.5) {
      let reason: FlowUnmetReason = "no-carrier";
      if (linkMissing && sink.creepSourceId === undefined) {
        reason = "no-link";
      } else if (
        sink.creepSourceId !== undefined &&
        input.storageId !== undefined &&
        sink.creepSourceId === input.storageId &&
        storageAvailable <= 0
      ) {
        reason = "no-source";
      } else if (linkMissing) {
        reason = "no-link";
      } else if (carriersRemaining <= 0 || maxPerLane <= 0) {
        reason = "no-carrier";
      }
      unmet.push({ lane: sink.lane, groupId: sink.groupId, rate: remaining, reason });
    }
  }

  return {
    tick: input.tick,
    allocations,
    linkTransfers,
    spawnNeeds: [...spawnMap.values()],
    unmet,
    totalCreepRate,
  };
}
