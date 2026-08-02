/**
 * Harvest actions — 从 source / mineral 采集。
 */
import type { ActionCandidate, ActionContext } from "../action-types";
import { CONFIG } from "../../../config";
import { moveToTarget, registerAnchor } from "../../movement";
import { runAction } from "./helpers";
import { getSource } from "../../support/targeting";
import { classifyLinkRole, computeControllerLinkTarget } from "../../../domain/economy/links";

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
export function harvestSource(): ActionCandidate<Source> {
  return {
    name: "harvest:source",
    resolve: (ac) => {
      const source = getSource(ac.creep, ac.snapshot);
      if (!source || source.energy === 0) return undefined;
      return source;
    },
    execute: (ac, source) => {
      runAction(ac.creep, source, () => ac.creep.harvest(source));
    },
  };
}

/** stationaryMine 的 resolve 返回类型。 */
interface StationaryMineTarget {
  source: Source;
  container: StructureContainer | undefined;
  link: StructureLink | undefined;
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
export function stationaryMine(): ActionCandidate<StationaryMineTarget> {
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
      const { source, container, link } = target;
      // 2026-08-01 健壮性：source link 只在有下游出口时可灌——
      // storage link 存在（能量瞬移进 hub，hauler 排空）或 controller link
      // 按需求驱动目标仍有需求（RCL<8 升级 / RCL8 保级）。
      // 无出口（RCL8 停供 + 无 storage link / storage link 被毁）时灌 link
      // 只会积压 → container 满 → drop 衰减损失（rcl8-endgame 5000t 回归实证）。
      const linkUsable = link !== undefined && linkHasOutlet(ac, link);
      // 站位选择：默认站 container 之上（range 0 倒能）或 source 旁。
      // 特例——source link 与 container 分居 source 两侧、站 container 够不到 link（range>1）时：
      // 改站到「贴 source 且贴 link（均 range<=1）」的格，让 harvester 同 tick 倒进 link，
      // 能量经 link 网络瞬移入库/入 controller link，免去远距离 hauler 往返（source#1 病灶）。
      const linkStand = linkUsable
        && ac.creep.pos.getRangeTo(link.pos) > 1
        && !(container && container.pos.getRangeTo(link.pos) <= 1)
        ? findSourceLinkStand(ac, source, link)
        : undefined;
      const standTarget: RoomPosition | { pos: RoomPosition } = linkStand ?? container ?? source;

      // 已在矿位 → 登记高优先级锚：站桩矿工让出矿位 = 采集吞吐崩塌，
      // 集中解算时拒绝被低优先级移动方推挤（若本 tick 又登记了移动意图，锚自动失效）。
      if (ac.creep.pos.getRangeTo(source) <= 1) {
        registerAnchor(ac.creep, CONFIG.movement.trafficPriority.anchorMiner);
      }

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
      // 已在采集范围。若选定了 link 站位而尚未站上去，同 tick 移动过去 ——
      // harvest 与 move 是独立 intent，重定位期间照常采集，零吞吐损失；
      // 到位后（range 1 到 source 且 range 1 到 link）即开始同 tick 倒进 link。
      if (linkStand && (ac.creep.pos.x !== linkStand.x || ac.creep.pos.y !== linkStand.y)) {
        moveToTarget(ac.creep, linkStand);
      }
      // 同 tick 倒能：link 优先，其次 container（均需 range<=1 且有空位）。
      if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        const sink = linkUsable
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

/**
 * source link 是否有可用的下游出口（2026-08-02 死锁修复）。
 *
 * 判定（与 link-system 的传输计划同口径）：
 *   - storage link 存在 → true（能量瞬移进 hub，hauler 排空最后一公里）
 *   - 否则 controller link 存在且 computeControllerLinkTarget > 0
 *     （RCL<8 有升级需求，或 RCL8 有降级风险）→ true
 *     即使 controller link 暂时充满也返回 true：upgrader 会持续消耗，
 *     harvester 应持续向 source link 倒能避免"controller link 满 → 停倒 →
 *     source link 空 → 无法补给 controller link"的死锁。
 *   - 否则 false：link 是死资产（RCL8 停供 + 无 storage link），harvester
 *     应灌 container 走 hauler 物流，避免 link 积压 → container 满 → drop 衰减。
 */
function linkHasOutlet(ac: ActionContext, link: StructureLink): boolean {
  const snap = ac.snapshot;
  if (snap.storage) {
    const storageLink = snap.links.find(
      l => l.id !== link.id && l.pos.getRangeTo(snap.storage!) <= 2,
    );
    if (storageLink) return true;
  }
  const ctrl = snap.controller;
  if (!ctrl || !ctrl.my) return false;
  const ctrlLink = snap.links.find(
    l => l.id !== link.id && l.pos.getRangeTo(ctrl.pos) <= 2,
  );
  if (!ctrlLink) return false;
  const target = computeControllerLinkTarget(
    snap.rcl,
    ctrl,
    snap.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    ctrlLink.store.getCapacity(RESOURCE_ENERGY),
  );
  // target=0 表示 RCL8 满级且无降级风险 → controller link 不需要能量 → 死资产
  // target>0 且 controller link 有空闲容量 → true：link-system 可传走能量，harvester
  //   应持续向 source link 倒能。这修复了 target 低（如 320）时 controller link 在
  //   target~capacity 之间 OLD 代码误判 false 导致的"停倒 → source link 空 →
  //   controller link 耗尽后无法补给"死锁。
  // controller link 完全满（freeCapacity=0）→ false：link-system 无处可传，harvester
  //   应灌 container 走 hauler 物流，避免能量卡死在 source link（rcl5-links 回归实证）。
  return target > 0 && ctrlLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
}

/**
 * 找一个「贴 source 且贴 link（均 range<=1）」的可站格，供 harvester 开 link 挖矿。
 *
 * 背景：当 source container 与 source link 分居 source 两侧时，站 container 上够不到 link，
 * harvester 只能灌 container → 满仓 → 靠 hauler 远搬。改站到同时贴 source 与 link 的格后，
 * harvester 可同 tick 倒进 link，能量瞬移入库、免远搬。
 * 扫 source 八邻域：非墙 + 距 link range<=1 + 非 link 本格 + 无阻挡结构 → 首个命中即返回。
 * 找不到（几何无解）返回 undefined，调用方回退 container 站位。
 */
function findSourceLinkStand(ac: ActionContext, source: Source, link: StructureLink): RoomPosition | undefined {
  // 防御：无 getTerrain（异常上下文）时放弃 link 站位、回退 container，不抛错。
  if (typeof ac.creep.room.getTerrain !== "function") return undefined;
  const terrain = ac.creep.room.getTerrain();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = source.pos.x + dx;
      const y = source.pos.y + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (x === link.pos.x && y === link.pos.y) continue; // link 本格不可站
      if (Math.max(Math.abs(x - link.pos.x), Math.abs(y - link.pos.y)) > 1) continue; // 须够到 link
      if (tileHasObstacleStructure(ac, x, y)) continue; // 跳过被障碍结构占用的格
      return new RoomPosition(x, y, ac.creep.room.name);
    }
  }
  return undefined;
}

