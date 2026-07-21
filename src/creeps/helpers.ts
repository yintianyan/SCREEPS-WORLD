import { CONFIG } from "../config";
import type { RoomSnapshot, TickContext } from "../kernel/contracts";
import { chooseTaskForRole, validateAssignmentRules, removeCreepFromTask } from "../domain/assignment/service";
import { globalCache } from "../kernel/global-cache";

/** 将 RoomPosition 压缩为单个数字：x * 50 + y。 */
export function packPos(pos: RoomPosition): number {
  return pos.x * 50 + pos.y;
}

/**
 * 记录 creep 当前位置的交通热度，供道路规划器使用。
 * 在 creep 移动时调用，累加到 global.roomTraffic 缓存。
 */
function recordTraffic(creep: Creep): void {
  const g = globalCache();
  if (!g.roomTraffic) g.roomTraffic = {};
  const roomName = creep.room.name;
  if (!g.roomTraffic[roomName]) g.roomTraffic[roomName] = {};
  const key = `${creep.pos.x},${creep.pos.y}`;
  g.roomTraffic[roomName][key] = (g.roomTraffic[roomName][key] ?? 0) + 1;
}

/**
 * 确保 creep 已设置 home 房间；不在 home 时尝试向 home 方向移动。
 * 只有 creep 实际在 home 房间内时才返回 true，
 * 避免跨房目标导致 moveTo(maxRooms:1) 永远无法到达。
 */
export function ensureHome(creep: Creep): boolean {
  if (!creep.memory.home) {
    creep.memory.home = creep.room.name;
  }
  const home = creep.memory.home;
  // 只有在 home 房间内才返回 true。
  if (creep.room.name === home) return true;
  // 不在 home — 向 home 方向移动到出口。
  moveTowardRoom(creep, home);
  return false;
}

/** 向目标房间方向移动（通过最近出口）。 */
export function moveTowardRoom(creep: Creep, targetRoom: string): void {
  const exitDir = creep.room.findExitTo(targetRoom) as number;
  if (exitDir < 0) return; // 错误码为负值
  const exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
  if (exit) {
    // G-MV-03：reusePath 默认 5。
    const result = creep.moveTo(exit, { reusePath: 5 });
    // G-MV-05：移动后仅在 OK/ERR_TIRED 时记录交通热度。
    if (result === OK || result === ERR_TIRED) {
      recordTraffic(creep);
    }
  }
}

/** 根据能量存储更新 creep 模式。仅在阈值跨越时写入。 */
export function updateMode(creep: Creep): void {
  const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  const mode = creep.memory.mode ?? "acquire";

  if (mode === "acquire" && free === 0) {
    creep.memory.mode = "work";
  } else if (mode === "work" && used === 0) {
    creep.memory.mode = "acquire";
  } else if (mode === "idle" || mode === "flee") {
    // idle/flee 恢复：有能量时转 work 去消耗，空载时转 acquire 去采集。
    // 修复：原实现缺少 idle 和 flee 分支导致 creep 一旦进入这些模式就永久卡死。
    // flee 场景：敌人离开后 shouldFlee 返回 false，但 mode 仍为 flee，需要恢复。
    creep.memory.mode = used > 0 ? "work" : "acquire";
  } else if (!creep.memory.mode) {
    creep.memory.mode = used > 0 ? "work" : "acquire";
  }
}

/** 获取或分配 creep 的 source。将 sourceId 存入 memory。 */
export function getSource(creep: Creep, snapshot: RoomSnapshot): Source | undefined {
  // 先尝试缓存的 source。
  if (creep.memory.sourceId) {
    const source = Game.getObjectById(creep.memory.sourceId);
    if (source) {
      // 拥挤检测：如果当前 source 占用超过公平份额，且存在更空闲的 source，则重分配。
      // 公平份额 = ceil(总占用 / source 数量)。例如 2 harvester + 2 source → 每个最多 1。
      if (snapshot.sources.length > 1) {
        const myCount = snapshot.sourceOccupancy.get(source.id) ?? 0;
        let totalOccupancy = 0;
        let minCount = Infinity;
        for (const s of snapshot.sources) {
          const c = snapshot.sourceOccupancy.get(s.id) ?? 0;
          totalOccupancy += c;
          if (c < minCount) minCount = c;
        }
        const fairShare = Math.ceil(totalOccupancy / snapshot.sources.length);
        // 当前 source 超过公平份额 且 存在更空闲的 source → 迁移。
        if (myCount > fairShare && minCount < myCount) {
          creep.memory.sourceId = undefined;
          // 落入下方重分配逻辑。
        } else {
          return source;
        }
      } else {
        return source;
      }
    } else {
      // source 消失 — 清除并重新分配。
      creep.memory.sourceId = undefined;
    }
  }

  // 使用快照数据分配占用最少的 source（无需全局扫描）。
  let best: Source | undefined;
  let bestCount = Infinity;
  for (const source of snapshot.sources) {
    const count = snapshot.sourceOccupancy.get(source.id) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      best = source;
    }
  }

  if (best) {
    creep.memory.sourceId = best.id;
  }
  return best;
}

