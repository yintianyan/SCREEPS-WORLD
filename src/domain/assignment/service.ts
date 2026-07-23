import { CONFIG } from "../../config";
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
  /**
   * 任务代表位置（P2-4 距离感知选择用）：build=工地、haul=取能点、upgrade=controller。
   * fill 任务无固定位置（实际目标在执行期按就近/预约选择），故为 undefined。
   */
  pos?: { x: number; y: number };
}

/** 各角色可接受的任务类型。
 *
 * source 分配统一归 targeting.getSource()（基于 sourceOccupancy 的公平份额），
 * 不经过 assignment 系统 — harvester/worker 采集均走 getSource，故无 "harvest" 任务类型。
 * 这消除了旧实现中「assignment harvest 槽位」与「targeting fairShare」的双轨制（P1-1）。
 */
const ROLE_TASK_KINDS: Readonly<Record<string, readonly string[]>> = {
  worker: ["fill"],
  harvester: ["fill"],
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

  // 单次遍历 creep 摘要，按 home 过滤后分桶到 Map：
  //   taskToCreeps: assignment.id -> creep 名字列表（fill/haul/build/upgrade 共用）
  const taskToCreeps = new Map<string, string[]>();
  for (const creep of creeps) {
    if (creep.home !== roomName) continue;
    const a = creep.assignment;
    if (!a) continue;
    const taskList = taskToCreeps.get(a.id) ?? [];
    taskList.push(creep.name);
    taskToCreeps.set(a.id, taskList);
  }

  // 1. fill 任务 — 向 spawn/extension 送能。
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

  // 2. haul 任务 — 为每个含能量的 container 生成独立任务（P2-5 拆分单点聚合）。
  // 旧实现每房只生成 1 个 haul 任务（pickup=最满 container），3 个 hauler 全挤向同一处，
  // 其余 container 饿死。拆分后配合 P2-4 距离感知，hauler 自然分散到不同 container。
  // maxWorkers=1：每个 container 至少分配 1 个 hauler 即可，多余 hauler 走自身回退链。
  const haulContainers = snapshot.containers.filter(
    c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
  );
  if (haulContainers.length > 0) {
    for (const c of haulContainers) {
      tasks.push({
        id: `haul:${roomName}:${c.id}`,
        kind: "haul",
        sourceId: c.id as string,
        priority: 1,
        maxWorkers: 1,
        assignedCreeps: taskToCreeps.get(`haul:${roomName}:${c.id}`) ?? [],
        pos: { x: c.pos.x, y: c.pos.y },
      });
    }
  } else if (snapshot.storage && snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    // 无 container 有能量 — 回退到 storage（RCL4+ 储备供能）。
    tasks.push({
      id: `haul:${roomName}:${snapshot.storage.id}`,
      kind: "haul",
      sourceId: snapshot.storage.id as string,
      priority: 1,
      maxWorkers: 2,
      assignedCreeps: taskToCreeps.get(`haul:${roomName}:${snapshot.storage.id}`) ?? [],
      pos: { x: snapshot.storage.pos.x, y: snapshot.storage.pos.y },
    });
  }

  // 3. build 任务 — 为每个 active site 生成。
  const ctrl = snapshot.controller;
  const inCrisis = flags.colonyState === "recovery";
  // Storage 尚未建成时视为关键基建 — 与 spawn/tower 同优先级。
  // RCL4+ 无 storage = hauler 无处倒能 + builder/upgrader 无中央能量源，
  // construction-manager 的 assessEmergencyRebuild 已将其标记为 emergency，
  // assignment 层必须对齐：集中 builder 工时优先完工，而非与 extension 平分。
  const needsStorage = snapshot.rcl >= 4 && snapshot.storage === undefined;
  for (const site of snapshot.myConstructionSites) {
    const isCritical = site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER;
    const isStorageSite = needsStorage && site.structureType === STRUCTURE_STORAGE;
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
    const isPriority = isCritical || isPriorityContainer || isStorageSite;
    // 能量危机：仅暂停道路（纯效率投入、无产能回报，是真正可推迟的 discretionary 建造）。
    const isRoad = site.structureType === STRUCTURE_ROAD;
    if (inCrisis && isRoad) continue;
    tasks.push({
      id: `build:${roomName}:${site.id}`,
      kind: "build",
      targetId: site.id as string,
      structureType: site.structureType as string,
      // storage 在建时 maxWorkers=3（全部 builder 集中完工）；
      // spawn/tower/priority-container maxWorkers=2；普通 site maxWorkers=1。
      priority: isPriority ? 1 : 2,
      maxWorkers: isStorageSite ? 3 : isPriority ? 2 : 1,
      assignedCreeps: taskToCreeps.get(`build:${roomName}:${site.id}`) ?? [],
      pos: { x: site.pos.x, y: site.pos.y },
    });
  }

  // 4. upgrade 任务 — 仅在 normal 或有降级风险时。
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
        pos: { x: snapshot.controller.pos.x, y: snapshot.controller.pos.y },
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
 * 任务列表已按 priority 升序排列。优先级主导选择；同优先级内按距离 creep 最近选取（P2-4）。
 *
 * 距离感知（P2-4）：传入 creepPos 时，在最高优先级（最小 priority 值）的候选中选曼哈顿距离最近者，
 * 减少 50 creep 规模下的穿房通勤。无 pos 的任务（如 fill）在距离比较中排后（视为 Infinity），
 * 仅当无更近的有位置任务时入选。不传 creepPos 时退化为原「首个匹配」行为（向后兼容）。
 *
 * builder 特殊处理：道路 build 任务 priority 与 extension 平局，按数组序排在后面会被永久饥饿。
 * 这里预留 1 个 builder 给道路 —— 仅当「有道路任务待建」「尚无 builder 在修路」
 * 「且无 critical（spawn/tower，priority≤1）缺口」时触发，并选最近的待建道路。
 */
export function chooseTaskForRole(
  role: string,
  tasks: readonly AssignmentTaskEntry[],
  creepPos?: { x: number; y: number },
): AssignmentTaskEntry | undefined {
  const roleKinds = ROLE_TASK_KINDS[role];
  if (!roleKinds || roleKinds.length === 0) return undefined;

  // builder 道路预留：单次遍历同时统计道路任务和 critical 缺口。
  if (role === "builder") {
    let buildersOnRoad = 0;
    let hasFreeCritical = false;
    const roadCandidates: AssignmentTaskEntry[] = [];
    for (const t of tasks) {
      if (t.kind !== "build") continue;
      if (t.structureType === STRUCTURE_ROAD) {
        buildersOnRoad += t.assignedCreeps.length;
        if (t.assignedCreeps.length < t.maxWorkers) roadCandidates.push(t);
      }
      if (t.priority <= 1 && t.assignedCreeps.length < t.maxWorkers) hasFreeCritical = true;
    }
    if (roadCandidates.length > 0 && buildersOnRoad === 0 && !hasFreeCritical) {
      return closestTask(roadCandidates, creepPos);
    }
  }

  // 1. 找最高优先级（最小 priority 值）且有匹配角色、有空位的任务。
  let bestPriority = Infinity;
  for (const task of tasks) {
    if (!roleKinds.includes(task.kind)) continue;
    if (task.assignedCreeps.length >= task.maxWorkers) continue;
    if (task.priority < bestPriority) bestPriority = task.priority;
  }
  if (bestPriority === Infinity) return undefined;

  // 2. 收集该优先级的所有候选，距离感知选最近。
  const candidates: AssignmentTaskEntry[] = [];
  for (const task of tasks) {
    if (!roleKinds.includes(task.kind)) continue;
    if (task.assignedCreeps.length >= task.maxWorkers) continue;
    if (task.priority === bestPriority) candidates.push(task);
  }
  return closestTask(candidates, creepPos);
}

/**
 * 在候选任务中选距离 creep 最近者（曼哈顿距离，P2-4）。
 * 无 creepPos 或仅一个候选时回退数组首个（保持确定性）。
 * 无 pos 的任务距离视为 Infinity —— 有位置任务优先，全无位置时回退首个。
 */
function closestTask(
  candidates: readonly AssignmentTaskEntry[],
  creepPos?: { x: number; y: number },
): AssignmentTaskEntry | undefined {
  if (candidates.length === 0) return undefined;
  if (!creepPos || candidates.length === 1) return candidates[0];

  let best = candidates[0]!;
  let bestDist = taskDistance(best, creepPos);
  for (let i = 1; i < candidates.length; i++) {
    const d = taskDistance(candidates[i]!, creepPos);
    if (d < bestDist) {
      bestDist = d;
      best = candidates[i]!;
    }
  }
  return best;
}

/** 任务代表位置到 creep 的曼哈顿距离；任务无 pos 时返回 Infinity。 */
function taskDistance(task: AssignmentTaskEntry, pos: { x: number; y: number }): number {
  if (!task.pos) return Infinity;
  return Math.abs(task.pos.x - pos.x) + Math.abs(task.pos.y - pos.y);
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
