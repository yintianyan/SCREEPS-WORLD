/**
 * Industry actions — 矿物/化合物搬运（lab 供料、矿物回收）。
 *
 * 触发条件均基于 snapshot 预计算的结构状态，不做实时 find。
 */
import type { ActionCandidate } from "../action-types";
import { runAction } from "./helpers";

/** haulMineralsToStorage 的 resolve 返回类型。 */
type MineralHaulTarget =
  | { dest: StructureStorage | StructureTerminal; mineral: ResourceConstant; phase: "deposit" }
  | { source: StructureContainer; mineral: ResourceConstant; phase: "withdraw" };

/**
 * 从 extractor 旁 container 搬运矿物到 storage/terminal。
 * 触发条件：container 中有非 energy 资源。
 */
export function haulMineralsToStorage(): ActionCandidate<MineralHaulTarget> {
  return {
    name: "haul:minerals-to-storage",
    resolve: (ac) => {
      if (!ac.snapshot.storage && !ac.snapshot.terminal) return undefined;

      // 如果 creep 正在 carrying 非 energy 资源，送到 storage/terminal
      const carriedMineral = (Object.keys(ac.creep.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && ac.creep.store[r]! > 0);

      if (carriedMineral) {
        const dest = ac.snapshot.terminal ?? ac.snapshot.storage;
        if (dest) return { dest, mineral: carriedMineral, phase: "deposit" as const };
        return undefined;
      }

      // 找含矿物的 container
      const source = ac.snapshot.containers.find(c => {
        for (const res of Object.keys(c.store) as ResourceConstant[]) {
          if (res !== RESOURCE_ENERGY && c.store[res]! > 0) return true;
        }
        return false;
      });
      if (!source) return undefined;

      const mineral = (Object.keys(source.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && source.store[r]! > 0);
      if (!mineral) return undefined;

      return { source, mineral, phase: "withdraw" as const };
    },
    execute: (ac, t) => {
      if (t.phase === "deposit") {
        runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, t.mineral));
      } else {
        runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.mineral));
      }
    },
  };
}

/** supplyLabs 的 resolve 返回类型。 */
type LabSupplyTarget =
  | { dest: StructureLab; compound: ResourceConstant; phase: "deposit" }
  | { source: StructureStorage; compound: ResourceConstant; phase: "withdraw" };

/**
 * 从 storage 搬运化合物到 lab（供料）。
 * 触发条件：lab 中有空位且 storage 有对应化合物。
 * 简化实现：搬运 lab 中缺少的资源。
 */
export function supplyLabs(): ActionCandidate<LabSupplyTarget> {
  return {
    name: "haul:supply-labs",
    resolve: (ac) => {
      if (ac.snapshot.labs.length === 0) return undefined;
      const storage = ac.snapshot.storage;
      if (!storage) return undefined;

      // 如果 creep 正在 carrying 化合物，送到 lab
      const carriedCompound = (Object.keys(ac.creep.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && ac.creep.store[r]! > 0);

      if (carriedCompound) {
        const targetLab = ac.snapshot.labs.find(l => (l.store.getFreeCapacity() ?? 0) > 0);
        if (targetLab) return { dest: targetLab, compound: carriedCompound, phase: "deposit" as const };
        return undefined;
      }

      // 从 storage 取化合物
      const hasLabSpace = ac.snapshot.labs.some(l => (l.store.getFreeCapacity() ?? 0) > 0);
      if (!hasLabSpace) return undefined;

      const compound = (Object.keys(storage.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && storage.store[r]! > 0);
      if (!compound) return undefined;

      return { source: storage, compound, phase: "withdraw" as const };
    },
    execute: (ac, t) => {
      if (t.phase === "deposit") {
        runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, t.compound));
      } else {
        runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.compound));
      }
    },
  };
}
