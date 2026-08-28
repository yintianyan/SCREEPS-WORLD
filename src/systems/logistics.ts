/** Logistics 系统 */
import type { System, TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import { EventKind, recordEvent } from "../kernel/event-log";
import {
  applyShrink,
  buildTransportRequests,
  reconcileRegistry,
  type LeaseSummary,
  type RegistryEntry,
  type SupplySource,
  type TransportRequest,
} from "../domain/assignment/request-pool";
import type { AssignmentTaskEntry } from "../domain/assignment/service";
import { CONFIG } from "../config";
import type { TransportRequestV2 } from "../domain/logistics/transport-request";
import { idleRatio } from "../domain/logistics/idle-detection";

/** 每房 heap 态：key 注册表 + 延迟样本环 + 空载观测。global reset 可丢（自动重播种）。 */
interface RoomPoolState {
  registry: Map<string, RegistryEntry>;
  latencyRing: number[];
  /** 本房 hauler 空载率快照（每 tick 更新供消费方读取）。 */
  idleRatio: number;
}
const poolRooms = new Map<string, RoomPoolState>();

const LATENCY_RING_CAP = 64;

function stateFor(roomName: string): RoomPoolState {
  let st = poolRooms.get(roomName);
  if (!st) {
    st = { registry: new Map(), latencyRing: [], idleRatio: 0 };
    poolRooms.set(roomName, st);
  }
  return st;
}

/** 32bit 字符串哈希（事件数值通道用；非加密）。 */
function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** TransportRequest → AssignmentTaskEntry（haul 通道复用既有认领与执行链）。 */
function toTaskEntry(r: TransportRequest): AssignmentTaskEntry {
  return {
    id: r.key,
    kind: "haul",
    sourceId: r.sourceId,
    priority: r.priority,
    maxWorkers: 1,
    assignedCreeps: [],
    pos: r.pos,
  };
}


export const logisticsSystem: System = {
  name: "logistics",
  priority: 0,
  interval: 1,
  run(ctx: TickContext): void {
    const g = globalCache();
    g.transportPool = { tick: ctx.tick, rooms: {} };
    const cfg = CONFIG.logistics;

    // 全房 creep 租约投影只扫一次（O(creeps)，复用 collectCreepRefs 模式）。
    // 租约失效检测：assignment.leaseUntil 过期 → valid=false → 回收重挂。
    const leasesByRoom = new Map<string, LeaseSummary[]>();
    const claimsByRoom = new Map<string, Set<string>>();
    // 用于空载率计算的 hauler 摘要（按 home 分桶）。
    const haulerSummariesByRoom = new Map<string, { name: string; lastActionTick: number; ticksToLive: number; role: string }[]>();
    for (const creep of Object.values(Game.creeps)) {
      if (creep.spawning) continue;
      const home = creep.memory.home ?? creep.room?.name;
      if (!home) continue;
      const a = creep.memory.assignment;
      const tick = ctx.tick;
      // 租约超时检测：assignment 有 leaseUntil 且已过期 → valid=false。
      const leaseExpired = a?.leaseUntil !== undefined && tick > a.leaseUntil;
      let leaseList = leasesByRoom.get(home);
      if (!leaseList) { leaseList = []; leasesByRoom.set(home, leaseList); }
      if (a?.kind === "haul" && a.id) {
        leaseList.push({ sourceId: a.sourceId, valid: !leaseExpired });
        if (!leaseExpired) {
          let claims = claimsByRoom.get(home);
          if (!claims) { claims = new Set(); claimsByRoom.set(home, claims); }
          claims.add(a.id);
        }
      }
      // 收集 hauler 摘要供空载率计算。
      const role = creep.memory.role;
      if (role === "hauler" || role === "distributor") {
        let summaries = haulerSummariesByRoom.get(home);
        if (!summaries) { summaries = []; haulerSummariesByRoom.set(home, summaries); }
        summaries.push({
          name: creep.name,
          lastActionTick: (creep.memory as { lastActionTick?: number }).lastActionTick ?? tick,
          ticksToLive: creep.ticksToLive ?? 1500,
          role,
        });
      }
    }

    for (const snapshot of ctx.snapshots()) {
      const roomName = snapshot.roomName;
      const st = stateFor(roomName);

      // 空载率计算：本房 hauler 摘要 → idleRatio。
      const haulerSummaries = haulerSummariesByRoom.get(roomName) ?? [];
      st.idleRatio = idleRatio(haulerSummaries, ctx.tick, cfg.idleHaulerThreshold);

      // 供给登记：含能非 controller container（controller container 是投递目标）。
      const ccId = snapshot.controllerContainer?.id;
      const supplies: SupplySource[] = snapshot.containers
        .filter(c => c.id !== ccId)
        .map(c => ({
          id: c.id as string,
          pos: { x: c.pos.x, y: c.pos.y },
          available: c.store.getUsedCapacity(RESOURCE_ENERGY),
        }))
        .filter(s => s.available > 0);

      // 塔饥渴信号（需求侧聚合）：任一塔低于阈值区间下沿。
      const towerStarving = snapshot.towers.some(
        t => t.store.getUsedCapacity(RESOURCE_ENERGY) < cfg.towerStarveThreshold,
      );

      const reqs = buildTransportRequests({
        roomName,
        supplies,
        leases: leasesByRoom.get(roomName) ?? [],
        towerStarving,
        maxConcurrentPerSource: 1,
        basePriority: 1,
        boostedPriority: 0,
      });

      // L2 池收缩（断链 fallback 链）：风险缓冲低于地板 → 只保 P0/P1。
      // Economy → Logistics 的反馈闭环实例（任务书 §26）。
      const econSnap = Memory.rooms[roomName]?.economy;
      const shrink = econSnap !== undefined && econSnap.cr > 0
        && econSnap.rb / 10 < cfg.shrinkRiskBufferTicks;
      const finalReqs = applyShrink(reqs, shrink);

      // 注册表对账：登记新 key / 过期回执（不静默丢单）/ 清失联项。
      const currentKeys = new Set(reqs.map(r => r.key));
      const rec = reconcileRegistry(st.registry, currentKeys, ctx.tick, cfg.requestTtlTicks);
      for (const key of rec.expiredKeys) {
        // 事件通道是数值数组——key 以 32bit 哈希入账（完整 key 见 console/黑匣子文本）。
        recordEvent(EventKind.RequestExpired, roomName, [strHash(key)]);
      }

      // 延迟样本：本窗新被认领的 key（claimed 未标记且在册）→ tick − firstSeen。
      const claims = claimsByRoom.get(roomName);
      if (claims) {
        for (const key of claims) {
          const e = st.registry.get(key);
          if (e && !e.claimed) {
            e.claimed = true;
            e.claimedAt = ctx.tick;
            const lat = ctx.tick - e.firstSeen;
            if (st.latencyRing.length >= LATENCY_RING_CAP) st.latencyRing.shift();
            st.latencyRing.push(lat);
          }
        }
      }

      // A4.4 修复 DUPLICATE-002：V1/V2 去重。
      // 旧问题：V1 和 V2 可能同时为同一个 container 积压生成运输请求，hauler 看到重复任务。
      // 修复：Plan 存在且有效时，V1 检查 Plan 是否已覆盖该 source，若覆盖则跳过。
      const plan = globalCache().logisticsPlan?.plan;
      const planIsActive = plan && plan.plannedAt >= ctx.tick - 100;

      // 收集 Plan V2 已覆盖的 source ID（scope="room" 的请求的 source.id）。
      const planCoveredSourceIds = new Set<string>();
      if (planIsActive) {
        for (const pr of plan.requests) {
          if (pr.scope === "room" && pr.destination.room === roomName) {
            if (pr.source.structureId) {
              planCoveredSourceIds.add(pr.source.structureId);
            }
          }
        }
      }

      // V1 过滤：如果 Plan V2 已覆盖该 source，跳过 V1 Request。
      const dedupedReqs = planIsActive && planCoveredSourceIds.size > 0
        ? finalReqs.filter(r => {
            // V1 Request 的 key 格式: "collect:room:containerId"
            // 如果 Plan V2 已覆盖该 containerId，跳过。
            const parts = r.key.split(":");
            const containerId = parts[2];
            if (containerId && planCoveredSourceIds.has(containerId)) {
              return false; // Plan V2 已覆盖，跳过 V1
            }
            return true;
          })
        : finalReqs;

      g.transportPool.rooms[roomName] = dedupedReqs.map(toTaskEntry);

      // P3-3：tower 补给请求 — 塔低于饥渴阈值时生成独立补给请求。
      // 不影响收集请求提级（已有 boostedPriority），补充一条从 supply 到 tower 的搬运任务。
      if (towerStarving) {
        const towerReqs = buildTowerSupplyRequests(roomName, supplies, cfg.towerStarveThreshold);
        for (const tr of towerReqs) {
          g.transportPool.rooms[roomName]?.push(toTaskEntry(tr));
        }
      }

      // A4.3：合并 logistics-planner 产出的 Plan 中 scope="room" 的请求。
      // Plan 驱动的请求适配为 AssignmentTaskEntry 格式，追加到本房任务槽。
      // scope="empire" 的请求不进 transportPool — 由 agenda-manager carrier 执行。
      // scope="operation" 的请求不进 transportPool — 由远矿 remoteHauler 执行。
      // A4.4 修复 BYPASS-012：与 agenda-manager 步 13.5 同口径——消费最近 100t 内的 Plan。
      // 旧逻辑 plannedAt === ctx.tick 导致 99% 的 tick V2 不参与房内物流。
      if (planIsActive) {
        // 消费最近 100 tick 内产出的 Plan（与 agenda-manager 步 13.5 一致）。
        const planReqs = plan.requests.filter(
          r => r.scope === "room" && r.destination.room === roomName,
        );
        for (const pr of planReqs) {
          const taskEntry = planRequestToTaskEntry(pr);
          if (taskEntry) {
            g.transportPool.rooms[roomName]?.push(taskEntry);
          }
        }
      }
    }
    // P3-2：空载率指标写入 globalCache 供消费方读取。
    const allIdleRatios: Record<string, number> = {};
    let maxIdleRatio = 0;
    for (const [roomName, st] of poolRooms) {
      allIdleRatios[roomName] = st.idleRatio;
      if (st.idleRatio > maxIdleRatio) maxIdleRatio = st.idleRatio;
    }
    g.logisticsIdleRatio = { tick: ctx.tick, byRoom: allIdleRatios, max: maxIdleRatio };

    // A3.0：empire scope 跨房调拨不再通过 transportPool — carrier 角色独立搬运，
    // 不走 hauler assignment 链。agenda-manager 直接提交 carrier spawn 请求。
  },
};

/** 查询口（观测用）：房间延迟样本环（只读副本）。 */
export function logisticsLatencySamples(roomName: string): readonly number[] {
  return poolRooms.get(roomName)?.latencyRing ?? [];
}

/** 查询口（观测用）：房间空载率快照。 */
export function logisticsIdleRatio(roomName: string): number {
  return poolRooms.get(roomName)?.idleRatio ?? 0;
}

/**
 * 为低能量塔生成补给搬运请求。
 * 每个含能 container 都可作为一个 supply source，
 * 优先级 P0（与 towerStarving 提级一致），确保 hauler 优先补塔。
 */
function buildTowerSupplyRequests(
  roomName: string,
  supplies: readonly SupplySource[],
  _towerStarveThreshold: number,
): TransportRequest[] {
  const reqs: TransportRequest[] = [];
  for (const s of supplies) {
    reqs.push({
      key: "tower-supply:" + roomName + ":" + s.id,
      resource: "energy",
      amount: s.available,
      sourceId: s.id,
      pos: s.pos,
      priority: 0,
    });
  }
  return reqs;
}

/**
 * A4.3：TransportRequestV2 → AssignmentTaskEntry 适配器。

 * 将 logistics-planner 产出的 V2 请求适配为现有 hauler 认领链可消费的格式。
 * 仅适配 scope="room" 的请求（房内搬运）。

 * source.structureId 若有则作为 sourceId；否则用 source.room 作为伪 ID。
 */
function planRequestToTaskEntry(req: TransportRequestV2): AssignmentTaskEntry | undefined {
  // 只适配 scope="room" 的请求
  if (req.scope !== "room") return undefined;

  return {
    id: req.requestId,
    kind: "haul" as const,
    sourceId: req.source.structureId ?? req.source.room,
    priority: req.priority,
    maxWorkers: 1,
    assignedCreeps: [],
    pos: req.source.pos,
  };
}
