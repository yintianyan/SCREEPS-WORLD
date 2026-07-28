import type { RoomSnapshot } from "../../kernel/contracts";
import { CONFIG } from "../../config";
import { globalCache } from "../../kernel/global-cache";
import { getObjectById } from "./obj-cache";

/** 获取或分配 creep 的 source。将 sourceId 存入 memory。 */
export function getSource(creep: Creep, snapshot: RoomSnapshot): Source | undefined {
  // 先尝试缓存的 source。
  if (creep.memory.sourceId) {
    const source = getObjectById(creep.memory.sourceId);
    if (source) {
      // 拥挤检测：如果当前 source 占用超过公平份额，且存在更空闲的 source，则重分配。
      // 公平份额 = ceil(总占用 / source 数量)。例如 2 harvester + 2 source → 每个最多 1。
      if (snapshot.sources.length > 1) {
        const myCount = snapshot.sourceOccupancy.get(source.id) ?? 0;
        let totalOccupancy = 0;
        let minCount = Infinity;
        for (const s of snapshot.sources) {
          const c = snapshot.sourceOccupancy.get(s.id) ?? 0;
          totalOccupancy += c;
          if (c < minCount) minCount = c;
        }
        const fairShare = Math.ceil(totalOccupancy / snapshot.sources.length);
        // 当前 source 超过公平份额 且 存在更空闲的 source → 迁移。
        if (myCount > fairShare && minCount < myCount) {
          creep.memory.sourceId = undefined;
          // 落入下方重分配逻辑。
        } else {
          return source;
        }
      } else {
        return source;
      }
    } else {
      // source 消失 — 清除并重新分配。
      creep.memory.sourceId = undefined;
    }
  }

  // 使用快照数据分配占用最少的 source（无需全局扫描）。
  let best: Source | undefined;
  let bestCount = Infinity;
  for (const source of snapshot.sources) {
    const count = snapshot.sourceOccupancy.get(source.id) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      best = source;
    }
  }

  if (best) {
    creep.memory.sourceId = best.id;
  }
  return best;
}

/**
 * 查找最近的需能量结构（有空闲容量的 spawn 或 extension）。
 * 使用引擎原生 findClosestByRange 替代手动迭代。
 */
export function getFillTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
): AnyOwnedStructure | undefined {
  if (snapshot.fillTargets.length === 0) return undefined;
  return creep.pos.findClosestByRange(snapshot.fillTargets as AnyOwnedStructure[]) ?? undefined;
}

/** 可被 hauler 填充的结构类型。 */
export type FillTarget = StructureSpawn | StructureExtension | StructureTower | StructureContainer;

/**
 * Hauler 填充目标的优先级层级（threat 感知）。
 *
 * 返回有序的类型桶 — 调用者按序遍历，第一个有匹配的桶中取最近目标。
 * threat 存在时 tower 提升到最高优先（防御弹药是生存关键）。
 * 末尾空桶匹配所有剩余类型（回退兜底）。
 *
 * 注意：controller container 的特殊优先级（< 半满时插队）
 * 由 getHaulFillTarget 在调用此函数之前自行处理，不包含在此通用层级中 —
 * flee 场景不需要补给 controller container（非生存关键）。
 */
export function haulerFillTiers(
  hasThreats: boolean,
): readonly (readonly string[])[] {
  return hasThreats
    ? [[STRUCTURE_TOWER], [STRUCTURE_SPAWN, STRUCTURE_EXTENSION], []]
    : [[STRUCTURE_SPAWN, STRUCTURE_EXTENSION], [STRUCTURE_TOWER], []];
}

/** 在 targets 中找最近的「未预约」目标；给定 types 时仅在这些结构类型中挑选。 */
function pickFillTarget(
  creep: Creep,
  targets: readonly FillTarget[],
  reserved: Set<string>,
  types?: readonly string[],
): FillTarget | undefined {
  const pool = targets.filter(
    s => !reserved.has(s.id) && (types === undefined || types.includes(s.structureType)),
  );
  if (pool.length === 0) return undefined;
  return creep.pos.findClosestByRange(pool) ?? undefined;
}

