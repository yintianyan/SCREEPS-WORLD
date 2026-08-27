/** Power Bank 野采决策 — 纯函数层（审计缺口 2：power 供给自给）。 */

/** PB 目标候选（执行层从各 home 的 intel 采集）。 */
export interface PowerBankCandidate {
  roomName: string;
  /** intel 归属 home（sponsor 候选 — 就近出兵）。 */
  home: string;
  lastSeen: number;
  powerBank: boolean;
  /** 与 sponsor 的线性距离（roomLinearDistance 口径）。 */
  linearDistance: number;
  /** 我方正在占用该房（远矿 op/扩张目标）— PB 房通常 highway，占用的不选。 */
  occupied: boolean;
}

/** selectPowerBankTarget 的选项。 */
export interface PowerFarmOptions {
  /** intel 新鲜度上限（tick）— PB 5000 tick 消失，旧情报大概率已扑空。 */
  freshness: number;
  /** 派遣最大线性距离（房）。 */
  maxRange: number;
}

/** 选择野采目标：新鲜 intel 确认 PB 存在 + 距离内 + 未占用，最近者优先。 */
export function selectPowerBankTarget(
  candidates: readonly PowerBankCandidate[],
  tick: number,
  opts: PowerFarmOptions,
): PowerBankCandidate | undefined {
  let best: PowerBankCandidate | undefined;
  for (const c of candidates) {
    if (!c.powerBank) continue;
    if (c.occupied) continue;
    if (tick - c.lastSeen > opts.freshness) continue;
    if (c.linearDistance > opts.maxRange) continue;
    if (!best || c.linearDistance < best.linearDistance) best = c;
  }
  return best;
}

/**
 * 野采任务是否超时收摊（编队往返 + 击破 + collector 捡运的总预算）。
 * PB 自身 5000 tick 消失 — 超时大概率 PB 已没了，止损回收编队。
 */
export function isPowerFarmTimedOut(since: number, tick: number, timeout: number): boolean {
  return tick - since > timeout;
}

/**
 * 战损止损：spawned（累计提交孵化请求数）超编队规模 × 倍数判消耗失败。
 * PB 房无塔（highway），超编队损耗只可能是路途 NPC/玩家截杀 — 止损停手。
 */
export function isPowerFarmAttritionLost(
  spawned: number,
  squadTotal: number,
  casualtyMultiplier: number,
): boolean {
  return spawned > squadTotal * casualtyMultiplier;
}
