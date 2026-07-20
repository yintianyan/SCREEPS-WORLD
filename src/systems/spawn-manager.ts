import { CONFIG } from "../config";
import { bodyCost, degradeBody, RECOVERY_BODY } from "../config/bodies";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { evaluateDemand } from "../domain/spawn/demand";
import { cleanQueue, sortQueue, submitRequest } from "../domain/spawn/queue";

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

      // 1. 评估需求并提交新请求。
      const { requests } = evaluateDemand(snapshot, queue, ctx.colonyState);
      for (const req of requests) {
        submitRequest(queue, req);
      }
      roomMem.spawnQueue = queue;

      // 2. 清理过期 / 隔离的请求。
      cleanQueue(queue, ctx.tick, CONFIG.spawn.maxRetries);

      // 3. 按优先级排序。
      sortQueue(queue);

      // 4. 尝试孵化最高优先级的请求。
      this.trySpawn(snapshot, queue, ctx);
    }
  },

  trySpawn(snapshot, queue, ctx) {
    if (queue.length === 0) return;
    if (snapshot.spawns.length === 0) return;

    // 查找可用 spawn。
    const spawn = snapshot.spawns.find(s => !s.spawning);
    if (!spawn) return; // 所有 spawn 忙 — 不是错误。

    // 如果有待处理的 P0 请求，不处理更低优先级的请求。
    // 计划 §5.4：P0 恢复暂停所有非 P0 孵化。
    const hasP0 = queue.some(r => r.priority === 0);

    // 按优先级顺序处理请求。
    for (const req of queue) {
      if (!req) continue;

      // P0 阻塞：如果存在 P0 请求但暂时无法满足，
      // 不孵化非 P0 creep。
      if (hasP0 && req.priority > 0) return;

      // 检查 body 是否有效。
      if (req.body.length === 0) {
        req.retries++;
        continue;
      }

      const cost = bodyCost(req.body);
      const energyAvailable = spawn.room.energyAvailable;

      // P0：降级 body 以适应当前能量（最小 [WORK, CARRY, MOVE]）。
      let body = req.body;
      if (cost > energyAvailable) {
        if (req.priority === 0) {
          const degraded = degradeBody(req.body, energyAvailable);
          if (!degraded) {
            // 连最小 body 也负担不起 — 等待。
            continue;
          }
          body = degraded;
        } else {
          // 非 P0：等待能量。
          continue;
        }
      }

      // 检查 body 不超过容量上限。
      const capacity = spawn.room.energyCapacityAvailable;
      if (bodyCost(body) > capacity) {
        // 配置错误 — 隔离。
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
        // 成功 — 从队列移除。
        const queueIdx = queue.indexOf(req);
        if (queueIdx >= 0) queue.splice(queueIdx, 1);
        return;
      }

      if (result === ERR_BUSY) {
        // Spawn 忙 — 不是错误，下一 tick 再试。
        return;
      }

      if (result === ERR_NOT_ENOUGH_ENERGY) {
        // 等待能量 — 不是错误。
        continue;
      }

      // 所有其他错误：递增重试次数并可能隔离。
      req.retries++;
      if (req.retries < CONFIG.spawn.maxRetries) {
        console.log(
          `[${Game.time}] spawn/${snapshot.roomName}: spawnCreep returned ${result} for ${req.key} (retry ${req.retries})`,
        );
      }
    }
  },
} as System & {
  trySpawn(
    snapshot: import("../kernel/contracts").RoomSnapshot,
    queue: SpawnRequest[],
    ctx: TickContext,
  ): void;
};
