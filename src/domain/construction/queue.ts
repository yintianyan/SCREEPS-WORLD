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
      // 检查该位置是否已存在 site。
      if (sites.has(key)) {
        task.state = "site";
      } else {
        // 检查该位置是否已建成目标结构 — 避免 layout planner 反复重添已完成任务。
        const builtType = builtPositions.get(key);
        if (builtType === task.structureType) {
          task.state = "done";
        }
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
