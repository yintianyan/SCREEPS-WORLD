/**
 * 可复用 Action 工厂 — 角色行为的最小原子单元。
 *
 * 每个工厂返回一个 ActionCandidate，角色 policy 通过组合这些原子
 * 构建自己的优先级链。新增行为 = 新增工厂 + 插入 policy 列表。
 *
 * 命名约定：
 *   - harvestXxx   — 从 source 采集
 *   - withdrawXxx  — 从结构取能
 *   - dumpXxx      — 向结构倒能（harvester 站桩专用）
 *   - fillXxx      — 向 fillTarget 送能
 *   - buildXxx     — 建造
 *   - repairXxx    — 维修
 *   - upgradeXxx   — 升级控制器
 */
import { CONFIG, getWallTargetHits } from "../../config";
import type { RoomSnapshot } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext } from "./action-types";
import { moveToTarget } from "../movement";
import { actOrMove } from "./role-runner";
import {
  findClosestContainerWithEnergy,
  findCriticalRepair,
  findEmptiestContainer,
  findRichestContainer,
  getFillTarget,
  getHaulFillTarget,
  getSource,
  selectDroppedEnergy,
} from "../support/targeting";
import { getObjectById } from "../support/obj-cache";

// ─── Harvest ────────────────────────────────────────────────

/** 从 source 采集（通用）。 */
export function harvestSource(): ActionCandidate {
  return {
    name: "harvest:source",
    predicate: (ac) => getSource(ac.creep, ac.snapshot) !== undefined,
    execute: (ac) => {
      const source = getSource(ac.creep, ac.snapshot)!;
      const result = actOrMove(ac.creep, source, () => ac.creep.harvest(source));
      if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/**
 * 站桩采集并同 tick 倒能（定点 miner 专用）。
 *
 * 关键：Screeps 中 harvest 与 transfer 是两个独立 intent，可在同一 tick 执行。
 * 只要矿工站在 source container 之上（或与 source 及 sink 均 range<=1），
 * 每 tick 即可「采 + 倒」，1 CARRY 也能维持满吞吐 10/tick，
 * 消除「采满停一 tick 倒能」造成的 ~17% 产能损失。
 *
 * 触发条件：分配到的 source 旁（range<=1）存在 container 或 link 作为站桩点。
 * 无 sink（早期无 container）时 predicate=false，回退到通用 harvestSource。
 *
 * 该动作同时置于 harvester 的 acquire[0] 与 work[0]：
 *   - 无论 FSM 处于哪个 mode 都执行，绕开「单 tick 只跑一条链」的限制；
 *   - 作为 work[0] 拦截站桩矿工，使其永不落到 fill/build/upgrade 而离岗（P2-7）。
 */
export function stationaryMine(): ActionCandidate {
  return {
    name: "harvest:stationary-mine",
    predicate: (ac) => {
      const source = getSource(ac.creep, ac.snapshot);
      if (!source) return false;
      return sourceAdjacentContainer(ac, source) !== undefined
        || sourceAdjacentLink(ac, source) !== undefined;
    },
    execute: (ac) => {
      const source = getSource(ac.creep, ac.snapshot)!;
      const container = sourceAdjacentContainer(ac, source);
      // 站位：优先站到 source container 之上（range 0 倒能，0 通勤）；否则站到 source 旁。
      const standTarget: RoomPosition | { pos: RoomPosition } = container ?? source;

      // 站桩维护：站立的 source container 血量 < 80%（与 repairNearbyContainer 阈值一致）时先修再采。
      // harvest 与 repair 互斥（不能同 tick），故空手时先采一 tick 攒能量、本 tick 不倒，
      // 下一 tick 有能量即修，交替进行；防止 source container 坍塌断链（P0 物流 / P2-7 不离岗）。
      if (
        container
        && ac.creep.pos.getRangeTo(container) <= 1
        && container.hits < container.hitsMax * 0.8
      ) {
        if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
          ac.creep.repair(container);
        } else if (ac.creep.harvest(source) === ERR_NOT_IN_RANGE) {
          moveToTarget(ac.creep, standTarget);
        }
        return;
      }

      const harvestResult = ac.creep.harvest(source);
      if (harvestResult === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, standTarget);
        return;
      }
      // 同 tick 倒能：link 优先，其次 container（均需 range<=1 且有空位）。
      if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        const link = sourceAdjacentLink(ac, source);
        const sink = link
          && ac.creep.pos.getRangeTo(link) <= 1
          && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0
          ? link
          : container
            && ac.creep.pos.getRangeTo(container) <= 1
            && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            ? container
            : undefined;
        if (sink) {
          ac.creep.transfer(sink, RESOURCE_ENERGY);
        } else if (ac.creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
          // 采集空间耗尽且身边 sink 均满 → 原地 drop 保持在位继续采（P2-7），
          // 掉落能量由 hauler 的 pickupDroppedEnergy 回收，绝不离岗去 fill/build/upgrade。
          ac.creep.drop(RESOURCE_ENERGY);
        }
      }
    },
  };
}

