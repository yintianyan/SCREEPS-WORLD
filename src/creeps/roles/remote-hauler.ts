/** RemoteHauler */
import type { Priority } from "../../kernel/contracts";
import { CONFIG } from "../../config";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import { fillStorage, haulFillTarget } from "../engine/actions";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import {
  findDroppedEnergyCached,
  findMySitesCached,
  findRemoteContainersCached,
  findRuinsCached,
  findTombstonesCached,
} from "../support/room-scans";

/** 就近选择的「值得专程」阈值比例：低于背包空闲 30% 的 container 不值得专程跑。 */
const REMOTE_WORTHWHILE_RATIO = 0.3;

/**
 * 通勤建路 — 走到哪建到哪：规划器在远矿路径铺 road site，通勤 hauler 路过
 * （build range 3）时顺手 build。build 是非移动动作、移动走意图仲裁，同 tick
 * 叠加不耽误赶路；能量从 carry 出（回程满载腿承担，一次性基建投入）。
 * 无 WORK 部件的 body build 会 ERR_NOT_ENOUGH_RESOURCES，无害跳过 — 但仍浪费
 * CPU 做 find+range 计算，前置 WORK 检查消除无效开销。
 */
function buildRoadSiteUnderfoot(creep: Creep): void {
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return;
  if (creep.getActiveBodyparts(WORK) === 0) return; // 无 WORK 部件，build 必失败
  const sites = findMySitesCached(creep.room);
  if (sites.length === 0) return;
  let best: ConstructionSite | undefined;
  let bestRange = 4;
  for (const site of sites) {
    const range = creep.pos.getRangeTo(site);
    if (range >= bestRange) continue;
    best = site;
    bestRange = range;
  }
  if (best) creep.build(best);
}

/** 包装通勤候选：执行前先建脚下的路（移动意图由内层 execute 照常登记）。 */
function withRoadBuild<T>(inner: ActionCandidate<T>): ActionCandidate<T> {
  return {
    name: inner.name,
    resolve: inner.resolve,
    execute: (ac, target) => {
      buildRoadSiteUnderfoot(ac.creep);
      inner.execute(ac, target);
    },
  };
}

/** 从远矿 container 取能。 */
function withdrawRemoteContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "remote-hauler:withdraw-container",
    resolve: ac => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      return findRemoteContainer(ac.creep);
    },
    execute: (ac, container) => {
      const available = container.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      if (amount <= 0) return;
      const result = ac.creep.withdraw(container, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, container);
      }
    },
  };
}

/** 从远矿房坟墓/废墟中提取遗留能量。
 * 坟墓/废墟不能用 pickup，必须用 withdraw。远矿房 creep 死亡后留下坟墓，
 * 坟墓在 5 tick 后消失，能量随之灭失——应优先于 container 回收（container 不衰减）。
 * minAmount 过滤零头：大额遗留值得专程，零头由链尾实例兜底（与本地 hauler 同构）。 */
function lootRemoteRemains(minAmount = 0): ActionCandidate<Tombstone | Ruin> {
  return {
    name: "remote-hauler:loot-remains",
    resolve: ac => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      const threshold = Math.max(1, minAmount);
      const candidates: (Tombstone | Ruin)[] = [];
      for (const t of findTombstonesCached(ac.creep.room)) {
        if (t.store.getUsedCapacity(RESOURCE_ENERGY) >= threshold) candidates.push(t);
      }
      for (const r of findRuinsCached(ac.creep.room)) {
        if (r.store.getUsedCapacity(RESOURCE_ENERGY) >= threshold) candidates.push(r);
      }
      if (candidates.length === 0) return undefined;
      return ac.creep.pos.findClosestByRange(candidates) ?? candidates[0];
    },
    execute: (ac, remains) => {
      const available = remains.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      if (amount <= 0) return;
      const result = ac.creep.withdraw(remains, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, remains);
      }
    },
  };
}

/** 拾取远矿房地上掉落的能量（remoteHarvester drop 的）。
 * minAmount 过滤零头：大额溢出值得专程，零头由链尾实例兜底（与本地 hauler 同构）。 */
function pickupRemoteDropped(minAmount = 0): ActionCandidate<Resource> {
  return {
    name: "remote-hauler:pickup-dropped",
    resolve: ac => {
      const remoteTarget = ac.creep.memory.remoteTarget;
      if (!remoteTarget || ac.creep.room.name !== remoteTarget) return undefined;
      return findDroppedEnergy(ac.creep, minAmount);
    },
    execute: (ac, dropped) => {
      const result = ac.creep.pickup(dropped);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, dropped);
      }
    },
  };
}

