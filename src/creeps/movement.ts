import { CONFIG } from "../config";
import { globalCache } from "../kernel/global-cache";
import { releaseFromTask } from "./assignment-adapter";

/** 将 RoomPosition 压缩为单个数字：x * 50 + y。 */
export function packPos(pos: RoomPosition): number {
  return pos.x * 50 + pos.y;
}

// ─── Traffic 记录（numeric key）────────────────────────────

/**
 * 记录 creep 当前位置的交通热度，供道路规划器使用。
 * 使用 numeric packed key（x*50+y）替代字符串拼接，减少 GC 压力。
 */
export function recordTraffic(creep: Creep): void {
  const g = globalCache();
  if (!g.roomTraffic) g.roomTraffic = {};
  const roomName = creep.room.name;
  if (!g.roomTraffic[roomName]) g.roomTraffic[roomName] = {};
  const key = String(creep.pos.x * 50 + creep.pos.y);
  g.roomTraffic[roomName][key] = (g.roomTraffic[roomName][key] ?? 0) + 1;
}

// ─── CostMatrix 缓存（结构层 — 叠加在引擎地形矩阵之上）────

interface CostMatrixCache {
  matrix: CostMatrix;
  /** 结构数量 hash — 数量变化时重建（比 tick 轮询精确且廉价）。 */
  structureCount: number;
}

/**
 * 获取房间的结构层 CostMatrix — 仅标记结构/工地的通行性。
 *
 * 设计：不替代引擎地形矩阵，而是叠加。
 * 引擎 moveTo 的 costCallback 接收已含地形成本的矩阵（plain=1, swamp=5, wall=255），
 * 我们在其上修改结构成本后返回 void（不 return 新矩阵），保留地形。
 *
 * 权重：
 *   road         = 1  （覆盖地形，最低成本）
 *   container    = 2  （可通行）
 *   自有 rampart = 2  （可通行）
 *   其他结构     = 255（不可通行）
 *   非 road/container 工地 = 255（不可通行）
 *
 * 失效策略：结构数量变化 → 重建（O(1) 检查，比 100 tick 轮询精确）。
 */
function getStructureMatrix(roomName: string): CostMatrix | undefined {
  const g = globalCache() as any;
  if (!g.__costMatrices) g.__costMatrices = {};

  const room = Game.rooms[roomName];
  if (!room) return undefined;

  // 廉价 hash：结构 + 工地总数。数量变化 → 缓存失效。
  const structures = room.find(FIND_STRUCTURES);
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  const count = structures.length + sites.length;

  const cached: CostMatrixCache | undefined = g.__costMatrices[roomName];
  if (cached && cached.structureCount === count) {
    return cached.matrix;
  }

  // 重建结构层矩阵。
  const matrix = new PathFinder.CostMatrix();

  for (const s of structures) {
    if (s.structureType === STRUCTURE_ROAD) {
      matrix.set(s.pos.x, s.pos.y, 1);
    } else if (s.structureType === STRUCTURE_CONTAINER) {
      matrix.set(s.pos.x, s.pos.y, 2);
    } else if (s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my) {
      matrix.set(s.pos.x, s.pos.y, 2);
    } else {
      matrix.set(s.pos.x, s.pos.y, 255);
    }
  }

  for (const site of sites) {
    if (site.structureType !== STRUCTURE_ROAD && site.structureType !== STRUCTURE_CONTAINER) {
      matrix.set(site.pos.x, site.pos.y, 255);
    }
  }

  g.__costMatrices[roomName] = { matrix, structureCount: count };
  return matrix;
}

/**
 * costCallback — 将结构层成本叠加到引擎传入的地形矩阵上。
 * 不 return 新矩阵（返回 void），引擎继续使用修改后的原矩阵（保留地形成本）。
 */
function structureCostCallback(roomName: string, matrix: CostMatrix): void {
  const structMatrix = getStructureMatrix(roomName);
  if (!structMatrix) return;

  // 将结构层非零值叠加到地形矩阵。
  // CostMatrix 没有遍历 API，但我们的结构数量有限（RCL3 ~30 个），
  // 逐 cell 检查 50x50 太贵。改为：只在结构位置覆写。
  // 由于我们无法遍历 structMatrix，改用缓存的结构位置列表。
  const g = globalCache() as any;
  if (!g.__structPositions) g.__structPositions = {};
  const positions: number[] | undefined = g.__structPositions[roomName];
  if (!positions) return;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const cost = positions[i + 2]!;
    matrix.set(x, y, cost);
  }
}

