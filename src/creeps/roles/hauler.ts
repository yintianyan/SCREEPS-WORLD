/**
 * Hauler — P1 收集者角色。
 *
 * 职责：将能量从源（container/dropped/link）搬运到 sink（spawn/extension/storage）。
 * 数据流方向：源 → Storage/Sink（单向，永不从 storage 取能）。
 *
 * 与 distributor 的职责分离：
 *   - Hauler（收集者）：container/dropped/link → storage/sink
 *   - Distributor（分发者）：storage → spawn/extension/tower/lab
 *
 * 架构约束：hauler 永不从 storage 取能。
 * 这消除了旧架构中 hauler 同时从 storage 取能又存回 storage 的循环依赖。
 * storage → sink 的分发由 distributor 角色负责。
 *
 * 无 storage 时（RCL1-3）：hauler 直接 container → spawn/extension 直送，
 * 不需要 distributor。
 *
 * 策略声明：
 *   acquire: assignment container > storage link（排空 link 网络）> 最满 container（主取能）> droppedEnergy（残余清理）
 *   work:    haul fillTarget（带 reservation）> minerals → storage > labs > storage > 待命
 *
 * acquire 顺序要点：droppedEnergy 排最后。container 满溢时 harvester 会 drop 溢出能量，
 * 若先捡 drop 会让 hauler 半满离开、来回空转而抽不干满 container（溢出根源未除）；
 * 先抽最满 container 既满载搬运又从源头止住溢出。详见 acquire 链内注释。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import {
  fillStorage,
  haulFillTarget,
  haulMineralsToStorage,
  pickupDroppedEnergy,
  supplyLabs,
  withdrawCapped,
  withdrawStorageLink,
} from "../engine/actions";
import { findRichestContainer } from "../support/targeting";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { getObjectById } from "../support/obj-cache";

/** 从 assignment 指定的 container 限量取能。 */
function withdrawAssignmentContainer(): ActionCandidate {
  return {
    name: "withdraw:assignment-container",
    predicate: (ac) => {
      if (!ac.assignment?.sourceId) return false;
      const obj = getObjectById(ac.assignment.sourceId as unknown as Id<StructureContainer>);
      return obj !== null && (obj as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const target = getObjectById(ac.assignment!.sourceId as unknown as Id<StructureContainer>) as StructureContainer;
      const available = target.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      const result = ac.creep.withdraw(target, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, target);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/** 从最满的非 controller container 限量取能。
 *
 * 禁止从 controller container 取能：hauler 的 work 链会向 controller container 倒能
 * （haulFillTarget 将低于半满的 controller container 列为最高优先级填充目标）。
 * 如果 acquire 链同时从 controller container 取能，会形成「取→倒→取→倒」振荡。
 */
function withdrawRichestCapped(): ActionCandidate {
  return withdrawCapped((ac: ActionContext) => {
    // 排除 controller container — 它是 hauler 的填充目标，不是取能来源。
    const candidates = ac.snapshot.controllerContainer
      ? ac.snapshot.containers.filter(c => c.id !== ac.snapshot.controllerContainer!.id)
      : ac.snapshot.containers;
    const best = findRichestContainer(candidates);
    if (!best || best.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
    return best;
  });
}

const policy: RolePolicy = {
  park: true,
  acquire: [
    // 0. 优先使用 assignment 指定的 container（任务驱动，定向搬运）。
    withdrawAssignmentContainer(),
    // 1. 排空 storage link — link 物流链的「最后一公里」。
    //    必须在 container 之前：storage link 是 link 网络的排水口，
    //    不排空则 source link 背压瘫痪，整条 link 网络堵死。
    withdrawStorageLink(),
    // 2. 回退到最满 container —— 主取能源。
    //    必须排在 pickupDroppedEnergy 之前：container 满溢时 harvester 会 drop 溢出能量，
    //    若先捡 drop（小堆、衰减），hauler 背包没装满就离开去卸货，回来时 harvester 又 drop，
    //    于是「捡零头→半满离开→返回→再捡零头」来回空转，满 container 始终没被抽干（溢出根源未除）。
    //    先抽最满 container：一口装满背包（满载搬运），且抽干 container 即消除溢出根源。
    withdrawRichestCapped(),
    // 3. 拾取地上掉落能量 —— 残余清理（死亡掉落 / container 被毁残留 / 已无 container 可抽时的溢出）。
    //    降至最后：仅当无 assignment / link / container 需要搬运时才触发，避免劫持主取能。
    pickupDroppedEnergy(),
    // 注意：hauler 永不从 storage 取能。
    // storage → sink 的分发由 distributor 角色负责。
    // 这从架构上消除了 storage→storage 循环。
  ],

  work: [
    // 矿物优先搬运（高价值资源不应滞留在 container）。
    haulMineralsToStorage(),
    // RCL4+: 优先填充 storage（distributor 从 storage 分发到 spawn/extension）。
    // RCL1-3: 无 storage → predicate=false → fallthrough 到 haulFillTarget。
    // 这修复了 storage 空置死锁：旧顺序 haulFillTarget 在前，spawn 不满时 hauler
    // 永远直送 spawn，storage 永远空，distributor 永远 idle。
    fillStorage(),
    // spawn/extension 紧急回退：storage 满或无 storage 时直送。
    haulFillTarget(),
    // 化合物供料到 lab。
    supplyLabs(),
    // 所有 sink 均满 — 原地待命。
    // hauler 无 WORK 部件，不能升级控制器（upgradeController 会 ERR_NO_BODYPART）。
    // 空闲是正确信号：供给 > 需求，demand 系统会据此减少 hauler 孵化数量。
  ],
};

export const haulerRole = defineRole("hauler", 1 as Priority, policy);
