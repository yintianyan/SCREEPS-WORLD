/**
 * 可复用 Action 工厂 — 角色行为的最小原子单元。
 *
 * 每个工厂返回一个 ActionCandidate，角色 policy 通过组合这些原子
 * 构建自己的优先级链。新增行为 = 新增工厂 + 插入 policy 列表。
 *
 * 命名约定：
 *   - harvestXxx   — 从 source 采集
 *   - withdrawXxx  — 从结构取能
 *   - dumpXxx      — 向结构倒能（harvester 站桩专用）
 *   - fillXxx      — 向 fillTarget 送能
 *   - buildXxx     — 建造
 *   - repairXxx    — 维修
 *   - upgradeXxx   — 升级控制器
 */
import { CONFIG } from "../config";
import type { ActionCandidate, ActionContext } from "./action-types";
import { actOrMove } from "./role-runner";
import {
  findClosestContainerWithEnergy,
  findCriticalRepair,
  findEmptiestContainer,
  findRichestContainer,
  getFillTarget,
  getHaulFillTarget,
  getSource,
} from "./targeting";

// ─── Harvest ────────────────────────────────────────────────

/** 从 source 采集（通用）。 */
export function harvestSource(): ActionCandidate {
  return {
    name: "harvest:source",
    predicate: (ac) => getSource(ac.creep, ac.snapshot) !== undefined,
    execute: (ac) => {
      const source = getSource(ac.creep, ac.snapshot)!;
      const result = actOrMove(ac.creep, source, () => ac.creep.harvest(source));
      if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

// ─── Withdraw ───────────────────────────────────────────────

/** 从最满 container 取能。 */
export function withdrawRichestContainer(): ActionCandidate {
  return {
    name: "withdraw:richest-container",
    predicate: (ac) => {
      const best = findRichestContainer(ac.snapshot.containers);
      return best !== undefined && best.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const best = findRichestContainer(ac.snapshot.containers)!;
      actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从最近有能量的 container 取能（builder 减少通勤）。 */
export function withdrawClosestContainer(): ActionCandidate {
  return {
    name: "withdraw:closest-container",
    predicate: (ac) => findClosestContainerWithEnergy(ac.creep, ac.snapshot.containers) !== undefined,
    execute: (ac) => {
      const best = findClosestContainerWithEnergy(ac.creep, ac.snapshot.containers)!;
      actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从 controller 旁 container 取能（站桩升级）。 */
export function withdrawControllerContainer(): ActionCandidate {
  return {
    name: "withdraw:controller-container",
    predicate: (ac) => {
      const cc = ac.snapshot.controllerContainer;
      return cc !== undefined && cc.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const cc = ac.snapshot.controllerContainer!;
      actOrMove(ac.creep, cc, () => ac.creep.withdraw(cc, RESOURCE_ENERGY));
    },
  };
}

/** 从 controller 旁 link 取能（link 站桩升级，0 通勤）。 */
export function withdrawControllerLink(): ActionCandidate {
  return {
    name: "withdraw:controller-link",
    predicate: (ac) => {
      if (ac.snapshot.links.length === 0 || !ac.snapshot.controller) return false;
      return ac.snapshot.links.some(
        l => l.pos.getRangeTo(ac.snapshot.controller!) <= 2 && l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
    },
    execute: (ac) => {
      const ctrlLink = ac.snapshot.links.find(
        l => l.pos.getRangeTo(ac.snapshot.controller!) <= 2 && l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      )!;
      actOrMove(ac.creep, ctrlLink, () => ac.creep.withdraw(ctrlLink, RESOURCE_ENERGY));
    },
  };
}

/** 从 storage 取能。 */
export function withdrawStorage(): ActionCandidate {
  return {
    name: "withdraw:storage",
    predicate: (ac) => {
      const st = ac.snapshot.storage;
      return st !== undefined && st.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const st = ac.snapshot.storage!;
      actOrMove(ac.creep, st, () => ac.creep.withdraw(st, RESOURCE_ENERGY));
    },
  };
}

/** 限量 withdraw（hauler 专用，避免 ERR_NOT_ENOUGH_RESOURCES）。 */
export function withdrawCapped(target: (ac: ActionContext) => StructureContainer | StructureStorage | undefined): ActionCandidate {
  return {
    name: "withdraw:capped",
    predicate: (ac) => {
      const t = target(ac);
      return t !== undefined && t.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const t = target(ac)!;
      const available = t.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      const result = actOrMove(ac.creep, t, () => ac.creep.withdraw(t, RESOURCE_ENERGY, amount));
      if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

// ─── Dump（harvester 站桩倒能）─────────────────────────────

/** 向身边 link 倒能（range <= 2）。 */
export function dumpToNearbyLink(): ActionCandidate {
  return {
    name: "dump:nearby-link",
    predicate: (ac) => {
      if (ac.snapshot.links.length === 0) return false;
      const link = ac.creep.pos.findClosestByRange(ac.snapshot.links as StructureLink[]);
      return link !== null && ac.creep.pos.getRangeTo(link) <= 2 && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const link = ac.creep.pos.findClosestByRange(ac.snapshot.links as StructureLink[])!;
      actOrMove(ac.creep, link, () => ac.creep.transfer(link, RESOURCE_ENERGY));
    },
  };
}

/** 向身边 container 倒能（range <= 2，站桩 miner）。 */
export function dumpToNearbyContainer(): ActionCandidate {
  return {
    name: "dump:nearby-container",
    predicate: (ac) => {
      if (ac.snapshot.containers.length === 0) return false;
      const nearby = ac.creep.pos.findClosestByRange(ac.snapshot.containers as StructureContainer[]);
      return nearby !== null && ac.creep.pos.getRangeTo(nearby) <= 2 && nearby.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const nearby = ac.creep.pos.findClosestByRange(ac.snapshot.containers as StructureContainer[])!;
      actOrMove(ac.creep, nearby, () => ac.creep.transfer(nearby, RESOURCE_ENERGY));
    },
  };
}

/** 建造身边 container site（range <= 3，经济自愈）。 */
export function buildNearbyContainerSite(): ActionCandidate {
  return {
    name: "build:nearby-container-site",
    predicate: (ac) => {
      if (ac.snapshot.myConstructionSites.length === 0) return false;
      const site = ac.creep.pos.findClosestByRange(
        ac.snapshot.myConstructionSites.filter(s => s.structureType === STRUCTURE_CONTAINER) as ConstructionSite[],
      );
      return site !== null && ac.creep.pos.getRangeTo(site) <= 3;
    },
    execute: (ac) => {
      const site = ac.creep.pos.findClosestByRange(
        ac.snapshot.myConstructionSites.filter(s => s.structureType === STRUCTURE_CONTAINER) as ConstructionSite[],
      )!;
      actOrMove(ac.creep, site, () => ac.creep.build(site));
    },
  };
}

// ─── Fill ───────────────────────────────────────────────────

/** 向 fillTarget 送能（通用，使用 getFillTarget）。 */
export function fillTarget(): ActionCandidate {
  return {
    name: "fill:target",
    predicate: (ac) => getFillTarget(ac.creep, ac.snapshot) !== undefined,
    execute: (ac) => {
      const target = getFillTarget(ac.creep, ac.snapshot)!;
      const result = actOrMove(ac.creep, target, () => ac.creep.transfer(target, RESOURCE_ENERGY));
      if (result === ERR_FULL) updateModeLocal(ac);
    },
  };
}

/** Hauler 专用填充（带 reservation 去重 + 优先级）。 */
export function haulFillTarget(): ActionCandidate {
  return {
    name: "fill:haul-target",
    // 纯检查：有潜在填充目标即可（不触发 reservation 副作用）。
    predicate: (ac) =>
      ac.snapshot.fillTargets.length > 0 || ac.snapshot.controllerContainer !== undefined,
    execute: (ac) => {
      const target = getHaulFillTarget(ac.creep, ac.snapshot);
      if (!target) return;
      const result = actOrMove(ac.creep, target, () => ac.creep.transfer(target, RESOURCE_ENERGY));
      if (result === ERR_FULL) updateModeLocal(ac);
    },
  };
}

/** 向最空 container 倒能。 */
export function fillEmptiestContainer(): ActionCandidate {
  return {
    name: "fill:emptiest-container",
    predicate: (ac) => {
      if (ac.snapshot.containers.length === 0) return false;
      const best = findEmptiestContainer(ac.snapshot.containers);
      return best !== undefined && best.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const best = findEmptiestContainer(ac.snapshot.containers)!;
      actOrMove(ac.creep, best, () => ac.creep.transfer(best, RESOURCE_ENERGY));
    },
  };
}

/** 向 storage 送能。 */
export function fillStorage(): ActionCandidate {
  return {
    name: "fill:storage",
    predicate: (ac) => ac.snapshot.storage !== undefined,
    execute: (ac) => {
      actOrMove(ac.creep, ac.snapshot.storage!, () => ac.creep.transfer(ac.snapshot.storage!, RESOURCE_ENERGY));
    },
  };
}

// ─── Build ──────────────────────────────────────────────────

/** 建造 assignment 指定的 site。 */
export function buildAssignmentSite(): ActionCandidate {
  return {
    name: "build:assignment-site",
    predicate: (ac) => {
      if (!ac.assignment?.targetId) return false;
      return Game.getObjectById(ac.assignment.targetId as Id<ConstructionSite>) !== null;
    },
    execute: (ac) => {
      const site = Game.getObjectById(ac.assignment!.targetId as Id<ConstructionSite>)!;
      const result = actOrMove(ac.creep, site, () => ac.creep.build(site));
      if (result === ERR_INVALID_TARGET) {
        ac.creep.memory.assignment = undefined;
      }
    },
  };
}

/** 建造最近 site（可选 critical-only 过滤）。 */
export function buildNearestSite(criticalOnly = false): ActionCandidate {
  return {
    name: criticalOnly ? "build:nearest-critical-site" : "build:nearest-site",
    predicate: (ac) => {
      const sites = criticalOnly
        ? ac.snapshot.myConstructionSites.filter(isCriticalSite)
        : ac.snapshot.myConstructionSites;
      return sites.length > 0;
    },
    execute: (ac) => {
      const sites = criticalOnly
        ? ac.snapshot.myConstructionSites.filter(isCriticalSite)
        : ac.snapshot.myConstructionSites;
      const site = ac.creep.pos.findClosestByRange(sites as ConstructionSite[]);
      if (site) {
        const result = actOrMove(ac.creep, site, () => ac.creep.build(site));
        if (result === ERR_INVALID_TARGET) {
          ac.creep.memory.targetId = undefined;
        }
      }
    },
  };
}

// ─── Repair ─────────────────────────────────────────────────

/** 修复 critical 结构（血量 < 50%）。 */
export function repairCritical(): ActionCandidate {
  return {
    name: "repair:critical",
    predicate: (ac) => findCriticalRepair(ac.snapshot) !== undefined,
    execute: (ac) => {
      const target = findCriticalRepair(ac.snapshot)!;
      actOrMove(ac.creep, target, () => ac.creep.repair(target));
    },
  };
}

// ─── Upgrade ────────────────────────────────────────────────

/** 升级控制器（无能量门禁）。 */
export function upgradeController(): ActionCandidate {
  return {
    name: "upgrade:controller",
    predicate: (ac) => ac.snapshot.controller !== undefined && ac.snapshot.controller.my,
    execute: (ac) => {
      actOrMove(ac.creep, ac.snapshot.controller!, () => ac.creep.upgradeController(ac.snapshot.controller!));
    },
  };
}

/** 升级控制器（带能量门禁：energyAvailable >= floor）。 */
export function upgradeControllerGated(): ActionCandidate {
  return {
    name: "upgrade:controller-gated",
    predicate: (ac) =>
      ac.snapshot.controller !== undefined &&
      ac.snapshot.controller.my &&
      ac.snapshot.energyAvailable >= CONFIG.economy.upgradeEnergyFloor,
    execute: (ac) => {
      actOrMove(ac.creep, ac.snapshot.controller!, () => ac.creep.upgradeController(ac.snapshot.controller!));
    },
  };
}

// ─── 内部辅助 ───────────────────────────────────────────────

function isCriticalSite(site: ConstructionSite): boolean {
  return site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER;
}

/** 局部 updateMode — 用于 ERR_FULL 后重新评估。 */
function updateModeLocal(ac: ActionContext): void {
  const used = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
  if (used === 0) ac.creep.memory.mode = "acquire";
}
