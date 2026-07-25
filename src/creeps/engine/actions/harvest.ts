/**
 * Harvest actions — 从 source / mineral 采集。
 */
import type { ActionCandidate, ActionContext } from "../action-types";
import { moveToTarget } from "../../movement";
import { actOrMove } from "./helpers";
import { getSource } from "../../support/targeting";

/**
 * 从 source 采集（通用）。
 *
 * resolve 检查 source.energy > 0：source 再生期间（energy === 0）不触发采集，
 * 避免 harvest → ERR_NOT_ENOUGH_RESOURCES → mode=idle 的无限振荡。
 * source 空时角色 fallthrough 到后续候选或 idle+park（离开矿位不堵路）。
 *
 * execute 中 ERR_NOT_ENOUGH_RESOURCES 不再设 idle：resolve 已过滤空 source，
 * 此处仅为跨 tick 竞态（resolve 通过后 source 被其他 creep 采空）。
 * 竞态是瞬时的，保持 acquire 模式下 tick 自动重试比切 idle 更快恢复。
 */
export function harvestSource(): ActionCandidate {
  return {
    name: "harvest:source",
    resolve: (ac) => {
      const source = getSource(ac.creep, ac.snapshot);
      if (!source || source.energy === 0) return undefined;
      return source;
    },
    execute: (ac, target) => {
      const source = target as Source;
      actOrMove(ac.creep, source, () => ac.creep.harvest(source));
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
 * 无 sink（早期无 container）时 resolve=undefined，回退到通用 harvestSource。
 *
 * 该动作同时置于 harvester 的 acquire[0] 与 work[0]：
 *   - 无论 FSM 处于哪个 mode 都执行，绕开「单 tick 只跑一条链」的限制；
 *   - 作为 work[0] 拦截站桩矿工，使其永不落到 fill/build/upgrade 而离岗（P2-7）。
 */
export function stationaryMine(): ActionCandidate {
  return {
    name: "harvest:stationary-mine",
    resolve: (ac) => {
      const source = getSource(ac.creep, ac.snapshot);
      if (!source) return undefined;
      const container = sourceAdjacentContainer(ac, source);
      const link = sourceAdjacentLink(ac, source);
      if (!container && !link) return undefined;
      return { source, container, link };
    },
    execute: (ac, target) => {
      const { source, container, link } = target as {
        source: Source;
        container: StructureContainer | undefined;
        link: StructureLink | undefined;
      };
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
    resolve: (ac) => {
      if (!ac.snapshot.extractor) return undefined;
      if (ac.snapshot.minerals.length === 0) return undefined;
      const mineral = ac.snapshot.minerals[0]!;
      if (mineral.mineralAmount <= 0 || ac.creep.store.getFreeCapacity() <= 0) return undefined;
      return mineral;
    },
    execute: (ac, target) => {
      const mineral = target as Mineral;
      const result = actOrMove(ac.creep, mineral, () => ac.creep.harvest(mineral));
      if (result === ERR_NOT_ENOUGH_RESOURCES || result === ERR_TIRED) {
        // mineral 耗尽或冷却中 — 回 idle
        ac.creep.memory.mode = "idle";
      }
    },
  };
}
