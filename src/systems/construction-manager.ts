import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { generateBuildTasks } from "../domain/construction/queue";

/**
 * 建造管理器 — 唯一创建建造 site 的模块。
 *
 * 职责：
 *   - 同步 BuildTask 状态与实际建造 site
 *   - 强制执行每房和全局 site 限制
 *   - 应用开发门禁（在恢复状态或存在 P0/P1 缺口时不建造）
 *   - 全局每 tick 最多创建 1 个 site
 *
 * 优先级：P2（发展性工作 — 不能与生存竞争）。
 */
export const constructionManagerSystem: System = {
  name: "construction-manager",
  priority: 2 as Priority,
  interval: 1,
  run(ctx: TickContext): void {
    let createdThisTick = false;

    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      const queue = roomMem.buildQueue ?? [];

      // 1. 同步任务状态与实际 site。
      syncTaskStates(queue, snapshot);

      // 2. 队列快空时生成新任务（低频）。
      if (shouldGenerateTasks(snapshot, ctx.tick)) {
        const newTasks = generateBuildTasks(snapshot);
        for (const task of newTasks) {
          if (!queue.some(t => t.key === task.key)) {
            queue.push(task);
          }
        }
      }

      // 3. 清理完成 / 阻塞的任务。
      cleanTasks(queue, ctx.tick);

      // 4. 检查开发门禁。
      if (!developmentGate(snapshot, ctx)) continue;

      // 5. 尝试从队列创建一个 site。
      if (!createdThisTick) {
        const created = tryCreateSite(queue, snapshot);
        if (created) createdThisTick = true;
      }

      roomMem.buildQueue = queue;
    }
  },
};

/** 同步 BuildTask 状态与房间内实际建造 site。 */
function syncTaskStates(queue: BuildTask[], snapshot: import("../kernel/contracts").RoomSnapshot): void {
  const sites = new Map<string, ConstructionSite>();
  for (const site of snapshot.myConstructionSites) {
    sites.set(`${site.pos.x},${site.pos.y}`, site);
  }

  // 预构建已建成结构的位置 → 类型映射，避免 lookForAt 调用。
  const builtPositions = new Map<string, string>();
  for (const s of [...snapshot.spawns, ...snapshot.extensions, ...snapshot.towers, ...snapshot.containers]) {
    builtPositions.set(`${s.pos.x},${s.pos.y}`, s.structureType);
  }
  if (snapshot.storage) {
    builtPositions.set(`${snapshot.storage.pos.x},${snapshot.storage.pos.y}`, STRUCTURE_STORAGE);
  }

  for (const task of queue) {
    const key = `${task.pos.x},${task.pos.y}`;
    if (task.state === "queued") {
      // 检查该位置是否已存在 site。
      if (sites.has(key)) {
        task.state = "site";
      }
    } else if (task.state === "site") {
      // 检查 site 是否消失（完成或被毁）。
      if (!sites.has(key)) {
        // 从快照结构数据检查是否已建成，避免 lookForAt。
        const builtType = builtPositions.get(key);
        task.state = builtType === task.structureType ? "done" : "queued";
      }
    }
  }
}

/** 判断本 tick 是否应生成新建造任务（低频 + RCL 变化触发）。 */
function shouldGenerateTasks(snapshot: import("../kernel/contracts").RoomSnapshot, tick: number): boolean {
  // 每 25 tick 或 RCL 变化时生成。
  if (tick % 25 === 0) return true;
  const roomMem = Memory.rooms[snapshot.roomName];
  if (!roomMem) return false;
  if (roomMem.lastRcl !== undefined && roomMem.lastRcl !== snapshot.rcl) {
    roomMem.lastRcl = snapshot.rcl;
    return true;
  }
  roomMem.lastRcl = snapshot.rcl;
  return false;
}

