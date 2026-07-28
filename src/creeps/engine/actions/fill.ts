/**
 * Fill actions — 向 fillTarget / storage / container 送能。
 *
 * 与 dump actions 的区别：fill 是移动角色向目标送能，
 * dump 是站桩矿工向身边结构倒能。
 *
 * 目标持久化：fillTarget / buildNearestSite 等动作复用 creep.memory 中
 * 缓存的上一 tick 目标 ID，仅在目标满/消失时重新选择，消除等距目标摇摆。
 */
import type { ActionCandidate } from "../action-types";
import { runAction } from "./helpers";
import { updateMode } from "../lifecycle";
import {
  findEmptiestContainer,
  getDistributorFillTarget,
  getFillTarget,
  getHaulFillTarget,
} from "../../support/targeting";
import { getObjectById } from "../../support/obj-cache";

/**
 * 向 fillTarget 送能（通用，使用 getFillTarget）。
 *
 * 目标持久化：优先复用上一 tick 选定的 fillTarget（creep.memory.fillTargetId），
 * 仅在目标满/消失时重新选择。消除多个等距目标间的摇摆。
 */
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
    // 纯检查：fillTargets 已包含所有需填充的 spawn/extension/tower/controller container
    // （room-snapshot.ts 按是否有空闲容量过滤）。
    // 严禁添加 `|| controllerContainer !== undefined` — controllerContainer 存在不等于需要填充。
    // 该条件会导致 predicate 返回 true 而 execute 内 getHaulFillTarget 返回 undefined，
    // FSM 在此 return 不再 fallthrough，hauler 永远无法到达 fillStorage() — storage 空置死锁。
    resolve: (ac) => {
      if (ac.snapshot.fillTargets.length === 0) return undefined;
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
 * Distributor 专用填充目标 — 用 getDistributorFillTarget（spawn/extension 绝对优先）。
 *
 * 与 haulFillTarget 的区别：distributor 的职责是 storage → 生产 sink，spawn/extension
 * 断能即停产，优先级高于 tower 与 controller container；controller container 仅在无
 * controller link 时兜底（link 网络在场时独占升级供能）。详见 getDistributorFillTarget。
 */
export function distributorFillTarget(): ActionCandidate<AnyOwnedStructure> {
  return {
    name: "fill:distributor-target",
    resolve: (ac) => {
      if (ac.snapshot.fillTargets.length === 0) return undefined;
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
 *
 * RCL4+ 有 storage 时，这是 hauler 的首选 sink（优先于 haulFillTarget）。
 * 设计意图：hauler 负责 container → storage（收集），distributor 负责 storage → spawn/extension（分发）。
 * storage 空闲时优先填充，建立中央能量储备；storage 满后 fallthrough 到 haulFillTarget。
 */
export function fillStorage(): ActionCandidate<StructureStorage> {
  return {
    name: "fill:storage",
    resolve: (ac) => {
      if (!ac.snapshot.storage) return undefined;
      // storage 有空闲容量时才送 — 满了则 fallthrough 到 haulFillTarget
      if (ac.snapshot.storage.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      // HL-1 修复：战时 tower 补给优先于囤积。
      // 威胁在场且存在缺能 tower 时返回 undefined，放行 haulFillTarget
      // （其内部把 tower 置顶）。原先 fillStorage 排在 haulFillTarget 之前
      // 无条件命中 — 入侵期间 hauler 照常把能量囤进 storage，而 distributor
      // 在 tier≥1 时跳过 tower（水位节流）→ 双泵同时缺位，tower 断能真空。
      if (ac.snapshot.threatCreeps.length > 0) {
        const towerStarved = ac.snapshot.fillTargets.some(
          t => t.structureType === STRUCTURE_TOWER,
        );
        if (towerStarved) return undefined;
      }
      return ac.snapshot.storage;
    },
    execute: (ac, st) => {
      runAction(ac.creep, st, () => ac.creep.transfer(st, RESOURCE_ENERGY));
    },
  };
}
