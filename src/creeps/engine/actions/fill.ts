/** Fill actions — 向 fillTarget / storage / container 送能（与 dump 的区别： */
import type { ActionCandidate } from "../action-types";
import { globalCache } from "../../../kernel/global-cache";
import { ACTION_RANGE_NEAR, runAction, runCountedAction } from "./helpers";
import { updateMode } from "../lifecycle";
import {
  findEmptiestContainer,
  getDistributorFillTarget,
  getFillTarget,
  getHaulFillTarget,
} from "../../support/targeting";
import { getObjectById } from "../../support/obj-cache";
import { CONFIG } from "../../../config";

/**
 * 交付入账字段：只有**能量真的离开采掘那一间房**时才算「跨房导入」。
 * 两个排除项各有其重复记账的形状：
 * ①本地搬运不计收入 —— 本房 harvested 已记过 source 产能，再计一次是重复记账；
 * ②**交付落点就在采掘房（远矿 container 等）也不算** —— 那度电从未离开 remoteTarget，
 *   而记账键是 home（helpers.runCountedAction 用 creep.memory.home），会把「A 房内环」
 *   记成「home 房白收一笔」，凭空抬高 home 的净流（净流是扩张闸的输入）。
 */
function importedFieldFor(
  creep: Creep,
  dest: RoomPosition | { pos: RoomPosition },
): "imported" | undefined {
  const source = creep.memory.remoteTarget;
  if (!source) return undefined;
  const destRoom = "pos" in dest ? dest.pos.roomName : dest.roomName;
  return destRoom === source ? undefined : "imported";
}

/** 交付意图量 = min(背包能量, 目标空余)。动作前求值，ERR_FULL 时归零。 */
function transferIntent(creep: Creep, target: AnyOwnedStructure): number {
  const carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const store = (target as { store?: { getFreeCapacity(r?: ResourceConstant): number } }).store;
  if (!store) return carried;
  return Math.min(carried, store.getFreeCapacity(RESOURCE_ENERGY));
}

/** 向 fillTarget 送能（通用，使用 getFillTarget）。目标持久化消除等距目标摇摆。 */
export function fillTarget(): ActionCandidate<AnyOwnedStructure> {
  return {
    name: "fill:target",
    resolve: ac => {
      // 优先复用持久化目标 — 验证它仍需填充。
      if (ac.creep.memory.fillTargetId) {
        const cached = getObjectById(ac.creep.memory.fillTargetId as Id<AnyOwnedStructure>);
        if (cached && "store" in cached && cached.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          return cached;
        }
      }
      // 无有效缓存目标 — 重新选择。
      const target = getFillTarget(ac.creep, ac.snapshot);
      if (target) {
        ac.creep.memory.fillTargetId = target.id;
      }
      return target;
    },
    execute: (ac, t) => {
      runAction(ac.creep, t, ACTION_RANGE_NEAR, () => ac.creep.transfer(t, RESOURCE_ENERGY), {
        [ERR_FULL]: () => {
          ac.creep.memory.fillTargetId = undefined;
          updateMode(ac.creep);
        },
      });
    },
  };
}

/** Hauler 专用填充（带 reservation 去重 + 优先级）。 */
export function haulFillTarget(): ActionCandidate<AnyOwnedStructure> {
  return {
    name: "fill:haul-target",
    // 纯检查：fillTargets 已按是否有空闲容量过滤（room-snapshot.ts）。
    // 严禁添加 `|| controllerContainer !== undefined` — controllerContainer 存在不等于需要填充：
    // 会导致 predicate 返回 true 而 execute 内 getHaulFillTarget 返回 undefined，FSM 在此
    // return 不再 fallthrough，hauler 永远无法到达 fillStorage() — storage 空置死锁。
    resolve: ac => {
      if (ac.snapshot.fillTargets.length === 0) return undefined;
      // 携非能量 cargo 但无能量时放行后续候选先卸货（同 distributorFillTarget）：
      // execute 只 transfer(RESOURCE_ENERGY)，携矿物会静默失败并终止候选链 →
      // 配 updateMode 总量口径 hauler 永久冻结（EN-1 公理：资格检查前置 resolve）。
      if (
        ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 &&
        ac.creep.store.getUsedCapacity() > 0
      )
        return undefined;
      return getHaulFillTarget(ac.creep, ac.snapshot);
    },
    execute: (ac, t) => {
      runCountedAction(
        ac.creep,
        t,
        ACTION_RANGE_NEAR,
        importedFieldFor(ac.creep, t),
        () => ac.creep.transfer(t, RESOURCE_ENERGY),
        { [ERR_FULL]: () => updateMode(ac.creep) },
        () => transferIntent(ac.creep, t),
      );
    },
  };
}

