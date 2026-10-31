/** R672：施工优先的「hauler → builder」供能车道。
 *
 * 现场问题：新区没有 link，controller container 被 upgrader 持续抽走，hauler 按
 * fillTargets 每拍"追着补"，运力被升级吸走；builder 只能自己跑 source→工地。
 * 两条零额外通勤的补救：
 *  1) 目标 builder/worker 恰在 4 格内且缺能 → 直接 transfer（range1 自动靠近）；
 *  2) hauler 恰在工地 2 格内 → drop，让 builder 的 pickupNearbyDroppedEnergy 捡。
 * 都只在「本房有在建工地」时生效；成熟房行为不变。
 */
import type { ActionCandidate } from "../action-types";
import { ACTION_RANGE_NEAR, runAction } from "./helpers";

const LOW_ENERGY_FREE = 25;

/** 直接把能量交给附近（≤4 格）缺能的 builder/worker。 */
export function transferToLowBuilder(): ActionCandidate<Creep> {
  return {
    name: "feed:low-builder",
    resolve: ac => {
      if (ac.snapshot.myConstructionSites.length === 0) return undefined;
      if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      const nearby = ac.creep.pos.findInRange(FIND_MY_CREEPS, 4) as Creep[] | undefined;
      if (!nearby || nearby.length === 0) return undefined;
      let best: Creep | undefined;
      let bestD = Infinity;
      for (const c of nearby) {
        if (c.spawning) continue;
        const role = c.memory.role;
        if (role !== "builder" && role !== "worker") continue;
        if (c.store.getFreeCapacity(RESOURCE_ENERGY) < LOW_ENERGY_FREE) continue;
        const d = ac.creep.pos.getRangeTo(c);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return best;
    },
    execute: (ac, target) => {
      runAction(ac.creep, target, ACTION_RANGE_NEAR, () =>
        ac.creep.transfer(target, RESOURCE_ENERGY),
      );
    },
  };
}

/** 路过工地（≤2 格）且脚下无地面能量堆时 drop（builder 会捡）。 */
export function dropNearConstruction(): ActionCandidate<ConstructionSite> {
  return {
    name: "feed:drop-near-site",
    resolve: ac => {
      const sites = ac.snapshot.myConstructionSites;
      if (sites.length === 0) return undefined;
      if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      const near = sites.find(s => ac.creep.pos.getRangeTo(s) <= 2);
      if (!near) return undefined;
      const piles = ac.snapshot.droppedEnergy ?? [];
      if (piles.some(p => ac.creep.pos.getRangeTo(p as any) <= 1)) return undefined;
      return near;
    },
    execute: ac => {
      ac.creep.drop(RESOURCE_ENERGY);
    },
  };
}
