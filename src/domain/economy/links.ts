/**
 * Link 能量传输决策（纯函数）。
 *
 * 根据 link 的角色分类和能量状态，决定哪些 link 应向哪些 link 传输多少能量。
 * 一个 link 每 tick 只能发起一次传输（Screeps 引擎限制）。
 *
 * 传输优先级：
 *   1. source link → controller link（站桩升级供能核心，0 通勤升级链）
 *   2. source link → storage link（溢出回收）
 *   3. storage link → controller link（controller link 缺能且无 source link 补给时）
 */

import { CONFIG } from "../../config";

/** Link 角色分类 — 由系统层根据 link 与 source/controller/storage 的距离判定。 */
export type LinkRole = "source" | "controller" | "storage" | "hub";

/**
 * 需求驱动的 controller link 目标水位（2026-08-01）。
 *
 * 背景：旧实现 controller 永远优先被 source 喂满——RCL8 满级后升级零收益，
 * 15/tick 白烧（W7N4 实测 storage 恒 0 主因之一）。目标水位让 controller
 * 变成受控消费者：满级停供、降级风险保级、RCL<8 按 storage 水位分级。
 *
 * 放 domain：link-system 与 harvester 灌能出口判定（linkHasOutlet）共用，
 * 避免 creeps → systems 的反向依赖。
 *
 * @param rcl          房间 RCL
 * @param controller   房间 controller（无/非我方 → 0）
 * @param storageEnergy storage 能量（无 storage → 0）
 * @param linkCapacity controller link 容量
 */
export function computeControllerLinkTarget(
  rcl: number,
  controller: { my: boolean; ticksToDowngrade: number } | undefined,
  storageEnergy: number,
  linkCapacity: number,
): number {
  if (!controller || !controller.my) return 0;
  const upgradeCfg = CONFIG.economy.upgrade;
  const linkCfg = CONFIG.economy.link;
  const risk = controller.ticksToDowngrade < CONFIG.economy.controllerDowngradeThreshold;
  // RCL8 满级：升级零收益 → 默认停供；降级风险时保级小水位。
  if (rcl >= 8) return risk ? linkCfg.maintainTarget : 0;
  // RCL<8：按 storage 水位分级（满功率冲刺 / 半供慢升 / 枯竭保级）。
  if (storageEnergy >= upgradeCfg.sustainedStorage) return linkCapacity;
  if (storageEnergy >= linkCfg.lowSupplyStorage) {
    return Math.round(linkCapacity * linkCfg.lowSupplyRatio);
  }
  return Math.round(linkCapacity * linkCfg.maintainRatio);
}

/** 纯数据视图 — 不持有 Screeps 对象引用，便于测试。 */
export interface LinkInfo {
  id: string;
  energy: number;
  energyCapacity: number;
  cooldown: number;
  role: LinkRole;
}

/** 一次 link 间能量传输指令。 */
export interface LinkTransfer {
  fromId: string;
  toId: string;
  amount: number;
}

/**
 * 规划本 tick 的 link 间能量传输。
 *
 * 约束：
 *   - 每个源 link 每 tick 最多参与一次传输（引擎限制）
 *   - 传输量不超过源 link 的可用能量和目标 link 的空闲容量
 *   - 不在冷却中的 link 才能发起传输
 *
 * P1-4 最小传输阈值（minTransfer）：source link 只在能量达到阈值（攒够再发）
 * 或快满（防溢出）时才发起，避免小额传输白占冷却导致源 link 装不下新能量而溢出；
 * controller link 处于“急需”（能量低于阈值）时豁免，保证升级不断粮。
 * minTransfer 默认 0（无阈值，向后兼容），生产调用由 link-system 传入 CONFIG 值。
 */
/** 传输规划选项。 */
export interface LinkTransferOptions {
  minTransfer?: number;
  /**
   * 需求驱动的 controller link 目标水位（2026-08-01）。
   *
   * 缺省 = 容量（向后兼容：旧行为永远想把 controller link 装满）。
   * 调用方（link-system）按升级需求计算：
   *   - RCL8 满级 → 0（停供，能量全流 storage hub）
   *   - RCL8 + 降级风险 → maintainTarget（保级小水位）
   *   - RCL<8 → 按 storage 水位分级（满功率/半供/保级）
   *
   * 效果：controller 不再是无脑最高优先的 sink，而是受控消费者；
   * source 能量先满足 controller 目标，其余全部流向 storage hub。
   */
  controllerTargetEnergy?: number;
}