/** (x,y) 是否被障碍型结构占用（container/road/rampart 可站，其余结构阻挡）。 */
function tileHasObstacleStructure(ac: ActionContext, x: number, y: number): boolean {
  const s = ac.snapshot;
  for (const list of [s.spawns, s.extensions, s.towers, s.links, s.labs]) {
    for (const st of list) if (st.pos.x === x && st.pos.y === y) return true;
  }
  for (const single of [s.storage, s.terminal, s.factory, s.observer, s.powerSpawn]) {
    if (single && single.pos.x === x && single.pos.y === y) return true;
  }
  return false;
}

/** 找到与 source 相邻（range<=1）的 container（站桩倒能点）。 */
function sourceAdjacentContainer(ac: ActionContext, source: Source): StructureContainer | undefined {
  return ac.snapshot.containers.find(c => c.pos.getRangeTo(source.pos) <= 1);
}

/** 找到本 source 的 source link（RCL5+）。
 *
 * 放宽到 range≤anchorRange(2) 且要求该 link 的角色为 source（classifyLinkRole 判定，
 * 与 link-system 分类同源）：让「container 隔在 source 与 link 之间」的几何（link 距
 * source range2、harvester 站 container 上仍 range1 够到 link）也能开 link 挖矿；只认
 * role===source 绝不误灌 controller/storage link。够不到时由灌能 range≤1 守卫回退 container。 */
function sourceAdjacentLink(ac: ActionContext, source: Source): StructureLink | undefined {
  const range = CONFIG.economy.link.anchorRange;
  const sourcePts = ac.snapshot.sources.map(s => s.pos);
  const ctrlPt = ac.snapshot.controller?.pos;
  const storagePt = ac.snapshot.storage?.pos;
  return ac.snapshot.links.find(
    l => l.pos.getRangeTo(source.pos) <= range
      && classifyLinkRole(l.pos, sourcePts, ctrlPt, storagePt, range) === "source",
  );
}

/** harvestMineral 的 resolve 返回类型。 */
interface MineralTarget {
  mineral: Mineral;
}

/**
 * 从 mineral 采集（需要 extractor）。
 * 触发条件：房间有 extractor + mineral 有储量 + creep 有 carry 空间。
 * 用于 source 再生期间的空闲利用（RCL6+）。
 */
export function harvestMineral(): ActionCandidate<MineralTarget> {
  return {
    name: "harvest:mineral",
    resolve: (ac) => {
      if (!ac.snapshot.extractor) return undefined;
      if (ac.snapshot.minerals.length === 0) return undefined;
      const mineral = ac.snapshot.minerals[0]!;
      if (mineral.mineralAmount <= 0 || ac.creep.store.getFreeCapacity() <= 0) return undefined;
      return { mineral };
    },
    execute: (ac, target) => {
      const { mineral } = target;
      // 站位：mineral 旁 range<=1 有 container 时以 container 为通勤终点 —— 站到
      // container 之上后 range0 倒矿 + range1 采矿，零穿梭；否则站 mineral 旁。
      // 镜像 harvester.stationaryMine 的 container 站位，防"采(贴矿)↔倒(贴容器)"来回走格。
      const container = ac.snapshot.containers.find(c => c.pos.getRangeTo(mineral.pos) <= 1);
      const standTarget: RoomPosition | { pos: RoomPosition } = container ?? mineral;
      runAction(ac.creep, standTarget, () => ac.creep.harvest(mineral), {
        [ERR_NOT_ENOUGH_RESOURCES]: () => { ac.creep.memory.mode = "idle"; },
        [ERR_TIRED]: () => { ac.creep.memory.mode = "idle"; },
      });
    },
  };
}
