/** Worker */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import {
  buildNearestSite,
  fillTarget,
  harvestSource,
  pickupDroppedEnergy,
  repairCritical,
  upgradeController,
} from "../engine/actions";
import { countedIntent } from "../engine/actions/helpers";
import { moveToTarget } from "../movement";
import { getObjectById } from "../support/obj-cache";
import { releaseAssignment } from "../support";
import { claimedRepair } from "../support/repair-reservations";
import { defineRole } from "../engine/role-runner";
import { scored } from "../engine/arbiter";

/** 血量缺口（0=满血，1=归零）。 */
function hpDeficit(s: { hits: number; hitsMax: number }): number {
  // R684：效用评分在 resolve 之后才发现目标已消失时，对象 getter 会抛
  // "Could not find an object with ID" 并中断整只 creep（R676 只护了 execute 侧）。
  // 返回 0 让该候选失去效用，由其它候选继续。
  try {
    if (!(s.hitsMax > 0)) return 0;
    return Math.max(0, 1 - s.hits / s.hitsMax);
  } catch {
    return 0;
  }
}

/** 填充类加成：spawn/extension 断能即停产，tower 弹药次之，container 兜底。
 * 越空越紧迫（freeRatio 0→1），让「空 spawn」在效用上压过建造。 */
function fillBonus(t: AnyOwnedStructure): number {
  const store = (t as { store?: Store<ResourceConstant, false> }).store;
  const cap = store?.getCapacity?.(RESOURCE_ENERGY) ?? 0;
  const free = store?.getFreeCapacity?.(RESOURCE_ENERGY) ?? 0;
  const ratio = cap > 0 ? free / cap : 0;
  if (t.structureType === STRUCTURE_SPAWN || t.structureType === STRUCTURE_EXTENSION) {
    return 20 + 30 * ratio;
  }
  if (t.structureType === STRUCTURE_TOWER) return 10 + 15 * ratio;
  return 0;
}

/** 建造类加成：存在性阻塞（spawn/tower）优先，临近完工其次。 */
function siteBonus(site: ConstructionSite): number {
  let bonus = 0;
  if (site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER) bonus += 50;
  if (site.progressTotal > 0 && site.progress / site.progressTotal >= 0.8) bonus += 15;
  return bonus;
}

/** 控制器降级紧迫度：越接近降级，升级越该插队（保级 = 保住整房进度）。 */
function downgradeUrgency(ctrl: StructureController): number {
  if (ctrl.ticksToDowngrade < 5000) return 100;
  if (ctrl.ticksToDowngrade < 10000) return 50;
  return 0;
}

/** 向 assignment 指定的 target 送能。 */
function fillAssignmentTarget(): ActionCandidate<AnyOwnedStructure> {
  return {
    name: "fill:assignment-target",
    resolve: ac => {
      if (!ac.assignment?.targetId) return undefined;
      const target = getObjectById(ac.assignment.targetId as Id<AnyOwnedStructure>);
      if (!target) return undefined;
      // W-1 修复：目标已满时释放 assignment 并返回 undefined，
      // 放行 work 链 fallthrough（repairCritical / fillTarget / upgradeController）。
      // 原先容量检查缺失 → 携能 worker 对满目标每 tick transfer 得 ERR_FULL，
      // execute 已被调用即终止候选链 — 携能活锁，能量冻结在背包里。
      // 资格检查前置到 resolve 是唯一放行闸门（EN-1 公理）。
      const store = (target as AnyStoreStructure).store;
      if (store && store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        releaseAssignment(ac.creep);
        return undefined;
      }
      return target;
    },
    execute: (ac, t) => {
      const result = countedIntent("transfer", () => ac.creep.transfer(t, RESOURCE_ENERGY));
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, t);
      } else if (result === ERR_FULL || result === ERR_NOT_ENOUGH_RESOURCES) {
        // 残余竞态防护：同 tick 他人抢先填满 — 空载时切回 acquire。
        const used = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
        if (used === 0) ac.creep.memory.mode = "acquire";
      }
    },
  };
}

const policy: RolePolicy = {
  park: true,
  isRepairWorker: true,
  isSourceWorker: true,
  executionOrder: 0,
  // R674：work 模式效用仲裁 —— worker 原先链尾升级在 fill 永远可命中时被饿死；
  // 现按「填充/建造/维修/升级」价值 × 老化轮转。acquire 仍走链式。
  arbitration: "utility",
  acquire: [
    // 拾取地上掉落能量（衰减资源，优先于采集）。
    pickupDroppedEnergy(),
    // 采集 — getSource 公平份额分配（含拥挤迁移），source 分配统一入口。
    harvestSource(),
  ],

  work: [
    // 优先使用 assignment 指定的 target。
    scored(fillAssignmentTarget(), (_ac, t) => 60 + fillBonus(t)),
    // 紧急：修复血量 < 50% 的关键结构。
    scored(claimedRepair(repairCritical()), (_ac, t) => 130 + 100 * hpDeficit(t)),
    // 回退到最近 fillTarget；有 fill 租约且目标仍存在时让位给 assignment（保留 maxWorkers
    // 语义），assignment 目标满时会先释放租约，本候选随即恢复可用。
    scored(fillTarget(), (ac, t) =>
      ac.assignment?.targetId && getObjectById(ac.assignment.targetId) ? 0 : 45 + fillBonus(t),
    ),
    // R668：bootstrap 建造吞吐 —— 无 spawn 的新房只有少量 builder 承建。
    // 有填充目标时先保供给；无填充时建造；建造完才升级。
    scored(buildNearestSite(), (_ac, s) => 40 + siteBonus(s)),
    // 无填充目标、无工地 — 升级。降级风险越高，效用越高。
    scored(upgradeController(), (_ac, c) => 30 + downgradeUrgency(c)),
  ],
};

export const workerRole = defineRole("worker", 0 as Priority, policy);
