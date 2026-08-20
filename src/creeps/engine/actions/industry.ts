/**
 * Industry actions — 矿物/化合物搬运（lab 供料、矿物回收）。
 *
 * 触发条件均基于 snapshot 预计算的结构状态，不做实时 find。
 */
import type { ActionCandidate } from "../action-types";
import { runAction } from "./helpers";
import { CONFIG } from "../../../config";
import { globalCache } from "../../../kernel/global-cache";
import { getObjectById } from "../../support/obj-cache";
import { moveToTarget } from "../../movement";
import { NUKE_ENERGY_COST, NUKE_GHODIUM_COST } from "../../../domain/war/planning";

/** haulMineralsToStorage 的 resolve 返回类型（仅 deposit 相：倒已携带的矿物）。 */
type MineralHaulTarget = {
  dest: StructureStorage | StructureTerminal;
  mineral: ResourceConstant;
  phase: "deposit";
};

/**
 * 把携带的矿物倒进 storage/terminal（work 链首位，高价值资源不滞留）。
 * 本动作只负责「倒已携带的矿物」，绝不在 work 链里取矿——取矿补仓由 haulMineralTopUp
 * （排在 fillStorage 之后）负责。旧实现把取矿相位塞进同动作且位于 work 链首位，导致背着
 * 能量要去存 storage 的 hauler 当 tick 被派去取矿、fillStorage 永远轮不到：能量滞留背包 +
 * hauler 卡取矿循环不回 acquire 排空 storage link（线上实证：storage-link 满、能量不入库）。
 * 分离后顺序变为：倒矿 → 倒能 → 有余量才补矿（能量生命线优先）。
 * 触发条件：creep 携非 energy 资源。
 */
export function haulMineralsToStorage(): ActionCandidate<MineralHaulTarget> {
  return {
    name: "haul:minerals-to-storage",
    resolve: (ac) => {
      if (!ac.snapshot.storage && !ac.snapshot.terminal) return undefined;

      // 如果 creep 正在 carrying 非 energy 资源，送到 storage/terminal
      const carriedMineral = (Object.keys(ac.creep.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && ac.creep.store[r]! > 0);
      if (!carriedMineral) return undefined; // 不携矿物 → 放行后续候选（fillStorage 先倒能）

      // W7 定位（2026-08-01 部署验证）：terminal 总容量 300,000，矿物堆满时 transfer 必返
      // ERR_FULL 且被 runAction 静默忽略 → hauler 永久背矿物锁死（W7N3 实测 terminal 恰满）。
      // 修正：deposit 目标按剩余容量选择——terminal 有空位优先（贸易/工业链），满则落 storage 兜底。
      const terminalFree = ac.snapshot.terminal
        ? ac.snapshot.terminal.store.getFreeCapacity()
        : 0;
      const dest = terminalFree > 0 ? ac.snapshot.terminal : ac.snapshot.storage;
      if (dest) return { dest, mineral: carriedMineral, phase: "deposit" as const };
      return undefined;
    },
    execute: (ac, t) => {
      runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, t.mineral));
    },
  };
}

/**
 * 矿物补仓（work 链尾部动作）— 能量已入库后，若仍有空闲容量且存在含矿物的
 * container，取矿回 storage/terminal。刻意排在 fillStorage/haulFillTarget 之后：
 * 能量是生命线必须优先入库；旧实现把取矿相位挂在 haulMineralsToStorage（work 链首位），
 * 背着能量要去存 storage 的 hauler 当 tick 被派去取矿 → fillStorage 轮不到 → 能量滞留 +
 * hauler 卡取矿循环不回 acquire 排空 storage link（线上实证：storage-link 满、能量不入库）。
 * 分离后：先倒矿、再倒能、有余量才补矿。
 */
