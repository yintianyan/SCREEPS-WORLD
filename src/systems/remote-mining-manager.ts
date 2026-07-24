/**
 * Remote Mining Manager — P2 系统，远矿运营的中央调度器。
 *
 * 职责：
 *   - 从 RoomMemory.intel 评选远矿目标（selectRemoteTargets）
 *   - 创建/更新 RoomMemory.remoteOps 状态
 *   - 评估远矿 spawn 需求（evaluateRemoteDemand）
 *   - 将远矿请求推入 spawnQueue
 *   - 暂停过期运营、清理废弃运营
 *
 * 数据流：
 *   room-observer（每 50 tick 采集 intel）
 *     → remote-mining-manager（每 10 tick 评估）
 *       → selectRemoteTargets（纯函数筛选候选）
 *       → evaluateRemoteDemand（纯函数生成请求）
 *       → spawnQueue（推入请求）
 *         → spawn-manager（孵化执行）
 *
 * 优先级：P2 — 远矿是扩张行为，不阻塞本房经济。
 * 间隔：10 tick — 平衡响应速度与 CPU 开销。
 *
 * 安全门禁：
 *   - colonyState 非 normal 时暂停新远矿孵化
 *   - CPU tier conserve 以下不孵化远矿
 *   - RCL < minRcl 时不启动远矿
 *   - 远矿目标数不超过 maxOperations
 */
import { CONFIG } from "../config";
import type { Priority, System, TickContext, ColonyState } from "../kernel/contracts";
import { selectRemoteTargets, shouldPauseOperation } from "../domain/remote/targeting";
import { evaluateRemoteDemand, type RemoteCreepSummary } from "../domain/remote/demand";
import { submitRequest } from "../domain/spawn/queue";

export const remoteMiningManagerSystem: System = {
  name: "remote-mining-manager",
  priority: 2 as Priority,
  interval: CONFIG.remote.managerInterval,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      // RCL 门禁：低于 minRcl 不启动远矿。
      if (snapshot.rcl < CONFIG.remote.minRcl) continue;

      const remoteOps = roomMem.remoteOps ?? {};

      // 1. 评估现有运营：暂停过期、清理废弃。
      maintainExistingOps(remoteOps, ctx.tick);

      // 2. 如果 active 运营数不足，从 intel 评选新目标。
      const activeCount = countActiveOps(remoteOps);
      if (activeCount < CONFIG.remote.maxOperations) {
        const candidates = selectRemoteTargets({
          homeRoom: snapshot.roomName,
          intel: roomMem.intel,
          existingOps: remoteOps,
          tick: ctx.tick,
          staleThreshold: CONFIG.remote.staleThreshold,
        });
        // 只补充到 maxOperations。
        const needed = CONFIG.remote.maxOperations - activeCount;
        for (let i = 0; i < Math.min(needed, candidates.length); i++) {
          const candidate = candidates[i]!;
          remoteOps[candidate.roomName] = {
            state: "active",
            sources: candidate.sources,
            createdAt: ctx.tick,
            lastSeen: ctx.tick,
          };
        }
      }

      // 3. 更新 remoteOps 到 Memory。
      if (Object.keys(remoteOps).length > 0) {
        roomMem.remoteOps = remoteOps;
      }

      // 4. 评估远矿 spawn 需求。
      const colonyState: ColonyState = roomMem.colonyState ?? "normal";
      const queue = roomMem.spawnQueue ?? [];

      // 收集远矿 creep 摘要（从 Game.creeps 遍历一次）。
      const remoteCreeps = collectRemoteCreeps(snapshot.roomName);

      const { requests } = evaluateRemoteDemand({
        homeRoom: snapshot.roomName,
        colonyState,
        energyCapacityAvailable: snapshot.energyCapacityAvailable,
        tick: ctx.tick,
        remoteOps,
        remoteCreeps,
        spawnQueue: queue,
      });

      // 推入 spawnQueue。
      for (const req of requests) {
        submitRequest(queue, req);
      }
      roomMem.spawnQueue = queue;
    }
  },
};

/**
 * 维护现有远矿运营：暂停过期运营、更新 lastSeen、清理废弃。
 */
function maintainExistingOps(
  remoteOps: Record<string, RemoteOp>,
  tick: number,
): void {
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state === "abandoned") continue;

    // 检查是否有 creep 在该远矿房（有则更新 lastSeen）。
    const hasCreep = hasCreepInRoom(roomName);
    if (hasCreep) {
      op.lastSeen = tick;
    }

    // 过期暂停。
    if (shouldPauseOperation(op, tick, CONFIG.remote.staleThreshold)) {
      if (op.state === "active") {
        op.state = "paused";
      }
    } else if (op.state === "paused") {
      // 恢复：有新视野或 creep 到达时恢复 active。
      if (hasCreep) {
        op.state = "active";
        op.lastSeen = tick;
      }
    }
  }

  // 清理长期废弃的运营（超过 staleThreshold * 3 且无 creep）。
  const abandonThreshold = CONFIG.remote.staleThreshold * 3;
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state === "paused" && tick - op.lastSeen > abandonThreshold) {
      op.state = "abandoned";
    }
  }

  // 清理 abandoned 超过 10000 tick 的记录（防止 Memory 膨胀）。
  const cleanupThreshold = CONFIG.remote.staleThreshold * 6;
  for (const roomName of Object.keys(remoteOps)) {
    const op = remoteOps[roomName]!;
    if (op.state === "abandoned" && tick - op.lastSeen > cleanupThreshold) {
      delete remoteOps[roomName];
    }
  }
}

/** 统计 active 状态的运营数。 */
function countActiveOps(remoteOps: Readonly<Record<string, RemoteOp>>): number {
  let count = 0;
  for (const op of Object.values(remoteOps)) {
    if (op.state === "active") count++;
  }
  return count;
}

/** 检查是否有 creep 在指定房间（通过 Game.rooms 判断可见性 + creep 存在）。 */
function hasCreepInRoom(roomName: string): boolean {
  const room = Game.rooms[roomName];
  if (!room) return false;
  // 检查是否有自己的 creep 在该房间。
  return Object.values(Game.creeps).some(
    (c) => c.room.name === roomName && c.my,
  );
}

/** 收集归属于本房的所有远矿 creep 摘要。 */
function collectRemoteCreeps(homeRoom: string): RemoteCreepSummary[] {
  const result: RemoteCreepSummary[] = [];
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.home !== homeRoom) continue;
    const role = creep.memory.role ?? "unknown";
    // 只收集远矿角色。
    if (role !== "remoteHarvester" && role !== "remoteHauler" && role !== "reserver") {
      continue;
    }
    result.push({
      name: creep.name,
      role,
      remoteTarget: creep.memory.remoteTarget,
      ticksToLive: creep.ticksToLive,
      bodyLength: creep.body.length,
    });
  }
  return result;
}
