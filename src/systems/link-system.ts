import type { Priority, RoomSnapshot, System, TickContext } from "../kernel/contracts";
import type { LinkInfo, LinkRole } from "../domain/economy/links";
import { planLinkTransfers, classifyLinkRole } from "../domain/economy/links";
import { CONFIG } from "../config";

/**
 * Link 能量传输系统 — P1 系统，管理 link 间瞬时能量传输。
 *
 * 职责：
 *   - 将房间内 link 按位置分类（source / controller / storage / hub）
 *   - 调用 planLinkTransfers 计算传输计划
 *   - 执行 link.transferEnergy() 完成能量瞬移
 *
 * link 链路是 RCL5+ 的核心物流：source link ← harvester 存能 →
 * controller link → upgrader 取能，全程 0 通勤替代 hauler 往返。
 * storage link 作为溢出回收和 controller 补给的枢纽。
 *
 * 优先级：P1 — link 传输极廉价（每房每 tick O(links) 查找 + 少量 API 调用），
 * 且直接关系升级吞吐，在能量链中优先级仅次于孵化。
 */
export const linkSystem: System = {
  name: "link-system",
  priority: 1 as Priority,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      if (snapshot.links.length === 0) continue;
      runRoomLinks(snapshot);
    }
  },
};

/**
 * 执行单房 link 传输：分类 → 规划 → 执行。
 */
function runRoomLinks(snapshot: RoomSnapshot): void {
  const links = snapshot.links;
  const linkMap = new Map<string, StructureLink>();
  for (const l of links) linkMap.set(l.id, l);

  const infos: LinkInfo[] = links.map(l => ({
    id: l.id,
    energy: l.store.getUsedCapacity(RESOURCE_ENERGY),
    energyCapacity: l.store.getCapacity(RESOURCE_ENERGY),
    cooldown: l.cooldown,
    role: classifyLink(l, snapshot),
  }));

  // 需求驱动的 controller 目标水位（RCL8 停供 / 保级 / RCL<8 分级）。
  const controllerInfo = infos.find(i => i.role === "controller");
  const controllerTargetEnergy = controllerInfo
    ? computeControllerLinkTarget(
        snapshot.rcl,
        snapshot.controller,
        snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
        controllerInfo.energyCapacity,
      )
    : undefined;
  const transfers = planLinkTransfers(infos, {
    minTransfer: CONFIG.economy.link.minTransfer,
    controllerTargetEnergy,
  });
  for (const t of transfers) {
    const from = linkMap.get(t.fromId);
    const to = linkMap.get(t.toId);
    if (!from || !to) continue;
    from.transferEnergy(to, t.amount);
  }
}

/**
 * 需求驱动的 controller link 目标水位（2026-08-01）。
 *
 * 背景：旧实现 controller 永远优先被 source 喂满——RCL8 满级后升级零收益，
 * 15/tick 白烧（W7N4 实测 storage 恒 0 主因之一）。目标水位让 controller
 * 变成受控消费者：满级停供、降级风险保级、RCL<8 按 storage 水位分级。
 *
 * @param rcl          房间 RCL
 * @param controller   房间 controller（无/非我方 → 0）
 * @param storageEnergy storage 能量（无 storage → 0）
 * @param linkCapacity controller link 容量
 */
export function computeControllerLinkTarget(
  rcl: number,
  controller: StructureController | undefined,
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

/**
 * 根据 link 与 source/controller/storage 的距离分类（委托纯函数 classifyLinkRole）。
 *
 * 采用「最近锚获胜」而非旧的「source 固定最高优先级」：后者会把紧邻 controller/storage、
 * 却恰好落在某 source range≤2 内的 link 误判为 source（优先级劫持），令 controller/storage
 * link 从传输拓扑消失。分类逻辑与 harvester 灌能识别（harvest.ts sourceAdjacentLink）
 * 共用同一 classifyLinkRole，消除口径漂移致的「死 link」。详见 domain/economy/links.ts。
 */
function classifyLink(link: StructureLink, snapshot: RoomSnapshot): LinkRole {
  return classifyLinkRole(
    link.pos,
    snapshot.sources.map(s => s.pos),
    snapshot.controller?.pos,
    snapshot.storage?.pos,
    CONFIG.economy.link.anchorRange,
  );
}