export function haulMineralTopUp(): ActionCandidate<StructureContainer> {
  return {
    name: "haul:mineral-topup",
    resolve: (ac) => {
      if (ac.creep.store.getFreeCapacity() === 0) return undefined;
      if (!ac.snapshot.storage && !ac.snapshot.terminal) return undefined;
      const source = ac.snapshot.containers.find(c => {
        for (const res of Object.keys(c.store) as ResourceConstant[]) {
          if (res !== RESOURCE_ENERGY && c.store[res]! > 0) return true;
        }
        return false;
      });
      if (!source) return undefined;
      return source;
    },
    execute: (ac, source) => {
      const mineral = (Object.keys(source.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && source.store[r]! > 0);
      if (!mineral) return;
      runAction(ac.creep, source, () => ac.creep.withdraw(source, mineral));
    },
  };
}

/** supplyLabs 的 resolve 返回类型。 */
type LabSupplyTarget =
  | { dest: StructureLab; resource: ResourceConstant; phase: "deposit" }
  | { dest: StructureStorage | StructureTerminal; resource: ResourceConstant; phase: "dump" }
  | { source: StructureStorage | StructureTerminal; resource: ResourceConstant; amount: number; phase: "withdraw" }
  | { source: StructureLab; resource: ResourceConstant; phase: "unload" };

/** storage 能量地板：低于此值不为 lab 抽能 — boost 能量不与 spawn/tower 补给抢血。
 * D-2 修复：地板对齐水位权限表刻度（distributorTiers.low = 2000）— 原私有常量 1000 低于
 * distributor 的最低档位线，lab 供料会在 distributor 已进入 tier 3 极限节流时仍照常抽血，口径脱节。 */
const labEnergyStorageFloor = (): number => CONFIG.economy.distributorTiers.low;

/**
 * 按 lab-system 发布的需求表搬运（storage/terminal ↔ lab）。
 * 需求表（globalCache.labDemands）是化合物-lab 绑定的唯一真相源：lab 角色分配
 * （input1/input2/output/boost）只有 lab-system 知道，搬运端绝不自行猜测——盲搬会让错矿占位、反应死锁。
 * 四相：deposit（携资源正是某 lab 装料需求 → 送入）/ dump（携化合物无 lab 需要 → 倒回 storage 解堵）/
 * unload（空载且需清位/产物回收 → 从 lab 取出）/ withdraw（空载且有装料需求 → storage 优先取料）。
 * 注意：容量判断必须带资源参数 — lab 是受限 store，无参 getFreeCapacity() 返回 null（旧实现全链断路的根因）。
 */
export function supplyLabs(): ActionCandidate<LabSupplyTarget> {
  return {
    name: "haul:supply-labs",
    resolve: (ac) => {
      if (ac.snapshot.labs.length === 0) return undefined;
      const storage = ac.snapshot.storage;
      if (!storage) return undefined;

      const demands = globalCache().labDemands;
      const table = demands?.tick === Game.time ? demands.byRoom[ac.snapshot.roomName] : undefined;
      if (!table) return undefined;

      const store = ac.creep.store;
      const carriedCompound = (Object.keys(store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && store[r]! > 0);

      // 1. 携带化合物：送到需要它的 lab；无需求方则倒回 storage 解堵。
      if (carriedCompound) {
        for (const load of table.loads) {
          if (load.resource !== carriedCompound) continue;
          const lab = getObjectById(load.labId as Id<StructureLab>);
          if (lab && (lab.store.getFreeCapacity(carriedCompound) ?? 0) > 0) {
            return { dest: lab, resource: carriedCompound, phase: "deposit" as const };
          }
        }
        return { dest: storage, resource: carriedCompound, phase: "dump" as const };
      }

      // 2. 携带能量且 lab 有能量缺口：直接投喂（boostCreep 每部件消耗 20 能量）。
      if (store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        for (const load of table.loads) {
          if (load.resource !== RESOURCE_ENERGY) continue;
          const lab = getObjectById(load.labId as Id<StructureLab>);
          if (lab && (lab.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0) > 0) {
            return { dest: lab, resource: RESOURCE_ENERGY, phase: "deposit" as const };
          }
        }
        return undefined;
      }

      // 3. 空载：先清（错矿/产物回收）再装 — 清位不完成，装料就会 ERR_FULL 空转。
      for (const unload of table.unloads) {
        const lab = getObjectById(unload.labId as Id<StructureLab>);
        const resource = unload.resource as ResourceConstant;
        if (lab && (lab.store[resource] ?? 0) > 0) {
          return { source: lab, resource, phase: "unload" as const };
        }
      }

      const terminal = ac.snapshot.terminal;
      for (const load of table.loads) {
        const resource = load.resource as ResourceConstant;
        if (resource === RESOURCE_ENERGY) {
          if (storage.store.getUsedCapacity(RESOURCE_ENERGY) > labEnergyStorageFloor()) {
            return { source: storage, resource, amount: load.amount, phase: "withdraw" as const };
          }
          continue;
        }
        // 化合物：storage 优先，terminal 回退 — 市场买入的矿物落在 terminal，
        // 没有回退则贸易补给的原料永远进不了反应链。
        if ((storage.store[resource] ?? 0) > 0) {
          return { source: storage, resource, amount: load.amount, phase: "withdraw" as const };
        }
        if (terminal && (terminal.store[resource] ?? 0) > 0) {
          return { source: terminal, resource, amount: load.amount, phase: "withdraw" as const };
        }
      }
      return undefined;
    },
    execute: (ac, t) => {
      if (t.phase === "deposit" || t.phase === "dump") {
        runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, t.resource));
      } else if (t.phase === "unload") {
        runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.resource));
      } else {
        const available = t.source.store[t.resource] ?? 0;
        const amount = Math.min(t.amount, available, ac.creep.store.getFreeCapacity() ?? 0);
        if (amount <= 0) return;
        runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.resource, amount));
      }
    },
  };
}

