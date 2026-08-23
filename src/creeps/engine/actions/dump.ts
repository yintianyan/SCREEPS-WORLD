/**
 * Dump actions — harvester 站桩倒能（向身边 range<=2 结构卸载能量/矿物）。
 * 与 fill actions 的区别：dump 是站桩矿工向身边结构倒能，fill 是移动角色向 fillTarget 送能。
 */
import type { ActionCandidate } from "../action-types";
import { runAction, runCountedAction } from "./helpers";

/** 向身边 link 倒能（range <= 2）。 */
export function dumpToNearbyLink(): ActionCandidate<StructureLink> {
  return {
    name: "dump:nearby-link",
    resolve: (ac) => {
      const candidates = ac.snapshot.links.filter(
        l => ac.creep.pos.getRangeTo(l) <= 2 && l.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      );
      if (candidates.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(candidates as StructureLink[]) ?? undefined;
    },
    execute: (ac, link) => {
      runAction(ac.creep, link, () => ac.creep.transfer(link, RESOURCE_ENERGY));
    },
  };
}

/** 向身边 container 倒能（range <= 2，站桩 miner）。 */
export function dumpToNearbyContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "dump:nearby-container",
    resolve: (ac) => {
      const candidates = ac.snapshot.containers.filter(
        c => ac.creep.pos.getRangeTo(c) <= 2 && c.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      );
      if (candidates.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(candidates as StructureContainer[]) ?? undefined;
    },
    execute: (ac, nearby) => {
      runAction(ac.creep, nearby, () => ac.creep.transfer(nearby, RESOURCE_ENERGY));
    },
  };
}

/** dumpMineralsToNearbyContainer 的 resolve 返回类型。 */
interface MineralDumpTarget {
  container: StructureContainer;
  mineral: ResourceConstant;
}

/**
 * 向身边 container 卸载矿物（range <= 2）。优先级高于 energy dump — 矿物不应占用 carry 空间。
 */
export function dumpMineralsToNearbyContainer(): ActionCandidate<MineralDumpTarget> {
  return {
    name: "dump:minerals-to-container",
    resolve: (ac) => {
      const mineral = (Object.keys(ac.creep.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && ac.creep.store[r]! > 0);
      if (!mineral) return undefined;
      const candidates = ac.snapshot.containers.filter(
        c => ac.creep.pos.getRangeTo(c) <= 2 && (c.store.getFreeCapacity() ?? 0) > 0,
      );
      if (candidates.length === 0) return undefined;
      const container = ac.creep.pos.findClosestByRange(candidates as StructureContainer[]) ?? undefined;
      if (!container) return undefined;
      return { container, mineral };
    },
    execute: (ac, target) => {
      runAction(ac.creep, target.container, () => ac.creep.transfer(target.container, target.mineral));
    },
  };
}

/** 建造身边 container site（range <= 3，经济自愈）。 */
export function buildNearbyContainerSite(): ActionCandidate<ConstructionSite> {
  return {
    name: "build:nearby-container-site",
    resolve: (ac) => {
      if (ac.snapshot.myConstructionSites.length === 0) return undefined;
      const site = ac.creep.pos.findClosestByRange(
        ac.snapshot.myConstructionSites.filter(s => s.structureType === STRUCTURE_CONTAINER) as ConstructionSite[],
      );
      if (!site || ac.creep.pos.getRangeTo(site) > 3) return undefined;
      return site;
    },
    execute: (ac, site) => {
      runCountedAction(ac.creep, site, "built", () => ac.creep.build(site));
    },
  };
}
