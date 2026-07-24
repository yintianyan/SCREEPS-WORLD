/**
 * Builder — P2 建造角色。
 *
 * 策略声明：
 *   gate:    recovery tier → 释放 assignment（不建造）
 *   acquire: 拾取掉落能量 > storage（RCL4+ 主力源）> 最近非物流 container > harvest
 *   work:    assignment site（tier 门禁）> 最近 site（tier 门禁）> fill > critical repair > 升级（gated）
 *
 * CPU 门禁通过候选 predicate 内的 tier 判断实现，不再内嵌 if-else。
 *
 * RCL4+ 取能策略：storage 建成后成为 builder 的主力能量源。
 *   - storage 由 hauler 持续填充，是最可靠的中央能量库；
 *   - builder body [8W,4C,6M] 满载 200 能量 / 8 WORK = 25 tick 建造，往返一趟效率高；
 *   - storage 水位低于 10% 时收紧取能上限，让 hauler 优先补给 spawn/extension。
 *   - 无 storage（RCL1-3）时自动跳过，回退到 container / harvest。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import {
  fillTarget,
  harvestSource,
  pickupDroppedEnergy,
  repairContainerDecay,
  repairCritical,
  repairFortifications,
  upgradeControllerGated,
  withdrawClosestNonSourceContainer,
  withdrawStorageCapped,
} from "../engine/actions";
import { releaseAssignment } from "../support/assignment-adapter";
import { moveToTarget } from "../movement";
import { getObjectById } from "../support/obj-cache";
import { defineRole } from "../engine/role-runner";

/** recovery/conserve tier 门禁：释放不可用的 assignment。 */
function builderGate(ac: ActionContext): boolean {
  if (ac.budget.tier === "recovery") {
    releaseAssignment(ac.creep);
    return true;
  }
  // conserve: assignment 指向非 critical site 时释放（让 fallback 接管）。
  if (ac.budget.tier === "conserve" && ac.assignment?.targetId) {
    const site = getObjectById(ac.assignment.targetId as Id<ConstructionSite>);
    if (site && site.structureType !== STRUCTURE_SPAWN && site.structureType !== STRUCTURE_TOWER) {
      releaseAssignment(ac.creep);
      ac.creep.memory.assignment = undefined;
    }
  }
  return true;
}

/** 建造 assignment 指定的 site（带 conserve 门禁）。 */
function buildAssignmentByTier(): ActionCandidate {
  return {
    name: "build:assignment-by-tier",
    predicate: (ac) => {
      if (ac.budget.tier === "recovery") return false;
      if (!ac.assignment?.targetId) return false;
      const site = getObjectById(ac.assignment.targetId as Id<ConstructionSite>);
      if (!site) return false;
      if (ac.budget.tier === "conserve") {
        return site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER;
      }
      return true;
    },
    execute: (ac) => {
      const site = getObjectById(ac.assignment!.targetId as Id<ConstructionSite>)!;
      const result = ac.creep.build(site);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, site);
      } else if (result === ERR_INVALID_TARGET) {
        releaseAssignment(ac.creep);
        ac.creep.memory.assignment = undefined;
      }
    },
  };
}

/** 建造最近 site（带 tier 门禁：conserve 只建 critical）。
 *
 * 目标持久化：优先复用上一 tick 选定的 site（creep.memory.targetId），
 * 仅在目标消失或不满足 tier 门禁时重新选择。
 * 这消除了 builder 在两个等距工地间每 tick 切换的"摇摆"行为。
 */
function buildSiteByTier(): ActionCandidate {
  return {
    name: "build:site-by-tier",
    predicate: (ac) => {
      if (ac.budget.tier === "recovery") return false;
      if (ac.budget.tier === "conserve") {
        return ac.snapshot.myConstructionSites.some(
          s => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_TOWER,
        );
      }
      return ac.snapshot.myConstructionSites.length > 0;
    },
    execute: (ac) => {
      const sites = ac.budget.tier === "conserve"
        ? ac.snapshot.myConstructionSites.filter(
            s => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_TOWER,
          )
        : ac.snapshot.myConstructionSites;

      // 优先复用持久化目标 — 验证它仍在当前候选列表中。
      let site: ConstructionSite | null = null;
      if (ac.creep.memory.targetId) {
        const cached = getObjectById(ac.creep.memory.targetId as Id<ConstructionSite>);
        if (cached && sites.some(s => s.id === cached.id)) {
          site = cached;
        }
      }

      // 无有效缓存目标 — 重新选择最近的。
      if (!site) {
        site = ac.creep.pos.findClosestByRange(sites as ConstructionSite[]);
        if (site) {
          ac.creep.memory.targetId = site.id as Id<ConstructionSite>;
        }
      }

      if (site) {
        const result = ac.creep.build(site);
        if (result === ERR_NOT_IN_RANGE) {
          moveToTarget(ac.creep, site);
        } else if (result === ERR_INVALID_TARGET) {
          ac.creep.memory.targetId = undefined;
        }
      }
    },
  };
}

/**
 * P1-1: 动态计算 builder 从 storage 取能上限 — 按 storage 水位缩放。
 *
 * - 高水位 (>10%)：放开到 carry 满载（库存充足，builder 全速建造）
 * - 低水位 (<=10%)：收紧到 100（保护 storage，让 hauler 优先补给 spawn/extension）
 *
 * 比 upgrader 的阈值更宽松：builder 是 P2，只在有工地时运行，
 * storage 水位低时 tier 系统会门禁建造（recovery 跳过，conserve 只建 critical）。
 */
function builderStorageLimit(ac: ActionContext): number {
  const st = ac.snapshot.storage;
  if (!st) return 0;
  const energy = st.store.getUsedCapacity(RESOURCE_ENERGY);
  const capacity = st.store.getCapacity(RESOURCE_ENERGY);
  if (capacity === 0) return 0;
  const ratio = energy / capacity;
  if (ratio > 0.1) return ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
  return 100;
}

const policy: RolePolicy = {
  park: true,
  gate: builderGate,

  acquire: [
    // 0. 拾取地上掉落能量（衰减资源，最优先回收）。
    pickupDroppedEnergy(),
    // 1. 从 storage 取能（RCL4+ 主力源 — hauler 持续填充，最可靠）。
    //    无 storage 时 predicate=false，自动跳过。
    withdrawStorageCapped(builderStorageLimit),
    // 2. 取最近非物流 container 的能量（不抢 hauler/upgrader 的物流源）。
    withdrawClosestNonSourceContainer(),
    // 3. 兜底：所有 container 无能量时直接采集。
    harvestSource(),
  ],

  work: [
    // 建造 assignment 指定的 site（带 tier 门禁）。
    buildAssignmentByTier(),
    // 建造最近 site（带 tier 门禁）。
    buildSiteByTier(),
    // 紧急：修复衰减中的 container（< 80% 血量）。
    // 优先级高于 fill — 失去 container = 物流链断裂 = 经济崩溃。
    repairContainerDecay(),
    // fallback: 填充 spawn/extension。
    fillTarget(),
    // fallback: 关键修复（< 50% 血量）。
    repairCritical(),
    // fallback: 防御工事维修（B3：盈余门禁 + 无威胁时，修 wall/rampart 至分级血量）。
    // 维修权从塔移交 creep —— 塔修墙是能量黑洞，creep 修是 1 energy/100 hits/WORK。
    repairFortifications(),
    // fallback: 升级控制器（带能量门禁）。
    upgradeControllerGated(),
  ],
};

export const builderRole = defineRole("builder", 2 as Priority, policy);