/**
 * 查找最近的需能量结构（有空闲容量的 spawn 或 extension）。
 * 使用引擎原生 findClosestByRange 替代手动迭代。
 */
export function getFillTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
): AnyOwnedStructure | undefined {
  if (snapshot.fillTargets.length === 0) return undefined;
  return creep.pos.findClosestByRange(snapshot.fillTargets as AnyOwnedStructure[]) ?? undefined;
}

/** 可被 hauler 填充的结构类型。 */
type FillTarget = StructureSpawn | StructureExtension | StructureTower | StructureContainer;

/** 在 targets 中找最近的「未预约」目标；给定 types 时仅在这些结构类型中挑选。 */
function pickFillTarget(
  creep: Creep,
  targets: readonly FillTarget[],
  reserved: Set<string>,
  types?: readonly string[],
): FillTarget | undefined {
  const pool = targets.filter(
    s => !reserved.has(s.id) && (types === undefined || types.includes(s.structureType)),
  );
  if (pool.length === 0) return undefined;
  return creep.pos.findClosestByRange(pool) ?? undefined;
}

/**
 * Hauler 专用的填充目标选择 — 带优先级与每 tick 预约去重。
 *
 * 老玩家填充优先级：
 *   0. controller container 低于半满时优先补 1 个 hauler（站桩升级供能核心，远离核心区易饿死）。
 *   1. spawn / extension —— 孵化引擎，断能即停产，最高优先。
 *   2. tower —— 防御/维修，次之。
 *   3. 其余（如非紧急的 controller container）。
 * 同级取最近未预约者；预约集合按 tick 惰性重置，避免多 hauler 抢同一目标互相堵位。
 * 所有目标都被预约时回退到最近目标（允许共享），避免死锁。
 */
export function getHaulFillTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
): AnyOwnedStructure | undefined {
  if (snapshot.fillTargets.length === 0) return undefined;

  const g = globalCache();
  if (!g.fillReservations || g.fillReservationTick !== Game.time) {
    g.fillReservations = new Set();
    g.fillReservationTick = Game.time;
  }
  const reserved = g.fillReservations;

  // 0. 站桩升级保障：controller container 低于半满时优先派一个 hauler 补给。
  const cc = snapshot.controllerContainer;
  if (
    cc &&
    cc.store.getFreeCapacity(RESOURCE_ENERGY) > cc.store.getUsedCapacity(RESOURCE_ENERGY) &&
    !reserved.has(cc.id)
  ) {
    reserved.add(cc.id);
    return cc as unknown as AnyOwnedStructure;
  }

  // 1→2→3 分级挑选最近未预约目标。
  const target =
    pickFillTarget(creep, snapshot.fillTargets, reserved, [STRUCTURE_SPAWN, STRUCTURE_EXTENSION]) ??
    pickFillTarget(creep, snapshot.fillTargets, reserved, [STRUCTURE_TOWER]) ??
    pickFillTarget(creep, snapshot.fillTargets, reserved);

  if (target) {
    reserved.add(target.id);
    return target as unknown as AnyOwnedStructure;
  }

  // 全部已预约 — 回退最近目标（允许共享）避免死锁。
  return (creep.pos.findClosestByRange(snapshot.fillTargets as FillTarget[]) ?? undefined) as
    | AnyOwnedStructure
    | undefined;
}

/** 找到能量最多的 container。 */
export function findRichestContainer(
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestEnergy = 0;
  for (const c of containers) {
    const energy = c.store.getUsedCapacity(RESOURCE_ENERGY);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      best = c;
    }
  }
  return best;
}

