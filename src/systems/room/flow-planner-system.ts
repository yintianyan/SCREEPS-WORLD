/**
 * FlowPlanner 系统（Phase 1）— 只产出 upgrade 车道的流量计划与 deliver 任务。
 *
 * 设计：
 * - 每 tick 运行（纯计算量很小：每房 1 个 sink + ≤6 个 link）。
 * - 产出的任务存 globalCache，assignment-service 同 tick 合并进任务槽。
 * - 不改动 spawn/demand/targeting；distributor 通过 assignment 认领任务执行。
 */
import type { Priority, System, TickContext } from "../../kernel/contracts";
import { CONFIG } from "../../config";
import { bodyCost } from "../../config/bodies";
import { globalCache, type CreepRef } from "../../kernel/global-cache";
import { buildFlowDeliverTasks, type FlowDeliverContext } from "../../domain/assignment/flow-tasks";
import type { AssignmentTaskEntry } from "../../domain/assignment/service";
import {
  computeCoreDemand,
  computeUpgradeDemand,
  planRoomFlows,
} from "../../domain/logistics/flow-planner";
import { energyReserveFor } from "../../domain/spawn/reserve";
import type { FlowLinkNode, FlowSinkDemand, RoomFlowPlan } from "../../domain/logistics/flow-types";
import {
  classifyLinkRole,
  findStorageLink,
  resolveLinkRoleRanges,
} from "../../domain/economy/links";

const CHEB = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function liveUpgraderWorkParts(refs: readonly CreepRef[], roomName: string): number {
  let parts = 0;
  for (const ref of refs) {
    if (ref.home !== roomName || ref.role !== "upgrader" || ref.spawning) continue;
    for (const part of ref.body) {
      if (part.type === "work") parts++;
    }
  }
  return parts;
}

function liveDistributorCount(refs: readonly CreepRef[], roomName: string): number {
  let count = 0;
  for (const ref of refs) {
    if (ref.home === roomName && ref.role === "distributor" && !ref.spawning) count++;
  }
  return count;
}

