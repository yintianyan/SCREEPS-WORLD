import { CONFIG } from "../../config";
import { degradeBody, selectBody } from "../../config/bodies";
import type { RoomSnapshot } from "../../kernel/contracts";
import { countPending, spawnKey } from "./queue";

/** 各角色降级时必需保留的最小部件组合。hauler 无需 WORK。 */
const ROLE_REQUIRED_PARTS: Readonly<Record<string, readonly BodyPartConstant[]>> = {
  hauler: ["carry", "move"],
};

/** 单次遍历统计房间内所有角色的存活 creep 数（含孵化中）。 */
export function countAllCreeps(roomName: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const creep of Object.values(Game.creeps)) {
    const home = creep.memory.home ?? creep.room.name;
    if (home !== roomName) continue;
    const role = creep.memory.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
  }
  // 包含本房间正在孵化中的 creep。
  for (const spawn of Object.values(Game.spawns)) {
    if (spawn.room.name !== roomName) continue;
    const spawning = spawn.spawning;
    if (!spawning) continue;
    const mem = Memory.creeps[spawning.name];
    if (!mem) continue;
    const home = mem.home ?? spawn.room.name;
    if (home !== roomName) continue;
    const role = mem.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

/** 兼容旧调用方的单角色计数（内部走 countAllCreeps）。 */
export function countCreeps(role: string, roomName: string): number {
  return countAllCreeps(roomName)[role] ?? 0;
}

/** 判断 creep 是否即将需要替换（ticksToLive <= body.length * 3 + buffer）。 */
export function needsReplacement(creep: Creep): boolean {
  const ttl = creep.ticksToLive;
  if (ttl === undefined) return false;
  const bodySize = creep.body.length;
  const threshold = bodySize * 3 + CONFIG.spawn.replaceBuffer;
  return ttl <= threshold;
}

interface DemandResult {
  requests: SpawnRequest[];
}

/**
 * 评估房间快照的孵化需求。
 * 返回待提交的新 SpawnRequest 列表（已按 key 去重）。
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
  colonyState: string,
): DemandResult {
  const requests: SpawnRequest[] = [];
  const home = snapshot.roomName;
  const energyCapacity = snapshot.energyCapacityAvailable;

  // 单次遍历获取所有角色计数。
  const counts = countAllCreeps(home);
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
      requests.push(createRequest("worker", home, 0, key, 0, energyCapacity, colonyState));
    }
    return { requests }; // P0 阻塞其他所有请求
  }

  // P1：Harvester — 基于实际占用分配到最少拥挤的 source。
  const harvesterConfig = CONFIG.roles.harvester;
  const harvesterLiving = counts.harvester ?? 0;
  const harvesterTotal = harvesterLiving + pending.harvester;

  if (harvesterTotal < harvesterConfig.minCount) {
    for (let i = harvesterTotal; i < harvesterConfig.minCount; i++) {
      // 找到占用最少的 source。
      let bestSource: Source | undefined;
      let bestCount = Infinity;
      for (const source of snapshot.sources) {
        const count = snapshot.sourceOccupancy.get(source.id) ?? 0;
        if (count < bestCount) {
          bestCount = count;
          bestSource = source;
        }
      }
      const sourceId = bestSource?.id as Id<Source> | undefined;
      const key = spawnKey("harvester", home, i, sourceId as string | undefined);
      if (!hasKey(queue, key)) {
        requests.push(
          createRequest("harvester", home, 1, key, 1, energyCapacity, colonyState, sourceId),
        );
      }
    }
  }

  // P1：Hauler — 仅在有 container 或 storage 时才创建（hauler 无 WORK，不能自采）。
  const haulerConfig = CONFIG.roles.hauler;
  const haulerTotal = (counts.hauler ?? 0) + pending.hauler;
  const hasLogistics = snapshot.containers.length > 0 || snapshot.storage !== undefined;
  if (haulerTotal < haulerConfig.minCount && harvesterTotal >= harvesterConfig.minCount && hasLogistics) {
    for (let i = haulerTotal; i < haulerConfig.minCount; i++) {
      const key = spawnKey("hauler", home, i);
      if (!hasKey(queue, key)) {
        requests.push(createRequest("hauler", home, i, key, 1, energyCapacity, colonyState));
      }
    }
  }

  // P2：Upgrader — 仅在 normal 状态下，不在 bootstrap/recovery。
  // 当控制器存在降级风险时，即使在 recovery/bootstrap 也允许生成 upgrader（P1 优先级）。
  const roomMem = Memory.rooms[home];
  const hasDowngradeRisk = roomMem?.controllerDowngradeRisk === true;
  const allowUpgrader = colonyState === "normal" || hasDowngradeRisk;

  if (allowUpgrader) {
    const upgraderConfig = CONFIG.roles.upgrader;
    const upgraderTotal = (counts.upgrader ?? 0) + pending.upgrader;
    if (upgraderTotal < upgraderConfig.minCount) {
      // 降级风险时提升为 P1 优先级，确保快速保级。
      const upgraderPriority: 0 | 1 | 2 | 3 | 4 = hasDowngradeRisk ? 1 : 2;
      for (let i = upgraderTotal; i < upgraderConfig.minCount; i++) {
        const key = spawnKey("upgrader", home, i);
        if (!hasKey(queue, key)) {
          requests.push(createRequest("upgrader", home, i, key, upgraderPriority, energyCapacity, colonyState));
        }
      }
    }

    // P2：Builder — 仅当存在建造 site 时。
    if (snapshot.myConstructionSites.length > 0) {
      const builderConfig = CONFIG.roles.builder;
      const builderTotal = (counts.builder ?? 0) + pending.builder;
      if (builderTotal < builderConfig.minCount) {
        for (let i = builderTotal; i < builderConfig.minCount; i++) {
          const key = spawnKey("builder", home, i);
          if (!hasKey(queue, key)) {
            requests.push(createRequest("builder", home, i, key, 2, energyCapacity, colonyState));
          }
        }
      }
    }
  }

  // 即将死亡的 creep 的替换请求。
  for (const creep of Object.values(Game.creeps)) {
    if ((creep.memory.home ?? creep.room.name) !== home) continue;
    if (!needsReplacement(creep)) continue;
    const role = creep.memory.role;
    // 使用 memory 中的 spawnIndex（创建时设置）而非解析名称。
    const index = creep.memory.spawnIndex ?? 0;
    const sourceId = creep.memory.sourceId as string | undefined;
    const key = spawnKey(role, home, index, sourceId);
    if (!hasKey(queue, key)) {
      const priority = role === "harvester" || role === "worker" ? 1 : 2;
      requests.push(
        createRequest(role, home, index, key, priority, energyCapacity, colonyState, creep.memory.sourceId),
      );
    }
  }

  return { requests };
}

function hasKey(queue: readonly SpawnRequest[], key: string): boolean {
  return queue.some(r => r.key === key);
}

function createRequest(
  role: string,
  home: string,
  index: number,
  key: string,
  priority: 0 | 1 | 2 | 3 | 4,
  energyCapacity: number,
  colonyState: string,
  sourceId?: Id<Source>,
): SpawnRequest {
  // P0 / bootstrap：根据 energyAvailable 使用降级 body。
  let body: BodyPartConstant[];
  if (priority === 0 || colonyState === "bootstrap" || colonyState === "recovery") {
    const fullBody = selectBody(role, energyCapacity);
    const energyAvailable = Game.rooms[home]?.energyAvailable ?? 200;
    const requiredParts = ROLE_REQUIRED_PARTS[role];
    body = degradeBody(fullBody, energyAvailable, requiredParts) ?? selectBody(role, energyAvailable);
  } else {
    body = selectBody(role, energyCapacity);
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
    createdAt: Game.time,
    retries: 0,
  };
}
