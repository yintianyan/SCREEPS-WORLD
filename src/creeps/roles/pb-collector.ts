/** PB Collector */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";

/** 目标房内可捡的 power 载荷（掉落堆或含 power 的废墟）。 */
type PowerPickupTarget = { kind: "dropped"; resource: Resource } | { kind: "ruin"; ruin: Ruin };

/** 捡起目标房内的 power（空载相）。 */
function pickupPower(): ActionCandidate<PowerPickupTarget> {
  return {
    name: "pb-collector:pickup-power",
    resolve: (ac) => {
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      if (ac.creep.store.getFreeCapacity(RESOURCE_POWER) <= 0) return undefined;
      // 掉落堆优先（PB 直接掉落形态）；废墟兜底（被毁 container 里的 power）。
      const dropped = ac.creep.room.find(FIND_DROPPED_RESOURCES)
        .find(r => r.resourceType === RESOURCE_POWER);
      if (dropped) return { kind: "dropped" as const, resource: dropped };
      const ruin = ac.creep.room.find(FIND_RUINS)
        .find(r => (r.store[RESOURCE_POWER] ?? 0) > 0);
      if (ruin) return { kind: "ruin" as const, ruin };
      return undefined;
    },
    execute: (ac, t) => {
      if (t.kind === "dropped") {
        if (ac.creep.pickup(t.resource) === ERR_NOT_IN_RANGE) {
          moveToTarget(ac.creep, t.resource);
        }
      } else if (ac.creep.withdraw(t.ruin, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, t.ruin);
      }
    },
  };
}

/** 卸载载荷的容器（storage 优先，terminal 兜底）。 */
type PowerDepositTarget = StructureStorage | StructureTerminal;

/** 满载归仓（满载相）：回 home 存 storage/terminal，存完自回收。 */
function depositPower(): ActionCandidate<PowerDepositTarget> {
  return {
    name: "pb-collector:deposit-power",
    resolve: (ac) => {
      if (ac.creep.store.getUsedCapacity(RESOURCE_POWER) <= 0) return undefined;
      const home = ac.creep.memory.home;
      if (!home || ac.creep.room.name !== home) return undefined;
      const snapshot = ac.snapshot;
      const storage = snapshot.storage;
      if (storage && storage.store.getFreeCapacity(RESOURCE_POWER) > 0) return storage;
      const terminal = snapshot.terminal;
      if (terminal && terminal.store.getFreeCapacity(RESOURCE_POWER) > 0) return terminal;
      return undefined;
    },
    execute: (ac, target) => {
      if (ac.creep.transfer(target, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, target);
      }
    },
  };
}

/** 任务完成自检（gate）：背包空且目标房无掉落 power → 自标记 recycle。 */
function collectorGate(ac: ActionContext): boolean {
  // 仅在目标房内做完成判定（通勤中不误判）。
  const target = ac.creep.memory.remoteTarget;
  if (target && ac.creep.room.name === target) {
    const carrying = ac.creep.store.getUsedCapacity(RESOURCE_POWER);
    if (carrying === 0) {
      const droppedLeft = ac.creep.room.find(FIND_DROPPED_RESOURCES)
        .some(r => r.resourceType === RESOURCE_POWER);
      const ruinsLeft = ac.creep.room.find(FIND_RUINS)
        .some(r => (r.store[RESOURCE_POWER] ?? 0) > 0);
      if (!droppedLeft && !ruinsLeft) {
        ac.creep.memory.recycle = true;
        return false;
      }
    }
  }
  return true;
}

const policy: RolePolicy = {
  gate: collectorGate,
  acquire: [pickupPower()],
  work: [pickupPower(), depositPower()],
};

export const pbCollectorRole = defineRole("pbCollector", 3 as Priority, policy);
