import type { Priority, RoomSnapshot, System, TickContext } from "../kernel/contracts";
import type { LinkInfo, LinkRole } from "../domain/economy/links";
import { planLinkTransfers } from "../domain/economy/links";
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

  const transfers = planLinkTransfers(infos, { minTransfer: CONFIG.economy.link.minTransfer });
  for (const t of transfers) {
    const from = linkMap.get(t.fromId);
    const to = linkMap.get(t.toId);
    if (!from || !to) continue;
    from.transferEnergy(to, t.amount);
  }
}

/**
 * 根据 link 与 source/controller/storage 的距离分类。
 * range <= 2 视为紧邻（harvester 可在采矿位直接 transfer）。
 *
 * 优先级判定：当一个 link 同时紧邻多个目标时（如 source 和 storage 都在 range 2 内），
 * 按物流角色重要性判定 — source > controller > storage > hub。
 * 防止 source link 被误判为 storage link 导致 planLinkTransfers 不把它的能量送到 controller。
 */
function classifyLink(link: StructureLink, snapshot: RoomSnapshot): LinkRole {
  // 逐一检查所有匹配，收集后按优先级选择。
  const isNearSource = snapshot.sources.some(src => link.pos.getRangeTo(src) <= 2);
  if (isNearSource) return "source";

  const isNearController = snapshot.controller != null && link.pos.getRangeTo(snapshot.controller) <= 2;
  if (isNearController) return "controller";

  const isNearStorage = snapshot.storage != null && link.pos.getRangeTo(snapshot.storage) <= 2;
  if (isNearStorage) return "storage";

  return "hub";
}
