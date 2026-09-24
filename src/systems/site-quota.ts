/** Site 配额管理 — construction-manager 与 remote-mining-manager 的共享账本。 */
import { globalCache } from "../kernel/global-cache";

/**
 * 本 tick 远矿 site 总量（Σ 非 abandoned remoteOps.siteCount）。
 * per-tick 惰性缓存，construction-manager 与 remote-mining-manager 同 tick 读到同一值；
 * 校正（lookForAtArea 实测）由 remote-mining-manager 负责，此函数只求和。
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
 * 本 tick 远矿 road site 跨主房总量（Σ 非 abandoned remoteOps[*].roadSiteCount）。
 *
 * 为什么求和走 Memory 而不是 room.find：roadSitesPerOpTotal 是「全帝国」帽，但旧实现
 * 在 per-home 调用里用 `for (rn of Object.keys(remoteOps)) room.find(...)` 自行累加 ——
 * 每个主房各算各的账，20 的帽实际变成 20×主房数（「一个数据结构两种语义」：名义全局、
 * 实为每房）。此处按 op 记账求和，跨主房天然单一口径，且零 room.find（远矿房可达十几个）。
 *
 * 计数写者是 road-planner（每个有视野的 op 房实测校正；abandoned 写 0）。失明房的计数
 * 维持上一次值（与 siteCount 同款保守偏差：偏多 → 少建，不会超帽）。
 */
export function getRemoteRoadSiteTotal(): number {
  const g = globalCache();
  if (g.remoteRoadSiteTotal && g.remoteRoadSiteTotal.tick === Game.time) {
    return g.remoteRoadSiteTotal.count;
  }
  let count = 0;
  for (const roomName in Memory.rooms) {
    const ops = Memory.rooms[roomName]?.remoteOps;
    if (!ops) continue;
    for (const op of Object.values(ops)) {
      if (op.state === "abandoned") continue;
      count += op.roadSiteCount ?? 0;
    }
  }
  g.remoteRoadSiteTotal = { tick: Game.time, count };
  return count;
}

/**
 * 本 tick 全局 site 创建计数器（normal + emergency 两个独立槽位，per-tick 惰性初始化）。
 * 仲裁：normal 槽位 construction-manager 普通建造与远矿 container 先到先得；
 * emergency 槽位仅 construction-manager 紧急重建使用；远矿 site 让位 emergency
 * （远矿调用方须检查 emergency > 0 并跳过，即使 normal 空闲）。
 */
export interface TickSiteCounters {
  readonly normal: number;
  readonly emergency: number;
  /** normal 槽位是否可用（仅看 normal === 0，与 emergency 独立）。 */
  readonly canCreateNormal: boolean;
  /** emergency 槽位是否可用（仅看 emergency === 0）。 */
  readonly canCreateEmergency: boolean;
  markNormal: () => void;
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
    get normal() {
      return entry.normal;
    },
    get emergency() {
      return entry.emergency;
    },
    // normal 与 emergency 独立计额：construction-manager 可同 tick 创建两者。
    // 远矿让位 emergency 由远矿调用方自行检查 emergency > 0。
    get canCreateNormal() {
      return entry.normal === 0;
    },
    get canCreateEmergency() {
      return entry.emergency === 0;
    },
    markNormal: () => {
      entry.normal++;
    },
    markEmergency: () => {
      entry.emergency++;
    },
  };
}
