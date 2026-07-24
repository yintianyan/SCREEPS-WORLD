/**
 * Distributor — P1 分发角色（RCL4+）。
 *
 * 职责：从 storage 取能，分发给 spawn/extension/tower/lab。
 * 数据流方向：Storage → Sink（单向，永不回流）。
 *
 * 与 hauler 的职责分离：
 *   - Hauler（收集者）：源 → Storage（container/dropped/link → storage）
 *   - Distributor（分发者）：Storage → Sink（storage → spawn/extension/tower/lab）
 *
 * 这消除了 hauler 时代的 storage→storage 循环：
 *   旧架构：hauler 从 storage 取能 → fillStorage 存回 → 死循环
 *   新架构：distributor 从 storage 取能 → 填充 spawn/extension（永不存回 storage）
 *
 * 存在条件：仅当 storage 存在时才孵化（RCL4+）。
 * 无 storage 时 hauler 直接 container → sink 直送，不需要 distributor。
 *
 * assignment-free 设计声明（重要 — 修改前必读）：
 *   distributor 不参与 assignment 系统（不在 ROLE_TASK_KINDS 映射中），
 *   不通过 getAssignment 消费任务，而是直接读 RoomSnapshot.fillTargets 驱动。
 *
 *   为什么这么设计：
 *   distributor 的核心职责是"填充 spawn/extension/tower"。
 *   这个职责在所有状态下都应优先执行 —
 *   无论是正常态、低能量紧急态、还是敌袭态，spawn 没能量 = 无法孵化 = 全盘崩溃。
 *   若纳入 assignment 系统，assignment-service 在紧急抢占
 *   （invalidateAssignments, priority >= 1）时会清空 creep.memory.assignment，
 *   导致 distributor 失去任务 → spawn 不被填充 → 灾后无法恢复。
 *   assignment-free 让 distributor 在紧急状态下仍坚守 spawn 填充职责。
 *
 *   限制与边界：
 *   - 紧急抢占对 distributor 无效（设计意图，非 bug）。
 *   - 但 distributor 仍受 role-runner 的 shouldFlee 控制 — 敌袭时撤离优先于填充。
 *   - distributor 的"需求门禁"（fillTargets 非空才取能）已从架构上消除 storage→storage 循环，
 *     不需要 assignment 系统的任务级去重。
 *
 *   维护约束：
 *   - 不要把 distributor 纳入 assignment 系统，除非引入"紧急态豁免"机制。
 *   - 若未来需要 distributor 接受 lab 供料任务等扩展，应通过 snapshot 扩展字段驱动，
 *     而非引入 ROLE_TASK_KINDS 映射。
 *
 * 策略声明：
 *   acquire: storage（带需求门禁 — 仅当 fillTargets 非空时取能）
 *   work:    haul fillTarget（带 reservation）> supply labs > 待命
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import {
  distributorFillTarget,
  supplyLabs,
} from "../engine/actions";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";

/** 从 storage 限量取能 — 仅当存在下游 fillTarget 时。
 *
 * 需求门禁是本角色的核心设计：
 * 没有 fillTarget（spawn/extension/tower 全满）时禁止从 storage 取能。
 * 这从架构上消除了 storage→storage 循环的可能性。
 */
function withdrawStorageForDistribution(): ActionCandidate {
  return {
    name: "withdraw:storage-for-distribution",
    predicate: (ac) => {
      const st = ac.snapshot.storage;
      if (!st || st.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return false;
      // 需求门禁：没有下游 fillTarget 时禁止从 storage 取能。
      return ac.snapshot.fillTargets.length > 0;
    },
    execute: (ac) => {
      const st = ac.snapshot.storage!;
      const available = st.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      const result = ac.creep.withdraw(st, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, st);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

const policy: RolePolicy = {
  park: true,
  acquire: [
    // 唯一取能源：storage（带需求门禁）。
    // 没有 fillTarget 时 predicate=false → idle → demand 系统不补孵。
    withdrawStorageForDistribution(),
  ],

  work: [
    // distributor 专用填充：spawn/extension 绝对优先 > tower > controller container（仅无 link 兜底）。
    // 不复用 hauler 的 haulFillTarget——避免被 divert 去喂 controller container 而饿死 spawn。
    distributorFillTarget(),
    // 化合物供料到 lab。
    supplyLabs(),
    // 所有 sink 均满 — 原地待命。
    // 注意：distributor 没有 fillStorage — 这是架构约束。
    // 如果加了 fillStorage，就会重新引入 storage→storage 循环。
  ],
};

export const distributorRole = defineRole("distributor", 1 as Priority, policy);