/**
 * Hauler 专用的填充目标选择 — 带优先级与每 tick 预约去重。
 *
 * 老玩家填充优先级：
 *   0. controller container 低于半满时优先补 1 个 hauler（站桩升级供能核心，远离核心区易饿死）。
 *   1. spawn / extension —— 孵化引擎，断能即停产，最高优先。
 *   2. tower —— 防御/维修，次之。
 *   3. 其余（如非紧急的 controller container）。
 * 同级取最近未预约者；预约集合按 tick 惰性重置，避免多 hauler 抢同一目标互相堵位。
 * 所有目标都被预约时回退到最近目标（允许共享），避免死锁。
 */
export function getHaulFillTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
): AnyOwnedStructure | undefined {
  if (snapshot.fillTargets.length === 0) return undefined;

  const g = globalCache();
  if (!g.fillReservations || g.fillReservationTick !== Game.time) {
    g.fillReservations = new Set();
    g.fillReservationTick = Game.time;
  }
  const reserved = g.fillReservations;

  const hasThreats = snapshot.threatCreeps.length > 0;

  // P1-3: 威胁存在时 tower 提升到最高优先级 — 防御弹药是生存关键。
  // tower 每次攻击消耗 10 能量，hauler 必须在威胁期间优先补给 tower 保持防御火力。
  if (hasThreats) {
    const tower = pickFillTarget(creep, snapshot.fillTargets, reserved, [STRUCTURE_TOWER]);
    if (tower) {
      reserved.add(tower.id);
      return tower as unknown as AnyOwnedStructure;
    }
  }

  // 0. 站桩升级保障：controller container 低于半满时优先派一个 hauler 补给。
  const cc = snapshot.controllerContainer;
  if (
    cc &&
    cc.store.getFreeCapacity(RESOURCE_ENERGY) > cc.store.getUsedCapacity(RESOURCE_ENERGY) &&
    !reserved.has(cc.id)
  ) {
    reserved.add(cc.id);
    return cc as unknown as AnyOwnedStructure;
  }

  // 1→2→3 按 haulerFillTiers 优先级层级遍历（与 flee 逻辑共享同一层级定义）。
  // threat 时首个 [TOWER] 层级已在上方处理，此处为冗余遍历但无副作用 —
  // 已预留的 tower 会被 pickFillTarget 的 reserved 过滤排除。
  for (const types of haulerFillTiers(hasThreats)) {
    const target = pickFillTarget(
      creep,
      snapshot.fillTargets,
      reserved,
      types.length > 0 ? types : undefined,
    );
    if (target) {
      reserved.add(target.id);
      return target as unknown as AnyOwnedStructure;
    }
  }

  // 全部已预约 — 回退最近目标（允许共享）避免死锁。
  return (creep.pos.findClosestByRange(snapshot.fillTargets as FillTarget[]) ?? undefined) as
    | AnyOwnedStructure
    | undefined;
}

/**
 * Distributor 水位分级档位。
 *
 * 由 distributor gate 每 tick 根据 storage 水位计算并写入 creep.memory.distributorTier。
 * getDistributorFillTarget 读取该值过滤目标类型，withdrawStorageForDistribution 读取该值限制取能量。
 *
 * 档位定义（阈值见 CONFIG.economy.distributorTiers，绝对能量值）：
 *   0 — 库存 ≥ full(50k)：满载取能，所有 fillTarget 正常服务
 *   1 — 库存 ≥ sustained(10k)：满载取能，仅服务 spawn/extension（跳过 tower）
 *   2 — 库存 ≥ low(2k)：限取 400/tick，仅服务 spawn/extension
 *   3 — 库存 < low(2k)：限取 200/tick，仅服务 spawn/extension
 *
 * spawn 与 extension 在所有档位都同池服务：extension 里的能量只能被
 * spawnCreep 消费，与 spawn 本体同属孵化能量池 — 把能量从 storage 挪到
 * extension 不是消耗，只是换口袋。曾经 tier 3 排除 extension，导致
 * energyAvailable 被锁死在 spawn 容量上限 → 成本超限的 body 永不孵化 →
 * 采集编制萎缩 → storage 持续低水位 → tier 3 永续的自锁吸收态。
 * 低水位的真正节流手段是取能限额（200/tick），不是目标类型裁剪。
 */
