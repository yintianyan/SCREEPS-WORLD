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
  /** 任务代表位置（P2-4 距离感知选择用）：build=工地、haul=取能点、upgrade=controller；fill 无固定位置，为 undefined。 */
  pos?: { x: number; y: number };
}

/** 各角色可接受的任务类型。
 *
 * source 分配统一归 targeting.getSource()（sourceOccupancy 公平份额），不经过 assignment —
 * harvester/worker 采集均走 getSource，故无 "harvest" 任务类型，消除了旧实现
 * 「assignment harvest 槽位」与「targeting fairShare」的双轨制（P1-1）。
 */
const ROLE_TASK_KINDS: Readonly<Record<string, readonly string[]>> = {
  worker: ["fill"],
  harvester: ["fill"],
  hauler: ["haul", "fill"],
  upgrader: ["upgrade"],
  // builder 只收 build：其 work 对 spawn/extension 结构调 creep.build() 会
  // ERR_INVALID_TARGET 死循环；填充/维修/升级由 builder.ts fallback 链自行处理。
  builder: ["build"],
};

// ──────────────────────────────────────────────
// 纯数据接口 — 适配层从 Game/Memory 收集后传入
// ──────────────────────────────────────────────

/** 单个 creep 的分配摘要 — 纯函数消费，不持有 Creep 对象。 */
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
 * 单次遍历 creep 摘要（home 过滤后按 assignment.id 分桶），所有任务共用
 * 同一份分桶结果，避免 O(N×M) 重复扫描。
 */
export function buildRoomTasks(
  snapshot: RoomSnapshot,
  creeps: readonly CreepAssignmentRef[],
  flags: RoomTaskFlags,
): AssignmentTaskEntry[] {
  const tasks: AssignmentTaskEntry[] = [];
  const roomName = snapshot.roomName;

  // assignment.id -> creep 名列表（fill/haul/build/upgrade 共用分桶）
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
    // 动态阈值 = min(容量 40%, 固定上限)，避免 RCL1 永久 P0。
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

  // 2. haul 任务 — P3 起由 logistics 请求池生成（REQUEST_POOL_DESIGN §1/§3）：
  // 搬运是 Demand 一等来源，归池统一管理（TTL/过期回执/防超卖/塔提级聚合）。
  // 本函数只保留工作任务（fill/build/upgrade）。TD-013 语义保持：hauler 永不从
  // storage 取能，storage → sink 由 distributor 负责。

  // 3. build 任务 — 为每个 active site 生成。
  const ctrl = snapshot.controller;
  const inCrisis = flags.colonyState === "recovery";
  // RCL4+ 无 storage = 无中央能量源（construction-manager 已将其标 emergency）—
  // assignment 对齐：集中 builder 工时优先完工，而非与 extension 平分。
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
    // 能量危机：仅暂停道路（纯效率投入，真正可推迟的 discretionary 建造）。
    const isRoad = site.structureType === STRUCTURE_ROAD;
    if (inCrisis && isRoad) continue;
    tasks.push({
      id: `build:${roomName}:${site.id}`,
      kind: "build",
      targetId: site.id as string,
      structureType: site.structureType as string,
      // storage 在建 maxWorkers=2（集中主力但留 1 给 extension）；spawn/tower/
      // priority-container = 2；普通 site = 1。不全压 storage：extension 仅 200
      // progress，建成立即提升容量解锁更大 builder body（[2W]@350），整体建造
      // 速率翻倍 — ROI 远高于 3 builder 全压 10000 progress 的 storage。
      priority: isPriority ? 1 : 2,
      maxWorkers: isStorageSite ? 2 : isPriority ? 2 : 1,
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

  // revision：布局修订后旧 assignment 立即失效。
  if (assignment.revision !== layoutRevision) return false;

  // target/source 消失。
  if (assignment.targetId && !targetExists) return false;
  if (assignment.sourceId && !sourceExists) return false;

  return true;
}

/**
 * 为角色从预排序任务列表中选择任务（纯函数）。列表按 priority 升序，优先级主导；
 * 同优先级内选曼哈顿距离最近者（P2-4，减少 50 creep 规模下穿房通勤）。无 pos 的
 * 任务（如 fill）距离视为 Infinity，仅当无更近的有位置任务时入选；不传 creepPos
 * 退化为原「首个匹配」行为（向后兼容）。
 * builder 特殊处理：道路任务与 extension 平 priority 时按数组序排在后面会被永久
 * 饥饿 — 预留 1 个 builder 给道路（有道路待建、尚无 builder 在修路、且无
 * critical（spawn/tower，priority≤1）缺口时触发，选最近的待建道路）。
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
