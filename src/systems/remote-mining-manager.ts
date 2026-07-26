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

      // 收集远矿房威胁（有视野的 active 运营房）— evaluateRemoteDemand 据此
      // 生成 remoteDefender 请求；缺少此输入时 defender 分支永不触发。
      const remoteThreats = collectRemoteThreats(remoteOps);

      const { requests } = evaluateRemoteDemand({
        homeRoom: snapshot.roomName,
        colonyState,
        energyCapacityAvailable: snapshot.energyCapacityAvailable,
        tick: ctx.tick,
        remoteOps,
        remoteCreeps,
        spawnQueue: queue,
        remoteThreats,
      });

      // 推入 spawnQueue。
      for (const req of requests) {
        submitRequest(queue, req);
      }
      roomMem.spawnQueue = queue;

      // 5. 回收过量远矿 creep（超过配置上限的旧 creep 标记回收，节省 CPU）。
      recycleExcessRemoteCreeps(snapshot.roomName, remoteOps);
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

/**
 * 回收过量远矿 creep。
 *
 * 当某远矿目标的存活 creep 数超过配置上限时，标记最老的 creep 回收。
 * 回收标记由 spawn-manager 的 recyclePass 实际执行（spawn.recycleCreep）。
 * 只标记超额部分，保留配置上限数量的 creep 继续工作。
 */
function recycleExcessRemoteCreeps(
  homeRoom: string,
  remoteOps: Readonly<Record<string, RemoteOp>>,
): void {
  // 收集每个 active 目标的远矿 creep，按角色分组。
  const byTarget = new Map<string, { harvester: Creep[]; hauler: Creep[]; reserver: Creep[]; defender: Creep[] }>();

  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.home !== homeRoom) continue;
    if (creep.memory.recycle) continue; // 已标记回收的跳过。
    const target = creep.memory.remoteTarget;
    if (!target) continue;
    const op = remoteOps[target];
    if (!op || op.state !== "active") continue;

    let entry = byTarget.get(target);
    if (!entry) {
      entry = { harvester: [], hauler: [], reserver: [], defender: [] };
      byTarget.set(target, entry);
    }
    const role = creep.memory.role;
    if (role === "remoteHarvester") entry.harvester.push(creep);
    else if (role === "remoteHauler") entry.hauler.push(creep);
    else if (role === "reserver") entry.reserver.push(creep);
    else if (role === "remoteDefender") entry.defender.push(creep);
  }

  // 对每个目标，检查是否超额。
  for (const [, entry] of byTarget) {
    // harvester 超额：保留 harvestersPerTarget 个最年轻的，回收其余。
    if (entry.harvester.length > CONFIG.remote.harvestersPerTarget) {
      entry.harvester.sort((a, b) => (b.ticksToLive ?? 0) - (a.ticksToLive ?? 0));
      for (let i = CONFIG.remote.harvestersPerTarget; i < entry.harvester.length; i++) {
        entry.harvester[i]!.memory.recycle = true;
      }
    }
    // hauler 超额。
    if (entry.hauler.length > CONFIG.remote.haulersPerTarget) {
      entry.hauler.sort((a, b) => (b.ticksToLive ?? 0) - (a.ticksToLive ?? 0));
      for (let i = CONFIG.remote.haulersPerTarget; i < entry.hauler.length; i++) {
        entry.hauler[i]!.memory.recycle = true;
      }
    }
    // reserver 超额（目标 1 个）。
    if (entry.reserver.length > 1) {
      entry.reserver.sort((a, b) => (b.ticksToLive ?? 0) - (a.ticksToLive ?? 0));
      for (let i = 1; i < entry.reserver.length; i++) {
        entry.reserver[i]!.memory.recycle = true;
      }
    }
    // defender 超额（目标 1 个 — 威胁清除后多余的 defender 回收）。
    if (entry.defender.length > 1) {
      entry.defender.sort((a, b) => (b.ticksToLive ?? 0) - (a.ticksToLive ?? 0));
      for (let i = 1; i < entry.defender.length; i++) {
        entry.defender[i]!.memory.recycle = true;
      }
    }
  }
}

/** 收集归属于本房的所有远矿 creep 摘要。 */
function collectRemoteCreeps(homeRoom: string): RemoteCreepSummary[] {
  const result: RemoteCreepSummary[] = [];
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.home !== homeRoom) continue;
    const role = creep.memory.role ?? "unknown";
    // 只收集远矿角色。
    if (role !== "remoteHarvester" && role !== "remoteHauler" && role !== "reserver" && role !== "remoteDefender") {
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

/**
 * 收集远矿房威胁信息 — 检测 active 运营的远矿房是否有 hostile creep。
 * 用于触发 remoteDefender 孵化需求。
 */
function collectRemoteThreats(remoteOps: Readonly<Record<string, RemoteOp>>): Record<string, boolean> {
  const threats: Record<string, boolean> = {};
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const room = Game.rooms[roomName];
    if (!room) continue;
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
      filter: (c) => {
        const allies = CONFIG.defense.allies;
        return !allies.includes(c.owner.username);
      },
    });
    threats[roomName] = hostiles.length > 0;
  }
  return threats;
}