/** stockTerminalEnergy 的 resolve 返回类型。 */
type TerminalStockTarget =
  | { dest: StructureTerminal; phase: "deposit" }
  | { source: StructureStorage; phase: "withdraw" };

/**
 * 维持 terminal 能量储备（storage → terminal）。市场 deal 无论买卖都从本方 terminal 扣能量运费 —
 * terminal 没能量，贸易系统就是摆设。仅在 storage 能量高于地板值时搬运（经济优先于贸易）。
 * 双相候选：空载取 storage、满载送 terminal，可同时放入 acquire/work 链。
 */
export function stockTerminalEnergy(): ActionCandidate<TerminalStockTarget> {
  return {
    name: "haul:stock-terminal-energy",
    resolve: (ac) => {
      // 无市场（真无 market API 的服务器）时禁止向 terminal 灌能量——能量无消费方会永久锁死；
      // 有市场时靠下方 D-1 水位门禁（storage ≥ 20k 才备货）。与 terminal-manager 的 no-market 守卫同款。
      if (typeof Game.market?.getAllOrders !== "function") return undefined;
      const terminal = ac.snapshot.terminal;
      const storage = ac.snapshot.storage;
      if (!terminal || !storage) return undefined;
      const need = CONFIG.market.energyTarget - terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      if (need <= 0) return undefined;

      const carrying = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
      // D-1 修复：deposit 相同样受水位门禁 — 原先只有 withdraw 相检查 floor，携能 creep 在 storage
      // 跌破地板后仍会把背包能量喂给 terminal（贸易储备侵占经济能量）。低水位返回 undefined，
      // 放行后续候选把能量送回经济 sink（distributorFillTarget 等）。
      if (storage.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.market.storageEnergyFloor) {
        return undefined;
      }
      if (carrying > 0) return { dest: terminal, phase: "deposit" as const };

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

/**
 * commodity 生产补料（审计缺口 6 的 distributor 侧）：按 factory-manager
 * 缓存在 globalCache.factoryTargets 的当前生产目标，把 factory 内缺的
 * 配方组件从 storage 搬进 factory（produce 从 factory.store 扣料 — 原料
 * 不进 factory 就永远不产）。双相候选：空载取 storage 缺料、满载送 factory。
 * 无目标/无缺口/无货 → 放行后续候选（零干扰）。
 */
type FactoryComponentTarget =
  | { dest: StructureFactory; resourceType: ResourceConstant; phase: "deposit" }
  | { source: StructureStorage; resourceType: ResourceConstant; phase: "withdraw" };

export function stockFactoryComponents(): ActionCandidate<FactoryComponentTarget> {
  return {
    name: "haul:stock-factory-components",
    resolve: (ac) => {
      const factory = ac.snapshot.factory;
      const storage = ac.snapshot.storage;
      if (!factory || !storage) return undefined;
      // 目标锚：factory-manager 每 interval 写（无 COMMODITIES/无目标时无键）。
      const g = globalCache() as { factoryTargets?: Record<string, string> };
      const target = g.factoryTargets?.[ac.snapshot.roomName];
      if (!target) return undefined;
      const table = (globalThis as { COMMODITIES?: Record<string, { components?: Record<string, number> }> }).COMMODITIES;
      const components = table?.[target]?.components;
      if (!components) return undefined;

      // deposit 相：背包携任意组件资源即送 factory。
      const carried = Object.entries(ac.creep.store as unknown as Record<string, number>)
        .find(([res, amount]) => amount > 0 && (components[res] ?? 0) > 0);
      if (carried) {
        return { dest: factory, resourceType: carried[0] as ResourceConstant, phase: "deposit" as const };
      }
      // withdraw 相：挑缺口最大且 storage 有货的组件。
      let pick: { res: string; gap: number } | undefined;
      for (const [res, amount] of Object.entries(components)) {
        const gap = amount - (factory.store[res as ResourceConstant] ?? 0);
        if (gap <= 0) continue;
        const inStorage = storage.store[res as ResourceConstant] ?? 0;
        if (inStorage <= 0) continue;
        if (!pick || gap > pick.gap) pick = { res, gap };
      }
      if (!pick) return undefined;
      return { source: storage, resourceType: pick.res as ResourceConstant, phase: "withdraw" as const };
    },
    execute: (ac, t) => {
      if (t.phase === "deposit") {
        runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, t.resourceType));
      } else {
        runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.resourceType));
      }
    },
  };
}