export type DistributorTier = 0 | 1 | 2 | 3;

/**
 * 根据 storage 库存的**绝对能量值**计算 distributor 调度档位。
 *
 * 刻度口径（曾经的教训）：不能用 energy/capacity 比例 — storage 总容量
 * 1,000,000，比例 10% = 10 万能量，发展期房间（库存数百到数万）永久卡在
 * 最低档，extension 长期断供。绝对阈值来自
 * CONFIG.economy.distributorTiers，与 upgrade 调度（sprintStorage/
 * sustainedStorage）同一参照系。
 *
 * 边界不加迟滞：tier 只影响单车取量与目标类型，抖动代价小
 * （不像 colonyState 有全房爆炸半径），不值得引入驻留状态。
 * 无 storage 时返回 0（不限制）。
 */
export function computeDistributorTier(storage: StructureStorage | undefined): DistributorTier {
  if (!storage) return 0;
  const energy = storage.store.getUsedCapacity(RESOURCE_ENERGY);
  const tiers = CONFIG.economy.distributorTiers;
  if (energy >= tiers.full) return 0;
  if (energy >= tiers.sustained) return 1;
  if (energy >= tiers.low) return 2;
  return 3;
}

/**
 * Distributor 专用的填充目标选择 — 与 hauler 的 getHaulFillTarget 职责分离。
 *
 * 角色边界（修复角色错配）：
 *   distributor 的职责是 storage → 生产 sink。spawn/extension 是生产引擎，
 *   断能即停产 = 全盘崩溃，是绝对最高优先——即使敌袭期间也不让位 tower，
 *   因为 spawn 没能量就产不出防御 creep，等于釜底抽薪。
 *
 *   旧实现复用 hauler 专用的 getHaulFillTarget，其 #0 优先是 controller container
 *   （< 半满即派），导致 distributor 被持续 divert 去喂升级无底洞，spawn/extension
 *   长期排第二；且与 link 网络的 source/storage→controller 供能冗余，形成
 *   storage→distributor→controller container 的回流环路。本函数根治该错配。
 *
 * 优先级：
 *   1. spawn / extension —— 生产引擎，绝对最高（威胁下也不让位），所有档位服务。
 *   2. tower —— 防御/维修（tier >= 1 时跳过，保护低水位储备）。
 *   3. controller container —— 仅当房间无 controller link 时兜底（RCL4 有 storage 但
 *      link 未建成的窗口期）。有 controller link 时由 link 网络独占供能（零通勤），
 *      distributor 完全不碰，避免冗余回流。
 *
 * 同级取最近未预约者；预约集合与 hauler 共享（fillReservations，按 tick 惰性重置），
 * 避免 distributor 与 hauler 抢同一目标。所有目标都被预约时回退最近目标避免死锁。
 *
 * @param tier distributor 水位档位，控制允许填充的结构类型范围。
 */
