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

/** Link 角色分类 — 由系统层根据 link 与 source/controller/storage 的距离判定。 */
export type LinkRole = "source" | "controller" | "storage" | "hub";

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
export function planLinkTransfers(
  links: readonly LinkInfo[],
  opts: { minTransfer?: number } = {},
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

  let controllerNeeds = controllerLink
    ? controllerLink.energyCapacity - controllerLink.energy
    : 0;

  // controller 急需：controller link 能量低于阈值 → 豁免 source 阈值，优先喂升级链。
  const controllerUrgent = controllerLink !== undefined && controllerLink.energy < minTransfer;
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