/**
 * nuke 资产抢救搬运链（审计缺口 3 的 distributor 侧）：本房 nuke 落点预警时把
 * storage 库存搬向 terminal，支撑 terminal-manager 的逐轮 send（terminal 容量
 * 300k，storage 典型百万级 — 不搬运则只抢救 terminal 现货，storage 全损）。
 * 抢救语义压倒一切经济门禁：无水位地板（storage 就要没了）、无市场可用性检查
 * （send 不依赖市场）。单资源/tick 搬运 — 50000 tick 窗口 × ~200/tick 搬运速率
 * 足够清空典型库存；非能量资源（价值密度高）优先于能量。
 * 双相候选：空载从 storage 取「存量最大的非能量资源」（无则能量），满载送 terminal。
 */
type SalvageTransferTarget =
  | { dest: StructureTerminal; resourceType: ResourceConstant; phase: "deposit" }
  | { source: StructureStorage; resourceType: ResourceConstant; phase: "withdraw" };

export function salvageStorageToTerminal(): ActionCandidate<SalvageTransferTarget> {
  return {
    name: "salvage:storage-to-terminal",
    resolve: (ac) => {
      // 仅 nuke 警报房激活（常态零开销 — 一个字段判空）。
      if ((ac.snapshot.incomingNukes?.length ?? 0) === 0) return undefined;
      const terminal = ac.snapshot.terminal;
      const storage = ac.snapshot.storage;
      if (!terminal || !storage) return undefined;
      if (terminal.store.getFreeCapacity() <= 0) return undefined;

      // deposit 相：背包有任意资源即送 terminal。
      const carried = Object.entries(ac.creep.store as unknown as Record<string, number>)
        .find(([, amount]) => amount > 0);
      if (carried) {
        return {
          dest: terminal,
          resourceType: carried[0] as ResourceConstant,
          phase: "deposit" as const,
        };
      }
      // withdraw 相：挑 storage 中存量最大的非能量资源（价值密度优先），无则能量。
      const entries = Object.entries(storage.store as unknown as Record<string, number>)
        .filter(([resourceType, amount]) => amount > 0 && resourceType !== RESOURCE_ENERGY);
      const pick = entries.length > 0
        ? entries.reduce((a, b) => (b[1] > a[1] ? b : a))
        : (["energy", storage.store[RESOURCE_ENERGY] ?? 0] as [string, number]);
      if (pick[1] <= 0) return undefined;
      return {
        source: storage,
        resourceType: pick[0] as ResourceConstant,
        phase: "withdraw" as const,
      };
    },
    execute: (ac, t) => {
      if (t.phase === "deposit") {
        runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, t.resourceType));
      } else {
        runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.resourceType));
      }
    },
  };
}