export const flowPlannerSystem: System = {
  name: "flow-planner",
  priority: 1 as Priority,
  interval: 1,
  run(ctx: TickContext): void {
    const g = globalCache();
    const refs = g.creepRefs ?? [];
    const plans: Record<string, RoomFlowPlan> = {};
    const tasks: Record<string, AssignmentTaskEntry[]> = {};
    const plannedRooms = new Set<string>();

    for (const snapshot of ctx.snapshots()) {
      const roomName = snapshot.roomName;
      tasks[roomName] = [];
      const roomMem = Memory.rooms[roomName];
      if (roomMem?.releaseAt !== undefined) continue;
      if (snapshot.rcl < 4 || snapshot.storage === undefined || snapshot.controller === undefined) {
        continue;
      }

      const ctrl = snapshot.controller;
      const storage = snapshot.storage;
      const distributorCount = liveDistributorCount(refs, roomName);
      if (distributorCount <= 0) continue;

      // Phase 2.5：低储回血期不喂升级车道 —— upgrader 已被角色闸停，继续往 controller
      // link/container 灌能只会把 storage 抽成 link 里的死库存。降级风险豁免。
      // Phase D：跟随升级专用闸 upgradeActive（恢复线 60K），与 lab/修墙解耦。
      const upgradeLatch = roomMem?.upgradeActive ?? roomMem?.storageRichActive;
      const storageThrottled = upgradeLatch === false && roomMem?.controllerDowngradeRisk !== true;

      const links: FlowLinkNode[] = snapshot.links.map(l => ({
        id: l.id,
        pos: { x: l.pos.x, y: l.pos.y },
        energy: l.store.getUsedCapacity(RESOURCE_ENERGY),
        capacity: l.store.getCapacity(RESOURCE_ENERGY),
      }));

      const sinks: FlowSinkDemand[] = [];
      const taskCtxs: FlowDeliverContext[] = [];

      // Phase 2：core 车道 — 现金池补能，优先于 upgrade。
      const coreAnchor = snapshot.spawns[0] ?? ctrl;
      const coreRoundTrip = 2 * CHEB(storage.pos, coreAnchor.pos) + 4;
      const cashCap = snapshot.energyCapacityAvailable;
      const spawnReserve = energyReserveFor(cashCap, CONFIG.spawn.energyReserve);
      const pendingHostedBodyCost = (roomMem?.spawnQueue ?? []).reduce(
        (sum, req) => sum + (Array.isArray(req.body) ? bodyCost(req.body) : 0),
        0,
      );
      const coreRate = computeCoreDemand({
        cashCap,
        spawnReserve,
        pendingHostedBodyCost,
        energyAvailable: snapshot.energyAvailable,
        // 60 tick 摊平：core 只做慢速回填，不长期占满承运人池（否则 upgrade 掉速）。
        horizonTicks: 60,
      });
      // 低于 5 e/t 的涓流不值得占一只承运人；等缺口变大再补。
      if (coreRate >= 5) {
        sinks.push({
          groupId: "core",
          lane: "core",
          priority: 0,
          demandPerTick: coreRate,
          creepSourceId: storage.id,
          creepRoundTripTicks: coreRoundTrip,
          // 慢速回填：1 只足够覆盖 spawn 脉冲平均消耗，别和 upgrade 抢承运人。
          carrierCap: 1,
        });
        taskCtxs.push({
          roomName,
          lane: "core",
          priority: 0,
          groupId: "core",
          creepSourceId: storage.id,
          creepTargetGroup: "core",
          creepTargetPos: { x: coreAnchor.pos.x, y: coreAnchor.pos.y },
        });
      }

      // Phase 1/2：upgrade 车道。
      const workParts = liveUpgraderWorkParts(refs, roomName);
      const ctrlLink = snapshot.links.find(l => l.pos.getRangeTo(ctrl.pos) <= 2);
      const storageLink = findStorageLink(snapshot);
      const station = snapshot.controllerContainer ?? ctrlLink;
      if (workParts > 0 && station !== undefined && !storageThrottled) {
        const linkTargetCapacity = ctrlLink
          ? ctrlLink.store.getCapacity(RESOURCE_ENERGY)
          : Number.POSITIVE_INFINITY;
        const demand = computeUpgradeDemand(workParts, workParts, linkTargetCapacity);
        const creepRoundTrip = 2 * CHEB(storage.pos, station.pos) + 4;
        const feederRoundTrip =
          storageLink !== undefined ? 2 * CHEB(storage.pos, storageLink.pos) + 4 : undefined;

        // source link 直供 controller：存在 source link 时，按 2×source 的采集量估算。
        const ranges = resolveLinkRoleRanges(CONFIG.economy.link);
        const sourcePoints = snapshot.sources.map(s => s.pos);
        const hasSourceLink = snapshot.links.some(
          l => classifyLinkRole(l.pos, sourcePoints, ctrl.pos, storage.pos, ranges) === "source",
        );
        const externalSupply =
          storageLink !== undefined && ctrlLink !== undefined && hasSourceLink
            ? snapshot.sources.length * CONFIG.economy.harvestWorkingParts * 2
            : 0;

        if (demand > 0) {
          sinks.push({
            groupId: "upgrade",
            lane: "upgrade",
            priority: 2,
            demandPerTick: demand,
            externalSupplyPerTick: externalSupply,
            linkFromId: storageLink?.id,
            linkToId: ctrlLink?.id,
            linkFeederRoundTripTicks: feederRoundTrip,
            creepSourceId: storage.id,
            creepRoundTripTicks: creepRoundTrip,
          });
          taskCtxs.push({
            roomName,
            lane: "upgrade",
            priority: 2,
            groupId: "upgrade",
            linkFeederSourceId: storage.id,
            linkFeederTargetId: storageLink?.id,
            linkFeederPos: storageLink ? { x: storageLink.pos.x, y: storageLink.pos.y } : undefined,
            creepSourceId: storage.id,
            creepTargetId: station.id,
            creepTargetPos: { x: station.pos.x, y: station.pos.y },
          });
        }
      }

      if (sinks.length === 0) continue;

      const plan = planRoomFlows({
        tick: ctx.tick,
        storageEnergy: storage.store.getUsedCapacity(RESOURCE_ENERGY),
        storageId: storage.id,
        sinks,
        links,
        carrierPool: {
          count: distributorCount,
          carry: CONFIG.economy.referenceCarryCapacity,
          roundTripTicks: coreRoundTrip,
        },
        policy: {
          storageFloor: CONFIG.economy.upgradeEnergyFloorStorage,
          linkCapacity: 800,
          linkLossRatio: 0.03,
        },
      });

      const roomTasks: AssignmentTaskEntry[] = [];
      for (const taskCtx of taskCtxs) {
        roomTasks.push(...buildFlowDeliverTasks(plan, taskCtx));
      }

      plans[roomName] = plan;
      tasks[roomName] = roomTasks;
      plannedRooms.add(roomName);
      // 观测瘦摘要：每 5 tick 写一次，避免 Memory 抖动。
      // `u`（unmet）只做诊断：补员由 spawn-manager 的 distributor/ccFill 反馈负责，
      // FlowPlanner 不据此发孵化请求，防止两套编制信号互相放大。
      if (roomMem !== undefined && ctx.tick % 5 === 0) {
        roomMem.flowPlan = {
          t: ctx.tick,
          a: plan.allocations.map(a => ({
            l: a.lane,
            v: a.via,
            r: Math.round(a.rate),
            c: a.carriersNeeded,
          })),
          u: plan.unmet.map(u => ({
            l: u.lane,
            r: Math.round(u.rate),
            w: u.reason,
          })),
        };
      }
    }

    // 未规划的房间清掉旧观测值，避免 Memory 里留下“看起来像现值”的化石。
    for (const snapshot of ctx.snapshots()) {
      const roomName = snapshot.roomName;
      if (plannedRooms.has(roomName)) continue;
      const roomMem = Memory.rooms[roomName];
      if (roomMem !== undefined && roomMem.flowPlan !== undefined) delete roomMem.flowPlan;
    }

    g.flowPlans = { tick: ctx.tick, byRoom: plans };
    g.flowTasks = { tick: ctx.tick, byRoom: tasks };
  },
};
