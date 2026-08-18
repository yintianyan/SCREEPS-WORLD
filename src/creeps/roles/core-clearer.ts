/**
 * CoreClearer — P1 次级 Invader Core 清核者。
 *
 * 前往被 level-0 reserve-only 核心压制的远矿房，拆毁核心（核心不反击、无守卫），
 * 然后当场从废墟（ruin）捡取随机战利品带回 home 存 storage，最后标记回收。
 * 比「绕开等自然 decay」更优：直接回收被核心白占的稀缺远矿 op 名额。
 *
 * 设计：body ATTACK+MOVE+CARRY（无 heal/boost/combat 编队）。combat:true 跳过过境房
 * 威胁逃跑检测（必须在 hostile 房场推进到核心）。优先级 1 → 不被 recovery 殖民地态门禁
 * 冻结（与 defender/remoteHarvester 同档，P2+ 才被冻结）。
 *
 * 行为链（acquire 在 remoteTarget，work 在 home）：
 *   ① 核心在场 → 部署期(ticksToDeploy)无敌则待命、否则 attack 直至摧毁；
 *   ② 无核心 → 从 ruin 捡 loot（能量优先、矿物兜底）；
 *   ③ 无核心且无 loot 可捡 → 切 work 返航；
 *   ④ work 到家 → 存 storage；⑤ 空包 → 回收（一次性使命完成）。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { globalCache } from "../../kernel/global-cache";

/** 战利品捡取优先级：能量优先，其次按化合物顺序兜底（核心废墟可能含矿物）。 */
const LOOT_RESOURCE_PRIORITY: ResourceConstant[] = [
  RESOURCE_ENERGY,
  RESOURCE_HYDROGEN,
  RESOURCE_OXYGEN,
  RESOURCE_UTRIUM,
  RESOURCE_KEANIUM,
  RESOURCE_LEMERGIUM,
  RESOURCE_ZYNTHIUM,
  RESOURCE_CATALYST,
];

/**
 * 在远矿房查找 InvaderCore。per-tick per-room 缓存：单房至多一只 clearer，
 * 但避免每 tick room.find（角色硬约束——远程房无 RoomSnapshot 预热，缓存在
 * globalCache 按 tick 失效，同房共享）。
 */
function findInvaderCore(creep: Creep): StructureInvaderCore | undefined {
  const g = globalCache() as {
    __remoteInvaderCore?: Record<string, { tick: number; list: StructureInvaderCore[] }>;
  };
  if (!g.__remoteInvaderCore) g.__remoteInvaderCore = {};
  const cached = g.__remoteInvaderCore[creep.room.name];
  let cores: StructureInvaderCore[];
  if (cached && cached.tick === Game.time) {
    cores = cached.list;
  } else {
    cores = creep.room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_INVADER_CORE,
    }) as StructureInvaderCore[];
    g.__remoteInvaderCore[creep.room.name] = { tick: Game.time, list: cores };
  }
  return cores[0];
}

/**
 * 在远矿房查找含可捡资源的废墟（核心被毁必留 ruin，资源随 ticksToDecay 灭失 —
 * 必须当场捡，否则 loot 永远丢失）。同款 per-tick per-room 缓存。
 */
function findLootRuin(creep: Creep): Ruin | undefined {
  const g = globalCache() as {
    __remoteRuins?: Record<string, { tick: number; list: Ruin[] }>;
  };
  if (!g.__remoteRuins) g.__remoteRuins = {};
  const cached = g.__remoteRuins[creep.room.name];
  let ruins: Ruin[];
  if (cached && cached.tick === Game.time) {
    ruins = cached.list;
  } else {
    ruins = creep.room.find(FIND_RUINS) as Ruin[];
    g.__remoteRuins[creep.room.name] = { tick: Game.time, list: ruins };
  }
  for (const ruin of ruins) {
    if (ruin.store.getUsedCapacity() > 0) return ruin;
  }
  return undefined;
}

