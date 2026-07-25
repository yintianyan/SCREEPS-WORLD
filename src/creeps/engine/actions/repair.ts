/**
 * Repair actions — 维修结构。
 *
 * 三层优先级：
 *   1. repairCritical — 血量 < 50% 的关键结构（spawn/tower）
 *   2. repairContainerDecay — container 血量 < 80%（物流链保护）
 *   3. repairNearbyContainer — 身边 container（站桩矿工自维护）
 *   4. repairFortifications — wall/rampart 到 RCL 分级目标血量
 *
 * 目标持久化：repairContainerDecay / repairFortifications 复用 creep.memory.repairTargetId。
 */
import { CONFIG, getWallTargetHits } from "../../../config";
import type { RoomSnapshot } from "../../../kernel/contracts";
import type { ActionCandidate } from "../action-types";
import { runAction } from "./helpers";
import { findCriticalRepair } from "../../support/targeting";
import { getObjectById } from "../../support/obj-cache";

type Fortification = StructureWall | StructureRampart;

/** 修复 critical 结构（血量 < 50%）。findCriticalRepair 优先使用快照预计算值。 */
export function repairCritical(): ActionCandidate<AnyStructure> {
  return {
    name: "repair:critical",
    resolve: (ac) => findCriticalRepair(ac.snapshot),
    execute: (ac, t) => {
      runAction(ac.creep, t, () => ac.creep.repair(t));
    },
  };
}

/**
 * 修复衰减中的 container（血量 < 80%）。
 * Container 每 tick 衰减 ~5000 hits，不修就会在 ~50 tick 内从 80% 降到 0 被摧毁。
 * 失去 source container = 物流链断裂 = 经济崩溃，因此阈值设得比 repairCritical (50%) 更激进。
 *
 * 目标持久化：优先复用上一 tick 选定的 container（creep.memory.repairTargetId），
 * 仅在目标修好/消失时重新选择。消除多个衰减 container 间的摇摆。
 */
export function repairContainerDecay(): ActionCandidate<StructureContainer> {
  return {
    name: "repair:container-decay",
    resolve: (ac) => {
      // 优先复用持久化目标 — 验证它仍需修复。
      if (ac.creep.memory.repairTargetId) {
        const cached = getObjectById(ac.creep.memory.repairTargetId as Id<StructureContainer>);
        if (cached && cached.hits < cached.hitsMax * 0.8) {
          return cached;
        }
      }
      // 无有效缓存目标 — 修血量最低的 container。
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
        ac.creep.memory.repairTargetId = worst.id as Id<StructureContainer>;
      }
      return worst;
    },
    execute: (ac, worst) => {
      runAction(ac.creep, worst, () => ac.creep.repair(worst), {
        [ERR_INVALID_TARGET]: () => { ac.creep.memory.repairTargetId = undefined; },
      });
    },
  };
}

/**
 * 修复身边的 container（range <= 2，血量 < 80%）。
 * Harvester 站桩专用：你正站在 container 旁边，它快塌了，先修再倒。
 * 比 repairContainerDecay 更紧急 — 只修身边的，不需要跑远路。
 */
export function repairNearbyContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "repair:nearby-container",
    resolve: (ac) => {
      const candidates = ac.snapshot.containers.filter(
        c => ac.creep.pos.getRangeTo(c) <= 2 && c.hits < c.hitsMax * 0.8,
      );
      if (candidates.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(candidates as StructureContainer[]) ?? undefined;
    },
    execute: (ac, nearby) => {
      runAction(ac.creep, nearby, () => ac.creep.repair(nearby));
    },
  };
}

/**
 * 修复 wall/rampart 到 RCL 分级目标血量（B3：维修权从塔移交给 creep）。
 *
 * 老玩家认知：塔修墙是能量黑洞（10 能量/次 + 距离衰减 + 与开火争弹药），
 * creep 维修是 1 energy/100 hits/WORK —— 日常工事维护必须由 builder 承担。
 *
 * 门禁（全部满足才启用，resolve 内判断）：
 *   - tier 非 recovery/conserve（低 CPU 不修墙）；
 *   - 无威胁 creep（入侵期间修墙是白送能量，优先开火/保命）；
 *   - 有 storage 且能量 ≥ sustainedStorage（真盈余才修，早期不堆 rampart）。
 */
export function repairFortifications(): ActionCandidate<Fortification> {
  return {
    name: "repair:fortifications",
    resolve: (ac) => {
      if (ac.budget.tier === "recovery" || ac.budget.tier === "conserve") return undefined;
      if (ac.snapshot.threatCreeps.length > 0) return undefined;
      const storage = ac.snapshot.storage;
      if (!storage) return undefined;
      if (storage.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.economy.upgrade.sustainedStorage) {
        return undefined;
      }

      const targetHits = getWallTargetHits(ac.snapshot.rcl);

      // 优先复用持久化目标 — 验证它仍是墙/城防且仍需修复。
      if (ac.creep.memory.repairTargetId) {
        const cached = getObjectById(ac.creep.memory.repairTargetId as Id<Fortification>);
        if (cached) {
          if (
            (cached.structureType === STRUCTURE_WALL || cached.structureType === STRUCTURE_RAMPART)
            && cached.hits < targetHits
          ) {
            return cached;
          }
        }
      }

      // 无有效缓存目标 — 重新扫描最低血量的墙/城防。
      const target = findFortificationTarget(ac.snapshot, targetHits);
      if (target) {
        ac.creep.memory.repairTargetId = target.id as Id<Fortification>;
      }
      return target;
    },
    execute: (ac, t) => {
      runAction(ac.creep, t, () => ac.creep.repair(t), {
        [ERR_INVALID_TARGET]: () => { ac.creep.memory.repairTargetId = undefined; },
      });
    },
  };
}

/** 查找血量最低且低于 RCL 分级目标血量的 wall/rampart。 */
function findFortificationTarget(
  snapshot: RoomSnapshot,
  targetHits: number,
): Fortification | undefined {
  let best: Fortification | undefined;
  let bestHits = Infinity;
  for (const wall of snapshot.walls) {
    if (wall.hits < targetHits && wall.hits < bestHits) {
      bestHits = wall.hits;
      best = wall;
    }
  }
  for (const rampart of snapshot.ramparts) {
    if (rampart.hits < targetHits && rampart.hits < bestHits) {
      bestHits = rampart.hits;
      best = rampart;
    }
  }
  return best;
}