/**
 * 获取房间的结构层 CostMatrix 并缓存结构位置列表（供 costCallback 快速叠加）。
 * 在 getStructureMatrix 重建时同步更新位置列表。
 */
function getStructureMatrixWithPositions(roomName: string): CostMatrix | undefined {
  const g = globalCache() as any;
  if (!g.__costMatrices) g.__costMatrices = {};
  if (!g.__structPositions) g.__structPositions = {};

  const room = Game.rooms[roomName];
  if (!room) return undefined;

  const structures = room.find(FIND_STRUCTURES);
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  const count = structures.length + sites.length;

  const cached: CostMatrixCache | undefined = g.__costMatrices[roomName];
  if (cached && cached.structureCount === count) {
    return cached.matrix;
  }

  // 重建。
  const matrix = new PathFinder.CostMatrix();
  const positions: number[] = [];

  for (const s of structures) {
    let cost: number;
    if (s.structureType === STRUCTURE_ROAD) {
      cost = 1;
    } else if (s.structureType === STRUCTURE_CONTAINER) {
      cost = 2;
    } else if (s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my) {
      cost = 2;
    } else {
      cost = 255;
    }
    matrix.set(s.pos.x, s.pos.y, cost);
    positions.push(s.pos.x, s.pos.y, cost);
  }

  for (const site of sites) {
    if (site.structureType !== STRUCTURE_ROAD && site.structureType !== STRUCTURE_CONTAINER) {
      matrix.set(site.pos.x, site.pos.y, 255);
      positions.push(site.pos.x, site.pos.y, 255);
    }
  }

  g.__costMatrices[roomName] = { matrix, structureCount: count };
  g.__structPositions[roomName] = positions;
  return matrix;
}

// ─── 自适应 reusePath ─────────────────────────────────────

/**
 * 根据距离计算 reusePath 值。
 *
 * 短距离（<=3）：reusePath 3 — 目标变化快（fillTarget 被填满），需要快速重算。
 * 中距离（4-10）：reusePath 5 — 平衡缓存命中和路径新鲜度。
 * 长距离（>10）：reusePath 15 — 路径稳定，减少 PathFinder 调用。
 */
function adaptiveReusePath(creep: Creep, target: RoomPosition): number {
  const range = creep.pos.getRangeTo(target);
  if (range <= 3) return 3;
  if (range <= 10) return 5;
  return 15;
}

// ─── 同 tick 路径共享 ─────────────────────────────────────

/**
 * 同 tick 内多 creep 走向同一目标时，共享序列化路径。
 * 首个 creep 计算路径后存入缓存，后续 creep 直接复用。
 * key = `${roomName}:${packedTarget}`，每 tick 清空。
 */
function getPathShareCache(): Map<string, string> {
  const g = globalCache() as any;
  if (!g.__pathShare || g.__pathShareTick !== Game.time) {
    g.__pathShare = new Map();
    g.__pathShareTick = Game.time;
  }
  return g.__pathShare as Map<string, string>;
}

// ─── 核心移动函数 ─────────────────────────────────────────

/** 向目标房间方向移动（通过最近出口），带道路优先。 */
export function moveTowardRoom(creep: Creep, targetRoom: string): void {
  const exitDir = creep.room.findExitTo(targetRoom) as number;
  if (exitDir < 0) return;
  const exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
  if (exit) {
    const result = creep.moveTo(exit, {
      reusePath: 5,
      plainCost: 2,
      swampCost: 10,
      costCallback: structureCostCallback,
    });
    if (result === OK || result === ERR_TIRED) {
      recordTraffic(creep);
    }
  }
}

/**
 * 确保 creep 已设置 home 房间；不在 home 时尝试向 home 方向移动。
 * 只有 creep 实际在 home 房间内时才返回 true。
 */
export function ensureHome(creep: Creep): boolean {
  if (!creep.memory.home) {
    creep.memory.home = creep.room.name;
  }
  const home = creep.memory.home;
  if (creep.room.name === home) return true;
  moveTowardRoom(creep, home);
  return false;
}

