/**
 * 卡位检测与脱困 — yield/pull 让路、渐进式脱困、目标清除、安全出口。
 *
 * 脱困四级策略（由 pathfinding.ts 的 moveToTarget 驱动）：
 *   Level 0（正常）：ignoreCreeps: true + road-preference
 *   Level 1（stuckTicks >= threshold）：tryPullBlocker 请求让路
 *   Level 2（stuckTicks >= threshold+1）：ignoreCreeps: false + reusePath: 0
 *   Level 3（stuckTicks >= threshold+repathLimit）：放弃目标，idle
 */

import { CONFIG } from "../config";
import { globalCache } from "../kernel/global-cache";
import { releaseFromTask } from "./assignment-adapter";
import { recordTraffic } from "./traffic";

/** 方向 → (dx, dy) 偏移表。 */
const DIR_DELTA: Record<number, [number, number]> = {
  [TOP]: [0, -1], [TOP_RIGHT]: [1, -1], [RIGHT]: [1, 0], [BOTTOM_RIGHT]: [1, 1],
  [BOTTOM]: [0, 1], [BOTTOM_LEFT]: [-1, 1], [LEFT]: [-1, 0], [TOP_LEFT]: [-1, -1],
};

// ─── Yield/Pull 让路机制 ─────────────────────────────────

/**
 * 请求阻挡 creep 让路。
 * 将让路请求存入 globalCache，目标 creep 在下一次 moveToTarget 调用时执行。
 * 同 tick 内优先级低的 creep 请求优先级高的 creep 让路时，
 * 由于高优先级 creep 已经执行过，请求会在下一 tick 生效。
 *
 * 设计意图：对静止 creep（如 harvester 站桩采矿）请求无效是正确行为——
 * 它们不调用 moveToTarget，请求自然过期。站桩矿工不应让出矿位，
 * 否则会导致采集效率崩塌。绕行 creep 应通过 ignoreCreeps:false 自行绕路。
 */
function requestYield(blockerName: string, dir: number): void {
  const g = globalCache() as any;
  if (!g.__yieldRequests) g.__yieldRequests = {};
  g.__yieldRequests[blockerName] = dir;
}

/**
 * 检查并执行让路请求。
 * 在 moveToTarget 开头调用 — 如果其他 creep 请求本 creep 让路，
 * 立即执行移动并返回 true（本 tick 不再执行其他移动逻辑）。
 */
export function checkAndExecuteYield(creep: Creep): boolean {
  const g = globalCache() as any;
  if (!g.__yieldRequests) return false;
  const dir = g.__yieldRequests[creep.name] as number | undefined;
  if (dir === undefined) return false;
  delete g.__yieldRequests[creep.name];
  const result = creep.move(dir as DirectionConstant);
  if (result === OK || result === ERR_TIRED) {
    recordTraffic(creep);
  }
  return true;
}

/**
 * 尝试让阻挡 creep 让路（Level 1 脱困）。
 * 找到目标方向上的 creep，请求它沿同方向移动。
 */
export function tryPullBlocker(creep: Creep, targetPos: RoomPosition): void {
  const dir = creep.pos.getDirectionTo(targetPos);
  const delta = DIR_DELTA[dir];
  if (!delta) return;
  const nextX = creep.pos.x + delta[0];
  const nextY = creep.pos.y + delta[1];
  if (nextX < 0 || nextX > 49 || nextY < 0 || nextY > 49) return;

  const blockers = creep.room.lookForAt(LOOK_CREEPS, nextX, nextY);
  if (blockers.length > 0) {
    const blocker = blockers[0]!;
    requestYield(blocker.name, dir);
  }
}

// ─── 卡位检测 ─────────────────────────────────────────────

/**
 * 更新卡位计数。仅在值变化时写 Memory，减少 Proxy 开销。
 * 返回当前 stuckTicks。
 */
export function updateStuckTicks(creep: Creep): number {
  const currentPacked = creep.pos.x * 50 + creep.pos.y;
  const prevStuck = creep.memory.stuckTicks ?? 0;

  if (creep.memory.lastPos === currentPacked) {
    if (prevStuck === 0) creep.memory.stuckTicks = 1;
    else creep.memory.stuckTicks = prevStuck + 1;
  } else if (prevStuck !== 0) {
    creep.memory.stuckTicks = 0;
  }
  if (creep.memory.lastPos !== currentPacked) {
    creep.memory.lastPos = currentPacked;
  }

  return creep.memory.stuckTicks ?? 0;
}

// ─── 目标清除 ─────────────────────────────────────────────

/** 清除 creep 的目标和分配，进入安全空闲。 */
export function clearTarget(creep: Creep): void {
  releaseFromTask(creep);
  creep.memory.targetId = undefined;
  creep.memory.assignment = undefined;
  creep.memory.stuckTicks = 0;
}

// ─── 安全出口 ─────────────────────────────────────────────

/**
 * 查找最安全的出口 — 选择与敌人方向夹角最大的出口（约束 G-DF-09）。
 * 用 dot-product 评分：负 dot = 与敌人方向相反 = 最安全。
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
