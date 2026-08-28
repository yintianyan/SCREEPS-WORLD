import type { Priority, System, TickContext, RoomSnapshot, ColonyState } from "../kernel/contracts";
import {
  buildRoomTasks,
  type CreepAssignmentRef,
  type RoomTaskFlags,
} from "../domain/assignment/service";
import { TaskPool } from "../domain/assignment/task-pool";
import { globalCache } from "../kernel/global-cache";
import { CONFIG } from "../config";

/**
 * 任务分配服务 — P1 系统，在所有角色之前运行（plan §5.7.2）。

 * 建造任务带 maxWorkers 与 lease）；紧急抢占由系统完成（P0 fill / flee 使普通
 * assignment 失效）。领域层 buildRoomTasks 是纯函数，TaskPool 封装索引与原子操作；
 * 本系统层负责从 Game/Memory 收集数据、调用纯函数、写回缓存。
 * P1 — 失败时角色回退到无 assignment 行为，允许 safeRun 冷却避免刷屏。
 */
export const assignmentSystem: System = {
  name: "assignment-service",
  priority: 1 as Priority,
  run(ctx: TickContext): void {
    const pool = initAssignmentCache(ctx.tick);

    // P1-1：在循环外预构建全量 creep 分配摘要，避免 O(rooms × creeps) 重复遍历。
    // 原先 generateRoomTasks 在每房间循环内遍历全部 Game.creeps，N 房间 × M creep = O(N×M)。
    const allCreepRefs = collectAllCreepRefs();

    for (const snapshot of ctx.snapshots()) {
      // 紧急抢占（plan §5.7.2 规则 5）：能量低于 fill 阈值或有敌对单位时，
      // 释放 priority >= 1 的普通任务，强制 creep 重新请求 P0 fill 或进入 flee。
      //
      // P1-2 边沿触发：仅在「正常 → 紧急」上升沿失效一次。持续紧急期间不重复失效——
      // 旧实现每 tick 清空所有 assignment 并写 memory.assignment=undefined，
      // 使 lease 机制在持续敌袭/低能量期间形同虚设，且产生大量 Memory 写入抖动。
      // flee 由 role-runner 每 tick 独立处理（shouldFlee），不依赖 assignment 失效。
      const roomMem = Memory.rooms[snapshot.roomName];
      const emergency = isEmergencyState(snapshot);
      const wasEmergency = roomMem?.wasEmergency === true;
      if (roomMem) roomMem.wasEmergency = emergency;

      // Storage 优先：RCL4+ 无 storage 且有 storage site 时，强制释放 builder 的非 storage assignment。
      // 根因：lease 机制（50 tick）让 builder 保持旧的 extension assignment 不切换，
      // 导致 storage site 无人建造，经济中枢断裂。
      const needsStorage = snapshot.rcl >= 4 && snapshot.storage === undefined;
      if (needsStorage) {
        releaseNonStorageBuilderAssignments(snapshot);
      }

      generateRoomTasks(pool, snapshot, ctx, allCreepRefs);

      // 抢占必须在 generateRoomTasks 之后执行 — TaskPool 每 tick 重建为空，
      // 任务写入前调用 invalidate 只会读到空列表、返回空 creep 名单，
      // 整个抢占退化为 no-op（曾因此静默失效）。
      // TD-018 冷却：传入 lastPreemptTick，防房间在紧急/正常间快速交替时每个上升沿都触发。
      if (shouldPreemptAssignments(emergency, wasEmergency, roomMem?.lastPreemptTick, ctx.tick)) {
        invalidateAssignments(pool, snapshot.roomName, 1);
        if (roomMem) roomMem.lastPreemptTick = ctx.tick;
      }
    }
  },
};

// ──────────────────────────────────────────────
// 适配层 — 从 Game/Memory 收集数据，调用纯函数，写回缓存
// ──────────────────────────────────────────────

/**
 * 初始化 assignment 缓存（每 tick 开头调用）— 缓存操作在适配层完成，领域层不访问 globalCache。
 */
function initAssignmentCache(tick: number): TaskPool {
  const pool = new TaskPool();
  pool.init(tick);
  const g = globalCache();
  g.assignment = { tick, pool };
  return pool;
}

/**
 * 适配：遍历全部 Game.creeps 一次，收集 creep 分配摘要。
 * P1-1：从 generateRoomTasks 提取到循环外，避免每房间重复遍历。
 */
function collectAllCreepRefs(): CreepAssignmentRef[] {
  const refs: CreepAssignmentRef[] = [];
  for (const creep of Object.values(Game.creeps)) {
    const home = creep.memory.home ?? creep.room?.name;
    if (!home) continue;
    const a = creep.memory.assignment;
    refs.push({
      name: creep.name,
      home,
      assignment: a
        ? {
            id: a.id,
            kind: a.kind,
            sourceId: a.sourceId ? (a.sourceId as string) : undefined,
          }
        : undefined,
    });
  }
  return refs;
}

/**
 * 适配：为房间生成任务列表并写入 TaskPool —
 * 从预构建的全量 creepRefs 中筛选本房 creep，从 Memory 读取房间标志位，
 * 调用纯函数 buildRoomTasks 后将结果存入任务池。
 */