/** 移除已完成任务和过期阻塞任务。 */
function cleanTasks(queue: BuildTask[], tick: number): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    const task = queue[i];
    if (!task) continue;
    if (task.state === "done") {
      queue.splice(i, 1);
      continue;
    }
    if (task.state === "blocked") {
      // 超过 3 次重试的永久冲突任务直接删除，避免内存泄漏。
      if (task.attempts >= 3) {
        queue.splice(i, 1);
        continue;
      }
      if (tick > task.retryAt) {
        task.state = "queued";
        // 注意：不重置 attempts，保留失败历史以达上限后删除。
      }
    }
  }
}

/**
 * 开发门禁 — 创建任何新 site 前必须满足。
 * 返回 true 表示允许建造。
 */
function developmentGate(
  snapshot: import("../kernel/contracts").RoomSnapshot,
  ctx: TickContext,
): boolean {
  // 恢复或启动期不建造。
  if (ctx.colonyState === "recovery" || ctx.colonyState === "bootstrap") return false;
  if (ctx.budget.tier === "recovery" || ctx.budget.tier === "conserve") return false;

  // 有敌对 creep 时不建造。
  if (snapshot.hostileCreeps.length > 0) return false;

  // 检查 P0/P1 孵化队列缺口。
  const roomMem = Memory.rooms[snapshot.roomName];
  if (roomMem?.spawnQueue) {
    const hasCriticalSpawn = roomMem.spawnQueue.some(r => r.priority <= 1);
    if (hasCriticalSpawn) return false;
  }

  // 检查能量盈余 + 预留恢复能量。
  if (snapshot.energyAvailable < CONFIG.economy.buildEnergySurplus + CONFIG.spawn.recoveryEnergyReserve) return false;

  // 使用已构建快照检查全局 site 限制（无 room.find 扫描）。
  let globalSites = 0;
  for (const snap of ctx.snapshots()) {
    globalSites += snap.myConstructionSites.length;
  }
  if (globalSites >= CONFIG.construction.maxGlobalSites) return false;

  return true;
}

/** 尝试从队列创建一个建造 site。成功创建返回 true。 */
function tryCreateSite(
  queue: BuildTask[],
  snapshot: import("../kernel/contracts").RoomSnapshot,
): boolean {
  // 按优先级排序。
  // filter 已返回新数组，无需额外 spread 复制。
  const sorted = queue
    .filter(t => t.state === "queued" && Game.time >= t.retryAt)
    .sort((a, b) => a.priority - b.priority);

  // 检查每房 site 限制。
  const normalSites = snapshot.myConstructionSites.filter(
    s => s.structureType !== STRUCTURE_SPAWN && s.structureType !== STRUCTURE_TOWER,
  ).length;
  const criticalSites = snapshot.myConstructionSites.filter(
    s => s.structureType === STRUCTURE_TOWER || s.structureType === STRUCTURE_SPAWN,
  ).length;

  for (const task of sorted) {
    const isCritical = task.structureType === STRUCTURE_TOWER || task.structureType === STRUCTURE_SPAWN;

    // 检查每房限制。
    if (isCritical) {
      if (criticalSites >= CONFIG.construction.maxCriticalSitesPerRoom) continue;
    } else {
      if (normalSites >= CONFIG.construction.maxNormalSitesPerRoom) continue;
    }

    // 尝试创建 site。
    const room = Game.rooms[task.pos.roomName];
    if (!room) continue;

    const result = room.createConstructionSite(task.pos.x, task.pos.y, task.structureType);

    if (result === OK) {
      task.state = "site";
      task.attempts = 0;
      return true;
    }

    if (result === ERR_INVALID_TARGET) {
      // 地形冲突或已占用 — 标记为阻塞并长冷却。
      task.state = "blocked";
      task.attempts++;
      task.retryAt = Game.time + 100;
      continue;
    }

    if (result === ERR_RCL_NOT_ENOUGH) {
      // RCL 太低 — 保持队列，RCL 提升后重试。
      task.retryAt = Game.time + 50;
      continue;
    }

    if (result === ERR_FULL) {
      // 全局 site 太多 — 等待。
      task.retryAt = Game.time + 10;
      return false;
    }

    // 未知错误 — 指数退避。
    task.attempts++;
    task.retryAt = Game.time + Math.min(10 * Math.pow(2, task.attempts), 200);
  }

  return false;
}
