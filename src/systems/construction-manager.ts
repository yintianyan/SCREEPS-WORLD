import { CONFIG } from "../config";
import type { Priority, System, TickContext, RoomSnapshot } from "../kernel/contracts";
import {
  syncTaskStates,
  cleanTasks,
  assessEmergencyRebuild,
  isEmergencyTask,
  type EmergencyRebuildStatus,
} from "../domain/construction/queue";

/**
 * 建造管理器 — 唯一创建建造 site 的模块。
 *
 * 职责：
 *   - 同步 BuildTask 状态与实际建造 site（委托 domain/construction/queue）
 *   - 强制执行每房和全局 site 限制
 *   - 应用开发门禁（在恢复状态或存在 P0/P1 缺口时不建造）
 *   - 全局每 tick 最多创建 1 个 site
 *
 * 纯逻辑已提取到 domain/construction/queue.ts，本模块只处理 Game API 调用。
 *
 * 优先级：P2（发展性工作 — 不能与生存竞争）。
 */
export const constructionManagerSystem: System = {
  name: "construction-manager",
  priority: 2 as Priority,
  interval: 1,
  run(ctx: TickContext): void {
    let normalCreatedThisTick = false;
    let emergencyCreatedThisTick = false;

    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      const queue = roomMem.buildQueue ?? [];

      // 1. 同步任务状态与实际 site（纯函数 — domain/construction/queue）。
      syncTaskStates(queue, snapshot);

      // 2. 清理完成 / 阻塞的任务（纯函数 — domain/construction/queue）。
      cleanTasks(queue, ctx.tick);

      // 3. 评估紧急重建状态。
      const emergency = assessEmergencyRebuild(snapshot);

      // 4. 检查开发门禁。
      if (!developmentGate(snapshot, ctx, emergency)) continue;

      // 5. 尝试从队列创建一个 site。
      // 紧急重建独立计额 — 允许每 tick 创建 1 个紧急 + 1 个普通 site，
      // 避免普通建造任务挤占关键基建重建窗口。
      if (emergency.any && !emergencyCreatedThisTick) {
        const created = tryCreateSite(queue, snapshot, emergency);
        if (created) emergencyCreatedThisTick = true;
      } else if (!normalCreatedThisTick) {
        const created = tryCreateSite(queue, snapshot, emergency);
        if (created) normalCreatedThisTick = true;
      }

      roomMem.buildQueue = queue;
    }
  },
};

/**
 * 开发门禁 — 创建任何新 site 前必须满足。
 * 返回 true 表示允许建造。
 *
 * 紧急重建（source container / tower / spawn / storage 缺失）豁免 economyPressure / budget /
 * P0 队列 / 能量门禁，但不豁免威胁检测 — 敌人脚下不建工地。
 */
function developmentGate(
  snapshot: RoomSnapshot,
  ctx: TickContext,
  emergency: EmergencyRebuildStatus,
): boolean {
  if (!emergency.any) {
    // 梯度门禁：用 economyPressure 替代二值 colonyState 开关。
    // pressure 0.0–0.3: 正常建造（基础阈值）
    // pressure 0.3–0.8: 线性提高能量阈值（从基础 → 90% 容量）
    // pressure > 0.8: 完全阻塞非紧急建造
    const pressure = Memory.rooms[snapshot.roomName]?.economyPressure ?? 0;
    if (pressure > 0.8) return false;
    if (ctx.budget.tier === "recovery" || ctx.budget.tier === "conserve") return false;
  }

  // 有威胁 creep 时不建造（过境 scout 不影响建造）。
  // 紧急重建也不豁免此条 — 敌人脚下建工地 = 送钱。
  if (snapshot.threatCreeps.length > 0) return false;

  if (!emergency.any) {
    // 检查 P0 孵化队列缺口 — 仅 P0（紧急恢复 worker）阻塞建造。
    const roomMem = Memory.rooms[snapshot.roomName];
    if (roomMem?.spawnQueue) {
      const hasEmergencySpawn = roomMem.spawnQueue.some(r => r.priority === 0);
      if (hasEmergencySpawn) return false;
    }

    // 检查能量盈余 — 梯度阈值：随 economyPressure 线性提高。
    // pressure 0.0–0.3: 基础阈值（容量 60%）
    // pressure 0.3–0.8: 线性提高到容量 90%
    const pressure = Memory.rooms[snapshot.roomName]?.economyPressure ?? 0;
    const baseRatio = 0.6;
    const maxRatio = 0.9;
    const ratio = pressure <= 0.3
      ? baseRatio
      : baseRatio + ((pressure - 0.3) / 0.5) * (maxRatio - baseRatio);
    const buildThreshold = Math.min(
      Math.floor(snapshot.energyCapacityAvailable * ratio),
      CONFIG.economy.buildEnergySurplus + CONFIG.spawn.recoveryEnergyReserve,
    );
    if (snapshot.energyAvailable < buildThreshold) return false;
  }

  // 全局 site 上限 — 紧急重建豁免自设限额（仍受游戏硬上限约束）。
  if (!emergency.any && ctx.globalSiteCount >= CONFIG.construction.maxGlobalSites) return false;

  return true;
}

