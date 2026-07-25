/**
 * Withdraw actions — 从结构取能。
 *
 * 命名约定：
 *   - withdrawRichest*   — 从最满的 container 取
 *   - withdrawClosest*   — 从最近的 container 取
 *   - withdrawController* — 从 controller 旁结构取（站桩升级）
 *   - withdrawStorage*   — 从 storage 取
 *   - withdrawCapped      — 限量取（避免 ERR_NOT_ENOUGH_RESOURCES）
 */
import type { ActionCandidate, ActionContext } from "../action-types";
import { moveToTarget } from "../../movement";
import { actOrMove } from "./helpers";
import {
  findClosestContainerWithEnergy,
  findRichestContainer,
} from "../../support/targeting";

/** 从最满 container 取能。 */
export function withdrawRichestContainer(): ActionCandidate {
  return {
    name: "withdraw:richest-container",
    resolve: (ac) => {
      const best = findRichestContainer(ac.snapshot.containers);
      if (!best || best.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return best;
    },
    execute: (ac, target) => {
      const best = target as StructureContainer;
      actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从最近有能量的 container 取能（builder 减少通勤）。 */
export function withdrawClosestContainer(): ActionCandidate {
  return {
    name: "withdraw:closest-container",
    resolve: (ac) => findClosestContainerWithEnergy(ac.creep, ac.snapshot.containers),
    execute: (ac, target) => {
      const best = target as StructureContainer;
      actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/**
 * 判断 container 是否为物流关键 container（source container 或 controller container）。
 *
 * - source container：紧邻 source，是 hauler 的物流源。非采集角色直接取用会导致
 *   hauler 无事可做、物流链断裂。
 * - controller container：紧邻 controller，是 upgrader 的站桩能量源。builder 取用
 *   会导致 upgrader 断粮，站桩升级链路崩溃。
 *
 * builder 等非物流角色应从非物流 container（如 mineral container）取能。
 */
function isLogisticsContainer(c: StructureContainer, ac: ActionContext): boolean {
  // source container
  if (ac.snapshot.sources.some(s => c.pos.getRangeTo(s.pos) <= 1)) return true;
  // controller container
  if (ac.snapshot.controllerContainer?.id === c.id) return true;
  return false;
}

/** 从最满的非物流 container 取能（upgrader 用，不抢 hauler/upgrader 的物流源）。 */
export function withdrawRichestNonSourceContainer(): ActionCandidate {
  return {
    name: "withdraw:richest-non-source-container",
    resolve: (ac) => {
      const candidates = ac.snapshot.containers.filter(
        c => !isLogisticsContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      return findRichestContainer(candidates);
    },
    execute: (ac, target) => {
      const best = target as StructureContainer;
      actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从最近的非物流 container 取能（builder 用，不抢 hauler/upgrader 的物流源）。 */
export function withdrawClosestNonSourceContainer(): ActionCandidate {
  return {
    name: "withdraw:closest-non-source-container",
    resolve: (ac) => {
      const candidates = ac.snapshot.containers.filter(
        c => !isLogisticsContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      return findClosestContainerWithEnergy(ac.creep, candidates);
    },
    execute: (ac, target) => {
      const best = target as StructureContainer;
      actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从 controller 旁 container 取能（站桩升级）。 */
export function withdrawControllerContainer(): ActionCandidate {
  return {
    name: "withdraw:controller-container",
    resolve: (ac) => {
      const cc = ac.snapshot.controllerContainer;
      if (!cc || cc.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return cc;
    },
    execute: (ac, target) => {
      const cc = target as StructureContainer;
      actOrMove(ac.creep, cc, () => ac.creep.withdraw(cc, RESOURCE_ENERGY));
    },
  };
}

/** 从 controller 旁 link 取能（link 站桩升级，0 通勤）。 */
export function withdrawControllerLink(): ActionCandidate {
  return {
    name: "withdraw:controller-link",
    resolve: (ac) => {
      if (ac.snapshot.links.length === 0 || !ac.snapshot.controller) return undefined;
      return ac.snapshot.links.find(
        l => l.pos.getRangeTo(ac.snapshot.controller!) <= 2 && l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
    },
    execute: (ac, target) => {
      const ctrlLink = target as StructureLink;
      actOrMove(ac.creep, ctrlLink, () => ac.creep.withdraw(ctrlLink, RESOURCE_ENERGY));
    },
  };
}

/** 从 storage 取能。 */
export function withdrawStorage(): ActionCandidate {
  return {
    name: "withdraw:storage",
    resolve: (ac) => {
      const st = ac.snapshot.storage;
      if (!st || st.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return st;
    },
    execute: (ac, target) => {
      const st = target as StructureStorage;
      actOrMove(ac.creep, st, () => ac.creep.withdraw(st, RESOURCE_ENERGY));
    },
  };
}

/**
 * 从 storage 旁 link 取能 — link 物流链的「最后一公里」。
 *
 * Link 网络能量流：
 *   Harvester → Source Link →(link-system 瞬移)→ Storage Link →(本 action)→ Hauler → Storage
 *
 * 如果没有 creep 定期排空 storage link，link 网络会堵死：
 * storage link 满后 planLinkTransfers 的 storageFree=0，
 * source link 无法再向其传输，整条链路背压瘫痪。
 *
 * 优先级：link-system (P1) 在 creep 之前运行，会先将 storage link → controller link
 * 传输（如果 controller 缺能），hauler 排空的是剩余部分 — 不影响升级链供能。
 *
 * 限量取能：与 withdrawCapped 一致，取 min(可用, 空闲)，避免 ERR_NOT_ENOUGH_RESOURCES。
 */
export function withdrawStorageLink(): ActionCandidate {
  return {
    name: "withdraw:storage-link",
    resolve: (ac) => {
      const st = ac.snapshot.storage;
      if (!st) return undefined;
      return ac.snapshot.links.find(
        l => l.pos.getRangeTo(st) <= 2 && l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
    },
    execute: (ac, target) => {
      const link = target as StructureLink;
      const available = link.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      const result = ac.creep.withdraw(link, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, link);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/**
 * 从 storage 限量取能（upgrader 专用）。
 *
 * 防止 upgrader 一次取走大量能量导致 storage 突降、触发 economyPressure
 * 连锁降级。单次取 min(可用, 空闲, limit)。
 *
 * P1-1: limit 可为固定值或动态函数 — 动态函数允许按 storage 水位缩放取能上限。
 */
export function withdrawStorageCapped(
  limit: number | ((ac: ActionContext) => number),
): ActionCandidate {
  return {
    name: "withdraw:storage-capped",
    resolve: (ac) => {
      const st = ac.snapshot.storage;
      if (!st || st.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      const effectiveLimit = typeof limit === "function" ? limit(ac) : limit;
      return { storage: st, limit: effectiveLimit };
    },
    execute: (ac, target) => {
      const { storage, limit: effectiveLimit } = target as { storage: StructureStorage; limit: number };
      const available = storage.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree, effectiveLimit);
      const result = actOrMove(ac.creep, storage, () => ac.creep.withdraw(storage, RESOURCE_ENERGY, amount));
      if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/** 限量 withdraw（hauler 专用，避免 ERR_NOT_ENOUGH_RESOURCES）。 */
export function withdrawCapped(target: (ac: ActionContext) => StructureContainer | StructureStorage | undefined): ActionCandidate {
  return {
    name: "withdraw:capped",
    resolve: (ac) => {
      const t = target(ac);
      if (!t || t.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return t;
    },
    execute: (ac, target) => {
      const t = target as StructureContainer | StructureStorage;
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
