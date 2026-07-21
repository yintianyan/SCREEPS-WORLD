import { CONFIG, getSourceTargetWorkParts } from "../../config";
import type { ColonyState, RoomSnapshot } from "../../kernel/contracts";

/** assignment-service 生成的任务条目。 */
export interface AssignmentTaskEntry {
  id: string;
  kind: string;
  targetId?: string;
  sourceId?: string;
  /** build 任务对应的结构类型 — 用于识别道路任务以预留 builder。 */
  structureType?: string;
  priority: number;
  maxWorkers: number;
  assignedCreeps: string[];
}

/** 各角色可接受的任务类型。 */
const ROLE_TASK_KINDS: Readonly<Record<string, readonly string[]>> = {
  worker: ["harvest", "fill"],
  harvester: ["harvest", "fill"],
  hauler: ["haul", "fill"],
  upgrader: ["upgrade"],
  // builder 只接受 build 任务：其 work 模式对 assignment target 调用 creep.build()，
  // 若拿到 fill 任务（target 是 spawn/extension 结构）会 ERR_INVALID_TARGET 死循环，
  // 永远无法建造。填充/维修/升级由 builder.ts 的 fallback 链在无 build 目标时自行处理。
  builder: ["build"],
};

// ──────────────────────────────────────────────
// 纯数据接口 — 适配层从 Game/Memory 收集后传入
// ──────────────────────────────────────────────

/**
 * 单个 creep 的分配摘要 — 供纯函数消费，不持有 Creep 对象。
 */
export interface CreepAssignmentRef {
  name: string;
  home: string;
  assignment?: {
    id: string;
    kind: string;
    sourceId?: string;
  };
}

/** 房间任务上下文标志 — 从 Memory 收集后传入。 */
export interface RoomTaskFlags {
  colonyState: ColonyState;
  controllerDowngradeRisk: boolean;
}

// ──────────────────────────────────────────────
// 纯函数 — 不访问 Game/Memory/globalCache，接收显式数据参数
// ──────────────────────────────────────────────

/**
 * 为单个房间生成本 tick 可用任务列表（纯函数）。
 *
 * 接收预收集的 creep 分配摘要和房间标志位，返回排序后的任务列表。
 * 不访问 Game/Memory — 所有外部状态由参数传入。
 *
 * 性能优化：单次遍历 creep 摘要，按 assignment.id 分桶到 Map，
 * 所有任务共用同一份分桶结果，避免 O(N×M) 重复扫描。
 */