/** 尝试从队列创建一个建造 site。成功创建返回 true。 */
function tryCreateSite(
  queue: BuildTask[],
  snapshot: RoomSnapshot,
  emergency: EmergencyRebuildStatus,
): boolean {
  // 按紧急重建 + 优先级排序：紧急任务排到最前，确保关键基建第一时间创建 site。
  const sorted = queue
    .filter(t => t.state === "queued" && Game.time >= t.retryAt)
    .sort((a, b) => {
      const aEmergency = isEmergencyTask(a, snapshot, emergency);
      const bEmergency = isEmergencyTask(b, snapshot, emergency);
      if (aEmergency !== bEmergency) return aEmergency ? -1 : 1;
      return a.priority - b.priority;
    });

  // 检查每房 site 限制。道路与 source container 单独计额，避免被 extension 永久挤占。
  const adjacentToSource = (x: number, y: number): boolean =>
    snapshot.sources.some(s => Math.abs(s.pos.x - x) <= 1 && Math.abs(s.pos.y - y) <= 1);
  const isSourceContainerSite = (s: ConstructionSite): boolean =>
    s.structureType === STRUCTURE_CONTAINER && adjacentToSource(s.pos.x, s.pos.y);

  const roadSites = snapshot.myConstructionSites.filter(
    s => s.structureType === STRUCTURE_ROAD,
  ).length;
  const sourceContainerSites = snapshot.myConstructionSites.filter(isSourceContainerSite).length;
  const normalSites = snapshot.myConstructionSites.filter(
    s =>
      s.structureType !== STRUCTURE_SPAWN &&
      s.structureType !== STRUCTURE_TOWER &&
      s.structureType !== STRUCTURE_ROAD &&
      !isSourceContainerSite(s),
  ).length;
  const criticalSites = snapshot.myConstructionSites.filter(
    s => s.structureType === STRUCTURE_TOWER || s.structureType === STRUCTURE_SPAWN,
  ).length;
  // storage 独立计额 — 不与 extension 竞争 normal 名额，也不与 tower/spawn 竞争 critical 名额。
  // storage 是单例结构（每房最多 1 个），独立计数避免被 3 个 extension site 永久挤占。
  const storageSites = snapshot.myConstructionSites.filter(
    s => s.structureType === STRUCTURE_STORAGE,
  ).length;

  for (const task of sorted) {
    const isCritical = task.structureType === STRUCTURE_TOWER || task.structureType === STRUCTURE_SPAWN;
    const isRoad = task.structureType === STRUCTURE_ROAD;
    const isStorage = task.structureType === STRUCTURE_STORAGE;
    const isSourceContainer =
      task.structureType === STRUCTURE_CONTAINER && adjacentToSource(task.pos.x, task.pos.y);

    // 检查每房限制。
    if (isCritical) {
      if (criticalSites >= CONFIG.construction.maxCriticalSitesPerRoom) continue;
    } else if (isStorage) {
      if (storageSites >= 1) continue;
    } else if (isRoad) {
      if (roadSites >= CONFIG.construction.maxRoadSitesPerRoom) continue;
    } else if (isSourceContainer) {
      if (sourceContainerSites >= CONFIG.construction.maxCriticalSitesPerRoom) continue;
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
      task.state = "blocked";
      task.attempts++;
      task.retryAt = Game.time + 100;
      continue;
    }

    if (result === ERR_RCL_NOT_ENOUGH) {
      task.retryAt = Game.time + 50;
      continue;
    }

    if (result === ERR_FULL) {
      task.retryAt = Game.time + 10;
      return false;
    }

    // 未知错误 — 指数退避。
    task.attempts++;
    task.retryAt = Game.time + Math.min(10 * Math.pow(2, task.attempts), 200);
  }

  return false;
}
