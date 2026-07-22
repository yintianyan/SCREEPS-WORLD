import { CONFIG } from "../config";
import { bodyCost, degradeBody, RECOVERY_BODY } from "../config/bodies";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { evaluateDemand, type CreepSummary, type SpawningSummary, type RoomDemandContext } from "../domain/spawn/demand";
import type { ColonyState } from "../kernel/contracts";
import { cleanQueue, sortQueue, submitRequest } from "../domain/spawn/queue";
import { selectRecycleCandidates } from "../domain/spawn/recycle";
import { moveToTarget } from "../creeps/movement";

/**
 * 孵化管理器 — 唯一调用 spawnCreep 的模块。
 *
 * 职责：
 *   - 评估每房孵化需求
 *   - 在 Memory 中维护去重、按优先级排序的队列
 *   - 处理队列：尝试孵化最高优先级的请求
 *   - 处理 P0 恢复、body 降级和重试限制
 *
 * 优先级：P0（在所有依赖人口的其他系统之前运行）。
 */
export const spawnManagerSystem: System = {
  name: "spawn-manager",
  priority: 0 as Priority,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      const queue = roomMem.spawnQueue ?? [];

      // 1. 从 Game/Memory 收集数据，调用纯函数评估需求。
      const creeps = collectCreepSummaries();
      const spawning = collectSpawningSummaries();
      const colonyState: ColonyState = roomMem.colonyState ?? "normal";
      const roomCtx: RoomDemandContext = {
        colonyState,
        controllerDowngradeRisk: roomMem.controllerDowngradeRisk === true,
        energyAvailable: Game.rooms[snapshot.roomName]?.energyAvailable ?? 200,
        economyPressure: roomMem.economyPressure ?? 0,
      };
      const { requests } = evaluateDemand(
        snapshot,
        queue,
        colonyState,
        creeps,
        spawning,
        roomCtx,
        ctx.tick,
      );
      for (const req of requests) {
        submitRequest(queue, req);
      }
      roomMem.spawnQueue = queue;

      // 2. 清理过期 / 隔离的请求。
      cleanQueue(queue, ctx.tick, CONFIG.spawn.maxRetries);

      // 3. 按优先级排序。
      sortQueue(queue);

      // 4. 尝试孵化最高优先级的请求。
      trySpawn(snapshot, queue);

      // 5. B1：回收通道 — 标记退役 creep，引导至最近 spawn 回收残值能量。
      recyclePass(snapshot, creeps);
    }
  },
};

/** 当前注册的角色集合（CONFIG.roles 是唯一权威）。 */
const KNOWN_ROLES: ReadonlySet<string> = new Set(Object.keys(CONFIG.roles));

/**
 * B1 回收通道。
 *
 * 标记规则（保守白名单，不做全量配额对账）：
 *   1. 废弃角色：role 不在 CONFIG.roles 中（角色已下线，creep 永远闲置）；
 *   2. 富余 worker：harvester 满编时，worker 保留 1 只作灾后保险，其余回收
 *      （与 demand 的存在性门禁语义一致：worker 是过渡角色，不是常备军）。
 *
 * 执行：被标记 creep 走向本房最近 spawn（role-runner 对其短路 idle，不抢移动权），
 * 相邻时 spawn.recycleCreep 回收残值能量；spawn 忙碌时等待下一 tick。
 */
function recyclePass(
  snapshot: import("../kernel/contracts").RoomSnapshot,
  summaries: readonly CreepSummary[],
): void {
  const home = snapshot.roomName;

  // ── 标记（纯函数决策）──
  const marked = selectRecycleCandidates(
    summaries,
    home,
    KNOWN_ROLES,
    CONFIG.roles.harvester.minCount,
  );
  for (const name of marked) {
    const creep = Game.creeps[name];
    if (creep && !creep.memory.recycle) creep.memory.recycle = true;
  }

  // ── 执行：引导至最近 spawn 并回收 ──
  if (snapshot.spawns.length === 0) return;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (!creep?.memory.recycle) continue;
    if ((creep.memory.home ?? creep.room.name) !== home) continue;
    const spawn = creep.pos.findClosestByRange(snapshot.spawns as StructureSpawn[]);
    if (!spawn) continue;
    if (creep.pos.getRangeTo(spawn) <= 1) {
      // ERR_BUSY（spawn 孵化中）时静默等待下一 tick，不算失败。
      spawn.recycleCreep(creep);
    } else {
      moveToTarget(creep, spawn);
    }
  }
}
/**
 * 尝试从队列中孵化最高优先级的 creep。
 * 处理 P0 降级、body 容量校验和错误重试。
 */
