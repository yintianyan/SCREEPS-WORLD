/**
 * Builder — P2 建造角色。
 *
 * 策略声明：
 *   gate:    recovery tier → 释放 assignment（不建造）
 *   acquire: 最近有能量 container > harvest
 *   work:    assignment site（tier 门禁）> 最近 site（tier 门禁）> fill > critical repair > 升级（gated）
 *
 * CPU 门禁通过候选 predicate 内的 tier 判断实现，不再内嵌 if-else。
 */
import type { Priority } from "../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "./action-types";
import {
  fillTarget,
  harvestSource,
  pickupDroppedEnergy,
  repairContainerDecay,
  repairCritical,
  upgradeControllerGated,
  withdrawClosestContainer,
} from "./actions";
import { releaseAssignment } from "./assignment-adapter";
import { moveToTarget } from "./movement";
import { defineRole } from "./role-runner";

/** recovery/conserve tier 门禁：释放不可用的 assignment。 */
function builderGate(ac: ActionContext): boolean {
  if (ac.budget.tier === "recovery") {
    releaseAssignment(ac.creep);
    return true;
  }
  // conserve: assignment 指向非 critical site 时释放（让 fallback 接管）。
  if (ac.budget.tier === "conserve" && ac.assignment?.targetId) {
    const site = Game.getObjectById(ac.assignment.targetId as Id<ConstructionSite>);
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
      const site = Game.getObjectById(ac.assignment.targetId as Id<ConstructionSite>);
      if (!site) return false;
      if (ac.budget.tier === "conserve") {
        return site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER;
      }
      return true;
    },
    execute: (ac) => {
      const site = Game.getObjectById(ac.assignment!.targetId as Id<ConstructionSite>)!;
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

/** 建造最近 site（带 tier 门禁：conserve 只建 critical）。 */
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
      const site = ac.creep.pos.findClosestByRange(sites as ConstructionSite[]);
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

const policy: RolePolicy = {
  gate: builderGate,

  acquire: [
    // 优先取最近有能量的 container（含 source container — 主能量池）。
    withdrawClosestContainer(),
    // 拾取地上掉落能量（衰减资源，优先于采集）。
    pickupDroppedEnergy(),
    // 兜底：所有 container 无能量时直接采集。
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
    // fallback: 升级控制器（带能量门禁）。
    upgradeControllerGated(),
  ],
};

export const builderRole = defineRole("builder", 2 as Priority, policy);
