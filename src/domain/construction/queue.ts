/**
 * 建造队列域模块 — BuildTask 状态同步与清理的纯函数。从 construction-manager
 * （系统层，负责 Game API）提取，使队列管理逻辑可独立测试；本模块只操作
 * BuildTask[] 数据结构 + RoomSnapshot 只读数据。
 */

import type { RoomSnapshot } from "../../kernel/contracts";

/** 建造任务状态同步所需的已建结构摘要。 */
interface StructurePosRef {
  readonly pos: { readonly x: number; readonly y: number };
  readonly structureType: string;
}

/**
 * 同步 BuildTask 状态与房间内实际建造 site 和已建结构：queued + site 存在 → site；
 * queued + 结构已建成 → done；site + site 消失 → done（已建成）或 queued（被毁）。
 * 纯函数 — 不访问 Game/Memory，所有数据由参数传入。
 */
export function syncTaskStates(
  queue: BuildTask[],
  snapshot: RoomSnapshot,
): void {
  // 位置 → site 映射，用于 queued→site 转换。
  // 注意：同一位置只可能有一个 site，但不同结构类型的任务可能指向同一位置，
  // 匹配时额外检查 structureType，防止误匹配。
  const sites = new Map<string, ConstructionSite>();
  for (const site of snapshot.myConstructionSites) {
    sites.set(`${site.pos.x},${site.pos.y}`, site);
  }

  // 预构建已建成结构的「位置:类型」集合，避免 lookForAt 调用。
  // 两个要点（幽灵任务循环的根因修复）：
  //   1. 必须含 rampart/wall/road/lab 等全部可入队类型 — 缺谁，谁的任务
  //      建成后就永远无法转 done，而是 site 消失 → 回退 queued → 重复建
  //      site 失败 → blocked → purge → 规划器再生成，无限 churn。
  //   2. key 必须带结构类型 — rampart 与建筑共格（core rampart 覆盖正是
  //      这么设计的），pos→单类型映射会让两者互相覆盖、判定失真。
  const builtPositions = new Set<string>();
  const builtStructures: StructurePosRef[] = [
    ...snapshot.spawns,
    ...snapshot.extensions,
    ...snapshot.towers,
    ...snapshot.containers,
    ...snapshot.links,
    ...snapshot.ramparts,
    ...snapshot.walls,
    ...snapshot.roads,
    ...snapshot.labs,
  ];
  if (snapshot.storage) {
    builtStructures.push(snapshot.storage);
  }
  if (snapshot.terminal) {
    builtStructures.push(snapshot.terminal);
  }
  if (snapshot.extractor) {
    builtStructures.push(snapshot.extractor);
  }
  if (snapshot.factory) {
    builtStructures.push(snapshot.factory);
  }
  if (snapshot.observer) {
    builtStructures.push(snapshot.observer);
  }
  if (snapshot.powerSpawn) {
    builtStructures.push(snapshot.powerSpawn);
  }
  if (snapshot.nuker) {
    builtStructures.push(snapshot.nuker);
  }
  for (const s of builtStructures) {
    builtPositions.add(`${s.pos.x},${s.pos.y}:${s.structureType}`);
  }

  // 类型饱和判定 — 幽灵任务的唯一出口。
  // 布局代际漂移的遗留任务坐标为空、同类结构已在其他坐标建满当前 RCL 配额：
  // 逐格判定永远不会转 done，createConstructionSite 只会返回 ERR_RCL_NOT_ENOUGH
  // （瞬态重试语义，不 blocked 不进黑名单）→ 任务永久 queued 空转。
  // 危害三重：承诺计数虚高压制真实补建、RCL 升级瞬间在过时坐标真的建出结构、
  // Memory 常驻泄漏。饱和的类型直接转 done 清除 — RCL 提升产生真实缺口时，
  // 规划器按当前布局重新生成任务，队列不需要囤积过时坐标。
  // 结构被毁则计数下降、判定自动解除，不影响紧急重建路径。
  const builtCountByType = new Map<string, number>();
  for (const s of builtStructures) {
    builtCountByType.set(s.structureType, (builtCountByType.get(s.structureType) ?? 0) + 1);
  }
  const typeSaturated = (type: string): boolean => {
    const max = CONTROLLER_STRUCTURES[type as BuildableStructureConstant]?.[snapshot.rcl];
    if (max === undefined) return false;
    return (builtCountByType.get(type) ?? 0) >= max;
  };

  for (const task of queue) {
    const key = `${task.pos.x},${task.pos.y}`;
    const builtKey = `${key}:${task.structureType}`;
    if (task.state === "queued") {
      // 检查该位置是否存在**匹配结构类型**的 site。
      // 位置匹配必须检查类型：storage 的 site 若被误匹配给同位置的 extension
      // 任务，extension 永远不会变成 site 也不会被创建。
      const site = sites.get(key);
      if (site && site.structureType === task.structureType) {
        task.state = "site";
      } else if (builtPositions.has(builtKey)) {
        // 该位置已建成目标结构 — 避免 layout planner 反复重添已完成任务。
        task.state = "done";
      } else if (typeSaturated(task.structureType)) {
        // 同类结构已在其他坐标建满配额 — 本任务是漂移遗留的幽灵，转 done 清除。
        task.state = "done";
      }
    } else if (task.state === "site") {
      // 检查 site 是否消失（完成或被毁）或类型不匹配。
      const site = sites.get(key);
      if (!site || site.structureType !== task.structureType) {
        // 从快照结构数据检查是否已建成，避免 lookForAt。
        task.state = builtPositions.has(builtKey) ? "done" : "queued";
      }
    }
  }
}