export function buildRoomTasks(
  snapshot: RoomSnapshot,
  creeps: readonly CreepAssignmentRef[],
  flags: RoomTaskFlags,
): AssignmentTaskEntry[] {
  const tasks: AssignmentTaskEntry[] = [];
  const roomName = snapshot.roomName;

  // 单次遍历 creep 摘要，按 home 过滤后分桶到两个 Map：
  //   taskToCreeps: assignment.id -> creep 名字列表（fill/haul/build/upgrade 共用）
  //   sourceToCreeps: sourceId -> creep 名字列表（仅 harvest 用）
  const taskToCreeps = new Map<string, string[]>();
  const sourceToCreeps = new Map<string, string[]>();
  for (const creep of creeps) {
    if (creep.home !== roomName) continue;
    const a = creep.assignment;
    if (!a) continue;
    const taskList = taskToCreeps.get(a.id) ?? [];
    taskList.push(creep.name);
    taskToCreeps.set(a.id, taskList);
    if (a.kind === "harvest" && a.sourceId) {
      const srcList = sourceToCreeps.get(a.sourceId) ?? [];
      srcList.push(creep.name);
      sourceToCreeps.set(a.sourceId, srcList);
    }
  }

  // 1. harvest 任务 — 每个 source 一个，带槽位数。
  for (const source of snapshot.sources) {
    const assignedCreeps = sourceToCreeps.get(source.id as string) ?? [];
    // X-02：每个 source 的 maxWorkers 按 RCL 分级：RCL1-3: 5 / RCL4-6: 6 / RCL7-8: 8。
    const maxWorkers = Math.max(1, getSourceTargetWorkParts(snapshot.rcl));
    tasks.push({
      id: `harvest:${roomName}:${source.id}`,
      kind: "harvest",
      sourceId: source.id as string,
      priority: 1,
      maxWorkers,
      assignedCreeps,
    });
  }

  // 2. fill 任务 — 向 spawn/extension 送能。
  if (snapshot.fillTargets.length > 0) {
    // 动态阈值：容量 40% 与固定上限取较小值，避免 RCL1 永久 P0。
    const fillThreshold = Math.min(
      Math.floor(snapshot.energyCapacityAvailable * 0.4),
      CONFIG.assignment.emergencyFillThreshold,
    );
    const priority = snapshot.energyAvailable < fillThreshold ? 0 : 1;
    tasks.push({
      id: `fill:${roomName}`,
      kind: "fill",
      priority,
      maxWorkers: 3,
      assignedCreeps: taskToCreeps.get(`fill:${roomName}`) ?? [],
    });
  }

  // 3. haul 任务 — 从 container/storage 取能量。
  if (snapshot.containers.length > 0 || snapshot.storage) {
    const pickupId = selectHaulPickupId(snapshot);
    if (pickupId) {
      tasks.push({
        id: `haul:${roomName}`,
        kind: "haul",
        sourceId: pickupId,
        priority: 1,
        maxWorkers: 3,
        assignedCreeps: taskToCreeps.get(`haul:${roomName}`) ?? [],
      });
    }
  }

  // 4. build 任务 — 为每个 active site 生成。
  const ctrl = snapshot.controller;
  const inCrisis = flags.colonyState === "recovery";
  for (const site of snapshot.myConstructionSites) {
    const isCritical = site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER;
    // controller container 是站桩升级链路的核心基础设施 — 提升为 priority 1，
    // 确保 builder 优先建造它而非远处的 extension。
    const isControllerContainer =
      site.structureType === STRUCTURE_CONTAINER &&
      ctrl !== undefined &&
      Math.abs(site.pos.x - ctrl.pos.x) <= 1 &&
      Math.abs(site.pos.y - ctrl.pos.y) <= 1;
    // source container 同样是关键物流基础设施。
    const isSourceContainer =
      site.structureType === STRUCTURE_CONTAINER &&
      snapshot.sources.some(
        s => Math.abs(site.pos.x - s.pos.x) <= 1 && Math.abs(site.pos.y - s.pos.y) <= 1,
      );
    const isPriorityContainer = isControllerContainer || isSourceContainer;
    // 能量危机：仅暂停道路（纯效率投入、无产能回报，是真正可推迟的 discretionary 建造）。
    const isRoad = site.structureType === STRUCTURE_ROAD;
    if (inCrisis && isRoad) continue;
    tasks.push({
      id: `build:${roomName}:${site.id}`,
      kind: "build",
      targetId: site.id as string,
      structureType: site.structureType as string,
      priority: isCritical || isPriorityContainer ? 1 : 2,
      maxWorkers: isCritical || isPriorityContainer ? 2 : 1,
      assignedCreeps: taskToCreeps.get(`build:${roomName}:${site.id}`) ?? [],
    });
  }

  // 5. upgrade 任务 — 仅在 normal 或有降级风险时。
  if (snapshot.controller && snapshot.controller.my) {
    const hasDowngradeRisk = flags.controllerDowngradeRisk;
    const allowUpgrade = flags.colonyState === "normal" || hasDowngradeRisk;
    if (allowUpgrade) {
      tasks.push({
        id: `upgrade:${roomName}`,
        kind: "upgrade",
        targetId: snapshot.controller.id as string,
        priority: hasDowngradeRisk ? 1 : 2,
        maxWorkers: 3,
        assignedCreeps: taskToCreeps.get(`upgrade:${roomName}`) ?? [],
      });
    }
  }

  // 预排序：按 priority 升序，供 chooseTaskForRole 直接遍历选择。
  tasks.sort((a, b) => a.priority - b.priority);
  return tasks;
}

/**
 * 验证 assignment 是否仍然有效（纯函数）。
 *
 * 无效条件：lease 过期、revision 变化、target 消失、source 消失。
 * 所有外部状态由参数传入，不访问 Game/Memory。
 */