/**
 * W7 止血修正（2026-08-01）：storage 饥饿时把 terminal 交易储备压缩回 storage。
 * 背景（前提修正）：私服引擎 4.3.0 自带市场 API 但市场可以为空（credits=0、无订单）——
 * terminal-manager 从不成交，富余期灌入的 10k 交易储备变死资本（W7N3/W7N4 实测恒 10150、storage=0），
 * 故改为与市场状态无关的「饥饿压缩」语义。
 * 规则（全满足才取）：storage 低于 20k（只有经济饥饿才动交易储备）；terminal 高于饥饿储备地板
 * （有市场留 2k 运费余量，无市场归零）；storage 与背包有余量。
 * 取能后由 hauler work 链 fillStorage 存入 storage（hauler 只禁从 storage 取能，terminal 不在此列）；
 * storage 恢复后 stockTerminalEnergy 按 energyTarget 回补——本动作只救急、不改变储备目标。
 */
export function withdrawTerminalEnergy(): ActionCandidate<StructureTerminal> {
  return {
    name: "withdraw:terminal-energy-rescue",
    resolve: (ac) => {
      const terminal = ac.snapshot.terminal;
      const storage = ac.snapshot.storage;
      if (!terminal || !storage) return undefined;
      // 经济健康时不动交易储备（stockTerminalEnergy 负责回补）。
      if (storage.store.getUsedCapacity(RESOURCE_ENERGY) >= CONFIG.market.storageEnergyFloor) {
        return undefined;
      }
      // 饥饿储备地板：有市场留运费余量，无市场归零（死资本全量排空）。
      const marketAvailable = typeof Game.market?.getAllOrders === "function";
      const reserveFloor = marketAvailable ? CONFIG.market.terminalEnergyReserveFloor : 0;
      const terminalEnergy = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      if (terminalEnergy <= reserveFloor) return undefined;
      if (storage.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      if (ac.creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return terminal;
    },
    execute: (ac, terminal) => {
      const amount = Math.min(
        terminal.store.getUsedCapacity(RESOURCE_ENERGY),
        ac.creep.store.getFreeCapacity(RESOURCE_ENERGY),
      );
      const result = ac.creep.withdraw(terminal, RESOURCE_ENERGY, amount);
      // 仅 NOT_IN_RANGE 触发移动（角色移动铁律）。ERR_NOT_ENOUGH_RESOURCES 等
      // 瞬态失败静默——下 tick 重新 resolve，不切 idle 中断候选链。
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, terminal);
      }
    },
  };
}

/** stockFactoryEnergy 的 resolve 返回类型。 */
type FactoryStockTarget =
  | { dest: StructureFactory; phase: "deposit" }
  | { source: StructureStorage; phase: "withdraw" };

/**
 * 为 factory 补给压缩原料能量（storage → factory）。仅在 storage 满仓信号下触发 —
 * factory 压缩是对「必然浪费」的能量回收，正常水位下能量应流向 upgrade/build。
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

/** reclaimFactoryOutput 的 resolve 返回类型。 */
type FactoryReclaimTarget =
  | { dest: StructureStorage | StructureTerminal; resource: ResourceConstant; phase: "deposit" }
  | { source: StructureFactory; resource: ResourceConstant; phase: "withdraw" };

/** commodity 回收阈值 — 与 battery 共用，factory 总容量 50k 产出无出路必堵死。 */
const FACTORY_RECLAIM_THRESHOLD = 100;

/**
 * 回收 factory 的产出（factory → terminal/storage）。
 * 覆盖两类产出：① battery（满仓压缩产物）；② commodity（升级链产物如 circuit/wire/alloy）。
 * 背景：factory 总容量 50k，产出若无搬运出路，积满后投料 transfer 必返 ERR_FULL
 * 被静默忽略 → 生产链死锁。原实现只回收 battery — commodity 产出积压后 commodity 链
 * 死锁（factory-manager produce 永远 ERR_FULL）。
 * 攒批阈值触发减少往返；投放目标遵循 W7 教训：有市场时 terminal 优先（交易变现入口），
 * 无市场/满则落 storage。能量不回收（能量是 factory 运营原料，不是产出）。
 */