function trySpawn(snapshot: import("../kernel/contracts").RoomSnapshot, queue: SpawnRequest[]): void {
  if (queue.length === 0) return;
  if (snapshot.spawns.length === 0) return;

  // 查找可用 spawn。
  const spawn = snapshot.spawns.find(s => !s.spawning);
  if (!spawn) return; // 所有 spawn 忙 — 不是错误。

  // 如果有待处理的 P0 请求，不处理更低优先级的请求。
  const hasP0 = queue.some(r => r.priority === 0);

  // 按优先级顺序处理请求。
  for (const req of queue) {
    if (!req) continue;

    // P0 阻塞：如果存在 P0 请求但暂时无法满足，不孵化非 P0 creep。
    if (hasP0 && req.priority > 0) return;

    // 检查 body 是否有效。
    if (req.body.length === 0) {
      req.retries++;
      continue;
    }

    const cost = bodyCost(req.body);
    const energyAvailable = spawn.room.energyAvailable;

    // P0：降级 body 以适应当前能量（最小 [WORK, CARRY, MOVE]）。
    // P1 在 bootstrap/recovery 时也允许降级 — 此时 harvester 是关键路径，
    // 等待满额能量会造成死锁（无 harvester → 无收入 → 永远凑不够能量）。
    let body = req.body;
    if (cost > energyAvailable) {
      const roomState = Memory.rooms[snapshot.roomName]?.colonyState ?? "normal";
      const allowDegrade = req.priority === 0 ||
        (req.priority === 1 && (roomState === "bootstrap" || roomState === "recovery"));
      if (allowDegrade) {
        const degraded = degradeBody(req.body, energyAvailable);
        if (!degraded) continue;
        body = degraded;
      } else {
        continue;
      }
    }

    // 检查 body 不超过容量上限。
    const capacity = spawn.room.energyCapacityAvailable;
    if (bodyCost(body) > capacity) {
      req.retries++;
      console.log(
        `[${Game.time}] spawn/${snapshot.roomName}: body exceeds capacity for ${req.key}`,
      );
      continue;
    }

    // 生成包含 spawnIndex 的唯一 creep 名以供追踪。
    const spawnIdx = req.memory.spawnIndex ?? 0;
    const name = `${req.role}-${snapshot.roomName}-${spawnIdx}-${Game.time}-${Math.random().toString(36).slice(2, 6)}`;

    const result = spawn.spawnCreep(body, name, {
      memory: { ...req.memory },
    });

    if (result === OK) {
      const queueIdx = queue.indexOf(req);
      if (queueIdx >= 0) queue.splice(queueIdx, 1);
      return;
    }

    if (result === ERR_BUSY) return;
    if (result === ERR_NOT_ENOUGH_ENERGY) continue;

    // 所有其他错误：递增重试次数并可能隔离。
    req.retries++;
    if (req.retries < CONFIG.spawn.maxRetries) {
      console.log(
        `[${Game.time}] spawn/${snapshot.roomName}: spawnCreep returned ${result} for ${req.key} (retry ${req.retries})`,
      );
    }
  }
}

/**
 * 适配层：从 Game.creeps 收集所有 creep 摘要。
 * 供纯函数 evaluateDemand 消费，避免领域层直接访问 Game。
 */
function collectCreepSummaries(): CreepSummary[] {
  const result: CreepSummary[] = [];
  for (const creep of Object.values(Game.creeps)) {
    result.push({
      name: creep.name,
      role: creep.memory.role ?? "unknown",
      home: creep.memory.home ?? creep.room.name,
      ticksToLive: creep.ticksToLive,
      bodyLength: creep.body.length,
      sourceId: creep.memory.sourceId,
      spawnIndex: creep.memory.spawnIndex,
    });
  }
  return result;
}

/**
 * 适配层：从 Game.spawns 收集正在孵化中的 creep 摘要。
 * 供纯函数 evaluateDemand 消费，避免领域层直接访问 Game/Memory。
 */
function collectSpawningSummaries(): SpawningSummary[] {
  const result: SpawningSummary[] = [];
  for (const spawn of Object.values(Game.spawns)) {
    const spawning = spawn.spawning;
    if (!spawning) continue;
    const mem = Memory.creeps[spawning.name];
    if (!mem) continue;
    result.push({
      name: spawning.name,
      role: mem.role ?? "unknown",
      home: mem.home ?? spawn.room.name,
    });
  }
  return result;
}
