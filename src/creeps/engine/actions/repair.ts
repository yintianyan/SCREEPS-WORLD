/**
 * Repair actions — 维修结构。
 *
 * 四层优先级：
 *   1. repairCritical — 血量 < 50% 的关键结构（spawn/tower）
 *   2. repairContainerDecay — container 血量 < 80%（物流链保护）
 *   3. repairNearbyContainer — 身边 container（站桩矿工自维护）
 *   4. repairRoads — 道路血量 < 40%（交通效率保护）
 *   5. repairFortifications — wall/rampart 到 RCL 分级目标血量（rampart 优先于 wall）
 *
 * 目标持久化：repairContainerDecay / repairRoads / repairFortifications 复用 creep.memory.repairTargetId。
 * 共享缓存安全：每个 action 验证缓存目标的 structureType，防止跨类型缓存泄漏。
 */
import { CONFIG, getWallTargetHits } from "../../../config";
import type { RoomSnapshot } from "../../../kernel/contracts";
import type { ActionCandidate } from "../action-types";
import { runAction } from "./helpers";
import { findCriticalRepair } from "../../support/targeting";
import { getObjectById } from "../../support/obj-cache";
import { buildFortificationContext, classifyFortification } from "../../../domain/defense/fortification";

/** 道路维修阈值 — 血量低于此比例才修（与 builder 维修需求信号共用 CONFIG 口径）。 */
const ROAD_REPAIR_THRESHOLD: number = CONFIG.construction.roadRepairThreshold;

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
      // 优先复用持久化目标 — 验证类型 + 仍需修复。
      // P1 修复：原先不检查 structureType，当 repairRoads/repairFortifications 设置的
      // repairTargetId 指向 road/wall 时，getObjectById 返回非 container 对象，
      // 但 hits < hitsMax*0.8 的比例检查仍可能命中（道路 hitsMax 5000，80% = 4000），
      // 导致道路被当作 container 修复，真正衰减的 container 被饿死。
      if (ac.creep.memory.repairTargetId) {
        const cached = getObjectById(ac.creep.memory.repairTargetId as Id<StructureContainer>);
        if (cached && cached.structureType === STRUCTURE_CONTAINER && cached.hits < cached.hitsMax * 0.8) {
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
 * 修复 wall/rampart 到分层目标血量（B3：维修权从塔移交给 creep）。
 *
 * 老玩家认知：塔修墙是能量黑洞（10 能量/次 + 距离衰减 + 与开火争弹药），
 * creep 维修是 1 energy/100 hits/WORK —— 日常工事维护必须由 builder 承担。
 *
 * 分层目标（消除统一目标的维护经济黑洞）：
 *   perimeter（min-cut 割集 / wall / 扇区封锁）→ RCL 全额；
 *   core（结构叠盾）→ 全额 × coreRampartFactor；
 *   utility（container 叠盾）→ 仅新生急救地板。
 *
 * 门禁（全部满足才启用，resolve 内判断）：
 *   - tier 非 recovery/conserve（低 CPU 不修墙）；
 *   - 无威胁 creep（入侵期间修墙是白送能量，优先开火/保命）；
 *   - 盈余门槛按姿态分档：和平期需 storage ≥ sprintStorage（50k）— 墙是死资本，
 *     RCL 是复利，储备不足时能量优先灌 controller（10k-50k 区间由
 *     repairFreshRampart 维持地板）；受袭姿态放宽到 sustainedStorage（10k）—
 *     有真实威胁时墙体优先级高于发展。
 *   - 无 storage（RCL3-4）时放宽门禁 — 靠 work chain 优先级保证不抢生存行为。
 */
export function repairFortifications(): ActionCandidate<Fortification> {
  return {
    name: "repair:fortifications",
    resolve: (ac) => {
      if (ac.budget.tier === "recovery" || ac.budget.tier === "conserve") return undefined;
      if (ac.snapshot.threatCreeps.length > 0) return undefined;

      // 受袭姿态：近期有敌对活动 → 墙体目标升档 + 盈余门槛放宽。
      const roomMemory = Memory.rooms[ac.snapshot.roomName];
      const lastHostileAt = roomMemory?.lastHostileAt;
      const underSiege = lastHostileAt !== undefined &&
        Game.time - lastHostileAt < CONFIG.defense.siegeMemoryTicks;

      const storage = ac.snapshot.storage;
      if (storage) {
        // 和平期全额灌墙要求真盈余（sprintStorage）；受袭期放宽（sustainedStorage）。
        const surplusGate = underSiege
          ? CONFIG.economy.upgrade.sustainedStorage
          : CONFIG.economy.upgrade.sprintStorage;
        if (storage.store.getUsedCapacity(RESOURCE_ENERGY) < surplusGate) {
          return undefined;
        }
      }
      // 无 storage（RCL1-4）— 放宽门禁，靠 work chain 优先级保证不抢生存行为。

      // 分层分类上下文：min-cut 割集来自 Memory 持久化数据。
      const fortCtx = buildFortificationContext(
        ac.snapshot,
        roomMemory?.minCut?.positions,
      );
      const targetOf = (f: Fortification): number =>
        getWallTargetHits(
          ac.snapshot.rcl,
          underSiege,
          classifyFortification(f.pos.x, f.pos.y, f.structureType === STRUCTURE_WALL, fortCtx),
        );

      // 优先复用持久化目标 — 验证它仍是墙/城防且仍低于自身档位目标。
      if (ac.creep.memory.repairTargetId) {
        const cached = getObjectById(ac.creep.memory.repairTargetId as Id<Fortification>);
        if (cached) {
          if (
            (cached.structureType === STRUCTURE_WALL || cached.structureType === STRUCTURE_RAMPART)
            && cached.hits < targetOf(cached)
          ) {
            return cached;
          }
        }
      }

      // 无有效缓存目标 — 重新扫描最低血量的墙/城防。
      const target = findFortificationTarget(ac.snapshot, targetOf);
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

/**
 * 查找血量最低且低于自身档位目标血量的 wall/rampart。
 *
 * P2 修复：rampart 优先于 wall — rampart 被摧毁会暴露同格所有结构（spawn/tower/extension），
 * wall 被摧毁只产生缺口。先扫 rampart，只有当所有 rampart 都达标时才修 wall。
 */
function findFortificationTarget(
  snapshot: RoomSnapshot,
  targetOf: (f: Fortification) => number,
): Fortification | undefined {
  // 先扫 rampart — 被摧毁后果更严重（同格结构全裸）。
  let best: Fortification | undefined;
  let bestHits = Infinity;
  for (const rampart of snapshot.ramparts) {
    if (rampart.hits < targetOf(rampart) && rampart.hits < bestHits) {
      bestHits = rampart.hits;
      best = rampart;
    }
  }
  // 所有 rampart 都达标后才扫 wall。
  if (!best) {
    for (const wall of snapshot.walls) {
      if (wall.hits < targetOf(wall) && wall.hits < bestHits) {
        bestHits = wall.hits;
        best = wall;
      }
    }
  }
  return best;
}

/**
 * 新生 rampart 急救 — 血量低于 rampartBootstrapHits 的 rampart 无条件优先灌血。
 *
 * rampart 建成时仅 1 hit，每 100 tick 衰减 300 hits [事实：官方常量
 * RAMPART_DECAY_AMOUNT/RAMPART_DECAY_TIME]，不灌血必死于首个衰减周期。
 * 塌毁 → 规划器重新入队 site → builder 重建 → 又 1 hit，
 * builder 被永久锁死在「建了就塌、塌了再建」循环，防线永远立不起来。
 *
 * 与 repairFortifications 的区别：
 *   - 无盈余/tier/威胁门禁 — 急救的是刚投入建造的资产，属止损而非发展性投资；
 *     威胁期间尤其要灌（rampart 正是防御工事，塌了同格结构全裸）。
 *   - 必须排在 build 动作之前 — 灌 10k 血只需十几 tick，建一个 site 要上百 tick，
 *     顺序反了新 rampart 必死在建造队列后面。
 *   - 目标持久化独立于 repairTargetId 链（避免与 fortifications 的缓存互踩），
 *     每 tick 直接扫 snapshot.ramparts — 数组已在快照预建，低于急救线的通常 0-2 个。
 */
export function repairFreshRampart(): ActionCandidate<StructureRampart> {
  return {
    name: "repair:fresh-rampart",
    resolve: (ac) => {
      const threshold = CONFIG.defense.rampartBootstrapHits;
      let worst: StructureRampart | undefined;
      let worstHits: number = threshold;
      for (const rampart of ac.snapshot.ramparts) {
        if (rampart.hits < worstHits) {
          worstHits = rampart.hits;
          worst = rampart;
        }
      }
      return worst;
    },
    execute: (ac, t) => {
      runAction(ac.creep, t, () => ac.creep.repair(t));
    },
  };
}

/**
 * 修复衰减中的道路（血量 < 40%）。
 *
 * 道路衰减率（按地形，[Facts] docs.screeps.com/api/StructureRoad.html）：
 *   - plain:  100 hits / 1000 ticks（hitsMax 5,000）
 *   - swamp:  500 hits / 1000 ticks（hitsMax 25,000）
 *   - wall:  15,000 hits / 1000 ticks（hitsMax 750,000）
 * 每个 creep 踩一步，衰减计时器额外减少 1 tick × body part 数量 —
 * 高流量道路衰减远快于低流量道路。
 *
 * 阈值 40% 在任何地形下给约 20,000 tick 的修复窗口，足够 builder 响应。
 * 道路塌毁不致命，但需在塌毁前修复以保持物流效率（swamp 无路 = 5x 移动成本）。
 *
 * 门禁：与 repairFortifications 一致 — recovery/conserve tier + 威胁期间不修路。
 * recovery 时升级控制器保级比修路重要；入侵期间修路是白送能量。
 *
 * 目标持久化：复用 creep.memory.repairTargetId（与 fortifications 共享）。
 */
export function repairRoads(): ActionCandidate<StructureRoad> {
  return {
    name: "repair:roads",
    resolve: (ac) => {
      // P2 修复：加 tier/threat 门禁，与 repairFortifications 对齐。
      if (ac.budget.tier === "recovery" || ac.budget.tier === "conserve") return undefined;
      if (ac.snapshot.threatCreeps.length > 0) return undefined;

      // 优先复用持久化目标 — 验证它仍是道路且仍需修复。
      if (ac.creep.memory.repairTargetId) {
        const cached = getObjectById(ac.creep.memory.repairTargetId as Id<StructureRoad>);
        if (cached && cached.structureType === STRUCTURE_ROAD) {
          if (cached.hits < cached.hitsMax * ROAD_REPAIR_THRESHOLD) {
            return cached;
          }
        }
      }
      // 无有效缓存目标 — 修血量最低的道路。
      let worst: StructureRoad | undefined;
      let worstRatio = ROAD_REPAIR_THRESHOLD;
      for (const r of ac.snapshot.roads) {
        const ratio = r.hits / r.hitsMax;
        if (ratio < worstRatio) {
          worstRatio = ratio;
          worst = r;
        }
      }
      if (worst) {
        ac.creep.memory.repairTargetId = worst.id as Id<StructureRoad>;
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
