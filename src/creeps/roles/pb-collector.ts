/** PB Collector */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { getPbRoomCache, getPowerBankCached } from "../support/room-scans";

/** 目标房内可捡的 power 载荷（掉落堆或含 power 的废墟）。 */
type PowerPickupTarget = { kind: "dropped"; resource: Resource } | { kind: "ruin"; ruin: Ruin };

/**
 * 击破前预置：停在 PB 附近（range 2），等它被打掉。
 *
 * 为什么必须预置：PB 摧毁后 power 落在 ruin 里，引擎的
 * RUIN_DECAY_STRUCTURES.powerBank = 10 tick —— 从家里再赶过来根本来不及。
 * range 2 是为了不占攻击手的贴身位；击破后 1 步即可进入 withdraw 射程。
 */
function stageAtPowerBank(): ActionCandidate<StructurePowerBank> {
  return {
    name: "pb-collector:stage",
    resolve: ac => {
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      // 已经抢到 power → 优先回仓，不在 PB 旁继续等。
      if (ac.creep.store.getUsedCapacity(RESOURCE_POWER) > 0) return undefined;
      return getPowerBankCached(ac.creep.room);
    },
    execute: (ac, pb) => {
      if (ac.creep.pos.getRangeTo(pb) > 2) moveToTarget(ac.creep, pb, 2);
    },
  };
}

/** 捡起目标房内的 power（空载相）。 */
function pickupPower(): ActionCandidate<PowerPickupTarget> {
  return {
    name: "pb-collector:pickup-power",
    resolve: ac => {
      const target = ac.creep.memory.remoteTarget;
      if (!target || ac.creep.room.name !== target) return undefined;
      if (ac.creep.store.getFreeCapacity(RESOURCE_POWER) <= 0) return undefined;
      const cache = getPbRoomCache(ac.creep.room);
      if (cache.droppedPower.length > 0) {
        return { kind: "dropped" as const, resource: cache.droppedPower[0]! };
      }
      if (cache.powerRuins.length > 0) {
        return { kind: "ruin" as const, ruin: cache.powerRuins[0]! };
      }
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
    resolve: ac => {
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
      } else if (ac.creep.store.getUsedCapacity(RESOURCE_POWER) === 0) {
        // 一次性角色：卸完即回收，不再折返 PB 房（ruin 已消失，回去只会空跑）。
        ac.creep.memory.recycle = true;
      }
    },
  };
}

/** 任务完成自检（gate）：背包空且目标房无 PB/无掉落 power → 自标记 recycle。 */
function collectorGate(ac: ActionContext): boolean {
  const target = ac.creep.memory.remoteTarget;
  if (target && ac.creep.room.name === target) {
    // PB 还活着 → 预置等待，不能回收（否则击破时无人抢 ruins）。
    if (getPowerBankCached(ac.creep.room)) return true;
    if (ac.creep.store.getUsedCapacity(RESOURCE_POWER) === 0) {
      const cache = getPbRoomCache(ac.creep.room);
      if (cache.droppedPower.length === 0 && cache.powerRuins.length === 0) {
        ac.creep.memory.recycle = true;
        return false;
      }
    }
  }
  return true;
}

const policy: RolePolicy = {
  park: true,
  gate: collectorGate,
  acquire: [stageAtPowerBank(), pickupPower()],
  work: [stageAtPowerBank(), pickupPower(), depositPower()],
};

export const pbCollectorRole = defineRole("pbCollector", 3 as Priority, policy);