/**
 * Distributor 专用填充 — 用 getDistributorFillTarget（spawn/extension 绝对优先）：
 * 断能即停产，优先级高于 tower 与 controller container；controller container 仅在
 * 无 controller link 时兜底（link 网络在场时独占升级供能）。
 */
export function distributorFillTarget(): ActionCandidate<AnyOwnedStructure> {
  return {
    name: "fill:distributor-target",
    resolve: ac => {
      if (ac.snapshot.fillTargets.length === 0) return undefined;
      // 携非能量 cargo（如 lab unload 化合物）但无能量时放行后续候选先卸货：
      // execute 只 transfer energy，携化合物静默失败并终止候选链 →
      // distributor 永久冻结（EN-1 公理：资格检查前置 resolve）。
      if (
        ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 &&
        ac.creep.store.getUsedCapacity() > 0
      )
        return undefined;
      // 读取 distributor gate 每 tick 计算的水位档位，用于过滤目标类型。
      const tier = (ac.creep.memory.distributorTier as 0 | 1 | 2 | 3) ?? 0;
      return getDistributorFillTarget(ac.creep, ac.snapshot, tier);
    },
    execute: (ac, t) => {
      runAction(ac.creep, t, ACTION_RANGE_NEAR, () => ac.creep.transfer(t, RESOURCE_ENERGY), {
        [ERR_FULL]: () => updateMode(ac.creep),
      });
    },
  };
}

/** 向最空 container 倒能。 */
export function fillEmptiestContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "fill:emptiest-container",
    resolve: ac => {
      if (ac.snapshot.containers.length === 0) return undefined;
      const best = findEmptiestContainer(ac.snapshot.containers);
      if (!best || best.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return best;
    },
    execute: (ac, best) => {
      runAction(ac.creep, best, ACTION_RANGE_NEAR, () => ac.creep.transfer(best, RESOURCE_ENERGY));
    },
  };
}

/** 向 storage 送能。
 * RCL4+ 有 storage 时这是 hauler 的首选 sink（优先于 haulFillTarget）：hauler 负责
 * container → storage（收集），distributor 负责 storage → sink（分发）。
 * storage 满后 fallthrough 到 haulFillTarget。 */
