import { CONFIG } from "../config";
import { globalCache } from "../kernel/global-cache";
import { releaseFromTask } from "./assignment-adapter";

/** 将 RoomPosition 压缩为单个数字：x * 50 + y。 */
export function packPos(pos: RoomPosition): number {
  return pos.x * 50 + pos.y;
}

/**
 * 记录 creep 当前位置的交通热度，供道路规划器使用。
 * 在 creep 移动时调用，累加到 global.roomTraffic 缓存。
 */
export function recordTraffic(creep: Creep): void {
  const g = globalCache();
  if (!g.roomTraffic) g.roomTraffic = {};
  const roomName = creep.room.name;
  if (!g.roomTraffic[roomName]) g.roomTraffic[roomName] = {};
  const key = `${creep.pos.x},${creep.pos.y}`;
  g.roomTraffic[roomName][key] = (g.roomTraffic[roomName][key] ?? 0) + 1;
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

/**
 * 查找最安全的出口 — 选择与敌人方向夹角最大的出口（约束 G-DF-09）。
 * 以敌人位置为圆心，按 Game.map.describeExits 获取所有可用出口方向，
 * 选择与敌人方向夹角最大的出口（即敌人反向出口）；
 * 若所有出口都同向则选最远出口。
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