export function planLinkTransfers(
  links: readonly LinkInfo[],
  opts: LinkTransferOptions = {},
): LinkTransfer[] {
  const minTransfer = opts.minTransfer ?? 0;
  // 快满比例：源 link 能量达容量 90% 时即使低于阈值也发（避免下一批采集溢出）。
  const NEAR_FULL_RATIO = 0.9;
  const transfers: LinkTransfer[] = [];
  const sent = new Set<string>();

  const sourceLinks = links.filter(
    l => l.role === "source" && l.energy > 0 && l.cooldown === 0,
  );
  const controllerLink = links.find(l => l.role === "controller");
  const storageLink = links.find(l => l.role === "storage");

  // 需求驱动目标水位：缺省 = 容量（旧行为）；显式传入时按调用方计算值。
  const controllerTarget = opts.controllerTargetEnergy ??
    (controllerLink ? controllerLink.energyCapacity : 0);
  let controllerNeeds = controllerLink
    ? Math.max(0, controllerTarget - controllerLink.energy)
    : 0;

  // controller 急需：目标水位 > 0 且能量低于 min(目标, minTransfer) →
  // 豁免 source 阈值优先喂。target=0 时永不 urgent（停供）。
  const controllerUrgent =
    controllerLink !== undefined &&
    controllerTarget > 0 &&
    controllerLink.energy < Math.min(controllerTarget, minTransfer);
  // source link 是否达到发起传输的能量条件：达阈值 或 快满。
  const meetsThreshold = (src: LinkInfo): boolean =>
    src.energy >= minTransfer || src.energy >= src.energyCapacity * NEAR_FULL_RATIO;

  // 1. source → controller（最高优先：站桩升级供能）
  for (const src of sourceLinks) {
    if (controllerNeeds <= 0) break;
    if (!meetsThreshold(src) && !controllerUrgent) continue;
    const amount = Math.min(src.energy, controllerNeeds);
    transfers.push({ fromId: src.id, toId: controllerLink!.id, amount });
    sent.add(src.id);
    controllerNeeds -= amount;
  }

  // 2. source → storage（溢出回收）
  if (storageLink) {
    let storageFree = storageLink.energyCapacity - storageLink.energy;
    for (const src of sourceLinks) {
      if (sent.has(src.id) || storageFree <= 0) continue;
      if (!meetsThreshold(src)) continue;
      const amount = Math.min(src.energy, storageFree);
      transfers.push({ fromId: src.id, toId: storageLink.id, amount });
      sent.add(src.id);
      storageFree -= amount;
    }
  }

  // 3. storage → controller（controller 仍缺能时补充）
  if (
    storageLink &&
    storageLink.cooldown === 0 &&
    storageLink.energy > 0 &&
    controllerLink &&
    controllerNeeds > 0
  ) {
    const amount = Math.min(storageLink.energy, controllerNeeds);
    if (amount > 0) {
      transfers.push({ fromId: storageLink.id, toId: controllerLink.id, amount });
    }
  }

  return transfers;
}

/** 二维坐标视图 — 供 classifyLinkRole 纯几何计算，不依赖 Screeps RoomPosition。 */
export interface LinkAnchorPoint {
  x: number;
  y: number;
}

/**
 * 按「最近锚获胜」分类单个 link 的角色（纯函数，几何判定）。
 *
 * 取 link 到最近 source / controller / storage 的 Chebyshev 距离，在 anchorRange 内
 * 选距离最小的锚定角色；距离相等时按 controller > storage > source 裁决——专属单例
 * 结构（controller/storage link）不应被 source 抢占。都不在范围内 → hub。
 *
 * 替代旧的「source 固定最高优先级 + 短路返回」：旧实现会把紧邻 controller/storage、
 * 却恰好落在某 source range≤2 内的 link 误判为 source（优先级劫持），令 controller/
 * storage link 从传输拓扑消失、升级链/排空链断裂。最近锚使 range1 到 controller 的
 * link 胜过 range2 到 source，从根上消除劫持。
 */
export function classifyLinkRole(
  link: LinkAnchorPoint,
  sources: readonly LinkAnchorPoint[],
  controller: LinkAnchorPoint | undefined,
  storage: LinkAnchorPoint | undefined,
  anchorRange = 2,
): LinkRole {
  const cheb = (a: LinkAnchorPoint, b: LinkAnchorPoint): number =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  let dSource = Infinity;
  for (const s of sources) {
    const d = cheb(link, s);
    if (d < dSource) dSource = d;
  }
  const dController = controller ? cheb(link, controller) : Infinity;
  const dStorage = storage ? cheb(link, storage) : Infinity;

  // 候选：范围内的锚定角色，(距离, tie-break 优先级 pri 越大越优先)。
  const candidates: { role: LinkRole; dist: number; pri: number }[] = [];
  if (dSource <= anchorRange) candidates.push({ role: "source", dist: dSource, pri: 0 });
  if (dStorage <= anchorRange) candidates.push({ role: "storage", dist: dStorage, pri: 1 });
  if (dController <= anchorRange) candidates.push({ role: "controller", dist: dController, pri: 2 });
  if (candidates.length === 0) return "hub";

  // 最近锚获胜；距离相等时 pri 大者（controller > storage > source）优先。
  candidates.sort((a, b) => a.dist - b.dist || b.pri - a.pri);
  return candidates[0]!.role;
}
