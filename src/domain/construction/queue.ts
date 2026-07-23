/**
 * 建造队列域模块 — BuildTask 状态同步与清理的纯函数。
 *
 * 这些函数从 construction-manager（系统层）提取，使队列管理逻辑可独立测试。
 * construction-manager 负责调用 Game API（createConstructionSite），
 * 本模块只操作 BuildTask[] 数据结构 + 从 RoomSnapshot 读取的只读数据。
 */

import type { RoomSnapshot } from "../../kernel/contracts";

/** 建造任务状态同步所需的已建结构摘要。 */
interface StructurePosRef {
  readonly pos: { readonly x: number; readonly y: number };
  readonly structureType: string;
}

/**
 * 同步 BuildTask 状态与房间内实际建造 site 和已建结构。
 *
 * 状态转换规则：
 *   queued + site 存在      → site
 *   queued + 结构已建成     → done
 *   site  + site 消失       → done（已建成）或 queued（被毁）
 *
 * 纯函数 — 不访问 Game/Memory，所有数据由参数传入。
 */
export function syncTaskStates(
  queue: BuildTask[],
  snapshot: RoomSnapshot,
): void {
  // 按位置 → site 映射，用于 queued→site 转换。
  // 注意：同一位置只可能有一个 site，但不同结构类型的任务可能指向同一位置。
  // 下面的匹配会额外检查 structureType，防止误匹配。
  const sites = new Map<string, ConstructionSite>();
  for (const site of snapshot.myConstructionSites) {
    sites.set(`${site.pos.x},${site.pos.y}`, site);
  }

  // 预构建已建成结构的位置 → 类型映射，避免 lookForAt 调用。
  const builtPositions = new Map<string, string>();
  const builtStructures: StructurePosRef[] = [
    ...snapshot.spawns,
    ...snapshot.extensions,
    ...snapshot.towers,
    ...snapshot.containers,
    ...snapshot.links,
  ];
  if (snapshot.storage) {
    builtStructures.push(snapshot.storage);
  }
  for (const s of builtStructures) {
    builtPositions.set(`${s.pos.x},${s.pos.y}`, s.structureType);
  }

  for (const task of queue) {
    const key = `${task.pos.x},${task.pos.y}`;
    if (task.state === "queued") {
      // 检查该位置是否存在**匹配结构类型**的 site。
      // P0 修复：旧实现只检查位置不检查类型，导致 storage 的 site 被误匹配给
      // 同位置的 extension 任务，extension 永远不会变成 site 也不会被创建。
      const site = sites.get(key);
      if (site && site.structureType === task.structureType) {
        task.state = "site";
      } else {
        // 检查该位置是否已建成目标结构 — 避免 layout planner 反复重添已完成任务。
        const builtType = builtPositions.get(key);
        if (builtType === task.structureType) {
          task.state = "done";
        }
      }
    } else if (task.state === "site") {
      // 检查 site 是否消失（完成或被毁）或类型不匹配。
      const site = sites.get(key);
      if (!site || site.structureType !== task.structureType) {
        // 从快照结构数据检查是否已建成，避免 lookForAt。
        const builtType = builtPositions.get(key);
        task.state = builtType === task.structureType ? "done" : "queued";
      }
    }
  }
}

/**
 * 移除已完成任务和过期阻塞任务。
 *
 * 清理规则：
 *   done                      → 删除（已完成，无需保留）
 *   blocked + attempts >= 3   → 删除（永久冲突，避免内存泄漏）
 *   blocked + retryAt 过期    → 转回 queued（保留 attempts 历史）
 *
 * 纯函数 — 只操作 queue 数据结构 + tick 参数。
 */
