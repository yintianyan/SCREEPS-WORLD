/** Build actions — 建造 construction site。 */
import type { ActionContext, ActionCandidate } from "../action-types";
import { runAction } from "./helpers";
import { getObjectById } from "../../support/obj-cache";
import { releaseAssignment } from "../../support/assignment-adapter";

/** buildAssignmentSite 的可选配置。 */
export interface BuildAssignmentOptions {
  /** recovery tier 时跳过此候选。 */
  readonly recoverySkip?: boolean;
  /** conserve tier 时仅建 critical site（spawn/tower/storage）。 */
  readonly conserveCriticalOnly?: boolean;
}

/** 建造 assignment 指定的 site（可选 tier 门禁）。 */
export function buildAssignmentSite(
  options?: BuildAssignmentOptions,
): ActionCandidate<ConstructionSite> {
  return {
    name: "build:assignment-site",
    resolve: (ac) => {
      if (options?.recoverySkip && ac.budget.tier === "recovery") return undefined;
      if (!ac.assignment?.targetId) return undefined;
      const site = getObjectById(ac.assignment.targetId as Id<ConstructionSite>);
      if (!site) return undefined;
      if (options?.conserveCriticalOnly && ac.budget.tier === "conserve") {
        if (site.structureType !== STRUCTURE_SPAWN
          && site.structureType !== STRUCTURE_TOWER
          && site.structureType !== STRUCTURE_STORAGE) return undefined;
      }
      return site;
    },
    execute: (ac, site) => {
      // 建造计量归 economy 的房间级差分采样（site.progress 跨 tick 实测）。
      runAction(ac.creep, site, () => ac.creep.build(site), {
        [ERR_INVALID_TARGET]: () => releaseAssignment(ac.creep),
      });
    },
  };
}

/**
 * 建造最近 site（可选 critical-only 过滤 + tier 门禁）。
 * 目标持久化消除 builder 在两个等距工地间每 tick 切换的"摇摆"行为。
 * criticalOnly 可为 boolean 或函数 — 函数允许按 tier 动态切换过滤策略。
 */
export function buildNearestSite(
  criticalOnly: boolean | ((ac: ActionContext) => boolean) = false,
  options?: { recoverySkip?: boolean },
): ActionCandidate<ConstructionSite> {
  return {
    name: "build:nearest-site",
    resolve: (ac) => {
      if (options?.recoverySkip && ac.budget.tier === "recovery") return undefined;
      const isCriticalOnly = typeof criticalOnly === "function" ? criticalOnly(ac) : criticalOnly;
      const sites = isCriticalOnly
        ? ac.snapshot.myConstructionSites.filter(isCriticalSite)
        : ac.snapshot.myConstructionSites;
      if (sites.length === 0) return undefined;

      // 优先复用持久化目标 — 验证它仍在当前候选列表中。
      if (ac.creep.memory.targetId) {
        const cached = getObjectById(ac.creep.memory.targetId as Id<ConstructionSite>);
        if (cached && sites.some(s => s.id === cached.id)) {
          return cached;
        }
      }

      // 无有效缓存目标 — 重新选择最近的。
      const site = ac.creep.pos.findClosestByRange(sites as ConstructionSite[]);
      if (site) {
        ac.creep.memory.targetId = site.id as Id<ConstructionSite>;
        return site;
      }
      return undefined;
    },
    execute: (ac, site) => {
      runAction(ac.creep, site, () => ac.creep.build(site), {
        [ERR_INVALID_TARGET]: () => { ac.creep.memory.targetId = undefined; },
      });
    },
  };
}

function isCriticalSite(site: ConstructionSite): boolean {
  return site.structureType === STRUCTURE_SPAWN
    || site.structureType === STRUCTURE_TOWER
    || site.structureType === STRUCTURE_STORAGE;
}
