/**
 * Site 配额管理 — construction-manager 与 remote-mining-manager 的共享账本。
 *
 * 两个维度严格分离（P0-A 评审修正）：
 *   1. **tick 速率**：每 tick 全局最多 1 个 normal site + 1 个 emergency site。
 *      normal 槽位自有房与远矿公平竞争；远矿 site 永远让位自有房 emergency。
 *   2. **总存量**：ctx.globalSiteCount（自有房快照）+ Σ remoteOps.siteCount（远矿）
 *      < CONFIG.construction.maxGlobalSites。emergency 豁免自设限额。
 *
 * 设计约束（红线）：
 *   - 不得用 Game.constructionSites 全量遍历替代账本（每 tick O(n) 对象遍历换省心）。
 *   - remoteOps.siteCount 必须带实测校正（site 建成/失效即减），禁止只增不减。
 */
import { globalCache } from "../kernel/global-cache";

/**
 * 本 tick 远矿 site 总量（Σ 非 abandoned remoteOps.siteCount）。
 * per-tick 惰性缓存 — construction-manager 与 remote-mining-manager 同 tick 读到同一值。
 * siteCount 由 remote-mining-manager 每 managerInterval tick 用 lookForAtArea 实测校正，
 * 此函数只做求和，不做校正。
 */
export function getRemoteSiteTotal(): number {
  const g = globalCache();
  if (g.remoteSiteTotal && g.remoteSiteTotal.tick === Game.time) {
    return g.remoteSiteTotal.count;
  }
  let count = 0;
  for (const roomName in Memory.rooms) {
    const ops = Memory.rooms[roomName]?.remoteOps;
    if (!ops) continue;
    for (const op of Object.values(ops)) {
      if (op.state === "abandoned") continue;
      count += op.siteCount ?? 0;
    }
  }
  g.remoteSiteTotal = { tick: Game.time, count };
  return count;
}

/**
 * 本 tick 全局 site 创建计数器（normal + emergency 两个独立槽位）。
 * per-tick 惰性初始化，global reset 后自然重建。
 *
 * 仲裁规则：
 *   - normal 槽位（每 tick 1 个）：construction-manager 普通建造与远矿 container 公平竞争，先到先得。
 *   - emergency 槽位（每 tick 1 个）：仅 construction-manager 紧急重建使用，独立计额。
 *   - 远矿 site 让位 emergency：远矿调用方须额外检查 emergency > 0 并跳过（即使 normal 空闲）。
 *   - construction-manager 的 normal 与 emergency 独立：同 tick 可创建 1 emergency + 1 normal。
 */
export interface TickSiteCounters {
  /** 本 tick 已创建的 normal site 数（>= 1 表示槽位已用尽）。 */
  readonly normal: number;
  /** 本 tick 已创建的 emergency site 数。 */
  readonly emergency: number;
  /** normal 槽位是否可用（仅看 normal === 0，与 emergency 独立）。 */
  readonly canCreateNormal: boolean;
  /** emergency 槽位是否可用（仅看 emergency === 0）。 */
  readonly canCreateEmergency: boolean;
  /** 标记本 tick 已创建 1 个 normal site。 */
  markNormal: () => void;
  /** 标记本 tick 已创建 1 个 emergency site。 */
  markEmergency: () => void;
}

/** 获取本 tick 的 site 创建计数器（per-tick 惰性初始化）。 */
export function getTickSiteCounters(): TickSiteCounters {
  const g = globalCache();
  if (!g.sitesCreatedThisTick || g.sitesCreatedThisTick.tick !== Game.time) {
    g.sitesCreatedThisTick = { tick: Game.time, normal: 0, emergency: 0 };
  }
  const entry = g.sitesCreatedThisTick;
  return {
    get normal() { return entry.normal; },
    get emergency() { return entry.emergency; },
    // normal 与 emergency 独立计额：construction-manager 可同 tick 创建两者。
    // 远矿让位 emergency 由远矿调用方自行检查 emergency > 0。
    get canCreateNormal() { return entry.normal === 0; },
    get canCreateEmergency() { return entry.emergency === 0; },
    markNormal: () => { entry.normal++; },
    markEmergency: () => { entry.emergency++; },
  };
}