/** 攻击在场 InvaderCore；部署期(ticksToDeploy)核心无敌则待命不送（勿空耗寿命）。 */
function attackCoreAction(): ActionCandidate<StructureInvaderCore> {
  return {
    name: "core-clearer:attack-core",
    resolve: (ac) => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      return findInvaderCore(ac.creep);
    },
    execute: (ac, core) => {
      // level 缺失按要塞保守处理（与 classifyInvaderCores 同口径）：轻量 clearer
      // 打不过大要塞，立刻回收，等 manager 写 blockedUntil。
      if ((core.level ?? 1) >= 1) {
        ac.creep.memory.recycle = true;
        return;
      }
      // 部署期核心无敌 — 站旁边等，勿空耗寿命攻击。
      if (core.ticksToDeploy !== undefined) {
        moveToTarget(ac.creep, core);
        return;
      }
      const result = ac.creep.attack(core);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, core);
      }
    },
  };
}

/** 从废墟捡取战利品（能量优先，矿物兜底）；满载或无可捡则 undefined。 */
function lootRuinAction(): ActionCandidate<Ruin> {
  return {
    name: "core-clearer:loot-ruin",
    resolve: (ac) => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      if (ac.creep.store.getFreeCapacity() <= 0) return undefined;
      return findLootRuin(ac.creep);
    },
    execute: (ac, ruin) => {
      for (const rtype of LOOT_RESOURCE_PRIORITY) {
        const amount = ruin.store.getUsedCapacity(rtype);
        if (amount > 0) {
          const result = ac.creep.withdraw(ruin, rtype);
          if (result === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, ruin);
          return;
        }
      }
    },
  };
}

/**
 * 远端无核心且无可捡战利品时，切 work 返航存 loot。
 * 排在 acquire 链末尾：核心在场（继续拆）或仍有 loot 可捡（继续捡）时返回 undefined 不触发。
 */
function returnHomeWhenDone(): ActionCandidate<true> {
  return {
    name: "core-clearer:return-home",
    resolve: (ac) => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      if (findInvaderCore(ac.creep)) return undefined; // 仍有核心 → 继续拆。
      if (ac.creep.store.getFreeCapacity() > 0 && findLootRuin(ac.creep)) return undefined; // 继续捡。
      return true;
    },
    execute: (ac) => {
      ac.creep.memory.mode = "work";
    },
  };
}

/** 到家后把 loot 存进 storage（能量优先，矿物兜底直存 storage）。 */
function depositHomeAction(): ActionCandidate<StructureStorage> {
  return {
    name: "core-clearer:deposit-home",
    resolve: (ac) => {
      if (ac.creep.room.name !== ac.creep.memory.home) return undefined;
      if (ac.creep.store.getUsedCapacity() <= 0) return undefined;
      return ac.snapshot.storage;
    },
    execute: (ac, st) => {
      // 能量优先存；其次矿物（storage 可存任意资源）。storage 满则 transfer 失败，
      // 下 tick 重试，不会丢失 loot。
      const energy = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
      if (energy > 0) {
        if (ac.creep.transfer(st, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, st);
        return;
      }
      const mineral = LOOT_RESOURCE_PRIORITY.find(
        (r) => r !== RESOURCE_ENERGY && ac.creep.store.getUsedCapacity(r) > 0,
      );
      if (mineral) {
        if (ac.creep.transfer(st, mineral) === ERR_NOT_IN_RANGE) moveToTarget(ac.creep, st);
      }
    },
  };
}

/** 空包到家 → 回收（clearer 一次性使命完成，spawn-manager 引导归航）。 */
function recycleDoneAction(): ActionCandidate<true> {
  return {
    name: "core-clearer:recycle-done",
    resolve: (ac) => {
      if (ac.creep.store.getUsedCapacity() > 0) return undefined;
      return true;
    },
    execute: (ac) => {
      ac.creep.memory.recycle = true;
    },
  };
}

const policy: RolePolicy = {
  // 战斗角色 — 跳过过境房威胁逃跑检测，否则进入 hostile 房看到核心/Invader 即逃回 home，
  // 攻击候选永远轮不到执行。lesser 核心房间无守卫，跳过 flee 安全。
  combat: true,
  acquire: [
    attackCoreAction(),
    lootRuinAction(),
    returnHomeWhenDone(),
  ],
  work: [
    depositHomeAction(),
    recycleDoneAction(),
  ],
};

export const coreClearerRole = defineRole("coreClearer", 1 as Priority, policy);
