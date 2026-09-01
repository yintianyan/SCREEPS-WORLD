/** Fill actions — 向 fillTarget / storage / container 送能（与 dump 的区别： */
import type { ActionCandidate } from "../action-types";
import { globalCache } from "../../../kernel/global-cache";
import { runAction } from "./helpers";
import { updateMode } from "../lifecycle";
import {
  findEmptiestContainer,
  getDistributorFillTarget,
  getFillTarget,
  getHaulFillTarget,
} from "../../support/targeting";
import { getObjectById } from "../../support/obj-cache";

/** 向 fillTarget 送能（通用，使用 getFillTarget）。目标持久化消除等距目标摇摆。 */
export function fillTarget(): ActionCandidate<AnyOwnedStructure> {
  return {
    name: "fill:target",
    resolve: (ac) => {
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
      runAction(ac.creep, t, () => ac.creep.transfer(t, RESOURCE_ENERGY), {
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
    resolve: (ac) => {
      if (ac.snapshot.fillTargets.length === 0) return undefined;
      // 携非能量 cargo 但无能量时放行后续候选先卸货（同 distributorFillTarget）：
      // execute 只 transfer(RESOURCE_ENERGY)，携矿物会静默失败并终止候选链 →
      // 配 updateMode 总量口径 hauler 永久冻结（EN-1 公理：资格检查前置 resolve）。
      if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 &&
          ac.creep.store.getUsedCapacity() > 0) return undefined;
      return getHaulFillTarget(ac.creep, ac.snapshot);
    },
    execute: (ac, t) => {
      runAction(ac.creep, t, () => ac.creep.transfer(t, RESOURCE_ENERGY), {
        [ERR_FULL]: () => updateMode(ac.creep),
      });
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
    resolve: (ac) => {
      if (ac.snapshot.fillTargets.length === 0) return undefined;
      // 携非能量 cargo（如 lab unload 化合物）但无能量时放行后续候选先卸货：
      // execute 只 transfer energy，携化合物静默失败并终止候选链 →
      // distributor 永久冻结（EN-1 公理：资格检查前置 resolve）。
      if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 &&
          ac.creep.store.getUsedCapacity() > 0) return undefined;
      // 读取 distributor gate 每 tick 计算的水位档位，用于过滤目标类型。
      const tier = (ac.creep.memory.distributorTier as 0 | 1 | 2 | 3) ?? 0;
      return getDistributorFillTarget(ac.creep, ac.snapshot, tier);
    },
    execute: (ac, t) => {
      runAction(ac.creep, t, () => ac.creep.transfer(t, RESOURCE_ENERGY), {
        [ERR_FULL]: () => updateMode(ac.creep),
      });
    },
  };
}

/** 向最空 container 倒能。 */
export function fillEmptiestContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "fill:emptiest-container",
    resolve: (ac) => {
      if (ac.snapshot.containers.length === 0) return undefined;
      const best = findEmptiestContainer(ac.snapshot.containers);
      if (!best || best.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return best;
    },
    execute: (ac, best) => {
      runAction(ac.creep, best, () => ac.creep.transfer(best, RESOURCE_ENERGY));
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
    resolve: (ac) => {
      if (!ac.snapshot.storage) return undefined;
      // storage 有空闲容量时才送 — 满了则 fallthrough 到 haulFillTarget
      if (ac.snapshot.storage.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      // HL-1 修复：战时 tower 补给优先于囤积。威胁在场且存在缺能 tower 时返回 undefined
      // 放行 haulFillTarget（其内部把 tower 置顶）——否则入侵期间 hauler 把能量囤进 storage，
      // distributor 在 tier≥1 跳过 tower（水位节流）→ 双泵同时缺位，tower 断能真空。
      if (ac.snapshot.threatCreeps.length > 0) {
        const towerStarved = ac.snapshot.fillTargets.some(
          t => t.structureType === STRUCTURE_TOWER,
        );
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
      runAction(ac.creep, st, () => ac.creep.transfer(st, RESOURCE_ENERGY));
    },
  };
}