export function cleanTasks(queue: BuildTask[], tick: number): void {
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
 * 检查是否有 source 缺少 container（且无在建 container site）—— 需要紧急重建。
 *
 * 缺失 source container 时该 source 的 harvester 只能长途送能到 spawn，经济瘫痪，
 * 必须允许在低能量/恢复状态下重建，否则陷入「能量低→不建造→无法重建→能量更低」死锁。
 *
 * 纯函数 — 从 snapshot 读取只读数据。
 */
export function needsSourceContainerRebuild(
  snapshot: RoomSnapshot,
): boolean {
  const adjacentContainer = (x: number, y: number): boolean =>
    snapshot.containers.some(c => Math.abs(c.pos.x - x) <= 1 && Math.abs(c.pos.y - y) <= 1);
  const adjacentContainerSite = (x: number, y: number): boolean =>
    snapshot.constructionSites.some(
      s => s.structureType === STRUCTURE_CONTAINER && Math.abs(s.pos.x - x) <= 1 && Math.abs(s.pos.y - y) <= 1,
    );
  return snapshot.sources.some(
    s => !adjacentContainer(s.pos.x, s.pos.y) && !adjacentContainerSite(s.pos.x, s.pos.y),
  );
}

/**
 * 紧急重建状态 — 检测关键基建缺失情况。
 *
 * 三类关键结构被毁时触发紧急重建路径：
 *   - sourceContainer: harvester 无法高效存能，经济链路断裂
 *   - tower: RCL3+ 房间无塔 = 无防御纵深，被拆只是时间问题
 *   - spawn: 无法孵化新 creep，人口只减不增
 *
 * 紧急状态触发三件事（在 construction-manager 和 layout-planner 中消费）：
 *   1. developmentGate 豁免 economyPressure / budget / P0 队列 / 能量门禁
 *   2. shouldPlan 立即触发规划（不等 50 tick 周期）
 *   3. tryCreateSite 排序加权 — 紧急任务排到队列最前
 *
 * 纯函数 — 从 snapshot 读取只读数据，不访问 Game/Memory。
 */
export interface EmergencyRebuildStatus {
  /** Source container 缺失 — harvester 无法就地存能。 */
  readonly sourceContainer: boolean;
  /** Tower 缺失（RCL3+ 已解锁但无塔）— 防御真空。 */
  readonly tower: boolean;
  /** Spawn 缺失 — 无法孵化，人口只减不增。 */
  readonly spawn: boolean;
  /** 任一关键结构缺失。 */
  readonly any: boolean;
}

/**
 * 评估房间的紧急重建需求。
 *
 * 注意：spawn 缺失在初始 bootstrap 时也是 true（房间刚建立还没有 spawn）。
 * 调用方应结合 layout.anchor 是否已设置来区分「从未建造」与「被毁重建」。
 * construction-manager 的 developmentGate 不做此区分 —— 无论初始还是重建，
 * 缺 spawn 时都必须豁免门禁以尽快恢复。
 *
 * 纯函数 — 从 snapshot 读取只读数据。
 */
export function assessEmergencyRebuild(
  snapshot: RoomSnapshot,
): EmergencyRebuildStatus {
  const sourceContainer = needsSourceContainerRebuild(snapshot);
  // RCL3 才解锁 tower；RCL < 3 时无塔是正常的，不算紧急。
  const tower = snapshot.rcl >= 3 && snapshot.towers.length === 0;
  // spawn 缺失 = 无法孵化，最严重的紧急状态。
  const spawn = snapshot.spawns.length === 0;
  return {
    sourceContainer,
    tower,
    spawn,
    any: sourceContainer || tower || spawn,
  };
}

/**
 * 判断一个 BuildTask 是否属于紧急重建任务。
 *
 * 用于 tryCreateSite 排序加权：紧急任务排到队列最前，
 * 确保关键基建在被毁后第一时间创建 site。
 *
 * 纯函数 — 从 task + snapshot + emergency 状态推断。
 */
export function isEmergencyTask(
  task: BuildTask,
  snapshot: RoomSnapshot,
  emergency: EmergencyRebuildStatus,
): boolean {
  if (emergency.tower && task.structureType === STRUCTURE_TOWER) return true;
  if (emergency.spawn && task.structureType === STRUCTURE_SPAWN) return true;
  if (emergency.sourceContainer && task.structureType === STRUCTURE_CONTAINER) {
    // 仅 source 旁的 container 才算紧急 — controller container 不在此列。
    return snapshot.sources.some(
      s => Math.abs(s.pos.x - task.pos.x) <= 1 && Math.abs(s.pos.y - task.pos.y) <= 1,
    );
  }
  return false;
}