export function fillStorage(): ActionCandidate<StructureStorage> {
  return {
    name: "fill:storage",
    resolve: ac => {
      if (!ac.snapshot.storage) return undefined;
      // storage 有空闲容量时才送 — 满了则 fallthrough 到 haulFillTarget
      if (ac.snapshot.storage.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      // HL-1 修复：战时 tower 补给优先于囤积。威胁在场且存在缺能 tower 时返回 undefined
      // 放行 haulFillTarget（其内部把 tower 置顶）——否则入侵期间 hauler 把能量囤进 storage，
      // distributor 在 tier≥1 跳过 tower（水位节流）→ 双泵同时缺位，tower 断能真空。
      if (ac.snapshot.threatCreeps.length > 0) {
        const towerStarved = ac.snapshot.fillTargets.some(t => t.structureType === STRUCTURE_TOWER);
        if (towerStarved) return undefined;
      }
      // 泵断供兜底：本房无存活 distributor（storage→spawn/extension 的唯一分发泵）且核心
      // sink 有缺口时跳过囤积——否则能量被锁进无人能取的 storage，energyAvailable 卡死在
      // spawn 自充值 300，满配 distributor 永远凑不齐（断供死锁）。让位后 haulFillTarget
      // 直送 spawn/extension；泵恢复后本兜底自动退出。集合缺失（reset 首 tick/精简测试）时默认泵在岗。
      const pumpRooms = globalCache().distributorRooms;
      if (pumpRooms && !pumpRooms.has(ac.creep.memory.home ?? ac.creep.room.name)) {
        const coreFillDemand = ac.snapshot.fillTargets.some(
          t => t.structureType === STRUCTURE_SPAWN || t.structureType === STRUCTURE_EXTENSION,
        );
        if (coreFillDemand) return undefined;
      }
      return ac.snapshot.storage;
    },
    execute: (ac, st) => {
      runCountedAction(
        ac.creep,
        st,
        ACTION_RANGE_NEAR,
        importedFieldFor(ac.creep, st),
        () => ac.creep.transfer(st, RESOURCE_ENERGY),
        undefined,
        () => transferIntent(ac.creep, st),
      );
    },
  };
}

/**
 * Phase C：distributor 满载回吐 —— 所有 sink 都满且 storage 低于恢复线时，把背包能量送回去。
 *
 * 为什么需要：distributor 刻意没有 `fillStorage`（架构约束，避免 storage→storage 循环），
 * 所以当它取完能量、目标被其它 distributor 填满后，能量会永久卡在背包里。
 * W8N3 实测 3 只 distributor 共约 1,110 能量卡死，同期 storage 正在低储失血。
 *
 * 与循环的边界：
 * - 只在 `fillTargets` 为空（真的无处可送）且 storage < richStorageResume 时触发；
 * - acquire 侧的 `hasDistributorFillDemand` 在 sink 满时返回 false，不会立刻又取能；
 * - storage 高于恢复线时不做 —— 那时的满载属于正常波动，回吐只会增加无谓往返。
 */
export function returnEnergyToStorage(): ActionCandidate<StructureStorage> {
  return {
    name: "fill:storage-excess",
    resolve: ac => {
      const storage = ac.snapshot.storage;
      if (!storage) return undefined;
      const carried = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
      if (carried <= 0) return undefined;
      if ((storage.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0) <= 0) return undefined;
      const storageEnergy = storage.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
      if (storageEnergy >= CONFIG.economy.upgrade.richStorageResume) return undefined;
      // 还有未填满的 sink 时让 distributorFillTarget 处理，本动作只兜「真的无处可送」。
      if (ac.snapshot.fillTargets.length > 0) return undefined;
      return storage;
    },
    execute: (ac, st) => {
      runCountedAction(
        ac.creep,
        st,
        ACTION_RANGE_NEAR,
        importedFieldFor(ac.creep, st),
        () => ac.creep.transfer(st, RESOURCE_ENERGY),
        undefined,
        () => transferIntent(ac.creep, st),
      );
    },
  };
}

/**
 * R672：优先填「非 controller container」的 fill 目标（spawn/extension/tower）。
 *
 * 为什么单独一只：controller container 在 fillTargets 里且被 upgrader 持续抽走，
 * `haulFillTarget` 会让 hauler 每拍"追着补"，把运力从建造/spawn 上吸走（线上观察：
 * hauler 守在 controller 旁，builder 在远处来回跑）。本动作只处理其余 sink；
 * controller container 由后续 `haulFillTarget` 兜底，升级不断粮。
 */
export function haulFillTargetExcludingControllerContainer(): ActionCandidate<AnyOwnedStructure> {
  return {
    name: "fill:haul-target-excluding-cc",
    resolve: ac => {
      // 只在施工期启用；用原 getHaulFillTarget（保留 fill 预约去重，防两 hauler 抢同一目标），
      // 仅跳过「CC 低于半满时的优先档」——CC 仍由后续普通 haulFillTarget 兜底。
      // R680：危机/恢复期也启用 —— 线上 W39S55 无工地但 CC 低半满锁住 hauler，
      // spawn 饿死、源容器积压、harvester idle（人口 11→4）。此时核心填充必须优先。
      const phase = Memory.rooms[ac.snapshot.roomName]?.phase?.phase;
      const crisisLike = phase === "crisis" || phase === "recovery" || phase === "bootstrap";
      if (ac.snapshot.myConstructionSites.length === 0 && !crisisLike) return undefined;
      if (
        ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 &&
        ac.creep.store.getUsedCapacity() > 0
      )
        return undefined;
      return getHaulFillTarget(ac.creep, ac.snapshot, {
        skipControllerContainerPriority: true,
      });
    },
    execute: (ac, t) => {
      runAction(ac.creep, t, ACTION_RANGE_NEAR, () => ac.creep.transfer(t, RESOURCE_ENERGY), {
        [ERR_FULL]: () => updateMode(ac.creep),
      });
    },
  };
}
