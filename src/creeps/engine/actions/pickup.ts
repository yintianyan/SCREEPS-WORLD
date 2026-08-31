/** Pickup actions — 回收遗留能量（掉落堆/坟墓/废墟）。 */
import type { ActionCandidate } from "../action-types";
import { runCountedAction } from "./helpers";
import { selectDroppedEnergy } from "../../support/targeting";

/**
 * 拾取地上掉落的能量（来源：creep 死亡掉落、harvester 溢出、container 被毁残留）。
 * 目标选择由 selectDroppedEnergy 统一处理（优先身边最大堆，否则最近堆）。
 * minAmount：双档链位用（「大堆优先于 container、零头链尾兜底」，见 hauler acquire 链）。
 * "未装满则继续拾取"：updateMode 仅在 free===0 切 work，背包未满会逐 tick 拾取不同堆直到装满。
 */
export function pickupDroppedEnergy(minAmount = 0): ActionCandidate<Resource> {
  return {
    name: "pickup:dropped-energy",
    resolve: (ac) => {
      const candidates = minAmount > 0
        ? ac.snapshot.droppedEnergy.filter(r => r.amount >= minAmount)
        : ac.snapshot.droppedEnergy;
      return selectDroppedEnergy(ac.creep, candidates);
    },
    execute: (ac, resource) => {
      // intent 计量：min(堆上现存, 背包空闲) — 动作前求值（官服结算延迟下唯一可靠）。
      const free = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      runCountedAction(ac.creep, resource, "pickedUp", () => ac.creep.pickup(resource), {
        [ERR_FULL]: () => { ac.creep.memory.mode = "work"; },
      }, () => Math.min(resource.amount, free));
    },
  };
}

/**
 * 从坟墓/废墟提取遗留能量（withdraw — 坟墓/废墟不能 pickup）。
 * 目标：身边（range<=1）能量最多优先（减少衰减损耗），否则最近的一个。
 * minAmount 过滤零头：大额遗留（全拆重建 storage 库存进 ruin、满载 hauler 死亡坟墓）值得专程，
 * 零头由链尾无阈值实例顺手清理。
 */
export function lootRemains(minAmount = 0): ActionCandidate<Tombstone | Ruin> {
  return {
    name: "loot:remains",
    resolve: (ac) => {
      // 遗留物按「任意资源总量」筛选（不限能量）— 只装矿物的坟墓同样值得回收，
      // 否则满载矿物的 mineralMiner 死后，其矿物随尸体灭失（线上实证）。
      const candidates: (Tombstone | Ruin)[] = [];
      for (const t of ac.snapshot.tombstones) {
        if (t.store.getUsedCapacity() >= Math.max(1, minAmount)) candidates.push(t);
      }
      for (const r of ac.snapshot.ruins) {
        if (r.store.getUsedCapacity() >= Math.max(1, minAmount)) candidates.push(r);
      }
      if (candidates.length === 0) return undefined;

      // 身边总量最多的优先。
      let richestAdjacent: Tombstone | Ruin | undefined;
      for (const c of candidates) {
        if (ac.creep.pos.getRangeTo(c) > 1) continue;
        if (
          !richestAdjacent ||
          c.store.getUsedCapacity() > richestAdjacent.store.getUsedCapacity()
        ) {
          richestAdjacent = c;
        }
      }
      if (richestAdjacent) return richestAdjacent;

      return ac.creep.pos.findClosestByRange(candidates) ?? candidates[0];
    },
    execute: (ac, remains) => {
      // 取货：能量优先（多数场景），无能量则取尸体内最多的一种资源（矿物）。
      // 限量取：min(可用, 空闲)，避免 ERR_NOT_ENOUGH_RESOURCES 竞态置 idle。
      const carryFree = ac.creep.store.getFreeCapacity();
      let resource: ResourceConstant = RESOURCE_ENERGY;
      let available = remains.store.getUsedCapacity(RESOURCE_ENERGY);
      if (available <= 0) {
        // 无能量 — 挑存量最多的一种资源（矿物/化合物）。
        // 门禁：无 storage 且无 terminal 时不取矿物——矿物唯一卸货出口 haulMineralsToStorage
        // 需 storage/terminal，否则捡了无处倒，配 updateMode 总量口径 hauler 会冻结
        // （RCL1-3/新占房常有含矿 ruins）。
        if (!ac.snapshot.storage && !ac.snapshot.terminal) return;
        let best: ResourceConstant | undefined;
        let bestAmt = 0;
        for (const res of Object.keys(remains.store) as ResourceConstant[]) {
          const amt = remains.store.getUsedCapacity(res) ?? 0;
          if (amt > bestAmt) { bestAmt = amt; best = res; }
        }
        if (!best) return;
        resource = best;
        available = bestAmt;
      }
      const amount = Math.min(available, carryFree);
      // 墓碑/废墟取能＝散落资产回收，是真实经济流入（pickedUp），非搬运。
      // 注意矿物捡拾不计量（账本是能量口径）— intentAmount 只在能量分支对齐。
      runCountedAction(ac.creep, remains, "pickedUp", () => ac.creep.withdraw(remains, resource, amount), {
        [ERR_FULL]: () => { ac.creep.memory.mode = "work"; },
      }, () => (resource === RESOURCE_ENERGY ? amount : 0));
    },
  };
}

/**
 * 拾取身边的掉落能量（仅 range 内，不离开站桩位）— 专供 upgrader 等站桩角色。
 * 衰减资源应优先回收，但不能为捡远处掉落离开 controller 旁的站桩位。
 * range 默认 2：覆盖站桩位周围一圈，足够捡起 harvester 溢出到 controller container 旁的能量。
 */
export function pickupNearbyDroppedEnergy(range = 2): ActionCandidate<Resource> {
  return {
    name: "pickup:nearby-dropped-energy",
    resolve: (ac) => {
      const nearby = ac.snapshot.droppedEnergy.filter(
        r => ac.creep.pos.getRangeTo(r) <= range,
      );
      return selectDroppedEnergy(ac.creep, nearby);
    },
    execute: (ac, resource) => {
      const free = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      runCountedAction(ac.creep, resource, "pickedUp", () => ac.creep.pickup(resource), {
        [ERR_FULL]: () => { ac.creep.memory.mode = "work"; },
      }, () => Math.min(resource.amount, free));
    },
  };
}
