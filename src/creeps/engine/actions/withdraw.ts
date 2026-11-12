/** Withdraw actions — 从结构取能。命名约定：Richest*=从最满 container 取；Closest*=从最近取； */
import type { ActionCandidate, ActionContext } from "../action-types";
import { ACTION_RANGE_NEAR, runAction } from "./helpers";
import { globalCache } from "../../../kernel/global-cache";
import { findClosestContainerWithEnergy, findRichestContainer } from "../../support/targeting";
import { computeControllerLinkTarget, findStorageLink } from "../../../domain/economy/links";
import { resolveControllerDowngradeRisk } from "../../../domain/economy/downgrade-risk";
import { CONFIG } from "../../../config";

/** 从最满 container 取能。 */
export function withdrawRichestContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "withdraw:richest-container",
    resolve: ac => {
      const best = findRichestContainer(ac.snapshot.containers);
      if (!best || best.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return best;
    },
    execute: (ac, best) => {
      runAction(ac.creep, best, ACTION_RANGE_NEAR, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/**
 * R647：RCL<4 早期/回 claim 房兜底 —— 从最满 container（**含 source container**）取能。
 *
 * 这类房通常没有 controller container/link/storage（或有遗留 storage 但为 0），能量积压在
 * source container 里；upgrader 若被「不抢物流源」规则排除就会直接停摆（线上 W38S58 RCL2：
 * 控制器停在 `150/45,000`、两个 upgrader 0 能量 `acquire`、容器各 2000 满）。RCL4+ 返回
 * undefined，成熟房保持原物流分工（hauler/upgrader 不抢同一源）。
 */
export function withdrawRichestContainerEarly(): ActionCandidate<StructureContainer> {
  return {
    name: "withdraw:richest-container-early",
    resolve: ac => {
      if (ac.snapshot.rcl >= 4) return undefined;
      const best = findRichestContainer(ac.snapshot.containers);
      if (!best || best.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return best;
    },
    execute: (ac, best) => {
      runAction(ac.creep, best, ACTION_RANGE_NEAR, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从最近有能量的 container 取能（builder 减少通勤）。 */
export function withdrawClosestContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "withdraw:closest-container",
    resolve: ac => findClosestContainerWithEnergy(ac.creep, ac.snapshot.containers),
    execute: (ac, best) => {
      runAction(ac.creep, best, ACTION_RANGE_NEAR, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/**
 * 是否为物流关键 container（source container 或 controller container）。
 * source container：hauler 的物流源，非采集角色直取会致物流链断裂。**前提是本房确有存活
 * hauler**——拓荒爬坡期编制里无 hauler 时礼让对象不存在，builder/upgrader 应可直取
 * （满载 withdraw 1 tick vs harvest 慢采 25 tick）。
 * controller container：upgrader 的站桩能量源，builder 取用会致升级链崩溃（与 hauler 无关，恒生效）。
 * builder 等非物流角色应从非物流 container（如 mineral container）取能。
 */
function isLogisticsContainer(c: StructureContainer, ac: ActionContext): boolean {
  // source container — 仅当本房确有存活 hauler 消费时才礼让。
  const haulerRooms = globalCache().haulerRooms;
  const hasHauler = haulerRooms ? haulerRooms.has(ac.snapshot.roomName) : true;
  if (hasHauler && ac.snapshot.sources.some(s => c.pos.getRangeTo(s.pos) <= 1)) return true;
  // controller container — upgrader 站桩源，恒礼让。
  if (ac.snapshot.controllerContainer?.id === c.id) return true;
  return false;
}

/** 从最满的非物流 container 取能（upgrader 用，不抢 hauler/upgrader 的物流源）。 */
export function withdrawRichestNonSourceContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "withdraw:richest-non-source-container",
    resolve: ac => {
      const candidates = ac.snapshot.containers.filter(
        c => !isLogisticsContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      return findRichestContainer(candidates);
    },
    execute: (ac, best) => {
      runAction(ac.creep, best, ACTION_RANGE_NEAR, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从最近的非物流 container 取能（builder 用，不抢 hauler/upgrader 的物流源）。 */
export function withdrawClosestNonSourceContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "withdraw:closest-non-source-container",
    resolve: ac => {
      const candidates = ac.snapshot.containers.filter(
        c => !isLogisticsContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      return findClosestContainerWithEnergy(ac.creep, candidates);
    },
    execute: (ac, best) => {
      runAction(ac.creep, best, ACTION_RANGE_NEAR, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从 controller 旁 container 取能（站桩升级）。 */
export function withdrawControllerContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "withdraw:controller-container",
    resolve: ac => {
      const cc = ac.snapshot.controllerContainer;
      if (!cc || cc.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return cc;
    },
    execute: (ac, cc) => {
      runAction(ac.creep, cc, ACTION_RANGE_NEAR, () => ac.creep.withdraw(cc, RESOURCE_ENERGY));
    },
  };
}

/** 从 controller 旁 link 取能（link 站桩升级，0 通勤）。 */
export function withdrawControllerLink(): ActionCandidate<StructureLink> {
  return {
    name: "withdraw:controller-link",
    resolve: ac => {
      if (ac.snapshot.links.length === 0 || !ac.snapshot.controller) return undefined;
      return ac.snapshot.links.find(
        l =>
          l.pos.getRangeTo(ac.snapshot.controller!) <= 2 &&
          l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
    },
    execute: (ac, ctrlLink) => {
      runAction(ac.creep, ctrlLink, ACTION_RANGE_NEAR, () =>
        ac.creep.withdraw(ctrlLink, RESOURCE_ENERGY),
      );
    },
  };
}

/** 从 storage 取能。 */
export function withdrawStorage(): ActionCandidate<StructureStorage> {
  return {
    name: "withdraw:storage",
    resolve: ac => {
      const st = ac.snapshot.storage;
      if (!st || st.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return st;
    },
    execute: (ac, st) => {
      runAction(ac.creep, st, ACTION_RANGE_NEAR, () => ac.creep.withdraw(st, RESOURCE_ENERGY));
    },
  };
}

/**
 * 从 storage 旁 link 取能 — link 物流链的「最后一公里」。
 * 链路：Harvester → Source Link →(link-system 瞬移)→ Storage Link →(本 action)→ Hauler → Storage。
 * 无人排空 storage link 则链堵死：storage link 满后 planLinkTransfers 的 storageFree=0，
 * source link 无法再传，整条链路背压瘫痪。
 *
 * link-system (P1 系统) 先于 creep (P1 角色) 执行，已先将 storage link → controller link
 * 传输（controller 缺能时）。hauler 排空的是 link-system 传输后的剩余能量，不会抢走
 * controller link 的供能。旧守卫（controller link < target 时阻止 hauler 排空）基于
 * 两个错误假设已移除：(1) hauler 会抢能量 — 但 link-system 先执行已路由完毕；
 * (2) distributor 会向 storage link 灌能 — 但 distributor 只灌 spawn/extension/tower/container。
 * 守卫导致 storage link 始终在 799/800（free=1-3），source→storage 传输量 1-3，
 * 经 3% 损耗后到账 0-2 → 近零有效 → 整条链路背压瘫痪。
 *
 * 限量取能：取 min(可用, 空闲)，避免 ERR_NOT_ENOUGH_RESOURCES。
 */
export function withdrawStorageLink(): ActionCandidate<StructureLink> {
  return {
    name: "withdraw:storage-link",
    resolve: ac => {
      // controller 真缺能时保留 storage link 给 link-system Step2（storage→controller），
      // 不让 hauler 把最后这管油抽走 —— 否则 storage 90 万库存也补不到 controller。
      //
      // Phase C 修正：旧实现只看「controller link 有空位」就抑制，导致 RCL8 满级
      // （controller 目标水位 = 0，Step2 永不执行）时 storage link 永远无人排空 —
      // W8N3 实测 storage link 800/800 → source link 全满 → 采集端堵死、storage 卡在 51K。
      // 现在以「Step2 真的会抽能」为前提：目标水位 > 0 才保留。
      const ctrlLink = ac.snapshot.links.find(
        l =>
          ac.snapshot.controller !== undefined && l.pos.getRangeTo(ac.snapshot.controller.pos) <= 2,
      );
      if (ctrlLink && ac.snapshot.controller) {
        const target = computeControllerLinkTarget(
          ac.snapshot.rcl,
          ac.snapshot.controller,
          ac.snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
          ctrlLink.store.getCapacity(RESOURCE_ENERGY),
          resolveControllerDowngradeRisk(
            Memory.rooms?.[ac.snapshot.roomName]?.controllerDowngradeRisk,
            ac.snapshot.controller,
          ),
        );
        if (
          target > 0 &&
          ctrlLink.store.getFreeCapacity(RESOURCE_ENERGY) >=
            CONFIG.economy.link.controllerFeedSuppressFree
        ) {
          return undefined;
        }
      }
      // 与布局分类同源（storageAnchorRange=3）：旧实现写死 range<=2，
      // W8N3 的 storage link (22,18) 距 storage 3 格 ⇒ 永远找不到 ⇒ 常年 799 无人排空。
      const storageLink = findStorageLink(ac.snapshot);
      if (!storageLink || storageLink.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) {
        return undefined;
      }
      return storageLink;
    },
    execute: (ac, link) => {
      const available = link.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      runAction(
        ac.creep,
        link,
        ACTION_RANGE_NEAR,
        () => ac.creep.withdraw(link, RESOURCE_ENERGY, amount),
        {
          [ERR_NOT_ENOUGH_RESOURCES]: () => {
            ac.creep.memory.mode = "idle";
          },
        },
      );
    },
  };
}

/** withdrawStorageCapped 的 resolve 返回类型。 */
interface StorageCappedTarget {
  storage: StructureStorage;
  limit: number;
}

/**
 * 从 storage 限量取能（upgrader 专用）— 防止一次取走大量能量致 storage 突降、
 * 触发 economyPressure 连锁降级。单次取 min(可用, 空闲, limit)。
 * P1-1: limit 可为固定值或动态函数 — 允许按 storage 水位缩放取能上限。
 */
export function withdrawStorageCapped(
  limit: number | ((ac: ActionContext) => number),
): ActionCandidate<StorageCappedTarget> {
  return {
    name: "withdraw:storage-capped",
    resolve: ac => {
      const st = ac.snapshot.storage;
      if (!st || st.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      const effectiveLimit = typeof limit === "function" ? limit(ac) : limit;
      // U-1/B-1（floor 下沉，D-0 同手法）：限额 ≤0 表示水位表拒绝本次取能 —
      // resolve 返回 undefined 放行后续候选（container/harvest），而非 execute 里 withdraw(0) 空转占链。
      if (effectiveLimit <= 0) return undefined;
      return { storage: st, limit: effectiveLimit };
    },
    execute: (ac, target) => {
      const { storage, limit: effectiveLimit } = target;
      const available = storage.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree, effectiveLimit);
      runAction(
        ac.creep,
        storage,
        ACTION_RANGE_NEAR,
        () => ac.creep.withdraw(storage, RESOURCE_ENERGY, amount),
        {
          [ERR_NOT_ENOUGH_RESOURCES]: () => {
            ac.creep.memory.mode = "idle";
          },
        },
      );
    },
  };
}

/** 限量 withdraw（hauler 专用，避免 ERR_NOT_ENOUGH_RESOURCES）。 */
export function withdrawCapped(
  target: (ac: ActionContext) => StructureContainer | StructureStorage | undefined,
): ActionCandidate<StructureContainer | StructureStorage> {
  return {
    name: "withdraw:capped",
    resolve: ac => {
      const t = target(ac);
      if (!t || t.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return t;
    },
    execute: (ac, t) => {
      const available = t.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      runAction(
        ac.creep,
        t,
        ACTION_RANGE_NEAR,
        () => ac.creep.withdraw(t, RESOURCE_ENERGY, amount),
        {
          [ERR_NOT_ENOUGH_RESOURCES]: () => {
            ac.creep.memory.mode = "idle";
          },
        },
      );
    },
  };
}