export function reclaimFactoryOutput(): ActionCandidate<FactoryReclaimTarget> {
  return {
    name: "haul:reclaim-factory-output",
    resolve: (ac) => {
      const factory = ac.snapshot.factory;
      if (!factory) return undefined;

      // 扫描 factory store 中所有非 energy 产出资源。
      const outputs: { res: ResourceConstant; qty: number }[] = [];
      for (const res of Object.keys(factory.store) as ResourceConstant[]) {
        if (res === RESOURCE_ENERGY) continue;
        const qty = factory.store[res] ?? 0;
        if (qty > 0) outputs.push({ res, qty });
      }

      // deposit 相：creep 携带产出资源 → 送 terminal（有市场有空位）或 storage。
      const carriedOutput = (Object.keys(ac.creep.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && (ac.creep.store[r] ?? 0) > 0);
      if (carriedOutput) {
        const marketAvailable = typeof Game.market?.getAllOrders === "function";
        const terminalFree = marketAvailable && ac.snapshot.terminal
          ? (ac.snapshot.terminal.store.getFreeCapacity(carriedOutput) ?? 0)
          : 0;
        const dest = terminalFree > 0 ? ac.snapshot.terminal : ac.snapshot.storage;
        if (dest) return { dest, resource: carriedOutput, phase: "deposit" as const };
        return undefined;
      }

      // withdraw 相：挑存量最大的产出资源（battery 或 commodity），达阈值才搬。
      // battery 攒批阈值更高（200，压缩产物量大），commodity 阈值更低（100，高值不积压）。
      if (ac.creep.store.getFreeCapacity() === 0) return undefined;
      let pick: { res: ResourceConstant; qty: number } | undefined;
      for (const o of outputs) {
        const threshold = o.res === RESOURCE_BATTERY
          ? CONFIG.factory.batteryReclaimThreshold
          : FACTORY_RECLAIM_THRESHOLD;
        if (o.qty < threshold) continue;
        if (!pick || o.qty > pick.qty) pick = o;
      }
      if (!pick) return undefined;
      return { source: factory, resource: pick.res, phase: "withdraw" as const };
    },
    execute: (ac, t) => {
      if (t.phase === "deposit") {
        runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, t.resource));
      } else {
        runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.resource));
      }
    },
  };
}

/** stockPowerSpawn 的 resolve 返回类型。 */
type PowerSpawnStockTarget =
  | { dest: StructurePowerSpawn; resource: ResourceConstant; phase: "deposit" }
  | { source: StructureStorage | StructureTerminal; resource: ResourceConstant; phase: "withdraw" };

// ─── nuker 装填（战略威慑链）────────────────────────────────

/** stockNuker 的 resolve 返回类型。 */
type NukerStockTarget =
  | { dest: StructureNuker; resource: ResourceConstant; phase: "deposit" }
  | { source: StructureStorage | StructureTerminal; resource: ResourceConstant; phase: "withdraw" };

/**
 * 为 nuker 装填威慑备弹（energy 50k：storage → nuker；G 5k：storage/terminal → nuker）。
 * 背景：nuker 建成即死链与 powerSpawn 同款 — 无搬运通道则威慑资产恒空弹。
 * 威慑语义是「常态装填」：装满后停放（敌方进攻前会掂量报复成本），战时由
 * war-planner 决策发射。
 * 能量门禁用 market.storageEnergyFloor（20k）而非 distributorTiers.low —
 * 50k 装填量是 powerSpawn 涓流的 50 倍，低水位地板防它一口气抽干经济储备；
 * storage 跌破地板时暂停装填（已装入的当量保留，发射不受影响）。
 * G 是矿物不抢生存能量，无地板门禁。
 */
