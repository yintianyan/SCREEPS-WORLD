/**
 * Build actions — 建造 construction site。
 *
 * 目标持久化：复用 creep.memory.targetId 缓存的 site，
 * 仅在目标消失或不再满足 criticalOnly 过滤时重新选择。
 */
import type { ActionCandidate } from "../action-types";
import { actOrMove } from "./helpers";
import { getObjectById } from "../../support/obj-cache";

/** 建造 assignment 指定的 site。 */
export function buildAssignmentSite(): ActionCandidate {
  return {
    name: "build:assignment-site",
    resolve: (ac) => {
      if (!ac.assignment?.targetId) return undefined;
      const site = getObjectById(ac.assignment.targetId as Id<ConstructionSite>);
      return site ?? undefined;
    },
    execute: (ac, target) => {
      const site = target as ConstructionSite;
      const result = actOrMove(ac.creep, site, () => ac.creep.build(site));
      if (result === ERR_INVALID_TARGET) {
        ac.creep.memory.assignment = undefined;
      }
    },
  };
}

/** 建造最近 site（可选 critical-only 过滤）。
 *
 * 目标持久化：复用 creep.memory.targetId 缓存的 site，
 * 仅在目标消失或不再满足 criticalOnly 过滤时重新选择。
 */
export function buildNearestSite(criticalOnly = false): ActionCandidate {
  return {
    name: criticalOnly ? "build:nearest-critical-site" : "build:nearest-site",
    resolve: (ac) => {
      const sites = criticalOnly
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
    execute: (ac, target) => {
      const site = target as ConstructionSite;
      const result = actOrMove(ac.creep, site, () => ac.creep.build(site));
      if (result === ERR_INVALID_TARGET) {
        ac.creep.memory.targetId = undefined;
      }
    },
  };
}

function isCriticalSite(site: ConstructionSite): boolean {
  return site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER;
}