export function getDistributorFillTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
  tier: DistributorTier = 0,
): AnyOwnedStructure | undefined {
  if (snapshot.fillTargets.length === 0) return undefined;

  const g = globalCache();
  if (!g.fillReservations || g.fillReservationTick !== Game.time) {
    g.fillReservations = new Set();
    g.fillReservationTick = Game.time;
  }
  const reserved = g.fillReservations;

  // spawn/extension 是同一孵化能量池，所有档位都完整服务 —
  // 低水位的节流由取能限额（withdrawStorageForDistribution）承担。
  const spawnTypes: string[] = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION];

  // 1. spawn / extension —— 生产引擎，最高优先。
  const primary = pickFillTarget(creep, snapshot.fillTargets, reserved, spawnTypes);
  if (primary) {
    reserved.add(primary.id);
    return primary as unknown as AnyOwnedStructure;
  }

  // tier >= 1: 跳过 tower，保护低水位下的能量储备。
  if (tier < 1) {
    // 2. tower —— 防御。
    const tower = pickFillTarget(creep, snapshot.fillTargets, reserved, [STRUCTURE_TOWER]);
    if (tower) {
      reserved.add(tower.id);
      return tower as unknown as AnyOwnedStructure;
    }
  }

  // 3. controller container 兜底 —— 仅当无 controller link 时（tier < 1 才允许）。
  if (tier < 1) {
    const hasControllerLink =
      snapshot.controller != null &&
      snapshot.links.some(l => l.pos.getRangeTo(snapshot.controller!) <= 2);
    if (!hasControllerLink) {
      const cc = snapshot.controllerContainer;
      if (cc && !reserved.has(cc.id) && cc.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        reserved.add(cc.id);
        return cc as unknown as AnyOwnedStructure;
      }
    }
  }

  // 全部已预约 — 回退最近目标（允许共享）避免死锁，但须符合 tier 类型约束。
  const fallbackPool = (snapshot.fillTargets as FillTarget[]).filter(t => {
    if (tier >= 1) return t.structureType === STRUCTURE_SPAWN || t.structureType === STRUCTURE_EXTENSION;
    return true;
  });
  return (creep.pos.findClosestByRange(fallbackPool) ?? undefined) as
    | AnyOwnedStructure
    | undefined;
}

/**
 * 判断当前水位档位下 distributor 是否存在可服务的填充需求。
 *
 * 供取能门禁使用 — 取能与投放必须用同一套目标口径：
 * 若门禁只看未过滤的 fillTargets（如仅剩 tower 需求但档位跳过 tower），
 * distributor 会为它拒绝服务的目标取能，随后携能 idle，能量滞留在背包里。
 *
 * 判定与 getDistributorFillTarget 的过滤规则一一对应（不含预约状态 —
 * 门禁关心的是需求存在性，预约只是同 tick 内的分工去重）。
 */
