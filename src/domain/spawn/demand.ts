import { CONFIG } from "../../config";
import { degradeBody, selectBody } from "../../config/bodies";
import type { ColonyState, RoomSnapshot } from "../../kernel/contracts";
import { countPending, spawnKey } from "./queue";

/** 各角色降级时必需保留的最小部件组合。hauler 无需 WORK。 */
const ROLE_REQUIRED_PARTS: Readonly<Record<string, readonly BodyPartConstant[]>> = {
  hauler: ["carry", "move"],
};

/**
 * 单个 creep 的摘要信息 — 供纯函数消费，不持有 Creep 对象。
 *
 * 适配层（系统/角色层）从 `Game.creeps` 收集后传入。
 */
export interface CreepSummary {
  name: string;
  role: string;
  home: string;
  ticksToLive?: number;
  bodyLength: number;
  sourceId?: Id<Source>;
  spawnIndex?: number;
}

/** 正在孵化中的 creep 摘要。 */
export interface SpawningSummary {
  name: string;
  role: string;
  home: string;
}

/**
 * 房间经济上下文 — 从 Memory/Game 收集的标志位，供纯函数消费。
 *
 * 适配层负责从 `Memory.rooms[roomName]` 和 `Game.rooms[roomName]` 读取后传入。
 */
export interface RoomDemandContext {
  colonyState: ColonyState;
  controllerDowngradeRisk: boolean;
  energyAvailable: number;
}

interface DemandResult {
  requests: SpawnRequest[];
}

/**
 * 统计指定房间内所有角色的存活 creep 数（含孵化中）。
 *
 * 纯函数 — 接收预收集的 creep 和 spawning 摘要列表，不访问 Game/Memory。
 */