function generateRoomTasks(
  pool: TaskPool,
  snapshot: RoomSnapshot,
  ctx: TickContext,
  allCreepRefs: readonly CreepAssignmentRef[],
): void {
  if (pool.tick !== ctx.tick) return;

  const roomName = snapshot.roomName;
  const roomMem = Memory.rooms[roomName];

  // 从预构建的全量摘要中筛选本房 creep。
  const creepRefs: CreepAssignmentRef[] = [];
  for (const ref of allCreepRefs) {
    if (ref.home === roomName) creepRefs.push(ref);
  }

  const flags: RoomTaskFlags = {
    colonyState: (roomMem?.colonyState ?? "normal") as ColonyState,
    controllerDowngradeRisk: roomMem?.controllerDowngradeRisk === true,
  };

  const tasks = buildRoomTasks(snapshot, creepRefs, flags);

  // P3：搬运请求由 logistics 请求池生成（REQUEST_POOL_DESIGN）——合并进任务槽并重排。
  const tp = globalCache().transportPool;
  if (tp && tp.tick === ctx.tick) {
    const transport = tp.rooms[roomName];
    if (transport && transport.length > 0) {
      for (const t of transport) tasks.push(t as import("../domain/assignment/service").AssignmentTaskEntry);
      tasks.sort((a, b) => a.priority - b.priority);
    }
  }

  pool.setRoomTasks(roomName, tasks);
}

/**
 * 适配：失效指定房间内 priority >= minPriority 的所有任务 —
 * TaskPool.invalidate() 单次遍历收集 creep 名并清空 assignedCreeps，
 * 然后清除这些 creep 的 memory.assignment。
 */
function invalidateAssignments(pool: TaskPool, roomName: string, minPriority: number): void {
  const creepNames = pool.invalidate(roomName, minPriority);

  // 清除 creep memory 中的 assignment。
  for (const name of creepNames) {
    const creep = Game.creeps[name];
    if (creep) {
      creep.memory.assignment = undefined;
    }
  }
}

/**
 * 适配：强制释放绑定在非 storage/extension site 的 builder assignment。

 * 触发条件：RCL4+ 无 storage 且存在 storage construction site。
 * storage 是经济中枢——haul 无处倒能、builder/upgrader 无中央能量源；
 * assignment-service 已将 storage site 标记 priority=1, maxWorkers=2，
 * 但 lease 机制（50 tick）让 builder 保持旧 assignment 不切换，故每 tick
 * 主动失效非 storage/extension build assignment，强制 builder 重新选 storage。

 * 不释放 extension site 上的 builder——extension 建成后提升 energyCapacityAvailable，
 * 解锁更大 builder body，整体建造速率翻倍；全压 storage 反而拖慢 extension 重建。
 * storage site 不存在（被 block 或未规划）时不释放——避免 builder 永久 idle。
 */
function releaseNonStorageBuilderAssignments(snapshot: RoomSnapshot): void {
  // 必须存在 storage construction site 才释放——否则 builder 无 storage 可建。
  const hasStorageSite = snapshot.myConstructionSites.some(
    s => s.structureType === STRUCTURE_STORAGE,
  );
  if (!hasStorageSite) return;

  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.home !== snapshot.roomName) continue;
    if (creep.memory.role !== "builder") continue;
    const a = creep.memory.assignment;
    if (!a || a.kind !== "build" || !a.targetId) continue;

    const site = Game.getObjectById(a.targetId as Id<ConstructionSite>);
    // 保留 storage 和 extension site 上的 builder；释放其他（road/rampart/link 等）。
    if (site && site.structureType !== STRUCTURE_STORAGE && site.structureType !== STRUCTURE_EXTENSION) {
      creep.memory.assignment = undefined;
    }
  }
}

// ──────────────────────────────────────────────
// 纯判断函数
// ──────────────────────────────────────────────

/**
 * 判断房间是否处于紧急状态需要触发任务抢占。
 * 紧急条件（任一满足）：能量低于动态 fill 阈值，或有敌对 creep。
 * 动态阈值 = min(energyCapacityAvailable × 0.4, CONFIG.assignment.emergencyFillThreshold)；
 * 修复：原固定 300 阈值在 RCL1（容量 300）下永久触发紧急状态，
 * 导致 assignment 每 tick 被清空重建，creep 无法稳定工作。
 */
function isEmergencyState(snapshot: RoomSnapshot): boolean {
  const dynamicThreshold = Math.min(
    Math.floor(snapshot.energyCapacityAvailable * 0.4),
    CONFIG.assignment.emergencyFillThreshold,
  );
  if (snapshot.energyAvailable < dynamicThreshold) return true;
  if (snapshot.threatCreeps.length > 0) return true;
  return false;
}

/**
 * 判断是否应触发任务抢占（纯函数，P1-2 边沿触发 + TD-018 冷却机制）。
 * 仅在「正常 → 紧急」上升沿返回 true；持续紧急/持续正常/紧急缓解均返回 false，
 * 保证一次紧急事件只失效一次 assignment，避免持续期间每 tick 抖动。
 * TD-018：上升沿触发后距上次抢占至少 20 tick，防房间在紧急/正常间快速交替时
 * 频繁 invalidate 导致 creep 丢失任务；首次抢占不受冷却限制。
 */
export function shouldPreemptAssignments(
  emergency: boolean,
  wasEmergency: boolean,
  lastPreemptTick: number | undefined,
  currentTick: number,
): boolean {
  if (!emergency || wasEmergency) return false;
  // 冷却判断：距上次抢占至少间隔 20 tick
  if (lastPreemptTick !== undefined && currentTick - lastPreemptTick < 20) return false;
  return true;
}
