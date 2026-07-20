import { CONFIG, getSourceTargetWorkParts } from "../../config";
import type { RoomSnapshot, TickContext } from "../../kernel/contracts";
import {
  globalCache,
  type AssignmentTaskEntry,
} from "../../kernel/global-cache";

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

/** 初始化 assignment 缓存（每 tick 开头调用）。 */
export function initAssignment(tick: number): void {
  const g = globalCache();
  g.assignment = {
    tick,
    roomTasks: new Map(),
  };
}

/**
 * 为单个房间生成本 tick 可用任务列表（plan §5.7.2）。
 * 根据 RoomSnapshot、colony 状态和当前人口计算。
 *
 * 性能优化：单次遍历 Game.creeps，按 assignment.id 分桶到 Map，
 * 所有任务共用同一份分桶结果，避免 O(N×M) 重复扫描（N=任务数, M=creep 数）。
 */
export function generateRoomTasks(snapshot: RoomSnapshot, ctx: TickContext): void {
  const g = globalCache();
  if (!g.assignment || g.assignment.tick !== ctx.tick) return;

  const tasks: AssignmentTaskEntry[] = [];
  const roomName = snapshot.roomName;

  // 单次遍历 Game.creeps，按 home 过滤后分桶到两个 Map：
  //   taskToCreeps: assignment.id -> creep 名字列表（fill/haul/build/upgrade 共用）
  //   sourceToCreeps: sourceId -> creep 名字列表（仅 harvest 用）
  const taskToCreeps = new Map<string, string[]>();
  const sourceToCreeps = new Map<string, string[]>();
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.home !== roomName) continue;
    const a = creep.memory.assignment;
    if (!a) continue;
    const taskList = taskToCreeps.get(a.id) ?? [];
    taskList.push(creep.name);
    taskToCreeps.set(a.id, taskList);
    if (a.kind === "harvest" && a.sourceId) {
      const srcList = sourceToCreeps.get(a.sourceId as string) ?? [];
      srcList.push(creep.name);
      sourceToCreeps.set(a.sourceId as string, srcList);
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
  // sourceId 指向 pickup 点（container 优先，storage 次选），让 hauler 确定性分配而非各自竞争。
  if (snapshot.containers.length > 0 || snapshot.storage) {
    const pickupId = selectHaulPickupId(snapshot);
    // 找不到有能量的 pickup 点时不创建 haul 任务 — 避免分配无效任务。
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
  for (const site of snapshot.myConstructionSites) {
    const isCritical = site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER;
    // controller container 是站桩升级链路的核心基础设施 — 提升为 priority 1，
    // 确保 builder 优先建造它而非远处的 extension（否则按数组序它会被 extension 挤占饿死）。
    const isControllerContainer =
      site.structureType === STRUCTURE_CONTAINER &&
      ctrl !== undefined &&
      Math.abs(site.pos.x - ctrl.pos.x) <= 1 &&
      Math.abs(site.pos.y - ctrl.pos.y) <= 1;
    // source container 同样是关键物流基础设施：缺失时该 source 的 harvester 只能长途送能到 spawn，
    // 半个房间的收入瘫痪。故与 controller container 一样提升为 priority 1 优先建造/重建。
    const isSourceContainer =
      site.structureType === STRUCTURE_CONTAINER &&
      snapshot.sources.some(
        s => Math.abs(site.pos.x - s.pos.x) <= 1 && Math.abs(site.pos.y - s.pos.y) <= 1,
      );
    const isPriorityContainer = isControllerContainer || isSourceContainer;
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
    const hasDowngradeRisk = Memory.rooms[roomName]?.controllerDowngradeRisk === true;
    const allowUpgrade = ctx.colonyState === "normal" || hasDowngradeRisk;
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

  g.assignment.roomTasks.set(roomName, tasks);
}

/**
 * 为 creep 获取或续约任务（plan §5.7.2）。
 *
 * 流程：
 *   1. 检查现有 assignment 是否有效（lease/target/source）
 *   2. 有效则续约 lease 并返回
 *   3. 无效则释放旧任务，从可用列表中分配新的
 *   4. 无可用任务返回 undefined（角色进入 idle）
 */
export function requestAssignment(creep: Creep, ctx: TickContext): CreepAssignment | undefined {
  // 1. 检查现有 assignment。
  if (validateAssignment(creep, ctx)) {
    creep.memory.assignment!.leaseUntil = ctx.tick + CONFIG.assignment.leaseDuration;
    return creep.memory.assignment;
  }

  // 2. 释放旧 assignment。
  if (creep.memory.assignment) {
    releaseFromTask(creep);
    creep.memory.assignment = undefined;
  }

  // 3. 从任务列表中找新任务。
  const g = globalCache();
  if (!g.assignment || g.assignment.tick !== ctx.tick) return undefined;

  const home = creep.memory.home ?? creep.room?.name ?? "";
  const roomTasks = g.assignment.roomTasks.get(home);
  if (!roomTasks) return undefined;

  const roleKinds = ROLE_TASK_KINDS[creep.memory.role] ?? [];
  if (roleKinds.length === 0) return undefined;

  // 按优先级排序任务。
  const sorted = [...roomTasks]
    .filter(t => roleKinds.includes(t.kind))
    .sort((a, b) => a.priority - b.priority);

  const chosen = chooseBuildAwareTask(creep, sorted);
  if (!chosen) return undefined;

  const assignment: CreepAssignment = {
    id: chosen.id,
    kind: chosen.kind as CreepAssignment["kind"],
    targetId: chosen.targetId as Id<_HasId> | undefined,
    sourceId: chosen.sourceId as Id<Source> | undefined,
    // 携带当前 layout.revision — 布局修订后此值不一致，validateAssignment 立即失效。
    revision: getCurrentLayoutRevision(home),
    assignedAt: ctx.tick,
    leaseUntil: ctx.tick + CONFIG.assignment.leaseDuration,
  };

  creep.memory.assignment = assignment;
  chosen.assignedCreeps.push(creep.name);
  return assignment;
}

/**
 * 为 creep 选择任务（含 builder 修路保障）。
 *
 * builder 特殊处理：道路 build 任务 priority 与 extension 平局，按数组序排在后面会被永久饥饿。
 * 这里预留 1 个 builder 给道路 —— 仅当「有道路任务待建」「尚无 builder 在修路」
 * 「且无 critical（spawn/tower，priority≤1）缺口」时触发，把本 builder 指派给第一个道路任务。
 * 这样既保证走廊路持续施工，又不会从关键防御/孵化结构抢夺 builder。
 */
function chooseBuildAwareTask(
  creep: Creep,
  sorted: AssignmentTaskEntry[],
): AssignmentTaskEntry | undefined {
  if (creep.memory.role === "builder") {
    const roadTasks = sorted.filter(
      t => t.kind === "build" && t.structureType === STRUCTURE_ROAD && t.assignedCreeps.length < t.maxWorkers,
    );
    if (roadTasks.length > 0) {
      const buildersOnRoad = sorted
        .filter(t => t.kind === "build" && t.structureType === STRUCTURE_ROAD)
        .reduce((n, t) => n + t.assignedCreeps.length, 0);
      const hasFreeCritical = sorted.some(
        t => t.priority <= 1 && t.assignedCreeps.length < t.maxWorkers,
      );
      if (buildersOnRoad === 0 && !hasFreeCritical) {
        return roadTasks[0];
      }
    }
  }

  for (const task of sorted) {
    if (task.assignedCreeps.length >= task.maxWorkers) continue;
    return task;
  }
  return undefined;
}

/**
 * 验证 creep 现有 assignment 是否仍然有效。
 * 无效条件：lease 过期、revision 变化、target 消失、source 消失。
 */
export function validateAssignment(creep: Creep, ctx: TickContext): boolean {
  const assignment = creep.memory.assignment;
  if (!assignment) return false;

  // lease 过期。
  if (ctx.tick > assignment.leaseUntil) return false;

  // revision 变化检查 — 布局修订后旧 assignment 立即失效（plan §5.7.2 规则 4）。
  // creep.room 可能未定义（如测试环境或刚出生未同步），用可选链避免崩溃。
  const home = creep.memory.home ?? creep.room?.name ?? "";
  if (assignment.revision !== getCurrentLayoutRevision(home)) return false;

  // target 存在检查。
  if (assignment.targetId) {
    const target = Game.getObjectById(assignment.targetId);
    if (!target) return false;
  }

  // source 存在检查。
  if (assignment.sourceId) {
    const source = Game.getObjectById(assignment.sourceId);
    if (!source) return false;
  }

  return true;
}

/**
 * 获取指定房间的当前 layout.revision。
 * 无 layout 时返回 0 — 等价于所有 assignment 的 revision 必须为 0 才有效。
 */
function getCurrentLayoutRevision(roomName: string): number {
  return Memory.rooms[roomName]?.layout?.revision ?? 0;
}

/** 释放 creep 当前任务 — 从任务的 assignedCreeps 列表中移除。 */
export function releaseFromTask(creep: Creep): void {
  const assignment = creep.memory.assignment;
  if (!assignment) return;

  const g = globalCache();
  if (!g.assignment) return;

  const home = creep.memory.home ?? creep.room?.name ?? "";
  const roomTasks = g.assignment.roomTasks.get(home);
  if (!roomTasks) return;

  const task = roomTasks.find(t => t.id === assignment.id);
  if (task) {
    const idx = task.assignedCreeps.indexOf(creep.name);
    if (idx >= 0) task.assignedCreeps.splice(idx, 1);
  }
}

/**
 * 紧急抢占 — 使指定房间的所有普通 assignment 失效（plan §5.7.2 规则 5）。
 * P0 fill/flee 可使普通 assignment 失效；角色不自行争抢。
 *
 * 不仅清空任务的 assignedCreeps 列表，还直接清除 creep memory 中的 assignment，
 * 确保 validateAssignment 在下一 tick 返回 false，强制角色重新请求任务。
 */
export function invalidateAssignments(roomName: string, minPriority: number): void {
  const g = globalCache();
  if (!g.assignment) return;

  const roomTasks = g.assignment.roomTasks.get(roomName);
  if (!roomTasks) return;

  for (const task of roomTasks) {
    if (task.priority >= minPriority) {
      // 清除分配到此任务的 creep 的 memory.assignment。
      for (const creepName of task.assignedCreeps) {
        const creep = Game.creeps[creepName];
        if (creep) {
          creep.memory.assignment = undefined;
        }
      }
      // 清空已分配列表，强制角色重新请求。
      task.assignedCreeps = [];
    }
  }
}

/**
 * 选择 haul 任务的 pickup 点 ID。
 * 优先选择能量最多的 container；若无 container 有能量则回退到 storage。
 * 返回 undefined 表示当前无可用 pickup 点。
 */
function selectHaulPickupId(snapshot: RoomSnapshot): string | undefined {
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