export function validateAssignmentRules(
  assignment: CreepAssignment,
  tick: number,
  layoutRevision: number,
  targetExists: boolean,
  sourceExists: boolean,
): boolean {
  // lease 过期。
  if (tick > assignment.leaseUntil) return false;

  // revision 变化检查 — 布局修订后旧 assignment 立即失效。
  if (assignment.revision !== layoutRevision) return false;

  // target 存在检查。
  if (assignment.targetId && !targetExists) return false;

  // source 存在检查。
  if (assignment.sourceId && !sourceExists) return false;

  return true;
}

/**
 * 为角色从预排序任务列表中选择任务（纯函数）。
 *
 * 任务列表已按 priority 升序排列。遍历选择第一个匹配角色且有空位的任务。
 *
 * builder 特殊处理：道路 build 任务 priority 与 extension 平局，按数组序排在后面会被永久饥饿。
 * 这里预留 1 个 builder 给道路 —— 仅当「有道路任务待建」「尚无 builder 在修路」
 * 「且无 critical（spawn/tower，priority≤1）缺口」时触发。
 */
export function chooseTaskForRole(
  role: string,
  tasks: readonly AssignmentTaskEntry[],
): AssignmentTaskEntry | undefined {
  const roleKinds = ROLE_TASK_KINDS[role];
  if (!roleKinds || roleKinds.length === 0) return undefined;

  // builder 道路预留：单次遍历同时统计道路任务和 critical 缺口。
  if (role === "builder") {
    let buildersOnRoad = 0;
    let firstRoadTask: AssignmentTaskEntry | undefined;
    let hasFreeCritical = false;
    for (const t of tasks) {
      if (t.kind !== "build") continue;
      if (t.structureType === STRUCTURE_ROAD) {
        buildersOnRoad += t.assignedCreeps.length;
        if (!firstRoadTask && t.assignedCreeps.length < t.maxWorkers) firstRoadTask = t;
      }
      if (t.priority <= 1 && t.assignedCreeps.length < t.maxWorkers) hasFreeCritical = true;
    }
    if (firstRoadTask && buildersOnRoad === 0 && !hasFreeCritical) return firstRoadTask;
  }

  // 遍历预排序列表，选第一个匹配且有空位的（priority 升序 = 最高优先级优先）。
  for (const task of tasks) {
    if (!roleKinds.includes(task.kind)) continue;
    if (task.assignedCreeps.length >= task.maxWorkers) continue;
    return task;
  }
  return undefined;
}

/**
 * 收集需要被失效的 creep 名称列表（纯函数）。
 *
 * 返回所有分配到 priority >= minPriority 任务的 creep 名称。
 * 适配层负责清除这些 creep 的 memory.assignment。
 */
export function getInvalidatedCreepNames(
  tasks: readonly AssignmentTaskEntry[],
  minPriority: number,
): string[] {
  const names: string[] = [];
  for (const task of tasks) {
    if (task.priority >= minPriority) {
      names.push(...task.assignedCreeps);
    }
  }
  return names;
}

/**
 * 从任务的 assignedCreeps 列表中移除指定 creep（纯函数 — 操作传入的数据结构）。
 *
 * 适配层从 globalCache 获取任务列表后调用此函数。
 */
export function removeCreepFromTask(
  tasks: readonly AssignmentTaskEntry[],
  taskId: string,
  creepName: string,
): void {
  const task = tasks.find(t => t.id === taskId);
  if (task) {
    const idx = task.assignedCreeps.indexOf(creepName);
    if (idx >= 0) task.assignedCreeps.splice(idx, 1);
  }
}

/**
 * 选择 haul 任务的 pickup 点 ID（纯函数）。
 * 优先选择能量最多的 container；若无 container 有能量则回退到 storage。
 * 返回 undefined 表示当前无可用 pickup 点。
 */
export function selectHaulPickupId(snapshot: RoomSnapshot): string | undefined {
  let bestContainer: StructureContainer | undefined;
  let bestEnergy = 0;
  for (const c of snapshot.containers) {
    const energy = c.store.getUsedCapacity(RESOURCE_ENERGY);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestContainer = c;
    }
  }
  if (bestContainer) {
    return bestContainer.id as string;
  }
  // 无 container 或所有 container 都空 — 尝试 storage（RCL4+）。
  if (snapshot.storage && snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return snapshot.storage.id as string;
  }
  return undefined;
}
