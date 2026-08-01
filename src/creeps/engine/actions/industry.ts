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
        // W7 定位（2026-08-01 部署验证）：terminal 总容量 300,000，矿物堆满时
        // transfer 必返回 ERR_FULL 且被 runAction 静默忽略 → hauler 永久背矿物
        // 锁死（W7N3 实测 terminal 恰满：energy 10150 + L 289565 + GO 285 =
        // 300000；每代 hauler 捡 L 后原地罚站至死，房间物流瘫痪）。
        // 修正：deposit 目标按剩余容量选择——terminal 有空位优先（贸易/工业链），
        // 满则落 storage（1M 容量兜底，lab 供料同样可读 storage）。
        const terminalFree = ac.snapshot.terminal
          ? ac.snapshot.terminal.store.getFreeCapacity()
          : 0;
        const dest = terminalFree > 0 ? ac.snapshot.terminal : ac.snapshot.storage;
        if (dest) return { dest, mineral: carriedMineral, phase: "deposit" as const };
        return undefined;
      }

      // H-2 修复：withdraw 相必须有空余容量才放行。
      // 满载能量的 hauler（无矿物 → 不走 deposit 相）对矿物 container
      // withdraw 必得 ERR_FULL — 未注册错误码静默空转，且 execute 已被调用
      // 即终止候选链 → 排他性全链阻塞（fillStorage 等后续候选永远轮不到）。
      // 资格检查前置到 resolve（EN-1 公理），满载放行后续候选先卸货。
      if (ac.creep.store.getFreeCapacity() === 0) return undefined;

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
  | { dest: StructureLab; resource: ResourceConstant; phase: "deposit" }
  | { dest: StructureStorage | StructureTerminal; resource: ResourceConstant; phase: "dump" }
  | { source: StructureStorage | StructureTerminal; resource: ResourceConstant; amount: number; phase: "withdraw" }
  | { source: StructureLab; resource: ResourceConstant; phase: "unload" };

/** storage 能量低于此值时不为 lab 抽能 — boost 能量不与 spawn/tower 补给抢血。 */
/** storage 能量地板：低于此值不为 lab 抽能 — boost 能量不与 spawn/tower 补给抢血。
 * D-2 修复：地板对齐水位权限表刻度（distributorTiers.low = 2000）—
 * 原私有常量 1000 低于 distributor 的最低档位线，lab 供料会在
 * distributor 已进入 tier 3 极限节流时仍照常抽血，口径脱节。 */
const labEnergyStorageFloor = (): number => CONFIG.economy.distributorTiers.low;

/**
 * 按 lab-system 发布的需求表搬运（storage/terminal ↔ lab）。
 *
 * 需求表（globalCache.labDemands）是化合物-lab 绑定的唯一真相源：
 * lab 角色分配（input1/input2/output/boost）只有 lab-system 知道，
 * 搬运端绝不自行猜测「哪个 lab 该装什么」——盲搬会让错矿占位、反应死锁。
 *
 * 四相：
 *   deposit  — 携带的资源正是某 lab 的装料需求 → 送入该 lab
 *   dump     — 携带化合物但无 lab 需要 → 倒回 storage 解堵
 *   unload   — 空载且有卸料需求（错矿清位/产物回收）→ 从 lab 取出
 *   withdraw — 空载且有装料需求 → 从 storage（优先）/terminal（市场买入回退）取料
 *
 * 注意容量判断必须带资源参数：lab 是受限 store，
 * 无参 getFreeCapacity() 返回 null——正是旧实现全链断路的根因。
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
 * 维持 terminal 能量储备（storage → terminal）。
 * 市场 deal 无论买卖都从本方 terminal 扣能量运费 — terminal 没能量，
 * 贸易系统就是摆设。仅在 storage 能量高于地板值时搬运（经济优先于贸易）。
 * 双相候选：空载取 storage、满载送 terminal，可同时放入 acquire/work 链。
 */
export function stockTerminalEnergy(): ActionCandidate<TerminalStockTarget> {
  return {
    name: "haul:stock-terminal-energy",
    resolve: (ac) => {
      // 无市场（真无 market API 的服务器）时禁止向 terminal 灌能量——能量无消费
      // 方会永久锁死。有市场时靠下方 D-1 水位门禁（storage ≥ 20k 才备货）。
      // 与 systems/terminal-manager.ts 的 no-market 守卫同款，两处必须保持一致。
      if (typeof Game.market?.getAllOrders !== "function") return undefined;
      const terminal = ac.snapshot.terminal;
      const storage = ac.snapshot.storage;
      if (!terminal || !storage) return undefined;
      const need = CONFIG.market.energyTarget - terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      if (need <= 0) return undefined;

      const carrying = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
      // D-1 修复：deposit 相同样受水位门禁 — 原先只有 withdraw 相检查 floor，
      // 携能 creep 在 storage 跌破地板后仍会把背包能量喂给 terminal（贸易
      // 储备侵占经济能量）。低水位时返回 undefined，放行后续候选把能量
      // 送回经济 sink（distributorFillTarget 等）。
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
 * W7 止血修正（2026-08-01）：storage 饥饿时把 terminal 交易储备压缩回 storage。
 *
 * 背景（前提修正）：私服引擎 4.3.0 自带市场 API，但市场可以为空（credits=0、
 * 无订单）——terminal-manager 从不成交，distributor 在 storage 富余期灌入的
 * 10k 交易储备变成死资本（W7N3/W7N4 实测 terminal 恒 10150/10400、storage=0、
 * 长期 crisis）。「无市场」判定在此服务器不成立，故改为与市场状态无关的
 * 「饥饿压缩」语义。
 *
 * 规则（全部满足才取）：
 *   - storage 能量低于 CONFIG.market.storageEnergyFloor（20k）——只有经济饥饿
 *     时才动交易储备；
 *   - terminal 能量高于「饥饿储备地板」：有市场时保留 terminalEnergyReserveFloor
 *     （2k，留运费余量），无市场时地板为 0（全量排空）；
 *   - storage 有剩余容量、creep 有背包空间。
 *
 * 取能后由 hauler work 链的 fillStorage 存入 storage（hauler 架构约束只禁止
 * 从 storage 取能，terminal 不在此列）。storage 恢复健康后 stockTerminalEnergy
 * 按 energyTarget 重新回补——本动作只救急、不改变储备目标。
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
