/**
 * Link 能量传输决策（纯函数）。一个 link 每 tick 只能发起一次传输（引擎限制）；
 *
 * 引擎传输损耗：发送方扣除 amount，接收方获得 floor(amount × (1 − LINK_LOSS_RATE))，
 * 即 3% 损耗（官方文档确认）。planLinkTransfers 在计算传输量时对需求做损耗补偿：
 * 若目标缺口为 N，则实际发送量 = ceil(N / (1 − LINK_LOSS_RATE))，确保到达量 ≥ N。
 */

import { CONFIG } from "../../config";

/** 引擎传输损耗率（官方文档：3%）。 */
export const LINK_LOSS_RATE = 0.03;

/** 给定发送量，返回接收方实际到账量（向下取整，与引擎一致）。 */
export function receivedAfterLoss(amount: number): number {
  return Math.floor(amount * (1 - LINK_LOSS_RATE));
}

/** 给定目标缺口 needs，返回补偿损耗后需要发送的最小量（向上取整）。 */
export function sendForNeeds(needs: number): number {
  return Math.ceil(needs / (1 - LINK_LOSS_RATE));
}

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
  // controller 目标缺口（考虑传输损耗：需要发送 sendForNeeds(needs) 才能填满缺口）。
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

  // 跟踪 controller 本 tick 已接收量（快照 energy 不反映同 tick 前序传输）。
  let controllerReceived = 0;

  // 源 link 每 tick 只能发起一次传输（引擎限制）。当 controller 接近满
  // （缺口 < minTransfer 且非 urgent）且源 link 快满了时，跳过 controller 传输，
  // 保留传输机会给 Step 2 排空到 storage — 避免「source link 花 800 容量的
  // 传输冷却去给 controller 传 50 能量、剩余 750 溢出」的浪费。controller 的
  // 少量缺口由 Step 3（storage → controller）在 link-system 层补齐。

  // controller 是否值得 source link 传输：缺口 >= minTransfer 或 urgent。
  // 无 storage link 时不跳过：source link 能量无处排空，跳过只会溢出。
  const controllerWantsSource =
    controllerNeeds > 0 &&
    (controllerUrgent || controllerNeeds >= minTransfer || !storageLink);

  // 1. source → controller（最高优先：站桩升级供能）
  // 损耗补偿：目标缺口 N → 发送 sendForNeeds(N)，但不超源可用量与目标空闲容量。
  for (const src of sourceLinks) {
    if (!controllerWantsSource) break;
    if (!meetsThreshold(src) && !controllerUrgent) continue;
    // 动态空闲 = 容量 - 快照能量 - 本 tick 已接收量。
    const targetFree = controllerLink
      ? controllerLink.energyCapacity - controllerLink.energy - controllerReceived
      : 0;
    const sendAmount = Math.min(
      src.energy,
      targetFree,
      sendForNeeds(controllerNeeds),
    );
    if (sendAmount <= 0) continue;
    transfers.push({ fromId: src.id, toId: controllerLink!.id, amount: sendAmount });
    sent.add(src.id);
    const arrived = receivedAfterLoss(sendAmount);
    controllerNeeds -= arrived;
    controllerReceived += arrived;
  }

  // 2. source → storage（溢出回收）
  // storage 回收不追求精确补偿损耗：溢出回收场景下多传少传均可，下 tick 会重新评估。
  if (storageLink) {
    let storageFree = storageLink.energyCapacity - storageLink.energy;
    for (const src of sourceLinks) {
      if (sent.has(src.id) || storageFree <= 0) continue;
      if (!meetsThreshold(src)) continue;
      // 发送量不超过目标空闲容量（引擎会拒绝超容量的传输）。
      const amount = Math.min(src.energy, storageFree);
      if (amount <= 0) continue;
      transfers.push({ fromId: src.id, toId: storageLink.id, amount });
      sent.add(src.id);
      // 目标空闲按到账量扣减（到账量 ≤ 发送量）。
      storageFree -= receivedAfterLoss(amount);
    }
  }

  // 3. storage → controller（controller 仍缺能时补充）
  // 损耗补偿：同路由 1，发送 sendForNeeds(needs) 以确保到达量覆盖缺口。
  if (
    storageLink &&
    storageLink.cooldown === 0 &&
    storageLink.energy > 0 &&
    controllerLink &&
    controllerNeeds > 0
  ) {
    const targetFree = controllerLink.energyCapacity - controllerLink.energy - controllerReceived;
    const sendAmount = Math.min(
      storageLink.energy,
      targetFree,
      sendForNeeds(controllerNeeds),
    );
    if (sendAmount > 0) {
      transfers.push({ fromId: storageLink.id, toId: controllerLink.id, amount: sendAmount });
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
