/** 统一库存视图纯函数 — terminal/lab/factory 市场改造阶段 0。 */
import type { RoomSnapshot } from "../../kernel/contracts";

/**
 * 累加一个 store 中的非 energy 资源到 inventory 映射。
 * 接受引擎的 Store 类型（通过 unknown 中转换规避类型不兼容问题）。
 */
function mergeStore(
  store: unknown,
  inventory: Record<string, number>,
): void {
  if (!store) return;
  const s = store as Record<string, number>;
  for (const resource of Object.keys(s)) {
    if (resource === RESOURCE_ENERGY) continue;
    inventory[resource] = (inventory[resource] ?? 0) + (s[resource] ?? 0);
  }
}

/**
 * 收集房间中所有非 energy 资源的完整库存视图：
 * storage + terminal + labs + factory。

 * 供 terminal-manager（缺口计算 / 矿物互济）和 lab-system（反应链规划）共用，
 * 消除两处重复口径与 factory 遗漏。
 */
export function collectFullInventory(snapshot: RoomSnapshot): Record<string, number> {
  const inventory: Record<string, number> = {};

  mergeStore(snapshot.storage?.store, inventory);
  mergeStore(snapshot.terminal?.store, inventory);

  for (const lab of snapshot.labs) {
    mergeStore(lab.store, inventory);
  }

  mergeStore(snapshot.factory?.store, inventory);

  return inventory;
}
