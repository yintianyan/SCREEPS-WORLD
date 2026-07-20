import { CONFIG } from "../../config";

/** 每个 RCL 允许的最大各类型结构数。 */
export function maxStructures(structureType: BuildableStructureConstant, rcl: number): number {
  return (CONTROLLER_STRUCTURES[structureType]?.[rcl]) ?? 0;
}

/** 统计房间内某类型的已建结构 + 排队 site 数。 */
export function countStructures(
  snapshot: import("../../kernel/contracts").RoomSnapshot,
  structureType: BuildableStructureConstant,
): number {
  const built = countBuilt(snapshot, structureType);
  const sites = snapshot.constructionSites.filter(s => s.structureType === structureType).length;
  return built + sites;
}

function countBuilt(
  snapshot: import("../../kernel/contracts").RoomSnapshot,
  structureType: BuildableStructureConstant,
): number {
  switch (structureType) {
    case STRUCTURE_SPAWN:
      return snapshot.spawns.length;
    case STRUCTURE_EXTENSION:
      return snapshot.extensions.length;
    case STRUCTURE_TOWER:
      return snapshot.towers.length;
    case STRUCTURE_CONTAINER:
      return snapshot.containers.length;
    case STRUCTURE_STORAGE:
      return snapshot.storage ? 1 : 0;
    default:
      return 0;
  }
}

/**
 * 根据 RCL 为缺失结构生成建造任务。
 * extension 使用围绕主 spawn 的简单螺旋布局。
 */
export function generateBuildTasks(
  snapshot: import("../../kernel/contracts").RoomSnapshot,
): BuildTask[] {
  if (snapshot.spawns.length === 0) return [];

  const tasks: BuildTask[] = [];
  const spawn = snapshot.spawns[0]!;
  const rcl = snapshot.rcl;

  // Extension — 围绕 spawn 螺旋布局。
  const maxExtensions = maxStructures(STRUCTURE_EXTENSION, rcl);
  const currentExtensions = countStructures(snapshot, STRUCTURE_EXTENSION);
  if (currentExtensions < maxExtensions) {
    const positions = spiralPositions(spawn.pos, 2, maxExtensions, snapshot);
    for (let i = currentExtensions; i < maxExtensions; i++) {
      const pos = positions[i];
      if (!pos) continue;
      tasks.push(createBuildTask(`ext-${i}`, pos, STRUCTURE_EXTENSION, 1));
    }
  }

  // 每个 source 旁的 container（RCL2+）。
  if (rcl >= 2) {
    const maxContainers = maxStructures(STRUCTURE_CONTAINER, rcl);
    const currentContainers = countStructures(snapshot, STRUCTURE_CONTAINER);
    if (currentContainers < maxContainers && currentContainers < snapshot.sources.length) {
      for (let i = currentContainers; i < Math.min(maxContainers, snapshot.sources.length); i++) {
        const source = snapshot.sources[i];
        if (!source) continue;
        const pos = findAdjacentBuildable(source.pos, snapshot);
        if (pos) {
          tasks.push(createBuildTask(`container-source-${i}`, pos, STRUCTURE_CONTAINER, 1));
        }
      }
    }
  }

  // Tower（RCL3+）。
  if (rcl >= 3) {
    const maxTowers = maxStructures(STRUCTURE_TOWER, rcl);
    const currentTowers = countStructures(snapshot, STRUCTURE_TOWER);
    if (currentTowers < maxTowers) {
      const positions = spiralPositions(spawn.pos, 3, maxTowers, snapshot);
      for (let i = currentTowers; i < maxTowers; i++) {
        const pos = positions[i];
        if (!pos) continue;
        tasks.push(createBuildTask(`tower-${i}`, pos, STRUCTURE_TOWER, 0));
      }
    }
  }

  // Storage（RCL4+）。
  if (rcl >= 4 && !snapshot.storage) {
    const maxStorage = maxStructures(STRUCTURE_STORAGE, rcl);
    if (maxStorage > 0) {
      const pos = findAdjacentBuildable(spawn.pos, snapshot, 2);
      if (pos) {
        tasks.push(createBuildTask("storage-0", pos, STRUCTURE_STORAGE, 1));
      }
    }
  }

  return tasks;
}

function createBuildTask(
  key: string,
  pos: { x: number; y: number; roomName: string },
  structureType: BuildableStructureConstant,
  priority: 0 | 1 | 2 | 3,
): BuildTask {
  return {
    key,
    pos,
    structureType,
    priority,
    state: "queued",
    attempts: 0,
    retryAt: 0,
  };
}

/**
 * 围绕中心点生成螺旋位置，自动跳过墙壁和已占用格子。
 * 通过地形过滤避免在不可建造位置创建任务。
 */
function spiralPositions(
  center: RoomPosition,
  startRadius: number,
  count: number,
  snapshot: import("../../kernel/contracts").RoomSnapshot,
): Array<{ x: number; y: number; roomName: string }> {
  const room = Game.rooms[center.roomName];
  if (!room) return [];
  const terrain = room.getTerrain();

  // 预构建已占用位置集合，避免每次迭代创建大数组。
  const occupiedSet = buildOccupiedSet(snapshot);

  const positions: Array<{ x: number; y: number; roomName: string }> = [];
  let radius = startRadius;
  while (positions.length < count && radius < 10) {
    for (let dx = -radius; dx <= radius && positions.length < count; dx++) {
      for (let dy = -radius; dy <= radius && positions.length < count; dy++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const x = center.x + dx;
        const y = center.y + dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        if (occupiedSet.has(`${x},${y}`)) continue;
        positions.push({ x, y, roomName: center.roomName });
      }
    }
    radius++;
  }
  return positions;
}

/** 预构建已占用位置集合，供螺旋布局和邻位查找复用。 */
function buildOccupiedSet(snapshot: import("../../kernel/contracts").RoomSnapshot): Set<string> {
  const occupiedSet = new Set<string>();
  for (const s of [
    ...snapshot.spawns,
    ...snapshot.extensions,
    ...snapshot.containers,
    ...snapshot.towers,
    ...snapshot.constructionSites,
  ]) {
    occupiedSet.add(`${s.pos.x},${s.pos.y}`);
  }
  if (snapshot.storage) {
    occupiedSet.add(`${snapshot.storage.pos.x},${snapshot.storage.pos.y}`);
  }
  return occupiedSet;
}

/** 查找目标相邻的可建造位置。 */
function findAdjacentBuildable(
  pos: RoomPosition,
  snapshot: import("../../kernel/contracts").RoomSnapshot,
  range: number = 1,
): { x: number; y: number; roomName: string } | undefined {
  const room = Game.rooms[pos.roomName];
  if (!room) return undefined;
  const terrain = room.getTerrain();
  const occupiedSet = buildOccupiedSet(snapshot);

  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = pos.x + dx;
      const y = pos.y + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (occupiedSet.has(`${x},${y}`)) continue;
      return { x, y, roomName: pos.roomName };
    }
  }
  return undefined;
}


