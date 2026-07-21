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

/**
 * 判断 container 是否为 source container（紧邻任何 source）。
 * source container 的能量应由 hauler 搬运到 spawn/extension，
 * 非采集角色不应直接取用，否则 hauler 无事可做、物流链断裂。
 */
function isSourceContainer(c: StructureContainer, ac: ActionContext): boolean {
  return ac.snapshot.sources.some(
    s => c.pos.getRangeTo(s.pos) <= 1,
  );
}

/** 从最满的非 source container 取能（upgrader 用，不抢 hauler 的物流源）。 */
export function withdrawRichestNonSourceContainer(): ActionCandidate {
  return {
    name: "withdraw:richest-non-source-container",
    predicate: (ac) => {
      const candidates = ac.snapshot.containers.filter(
        c => !isSourceContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      return candidates.length > 0;
    },
    execute: (ac) => {
      const candidates = ac.snapshot.containers.filter(
        c => !isSourceContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      const best = findRichestContainer(candidates);
      if (best) actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从最近的非 source container 取能（builder 用，不抢 hauler 的物流源）。 */
export function withdrawClosestNonSourceContainer(): ActionCandidate {
  return {
    name: "withdraw:closest-non-source-container",
    predicate: (ac) => {
      const candidates = ac.snapshot.containers.filter(
        c => !isSourceContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      return candidates.length > 0;
    },
    execute: (ac) => {
      const candidates = ac.snapshot.containers.filter(
        c => !isSourceContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      const best = findClosestContainerWithEnergy(ac.creep, candidates);
      if (best) actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
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

/**
 * 修复衰减中的 container（血量 < 80%）。
 * Container 每 tick 衰减 ~5000 hits，不修就会在 ~50 tick 内从 80% 降到 0 被摧毁。
 * 失去 source container = 物流链断裂 = 经济崩溃，因此阈值设得比 repairCritical (50%) 更激进。
 */
export function repairContainerDecay(): ActionCandidate {
  return {
    name: "repair:container-decay",
    predicate: (ac) => {
      return ac.snapshot.containers.some(c => c.hits < c.hitsMax * 0.8);
    },
    execute: (ac) => {
      // 修血量最低的 container。
      let worst: StructureContainer | undefined;
      let worstRatio = 1;
      for (const c of ac.snapshot.containers) {
        const ratio = c.hits / c.hitsMax;
        if (ratio < 0.8 && ratio < worstRatio) {
          worstRatio = ratio;
          worst = c;
        }
      }
      if (worst) {
        actOrMove(ac.creep, worst, () => ac.creep.repair(worst));
      }
    },
  };
}

/**
 * 修复身边的 container（range <= 2，血量 < 80%）。
 * Harvester 站桩专用：你正站在 container 旁边，它快塌了，先修再倒。
 * 比 repairContainerDecay 更紧急 — 只修身边的，不需要跑远路。
 */
export function repairNearbyContainer(): ActionCandidate {
  return {
    name: "repair:nearby-container",
    predicate: (ac) => {
      if (ac.snapshot.containers.length === 0) return false;
      const nearby = ac.creep.pos.findClosestByRange(ac.snapshot.containers as StructureContainer[]);
      return nearby !== null
        && ac.creep.pos.getRangeTo(nearby) <= 2
        && nearby.hits < nearby.hitsMax * 0.8;
    },
    execute: (ac) => {
      const nearby = ac.creep.pos.findClosestByRange(ac.snapshot.containers as StructureContainer[])!;
      actOrMove(ac.creep, nearby, () => ac.creep.repair(nearby));
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

// ─── Industry（矿物/化合物搬运）─────────────────────────────

/**
 * 从 extractor 旁 container 搬运矿物到 storage/terminal。
 * 触发条件：container 中有非 energy 资源。
 */
export function haulMineralsToStorage(): ActionCandidate {
  return {
    name: "haul:minerals-to-storage",
    predicate: (ac) => {
      if (!ac.snapshot.storage && !ac.snapshot.terminal) return false;
      // 找到含有非 energy 资源的 container（extractor 旁的）
      return ac.snapshot.containers.some(c => {
        for (const res of Object.keys(c.store) as ResourceConstant[]) {
          if (res !== RESOURCE_ENERGY && c.store[res]! > 0) return true;
        }
        return false;
      });
    },
    execute: (ac) => {
      // 找含矿物的 container
      const source = ac.snapshot.containers.find(c => {
        for (const res of Object.keys(c.store) as ResourceConstant[]) {
          if (res !== RESOURCE_ENERGY && c.store[res]! > 0) return true;
        }
        return false;
      });
      if (!source) return;

      // 如果 creep  carrying 非 energy 资源，送到 storage/terminal
      const carriedMineral = (Object.keys(ac.creep.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && ac.creep.store[r]! > 0);

      if (carriedMineral) {
        const dest = ac.snapshot.terminal ?? ac.snapshot.storage;
        if (dest) {
          actOrMove(ac.creep, dest, () => ac.creep.transfer(dest, carriedMineral));
        }
      } else {
        // 从 container 取矿物
        const mineral = (Object.keys(source.store) as ResourceConstant[])
          .find(r => r !== RESOURCE_ENERGY && source.store[r]! > 0);
        if (mineral) {
          actOrMove(ac.creep, source, () => ac.creep.withdraw(source, mineral));
        }
      }
    },
  };
}

/**
 * 从 storage 搬运化合物到 lab（供料）。
 * 触发条件：lab 中有空位且 storage 有对应化合物。
 * 简化实现：搬运 lab 中缺少的资源。
 */
export function supplyLabs(): ActionCandidate {
  return {
    name: "haul:supply-labs",
    predicate: (ac) => {
      if (ac.snapshot.labs.length === 0) return false;
      if (!ac.snapshot.storage) return false;
      // 检查是否有 lab 需要供料（有空闲容量且 storage 有非 energy 资源）
      const hasLabSpace = ac.snapshot.labs.some(l => (l.store.getFreeCapacity() ?? 0) > 0);
      const hasCompounds = (Object.keys(ac.snapshot.storage.store) as ResourceConstant[])
        .some(r => r !== RESOURCE_ENERGY && ac.snapshot.storage!.store[r]! > 0);
      return hasLabSpace && hasCompounds;
    },
    execute: (ac) => {
      const storage = ac.snapshot.storage!;

      // 如果 creep 正在 carrying 化合物，送到 lab
      const carriedCompound = (Object.keys(ac.creep.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && ac.creep.store[r]! > 0);

      if (carriedCompound) {
        // 找到有空闲容量的 lab
        const targetLab = ac.snapshot.labs.find(l => (l.store.getFreeCapacity() ?? 0) > 0);
        if (targetLab) {
          actOrMove(ac.creep, targetLab, () => ac.creep.transfer(targetLab, carriedCompound));
        }
      } else {
        // 从 storage 取化合物
        const compound = (Object.keys(storage.store) as ResourceConstant[])
          .find(r => r !== RESOURCE_ENERGY && storage.store[r]! > 0);
        if (compound) {
          actOrMove(ac.creep, storage, () => ac.creep.withdraw(storage, compound));
        }
      }
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
