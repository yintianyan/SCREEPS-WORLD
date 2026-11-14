/** DepositHarvester — 远矿 deposit 采集 + 回 home 落仓的最小闭环角色。 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { getObjectById } from "../support/obj-cache";

/** deposit 可能产出的四种资源（用于 memory.depositType 缺失时的兜底识别）。 */
const DEPOSIT_RESOURCES: readonly ResourceConstant[] = [
  RESOURCE_MIST,
  RESOURCE_BIOMASS,
  RESOURCE_METAL,
  RESOURCE_SILICON,
];

/** 读取本角色绑定的 deposit；不存在（采空/被拆/无视野外的 id 失效）时返回 undefined。 */
function getDeposit(creep: Creep): Deposit | undefined {
  const id = creep.memory.depositId;
  if (!id) return undefined;
  return getObjectById(id) ?? undefined;
}

/** 背包里实际携带的 deposit 资源类型（memory 缺失时按四种 deposit 资源兜底）。 */
function carriedDepositType(creep: Creep): ResourceConstant | undefined {
  const remembered = creep.memory.depositType;
  if (remembered && creep.store.getUsedCapacity(remembered) > 0) return remembered;
  return DEPOSIT_RESOURCES.find(type => creep.store.getUsedCapacity(type) > 0);
}

/**
 * 门禁：deposit 消失后的收尾。
 * - 在 deposit 房且仍有货：切 work 回家落仓（避免带着资源被回收）；
 * - 在 deposit 房且空包：任务已无意义，标记回收由 spawn-manager 引导返航。
 * 不在 deposit 房时不判定 —— 通勤途中看不到 deposit 是正常的。
 */
function depositGate(ac: ActionContext): boolean {
  const creep = ac.creep;
  if (creep.room.name !== creep.memory.remoteTarget) return true;
  if (getDeposit(creep)) return true;
  if (creep.store.getUsedCapacity() > 0) {
    creep.memory.mode = "work";
    return true;
  }
  creep.memory.recycle = true;
  return false;
}

/** 在 deposit 旁采集（背包未满时）。 */
function harvestDeposit(): ActionCandidate<Deposit> {
  return {
    name: "deposit-harvester:harvest",
    resolve: ac => {
      if (ac.creep.room.name !== ac.creep.memory.remoteTarget) return undefined;
      if (ac.creep.store.getFreeCapacity() <= 0) return undefined;
      return getDeposit(ac.creep);
    },
    execute: (ac, deposit) => {
      const result = ac.creep.harvest(deposit);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, deposit);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        // 已采空：有货先回家落仓，不把背包里的资源一起回收掉。
        if (ac.creep.store.getUsedCapacity() > 0) {
          ac.creep.memory.mode = "work";
        } else {
          ac.creep.memory.recycle = true;
        }
      }
    },
  };
}

/** 回 home 后的落点：storage 优先、terminal 兜底（按携带的 deposit 资源判断空位）。 */
type DepositSink = StructureStorage | StructureTerminal;

function depositHome(): ActionCandidate<DepositSink> {
  return {
    name: "deposit-harvester:deposit-home",
    resolve: ac => {
      if (ac.creep.room.name !== ac.creep.memory.home) return undefined;
      const type = carriedDepositType(ac.creep);
      if (!type) return undefined;
      const storage = ac.snapshot.storage;
      if (storage && storage.store.getFreeCapacity(type) > 0) return storage;
      const terminal = ac.snapshot.terminal;
      if (terminal && terminal.store.getFreeCapacity(type) > 0) return terminal;
      return undefined;
    },
    execute: (ac, sink) => {
      const type = carriedDepositType(ac.creep);
      if (!type) return;
      if (ac.creep.transfer(sink, type) === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, sink);
      }
    },
  };
}

/** storage/terminal 都满时在 home 地面卸货 —— 资源留在本房可被 hauler 回收，不随 creep 消失。 */
function dropHome(): ActionCandidate<true> {
  return {
    name: "deposit-harvester:drop-home",
    resolve: ac => {
      if (ac.creep.room.name !== ac.creep.memory.home) return undefined;
      const type = carriedDepositType(ac.creep);
      if (!type) return undefined;
      const storage = ac.snapshot.storage;
      const terminal = ac.snapshot.terminal;
      const hasSink =
        (storage !== undefined && storage.store.getFreeCapacity(type) > 0) ||
        (terminal !== undefined && terminal.store.getFreeCapacity(type) > 0);
      return hasSink ? undefined : true;
    },
    execute: ac => {
      const type = carriedDepositType(ac.creep);
      if (type) ac.creep.drop(type);
    },
  };
}

const policy: RolePolicy = {
  gate: depositGate,
  acquire: [harvestDeposit()],
  work: [depositHome(), dropHome()],
};

export const depositHarvesterRole = defineRole("depositHarvester", 2 as Priority, policy);