export function countCreepsByRole(
  creeps: readonly CreepSummary[],
  spawning: readonly SpawningSummary[],
  roomName: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const creep of creeps) {
    if (creep.home !== roomName) continue;
    const role = creep.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
  }
  for (const s of spawning) {
    if (s.home !== roomName) continue;
    const role = s.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

/**
 * 判断 creep 是否即将需要替换（ticksToLive <= body.length * 3 + buffer）。
 * 纯函数 — 接收显式参数，不访问 Creep 对象。
 */
export function needsReplacement(
  ticksToLive: number | undefined,
  bodyLength: number,
): boolean {
  if (ticksToLive === undefined) return false;
  const threshold = bodyLength * 3 + CONFIG.spawn.replaceBuffer;
  return ticksToLive <= threshold;
}

/**
 * 评估房间孵化需求。
 *
 * 纯函数 — 接收预收集的所有数据（快照、队列、creep 摘要、房间上下文），
 * 返回待提交的 SpawnRequest 列表。不访问 Game/Memory。
 *
 * 优先级顺序：
 *   P0 — 无 harvester 时的恢复 worker
 *   P1 — harvester 至 minCount，带 source 分配（基于实际占用）
 *   P1 — hauler 至 minCount
 *   P2 — upgrader 至 minCount
 *   P2 — builder 至 minCount（仅当存在建造 site 时）
 */
export function evaluateDemand(
  snapshot: RoomSnapshot,
  queue: readonly SpawnRequest[],
  colonyState: ColonyState,
  creeps: readonly CreepSummary[],
  spawning: readonly SpawningSummary[],
  roomCtx: RoomDemandContext,
  tick: number,
): DemandResult {
  const requests: SpawnRequest[] = [];
  const home = snapshot.roomName;
  const energyCapacity = snapshot.energyCapacityAvailable;
  // 统一经济状态：recovery 涵盖 crisis + recovery 相位，收缩非关键消耗。
  const inCrisis = colonyState === "recovery";

  // 单次遍历获取所有角色计数。
  const counts = countCreepsByRole(creeps, spawning, home);
  const pending = {
    harvester: countPending(queue, "harvester"),
    worker: countPending(queue, "worker"),
    hauler: countPending(queue, "hauler"),
    upgrader: countPending(queue, "upgrader"),
    builder: countPending(queue, "builder"),
  };

  // P0：恢复 worker — 当完全没有 harvester/worker 时。
  const harvesterCount =
    (counts.harvester ?? 0) +
    (counts.worker ?? 0) +
    pending.harvester +
    pending.worker;

  if (harvesterCount === 0) {
    const key = spawnKey("worker", home, 0);
    if (!hasKey(queue, key)) {
      requests.push(createRequest("worker", home, 0, key, 0, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
    }
    return { requests }; // P0 阻塞其他所有请求
  }

  // P1：Harvester — 基于实际占用分配到最少拥挤的 source。
  // 使用本地占用副本，确保同一轮多次孵化时后续迭代能看到前面的分配。
  const harvesterConfig = CONFIG.roles.harvester;
  const harvesterLiving = counts.harvester ?? 0;
  const harvesterTotal = harvesterLiving + pending.harvester;

  if (harvesterTotal < harvesterConfig.minCount) {
    // 本地占用映射：从快照复制，循环内累加，避免同轮重复分配同一 source。
    const localOccupancy = new Map<string, number>(
      [...snapshot.sourceOccupancy.entries()].map(([k, v]) => [k, v] as [string, number]),
    );

    for (let i = harvesterTotal; i < harvesterConfig.minCount; i++) {
      // 找到占用最少的 source。
      let bestSource: Source | undefined;
      let bestCount = Infinity;
      for (const source of snapshot.sources) {
        const count = localOccupancy.get(source.id) ?? 0;
        if (count < bestCount) {
          bestCount = count;
          bestSource = source;
        }
      }
      const sourceId = bestSource?.id as Id<Source> | undefined;
      // 累加本地占用，确保下一个 harvester 分配到不同 source。
      if (sourceId) {
        localOccupancy.set(sourceId as string, (localOccupancy.get(sourceId as string) ?? 0) + 1);
      }
      const key = spawnKey("harvester", home, i, sourceId as string | undefined);
      if (!hasKey(queue, key)) {
        // 危机时 harvester 提为 P0：经济引擎优先于一切，尽快恢复采集。
        requests.push(
          createRequest("harvester", home, 1, key, inCrisis ? 0 : 1, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick, sourceId),
        );
      }
    }
  }

  // P1：Hauler — 仅在有 container 或 storage 时才创建（hauler 无 WORK，不能自采）。
  // 动态数量：每个 container 需要 ~1.5 个 hauler 才能搬空运力（考虑往返时间）。
  // 公式：ceil(containers * 1.5)，下限 minCount，上限 maxCount。
  const haulerConfig = CONFIG.roles.hauler;
  const haulerTotal = (counts.hauler ?? 0) + pending.hauler;
  const hasLogistics = snapshot.containers.length > 0 || snapshot.storage !== undefined;
  const dynamicHaulerTarget = hasLogistics
    ? Math.min(
        haulerConfig.maxCount,
        Math.max(haulerConfig.minCount, Math.ceil(snapshot.containers.length * 1.5)),
      )
    : 0;
  // 能量危机：收缩 hauler 到 minCount —— 仅保留把能量搬回 spawn 供孵化 harvester 的最小力量，
  // 避免孵出一堆无能量可搬的空闲 hauler，白白浪费孵化能量。
  const haulerTarget = inCrisis
    ? Math.min(dynamicHaulerTarget, haulerConfig.minCount)
    : dynamicHaulerTarget;
  if (haulerTotal < haulerTarget && hasLogistics) {
    for (let i = haulerTotal; i < haulerTarget; i++) {
      const key = spawnKey("hauler", home, i);
      if (!hasKey(queue, key)) {
        requests.push(createRequest("hauler", home, i, key, 1, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
      }
    }
  }

  // P2：Upgrader — 仅在 normal 状态下，不在 bootstrap/recovery。
  // 当控制器存在降级风险时，即使在 recovery/bootstrap 也允许生成 upgrader（P1 优先级）。
  const hasDowngradeRisk = roomCtx.controllerDowngradeRisk;
  const allowUpgrader = colonyState === "normal" || hasDowngradeRisk;

  if (allowUpgrader) {
    const upgraderConfig = CONFIG.roles.upgrader;
    const upgraderTotal = (counts.upgrader ?? 0) + pending.upgrader;

    // 动态 upgrader 数量 — 老玩家站桩升级策略：
    // 一旦 controller container 建成，hauler 物流链（source container → controller container）
    // 持续供能，upgrader 0 通勤站桩升级，此时数量即吞吐 —— 直接拉满 maxCount。
    // 无 container 时多 upgrader 都要长途自采，通勤浪费抵消数量优势，保持 minCount。
    // 降级紧急状态下即使无 container 也拉满（自采也要保级）。
    const stationUpgradeOnline = snapshot.controllerContainer !== undefined;
    // 能量危机：升级是最大的可自由支配能量汇，危机时停升级把能量让给孵化 harvester；
    // 仅当控制器真正快降级（ticksToDowngrade < downgradeGuard）时保留 minCount 个 upgrader 保级。
    const ctrl = snapshot.controller;
    const crisisNeedsGuard =
      inCrisis && ctrl !== undefined && ctrl.ticksToDowngrade < CONFIG.economy.crisis.downgradeGuard;
    let upgraderTarget: number;
    if (inCrisis) {
      upgraderTarget = crisisNeedsGuard ? upgraderConfig.minCount : 0;
    } else {
      upgraderTarget =
        stationUpgradeOnline || hasDowngradeRisk ? upgraderConfig.maxCount : upgraderConfig.minCount;
    }

    if (upgraderTotal < upgraderTarget) {
      // 降级风险时提升为 P1 优先级，确保快速保级。
      const upgraderPriority: 0 | 1 | 2 | 3 | 4 = hasDowngradeRisk ? 1 : 2;
      for (let i = upgraderTotal; i < upgraderTarget; i++) {
        const key = spawnKey("upgrader", home, i);
        if (!hasKey(queue, key)) {
          requests.push(createRequest("upgrader", home, i, key, upgraderPriority, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
        }
      }
    }

    // P2：Builder — 仅当存在建造 site 时。
    // 动态数量：每个活跃 site 配 1 个 builder，上限 maxCount。
    if (snapshot.myConstructionSites.length > 0) {
      const builderConfig = CONFIG.roles.builder;
      const builderTotal = (counts.builder ?? 0) + pending.builder;
      const dynamicBuilderTarget = Math.min(
        builderConfig.maxCount,
        Math.max(builderConfig.minCount, snapshot.myConstructionSites.length),
      );
      // 能量危机：收缩 builder 到 minCount —— 仅留 1 个处理关键 source container 重建（恢复收入），
      // 避免按 site 数孵出一堆无能量可建的空闲 builder 浪费孵化能量。
      const builderTarget = inCrisis ? builderConfig.minCount : dynamicBuilderTarget;
      if (builderTotal < builderTarget) {
        for (let i = builderTotal; i < builderTarget; i++) {
          const key = spawnKey("builder", home, i);
          if (!hasKey(queue, key)) {
            requests.push(createRequest("builder", home, i, key, 2, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
          }
        }
      }
    }
  }

  // 即将死亡的 creep 的替换请求。
  // 老玩家四重门禁，防止 creep 数量激增：
  //   1. 角色存在性门禁（worker 有 harvester 时不替换，builder 无 site 不替换）
  //   2. maxCount 硬上限（living + pending 已达上限不替换）
  //   3. 盈余检查（living + pending > minCount 说明有多余，不替换）
  //   4. 稳定 key（不含 sourceId，防止 assignment 重分配导致 key 漂移产生重复）
  const roleConfigs = CONFIG.roles as Record<string, { minCount: number; maxCount: number }>;

  for (const creep of creeps) {
    if (creep.home !== home) continue;
    if (!needsReplacement(creep.ticksToLive, creep.bodyLength)) continue;
    const role = creep.role;
    const config = roleConfigs[role];
    if (!config) continue;

    // 门禁 1：角色存在性 — worker 是紧急角色，harvester 建立后不再替换。
    if (role === "worker" && (counts.harvester ?? 0) + (counts.worker ?? 0) > 1) continue;
    // builder 无建造 site 时不替换（避免孵化无事可做的 builder）。
    if (role === "builder" && snapshot.myConstructionSites.length === 0) continue;
    // upgrader 在 colonyState 不允许时不替换。
    if (role === "upgrader" && !allowUpgrader) continue;

    // 门禁 2：maxCount 硬上限。
    const livingCount = counts[role] ?? 0;
    const pendingCount = countPending(queue, role) + requests.filter(r => r.role === role).length;
    if (livingCount + pendingCount >= config.maxCount) continue;

    // 门禁 3：盈余检查 — 如果去掉这个将死的 creep 后仍 >= minCount，说明有多余，不替换。
    // 只有当 "将死 creep 是维持 minCount 的必要成员" 时才提前替换（利用 overlap 无缝衔接）。
    if (livingCount - 1 + pendingCount >= config.minCount) continue;

    // 门禁 4：稳定 key — 不含 sourceId，防止 assignment 重分配导致 key 漂移。
    const index = creep.spawnIndex ?? 0;
    const key = spawnKey(role, home, index);
    if (!hasKey(queue, key) && !requests.some(r => r.key === key)) {
      const priority = role === "harvester" || role === "worker" ? 1 : 2;
      const req = createRequest(role, home, index, key, priority, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick, creep.sourceId);
      req.replaceBy = tick + req.body.length * 3 + CONFIG.spawn.replaceBuffer;
      requests.push(req);
    }
  }

  return { requests };
}

function hasKey(queue: readonly SpawnRequest[], key: string): boolean {
  return queue.some(r => r.key === key);
}

/**
 * 创建孵化请求（纯函数）。
 *
 * energyAvailable 和 tick 由调用方显式传入，不从 Game/Memory 读取。
 */
function createRequest(
  role: string,
  home: string,
  index: number,
  key: string,
  priority: 0 | 1 | 2 | 3 | 4,
  energyCapacity: number,
  energyAvailable: number,
  colonyState: ColonyState,
  rcl: number,
  tick: number,
  sourceId?: Id<Source>,
): SpawnRequest {
  // X-16：P0/P1 角色的 body 降级阈值基于 energyAvailable（当前可用能量），
  // 而非 energyCapacityAvailable（容量上限）；当 extension 不满时，
  // 优先使用最小可孵化 body 速出，避免等待 extension 充满。
  let body: BodyPartConstant[];
  if (priority <= 1 || colonyState === "bootstrap" || colonyState === "recovery") {
    const fullBody = selectBody(role, energyCapacity, { rcl });
    const requiredParts = ROLE_REQUIRED_PARTS[role];
    // 优雅降级：孵化当前能量能负担的最大 body。宁可先出一个较小的 harvester（低效但维持 colony 存活），
    // 也不要为等待大 body 而让 harvester 断档归零（曾因此陷入「无 harvester→无收入→永远孵不起」死锁）。
    body = degradeBody(fullBody, energyAvailable, requiredParts) ?? selectBody(role, energyAvailable, { rcl });
  } else {
    body = selectBody(role, energyCapacity, { rcl });
  }

  const memory: CreepMemory = {
    role,
    home,
    mode: "acquire",
    spawnIndex: index,
    ...(sourceId ? { sourceId } : {}),
  };

  return {
    key,
    role,
    home,
    priority,
    body,
    memory,
    createdAt: tick,
    retries: 0,
  };
}