/** 在远矿房按就近原则查找 container 取能。
 *
 * 目标：以最快速度满载运回主房。近处 source 能满载就不跑远处；
 * 近处不足时去远处，绝不停在一处等资源——取完即走，下 tick 重新评估。
 *
 * 三层贪心：
 * Round 1 — 最近的「够满载」的 container (available ≥ carryFree) → 一次取满，距离最近者
 * Round 2 — 无够满载时，最近的「值得专程」的 container (≥ carryFree × 30%) → 取完即走
 * Round 3 — 都不值得专程时，选能量最大的（去积攒处比在空 container 旁等强）
 *
 * container 列表走 per-tick per-room 共享缓存（同房多 hauler 一次 find），
 * 消除「角色禁止全房 find」硬约束违规。每 tick 重新评估目标——
 * 不缓存 containerId，实现取完近处即走、不停留等回填。 */
export function findRemoteContainer(creep: Creep): StructureContainer | undefined {
  const containers = findRemoteContainersCached(creep.room).filter(
    c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
  );
  if (containers.length === 0) return undefined;

  const carryFree = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  if (carryFree <= 0) return undefined;

  // 按距离从近到远排序。
  const sorted = containers
    .map(c => ({
      container: c,
      energy: c.store.getUsedCapacity(RESOURCE_ENERGY),
      dist: creep.pos.getRangeTo(c),
    }))
    .sort((a, b) => a.dist - b.dist);

  // Round 1：最近的「够满载」的 container。
  for (const e of sorted) {
    if (e.energy >= carryFree) return e.container;
  }

  // Round 2：最近的「值得专程」的 container。
  const worthwhile = carryFree * REMOTE_WORTHWHILE_RATIO;
  for (const e of sorted) {
    if (e.energy >= worthwhile) return e.container;
  }

  // Round 3：都不值得专程 — 选能量最大的（去积攒处比在空 container 旁等强）。
  let best = sorted[0]!;
  for (const e of sorted) {
    if (e.energy > best.energy) best = e;
  }
  return best.container;
}

/** 在远矿房查找最近的掉落能量。

 * 掉落资源列表走 per-tick per-room 缓存：远矿房无 RoomSnapshot 预热，
 * 若每 tick 直接 room.find，container 空档期内 acquire 链每 tick 都会全房扫描，
 * 违反「角色禁止全房 find」硬约束。缓存生命周期单 tick，同房多 hauler 共享。
 */
function findDroppedEnergy(creep: Creep, minAmount = 0): Resource | undefined {
  const all = findDroppedEnergyCached(creep.room);
  const resources = minAmount > 0 ? all.filter(r => r.amount >= minAmount) : all;
  if (resources.length === 0) return undefined;
  return creep.pos.findClosestByRange(resources) ?? resources[0];
}

const policy: RolePolicy = {
  park: true,
  // P2-M：原 role-runner 硬编码 `role === "remoteHauler" && mode === "work" && room === home`
  //   下沉为角色钩子。work 在 home 房无候选时切 idle（ensureHome 保持在家）；
  //   acquire 在 home 房不切 idle（保持 acquire mode，ensureHome 导航去 remoteTarget）。
  shouldIdleWhenNoCandidate: ac => {
    const c = ac.creep;
    return c.memory.mode === "work" && c.room.name === c.memory.home;
  },
  acquire: [
    // 大额衰减资源优先回收：坟墓/废墟/掉落堆在衰减或限时灭失，container 不衰减。
    // 阈值（lootThreshold）挡住零头——只有值得专程的大额遗留才插队；
    // 否则 container 满溢时 harvester 持续 drop 少量能量，hauler 每 tick 被零头吸引
    // 离开 container、拾取少量又回来，来回抖动且满 container 始终没被抽干（溢出根源未除）。
    withRoadBuild(lootRemoteRemains(CONFIG.economy.lootThreshold)),
    withRoadBuild(pickupRemoteDropped(CONFIG.economy.lootThreshold)),
    // 从 container 取能（不衰减，可延后）。先抽满 container 消除溢出根源。
    withRoadBuild(withdrawRemoteContainer()),
    // 零头兜底 — 仅当无大额遗留且无 container 可取时才触发。
    withRoadBuild(lootRemoteRemains(1)),
    withRoadBuild(pickupRemoteDropped()),
  ],
  work: [
    // 存入 storage（RCL4+）。
    withRoadBuild(fillStorage()),
    // 回退：直送 spawn/extension。
    withRoadBuild(haulFillTarget()),
    // 所有 sink 满 — 待命（ensureHome 会导航回 home，parkIdleCreep 归位）。
  ],
};

export const remoteHaulerRole = defineRole("remoteHauler", 1 as Priority, policy);