export function stockNuker(): ActionCandidate<NukerStockTarget> {
  return {
    name: "haul:stock-nuker",
    resolve: (ac) => {
      const nuker = ac.snapshot.nuker;
      const storage = ac.snapshot.storage;
      if (!nuker || !storage) return undefined;

      const energyShort = nuker.store.getUsedCapacity(RESOURCE_ENERGY) < NUKE_ENERGY_COST;
      const ghodiumShort = (nuker.store[RESOURCE_GHODIUM] ?? 0) < NUKE_GHODIUM_COST;

      // 携带 energy/G：nuker 缺该资源才认领（不劫持经济能量 — 与 stockPowerSpawn 同款防呆）。
      const carried = ([RESOURCE_ENERGY, RESOURCE_GHODIUM] as ResourceConstant[])
        .find(r => (ac.creep.store[r] ?? 0) > 0);
      if (carried) {
        const wanted = carried === RESOURCE_ENERGY ? energyShort : ghodiumShort;
        if (wanted && (nuker.store.getFreeCapacity(carried) ?? 0) > 0) {
          return { dest: nuker, resource: carried, phase: "deposit" as const };
        }
        return undefined;
      }

      // 空载：能量装填受高水位地板（50k 大额抽血不与 spawn/tower 抢）。
      if (
        energyShort &&
        storage.store.getUsedCapacity(RESOURCE_ENERGY) > CONFIG.market.storageEnergyFloor
      ) {
        return { source: storage, resource: RESOURCE_ENERGY, phase: "withdraw" as const };
      }
      if (ghodiumShort) {
        if ((storage.store[RESOURCE_GHODIUM] ?? 0) > 0) {
          return { source: storage, resource: RESOURCE_GHODIUM, phase: "withdraw" as const };
        }
        const terminal = ac.snapshot.terminal;
        if (terminal && (terminal.store[RESOURCE_GHODIUM] ?? 0) > 0) {
          return { source: terminal, resource: RESOURCE_GHODIUM, phase: "withdraw" as const };
        }
      }
      return undefined;
    },
    execute: (ac, t) => {
      if (t.phase === "deposit") {
        runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, t.resource));
      } else {
        const available = t.source.store[t.resource] ?? 0;
        const amount = Math.min(available, ac.creep.store.getFreeCapacity() ?? 0);
        if (amount <= 0) return;
        runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.resource, amount));
      }
    },
  };
}

/**
 * 为 powerSpawn 补给原料（能量: storage → powerSpawn；power: terminal/storage → powerSpawn）。
 * 背景：processPower 消耗 1 power + 50 energy/次，此前两样都无搬运通道 — 结构建成
 * 即死链（GPL 恒为 0）。power 从 terminal 取（市场 deal 落地处），storage 回退。
 * 能量抽取受 distributorTiers.low 水位地板 — 与 lab 供料同口径，不与 spawn/tower 抢血。
 * 投放相仅在 powerSpawn 确有缺口时认领携载资源，防止劫走 spawn 填充用的能量。
 */
export function stockPowerSpawn(): ActionCandidate<PowerSpawnStockTarget> {
  return {
    name: "haul:stock-power-spawn",
    resolve: (ac) => {
      const ps = ac.snapshot.powerSpawn;
      const storage = ac.snapshot.storage;
      if (!ps || !storage) return undefined;

      const energyShort = ps.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.factory.powerSpawnEnergyTarget;
      const powerShort = ps.store.getUsedCapacity(RESOURCE_POWER) < CONFIG.factory.powerSpawnPowerTarget;

      // 携带能量/power：只有 powerSpawn 缺该资源才认领（否则放行给经济 sink）。
      const carried = ([RESOURCE_ENERGY, RESOURCE_POWER] as ResourceConstant[])
        .find(r => (ac.creep.store[r] ?? 0) > 0);
      if (carried) {
        const wanted = carried === RESOURCE_ENERGY ? energyShort : powerShort;
        if (wanted && (ps.store.getFreeCapacity(carried) ?? 0) > 0) {
          return { dest: ps, resource: carried, phase: "deposit" as const };
        }
        return undefined;
      }

      // 空载：能量缺口优先（运营必需），且 storage 高于水位地板才抽能。
      if (energyShort && storage.store.getUsedCapacity(RESOURCE_ENERGY) > labEnergyStorageFloor()) {
        return { source: storage, resource: RESOURCE_ENERGY, phase: "withdraw" as const };
      }
      if (powerShort) {
        if ((storage.store[RESOURCE_POWER] ?? 0) > 0) {
          return { source: storage, resource: RESOURCE_POWER, phase: "withdraw" as const };
        }
        const terminal = ac.snapshot.terminal;
        if (terminal && (terminal.store[RESOURCE_POWER] ?? 0) > 0) {
          return { source: terminal, resource: RESOURCE_POWER, phase: "withdraw" as const };
        }
      }
      return undefined;
    },
    execute: (ac, t) => {
      if (t.phase === "deposit") {
        runAction(ac.creep, t.dest, () => ac.creep.transfer(t.dest, t.resource));
      } else {
        const available = t.source.store[t.resource] ?? 0;
        const amount = Math.min(available, ac.creep.store.getFreeCapacity() ?? 0);
        if (amount <= 0) return;
        runAction(ac.creep, t.source, () => ac.creep.withdraw(t.source, t.resource, amount));
      }
    },
  };
}