export function hasDistributorFillDemand(snapshot: RoomSnapshot, tier: DistributorTier): boolean {
  // spawn/extension：所有档位都服务。
  if (
    snapshot.fillTargets.some(
      t => t.structureType === STRUCTURE_SPAWN || t.structureType === STRUCTURE_EXTENSION,
    )
  ) {
    return true;
  }
  if (tier >= 1) return false;

  // tier 0 额外服务 tower。
  if (snapshot.fillTargets.some(t => t.structureType === STRUCTURE_TOWER)) return true;

  // tier 0 且无 controller link 时兜底 controller container。
  const hasControllerLink =
    snapshot.controller != null &&
    snapshot.links.some(l => l.pos.getRangeTo(snapshot.controller!) <= 2);
  if (!hasControllerLink) {
    const cc = snapshot.controllerContainer;
    if (cc && cc.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return true;
  }
  return false;
}

/**
 * 在 spawn 安全区内、按 hauler 填充优先级选择最近的需能量结构。
 *
 * 供 flee 等特殊场景使用 — 与 getHaulFillTarget 共享优先级层级（haulerFillTiers），
 * 但不使用预约系统（flee 是临时行为，不应消耗正常 hauler 的预约配额），
 * 且增加空间约束（仅选择 spawnPos safeRange 范围内的结构）。
 *
 * 不包含 controller container 优先级 — flee 是生存行为，
 * controller container 供能是效率行为，不应在威胁期间占优先。
 */
export function pickHaulFillTargetInRange(
  creep: Creep,
  snapshot: RoomSnapshot,
  spawnPos: RoomPosition,
  safeRange: number,
): FillTarget | undefined {
  if (snapshot.fillTargets.length === 0) return undefined;

  const hasThreats = snapshot.threatCreeps.length > 0;
  for (const types of haulerFillTiers(hasThreats)) {
    let best: FillTarget | undefined;
    let bestDist = Infinity;
    for (const t of snapshot.fillTargets) {
      if (types.length > 0 && !types.includes(t.structureType)) continue;
      if (t.pos.getRangeTo(spawnPos) > safeRange) continue;
      const d = creep.pos.getRangeTo(t.pos);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (best) return best;
  }
  return undefined;
}

/** 找到能量最多的 container。 */
export function findRichestContainer(
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestEnergy = 0;
  for (const c of containers) {
    const energy = c.store.getUsedCapacity(RESOURCE_ENERGY);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      best = c;
    }
  }
  return best;
}

/**
 * 找到距离 creep 最近且含有能量的 container。
 * 用于 builder 等需要在远处工地与能量源之间通勤的角色 — 选最近的能量源
 * 而非最满的，可显著缩短取能行走距离，提升建造 duty cycle。
 */
export function findClosestContainerWithEnergy(
  creep: Creep,
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestDist = Infinity;
  for (const c of containers) {
    if (c.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) continue;
    const d = creep.pos.getRangeTo(c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** 找到空闲容量最大的 container。 */
export function findEmptiestContainer(
  containers: readonly StructureContainer[],
): StructureContainer | undefined {
  let best: StructureContainer | undefined;
  let bestFree = 0;
  for (const c of containers) {
    const free = c.store.getFreeCapacity(RESOURCE_ENERGY);
    if (free > bestFree) {
      bestFree = free;
      best = c;
    }
  }
  return best;
}

/**
 * 选择下一个要拾取的掉落能量堆（考虑拾取范围与衰减）。
 *
 * 游戏机制：pickup 需相邻（range ≤ 1），每 tick 只能拾取一堆；掉落能量按
 * ceil(amount/1000)/tick 衰减，堆越大衰减越快。因此在“装满前持续拾取”时：
 *   - 若身边（range ≤ 1）有可拾取的堆，优先拾取能量最多的一堆
 *     （先拿大堆，减少剩余堆的衰减损耗）。
 *   - 否则走向最近的一堆去拾取。
 * “未装满则继续拾取”的跨 tick 循环由 FSM（updateMode：free>0 时保持 acquire）保证。
 */
export function selectDroppedEnergy(
  creep: Creep,
  dropped: readonly Resource[],
): Resource | undefined {
  if (dropped.length === 0) return undefined;

  // 优先拾取身边（range ≤ 1）能量最多的一堆。
  let richestAdjacent: Resource | undefined;
  for (const r of dropped) {
    if (creep.pos.getRangeTo(r) > 1) continue;
    if (!richestAdjacent || r.amount > richestAdjacent.amount) {
      richestAdjacent = r;
    }
  }
  if (richestAdjacent) return richestAdjacent;

  // 身边无可拾取 — 走向最近的一堆。
  return creep.pos.findClosestByRange([...dropped] as Resource[]) ?? undefined;
}

/**
 * 查找紧急维修目标：血量低于 50% 的 spawn/extension/tower/container。
 * 优先使用快照预计算的 criticalRepairTarget（零重复迭代）；
 * 快照未提供时回退到实时遍历（向后兼容）。
 */
export function findCriticalRepair(
  snapshot: RoomSnapshot,
): AnyStructure | undefined {
  if (snapshot.criticalRepairTarget !== undefined) {
    return snapshot.criticalRepairTarget;
  }
  // 回退路径：快照未预计算时实时遍历。
  const groups: readonly (readonly AnyStructure[])[] = [
    snapshot.spawns,
    snapshot.extensions,
    snapshot.towers,
    snapshot.containers,
  ];
  for (const group of groups) {
    for (const s of group) {
      if (s.hits < s.hitsMax * 0.5) {
        return s;
      }
    }
  }
  return undefined;
}
