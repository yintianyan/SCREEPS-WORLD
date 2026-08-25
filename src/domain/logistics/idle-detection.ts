/**
 * Idle Detection — A4.3 Phase 3：闲置检测。
 *
 * 合同锚点：A4.3 Architecture Audit §10 #24。
 *
 * 设计意图：
 *   检测长期无任务的 hauler，供 Hauler Scaling 做缩编决策。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

// ─── 闲置 Hauler 摘要 ──────────────────────────────────────

/**
 * Hauler 摘要（由系统侧从 Game.creeps 收集后注入）。
 */
export interface HaulerIdleSummary {
  /** Creep 名称。 */
  name: string;
  /** 最近一次执行动作的 tick（withdraw/transfer/move）。 */
  lastActionTick: number;
  /** 剩余寿命。 */
  ticksToLive: number;
  /** 角色。 */
  role: string;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 检测闲置 hauler。
 *
 * 闲置定义：lastActionTick 距当前 tick 超过 idleThreshold。
 *
 * 纯函数。
 *
 * @param haulers hauler 摘要列表
 * @param currentTick 当前 tick
 * @param idleThreshold 闲置阈值（tick）
 * @returns 闲置 hauler 名称列表
 */
export function detectIdleHaulers(
  haulers: readonly HaulerIdleSummary[],
  currentTick: number,
  idleThreshold: number,
): string[] {
  const idle: string[] = [];
  for (const h of haulers) {
    // 不回收快死的（让它自然死）
    if (h.ticksToLive < 50) continue;
    const idleTicks = currentTick - h.lastActionTick;
    if (idleTicks > idleThreshold) {
      idle.push(h.name);
    }
  }
  return idle;
}

/**
 * 计算房间内闲置 hauler 比例。
 * 纯函数。
 */
export function idleRatio(
  haulers: readonly HaulerIdleSummary[],
  currentTick: number,
  idleThreshold: number,
): number {
  if (haulers.length === 0) return 0;
  const idleCount = detectIdleHaulers(haulers, currentTick, idleThreshold).length;
  return idleCount / haulers.length;
}

/**
 * 判断是否需要缩编（闲置率过高）。
 * 纯函数。
 */
export function shouldShrink(
  haulers: readonly HaulerIdleSummary[],
  currentTick: number,
  idleThreshold: number,
  shrinkThreshold: number = 0.5,
): boolean {
  return idleRatio(haulers, currentTick, idleThreshold) > shrinkThreshold;
}