/** 找到与 source 相邻（range<=1）的 container（站桩倒能点）。 */
function sourceAdjacentContainer(ac: ActionContext, source: Source): StructureContainer | undefined {
  return ac.snapshot.containers.find(c => c.pos.getRangeTo(source.pos) <= 1);
}

/** 找到与 source 相邻（range<=1）的 link（RCL5+ source link）。 */
function sourceAdjacentLink(ac: ActionContext, source: Source): StructureLink | undefined {
  return ac.snapshot.links.find(l => l.pos.getRangeTo(source.pos) <= 1);
}

/**
 * 从 mineral 采集（需要 extractor）。
 * 触发条件：房间有 extractor + mineral 有储量 + creep 有 carry 空间。
 * 用于 source 再生期间的空闲利用（RCL6+）。
 */
export function harvestMineral(): ActionCandidate {
  return {
    name: "harvest:mineral",
    predicate: (ac) => {
      if (!ac.snapshot.extractor) return false;
      if (ac.snapshot.minerals.length === 0) return false;
      const mineral = ac.snapshot.minerals[0]!;
      return mineral.mineralAmount > 0 && ac.creep.store.getFreeCapacity() > 0;
    },
    execute: (ac) => {
      const mineral = ac.snapshot.minerals[0]!;
      const result = actOrMove(ac.creep, mineral, () => ac.creep.harvest(mineral));
      if (result === ERR_NOT_ENOUGH_RESOURCES || result === ERR_TIRED) {
        // mineral 耗尽或冷却中 — 回 idle
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

// ─── Pickup ────────────────────────────────────────────────

/**
 * 拾取地上掉落的能量。
 *
 * 掉落能量来源：creep 死亡掉落、harvester 溢出、container 被摧毁残留等。
 * 掉落能量会随时间衰减（每 tick 减少 ceil(amount/1000)），因此应尽快拾取。
 * 目标选择由 selectDroppedEnergy 统一处理（优先身边最大堆，否则走向最近堆）。
 *
 * “未装满则继续拾取”：本动作位于 acquire 候选链，而 updateMode 仅在 free===0 时才切
 * work。因此只要背包未满且快照中还有掉落能量，creep 会逐 tick 继续拾取不同的堆，
 * 直到装满才转入 work。
 */
export function pickupDroppedEnergy(): ActionCandidate {
  return {
    name: "pickup:dropped-energy",
    predicate: (ac) => ac.snapshot.droppedEnergy.length > 0,
    execute: (ac) => {
      const resource = selectDroppedEnergy(ac.creep, ac.snapshot.droppedEnergy);
      if (!resource) return;
      const result = actOrMove(ac.creep, resource, () => ac.creep.pickup(resource));
      if (result === ERR_FULL) {
        ac.creep.memory.mode = "work";
      }
    },
  };
}

/**
 * 拾取身边的掉落能量（仅 range 内，不离开站桩位）。
 *
 * 专供 upgrader 等站桩角色使用：衰减资源应优先回收，但不能为了捡远处
 * 的掉落能量离开 controller 旁的站桩位。range 默认 2 — 覆盖站桩位
 * 周围一圈，足够捡起 harvester 溢出到 controller container 旁的能量。
 */
export function pickupNearbyDroppedEnergy(range = 2): ActionCandidate {
  return {
    name: "pickup:nearby-dropped-energy",
    predicate: (ac) =>
      ac.snapshot.droppedEnergy.some(
        r => ac.creep.pos.getRangeTo(r) <= range,
      ),
    execute: (ac) => {
      const nearby = ac.snapshot.droppedEnergy.filter(
        r => ac.creep.pos.getRangeTo(r) <= range,
      );
      const resource = selectDroppedEnergy(ac.creep, nearby);
      if (!resource) return;
      const result = ac.creep.pickup(resource);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, resource);
      } else if (result === ERR_FULL) {
        ac.creep.memory.mode = "work";
      }
    },
  };
}

// ─── Withdraw ───────────────────────────────────────────────

/** 从最满 container 取能。 */
export function withdrawRichestContainer(): ActionCandidate {
  return {
    name: "withdraw:richest-container",
    predicate: (ac) => {
      const best = findRichestContainer(ac.snapshot.containers);
      return best !== undefined && best.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const best = findRichestContainer(ac.snapshot.containers)!;
      actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从最近有能量的 container 取能（builder 减少通勤）。 */
export function withdrawClosestContainer(): ActionCandidate {
  return {
    name: "withdraw:closest-container",
    predicate: (ac) => findClosestContainerWithEnergy(ac.creep, ac.snapshot.containers) !== undefined,
    execute: (ac) => {
      const best = findClosestContainerWithEnergy(ac.creep, ac.snapshot.containers)!;
      actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/**
 * 判断 container 是否为物流关键 container（source container 或 controller container）。
 *
 * - source container：紧邻 source，是 hauler 的物流源。非采集角色直接取用会导致
 *   hauler 无事可做、物流链断裂。
 * - controller container：紧邻 controller，是 upgrader 的站桩能量源。builder 取用
 *   会导致 upgrader 断粮，站桩升级链路崩溃。
 *
 * builder 等非物流角色应从非物流 container（如 mineral container）取能。
 */
function isLogisticsContainer(c: StructureContainer, ac: ActionContext): boolean {
  // source container
  if (ac.snapshot.sources.some(s => c.pos.getRangeTo(s.pos) <= 1)) return true;
  // controller container
  if (ac.snapshot.controllerContainer?.id === c.id) return true;
  return false;
}

/** 从最满的非物流 container 取能（upgrader 用，不抢 hauler/upgrader 的物流源）。 */
export function withdrawRichestNonSourceContainer(): ActionCandidate {
  return {
    name: "withdraw:richest-non-source-container",
    // 使用 .some() 短路求值，在第一个匹配项即返回 true，避免完整 filter 遍历。
    predicate: (ac) =>
      ac.snapshot.containers.some(
        c => !isLogisticsContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      ),
    execute: (ac) => {
      const candidates = ac.snapshot.containers.filter(
        c => !isLogisticsContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      const best = findRichestContainer(candidates);
      if (best) actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从最近的非物流 container 取能（builder 用，不抢 hauler/upgrader 的物流源）。 */
export function withdrawClosestNonSourceContainer(): ActionCandidate {
  return {
    name: "withdraw:closest-non-source-container",
    // 使用 .some() 短路求值，在第一个匹配项即返回 true，避免完整 filter 遍历。
    predicate: (ac) =>
      ac.snapshot.containers.some(
        c => !isLogisticsContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      ),
    execute: (ac) => {
      const candidates = ac.snapshot.containers.filter(
        c => !isLogisticsContainer(c, ac) && c.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      const best = findClosestContainerWithEnergy(ac.creep, candidates);
      if (best) actOrMove(ac.creep, best, () => ac.creep.withdraw(best, RESOURCE_ENERGY));
    },
  };
}

/** 从 controller 旁 container 取能（站桩升级）。 */
export function withdrawControllerContainer(): ActionCandidate {
  return {
    name: "withdraw:controller-container",
    predicate: (ac) => {
      const cc = ac.snapshot.controllerContainer;
      return cc !== undefined && cc.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const cc = ac.snapshot.controllerContainer!;
      actOrMove(ac.creep, cc, () => ac.creep.withdraw(cc, RESOURCE_ENERGY));
    },
  };
}

/** 从 controller 旁 link 取能（link 站桩升级，0 通勤）。 */
export function withdrawControllerLink(): ActionCandidate {
  return {
    name: "withdraw:controller-link",
    predicate: (ac) => {
      if (ac.snapshot.links.length === 0 || !ac.snapshot.controller) return false;
      return ac.snapshot.links.some(
        l => l.pos.getRangeTo(ac.snapshot.controller!) <= 2 && l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
    },
    execute: (ac) => {
      const ctrlLink = ac.snapshot.links.find(
        l => l.pos.getRangeTo(ac.snapshot.controller!) <= 2 && l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      )!;
      actOrMove(ac.creep, ctrlLink, () => ac.creep.withdraw(ctrlLink, RESOURCE_ENERGY));
    },
  };
}

/** 从 storage 取能。 */
export function withdrawStorage(): ActionCandidate {
  return {
    name: "withdraw:storage",
    predicate: (ac) => {
      const st = ac.snapshot.storage;
      return st !== undefined && st.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const st = ac.snapshot.storage!;
      actOrMove(ac.creep, st, () => ac.creep.withdraw(st, RESOURCE_ENERGY));
    },
  };
}

/**
 * 从 storage 旁 link 取能 — link 物流链的「最后一公里」。
 *
 * Link 网络能量流：
 *   Harvester → Source Link →(link-system 瞬移)→ Storage Link →(本 action)→ Hauler → Storage
 *
 * 如果没有 creep 定期排空 storage link，link 网络会堵死：
 * storage link 满后 planLinkTransfers 的 storageFree=0，
 * source link 无法再向其传输，整条链路背压瘫痪。
 *
 * 优先级：link-system (P1) 在 creep 之前运行，会先将 storage link → controller link
 * 传输（如果 controller 缺能），hauler 排空的是剩余部分 — 不影响升级链供能。
 *
 * 限量取能：与 withdrawCapped 一致，取 min(可用, 空闲)，避免 ERR_NOT_ENOUGH_RESOURCES。
 */
export function withdrawStorageLink(): ActionCandidate {
  return {
    name: "withdraw:storage-link",
    predicate: (ac) => {
      const st = ac.snapshot.storage;
      if (!st) return false;
      return ac.snapshot.links.some(
        l => l.pos.getRangeTo(st) <= 2 && l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
    },
    execute: (ac) => {
      const st = ac.snapshot.storage!;
      // 找到 storage 旁有能量的 link（range ≤ 2）。
      const link = ac.snapshot.links.find(
        l => l.pos.getRangeTo(st) <= 2 && l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      if (!link) return;
      const available = link.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      const result = ac.creep.withdraw(link, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, link);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/**
 * 从 storage 限量取能（upgrader 专用）。
 *
 * 防止 upgrader 一次取走大量能量导致 storage 突降、触发 economyPressure
 * 连锁降级。单次取 min(可用, 空闲, limit)。
 *
 * P1-1: limit 可为固定值或动态函数 — 动态函数允许按 storage 水位缩放取能上限。
 */
export function withdrawStorageCapped(
  limit: number | ((ac: ActionContext) => number),
): ActionCandidate {
  return {
    name: "withdraw:storage-capped",
    predicate: (ac) => {
      const st = ac.snapshot.storage;
      return st !== undefined && st.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const st = ac.snapshot.storage!;
      const available = st.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const effectiveLimit = typeof limit === "function" ? limit(ac) : limit;
      const amount = Math.min(available, carryFree, effectiveLimit);
      const result = actOrMove(ac.creep, st, () => ac.creep.withdraw(st, RESOURCE_ENERGY, amount));
      if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/** 限量 withdraw（hauler 专用，避免 ERR_NOT_ENOUGH_RESOURCES）。 */
export function withdrawCapped(target: (ac: ActionContext) => StructureContainer | StructureStorage | undefined): ActionCandidate {
  return {
    name: "withdraw:capped",
    predicate: (ac) => {
      const t = target(ac);
      return t !== undefined && t.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const t = target(ac)!;
      const available = t.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      const result = actOrMove(ac.creep, t, () => ac.creep.withdraw(t, RESOURCE_ENERGY, amount));
      if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

// ─── Dump（harvester 站桩倒能）─────────────────────────────

/** 向身边 link 倒能（range <= 2）。 */
export function dumpToNearbyLink(): ActionCandidate {
  return {
    name: "dump:nearby-link",
    predicate: (ac) =>
      ac.snapshot.links.some(
        l => ac.creep.pos.getRangeTo(l) <= 2 && l.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      ),
    execute: (ac) => {
      // 必须与 predicate 使用相同的过滤条件，否则可能选到满 link —
      // transfer 返回 ERR_FULL，creep 站着不动，看起来在"发呆"。
      const candidates = ac.snapshot.links.filter(
        l => ac.creep.pos.getRangeTo(l) <= 2 && l.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      );
      const link = ac.creep.pos.findClosestByRange(candidates as StructureLink[]);
      if (link) actOrMove(ac.creep, link, () => ac.creep.transfer(link, RESOURCE_ENERGY));
    },
  };
}

/** 向身边 container 倒能（range <= 2，站桩 miner）。 */
export function dumpToNearbyContainer(): ActionCandidate {
  return {
    name: "dump:nearby-container",
    predicate: (ac) =>
      ac.snapshot.containers.some(
        c => ac.creep.pos.getRangeTo(c) <= 2 && c.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      ),
    execute: (ac) => {
      // 必须与 predicate 使用相同的过滤条件，否则可能选到满 container。
      const candidates = ac.snapshot.containers.filter(
        c => ac.creep.pos.getRangeTo(c) <= 2 && c.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      );
      const nearby = ac.creep.pos.findClosestByRange(candidates as StructureContainer[]);
      if (nearby) actOrMove(ac.creep, nearby, () => ac.creep.transfer(nearby, RESOURCE_ENERGY));
    },
  };
}

/**
 * 向身边 container 卸载矿物（range <= 2）。
 * 当 harvester 采集了 mineral（非 energy 资源）时，倒入最近 container。
 * 优先级高于 energy dump — 矿物不应占用 carry 空间。
 */
export function dumpMineralsToNearbyContainer(): ActionCandidate {
  return {
    name: "dump:minerals-to-container",
    predicate: (ac) => {
      const hasMinerals = (Object.keys(ac.creep.store) as ResourceConstant[])
        .some(r => r !== RESOURCE_ENERGY && ac.creep.store[r]! > 0);
      if (!hasMinerals) return false;
      // 必须同时检查 range 和 freeCapacity，与 execute 保持一致。
      return ac.snapshot.containers.some(
        c => ac.creep.pos.getRangeTo(c) <= 2 && (c.store.getFreeCapacity() ?? 0) > 0,
      );
    },
    execute: (ac) => {
      const mineral = (Object.keys(ac.creep.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && ac.creep.store[r]! > 0);
      if (!mineral) return;
      // 与 predicate 相同的过滤条件，确保选到的是有容量的 container。
      const candidates = ac.snapshot.containers.filter(
        c => ac.creep.pos.getRangeTo(c) <= 2 && (c.store.getFreeCapacity() ?? 0) > 0,
      );
      const nearby = ac.creep.pos.findClosestByRange(candidates as StructureContainer[]);
      if (nearby) actOrMove(ac.creep, nearby, () => ac.creep.transfer(nearby, mineral));
    },
  };
}

/** 建造身边 container site（range <= 3，经济自愈）。 */
export function buildNearbyContainerSite(): ActionCandidate {
  return {
    name: "build:nearby-container-site",
    predicate: (ac) => {
      if (ac.snapshot.myConstructionSites.length === 0) return false;
      const site = ac.creep.pos.findClosestByRange(
        ac.snapshot.myConstructionSites.filter(s => s.structureType === STRUCTURE_CONTAINER) as ConstructionSite[],
      );
      return site !== null && ac.creep.pos.getRangeTo(site) <= 3;
    },
    execute: (ac) => {
      const site = ac.creep.pos.findClosestByRange(
        ac.snapshot.myConstructionSites.filter(s => s.structureType === STRUCTURE_CONTAINER) as ConstructionSite[],
      )!;
      actOrMove(ac.creep, site, () => ac.creep.build(site));
    },
  };
}

// ─── Fill ───────────────────────────────────────────────────

/** 向 fillTarget 送能（通用，使用 getFillTarget）。
 *
 * 目标持久化：优先复用上一 tick 选定的 fillTarget（creep.memory.fillTargetId），
 * 仅在目标满/消失时重新选择。消除多个等距目标间的摇摆。
 */
export function fillTarget(): ActionCandidate {
  return {
    name: "fill:target",
    predicate: (ac) => getFillTarget(ac.creep, ac.snapshot) !== undefined,
    execute: (ac) => {
      // 优先复用持久化目标 — 验证它仍需填充。
      // fillTargets 类型为 (StructureSpawn | StructureExtension | StructureTower | StructureContainer)，
      // 全部拥有 store 属性，但 getFillTarget 返回 AnyOwnedStructure，需用类型守卫收窄。
      let target: AnyOwnedStructure | undefined;
      if (ac.creep.memory.fillTargetId) {
        const cached = getObjectById(ac.creep.memory.fillTargetId as Id<AnyOwnedStructure>);
        if (cached && "store" in cached && cached.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          target = cached;
        }
      }
      // 无有效缓存目标 — 重新选择。
      if (!target) {
        target = getFillTarget(ac.creep, ac.snapshot);
        if (target) {
          ac.creep.memory.fillTargetId = target.id;
        }
      }
      if (!target) return;
      const result = actOrMove(ac.creep, target, () => ac.creep.transfer(target!, RESOURCE_ENERGY));
      if (result === ERR_FULL) {
        ac.creep.memory.fillTargetId = undefined;
        updateModeLocal(ac);
      }
    },
  };
}

/** Hauler 专用填充（带 reservation 去重 + 优先级）。 */
export function haulFillTarget(): ActionCandidate {
  return {
    name: "fill:haul-target",
    // 纯检查：fillTargets 已包含所有需填充的 spawn/extension/tower/controller container
    // （room-snapshot.ts 按是否有空闲容量过滤）。
    // 严禁添加 `|| controllerContainer !== undefined` — controllerContainer 存在不等于需要填充。
    // 该条件会导致 predicate 返回 true 而 execute 内 getHaulFillTarget 返回 undefined，
    // FSM 在此 return 不再 fallthrough，hauler 永远无法到达 fillStorage() — storage 空置死锁。
    predicate: (ac) => ac.snapshot.fillTargets.length > 0,
    execute: (ac) => {
      const target = getHaulFillTarget(ac.creep, ac.snapshot);
      if (!target) return;
      const result = actOrMove(ac.creep, target, () => ac.creep.transfer(target, RESOURCE_ENERGY));
      if (result === ERR_FULL) updateModeLocal(ac);
    },
  };
}

/** 向最空 container 倒能。 */
export function fillEmptiestContainer(): ActionCandidate {
  return {
    name: "fill:emptiest-container",
    predicate: (ac) => {
      if (ac.snapshot.containers.length === 0) return false;
      const best = findEmptiestContainer(ac.snapshot.containers);
      return best !== undefined && best.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      const best = findEmptiestContainer(ac.snapshot.containers)!;
      actOrMove(ac.creep, best, () => ac.creep.transfer(best, RESOURCE_ENERGY));
    },
  };
}

/** 向 storage 送能。
 *
 * RCL4+ 有 storage 时，这是 hauler 的首选 sink（优先于 haulFillTarget）。
 * 设计意图：hauler 负责 container → storage（收集），distributor 负责 storage → spawn/extension（分发）。
 * storage 空闲时优先填充，建立中央能量储备；storage 满后 fallthrough 到 haulFillTarget。
 */
export function fillStorage(): ActionCandidate {
  return {
    name: "fill:storage",
    predicate: (ac) => {
      if (!ac.snapshot.storage) return false;
      // storage 有空闲容量时才送 — 满了则 fallthrough 到 haulFillTarget
      return ac.snapshot.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    },
    execute: (ac) => {
      actOrMove(ac.creep, ac.snapshot.storage!, () => ac.creep.transfer(ac.snapshot.storage!, RESOURCE_ENERGY));
    },
  };
}

// ─── Build ──────────────────────────────────────────────────

/** 建造 assignment 指定的 site。 */
export function buildAssignmentSite(): ActionCandidate {
  return {
    name: "build:assignment-site",
    predicate: (ac) => {
      if (!ac.assignment?.targetId) return false;
      return getObjectById(ac.assignment.targetId as Id<ConstructionSite>) !== null;
    },
    execute: (ac) => {
      const site = getObjectById(ac.assignment!.targetId as Id<ConstructionSite>)!;
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
    predicate: (ac) => {
      const sites = criticalOnly
        ? ac.snapshot.myConstructionSites.filter(isCriticalSite)
        : ac.snapshot.myConstructionSites;
      return sites.length > 0;
    },
    execute: (ac) => {
      const sites = criticalOnly
        ? ac.snapshot.myConstructionSites.filter(isCriticalSite)
        : ac.snapshot.myConstructionSites;

      // 优先复用持久化目标 — 验证它仍在当前候选列表中。
      let site: ConstructionSite | null = null;
      if (ac.creep.memory.targetId) {
        const cached = getObjectById(ac.creep.memory.targetId as Id<ConstructionSite>);
        if (cached && sites.some(s => s.id === cached.id)) {
          site = cached;
        }
      }

      // 无有效缓存目标 — 重新选择最近的。
      if (!site) {
        site = ac.creep.pos.findClosestByRange(sites as ConstructionSite[]);
        if (site) {
          ac.creep.memory.targetId = site.id as Id<ConstructionSite>;
        }
      }

      if (site) {
        const result = actOrMove(ac.creep, site, () => ac.creep.build(site));
        if (result === ERR_INVALID_TARGET) {
          ac.creep.memory.targetId = undefined;
        }
      }
    },
  };
}

// ─── Repair ─────────────────────────────────────────────────

/** 修复 critical 结构（血量 < 50%）。findCriticalRepair 优先使用快照预计算值。 */
export function repairCritical(): ActionCandidate {
  return {
    name: "repair:critical",
    // findCriticalRepair 内部优先读 snapshot.criticalRepairTarget（O(1)），
    // 仅在快照未预计算时回退到实时遍历（向后兼容测试 mock）。
    predicate: (ac) => findCriticalRepair(ac.snapshot) !== undefined,
    execute: (ac) => {
      const target = findCriticalRepair(ac.snapshot);
      if (target) actOrMove(ac.creep, target, () => ac.creep.repair(target));
    },
  };
}

/**
 * 修复衰减中的 container（血量 < 80%）。
 * Container 每 tick 衰减 ~5000 hits，不修就会在 ~50 tick 内从 80% 降到 0 被摧毁。
 * 失去 source container = 物流链断裂 = 经济崩溃，因此阈值设得比 repairCritical (50%) 更激进。
 *
 * 目标持久化：优先复用上一 tick 选定的 container（creep.memory.repairTargetId），
 * 仅在目标修好/消失时重新选择。消除多个衰减 container 间的摇摆。
 */
export function repairContainerDecay(): ActionCandidate {
  return {
    name: "repair:container-decay",
    predicate: (ac) => {
      return ac.snapshot.containers.some(c => c.hits < c.hitsMax * 0.8);
    },
    execute: (ac) => {
      // 优先复用持久化目标 — 验证它仍需修复。
      let worst: StructureContainer | undefined;
      if (ac.creep.memory.repairTargetId) {
        const cached = getObjectById(ac.creep.memory.repairTargetId as Id<StructureContainer>);
        if (cached && (cached as StructureContainer).hits < (cached as StructureContainer).hitsMax * 0.8) {
          worst = cached as StructureContainer;
        }
      }
      // 无有效缓存目标 — 修血量最低的 container。
      if (!worst) {
        let worstRatio = 1;
        for (const c of ac.snapshot.containers) {
          const ratio = c.hits / c.hitsMax;
          if (ratio < 0.8 && ratio < worstRatio) {
            worstRatio = ratio;
            worst = c;
          }
        }
        if (worst) {
          ac.creep.memory.repairTargetId = worst.id as Id<StructureContainer>;
        }
      }
      if (worst) {
        const result = ac.creep.repair(worst);
        if (result === ERR_NOT_IN_RANGE) {
          moveToTarget(ac.creep, worst);
        } else if (result === ERR_INVALID_TARGET) {
          ac.creep.memory.repairTargetId = undefined;
        }
      }
    },
  };
}

/**
 * 修复身边的 container（range <= 2，血量 < 80%）。
 * Harvester 站桩专用：你正站在 container 旁边，它快塌了，先修再倒。
 * 比 repairContainerDecay 更紧急 — 只修身边的，不需要跑远路。
 */
export function repairNearbyContainer(): ActionCandidate {
  return {
    name: "repair:nearby-container",
    predicate: (ac) =>
      ac.snapshot.containers.some(
        c => ac.creep.pos.getRangeTo(c) <= 2 && c.hits < c.hitsMax * 0.8,
      ),
    execute: (ac) => {
      // 必须与 predicate 使用相同的过滤条件，否则可能选到健康 container —
      // repair 返回 OK 但修复 0 hits，creep 看起来在"工作"但实际浪费 tick。
      const candidates = ac.snapshot.containers.filter(
        c => ac.creep.pos.getRangeTo(c) <= 2 && c.hits < c.hitsMax * 0.8,
      );
      const nearby = ac.creep.pos.findClosestByRange(candidates as StructureContainer[]);
      if (nearby) actOrMove(ac.creep, nearby, () => ac.creep.repair(nearby));
    },
  };
}

// ─── Fortification Repair（防御工事维修）─────────────────────

/**
 * 修复 wall/rampart 到 RCL 分级目标血量（B3：维修权从塔移交给 creep）。
 *
 * 老玩家认知：塔修墙是能量黑洞（10 能量/次 + 距离衰减 + 与开火争弹药），
 * creep 维修是 1 energy/100 hits/WORK —— 日常工事维护必须由 builder 承担。
 *
 * 门禁（全部满足才启用， predicate 内判断）：
 *   - tier 非 recovery/conserve（低 CPU 不修墙）；
 *   - 无威胁 creep（入侵期间修墙是白送能量，优先开火/保命）；
 *   - 有 storage 且能量 ≥ sustainedStorage（真盈余才修，早期不堆 rampart）。
 */
export function repairFortifications(): ActionCandidate {
  return {
    name: "repair:fortifications",
    predicate: (ac) => {
      if (ac.budget.tier === "recovery" || ac.budget.tier === "conserve") return false;
      if (ac.snapshot.threatCreeps.length > 0) return false;
      const storage = ac.snapshot.storage;
      if (!storage) return false;
      if (storage.store.getUsedCapacity(RESOURCE_ENERGY) < CONFIG.economy.upgrade.sustainedStorage) {
        return false;
      }
      return findFortificationTarget(ac.snapshot) !== undefined;
    },
    execute: (ac) => {
      const targetHits = getWallTargetHits(ac.snapshot.rcl);

      // 优先复用持久化目标 — 验证它仍是墙/城防且仍需修复。
      let target: StructureWall | StructureRampart | undefined;
      if (ac.creep.memory.repairTargetId) {
        const cached = getObjectById(ac.creep.memory.repairTargetId as Id<StructureWall | StructureRampart>);
        if (cached) {
          const s = cached as StructureWall | StructureRampart;
          if ((s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART)
            && s.hits < targetHits) {
            target = s;
          }
        }
      }

      // 无有效缓存目标 — 重新扫描最低血量的墙/城防。
      if (!target) {
        target = findFortificationTarget(ac.snapshot);
        if (target) {
          ac.creep.memory.repairTargetId = target.id as Id<StructureWall | StructureRampart>;
        }
      }

      if (target) {
        const result = ac.creep.repair(target);
        if (result === ERR_NOT_IN_RANGE) {
          moveToTarget(ac.creep, target);
        } else if (result === ERR_INVALID_TARGET) {
          ac.creep.memory.repairTargetId = undefined;
        }
      }
    },
  };
}

/** 查找血量最低且低于 RCL 分级目标血量的 wall/rampart。 */
function findFortificationTarget(
  snapshot: RoomSnapshot,
): StructureWall | StructureRampart | undefined {
  const targetHits = getWallTargetHits(snapshot.rcl);
  let best: StructureWall | StructureRampart | undefined;
  let bestHits = Infinity;
  for (const wall of snapshot.walls) {
    if (wall.hits < targetHits && wall.hits < bestHits) {
      bestHits = wall.hits;
      best = wall;
    }
  }
  for (const rampart of snapshot.ramparts) {
    if (rampart.hits < targetHits && rampart.hits < bestHits) {
      bestHits = rampart.hits;
      best = rampart;
    }
  }
  return best;
}

// ─── Upgrade ────────────────────────────────────────────────

/** 升级控制器（无能量门禁）。 */
export function upgradeController(): ActionCandidate {
  return {
    name: "upgrade:controller",
    predicate: (ac) => ac.snapshot.controller !== undefined && ac.snapshot.controller.my,
    execute: (ac) => {
      actOrMove(ac.creep, ac.snapshot.controller!, () => ac.creep.upgradeController(ac.snapshot.controller!));
    },
  };
}

/** 升级控制器（带能量门禁：energyAvailable >= floor）。 */
export function upgradeControllerGated(): ActionCandidate {
  return {
    name: "upgrade:controller-gated",
    predicate: (ac) =>
      ac.snapshot.controller !== undefined &&
      ac.snapshot.controller.my &&
      ac.snapshot.energyAvailable >= CONFIG.economy.upgradeEnergyFloor,
    execute: (ac) => {
      actOrMove(ac.creep, ac.snapshot.controller!, () => ac.creep.upgradeController(ac.snapshot.controller!));
    },
  };
}

// ─── Industry（矿物/化合物搬运）─────────────────────────────

/**
 * 从 extractor 旁 container 搬运矿物到 storage/terminal。
 * 触发条件：container 中有非 energy 资源。
 */
export function haulMineralsToStorage(): ActionCandidate {
  return {
    name: "haul:minerals-to-storage",
    predicate: (ac) => {
      if (!ac.snapshot.storage && !ac.snapshot.terminal) return false;
      // 找到含有非 energy 资源的 container（extractor 旁的）
      return ac.snapshot.containers.some(c => {
        for (const res of Object.keys(c.store) as ResourceConstant[]) {
          if (res !== RESOURCE_ENERGY && c.store[res]! > 0) return true;
        }
        return false;
      });
    },
    execute: (ac) => {
      // 找含矿物的 container
      const source = ac.snapshot.containers.find(c => {
        for (const res of Object.keys(c.store) as ResourceConstant[]) {
          if (res !== RESOURCE_ENERGY && c.store[res]! > 0) return true;
        }
        return false;
      });
      if (!source) return;

      // 如果 creep  carrying 非 energy 资源，送到 storage/terminal
      const carriedMineral = (Object.keys(ac.creep.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && ac.creep.store[r]! > 0);

      if (carriedMineral) {
        const dest = ac.snapshot.terminal ?? ac.snapshot.storage;
        if (dest) {
          actOrMove(ac.creep, dest, () => ac.creep.transfer(dest, carriedMineral));
        }
      } else {
        // 从 container 取矿物
        const mineral = (Object.keys(source.store) as ResourceConstant[])
          .find(r => r !== RESOURCE_ENERGY && source.store[r]! > 0);
        if (mineral) {
          actOrMove(ac.creep, source, () => ac.creep.withdraw(source, mineral));
        }
      }
    },
  };
}

/**
 * 从 storage 搬运化合物到 lab（供料）。
 * 触发条件：lab 中有空位且 storage 有对应化合物。
 * 简化实现：搬运 lab 中缺少的资源。
 */
export function supplyLabs(): ActionCandidate {
  return {
    name: "haul:supply-labs",
    predicate: (ac) => {
      if (ac.snapshot.labs.length === 0) return false;
      if (!ac.snapshot.storage) return false;
      // 检查是否有 lab 需要供料（有空闲容量且 storage 有非 energy 资源）
      const hasLabSpace = ac.snapshot.labs.some(l => (l.store.getFreeCapacity() ?? 0) > 0);
      const hasCompounds = (Object.keys(ac.snapshot.storage.store) as ResourceConstant[])
        .some(r => r !== RESOURCE_ENERGY && ac.snapshot.storage!.store[r]! > 0);
      return hasLabSpace && hasCompounds;
    },
    execute: (ac) => {
      const storage = ac.snapshot.storage!;

      // 如果 creep 正在 carrying 化合物，送到 lab
      const carriedCompound = (Object.keys(ac.creep.store) as ResourceConstant[])
        .find(r => r !== RESOURCE_ENERGY && ac.creep.store[r]! > 0);

      if (carriedCompound) {
        // 找到有空闲容量的 lab
        const targetLab = ac.snapshot.labs.find(l => (l.store.getFreeCapacity() ?? 0) > 0);
        if (targetLab) {
          actOrMove(ac.creep, targetLab, () => ac.creep.transfer(targetLab, carriedCompound));
        }
      } else {
        // 从 storage 取化合物
        const compound = (Object.keys(storage.store) as ResourceConstant[])
          .find(r => r !== RESOURCE_ENERGY && storage.store[r]! > 0);
        if (compound) {
          actOrMove(ac.creep, storage, () => ac.creep.withdraw(storage, compound));
        }
      }
    },
  };
}

// ─── 内部辅助 ───────────────────────────────────────────────

function isCriticalSite(site: ConstructionSite): boolean {
  return site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER;
}

/** 局部 updateMode — 用于 ERR_FULL 后重新评估。 */
function updateModeLocal(ac: ActionContext): void {
  const used = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY);
  if (used === 0) ac.creep.memory.mode = "acquire";
}