/**
 * 移除已完成任务和过期阻塞任务：done → 删除；blocked + attempts>=3 → 删除
 * （永久冲突，防内存泄漏）；blocked + retryAt 过期 → 转回 queued（保留 attempts）。
 * 返回被删除的永久冲突任务 key 列表 — 调用方应记入阻塞黑名单，否则规划器会
 * 按同 key 重新入队，形成「入队 → blocked → 删除 → 再入队」无限空转。
 */
export function cleanTasks(queue: BuildTask[], tick: number): string[] {
  const purgedKeys: string[] = [];
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
        purgedKeys.push(task.key);
        queue.splice(i, 1);
        continue;
      }
      if (tick > task.retryAt) {
        task.state = "queued";
        // 注意：不重置 attempts，保留失败历史以达上限后删除。
      }
    }
  }
  return purgedKeys;
}

/**
 * 检查是否有 source 缺少 container（且无在建 site）— 需紧急重建。
 * 缺失时 harvester 只能长途送能到 spawn，经济瘫痪；必须允许低能量/恢复状态下
 * 重建，否则陷入「能量低→不建造→无法重建→能量更低」死锁。
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
 * 紧急重建状态 — 检测关键基建缺失：sourceContainer（harvester 无法就地存能）、
 * tower（RCL3+ 无塔 = 无防御纵深）、spawn（无法孵化）、storage（RCL4+ 无中央
 * 能量源）。紧急状态触发（construction-manager / layout-planner 消费）：
 * developmentGate 豁免 economyPressure/budget/能量门禁、shouldPlan 立即触发
 * （不等 50 tick 周期）、tryCreateSite 排序加权排到队首。
 */
export interface EmergencyRebuildStatus {
  /** Source container 缺失 — harvester 无法就地存能。 */
  readonly sourceContainer: boolean;
  /** Tower 缺失（RCL3+ 已解锁但无塔）— 防御真空。 */
  readonly tower: boolean;
  /** Spawn 缺失 — 无法孵化，人口只减不增。 */
  readonly spawn: boolean;
  /** Storage 缺失（RCL4+ 已解锁但无 storage）— 经济中枢断裂。 */
  readonly storage: boolean;

  readonly any: boolean;
}

/**
 * 评估房间的紧急重建需求。注意：spawn 缺失在初始 bootstrap 时也是 true —
 * 调用方应结合 layout.anchor 是否已设置区分「从未建造」与「被毁重建」；
 * construction-manager 的 developmentGate 不做此区分 — 缺 spawn 时无论初始
 * 还是重建都必须豁免门禁尽快恢复。
 */
export function assessEmergencyRebuild(
  snapshot: RoomSnapshot,
): EmergencyRebuildStatus {
  const sourceContainer = needsSourceContainerRebuild(snapshot);
  // RCL3 才解锁 tower；RCL < 3 时无塔是正常的，不算紧急。
  const tower = snapshot.rcl >= 3 && snapshot.towers.length === 0;
  // spawn 缺失 = 无法孵化，最严重的紧急状态。
  const spawn = snapshot.spawns.length === 0;
  // RCL4 才解锁 storage；RCL < 4 时无 storage 是正常的，不算紧急。
  // storage 被毁 = hauler 无处倒能 + builder/upgrader 无中央能量源 → 经济死循环。
  const storage = snapshot.rcl >= 4 && snapshot.storage === undefined;
  return {
    sourceContainer,
    tower,
    spawn,
    storage,
    any: sourceContainer || tower || spawn || storage,
  };
}

/**
 * 判断 BuildTask 是否属紧急重建任务 — 用于 tryCreateSite 排序加权，
 * 确保关键基建被毁后第一时间创建 site。
 */
export function isEmergencyTask(
  task: BuildTask,
  snapshot: RoomSnapshot,
  emergency: EmergencyRebuildStatus,
): boolean {
  if (emergency.tower && task.structureType === STRUCTURE_TOWER) return true;
  if (emergency.spawn && task.structureType === STRUCTURE_SPAWN) return true;
  if (emergency.storage && task.structureType === STRUCTURE_STORAGE) return true;
  if (emergency.sourceContainer && task.structureType === STRUCTURE_CONTAINER) {
    // 仅 source 旁的 container 才算紧急 — controller container 不在此列。
    return snapshot.sources.some(
      s => Math.abs(s.pos.x - task.pos.x) <= 1 && Math.abs(s.pos.y - task.pos.y) <= 1,
    );
  }
  return false;
}

/**
 * 检测是否有房间的 buildQueue 存在 P0 queued 的关键基建任务（storage/tower/spawn）
 * — 这类结构缺失时经济链路断裂，必须让 construction-manager 在任何 budget tier
 * 下都能运行（以 P1 等效优先级）。P1-F：从 kernel.ts 搬来，作为 recoveryEligible
 * 钩子实现 — kernel 只读钩子不识系统名（docs/architecture/KERNEL_ARCHITECTURE.md）。
 */
export function hasCriticalStructureGap(
  rooms: Record<string, { buildQueue?: Array<{ priority: number; state: string; structureType: string }> } | undefined>,
): boolean {
  return Object.values(rooms).some(
    r => r?.buildQueue?.some(
      t => t.priority === 0 && t.state === "queued" &&
        (t.structureType === STRUCTURE_STORAGE ||
          t.structureType === STRUCTURE_TOWER ||
          t.structureType === STRUCTURE_SPAWN),
    ),
  );
}
