/**
 * Industry actions — 矿物/化合物搬运（lab 供料、矿物回收）。
 *
 * 触发条件均基于 snapshot 预计算的结构状态，不做实时 find。
 */
import type { ActionCandidate } from "../action-types";
import { runAction } from "./helpers";
import { CONFIG } from "../../../config";

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
  | { source: StructureStorage | StructureTerminal; compound: ResourceConstant; phase: "withdraw" };

/**
 * 从 storage/terminal 搬运化合物到 lab（供料）。
 * 触发条件：lab 中有空位且 storage/terminal 有对应化合物。
 * 取料顺序：storage 优先，terminal 回退 — 市场买入的矿物落在 terminal，
 * 没有回退则贸易补给的原料永远进不了反应链。
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

      // 从 storage/terminal 取化合物
      const hasLabSpace = ac.snapshot.labs.some(l => (l.store.getFreeCapacity() ?? 0) > 0);
      if (!hasLabSpace) return undefined;

      const findCompound = (store: StoreDefinition): ResourceConstant | undefined =>
        (Object.keys(store) as ResourceConstant[])
          .find(r => r !== RESOURCE_ENERGY && store[r]! > 0);

      const storageCompound = findCompound(storage.store);
      if (storageCompound) {
        return { source: storage, compound: storageCompound, phase: "withdraw" as const };
      }

      const terminal = ac.snapshot.terminal;
      if (terminal) {
        const terminalCompound = findCompound(terminal.store);
        if (terminalCompound) {
          return { source: terminal, compound: terminalCompound, phase: "withdraw" as const };
        }
      }
      return undefined;
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

/** stockTerminalEnergy 的 resolve 返回类型。 */
type TerminalStockTarget =
  | { dest: StructureTerminal; phase: "deposit" }
  | { source: StructureStorage; phase: "withdraw" };

/**
 * 维持 terminal 能量储备（storage → terminal）。
 * 市场 deal 无论买卖都从本方 terminal 扣能量运费 — terminal 没能量，
 * 贸易系统就是摆设。仅在 storage 能量高于地板值时搬运（经济优先于贸易）。
 * 双相候选：空载取 storage、满载送 terminal，可同时放入 acquire/work 链。
 */
export function stockTerminalEnergy(): ActionCandidate<TerminalStockTarget> {
  return {
    name: "haul:stock-terminal-energy",
    resolve: (ac) => {
      const terminal = ac.snapshot.terminal;
      const storage = ac.snapshot.storage;
      if (!terminal || !storage) return undefined;
      const need = CONFIG.market.energyTarget - terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      if (need <= 0) return undefined;

      const carrying = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
      if (carrying > 0) return { dest: terminal, phase: "deposit" as const };

      // 空载：storage 有富余才为 terminal 抽血。
      if (storage.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.market.storageEnergyFloor) {
        return undefined;
      }
      return { source: storage, phase: "withdraw" as const };
    },
    execute: (ac, t) => {
      if (t.phase === "deposit") {
        runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, RESOURCE_ENERGY));
      } else {
        runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, RESOURCE_ENERGY));
      }
    },
  };
}

/** stockFactoryEnergy 的 resolve 返回类型。 */
type FactoryStockTarget =
  | { dest: StructureFactory; phase: "deposit" }
  | { source: StructureStorage; phase: "withdraw" };

/**
 * 为 factory 补给压缩原料能量（storage → factory）。
 * 仅在 storage 满仓信号下触发 — factory 压缩是对「必然浪费」的能量回收，
 * 正常水位下能量应流向 upgrade/build，不喂 factory。
 * 双相候选：空载取 storage、满载送 factory。
 */
export function stockFactoryEnergy(): ActionCandidate<FactoryStockTarget> {
  return {
    name: "haul:stock-factory-energy",
    resolve: (ac) => {
      const factory = ac.snapshot.factory;
      const storage = ac.snapshot.storage;
      if (!factory || !storage) return undefined;
      if (Memory.rooms[ac.snapshot.roomName]?.storageNearFull !== true) return undefined;
      const need = CONFIG.factory.stockTarget - factory.store.getUsedCapacity(RESOURCE_ENERGY);
      if (need <= 0) return undefined;

      const carrying = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
      if (carrying > 0) return { dest: factory, phase: "deposit" as const };
      return { source: storage, phase: "withdraw" as const };
    },
    execute: (ac, t) => {
      if (t.phase === "deposit") {
        runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, RESOURCE_ENERGY));
      } else {
        runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, RESOURCE_ENERGY));
      }
    },
  };
}
