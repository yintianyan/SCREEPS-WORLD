/**
 * Link 能量传输决策（纯函数）。一个 link 每 tick 只能发起一次传输（引擎限制）；
 * 优先级：source→controller（站桩升级供能）> source→storage（溢出回收）>
 * storage→controller（controller 缺能且无 source 补给时）。
 */

import { CONFIG } from "../../config";

/** Link 角色分类 — 由系统层根据 link 与 source/controller/storage 的距离判定。 */
export type LinkRole = "source" | "controller" | "storage" | "hub";

/**
 * 需求驱动的 controller link 目标水位：旧实现 RCL8 满级后仍被喂满、
 * 15/tick 白烧（W7N4 实测 storage 恒 0 主因之一），故改为受控消费者 —
 * 满级停供、降级风险保级、RCL<8 按 storage 水位分级。放 domain 是
 * link-system 与 harvester 灌能出口判定共用，避免 creeps→systems 反向依赖。
 * controller 无/非我方 → 0；storageEnergy 无 storage → 0。
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


export interface LinkTransfer {
  fromId: string;
  toId: string;
  amount: number;
}

/**
 * 规划本 tick 的 link 间能量传输。约束：每源 link 每 tick 至多参与一次传输、
 * 不超源可用能量与目标空闲容量、冷却中的 link 不能发起（引擎限制）。
 *
 * P1-4 minTransfer：source 攒够阈值或快满才发，避免小额传输白占冷却导致
 * 源 link 装不下新能量而溢出；controller「急需」（能量低于阈值）时豁免。
 * minTransfer 默认 0（无阈值，向后兼容），生产调用由 link-system 传 CONFIG 值。
 */
export interface LinkTransferOptions {
  minTransfer?: number;
  /**
   * 需求驱动的 controller 目标水位（缺省 = 容量，向后兼容）；调用方
   * （link-system）按升级需求计算（RCL8 停供 / 保级 / RCL<8 分级）。
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


  const controllerTarget = opts.controllerTargetEnergy ??
    (controllerLink ? controllerLink.energyCapacity : 0);
  let controllerNeeds = controllerLink
    ? Math.max(0, controllerTarget - controllerLink.energy)
    : 0;

  // controller 急需：目标>0 且能量低于 min(目标, minTransfer) → 豁免 source 阈值。
  // target=0 时永不 urgent（停供）。
  const controllerUrgent =
    controllerLink !== undefined &&
    controllerTarget > 0 &&
    controllerLink.energy < Math.min(controllerTarget, minTransfer);

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
 * 按「最近锚获胜」分类 link 角色（纯函数）：Chebyshev 距离最近且在 anchorRange 内的
 * 锚定角色胜出；等距按 controller > storage > source 裁决（专属单例不被 source 抢占）；
 * 均不在范围内 → hub。替代旧「source 固定最高优先级 + 短路」— 旧版会把紧邻
 * controller/storage 却落在 source range≤2 的 link 误判为 source（优先级劫持），
 * 令 controller/storage link 从传输拓扑消失、升级链/排空链断裂。
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


  candidates.sort((a, b) => a.dist - b.dist || b.pri - a.pri);
  return candidates[0]!.role;
}
