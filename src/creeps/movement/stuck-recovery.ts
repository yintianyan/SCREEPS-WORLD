/** 卡位检测与脱困 — yield/pull 让路、渐进式脱困、目标清除、安全出口。 */

import { CONFIG } from "../../config";
import { globalCache } from "../../kernel/global-cache";
import { releaseFromTask } from "../support/assignment-adapter";
import { recordTraffic } from "./traffic";

/** 方向 → (dx, dy) 偏移表。供 pathfinding 的前置绕路检测复用。 */
export const DIR_DELTA: Record<number, [number, number]> = {
  [TOP]: [0, -1], [TOP_RIGHT]: [1, -1], [RIGHT]: [1, 0], [BOTTOM_RIGHT]: [1, 1],
  [BOTTOM]: [0, 1], [BOTTOM_LEFT]: [-1, 1], [LEFT]: [-1, 0], [TOP_LEFT]: [-1, -1],
};

// ─── Yield/Pull 让路机制 ───

/**
 * 请求阻挡 creep 让路，存入 globalCache；目标 creep 在下次 moveToTarget/parkIdleCreep 时执行。
 * 同 tick 内低优请求高优让路时，因高优已执行过，请求下一 tick 生效。
 * MV-3：请求带 tick 戳 — 超过 2 tick 未执行即过期丢弃（否则 parked/静止 creep 恢复移动时突然
 * 执行「过期让路」，方向已无意义且无落点安全检查）。

 * 站桩矿工不应让位，绕行 creep 应靠 ignoreCreeps:false 自行绕路。
 */
const YIELD_REQUEST_TTL = 2;

function requestYield(blockerName: string, dir: number): void {
  const g = globalCache() as any;
  if (!g.__yieldRequests) g.__yieldRequests = {};
  g.__yieldRequests[blockerName] = { dir, tick: Game.time };
}

/**
 * 检查并执行让路请求。在 moveToTarget/parkIdleCreep 开头调用——被请求让路时立即移动并返回 true。
 * MV-3：parked idle creep 本就无任务、最该让路——parking 入口接通后让路机制对静止目标不再失效。
 */
export function checkAndExecuteYield(creep: Creep): boolean {
  const g = globalCache() as any;
  if (!g.__yieldRequests) return false;
  const req = g.__yieldRequests[creep.name] as { dir: number; tick: number } | number | undefined;
  if (req === undefined) return false;
  delete g.__yieldRequests[creep.name];
  // 兼容旧格式（纯数字）— global reset 前的残留。
  const dir = typeof req === "number" ? req : req.dir;
  const requestedAt = typeof req === "number" ? Game.time : req.tick;
  // 过期请求丢弃：方向已无意义，执行只会产生随机位移。
  if (Game.time - requestedAt > YIELD_REQUEST_TTL) return false;
  const result = creep.move(dir as DirectionConstant);
  if (result === OK || result === ERR_TIRED) {
    recordTraffic(creep);
  }
  return true;
}

/**
 * 尝试让阻挡 creep 让路（Level 1 脱困）。找到目标方向上的 creep，请求它沿同方向移动。
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

// ─── 卡位检测 ───

/**
 * 更新卡位计数。仅在值变化时写 Memory，减少 Proxy 开销。返回当前 stuckTicks。
 * MV-1（G-MV-06/G-MEM-07 落地）：疲劳期不增不减 — ERR_TIRED 是正常疲劳机制不是卡位；
 * 无豁免则满载 creep 过沼泽疲劳 ~5 tick 即被误判卡死 → L3 弃目标携货转 idle（任务 churn + 重寻路）。
 */
export function updateStuckTicks(creep: Creep): number {
  if (creep.fatigue > 0) return creep.memory.stuckTicks ?? 0;
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

// ─── 目标清除 ───

/** 清除 creep 的目标和分配，进入安全空闲。 */
export function clearTarget(creep: Creep): void {
  releaseFromTask(creep);
  creep.memory.targetId = undefined;
  creep.memory.assignment = undefined;
  creep.memory.stuckTicks = 0;
}

// ─── 安全出口 ───

/** 查找最安全的出口 — 选择与敌人方向夹角最大的出口（约束 G-DF-09）。用 dot-product 评分：负 dot = 与敌人方向相反 = 最安全。 */
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