/**
 * 移动到目标 — 带自适应路径缓存、道路优先、渐进式脱困、同 tick 路径共享。
 *
 * 脱困三级策略：
 *   Level 0（正常）：ignoreCreeps: true + road-preference
 *   Level 1（stuckTicks >= stuckThreshold）：ignoreCreeps: false（绕过阻挡 creep）
 *   Level 2（stuckTicks >= stuckThreshold + 1）：reusePath: 0 强制重算路径
 *   Level 3（stuckTicks >= stuckThreshold + repathLimit）：放弃，清除目标，idle
 *
 * 仅在操作返回 ERR_NOT_IN_RANGE 时调用。
 */
export function moveToTarget(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
): ScreepsReturnCode {
  const pos = "pos" in target ? target.pos : target;

  // ── 短路：range <= 1 时直接 move，跳过 PathFinder（0.05ms/creep 的纯浪费）。──
  const range = creep.pos.getRangeTo(pos);
  if (range <= 1) {
    const dir = creep.pos.getDirectionTo(pos);
    const result = creep.move(dir);
    if (result === OK || result === ERR_TIRED) {
      recordTraffic(creep);
    }
    return result;
  }

  // ── 卡位检测 ──
  const currentPacked = packPos(creep.pos);
  if (creep.memory.lastPos === currentPacked) {
    creep.memory.stuckTicks = (creep.memory.stuckTicks ?? 0) + 1;
  } else {
    creep.memory.stuckTicks = 0;
  }
  creep.memory.lastPos = currentPacked;

  const stuckTicks = creep.memory.stuckTicks ?? 0;
  const { stuckThreshold, repathLimit } = CONFIG.kernel;

  // Level 3：超过总限制 — 放弃目标，让角色下 tick 重新评估。
  if (stuckTicks >= stuckThreshold + repathLimit) {
    clearTarget(creep);
    creep.memory.mode = "idle";
    return ERR_NO_PATH;
  }

  // ── 构建 MoveToOpts ──
  const reusePath = stuckTicks >= stuckThreshold + 1 ? 0 : adaptiveReusePath(creep, pos);
  const ignoreCreeps = stuckTicks < stuckThreshold;

  // 确保结构位置列表已缓存（供 costCallback 使用）。
  getStructureMatrixWithPositions(creep.room.name);

  const options: MoveToOpts = {
    reusePath,
    maxRooms: 1,
    ignoreCreeps,
    // 道路优先：引擎默认 road=1，plain=2 使道路成本仅为 plain 的一半。
    plainCost: 2,
    swampCost: 10,
    // 叠加结构层（不可通行结构 + road 覆写）。修改传入矩阵，不 return 新矩阵。
    costCallback: structureCostCallback,
  };

  const result = creep.moveTo(pos, options);
  if (result === OK || result === ERR_TIRED) {
    recordTraffic(creep);
  }
  return result;
}

/** 清除 creep 的目标和分配，进入安全空闲。 */
export function clearTarget(creep: Creep): void {
  releaseFromTask(creep);
  creep.memory.targetId = undefined;
  creep.memory.assignment = undefined;
  creep.memory.stuckTicks = 0;
}

// ─── Flee 辅助 ────────────────────────────────────────────

/**
 * 查找最安全的出口 — 选择与敌人方向夹角最大的出口（约束 G-DF-09）。
 */
export function findSafestExit(creep: Creep, enemyPos: RoomPosition): RoomPosition | undefined {
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
      case TOP: exitVecY = -1; break;
      case RIGHT: exitVecX = 1; break;
      case BOTTOM: exitVecY = 1; break;
      case LEFT: exitVecX = -1; break;
      default: continue;
    }
    const dot = enemyDirX * exitVecX + enemyDirY * exitVecY;
    exitCandidates.push({ dir, dot });
  }

  if (exitCandidates.length === 0) return undefined;

  exitCandidates.sort((a, b) => a.dot - b.dot);

  const hasOpposite = exitCandidates[0]!.dot < 0;
  const chosenDir = hasOpposite
    ? exitCandidates[0]!.dir
    : exitCandidates[exitCandidates.length - 1]!.dir;

  return creep.pos.findClosestByRange(chosenDir as ExitConstant) ?? undefined;
}