/**
 * 找到距离 creep 最近且含有能量的 container。
 * 用于 builder 等需要在远处工地与能量源之间通勤的角色 — 选最近的能量源
 * 而非最满的，可显著缩短取能行走距离，提升建造 duty cycle。
 */
export function findClosestContainerWithEnergy(
  creep: Creep,
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestDist = Infinity;
  for (const c of containers) {
    if (c.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) continue;
    const d = creep.pos.getRangeTo(c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** 找到空闲容量最大的 container。 */
export function findEmptiestContainer(
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestFree = 0;
  for (const c of containers) {
    const free = c.store.getFreeCapacity(RESOURCE_ENERGY);
    if (free > bestFree) {
      bestFree = free;
      best = c;
    }
  }
  return best;
}

/**
 * 移动到目标，带卡位检测和路径缓存复用。
 * 仅在操作返回 ERR_NOT_IN_RANGE 时调用。
 * 注意：ERR_TIRED 不触发卡位计数（疲劳是正常机制）。
 */
export function moveToTarget(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
): ScreepsReturnCode {
  const pos = "pos" in target ? target.pos : target;

  // 卡位检测。
  const currentPacked = packPos(creep.pos);
  if (creep.memory.lastPos === currentPacked) {
    creep.memory.stuckTicks = (creep.memory.stuckTicks ?? 0) + 1;
  } else {
    creep.memory.stuckTicks = 0;
  }
  creep.memory.lastPos = currentPacked;

  const stuckTicks = creep.memory.stuckTicks ?? 0;

  // 超过重寻路限制（stuckThreshold + repathLimit）— 清除目标并进入 idle，
  // 让角色下一 tick 重新评估目标，避免永久卡死。
  if (stuckTicks >= CONFIG.kernel.stuckThreshold + CONFIG.kernel.repathLimit) {
    clearTarget(creep);
    creep.memory.mode = "idle";
    return ERR_NO_PATH;
  }

  // 默认 ignoreCreeps: true 减少路径绕行；卡位时关闭以绕过阻挡的 creep。
  const options: MoveToOpts = {
    reusePath: 5,
    maxRooms: 1,
    ignoreCreeps: true,
    ...(stuckTicks >= CONFIG.kernel.stuckThreshold ? { ignoreCreeps: false } : {}),
  };

  const result = creep.moveTo(pos, options);
  // 记录交通热度（仅在成功移动或疲劳时记录——静止不记录）。
  if (result === OK || result === ERR_TIRED) {
    recordTraffic(creep);
  }
  // ERR_TIRED 时不重置卡位计数 — 疲劳不应被误判为卡位。
  return result;
}

/** 清除 creep 的目标和分配，进入安全空闲。 */
export function clearTarget(creep: Creep): void {
  // 先从任务列表中移除 creep（releaseFromTask 读取 assignment），再清除 memory。
  releaseFromTask(creep);
  creep.memory.targetId = undefined;
  creep.memory.assignment = undefined;
  creep.memory.stuckTicks = 0;
}

// ──────────────────────────────────────────────
// 适配层 — 从 Game/Memory/creep 读取数据，调用纯函数，写回状态
// ──────────────────────────────────────────────

/**
 * 适配：释放 creep 的当前任务分配。
 * 从 creep.memory 读取 assignment，在 globalCache 中找到对应任务列表，
 * 调用纯函数 removeCreepFromTask 移除 creep 名字。
 */
function releaseFromTask(creep: Creep): void {
  const assignment = creep.memory.assignment;
  if (!assignment) return;

  const g = globalCache();
  if (!g.assignment) return;

  const home = creep.memory.home ?? creep.room?.name ?? "";
  const roomTasks = g.assignment.roomTasks.get(home);
  if (!roomTasks) return;

  removeCreepFromTask(roomTasks, assignment.id, creep.name);
}

/**
 * 适配：获取或续约 creep 的任务分配（plan §5.7.2）。
 *
 * 从 creep.memory 读取现有 assignment，通过 Game.getObjectById 验证
 * target/source 存在性，从 Memory 读取 layout.revision，
 * 调用纯函数 validateAssignmentRules 判断有效性。
 * 有效则续约 lease；无效则释放并调用纯函数 chooseTaskForRole 选择新任务。
 *
 * 无可用任务时返回 undefined — 角色应进入 idle 或回退行为。
 */
function requestAssignment(creep: Creep, ctx: TickContext): CreepAssignment | undefined {
  // 1. 验证现有 assignment。
  if (creep.memory.assignment) {
    const home = creep.memory.home ?? creep.room?.name ?? "";
    const layoutRevision = Memory.rooms[home]?.layout?.revision ?? 0;
    const assignment = creep.memory.assignment;

    // 通过 Game.getObjectById 检查 target/source 存在性。
    const targetExists = !assignment.targetId || Game.getObjectById(assignment.targetId) !== null;
    const sourceExists = !assignment.sourceId || Game.getObjectById(assignment.sourceId) !== null;

    if (validateAssignmentRules(assignment, ctx.tick, layoutRevision, targetExists, sourceExists)) {
      assignment.leaseUntil = ctx.tick + CONFIG.assignment.leaseDuration;
      return assignment;
    }

    // 无效 — 释放旧 assignment。
    releaseFromTask(creep);
    creep.memory.assignment = undefined;
  }

  // 2. 从预排序列表中选择新任务。
  const g = globalCache();
  if (!g.assignment || g.assignment.tick !== ctx.tick) return undefined;

  const home = creep.memory.home ?? creep.room?.name ?? "";
  const roomTasks = g.assignment.roomTasks.get(home);
  if (!roomTasks) return undefined;

  const role = creep.memory.role ?? "unknown";
  const chosen = chooseTaskForRole(role, roomTasks);
  if (!chosen) return undefined;

  const layoutRevision = Memory.rooms[home]?.layout?.revision ?? 0;
  const assignment: CreepAssignment = {
    id: chosen.id,
    kind: chosen.kind as CreepAssignment["kind"],
    targetId: chosen.targetId as Id<_HasId> | undefined,
    sourceId: chosen.sourceId as Id<Source> | undefined,
    revision: layoutRevision,
    assignedAt: ctx.tick,
    leaseUntil: ctx.tick + CONFIG.assignment.leaseDuration,
  };

  creep.memory.assignment = assignment;
  chosen.assignedCreeps.push(creep.name);
  return assignment;
}

/**
 * 查找紧急维修目标：按优先级检查 spawn/extension、tower、container。
 * 血量低于 50% 的第一个结构被返回。
 * 供 builder 回退和 tower-defense 共享，避免重复逻辑。
 */
export function findCriticalRepair(
  snapshot: RoomSnapshot,
): AnyStructure | undefined {
  // 按优先级分组检查：spawn/extension 优先，然后 tower，最后 container。
  const groups: readonly (readonly AnyStructure[])[] = [
    snapshot.spawns,
    snapshot.extensions,
    snapshot.towers,
    snapshot.containers,
  ];
  for (const group of groups) {
    for (const s of group) {
      if (s.hits < s.hitsMax * 0.5) {
        return s;
      }
    }
  }
  return undefined;
}

/** 检查 creep 是否应逃跑（有敌对单位且非战斗单位）。 */
export function shouldFlee(snapshot: RoomSnapshot): boolean {
  return snapshot.hostileCreeps.length > 0;
}

/**
 * 逃跑到安全位置 — 遵循约束 G-DF-02/03/09。
 * 策略分三级：
 *   1) spawn 比最近敌人更近时走向 spawn（塔防范围内）
 *   2) spawn 不可达时，走向敌人反向出口（避免冲向敌人）
 *   3) 无安全出口时走向任意最远出口
 * flee 期间释放普通 assignment（G-SM-05），仅移动不执行经济动作。
 */
export function flee(creep: Creep, snapshot: RoomSnapshot): void {
  // G-SM-05: flee 期间释放普通 assignment，仅移动到安全位置。
  if (creep.memory.assignment) {
    releaseFromTask(creep);
    creep.memory.assignment = undefined;
  }

  const nearestHostile = creep.pos.findClosestByRange(snapshot.hostileCreeps as Creep[]);

  // 策略 1：spawn 比最近敌人更近时走向 spawn（spawn 在安全侧、塔防范围内）。
  if (snapshot.spawns.length > 0 && nearestHostile) {
    const spawn = snapshot.spawns[0]!;
    const creepToSpawn = creep.pos.getRangeTo(spawn);
    const hostileToSpawn = nearestHostile.pos.getRangeTo(spawn);
    if (creepToSpawn < hostileToSpawn) {
      if (creepToSpawn > 3) {
        // G-DF-04: flee 期间使用 ignoreCreeps: false 以绕过阻挡。
        const result = creep.moveTo(spawn, { reusePath: 5, ignoreCreeps: false });
        if (result === OK || result === ERR_TIRED) recordTraffic(creep);
      }
      return;
    }
  }

  // 策略 2/3：spawn 不安全或不可达 — 走向敌人反向出口。
  if (nearestHostile) {
    const safeExit = findSafestExit(creep, nearestHostile.pos);
    if (safeExit) {
      const result = creep.moveTo(safeExit, { reusePath: 5, ignoreCreeps: false });
      if (result === OK || result === ERR_TIRED) recordTraffic(creep);
      return;
    }
  }

  // G-DF-03：已在 home 但 spawn 不安全且无安全出口时 —
  // 优先走向敌人反向出口（上面已尝试）；无出口时至少向 spawn 移动（比站着好）。
  const home = creep.memory.home;
  if (home && creep.room.name !== home) {
    moveTowardRoom(creep, home);
    return;
  }
  if (snapshot.spawns.length > 0) {
    const spawn = snapshot.spawns[0];
    if (spawn && creep.pos.getRangeTo(spawn) > 3) {
      const result = creep.moveTo(spawn, { reusePath: 5, ignoreCreeps: false });
      if (result === OK || result === ERR_TIRED) recordTraffic(creep);
    }
  }
}

/**
 * 查找最安全的出口 — 选择与敌人方向夹角最大的出口（约束 G-DF-09）。
 * 以敌人位置为圆心，按 Game.map.describeExits 获取所有可用出口方向，
 * 选择与敌人方向夹角最大的出口（即敌人反向出口）；
 * 若所有出口都同向则选最远出口。
 */
function findSafestExit(creep: Creep, enemyPos: RoomPosition): RoomPosition | undefined {
  const exits = Game.map.describeExits(creep.room.name);
  if (!exits) return undefined;

  const enemyDirX = enemyPos.x - 25;
  const enemyDirY = enemyPos.y - 25;

  const exitCandidates: { dir: number; dot: number }[] = [];
  for (const dirStr of Object.keys(exits)) {
    const dir = Number(dirStr);
    let exitVecX = 0;
    let exitVecY = 0;
    switch (dir) {
      case TOP: exitVecY = -1; break;                       // 1
      case RIGHT: exitVecX = 1; break;                       // 3
      case BOTTOM: exitVecY = 1; break;                      // 5
      case LEFT: exitVecX = -1; break;                       // 7
      default: continue; // 跳过对角出口（2,4,6,8）— findClosestByRange 不支持
    }
    // 点积越小 = 与敌人方向夹角越大 = 更安全。
    const dot = enemyDirX * exitVecX + enemyDirY * exitVecY;
    exitCandidates.push({ dir, dot });
  }

  if (exitCandidates.length === 0) return undefined;

  // 按点积升序排列（最小 = 与敌人方向夹角最大 = 反方向）。
  exitCandidates.sort((a, b) => a.dot - b.dot);

  // 有反方向出口（点积 < 0）时选反向；否则选最远（点积最大）。
  const hasOpposite = exitCandidates[0]!.dot < 0;
  const chosenDir = hasOpposite
    ? exitCandidates[0]!.dir
    : exitCandidates[exitCandidates.length - 1]!.dir;

  // chosenDir 此时一定是 1/3/5/7（正交方向）。
  return creep.pos.findClosestByRange(chosenDir as ExitConstant) ?? undefined;
}

/**
 * 获取或续约 creep 的任务分配（plan §5.7.2）。
 * 如果现有 assignment 有效则续约；否则从可用任务列表分配新的。
 * 无可用任务时返回 undefined — 角色应进入 idle 或回退行为。
 */
export function getAssignment(creep: Creep, ctx: TickContext): CreepAssignment | undefined {
  return requestAssignment(creep, ctx);
}

/** 释放 creep 的当前任务分配。 */
export function releaseAssignment(creep: Creep): void {
  releaseFromTask(creep);
  creep.memory.assignment = undefined;
}
